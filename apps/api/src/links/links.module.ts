import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { PricingService } from './pricing.service';
import { BulkPricingController } from './bulk-pricing.controller';
import { InteractionsModule, InteractionsService } from '../interactions/interactions.module';
import { PerformanceService, QualityModule } from '../quality/quality.module';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.module';

const num = (v?: string) =>
  v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);

interface SearchQuery {
  q?: string;
  origin?: string;
  destination?: string;
  category?: string;
  operatorId?: string;
  city?: string;
  minSlaPercent?: string;
  minScore?: string;
  hasGeometry?: string;
  minCapacityMbps?: string;
  maxLatencyMs?: string;
  minPrice?: string;
  maxPrice?: string;
  availableOnly?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
}

const ORDER: Record<string, Prisma.NetworkLinkOrderByWithRelationInput> = {
  price_asc: { basePrice: 'asc' },
  price_desc: { basePrice: 'desc' },
  latency_asc: { latencyMs: 'asc' },
  capacity_desc: { capacityMbps: 'desc' },
  newest: { createdAt: 'desc' },
};

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly interactions: InteractionsService,
    private readonly perf: PerformanceService,
  ) {}

  private serialize<T extends { basePrice: Prisma.Decimal | null }>(link: T) {
    return { ...link, basePrice: link.basePrice === null ? null : Number(link.basePrice) };
  }

  async search(user: AuthUser, q: SearchQuery) {
    const page = Math.max(1, num(q.page) ?? 1);
    const pageSize = Math.min(50, Math.max(1, num(q.pageSize) ?? 12));
    // operatorId accepts a comma-separated list so buyers can compare several providers.
    const operatorIds = (q.operatorId ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    const where: Prisma.NetworkLinkWhereInput = {
      deletedAt: null,
      status: 'ACTIVE',
      operatorProfile: { approvalStatus: 'APPROVED', deletedAt: null },
      ...(q.availableOnly === 'true' && { availability: 'AVAILABLE' }),
      ...(q.category && { category: q.category }),
      ...(operatorIds.length && { operatorProfileId: { in: operatorIds } }),
      ...(q.origin && { originName: { contains: q.origin, mode: 'insensitive' } }),
      ...(q.destination && { destinationName: { contains: q.destination, mode: 'insensitive' } }),
      ...(num(q.minSlaPercent) !== undefined && { slaPercent: { gte: num(q.minSlaPercent) } }),
      ...(num(q.minScore) !== undefined && {
        performance: { rated: true, score: { gte: num(q.minScore) } },
      }),
      ...(q.hasGeometry === 'true' && { geospatialDataId: { not: null } }),
      ...(q.city && {
        AND: [
          {
            OR: [
              { originName: { equals: q.city, mode: 'insensitive' } },
              { destinationName: { equals: q.city, mode: 'insensitive' } },
            ],
          },
        ],
      }),
      ...(num(q.minCapacityMbps) !== undefined && {
        capacityMbps: { gte: num(q.minCapacityMbps) },
      }),
      ...(num(q.maxLatencyMs) !== undefined && { latencyMs: { lte: num(q.maxLatencyMs) } }),
      ...((num(q.minPrice) !== undefined || num(q.maxPrice) !== undefined) && {
        basePrice: { gte: num(q.minPrice), lte: num(q.maxPrice) },
      }),
      ...(q.q && {
        OR: [
          { originName: { contains: q.q, mode: 'insensitive' } },
          { destinationName: { contains: q.q, mode: 'insensitive' } },
          { category: { contains: q.q, mode: 'insensitive' } },
          { operatorProfile: { displayName: { contains: q.q, mode: 'insensitive' } } },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.networkLink.count({ where }),
      this.prisma.networkLink.findMany({
        where,
        orderBy: [ORDER[q.sort ?? ''] ?? { createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { operatorProfile: { select: { id: true, displayName: true, slug: true } } },
      }),
    ]);
    const rules = await this.prisma.pricingRule.findMany({
      where: {
        operatorProfileId: { in: [...new Set(rows.map((r) => r.operatorProfileId))] },
        isActive: true,
      },
    });
    const perfById = await this.perf.many(
      user,
      rows.map((r) => r.id),
    );
    const items = rows.map((r) => {
      const quote = this.pricing.compute(
        r,
        rules.filter((x) => x.operatorProfileId === r.operatorProfileId),
        { termMonths: 12 },
      );
      const { operatorProfile, ...link } = r;
      return {
        ...this.serialize(link),
        operator: operatorProfile,
        hasGeometry: !!r.geospatialDataId,
        priceFrom: quote.unitPrice,
        performance: perfById[r.id],
      };
    });
    return { items, total, page, pageSize };
  }

  async facets() {
    const base: Prisma.NetworkLinkWhereInput = {
      deletedAt: null,
      status: 'ACTIVE',
      operatorProfile: { approvalStatus: 'APPROVED', deletedAt: null },
    };
    const [operators, cities, categories, ranges] = await Promise.all([
      this.prisma.operatorProfile.findMany({
        where: {
          approvalStatus: 'APPROVED',
          deletedAt: null,
          links: { some: { deletedAt: null, status: 'ACTIVE' } },
        },
        select: { id: true, displayName: true },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.networkLink.findMany({
        where: base,
        select: { originName: true, destinationName: true },
      }),
      this.prisma.networkLink.findMany({
        where: base,
        select: { category: true },
        distinct: ['category'],
      }),
      this.prisma.networkLink.aggregate({
        where: base,
        _min: { basePrice: true, latencyMs: true, capacityMbps: true },
        _max: { basePrice: true, latencyMs: true, capacityMbps: true },
      }),
    ]);
    return {
      operators,
      cities: [...new Set(cities.flatMap((c) => [c.originName, c.destinationName]))].sort(),
      categories: categories.map((c) => c.category).sort(),
      ranges: {
        price: { min: Number(ranges._min.basePrice ?? 0), max: Number(ranges._max.basePrice ?? 0) },
        latencyMs: { min: ranges._min.latencyMs ?? 0, max: ranges._max.latencyMs ?? 0 },
        capacityMbps: { min: ranges._min.capacityMbps ?? 0, max: ranges._max.capacityMbps ?? 0 },
      },
    };
  }

  async detail(user: AuthUser, id: string) {
    const link = await this.prisma.networkLink.findFirst({
      where: {
        id,
        deletedAt: null,
        status: 'ACTIVE',
        operatorProfile: { approvalStatus: 'APPROVED' },
      },
      include: {
        operatorProfile: { select: { id: true, displayName: true, slug: true, description: true } },
        metrics: { orderBy: { recordedAt: 'desc' }, take: 60 },
      },
    });
    if (!link) throw new NotFoundException();
    const rules = await this.prisma.pricingRule.findMany({
      where: { operatorProfileId: link.operatorProfileId, isActive: true },
    });
    const { metrics, operatorProfile, ...rest } = link;
    this.interactions.track(user, 'VIEW', { link });
    return {
      ...this.serialize(rest),
      operator: operatorProfile,
      performance: await this.perf.forLink(user, id),
      hasGeometry: !!link.geospatialDataId,
      metrics: metrics.reverse().map((m) => ({
        at: m.recordedAt,
        latencyMs: m.latencyMs,
        availableMbps: m.availableMbps,
        utilizationPct: m.utilizationPct,
      })),
      priceTiers: [1, 12, 24, 36].map((t) => this.pricing.compute(link, rules, { termMonths: t })),
    };
  }

  async quote(id: string, termMonths: number, requestedMbps?: number) {
    // Draft or unapproved links must not leak their price rules to other users.
    const link = await this.prisma.networkLink.findFirst({
      where: {
        id,
        deletedAt: null,
        status: 'ACTIVE',
        operatorProfile: { approvalStatus: 'APPROVED' },
      },
    });
    if (!link) throw new NotFoundException();
    const rules = await this.prisma.pricingRule.findMany({
      where: { operatorProfileId: link.operatorProfileId, isActive: true },
    });
    return this.pricing.compute(link, rules, { termMonths, requestedMbps });
  }

  async publicStats() {
    const [links, operators, availableLinks, routes] = await Promise.all([
      this.prisma.networkLink.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.operatorProfile.count({ where: { approvalStatus: 'APPROVED', deletedAt: null } }),
      this.prisma.networkLink.count({
        where: { deletedAt: null, status: 'ACTIVE', availability: 'AVAILABLE' },
      }),
      this.prisma.networkLink.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { originName: true, destinationName: true },
        distinct: ['originName', 'destinationName'],
      }),
    ]);
    return { links, operators, availableLinks, routes: routes.length };
  }
}

@Controller('links')
@UseGuards(AuthGuard)
@Perms('link:read')
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly perf: PerformanceService,
  ) {}

  @Get() search(@CurrentUser() u: AuthUser, @Query() q: SearchQuery) {
    return this.links.search(u, q);
  }

  @Get('facets') facets() {
    return this.links.facets();
  }

  @Get('performance') performance(
    @CurrentUser() u: AuthUser,
    @Query('ids') ids: string | string[] = '',
  ) {
    const list = (Array.isArray(ids) ? ids : [ids]).flatMap((s) => String(s).split(','));
    return this.perf.many(u, list.map((s) => s.trim()).filter(Boolean));
  }

  @Get(':id') detail(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.links.detail(u, id);
  }

  @Get(':id/quote')
  quote(@Param('id') id: string, @Query('termMonths') term?: string, @Query('mbps') mbps?: string) {
    return this.links.quote(id, num(term) ?? 12, num(mbps));
  }
}

@Controller('public')
export class PublicController {
  constructor(private readonly links: LinksService) {}

  @Get('stats') stats() {
    return this.links.publicStats();
  }
}

interface LinkBody {
  name?: { id?: string; en?: string };
  description?: { id?: string; en?: string };
  category?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
  availability?: 'AVAILABLE' | 'UNAVAILABLE';
  originName?: string;
  destinationName?: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  distanceKm?: number;
  capacityMbps?: number;
  availableMbps?: number;
  latencyMs?: number;
  slaPercent?: number;
  redundancyScore?: number;
  basePrice?: number;
  currency?: string;
}

interface RuleBody {
  name?: string;
  networkLinkId?: string | null;
  type?:
    | 'BASE_OVERRIDE'
    | 'VOLUME_DISCOUNT'
    | 'TERM_DISCOUNT'
    | 'CAPACITY_TIER'
    | 'SURCHARGE'
    | 'PROMOTION';
  conditions?: Record<string, number>;
  adjustment?: { mode?: string; value?: number };
  priority?: number;
  validFrom?: string | null;
  validUntil?: string | null;
  isActive?: boolean;
}

const MANUAL_FIELDS = [
  'category',
  'originName',
  'destinationName',
  'originLat',
  'originLng',
  'destinationLat',
  'destinationLng',
  'distanceKm',
  'capacityMbps',
  'availableMbps',
  'latencyMs',
  'slaPercent',
  'redundancyScore',
  'basePrice',
  'currency',
] as const;

const NUMBER_RANGES: Record<string, [number, number]> = {
  originLat: [-90, 90],
  destinationLat: [-90, 90],
  originLng: [-180, 180],
  destinationLng: [-180, 180],
  distanceKm: [0, 100_000],
  capacityMbps: [0, 1e9],
  availableMbps: [0, 1e9],
  latencyMs: [0, 100_000],
  slaPercent: [0, 100],
  redundancyScore: [0, 100],
  basePrice: [0, 1e12],
};

// LinkBody is an interface, so the ValidationPipe cannot check it: types and ranges are enforced here.
// Non-string names would otherwise crash every marketplace page that renders them.
function assertLinkBody(b: LinkBody) {
  const bad = () => new BadRequestException('Invalid link fields');
  const raw = b as unknown as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(NUMBER_RANGES)) {
    const v = raw[k];
    if (v !== undefined && v !== null && !(typeof v === 'number' && v >= lo && v <= hi))
      throw bad();
  }
  const limits: [string, number][] = [
    ['category', 64],
    ['originName', 120],
    ['destinationName', 120],
    ['currency', 8],
  ];
  for (const [k, max] of limits) {
    const v = raw[k];
    if (v !== undefined && (typeof v !== 'string' || v.length > max)) throw bad();
  }
  for (const k of ['name', 'description']) {
    const v = raw[k] as { id?: unknown; en?: unknown } | null | undefined;
    if (v === undefined) continue;
    if (typeof v !== 'object' || v === null) throw bad();
    for (const s of [v.id, v.en])
      if (s !== undefined && (typeof s !== 'string' || s.length > 2000)) throw bad();
  }
  if (b.status !== undefined && !['DRAFT', 'ACTIVE', 'INACTIVE', 'MAINTENANCE'].includes(b.status))
    throw bad();
  if (b.availability !== undefined && !['AVAILABLE', 'UNAVAILABLE'].includes(b.availability))
    throw bad();
}

@Controller('operator')
@UseGuards(AuthGuard)
export class OperatorLinksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operators: OperatorContext,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('overview')
  @Perms('link:write')
  async overview(@CurrentUser() u: AuthUser) {
    const op = await this.operators.get(u.sub);
    const [links, available, reservedItems, configs] = await Promise.all([
      this.prisma.networkLink.count({ where: { operatorProfileId: op.id, deletedAt: null } }),
      this.prisma.networkLink.count({
        where: { operatorProfileId: op.id, deletedAt: null, availability: 'AVAILABLE' },
      }),
      this.prisma.reservationItem.findMany({
        where: {
          networkLink: { operatorProfileId: op.id },
          reservation: { status: { in: ['AWAITING_PAYMENT', 'PAID', 'CONFIRMED'] } },
        },
        select: { lineTotal: true, reservation: { select: { status: true } } },
      }),
      this.prisma.dynamicApiConfig.count({ where: { operatorProfileId: op.id, isActive: true } }),
    ]);
    const revenue = reservedItems
      .filter((i) => ['PAID', 'CONFIRMED'].includes(i.reservation.status))
      .reduce((s, i) => s + Number(i.lineTotal), 0);
    return {
      profile: {
        id: op.id,
        displayName: op.displayName,
        approvalStatus: op.approvalStatus,
        rejectionReason: op.rejectionReason,
      },
      links,
      available,
      activeIntegrations: configs,
      pendingReservations: reservedItems.filter((i) => i.reservation.status === 'AWAITING_PAYMENT')
        .length,
      revenue,
    };
  }

  @Get('links')
  @Perms('link:write')
  async list(@CurrentUser() u: AuthUser) {
    const op = await this.operators.get(u.sub);
    const rows = await this.prisma.networkLink.findMany({
      where: { operatorProfileId: op.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    // API-managed prices are maintained through per-link override rules (see BulkPricingController).
    const overrides = await this.prisma.pricingRule.findMany({
      where: { operatorProfileId: op.id, isActive: true, name: { startsWith: 'price-override:' } },
    });
    const byLink = new Map(overrides.map((r) => [r.networkLinkId, r]));
    return rows.map((r) => {
      const base = r.basePrice === null ? null : Number(r.basePrice);
      const o = r.apiConfigId ? byLink.get(r.id) : undefined;
      return {
        ...r,
        basePrice: base,
        hasOverride: !!o,
        effectivePrice: o ? Number((o.adjustment as { value: number }).value) : base,
      };
    });
  }

  @Post('links')
  @Perms('link:write')
  async create(@CurrentUser() u: AuthUser, @Body() b: LinkBody) {
    const op = await this.operators.getApproved(u.sub);
    assertLinkBody(b);
    if (!b.originName?.trim() || !b.destinationName?.trim() || (!b.name?.id && !b.name?.en)) {
      throw new BadRequestException('name, originName and destinationName are required');
    }
    const row = await this.prisma.networkLink.create({
      data: {
        operatorProfileId: op.id,
        name: { id: b.name.id ?? b.name.en!, en: b.name.en ?? b.name.id! },
        description: b.description as Prisma.InputJsonValue | undefined,
        status: b.status ?? 'ACTIVE',
        availability: b.availability ?? 'AVAILABLE',
        category: (b.category ?? 'UNSPECIFIED').toUpperCase(),
        originName: b.originName.trim(),
        destinationName: b.destinationName.trim(),
        originLat: b.originLat,
        originLng: b.originLng,
        destinationLat: b.destinationLat,
        destinationLng: b.destinationLng,
        distanceKm: b.distanceKm,
        capacityMbps: b.capacityMbps,
        availableMbps: b.availableMbps ?? b.capacityMbps,
        latencyMs: b.latencyMs,
        slaPercent: b.slaPercent,
        redundancyScore: b.redundancyScore,
        basePrice: b.basePrice,
        currency: b.currency ?? op.defaultCurrency,
      },
    });
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'link.created',
      actorUserId: u.sub,
      operatorProfileId: op.id,
      networkLinkId: row.id,
      requestPayload: b,
    });
    return row;
  }

  @Patch('links/:id')
  @Perms('link:write')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LinkBody) {
    const op = await this.operators.getApproved(u.sub);
    assertLinkBody(b);
    const link = await this.prisma.networkLink.findFirst({
      where: { id, operatorProfileId: op.id, deletedAt: null },
    });
    if (!link) throw new NotFoundException();
    const data: Prisma.NetworkLinkUpdateInput = {};
    if (b.status) data.status = b.status;
    if (b.name) data.name = b.name as Prisma.InputJsonValue;
    if (b.description) data.description = b.description as Prisma.InputJsonValue;
    // API-managed links are owned by the sync; only manual links accept technical edits.
    if (!link.apiConfigId) {
      if (b.availability && link.availability !== 'LOCKED' && link.availability !== 'RESERVED')
        data.availability = b.availability;
      for (const f of MANUAL_FIELDS)
        if (b[f] !== undefined) (data as Record<string, unknown>)[f] = b[f];
    }
    const row = await this.prisma.networkLink.update({ where: { id }, data });
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'link.updated',
      actorUserId: u.sub,
      operatorProfileId: op.id,
      networkLinkId: id,
      requestPayload: b,
    });
    return row;
  }

  @Delete('links/:id')
  @Perms('link:write')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const op = await this.operators.getApproved(u.sub);
    const res = await this.prisma.networkLink.updateMany({
      where: { id, operatorProfileId: op.id, deletedAt: null },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'link.deleted',
      actorUserId: u.sub,
      operatorProfileId: op.id,
      networkLinkId: id,
    });
    return { ok: true };
  }

  @Get('pricing-rules')
  @Perms('pricing:manage')
  async rules(@CurrentUser() u: AuthUser) {
    const op = await this.operators.get(u.sub);
    return this.prisma.pricingRule.findMany({
      where: { operatorProfileId: op.id },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private ruleData(b: RuleBody): Prisma.PricingRuleUncheckedUpdateInput {
    if (b.adjustment) {
      if (
        !['PERCENT', 'FIXED', 'OVERRIDE'].includes(String(b.adjustment.mode)) ||
        typeof b.adjustment.value !== 'number'
      ) {
        throw new BadRequestException(
          'adjustment must be { mode: PERCENT|FIXED|OVERRIDE, value: number }',
        );
      }
    }
    return {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.type !== undefined && { type: b.type }),
      ...(b.networkLinkId !== undefined && { networkLinkId: b.networkLinkId }),
      ...(b.conditions !== undefined && { conditions: b.conditions }),
      ...(b.adjustment !== undefined && { adjustment: b.adjustment as Prisma.InputJsonValue }),
      ...(b.priority !== undefined && { priority: b.priority }),
      ...(b.validFrom !== undefined && { validFrom: b.validFrom ? new Date(b.validFrom) : null }),
      ...(b.validUntil !== undefined && {
        validUntil: b.validUntil ? new Date(b.validUntil) : null,
      }),
      ...(b.isActive !== undefined && { isActive: b.isActive }),
    };
  }

  @Post('pricing-rules')
  @Perms('pricing:manage')
  async createRule(@CurrentUser() u: AuthUser, @Body() b: RuleBody) {
    const op = await this.operators.getApproved(u.sub);
    if (!b.name || !b.type || !b.adjustment)
      throw new BadRequestException('name, type and adjustment are required');
    if (b.networkLinkId) {
      const own = await this.prisma.networkLink.findFirst({
        where: { id: b.networkLinkId, operatorProfileId: op.id },
      });
      if (!own) throw new BadRequestException('Unknown link');
    }
    const row = await this.prisma.pricingRule.create({
      data: {
        ...(this.ruleData(b) as Prisma.PricingRuleUncheckedCreateInput),
        operatorProfileId: op.id,
      } as Prisma.PricingRuleUncheckedCreateInput,
    });
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'pricing-rule.created',
      actorUserId: u.sub,
      operatorProfileId: op.id,
      entityType: 'PricingRule',
      entityId: row.id,
      requestPayload: b,
    });
    await this.announceRule(op, row);
    return row;
  }

  // Promotions and discounts are pushed to buyers who opted in (filters: cities, providers, min %).
  private async announceRule(
    op: { id: string; displayName: string },
    rule: Prisma.PricingRuleGetPayload<object>,
  ) {
    const adj = rule.adjustment as { mode?: string; value?: number };
    const isPromo = rule.type === 'PROMOTION';
    const isDiscount = ['TERM_DISCOUNT', 'VOLUME_DISCOUNT', 'CAPACITY_TIER'].includes(rule.type);
    if (!rule.isActive || (!isPromo && !isDiscount) || !(Number(adj?.value) < 0)) return;
    const link = rule.networkLinkId
      ? await this.prisma.networkLink.findUnique({
          where: { id: rule.networkLinkId },
          select: { id: true, originName: true, destinationName: true },
        })
      : null;
    const pct = adj.mode === 'PERCENT' ? Math.abs(Number(adj.value)) : undefined;
    const route = link ? ` (${link.originName} - ${link.destinationName})` : '';
    const off = pct !== undefined ? ` ${pct}%` : '';
    await this.notifications.notify({
      userIds: await this.notifications.audience('PENYEWA'),
      category: isPromo ? 'PROMO' : 'DISCOUNT',
      title: {
        id: `${isPromo ? 'Promo' : 'Diskon'}${off} dari ${op.displayName}${route}`,
        en: `${isPromo ? 'Promo' : 'Discount'}${off} from ${op.displayName}${route}`,
      },
      body: { id: rule.name, en: rule.name },
      href: link ? `/links/${link.id}` : `/marketplace?operatorId=${op.id}`,
      entityType: 'PricingRule',
      entityId: rule.id,
      dedupeKey: `rule:${rule.id}`,
      match: {
        operatorId: op.id,
        cities: link ? [link.originName, link.destinationName] : undefined,
        discountPct: pct,
      },
    });
  }

  @Patch('pricing-rules/:id')
  @Perms('pricing:manage')
  async updateRule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RuleBody) {
    const op = await this.operators.getApproved(u.sub);
    const res = await this.prisma.pricingRule.updateMany({
      where: { id, operatorProfileId: op.id },
      data: this.ruleData(b) as Prisma.PricingRuleUpdateManyMutationInput,
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'pricing-rule.updated',
      actorUserId: u.sub,
      operatorProfileId: op.id,
      entityType: 'PricingRule',
      entityId: id,
      requestPayload: b,
    });
    const updated = await this.prisma.pricingRule.findUniqueOrThrow({ where: { id } });
    await this.announceRule(op, updated);
    return updated;
  }

  @Delete('pricing-rules/:id')
  @Perms('pricing:manage')
  async deleteRule(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const op = await this.operators.getApproved(u.sub);
    const res = await this.prisma.pricingRule.deleteMany({
      where: { id, operatorProfileId: op.id },
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'pricing-rule.deleted',
      actorUserId: u.sub,
      operatorProfileId: op.id,
      entityType: 'PricingRule',
      entityId: id,
    });
    return { ok: true };
  }
}

@Module({
  imports: [InteractionsModule, QualityModule, NotificationsModule],
  controllers: [LinksController, PublicController, OperatorLinksController, BulkPricingController],
  providers: [LinksService, PricingService],
  exports: [PricingService],
})
export class LinksModule {}
