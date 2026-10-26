import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { PerformanceService, QualityModule } from '../quality/quality.module';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.module';

const MONTH = (d: Date) => d.toISOString().slice(0, 7);
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

export interface BillingAlert {
  code: 'BUDGET_EXCEEDED' | 'BUDGET_NEAR' | 'LOW_BALANCE' | 'RENTAL_EXPIRING';
  level: 'info' | 'warning' | 'critical';
  values: Record<string, number | string>;
}

interface ProfileBody {
  fullName?: string;
  phone?: string | null;
  locale?: 'ID' | 'EN';
  companyName?: string;
  taxId?: string | null;
  billingEmail?: string | null;
  monthlyBudget?: number | null;
  alertThresholdPct?: number | null;
}

type GeoFeature = {
  type: 'Feature';
  id: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

@Injectable()
export class BuyerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly perf: PerformanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private async profileFor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.prisma.buyerProfile.upsert({
      where: { userId },
      create: { userId, companyName: user.fullName },
      update: {},
    });
  }

  async balance(buyerProfileId: string) {
    const agg = await this.prisma.walletEntry.aggregate({
      where: { buyerProfileId },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  async rentals(user: AuthUser) {
    const items = await this.prisma.reservationItem.findMany({
      where: {
        lockStatus: 'CONFIRMED',
        reservation: { buyerUserId: user.sub, status: { in: ['PAID', 'CONFIRMED'] } },
      },
      include: {
        reservation: { select: { id: true, reference: true, createdAt: true, isDemo: true } },
        networkLink: {
          include: {
            operatorProfile: { select: { id: true, displayName: true } },
            geospatialData: { select: { geoJson: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const perf = await this.perf.many(
      user,
      items.map((i) => i.networkLinkId),
    );
    const now = Date.now();
    return items.map((i) => {
      const start = i.reservation.createdAt;
      const end = addMonths(start, i.termMonths);
      const l = i.networkLink;
      return {
        itemId: i.id,
        reservationId: i.reservation.id,
        reference: i.reservation.reference,
        isDemo: i.reservation.isDemo,
        startDate: start,
        endDate: end,
        active: end.getTime() > now,
        termMonths: i.termMonths,
        monthlyPrice: Number(i.unitPrice),
        currency: l.currency,
        link: {
          id: l.id,
          name: l.name,
          originName: l.originName,
          destinationName: l.destinationName,
          originLat: l.originLat,
          originLng: l.originLng,
          destinationLat: l.destinationLat,
          destinationLng: l.destinationLng,
          capacityMbps: l.capacityMbps,
          latencyMs: l.latencyMs,
          slaPercent: l.slaPercent,
          category: l.category,
          operator: l.operatorProfile,
        },
        performance: perf[l.id],
        geometry: this.geometry(l),
      };
    });
  }

  // KMZ route if the operator attached one, otherwise a straight A-Z line.
  private geometry(l: {
    id: string;
    geometryFeatureId: string | null;
    geospatialData: { geoJson: Prisma.JsonValue } | null;
    originLat: number | null;
    originLng: number | null;
    destinationLat: number | null;
    destinationLng: number | null;
  }): GeoFeature['geometry'] | null {
    const fc = l.geospatialData?.geoJson as unknown as { features?: GeoFeature[] } | null;
    const f = fc?.features?.find(
      (x) =>
        !l.geometryFeatureId ||
        String(x.id) === l.geometryFeatureId ||
        x.properties?.name === l.geometryFeatureId,
    );
    if (f?.geometry) return f.geometry;
    if ([l.originLat, l.originLng, l.destinationLat, l.destinationLng].some((v) => v === null))
      return null;
    return {
      type: 'LineString',
      coordinates: [
        [l.originLng, l.originLat],
        [l.destinationLng, l.destinationLat],
      ],
    };
  }

  async overview(user: AuthUser) {
    const profile = await this.profileFor(user.sub);
    const [account, balance, entries, rentals, cfg] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.sub },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          locale: true,
          createdAt: true,
        },
      }),
      this.balance(profile.id),
      this.prisma.walletEntry.findMany({
        where: { buyerProfileId: profile.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.rentals(user),
      this.settings.cfgMany([
        'billing.alertThresholdPct',
        'billing.lowBalanceMonths',
        'billing.expiryNoticeDays',
        'billing.projectionMonths',
        'billing.demoTopupEnabled',
      ]),
    ]);
    const active = rentals.filter((r) => r.active);
    const monthlyCharge = active.reduce((s, r) => s + r.monthlyPrice, 0);
    const budget = profile.monthlyBudget === null ? null : Number(profile.monthlyBudget);
    const threshold = profile.alertThresholdPct ?? cfg['billing.alertThresholdPct'];
    const usagePct = budget ? Math.round((monthlyCharge / budget) * 1000) / 10 : null;

    const alerts: BillingAlert[] = [];
    if (budget && usagePct !== null) {
      if (usagePct >= 100)
        alerts.push({
          code: 'BUDGET_EXCEEDED',
          level: 'critical',
          values: { usagePct, budget, monthlyCharge },
        });
      else if (usagePct >= threshold)
        alerts.push({
          code: 'BUDGET_NEAR',
          level: 'warning',
          values: { usagePct, threshold, budget },
        });
    }
    const needed = monthlyCharge * cfg['billing.lowBalanceMonths'];
    if (monthlyCharge > 0 && balance < needed)
      alerts.push({
        code: 'LOW_BALANCE',
        level: balance <= 0 ? 'critical' : 'warning',
        values: { balance, needed, months: cfg['billing.lowBalanceMonths'] },
      });
    const soon = Date.now() + cfg['billing.expiryNoticeDays'] * 86400_000;
    for (const r of active.filter((x) => x.endDate.getTime() <= soon))
      alerts.push({
        code: 'RENTAL_EXPIRING',
        level: 'info',
        values: {
          reference: r.reference,
          route: `${r.link.originName} - ${r.link.destinationName}`,
          endDate: r.endDate.toISOString(),
        },
      });
    await this.raiseAlerts(user.sub, alerts);

    // Forward view of recurring charges, honouring each rental's end date.
    const projection: { month: string; amount: number }[] = [];
    const now = new Date();
    for (let m = 0; m < cfg['billing.projectionMonths']; m++) {
      const at = addMonths(now, m);
      projection.push({
        month: MONTH(at),
        amount: active
          .filter((r) => r.endDate.getTime() > at.getTime())
          .reduce((s, r) => s + r.monthlyPrice, 0),
      });
    }

    const features: GeoFeature[] = rentals
      .filter((r) => r.geometry)
      .map((r) => ({
        type: 'Feature',
        id: r.itemId,
        geometry: r.geometry!,
        properties: {
          linkId: r.link.id,
          name: `${r.link.originName} - ${r.link.destinationName}`,
          active: r.active,
          score: (r.performance as { score?: number } | undefined)?.score ?? null,
        },
      }));

    return {
      account,
      profile: {
        ...profile,
        monthlyBudget: budget,
        alertThresholdPct: profile.alertThresholdPct,
        effectiveThresholdPct: threshold,
      },
      wallet: {
        balance,
        currency: profile.defaultCurrency,
        demoTopupEnabled: cfg['billing.demoTopupEnabled'],
        entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })),
      },
      billing: { monthlyCharge, budget, usagePct, thresholdPct: threshold, alerts, projection },
      rentals: rentals.map(({ geometry: _g, ...r }) => r),
      map: { type: 'FeatureCollection', features },
    };
  }

  // One in-app notification per alert code per month (dedupe key), respecting the user's preferences.
  private async raiseAlerts(userId: string, alerts: BillingAlert[]) {
    const month = MONTH(new Date());
    const titles: Record<BillingAlert['code'], { id: string; en: string }> = {
      BUDGET_EXCEEDED: {
        id: 'Tagihan bulanan melebihi anggaran',
        en: 'Monthly charges exceed your budget',
      },
      BUDGET_NEAR: {
        id: 'Tagihan bulanan mendekati anggaran',
        en: 'Monthly charges are close to your budget',
      },
      LOW_BALANCE: {
        id: 'Saldo tidak cukup untuk tagihan berikutnya',
        en: 'Balance is too low for upcoming charges',
      },
      RENTAL_EXPIRING: {
        id: 'Masa sewa link segera berakhir',
        en: 'A link rental is about to expire',
      },
    };
    for (const a of alerts) {
      await this.notifications.notify({
        userIds: [userId],
        category: 'BILLING_ALERT',
        title: titles[a.code],
        href: '/profile',
        dedupeKey: `billing:${a.code}:${a.values.reference ?? ''}:${month}`,
      });
    }
  }

  async update(user: AuthUser, b: ProfileBody) {
    const profile = await this.profileFor(user.sub);
    const str = (v: unknown, max: number, nullable = true) =>
      v === undefined ||
      (nullable && v === null) ||
      (typeof v === 'string' && v.trim().length <= max);
    if (
      !str(b.fullName, 120, false) ||
      !str(b.phone, 32) ||
      !str(b.companyName, 160, false) ||
      !str(b.taxId, 40) ||
      !str(b.billingEmail, 160) ||
      (b.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.billingEmail)) ||
      (b.locale !== undefined && !['ID', 'EN'].includes(b.locale)) ||
      (b.monthlyBudget !== undefined &&
        b.monthlyBudget !== null &&
        !(typeof b.monthlyBudget === 'number' && b.monthlyBudget > 0 && b.monthlyBudget <= 1e13)) ||
      (b.alertThresholdPct !== undefined &&
        b.alertThresholdPct !== null &&
        !(
          Number.isInteger(b.alertThresholdPct) &&
          b.alertThresholdPct >= 1 &&
          b.alertThresholdPct <= 200
        ))
    )
      throw new BadRequestException({ code: 'INVALID_PROFILE', message: 'invalid field' });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.sub },
        data: {
          ...(b.fullName && { fullName: b.fullName.trim() }),
          ...(b.phone !== undefined && { phone: b.phone?.trim() || null }),
          ...(b.locale && { locale: b.locale }),
        },
      }),
      this.prisma.buyerProfile.update({
        where: { id: profile.id },
        data: {
          ...(b.companyName && { companyName: b.companyName.trim() }),
          ...(b.taxId !== undefined && { taxId: b.taxId?.trim() || null }),
          ...(b.billingEmail !== undefined && { billingEmail: b.billingEmail?.trim() || null }),
          ...(b.monthlyBudget !== undefined && { monthlyBudget: b.monthlyBudget }),
          ...(b.alertThresholdPct !== undefined && { alertThresholdPct: b.alertThresholdPct }),
        },
      }),
    ]);
    await this.ledger.appendSafe({
      eventType: 'PROFILE',
      status: 'SUCCESS',
      action: 'buyer.profile.updated',
      actorUserId: user.sub,
      entityType: 'BuyerProfile',
      entityId: profile.id,
      requestPayload: b,
    });
    return this.overview(user);
  }

  // Demo/sandbox top-up. A production deployment disables it (billing.demoTopupEnabled=false)
  // and credits the wallet from a payment-gateway webhook instead.
  async topup(user: AuthUser, amount: unknown) {
    const [enabled, max] = await Promise.all([
      this.settings.cfg<boolean>('billing.demoTopupEnabled'),
      this.settings.cfg<number>('billing.maxTopupAmount'),
    ]);
    if (!enabled)
      throw new ForbiddenException({ code: 'TOPUP_DISABLED', message: 'Top-up is disabled' });
    if (typeof amount !== 'number' || !(amount > 0) || amount > max)
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'invalid amount' });
    const profile = await this.profileFor(user.sub);
    const row = await this.prisma.walletEntry.create({
      data: {
        buyerProfileId: profile.id,
        type: 'TOPUP',
        amount: Math.round(amount * 100) / 100,
        currency: profile.defaultCurrency,
        reference: `TOPUP-${Date.now()}`,
        description: { id: 'Isi saldo (demo)', en: 'Balance top-up (demo)' },
        createdById: user.sub,
        isDemo: true,
      },
    });
    await this.ledger.appendSafe({
      eventType: 'WALLET',
      status: 'SUCCESS',
      action: 'wallet.topup',
      actorUserId: user.sub,
      entityType: 'WalletEntry',
      entityId: row.id,
      amount: row.amount,
      currency: row.currency,
    });
    return { balance: await this.balance(profile.id) };
  }

  async entries(user: AuthUser, page: number) {
    const profile = await this.profileFor(user.sub);
    const take = 50;
    const [total, rows] = await Promise.all([
      this.prisma.walletEntry.count({ where: { buyerProfileId: profile.id } }),
      this.prisma.walletEntry.findMany({
        where: { buyerProfileId: profile.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
    ]);
    return { total, page, items: rows.map((e) => ({ ...e, amount: Number(e.amount) })) };
  }
}

@Controller('profile')
@UseGuards(AuthGuard)
@Perms('reservation:create')
export class BuyerProfileController {
  constructor(private readonly svc: BuyerProfileService) {}

  @Get('buyer')
  overview(@CurrentUser() u: AuthUser) {
    return this.svc.overview(u);
  }

  @Patch('buyer')
  update(@CurrentUser() u: AuthUser, @Body() b: ProfileBody) {
    return this.svc.update(u, b ?? {});
  }

  @Get('wallet')
  wallet(@CurrentUser() u: AuthUser, @Query('page') page?: string) {
    return this.svc.entries(u, Math.max(1, Number(page) || 1));
  }

  @Post('wallet/topup')
  topup(@CurrentUser() u: AuthUser, @Body() b: { amount?: unknown }) {
    return this.svc.topup(u, b?.amount);
  }
}

@Module({
  imports: [QualityModule, NotificationsModule],
  controllers: [BuyerProfileController],
  providers: [BuyerProfileService],
})
export class ProfileModule {}
