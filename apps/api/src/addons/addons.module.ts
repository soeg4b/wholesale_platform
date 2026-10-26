import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AddOnKind, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';

const KINDS: AddOnKind[] = [
  'REDUNDANCY',
  'CAPACITY_UPGRADE',
  'MONITORING',
  'PREMIUM_SLA',
  'DDOS_PROTECTION',
  'MANAGED_SERVICE',
  'OTHER',
];

interface AddOnBody {
  kind?: AddOnKind;
  name?: { id?: string; en?: string };
  description?: { id?: string; en?: string };
  price?: number;
  priceUnit?: string;
  currency?: string;
  applicableCategories?: string[];
  isActive?: boolean;
}

@Injectable()
export class AddOnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operators: OperatorContext,
    private readonly ledger: LedgerService,
  ) {}

  private present<T extends { price: Prisma.Decimal | null }>(a: T) {
    return { ...a, price: a.price === null ? null : Number(a.price) };
  }

  async publicList(operatorId?: string) {
    const rows = await this.prisma.addOnService.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        operatorProfile: { approvalStatus: 'APPROVED' },
        ...(operatorId && { operatorProfileId: operatorId }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.present(r));
  }

  async own(userId: string) {
    const op = await this.operators.get(userId);
    const rows = await this.prisma.addOnService.findMany({
      where: { operatorProfileId: op.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.present(r));
  }

  private validate(b: AddOnBody, partial: boolean) {
    // The body is typed as an interface, so the ValidationPipe cannot check it: types and sizes are enforced here.
    const text = (v: unknown, max: number) =>
      v === undefined || (typeof v === 'string' && v.length <= max);
    const bi = (v: AddOnBody['name'] | null, max: number) =>
      v === undefined ||
      (typeof v === 'object' && v !== null && text(v.id, max) && text(v.en, max));
    const cats = b.applicableCategories;
    if (
      !bi(b.name, 160) ||
      !bi(b.description, 2000) ||
      !text(b.priceUnit, 32) ||
      !text(b.currency, 8) ||
      (cats !== undefined &&
        (!Array.isArray(cats) ||
          cats.length > 50 ||
          !cats.every((c) => typeof c === 'string' && c.length <= 64)))
    )
      throw new HttpException({ code: 'INVALID_ADDON', message: 'invalid field' }, 400);
    if (!partial || b.kind !== undefined)
      if (!b.kind || !KINDS.includes(b.kind))
        throw new HttpException({ code: 'INVALID_ADDON', message: 'invalid kind' }, 400);
    if (!partial || b.name !== undefined)
      if (!b.name?.id?.trim() && !b.name?.en?.trim())
        throw new HttpException({ code: 'INVALID_ADDON', message: 'name required' }, 400);
    if (b.price !== undefined && (typeof b.price !== 'number' || !(b.price >= 0) || b.price > 1e12))
      throw new HttpException({ code: 'INVALID_ADDON', message: 'invalid price' }, 400);
  }

  private bilingual(v?: { id?: string; en?: string }) {
    return v
      ? { id: v.id?.trim() || v.en?.trim() || '', en: v.en?.trim() || v.id?.trim() || '' }
      : undefined;
  }

  async create(user: AuthUser, b: AddOnBody) {
    const op = await this.operators.getApproved(user.sub);
    this.validate(b, false);
    const row = await this.prisma.addOnService.create({
      data: {
        operatorProfileId: op.id,
        kind: b.kind!,
        name: this.bilingual(b.name)!,
        description: this.bilingual(b.description),
        price: b.price,
        priceUnit: b.priceUnit,
        currency: b.currency ?? op.defaultCurrency,
        applicableCategories: b.applicableCategories ?? [],
        isActive: b.isActive ?? true,
      },
    });
    await this.ledger.appendSafe({
      eventType: 'ADDON_CHANGE',
      status: 'SUCCESS',
      action: 'addon.created',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'AddOnService',
      entityId: row.id,
    });
    return this.present(row);
  }

  async update(user: AuthUser, id: string, b: AddOnBody) {
    const op = await this.operators.getApproved(user.sub);
    this.validate(b, true);
    const res = await this.prisma.addOnService.updateMany({
      where: { id, operatorProfileId: op.id, deletedAt: null },
      data: {
        ...(b.kind && { kind: b.kind }),
        ...(b.name && { name: this.bilingual(b.name)! }),
        ...(b.description && { description: this.bilingual(b.description) }),
        ...(b.price !== undefined && { price: b.price }),
        ...(b.priceUnit !== undefined && { priceUnit: b.priceUnit }),
        ...(b.currency && { currency: b.currency }),
        ...(b.applicableCategories && { applicableCategories: b.applicableCategories }),
        ...(b.isActive !== undefined && { isActive: b.isActive }),
      },
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'ADDON_CHANGE',
      status: 'SUCCESS',
      action: 'addon.updated',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'AddOnService',
      entityId: id,
    });
    return this.present(await this.prisma.addOnService.findUniqueOrThrow({ where: { id } }));
  }

  async remove(user: AuthUser, id: string) {
    const op = await this.operators.getApproved(user.sub);
    const res = await this.prisma.addOnService.updateMany({
      where: { id, operatorProfileId: op.id, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'ADDON_CHANGE',
      status: 'SUCCESS',
      action: 'addon.deleted',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'AddOnService',
      entityId: id,
    });
    return { ok: true };
  }
}

@Controller()
@UseGuards(AuthGuard)
export class AddOnsController {
  constructor(private readonly svc: AddOnsService) {}

  @Get('addons')
  @Perms('link:read')
  list(@Query('operatorId') operatorId?: string) {
    return this.svc.publicList(operatorId);
  }

  @Get('operator/addons')
  @Perms('addon:manage')
  own(@CurrentUser() u: AuthUser) {
    return this.svc.own(u.sub);
  }

  @Post('operator/addons')
  @Perms('addon:manage')
  create(@CurrentUser() u: AuthUser, @Body() b: AddOnBody) {
    return this.svc.create(u, b);
  }

  @Patch('operator/addons/:id')
  @Perms('addon:manage')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: AddOnBody) {
    return this.svc.update(u, id, b);
  }

  @Delete('operator/addons/:id')
  @Perms('addon:manage')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.remove(u, id);
  }
}

@Module({ controllers: [AddOnsController], providers: [AddOnsService], exports: [AddOnsService] })
export class AddOnsModule {}
