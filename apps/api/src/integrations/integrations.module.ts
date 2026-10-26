import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DynamicApiConfig, Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { LedgerService } from '../common/ledger.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { OPERATOR_ADAPTERS } from './adapter.types';
import { QualityModule } from '../quality/quality.module';
import { GenericRestAdapter, assertSafeUrl } from './generic-rest.adapter';
import { AdapterRegistry, SyncService } from './sync.service';

const AUTH_TYPES = ['NONE', 'API_KEY', 'BEARER', 'BASIC', 'OAUTH2_CLIENT_CREDENTIALS', 'HMAC'];
const SYNC_MODES = ['POLLING', 'WEBHOOK', 'HYBRID'];

interface ConfigBody {
  name?: string;
  adapterKey?: string;
  baseUrl?: string;
  authType?: string;
  credentials?: Record<string, unknown>;
  staticHeaders?: Record<string, string>;
  endpoints?: { listLinks?: { path?: string } };
  fieldMapping?: { fields?: Record<string, string> };
  syncMode?: string;
  pollingIntervalSec?: number;
  timeoutMs?: number;
  webhookSecret?: string;
  isActive?: boolean;
}

function present(c: DynamicApiConfig) {
  const { credentialsEnc, webhookSecretEnc, ...rest } = c;
  return { ...rest, hasCredentials: !!credentialsEnc, hasWebhookSecret: !!webhookSecretEnc };
}

@Controller('operator/api-configs')
@UseGuards(AuthGuard)
@Perms('apiconfig:manage')
export class ApiConfigsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly ledger: LedgerService,
    private readonly operators: OperatorContext,
    private readonly sync: SyncService,
    private readonly registry: AdapterRegistry,
  ) {}

  private async validate(body: ConfigBody, partial: boolean) {
    if (!partial || body.baseUrl !== undefined) await assertSafeUrl(body.baseUrl ?? '');
    if (!partial || body.name !== undefined)
      if (!body.name?.trim()) throw new BadRequestException('name is required');
    if (body.authType !== undefined && !AUTH_TYPES.includes(body.authType))
      throw new BadRequestException('Invalid authType');
    if (body.syncMode !== undefined && !SYNC_MODES.includes(body.syncMode))
      throw new BadRequestException('Invalid syncMode');
    if (body.adapterKey !== undefined && !this.registry.keys().includes(body.adapterKey)) {
      throw new BadRequestException(
        `Unknown adapter. Available: ${this.registry.keys().join(', ')}`,
      );
    }
    if (!partial || body.endpoints !== undefined) {
      if (!body.endpoints?.listLinks?.path?.startsWith('/'))
        throw new BadRequestException('endpoints.listLinks.path must start with "/"');
    }
    if (!partial || body.fieldMapping !== undefined) {
      const f = body.fieldMapping?.fields ?? {};
      for (const required of ['externalId', 'originName', 'destinationName']) {
        if (!f[required])
          throw new BadRequestException(`fieldMapping.fields.${required} is required`);
      }
    }
  }

  private data(body: ConfigBody) {
    return {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.adapterKey !== undefined && { adapterKey: body.adapterKey }),
      ...(body.baseUrl !== undefined && { baseUrl: body.baseUrl.trim() }),
      ...(body.authType !== undefined && {
        authType: body.authType as DynamicApiConfig['authType'],
      }),
      ...(body.credentials !== undefined && {
        credentialsEnc: this.crypto.encryptJson(body.credentials),
      }),
      ...(body.staticHeaders !== undefined && {
        staticHeaders: body.staticHeaders as Prisma.InputJsonValue,
      }),
      ...(body.endpoints !== undefined && { endpoints: body.endpoints as Prisma.InputJsonValue }),
      ...(body.fieldMapping !== undefined && {
        fieldMapping: body.fieldMapping as Prisma.InputJsonValue,
      }),
      ...(body.syncMode !== undefined && {
        syncMode: body.syncMode as DynamicApiConfig['syncMode'],
      }),
      ...(body.pollingIntervalSec !== undefined && {
        pollingIntervalSec: Math.max(30, Math.floor(body.pollingIntervalSec)),
      }),
      ...(body.timeoutMs !== undefined && {
        timeoutMs: Math.min(30000, Math.max(1000, Math.floor(body.timeoutMs))),
      }),
      ...(body.webhookSecret !== undefined && {
        webhookSecretEnc: this.crypto.encrypt(body.webhookSecret),
      }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    };
  }

  private async own(userId: string, id: string) {
    const op = await this.operators.get(userId);
    const config = await this.prisma.dynamicApiConfig.findFirst({
      where: { id, operatorProfileId: op.id },
    });
    if (!config) throw new NotFoundException();
    return config;
  }

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const op = await this.operators.get(u.sub);
    const rows = await this.prisma.dynamicApiConfig.findMany({
      where: { operatorProfileId: op.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { links: true } } },
    });
    return rows.map((r) => ({ ...present(r), linkCount: r._count.links }));
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() body: ConfigBody) {
    const op = await this.operators.getApproved(u.sub);
    await this.validate(body, false);
    const row = await this.prisma.dynamicApiConfig.create({
      data: {
        ...(this.data(body) as Omit<Prisma.DynamicApiConfigCreateInput, 'operatorProfile'>),
        operatorProfile: { connect: { id: op.id } },
        status: 'PENDING',
      } as Prisma.DynamicApiConfigCreateInput,
    });
    await this.ledger.appendSafe({
      eventType: 'API_CONFIG_CHANGE',
      status: 'SUCCESS',
      action: 'api-config.created',
      actorUserId: u.sub,
      operatorProfileId: op.id,
      entityType: 'DynamicApiConfig',
      entityId: row.id,
      requestPayload: { ...body, credentials: undefined },
    });
    return present(row);
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: ConfigBody) {
    const existing = await this.own(u.sub, id);
    await this.validate(body, true);
    const row = await this.prisma.dynamicApiConfig.update({
      where: { id },
      data: { ...(this.data(body) as Prisma.DynamicApiConfigUpdateInput), nextSyncAt: null },
    });
    await this.ledger.appendSafe({
      eventType: 'API_CONFIG_CHANGE',
      status: 'SUCCESS',
      action: 'api-config.updated',
      actorUserId: u.sub,
      operatorProfileId: existing.operatorProfileId,
      entityType: 'DynamicApiConfig',
      entityId: id,
      requestPayload: { ...body, credentials: undefined },
    });
    return present(row);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const existing = await this.own(u.sub, id);
    await this.prisma.dynamicApiConfig.update({
      where: { id },
      data: { isActive: false, status: 'PAUSED' },
    });
    await this.ledger.appendSafe({
      eventType: 'API_CONFIG_CHANGE',
      status: 'SUCCESS',
      action: 'api-config.paused',
      actorUserId: u.sub,
      operatorProfileId: existing.operatorProfileId,
      entityType: 'DynamicApiConfig',
      entityId: id,
    });
    return { ok: true };
  }

  @Post(':id/test')
  async test(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.sync.preview(await this.own(u.sub, id));
  }

  @Post(':id/sync')
  async syncNow(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const c = await this.own(u.sub, id);
    await this.operators.getApproved(u.sub);
    return this.sync.runSync(c.id, 'MANUAL', u.sub);
  }

  @Get(':id/runs')
  async runs(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.own(u.sub, id);
    return this.prisma.apiSyncRun.findMany({
      where: { apiConfigId: id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  }
}

@Controller('webhooks/operators')
export class OperatorWebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sync: SyncService,
    private readonly ledger: LedgerService,
  ) {}

  @Post(':configId')
  @HttpCode(202)
  async receive(
    @Param('configId') configId: string,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-event-id') eventId: string | undefined,
    @Req() req: { rawBody?: Buffer },
    @Body() body: unknown,
  ) {
    const config = await this.prisma.dynamicApiConfig.findFirst({
      where: { id: configId, isActive: true, syncMode: { in: ['WEBHOOK', 'HYBRID'] } },
    });
    if (!config || !config.webhookSecretEnc) throw new NotFoundException();
    const secret = this.crypto.decrypt(config.webhookSecretEnc);
    const expected = createHmac('sha256', secret)
      .update(req.rawBody ?? Buffer.alloc(0))
      .digest('hex');
    const given = Buffer.from(signature ?? '', 'hex');
    const exp = Buffer.from(expected, 'hex');
    const ok = given.length === exp.length && timingSafeEqual(given, exp);

    let event;
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          source: 'OPERATOR_API',
          provider: configId,
          eventId: eventId ?? null,
          signatureOk: ok,
          payload: (body ?? {}) as Prisma.InputJsonValue,
          status: ok ? 'RECEIVED' : 'FAILED',
          error: ok ? null : 'Invalid signature',
        },
      });
    } catch {
      return { duplicate: true };
    }
    if (!ok) throw new UnauthorizedException('Invalid signature');

    const items = Array.isArray(body)
      ? body
      : Array.isArray((body as { items?: unknown[] })?.items)
        ? (body as { items: unknown[] }).items
        : [body];
    const stats = await this.sync.ingest(config, items, false);
    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    await this.ledger.appendSafe({
      eventType: 'API_SYNC',
      status: 'SUCCESS',
      action: 'api.sync.webhook',
      operatorProfileId: config.operatorProfileId,
      entityType: 'DynamicApiConfig',
      entityId: config.id,
      externalRef: eventId,
      responsePayload: stats,
    });
    return stats;
  }
}

@Module({
  imports: [QualityModule],
  controllers: [ApiConfigsController, OperatorWebhooksController],
  providers: [
    GenericRestAdapter,
    {
      provide: OPERATOR_ADAPTERS,
      useFactory: (g: GenericRestAdapter) => [g],
      inject: [GenericRestAdapter],
    },
    AdapterRegistry,
    SyncService,
  ],
  exports: [AdapterRegistry, SyncService],
})
export class IntegrationsModule {}
