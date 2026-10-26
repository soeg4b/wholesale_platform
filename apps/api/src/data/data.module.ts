import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';

// Export key -> Prisma delegate name. Every business table is exportable.
const ENTITIES: Record<string, string> = {
  users: 'user',
  roles: 'role',
  permissions: 'permission',
  userRoles: 'userRole',
  operators: 'operatorProfile',
  buyers: 'buyerProfile',
  links: 'networkLink',
  pricingRules: 'pricingRule',
  apiConfigs: 'dynamicApiConfig',
  syncRuns: 'apiSyncRun',
  geospatial: 'geospatialData',
  reservations: 'reservation',
  reservationItems: 'reservationItem',
  payments: 'payment',
  tickets: 'linkTicket',
  ticketUpdates: 'linkTicketUpdate',
  performance: 'linkPerformance',
  metrics: 'linkMetricSnapshot',
  interactions: 'linkInteraction',
  addOns: 'addOnService',
  insightReports: 'sellerInsightReport',
  aiAnalyses: 'aiAnalysis',
  webhookEvents: 'webhookEvent',
  settings: 'platformSetting',
  ledger: 'transactionLog',
  walletEntries: 'walletEntry',
  notifications: 'notification',
  notificationPreferences: 'notificationPreference',
  linkRequests: 'linkRequest',
  linkRequestVotes: 'linkRequestVote',
  linkRequestResponses: 'linkRequestResponse',
  prebuildProducts: 'prebuildProduct',
  prebuildCommitments: 'prebuildCommitment',
  reviews: 'operatorReview',
  referenceLocations: 'referenceLocation',
};

// Never leave the database through an export.
const SECRET_FIELDS = new Set([
  'passwordHash',
  'refreshTokenHash',
  'credentialsEnc',
  'webhookSecretEnc',
  'payoutAccount',
]);

type Delegate = {
  findMany: (args: { take: number }) => Promise<Record<string, unknown>[]>;
  count: () => Promise<number>;
};

const plain = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toString();
  return v;
};

const csvCell = (v: unknown) => {
  const p = plain(v);
  const s = p === null ? '' : typeof p === 'object' ? JSON.stringify(p) : String(p);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

@Injectable()
export class DataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  private delegate(entity: string): Delegate {
    const name = ENTITIES[entity];
    if (!name) throw new NotFoundException({ code: 'UNKNOWN_ENTITY', message: 'unknown entity' });
    return (this.prisma as unknown as Record<string, Delegate>)[name];
  }

  async catalog() {
    const out: { entity: string; rows: number }[] = [];
    for (const entity of Object.keys(ENTITIES))
      out.push({ entity, rows: await this.delegate(entity).count() });
    return out;
  }

  async rows(entity: string) {
    const max = await this.settings.cfg<number>('export.maxRows');
    const rows = await this.delegate(entity).findMany({ take: max });
    return rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (SECRET_FIELDS.has(k)) continue;
        // Secret platform settings keep their key but not their value.
        o[k] = entity === 'settings' && k === 'value' && r.isSecret ? '***' : plain(v);
      }
      return o;
    });
  }

  async export(user: AuthUser, entity: string, format: string, res: Response) {
    if (!['csv', 'json'].includes(format))
      throw new BadRequestException({ code: 'INVALID_FORMAT', message: 'csv or json' });
    const rows = await this.rows(entity);
    await this.ledger.appendSafe({
      eventType: 'DATA_EXPORT',
      status: 'SUCCESS',
      action: 'data.exported',
      actorUserId: user.sub,
      entityType: entity,
      requestPayload: { format, rows: rows.length },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="${entity}-${stamp}.${format}"`);
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify(rows));
    }
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(
      [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'),
    );
  }

  template() {
    return this.settings.cfg<Record<string, unknown>>('integration.template');
  }

  locations(all: boolean) {
    return this.prisma.referenceLocation.findMany({
      where: all ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  private checkLocation(b: Record<string, unknown>, partial: boolean) {
    const ok =
      (partial && b.name === undefined) ||
      (typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 120);
    const lat =
      (partial && b.lat === undefined) || (typeof b.lat === 'number' && Math.abs(b.lat) <= 90);
    const lng =
      (partial && b.lng === undefined) || (typeof b.lng === 'number' && Math.abs(b.lng) <= 180);
    const prov =
      b.province === undefined ||
      b.province === null ||
      (typeof b.province === 'string' && b.province.length <= 120);
    const act = b.isActive === undefined || typeof b.isActive === 'boolean';
    if (!ok || !lat || !lng || !prov || !act)
      throw new BadRequestException({ code: 'INVALID_LOCATION', message: 'invalid field' });
  }

  async upsertLocation(user: AuthUser, id: string | null, b: Record<string, unknown>) {
    this.checkLocation(b ?? {}, !!id);
    const data = {
      ...(b.name !== undefined && { name: String(b.name).trim() }),
      ...(b.province !== undefined && { province: (b.province as string | null) || null }),
      ...(b.lat !== undefined && { lat: b.lat as number }),
      ...(b.lng !== undefined && { lng: b.lng as number }),
      ...(b.isActive !== undefined && { isActive: b.isActive as boolean }),
    };
    try {
      const row = id
        ? await this.prisma.referenceLocation.update({ where: { id }, data })
        : await this.prisma.referenceLocation.create({
            data: data as Prisma.ReferenceLocationCreateInput,
          });
      await this.ledger.appendSafe({
        eventType: 'ADMIN_ACTION',
        status: 'SUCCESS',
        action: id ? 'reference.location.updated' : 'reference.location.created',
        actorUserId: user.sub,
        entityType: 'ReferenceLocation',
        entityId: row.id,
        requestPayload: b,
      });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new BadRequestException({ code: 'DUPLICATE_LOCATION', message: 'name exists' });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')
        throw new NotFoundException();
      throw e;
    }
  }
}

@Controller()
@UseGuards(AuthGuard)
export class DataController {
  constructor(private readonly svc: DataService) {}

  @Get('reference/locations')
  locations() {
    return this.svc.locations(false);
  }

  @Get('reference/integration-template')
  @Perms('apiconfig:manage')
  template() {
    return this.svc.template();
  }

  @Get('admin/reference/locations')
  @Perms('data:manage')
  allLocations() {
    return this.svc.locations(true);
  }

  @Post('admin/reference/locations')
  @Perms('data:manage')
  createLocation(@CurrentUser() u: AuthUser, @Body() b: Record<string, unknown>) {
    return this.svc.upsertLocation(u, null, b);
  }

  @Patch('admin/reference/locations/:id')
  @Perms('data:manage')
  updateLocation(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.svc.upsertLocation(u, id, b);
  }

  @Get('admin/export')
  @Perms('data:export')
  catalog() {
    return this.svc.catalog();
  }

  @Get('admin/export/:entity')
  @Perms('data:export')
  export(
    @CurrentUser() u: AuthUser,
    @Param('entity') entity: string,
    @Query('format') format = 'csv',
    @Res() res: Response,
  ) {
    return this.svc.export(u, entity, format, res);
  }
}

@Controller('public')
export class PublicDemoController {
  constructor(private readonly settings: SettingsService) {}

  @Get('demo-accounts')
  async demoAccounts() {
    const show = await this.settings.cfg<boolean>('demo.showAccounts');
    if (!show) return { password: '', accounts: [] };
    return this.settings.cfg<Record<string, unknown>>('demo.accounts');
  }
}

@Module({ controllers: [DataController, PublicDemoController], providers: [DataService] })
export class DataModule {}
