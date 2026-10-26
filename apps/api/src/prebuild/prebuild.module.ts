import {
  BadRequestException,
  Body,
  ConflictException,
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
import { Prisma, PrebuildStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.module';

const STATUSES: PrebuildStatus[] = ['PLANNED', 'BUILDING', 'READY', 'CANCELLED'];

interface ProductBody {
  name?: { id?: string; en?: string };
  description?: { id?: string; en?: string };
  category?: string;
  originName?: string;
  destinationName?: string;
  capacityMbps?: number;
  targetReadyDate?: string;
  progressPct?: number;
  status?: PrebuildStatus;
  basePrice?: number;
  earlyBirdPrice?: number;
  earlyBirdUntil?: string;
  earlyBirdSlots?: number;
  minTermMonths?: number;
  linkRequestId?: string | null;
}

type ProductRow = Prisma.PrebuildProductGetPayload<{
  include: {
    operatorProfile: { select: { id: true; displayName: true } };
    commitments: true;
  };
}>;

@Injectable()
export class PrebuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly operators: OperatorContext,
    private readonly notifications: NotificationsService,
  ) {}

  private present(p: ProductRow, userId?: string) {
    const pledged = p.commitments.filter((c) => c.status !== 'CANCELLED');
    const earlyTaken = pledged.filter(
      (c) => Number(c.lockedPrice) <= Number(p.earlyBirdPrice),
    ).length;
    const slotsLeft = Math.max(0, p.earlyBirdSlots - earlyTaken);
    const earlyBirdActive =
      p.status !== 'CANCELLED' && slotsLeft > 0 && p.earlyBirdUntil.getTime() >= Date.now();
    const base = Number(p.basePrice);
    const early = Number(p.earlyBirdPrice);
    const mine = userId ? p.commitments.find((c) => c.buyerUserId === userId) : undefined;
    const { commitments: _c, ...rest } = p;
    return {
      ...rest,
      basePrice: base,
      earlyBirdPrice: early,
      operator: p.operatorProfile,
      commitments: pledged.length,
      slotsLeft,
      earlyBirdActive,
      currentPrice: earlyBirdActive ? early : base,
      discountPct: base > 0 ? Math.round(((base - early) / base) * 1000) / 10 : 0,
      myCommitment: mine ? { ...mine, lockedPrice: Number(mine.lockedPrice) } : null,
    };
  }

  private include = {
    operatorProfile: { select: { id: true, displayName: true } },
    commitments: true,
  } as const;

  async publicList(user: AuthUser, q: { city?: string; operatorId?: string }) {
    const rows = await this.prisma.prebuildProduct.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PLANNED', 'BUILDING', 'READY'] },
        operatorProfile: { approvalStatus: 'APPROVED', deletedAt: null },
        ...(q.operatorId && { operatorProfileId: q.operatorId }),
        ...(q.city && {
          OR: [
            { originName: { equals: q.city, mode: 'insensitive' } },
            { destinationName: { equals: q.city, mode: 'insensitive' } },
          ],
        }),
      },
      include: this.include,
      orderBy: { targetReadyDate: 'asc' },
      take: 200,
    });
    return rows.map((r) => this.present(r, user.sub));
  }

  async own(user: AuthUser) {
    const op = await this.operators.get(user.sub);
    const rows = await this.prisma.prebuildProduct.findMany({
      where: { operatorProfileId: op.id, deletedAt: null },
      include: {
        ...this.include,
        commitments: {
          include: {
            buyer: { select: { fullName: true, buyerProfile: { select: { companyName: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      ...this.present(r as unknown as ProductRow),
      pledges: r.commitments.map((c) => ({
        id: c.id,
        status: c.status,
        termMonths: c.termMonths,
        capacityMbps: c.capacityMbps,
        lockedPrice: Number(c.lockedPrice),
        company: c.buyer.buyerProfile?.companyName ?? c.buyer.fullName,
        createdAt: c.createdAt,
      })),
    }));
  }

  private validate(b: ProductBody, partial: boolean) {
    const text = (v: unknown, max: number) =>
      typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    const bi = (v: ProductBody['name'], max: number) =>
      typeof v === 'object' &&
      v !== null &&
      (text(v.id, max) || text(v.en, max)) &&
      [v.id, v.en].every((s) => s === undefined || (typeof s === 'string' && s.length <= max));
    const num = (v: unknown, lo: number, hi: number, int = false) =>
      typeof v === 'number' && v >= lo && v <= hi && (!int || Number.isInteger(v));
    const date = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
    const checks: [keyof ProductBody, (v: unknown) => boolean][] = [
      ['name', (v) => bi(v as ProductBody['name'], 160)],
      ['description', (v) => bi(v as ProductBody['name'], 2000)],
      ['category', (v) => text(v, 64)],
      ['originName', (v) => text(v, 120)],
      ['destinationName', (v) => text(v, 120)],
      ['capacityMbps', (v) => num(v, 1, 1e9, true)],
      ['targetReadyDate', date],
      ['progressPct', (v) => num(v, 0, 100, true)],
      ['status', (v) => STATUSES.includes(v as PrebuildStatus)],
      ['basePrice', (v) => num(v, 0, 1e12)],
      ['earlyBirdPrice', (v) => num(v, 0, 1e12)],
      ['earlyBirdUntil', date],
      ['earlyBirdSlots', (v) => num(v, 0, 100000, true)],
      ['minTermMonths', (v) => num(v, 1, 240, true)],
    ];
    const required: (keyof ProductBody)[] = [
      'name',
      'category',
      'originName',
      'destinationName',
      'capacityMbps',
      'targetReadyDate',
      'basePrice',
      'earlyBirdPrice',
      'earlyBirdUntil',
      'earlyBirdSlots',
    ];
    for (const [k, ok] of checks) {
      const v = b[k];
      if (v === undefined) {
        if (!partial && required.includes(k))
          throw new BadRequestException({ code: 'INVALID_PREBUILD', message: `${k} required` });
        continue;
      }
      if (!ok(v))
        throw new BadRequestException({ code: 'INVALID_PREBUILD', message: `invalid ${k}` });
    }
  }

  private bilingual(v?: { id?: string; en?: string }) {
    return v
      ? { id: v.id?.trim() || v.en?.trim() || '', en: v.en?.trim() || v.id?.trim() || '' }
      : undefined;
  }

  private async coords(name: string) {
    const l = await this.prisma.referenceLocation.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    return l ? { name: l.name, lat: l.lat, lng: l.lng } : { name, lat: undefined, lng: undefined };
  }

  async create(user: AuthUser, b: ProductBody) {
    const op = await this.operators.getApproved(user.sub);
    this.validate(b, false);
    if (b.earlyBirdPrice! > b.basePrice!)
      throw new BadRequestException({
        code: 'INVALID_PREBUILD',
        message: 'earlyBirdPrice must be <= basePrice',
      });
    const max = await this.settings.cfg<number>('prebuild.maxActivePerOperator');
    const active = await this.prisma.prebuildProduct.count({
      where: { operatorProfileId: op.id, deletedAt: null, status: { not: 'CANCELLED' } },
    });
    if (active >= max)
      throw new HttpException(
        { code: 'PREBUILD_LIMIT', message: `max ${max} active products` },
        429,
      );
    if (b.linkRequestId) {
      const exists = await this.prisma.linkRequest.count({ where: { id: b.linkRequestId } });
      if (!exists)
        throw new BadRequestException({ code: 'INVALID_PREBUILD', message: 'unknown request' });
    }
    const [a, z] = await Promise.all([
      this.coords(b.originName!.trim()),
      this.coords(b.destinationName!.trim()),
    ]);
    const row = await this.prisma.prebuildProduct.create({
      data: {
        operatorProfileId: op.id,
        linkRequestId: b.linkRequestId || null,
        name: this.bilingual(b.name)!,
        description: this.bilingual(b.description),
        category: b.category!.trim().toUpperCase(),
        originName: a.name,
        originLat: a.lat,
        originLng: a.lng,
        destinationName: z.name,
        destinationLat: z.lat,
        destinationLng: z.lng,
        capacityMbps: b.capacityMbps!,
        targetReadyDate: new Date(b.targetReadyDate!),
        progressPct: b.progressPct ?? 0,
        status: b.status && b.status !== 'CANCELLED' ? b.status : 'PLANNED',
        basePrice: b.basePrice!,
        earlyBirdPrice: b.earlyBirdPrice!,
        earlyBirdUntil: new Date(b.earlyBirdUntil!),
        earlyBirdSlots: b.earlyBirdSlots!,
        minTermMonths: b.minTermMonths ?? 12,
        currency: op.defaultCurrency,
      },
      include: this.include,
    });
    await this.ledger.appendSafe({
      eventType: 'PREBUILD',
      status: 'SUCCESS',
      action: 'prebuild.created',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'PrebuildProduct',
      entityId: row.id,
    });
    const p = this.present(row);
    const route = `${row.originName} - ${row.destinationName}`;
    await this.notifications.notify({
      userIds: await this.notifications.audience('PENYEWA'),
      category: 'EARLY_BIRD',
      title: {
        id: `Early bird ${p.discountPct}%: ${route} oleh ${op.displayName}`,
        en: `Early bird ${p.discountPct}% off: ${route} by ${op.displayName}`,
      },
      body: {
        id: `Target siap ${row.targetReadyDate.toISOString().slice(0, 10)}, ${row.earlyBirdSlots} slot`,
        en: `Target ready ${row.targetReadyDate.toISOString().slice(0, 10)}, ${row.earlyBirdSlots} slots`,
      },
      href: `/prebuild#${row.id}`,
      entityType: 'PrebuildProduct',
      entityId: row.id,
      dedupeKey: `prebuild:${row.id}`,
      match: {
        cities: [row.originName, row.destinationName],
        operatorId: op.id,
        discountPct: p.discountPct,
      },
    });
    if (row.linkRequestId) {
      const req = await this.prisma.linkRequest.findUnique({
        where: { id: row.linkRequestId },
        include: { votes: { select: { userId: true } } },
      });
      if (req)
        await this.notifications.notify({
          userIds: [req.requesterUserId, ...req.votes.map((v) => v.userId)],
          category: 'LINK_REQUEST',
          title: {
            id: `Permintaan ${route} akan dibangun oleh ${op.displayName}`,
            en: `Your ${route} request will be built by ${op.displayName}`,
          },
          href: `/prebuild#${row.id}`,
          entityType: 'PrebuildProduct',
          entityId: row.id,
          dedupeKey: `prebuild-request:${row.id}`,
        });
    }
    return p;
  }

  async update(user: AuthUser, id: string, b: ProductBody) {
    const op = await this.operators.getApproved(user.sub);
    this.validate(b, true);
    const cur = await this.prisma.prebuildProduct.findFirst({
      where: { id, operatorProfileId: op.id, deletedAt: null },
      include: { commitments: true },
    });
    if (!cur) throw new NotFoundException();
    if (cur.convertedLinkId)
      throw new ConflictException({ code: 'PREBUILD_LAUNCHED', message: 'already launched' });
    const base = b.basePrice ?? Number(cur.basePrice);
    const early = b.earlyBirdPrice ?? Number(cur.earlyBirdPrice);
    if (early > base)
      throw new BadRequestException({
        code: 'INVALID_PREBUILD',
        message: 'earlyBirdPrice must be <= basePrice',
      });
    const row = await this.prisma.prebuildProduct.update({
      where: { id },
      data: {
        ...(b.name && { name: this.bilingual(b.name)! }),
        ...(b.description && { description: this.bilingual(b.description) }),
        ...(b.category && { category: b.category.trim().toUpperCase() }),
        ...(b.capacityMbps !== undefined && { capacityMbps: b.capacityMbps }),
        ...(b.targetReadyDate && { targetReadyDate: new Date(b.targetReadyDate) }),
        ...(b.progressPct !== undefined && { progressPct: b.progressPct }),
        ...(b.status && { status: b.status }),
        ...(b.basePrice !== undefined && { basePrice: b.basePrice }),
        ...(b.earlyBirdPrice !== undefined && { earlyBirdPrice: b.earlyBirdPrice }),
        ...(b.earlyBirdUntil && { earlyBirdUntil: new Date(b.earlyBirdUntil) }),
        ...(b.earlyBirdSlots !== undefined && { earlyBirdSlots: b.earlyBirdSlots }),
        ...(b.minTermMonths !== undefined && { minTermMonths: b.minTermMonths }),
      },
      include: this.include,
    });
    await this.ledger.appendSafe({
      eventType: 'PREBUILD',
      status: 'SUCCESS',
      action: 'prebuild.updated',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'PrebuildProduct',
      entityId: id,
      requestPayload: b,
    });
    if (row.status !== cur.status || row.progressPct !== cur.progressPct) {
      const route = `${row.originName} - ${row.destinationName}`;
      await this.notifications.notify({
        userIds: cur.commitments.filter((c) => c.status === 'PLEDGED').map((c) => c.buyerUserId),
        category: 'EARLY_BIRD',
        title: {
          id: `Progres ${route}: ${row.progressPct}% (${row.status})`,
          en: `${route} progress: ${row.progressPct}% (${row.status})`,
        },
        href: `/prebuild#${row.id}`,
        entityType: 'PrebuildProduct',
        entityId: row.id,
        dedupeKey: `prebuild-progress:${row.id}:${row.status}:${row.progressPct}`,
      });
    }
    return this.present(row);
  }

  async cancel(user: AuthUser, id: string) {
    const op = await this.operators.getApproved(user.sub);
    const cur = await this.prisma.prebuildProduct.findFirst({
      where: { id, operatorProfileId: op.id, deletedAt: null, convertedLinkId: null },
      include: { commitments: true },
    });
    if (!cur) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.prebuildProduct.update({ where: { id }, data: { status: 'CANCELLED' } }),
      this.prisma.prebuildCommitment.updateMany({
        where: { productId: id, status: 'PLEDGED' },
        data: { status: 'CANCELLED' },
      }),
    ]);
    await this.ledger.appendSafe({
      eventType: 'PREBUILD',
      status: 'CANCELLED',
      action: 'prebuild.cancelled',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'PrebuildProduct',
      entityId: id,
    });
    const route = `${cur.originName} - ${cur.destinationName}`;
    await this.notifications.notify({
      userIds: cur.commitments.filter((c) => c.status === 'PLEDGED').map((c) => c.buyerUserId),
      category: 'EARLY_BIRD',
      title: { id: `Produk ${route} dibatalkan`, en: `${route} product was cancelled` },
      href: '/prebuild',
      entityType: 'PrebuildProduct',
      entityId: id,
      dedupeKey: `prebuild-cancel:${id}`,
    });
    return { ok: true };
  }

  // Publishes the finished route as a marketplace link; pledges become CONVERTED.
  async launch(user: AuthUser, id: string) {
    const op = await this.operators.getApproved(user.sub);
    const cur = await this.prisma.prebuildProduct.findFirst({
      where: { id, operatorProfileId: op.id, deletedAt: null, status: { not: 'CANCELLED' } },
      include: { commitments: true },
    });
    if (!cur) throw new NotFoundException();
    if (cur.convertedLinkId)
      throw new ConflictException({ code: 'PREBUILD_LAUNCHED', message: 'already launched' });
    const link = await this.prisma.$transaction(async (tx) => {
      const l = await tx.networkLink.create({
        data: {
          operatorProfileId: op.id,
          name: cur.name as Prisma.InputJsonValue,
          description: (cur.description ?? undefined) as Prisma.InputJsonValue | undefined,
          category: cur.category,
          status: 'ACTIVE',
          originName: cur.originName,
          originLat: cur.originLat,
          originLng: cur.originLng,
          destinationName: cur.destinationName,
          destinationLat: cur.destinationLat,
          destinationLng: cur.destinationLng,
          capacityMbps: cur.capacityMbps,
          availableMbps: cur.capacityMbps,
          basePrice: cur.basePrice,
          currency: cur.currency,
          minTermMonths: cur.minTermMonths,
          attributes: { prebuildProductId: cur.id },
        },
      });
      await tx.prebuildProduct.update({
        where: { id },
        data: { status: 'READY', progressPct: 100, convertedLinkId: l.id },
      });
      await tx.prebuildCommitment.updateMany({
        where: { productId: id, status: 'PLEDGED' },
        data: { status: 'CONVERTED' },
      });
      return l;
    });
    await this.ledger.appendSafe({
      eventType: 'PREBUILD',
      status: 'SUCCESS',
      action: 'prebuild.launched',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      networkLinkId: link.id,
      entityType: 'PrebuildProduct',
      entityId: id,
    });
    const route = `${cur.originName} - ${cur.destinationName}`;
    await this.notifications.notify({
      userIds: cur.commitments.filter((c) => c.status === 'PLEDGED').map((c) => c.buyerUserId),
      category: 'EARLY_BIRD',
      title: { id: `${route} sudah siap disewa`, en: `${route} is ready to rent` },
      body: {
        id: 'Harga early bird Anda tercatat pada komitmen.',
        en: 'Your early-bird price is recorded on your pledge.',
      },
      href: `/links/${link.id}`,
      entityType: 'NetworkLink',
      entityId: link.id,
      dedupeKey: `prebuild-launch:${id}`,
    });
    return { linkId: link.id };
  }

  async commit(user: AuthUser, id: string, b: { termMonths?: number; capacityMbps?: number }) {
    const ok = (v: unknown, hi: number) =>
      Number.isInteger(v) && (v as number) > 0 && (v as number) <= hi;
    if (!ok(b?.termMonths, 240) || (b.capacityMbps !== undefined && !ok(b.capacityMbps, 1e9)))
      throw new BadRequestException({ code: 'INVALID_COMMITMENT', message: 'invalid field' });
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prebuild:${id}`}))`;
      const p = await tx.prebuildProduct.findFirst({
        where: {
          id,
          deletedAt: null,
          convertedLinkId: null,
          status: { in: ['PLANNED', 'BUILDING', 'READY'] },
          operatorProfile: { approvalStatus: 'APPROVED' },
        },
        include: this.include,
      });
      if (!p) throw new NotFoundException();
      if (b.termMonths! < p.minTermMonths)
        throw new BadRequestException({
          code: 'TERM_TOO_SHORT',
          message: `min ${p.minTermMonths} months`,
        });
      const view = this.present(p, user.sub);
      if (view.myCommitment && view.myCommitment.status === 'PLEDGED')
        throw new ConflictException({ code: 'ALREADY_COMMITTED', message: 'already committed' });
      const data = {
        termMonths: b.termMonths!,
        capacityMbps: b.capacityMbps ?? null,
        lockedPrice: view.currentPrice,
        status: 'PLEDGED' as const,
      };
      return tx.prebuildCommitment.upsert({
        where: { productId_buyerUserId: { productId: id, buyerUserId: user.sub } },
        create: { ...data, productId: id, buyerUserId: user.sub },
        update: data,
      });
    });
    await this.ledger.appendSafe({
      eventType: 'PREBUILD',
      status: 'SUCCESS',
      action: 'prebuild.committed',
      actorUserId: user.sub,
      entityType: 'PrebuildCommitment',
      entityId: row.id,
      amount: row.lockedPrice,
    });
    return { ...row, lockedPrice: Number(row.lockedPrice) };
  }

  async uncommit(user: AuthUser, id: string) {
    const res = await this.prisma.prebuildCommitment.updateMany({
      where: { productId: id, buyerUserId: user.sub, status: 'PLEDGED' },
      data: { status: 'CANCELLED' },
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'PREBUILD',
      status: 'CANCELLED',
      action: 'prebuild.uncommitted',
      actorUserId: user.sub,
      entityType: 'PrebuildProduct',
      entityId: id,
    });
    return { ok: true };
  }
}

@Controller()
@UseGuards(AuthGuard)
export class PrebuildController {
  constructor(private readonly svc: PrebuildService) {}

  @Get('prebuild')
  @Perms('link:read')
  list(@CurrentUser() u: AuthUser, @Query() q: { city?: string; operatorId?: string }) {
    return this.svc.publicList(u, q);
  }

  @Post('prebuild/:id/commit')
  @Perms('prebuild:commit')
  commit(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: { termMonths?: number; capacityMbps?: number },
  ) {
    return this.svc.commit(u, id, b ?? {});
  }

  @Delete('prebuild/:id/commit')
  @Perms('prebuild:commit')
  uncommit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.uncommit(u, id);
  }

  @Get('operator/prebuild')
  @Perms('prebuild:manage')
  own(@CurrentUser() u: AuthUser) {
    return this.svc.own(u);
  }

  @Post('operator/prebuild')
  @Perms('prebuild:manage')
  create(@CurrentUser() u: AuthUser, @Body() b: ProductBody) {
    return this.svc.create(u, b ?? {});
  }

  @Patch('operator/prebuild/:id')
  @Perms('prebuild:manage')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ProductBody) {
    return this.svc.update(u, id, b ?? {});
  }

  @Post('operator/prebuild/:id/launch')
  @Perms('prebuild:manage')
  launch(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.launch(u, id);
  }

  @Delete('operator/prebuild/:id')
  @Perms('prebuild:manage')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.cancel(u, id);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [PrebuildController],
  providers: [PrebuildService],
})
export class PrebuildModule {}
