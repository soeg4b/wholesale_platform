import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';

const MONTH = (d: Date) => d.toISOString().slice(0, 7);

interface Tier {
  key: string;
  name: { id: string; en: string };
  minIncome: number;
  minRating: number;
  benefits: { id: string; en: string }[];
}

interface ProviderBody {
  displayName?: string;
  description?: { id?: string; en?: string };
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
}

@Injectable()
export class ProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly operators: OperatorContext,
  ) {}

  private async reviewStats(operatorProfileId: string) {
    const rows = await this.prisma.operatorReview.findMany({
      where: { operatorProfileId },
      include: {
        buyer: { select: { fullName: true, buyerProfile: { select: { companyName: true } } } },
        networkLink: { select: { originName: true, destinationName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const distribution = [1, 2, 3, 4, 5].map((s) => ({
      rating: s,
      count: rows.filter((r) => r.rating === s).length,
    }));
    const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : null;
    return {
      average: avg === null ? null : Math.round(avg * 10) / 10,
      count: rows.length,
      distribution,
      latest: rows.slice(0, 10).map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        reply: r.reply,
        repliedAt: r.repliedAt,
        createdAt: r.createdAt,
        isDemo: r.isDemo,
        company: r.buyer.buyerProfile?.companyName ?? r.buyer.fullName,
        route: r.networkLink
          ? `${r.networkLink.originName} - ${r.networkLink.destinationName}`
          : null,
      })),
    };
  }

  private tierFor(tiers: Tier[], income12m: number, rating: number | null) {
    const sorted = [...tiers].sort((a, b) => a.minIncome - b.minIncome);
    let idx = 0;
    sorted.forEach((t, i) => {
      if (income12m >= t.minIncome && (rating ?? 0) >= t.minRating) idx = i;
    });
    const current = sorted[idx] ?? null;
    const next = sorted[idx + 1] ?? null;
    return {
      current,
      next,
      progressPct: next
        ? Math.min(100, Math.round((income12m / Math.max(1, next.minIncome)) * 100))
        : 100,
      missing: next
        ? {
            income: Math.max(0, next.minIncome - income12m),
            rating: Math.max(0, Math.round((next.minRating - (rating ?? 0)) * 10) / 10),
          }
        : null,
      all: sorted,
    };
  }

  async profile(user: AuthUser) {
    const op = await this.operators.get(user.sub);
    const [months, tiers] = await Promise.all([
      this.settings.cfg<number>('provider.trendMonths'),
      this.settings.cfg<Tier[]>('provider.tiers'),
    ]);
    const items = await this.prisma.reservationItem.findMany({
      where: {
        networkLink: { operatorProfileId: op.id },
        reservation: { status: { in: ['PAID', 'CONFIRMED'] } },
      },
      include: {
        reservation: { select: { createdAt: true, buyerUserId: true, isDemo: true } },
        networkLink: { select: { id: true, originName: true, destinationName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const now = new Date();
    const yearAgo = now.getTime() - 365 * 86400_000;
    const total = items.reduce((s, i) => s + Number(i.lineTotal), 0);
    const last30 = items
      .filter((i) => i.reservation.createdAt.getTime() >= now.getTime() - 30 * 86400_000)
      .reduce((s, i) => s + Number(i.lineTotal), 0);
    const income12m = items
      .filter((i) => i.reservation.createdAt.getTime() >= yearAgo)
      .reduce((s, i) => s + Number(i.lineTotal), 0);
    const recurring = items
      .filter((i) => {
        const end = new Date(i.reservation.createdAt);
        end.setUTCMonth(end.getUTCMonth() + i.termMonths);
        return end > now;
      })
      .reduce((s, i) => s + Number(i.unitPrice), 0);

    // Month buckets: income, distinct/new/returning customers.
    const firstSeen = new Map<string, string>();
    for (const i of items) {
      const m = MONTH(i.reservation.createdAt);
      if (!firstSeen.has(i.reservation.buyerUserId)) firstSeen.set(i.reservation.buyerUserId, m);
    }
    const trend: {
      month: string;
      income: number;
      customers: number;
      newCustomers: number;
      returningCustomers: number;
      orders: number;
    }[] = [];
    for (let k = months - 1; k >= 0; k--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      const m = MONTH(d);
      const inMonth = items.filter((i) => MONTH(i.reservation.createdAt) === m);
      const buyers = new Set(inMonth.map((i) => i.reservation.buyerUserId));
      const fresh = [...buyers].filter((b) => firstSeen.get(b) === m).length;
      trend.push({
        month: m,
        income: inMonth.reduce((s, i) => s + Number(i.lineTotal), 0),
        customers: buyers.size,
        newCustomers: fresh,
        returningCustomers: buyers.size - fresh,
        orders: new Set(inMonth.map((i) => i.reservationId)).size,
      });
    }
    const routes = new Map<string, { route: string; income: number; orders: number }>();
    for (const i of items) {
      const key = i.networkLink.id;
      const r = routes.get(key) ?? {
        route: `${i.networkLink.originName} - ${i.networkLink.destinationName}`,
        income: 0,
        orders: 0,
      };
      r.income += Number(i.lineTotal);
      r.orders += 1;
      routes.set(key, r);
    }

    const [
      linkGroups,
      availGroups,
      configs,
      geoFiles,
      rules,
      addOns,
      prebuild,
      responses,
      openTickets,
      reviews,
    ] = await Promise.all([
      this.prisma.networkLink.groupBy({
        by: ['status'],
        where: { operatorProfileId: op.id, deletedAt: null },
        _count: true,
      }),
      this.prisma.networkLink.groupBy({
        by: ['availability'],
        where: { operatorProfileId: op.id, deletedAt: null, status: 'ACTIVE' },
        _count: true,
      }),
      this.prisma.dynamicApiConfig.findMany({
        where: { operatorProfileId: op.id },
        select: { status: true, isActive: true },
      }),
      this.prisma.geospatialData.count({
        where: { operatorProfileId: op.id, parseStatus: 'PARSED' },
      }),
      this.prisma.pricingRule.count({ where: { operatorProfileId: op.id, isActive: true } }),
      this.prisma.addOnService.count({
        where: { operatorProfileId: op.id, deletedAt: null, isActive: true },
      }),
      this.prisma.prebuildProduct.findMany({
        where: { operatorProfileId: op.id, deletedAt: null },
        select: { status: true, progressPct: true },
      }),
      this.prisma.linkRequestResponse.count({ where: { operatorProfileId: op.id } }),
      this.prisma.linkTicket.count({
        where: {
          operatorProfileId: op.id,
          status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] },
        },
      }),
      this.reviewStats(op.id),
    ]);
    const linkCount = linkGroups.reduce((s, g) => s + g._count, 0);
    const checklist = [
      { key: 'approved', done: op.approvalStatus === 'APPROVED' },
      { key: 'profile', done: !!(op.description && op.contactEmail && op.contactPhone) },
      { key: 'link', done: linkCount > 0 },
      { key: 'integration', done: configs.some((c) => c.isActive) },
      { key: 'kmz', done: geoFiles > 0 },
      { key: 'pricing', done: rules > 0 },
      { key: 'addon', done: addOns > 0 },
      { key: 'prebuild', done: prebuild.length > 0 },
    ];
    const tier = this.tierFor(tiers, income12m, reviews.average);
    return {
      profile: {
        id: op.id,
        slug: op.slug,
        displayName: op.displayName,
        legalName: op.legalName,
        description: op.description,
        contactEmail: op.contactEmail,
        contactPhone: op.contactPhone,
        website: op.website,
        logoUrl: op.logoUrl,
        approvalStatus: op.approvalStatus,
        rejectionReason: op.rejectionReason,
        createdAt: op.createdAt,
        currency: op.defaultCurrency,
      },
      income: {
        total,
        last30Days: last30,
        last12Months: income12m,
        recurringMonthly: recurring,
        includesDemo: items.some((i) => i.reservation.isDemo),
      },
      trend,
      topRoutes: [...routes.values()].sort((a, b) => b.income - a.income).slice(0, 5),
      progress: {
        checklist,
        completionPct: Math.round(
          (checklist.filter((c) => c.done).length / checklist.length) * 100,
        ),
        linksByStatus: Object.fromEntries(linkGroups.map((g) => [g.status, g._count])),
        activeByAvailability: Object.fromEntries(
          availGroups.map((g) => [g.availability, g._count]),
        ),
        integrations: {
          active: configs.filter((c) => c.isActive && c.status === 'ACTIVE').length,
          error: configs.filter((c) => c.status === 'ERROR').length,
          total: configs.length,
        },
        kmzFiles: geoFiles,
        pricingRules: rules,
        addOns,
        prebuild: {
          total: prebuild.length,
          byStatus: prebuild.reduce<Record<string, number>>((acc, p) => {
            acc[p.status] = (acc[p.status] ?? 0) + 1;
            return acc;
          }, {}),
          avgProgressPct: prebuild.length
            ? Math.round(prebuild.reduce((s, p) => s + p.progressPct, 0) / prebuild.length)
            : null,
        },
        requestResponses: responses,
        openTickets,
      },
      reviews,
      tier,
    };
  }

  async update(user: AuthUser, b: ProviderBody) {
    const op = await this.operators.get(user.sub);
    const str = (v: unknown, max: number) =>
      v === undefined || v === null || (typeof v === 'string' && v.length <= max);
    const url = (v: unknown) =>
      v === undefined ||
      v === null ||
      v === '' ||
      (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 300);
    const desc = b.description;
    if (
      (b.displayName !== undefined &&
        !(
          typeof b.displayName === 'string' &&
          b.displayName.trim().length >= 2 &&
          b.displayName.length <= 120
        )) ||
      !str(b.contactPhone, 32) ||
      !str(b.contactEmail, 160) ||
      (b.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.contactEmail)) ||
      !url(b.website) ||
      !url(b.logoUrl) ||
      (desc !== undefined &&
        (typeof desc !== 'object' || desc === null || !str(desc.id, 2000) || !str(desc.en, 2000)))
    )
      throw new BadRequestException({ code: 'INVALID_PROFILE', message: 'invalid field' });
    await this.prisma.operatorProfile.update({
      where: { id: op.id },
      data: {
        ...(b.displayName && { displayName: b.displayName.trim() }),
        ...(desc && { description: { id: desc.id?.trim() ?? '', en: desc.en?.trim() ?? '' } }),
        ...(b.contactEmail !== undefined && { contactEmail: b.contactEmail || null }),
        ...(b.contactPhone !== undefined && { contactPhone: b.contactPhone || null }),
        ...(b.website !== undefined && { website: b.website || null }),
        ...(b.logoUrl !== undefined && { logoUrl: b.logoUrl || null }),
      },
    });
    await this.ledger.appendSafe({
      eventType: 'PROFILE',
      status: 'SUCCESS',
      action: 'operator.profile.updated',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'OperatorProfile',
      entityId: op.id,
      requestPayload: b,
    });
    return this.profile(user);
  }

  async publicProfile(id: string) {
    const op = await this.prisma.operatorProfile.findFirst({
      where: { id, approvalStatus: 'APPROVED', deletedAt: null },
    });
    if (!op) throw new NotFoundException();
    const [links, prebuild, reviews, tiers, income] = await Promise.all([
      this.prisma.networkLink.findMany({
        where: { operatorProfileId: id, deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          originName: true,
          destinationName: true,
          category: true,
          capacityMbps: true,
        },
      }),
      this.prisma.prebuildProduct.count({
        where: {
          operatorProfileId: id,
          deletedAt: null,
          status: { in: ['PLANNED', 'BUILDING', 'READY'] },
          convertedLinkId: null,
        },
      }),
      this.reviewStats(id),
      this.settings.cfg<Tier[]>('provider.tiers'),
      this.prisma.reservationItem.aggregate({
        where: {
          networkLink: { operatorProfileId: id },
          reservation: {
            status: { in: ['PAID', 'CONFIRMED'] },
            createdAt: { gte: new Date(Date.now() - 365 * 86400_000) },
          },
        },
        _sum: { lineTotal: true },
      }),
    ]);
    const tier = this.tierFor(tiers, Number(income._sum.lineTotal ?? 0), reviews.average).current;
    return {
      id: op.id,
      displayName: op.displayName,
      description: op.description,
      website: op.website,
      logoUrl: op.logoUrl,
      memberSince: op.createdAt,
      tier: tier ? { key: tier.key, name: tier.name } : null,
      links,
      prebuildProducts: prebuild,
      // Reviewer identities stay private on the public page.
      reviews: {
        ...reviews,
        latest: reviews.latest.map((r) => ({ ...r, company: `${r.company.slice(0, 1)}***` })),
      },
    };
  }

  async createReview(
    user: AuthUser,
    b: { reservationId?: string; operatorProfileId?: string; rating?: number; comment?: string },
  ) {
    if (
      typeof b?.reservationId !== 'string' ||
      !Number.isInteger(b.rating) ||
      b.rating! < 1 ||
      b.rating! > 5 ||
      (b.comment !== undefined && (typeof b.comment !== 'string' || b.comment.length > 2000))
    )
      throw new BadRequestException({ code: 'INVALID_REVIEW', message: 'invalid field' });
    const r = await this.prisma.reservation.findFirst({
      where: { id: b.reservationId, buyerUserId: user.sub, status: 'CONFIRMED' },
      include: {
        items: { include: { networkLink: { select: { id: true, operatorProfileId: true } } } },
      },
    });
    if (!r) throw new NotFoundException();
    const ops = [...new Set(r.items.map((i) => i.networkLink.operatorProfileId))];
    const opId = b.operatorProfileId ?? (ops.length === 1 ? ops[0] : undefined);
    if (!opId || !ops.includes(opId))
      throw new BadRequestException({
        code: 'INVALID_REVIEW',
        message: 'operatorProfileId required',
      });
    try {
      const row = await this.prisma.operatorReview.create({
        data: {
          operatorProfileId: opId,
          reservationId: r.id,
          networkLinkId: r.items.find((i) => i.networkLink.operatorProfileId === opId)?.networkLink
            .id,
          buyerUserId: user.sub,
          rating: b.rating!,
          comment: b.comment?.trim() || null,
        },
      });
      await this.ledger.appendSafe({
        eventType: 'REVIEW',
        status: 'SUCCESS',
        action: 'review.created',
        actorUserId: user.sub,
        operatorProfileId: opId,
        reservationId: r.id,
        entityType: 'OperatorReview',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'already reviewed' });
      throw e;
    }
  }

  async myReviews(user: AuthUser) {
    return this.prisma.operatorReview.findMany({
      where: { buyerUserId: user.sub },
      select: {
        id: true,
        reservationId: true,
        operatorProfileId: true,
        rating: true,
        comment: true,
        reply: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reply(user: AuthUser, id: string, reply: unknown) {
    const op = await this.operators.getApproved(user.sub);
    if (typeof reply !== 'string' || !reply.trim() || reply.length > 2000)
      throw new BadRequestException({ code: 'INVALID_REVIEW', message: 'invalid reply' });
    const res = await this.prisma.operatorReview.updateMany({
      where: { id, operatorProfileId: op.id },
      data: { reply: reply.trim(), repliedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'REVIEW',
      status: 'SUCCESS',
      action: 'review.replied',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'OperatorReview',
      entityId: id,
    });
    return { ok: true };
  }
}

@Controller()
@UseGuards(AuthGuard)
export class ProviderController {
  constructor(private readonly svc: ProviderService) {}

  @Get('provider/profile')
  @Perms('link:write')
  profile(@CurrentUser() u: AuthUser) {
    return this.svc.profile(u);
  }

  @Patch('provider/profile')
  @Perms('link:write')
  update(@CurrentUser() u: AuthUser, @Body() b: ProviderBody) {
    return this.svc.update(u, b ?? {});
  }

  @Get('providers/:id')
  @Perms('link:read')
  public(@Param('id') id: string) {
    return this.svc.publicProfile(id);
  }

  @Post('reviews')
  @Perms('review:create')
  review(
    @CurrentUser() u: AuthUser,
    @Body()
    b: { reservationId?: string; operatorProfileId?: string; rating?: number; comment?: string },
  ) {
    return this.svc.createReview(u, b);
  }

  @Get('reviews/mine')
  @Perms('review:create')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.myReviews(u);
  }

  @Post('operator/reviews/:id/reply')
  @Perms('link:write')
  reply(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { reply?: unknown }) {
    return this.svc.reply(u, id, b?.reply);
  }
}

@Module({ controllers: [ProviderController], providers: [ProviderService] })
export class ProviderModule {}
