import {
  Body,
  Controller,
  Get,
  HttpException,
  Injectable,
  Module,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { routeKeyOf } from '../common/nodes';
import { AiModule, AiService } from '../ai/ai.module';
import { InteractionsModule, InteractionsService } from '../interactions/interactions.module';
import { PerformanceService, QualityModule } from '../quality/quality.module';

type Bi = { id: string; en: string };
type Severity = 'info' | 'warn' | 'high';
export interface InsightItem {
  code: string;
  severity: Severity;
  linkId?: string;
  linkName?: string;
  params: Record<string, unknown>;
  text: Bi;
  evidence: Record<string, unknown>;
}
type Section =
  | { insufficient: true; needed: number; have: number }
  | { insufficient?: false; items: InsightItem[] };

const KIND_LABEL: Record<string, Bi> = {
  REDUNDANCY: { id: 'Jalur cadangan (redundansi)', en: 'Backup path (redundancy)' },
  CAPACITY_UPGRADE: { id: 'Upgrade kapasitas', en: 'Capacity upgrade' },
  MONITORING: { id: 'Monitoring proaktif', en: 'Proactive monitoring' },
  PREMIUM_SLA: { id: 'SLA premium', en: 'Premium SLA' },
  DDOS_PROTECTION: { id: 'Proteksi DDoS', en: 'DDoS protection' },
  MANAGED_SERVICE: { id: 'Layanan terkelola', en: 'Managed service' },
  OTHER: { id: 'Layanan tambahan', en: 'Additional service' },
};

const fmt = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined ? '-' : String(Math.round(n * 10 ** d) / 10 ** d);

// Bilingual text per insight code; numbers come from the facts, never from an LLM.
const TEXT: Record<string, (p: any) => Bi> = {
  TOP_SEARCHED: (p) => ({
    id: `Rute ${p.route} dicari ${p.searches} kali dalam ${p.days} hari terakhir.`,
    en: `Route ${p.route} was searched ${p.searches} times in the last ${p.days} days.`,
  }),
  BEST_SELLING: (p) => ({
    id: `${p.link} laris: ${p.sold} reservasi/penyewaan dalam ${p.days} hari.`,
    en: `${p.link} is selling well: ${p.sold} reservations/rentals in ${p.days} days.`,
  }),
  RISING: (p) => ({
    id: `Permintaan ${p.link} naik ${p.trendPct}% dibanding periode sebelumnya (${p.events} aktivitas).`,
    en: `Demand for ${p.link} is up ${p.trendPct}% versus the previous period (${p.events} events).`,
  }),
  CONGESTION: (p) => ({
    id: `${p.link}: utilisasi ${fmt(p.utilPct)}% (${p.level === 'HIGH' ? 'tinggi' : 'waspada'})${p.daysToSaturation !== undefined ? `; indikasi penuh dalam ~${p.daysToSaturation} hari` : ''}.`,
    en: `${p.link}: utilisation ${fmt(p.utilPct)}% (${p.level === 'HIGH' ? 'high' : 'warning'})${p.daysToSaturation !== undefined ? `; indicative saturation in ~${p.daysToSaturation} days` : ''}.`,
  }),
  UNMET_DEMAND: (p) => ({
    id: `Rute ${p.route} dicari ${p.searches} kali tetapi tidak ada kapasitas tersedia; pertimbangkan menambah kapasitas.`,
    en: `Route ${p.route} was searched ${p.searches} times but no capacity is available; consider adding capacity.`,
  }),
  ADDON_OPPORTUNITY: (p) => {
    const k = KIND_LABEL[p.kind] ?? KIND_LABEL.OTHER;
    return p.action === 'LIST_ADDON'
      ? {
          id: `Tawarkan "${p.catalogName}" ke ${p.renterCount} penyewa pada ${p.links}.`,
          en: `Offer "${p.catalogName}" to ${p.renterCount} renters on ${p.links}.`,
        }
      : {
          id: `Buat add-on ${k.id} di katalog: ${p.renterCount} penyewa pada ${p.links} memenuhi kriteria.`,
          en: `Create a ${k.en} add-on in your catalog: ${p.renterCount} renters on ${p.links} match the criteria.`,
        };
  },
  LOW_UPTIME: (p) => ({
    id: `${p.link}: uptime terukur ${fmt(p.uptimePct, 2)}% di bawah target SLA ${p.slaTargetPct}%.`,
    en: `${p.link}: measured uptime ${fmt(p.uptimePct, 2)}% is below the ${p.slaTargetPct}% SLA target.`,
  }),
  LATENCY_UNSTABLE: (p) => ({
    id: `${p.link}: latensi tidak stabil (P50 ${fmt(p.p50)} ms, P95 ${fmt(p.p95)} ms). Periksa jalur/peralatan.`,
    en: `${p.link}: latency is unstable (P50 ${fmt(p.p50)} ms, P95 ${fmt(p.p95)} ms). Review the path/equipment.`,
  }),
  SLA_BREACHES: (p) => ({
    id: `${p.link}: ${p.ratePct}% tiket melanggar SLA respons/penyelesaian. Perkuat tim NOC.`,
    en: `${p.link}: ${p.ratePct}% of tickets breached response/resolution SLA. Strengthen NOC handling.`,
  }),
  LOW_SCORE: (p) => ({
    id: `${p.link}: skor performa ${p.score} rendah; ini menurunkan daya tarik di marketplace.`,
    en: `${p.link}: performance score ${p.score} is low, which hurts marketplace appeal.`,
  }),
  PRICE_OUTLIER: (p) => ({
    id: `${p.link}: harga per Gbps ${p.devPct > 0 ? `${p.devPct}% di atas` : `${Math.abs(p.devPct)}% di bawah`} median rute (${p.peers} link pembanding).${p.devPct > 0 ? ' Pertimbangkan promo atau peningkatan nilai.' : ' Ada ruang menaikkan harga.'}`,
    en: `${p.link}: price per Gbps is ${Math.abs(p.devPct)}% ${p.devPct > 0 ? 'above' : 'below'} the route median (${p.peers} peer links).${p.devPct > 0 ? ' Consider a promotion or more value.' : ' There is room to raise the price.'}`,
  }),
  STALE_SYNC: (p) => ({
    id: `${p.link}: data tidak tersinkron ${p.hours} jam. Periksa integrasi API.`,
    en: `${p.link}: data has not synced for ${p.hours} hours. Check the API integration.`,
  }),
  NO_KMZ: (p) => ({
    id: `${p.link}: belum ada rute KMZ; penyewa tidak bisa memeriksa jalur fisik.`,
    en: `${p.link}: no KMZ route uploaded; buyers cannot inspect the physical path.`,
  }),
  NO_TELEMETRY: (p) => ({
    id: `${p.link}: belum ada telemetri (loss/status); skor performa tidak dapat dihitung.`,
    en: `${p.link}: no telemetry (loss/status) reported, so no performance score can be computed.`,
  }),
};

const item = (
  code: string,
  severity: Severity,
  params: Record<string, unknown>,
  evidence: Record<string, unknown>,
  link?: { id: string; name: string },
): InsightItem => ({
  code,
  severity,
  linkId: link?.id,
  linkName: link?.name,
  params,
  text: TEXT[code](params),
  evidence,
});

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly operators: OperatorContext,
    private readonly interactions: InteractionsService,
    private readonly perf: PerformanceService,
    private readonly ai: AiService,
  ) {}

  private linkName(l: { name: unknown; originName: string; destinationName: string }) {
    const n = l.name as { en?: string } | null;
    return n?.en || `${l.originName} - ${l.destinationName}`;
  }

  async build(operatorProfileId: string) {
    const c = await this.settings.cfgMany([
      'insight.minEvidence',
      'insight.windowDays',
      'insight.minRentedLinks',
      'insight.priceDeviationPct',
      'insight.minPeers',
      'insight.addonRules',
      'insight.slaBreachRatePct',
      'insight.lowScore',
      'hot.windowDays',
      'hot.minTrendPct',
      'congestion.warnPct',
      'congestion.highPct',
      'congestion.sustainHours',
      'congestion.forecastDays',
      'congestion.minPoints',
      'congestion.minSlopePctPerDay',
      'congestion.horizonDays',
      'perf.latencyP95Tolerance',
      'quality.staleSyncHours',
      'demo.countInMetrics',
    ]);
    const minEv: number = c['insight.minEvidence'];
    const days: number = c['hot.windowDays'];
    const includeDemo: boolean = c['demo.countInMetrics'];
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 86400_000);

    const links = await this.prisma.networkLink.findMany({
      where: { operatorProfileId, deletedAt: null, status: 'ACTIVE' },
    });
    const ids = links.map((l) => l.id);
    const nameOf = new Map(links.map((l) => [l.id, this.linkName(l)]));
    const demand = await this.interactions.stats();
    await this.perf.computeMany(ids);
    const perfRows = await this.prisma.linkPerformance.findMany({
      where: { networkLinkId: { in: ids } },
    });
    const perfOf = (id: string) => perfRows.find((p) => p.networkLinkId === id);

    // ---------- demand ----------
    const hotOf = new Map<string, Awaited<ReturnType<InteractionsService['hotInfo']>>>();
    for (const l of links) {
      hotOf.set(
        l.id,
        await this.interactions.hotInfo(
          demand.byLink.get(l.id),
          l.capacityMbps && l.availableMbps !== null
            ? (l.availableMbps / l.capacityMbps) * 100
            : null,
        ),
      );
    }
    const totalEvents = [...hotOf.values()].reduce((s, h) => s + h.events, 0);

    const routeKeys = [...new Set(links.map((l) => routeKeyOf(l.originName, l.destinationName)))];
    const topSearched: InsightItem[] = routeKeys
      .map((rk) => ({ rk, n: demand.byRoute.get(rk)?.SEARCH?.cur ?? 0 }))
      .filter((r) => r.n >= minEv)
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .map((r) =>
        item(
          'TOP_SEARCHED',
          'info',
          {
            route: r.rk
              .split('|')
              .map((s) => s.replace(/^./, (m) => m.toUpperCase()))
              .join(' - '),
            searches: r.n,
            days,
          },
          { n: r.n, windowDays: days },
        ),
      );

    const sold = await this.prisma.reservationItem.groupBy({
      by: ['networkLinkId'],
      where: {
        networkLinkId: { in: ids },
        createdAt: { gte: windowStart },
        reservation: { status: { in: ['PAID', 'CONFIRMED'] } },
      },
      _count: true,
    });
    const bestSelling = sold
      .filter((s) => s._count >= 1)
      .sort((a, b) => b._count - a._count)
      .slice(0, 5)
      .map((s) =>
        item(
          'BEST_SELLING',
          'info',
          { link: nameOf.get(s.networkLinkId), sold: s._count, days },
          { n: s._count, windowDays: days },
          { id: s.networkLinkId, name: nameOf.get(s.networkLinkId)! },
        ),
      );

    const rising = links
      .map((l) => ({ l, h: hotOf.get(l.id)! }))
      .filter((x) => x.h.events >= minEv && x.h.trendPct >= c['hot.minTrendPct'])
      .sort((a, b) => b.h.trendPct - a.h.trendPct)
      .slice(0, 5)
      .map((x) =>
        item(
          'RISING',
          x.h.hot ? 'warn' : 'info',
          { link: nameOf.get(x.l.id), trendPct: x.h.trendPct, events: x.h.events },
          { n: x.h.events, windowDays: days, hot: x.h.hot },
          { id: x.l.id, name: nameOf.get(x.l.id)! },
        ),
      );

    // ---------- congestion ----------
    const since = new Date(Date.now() - c['congestion.forecastDays'] * 86400_000);
    const snaps = await this.prisma.linkMetricSnapshot.findMany({
      where: {
        networkLinkId: { in: ids },
        recordedAt: { gte: since },
        utilizationPct: { not: null },
        ...(includeDemo ? {} : { isDemo: false }),
      },
      select: { networkLinkId: true, recordedAt: true, utilizationPct: true },
      orderBy: { recordedAt: 'asc' },
    });
    const congestion: InsightItem[] = [];
    for (const l of links) {
      if (l.capacityMbps === null || l.availableMbps === null) continue;
      const uNow = 100 * (1 - l.availableMbps / l.capacityMbps);
      const mine = snaps.filter((s) => s.networkLinkId === l.id);
      const sustainFrom = Date.now() - c['congestion.sustainHours'] * 3600_000;
      const recent = mine.filter((s) => s.recordedAt.getTime() >= sustainFrom);
      const sustained =
        recent.length >= 3 &&
        recent[recent.length - 1].recordedAt.getTime() - recent[0].recordedAt.getTime() >=
          0.8 * c['congestion.sustainHours'] * 3600_000 &&
        recent.every((s) => (s.utilizationPct as number) >= c['congestion.warnPct']);
      const daily = new Map<string, number[]>();
      for (const s of mine) {
        const k = s.recordedAt.toISOString().slice(0, 10);
        daily.set(k, [...(daily.get(k) ?? []), s.utilizationPct as number]);
      }
      const pts = [...daily.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
      let daysToSaturation: number | undefined;
      let r2: number | undefined;
      if (pts.length >= c['congestion.minPoints']) {
        const n = pts.length;
        const xs = pts.map((_, i) => i);
        const mx = (n - 1) / 2;
        const my = pts.reduce((a, b) => a + b, 0) / n;
        const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        const sxy = xs.reduce((a, x, i) => a + (x - mx) * (pts[i] - my), 0);
        const slope = sxy / sxx;
        const ssTot = pts.reduce((a, y) => a + (y - my) ** 2, 0) || 1;
        r2 = 1 - pts.reduce((a, y, i) => a + (y - (my + slope * (i - mx))) ** 2, 0) / ssTot;
        if (slope >= c['congestion.minSlopePctPerDay'] && uNow < 100) {
          const d = Math.ceil((100 - uNow) / slope);
          if (d <= c['congestion.horizonDays']) daysToSaturation = d;
        }
      }
      const level =
        uNow >= c['congestion.highPct']
          ? 'HIGH'
          : uNow >= c['congestion.warnPct'] || sustained
            ? 'WARN'
            : null;
      if (level || daysToSaturation !== undefined) {
        congestion.push(
          item(
            'CONGESTION',
            level === 'HIGH' ? 'high' : 'warn',
            { link: nameOf.get(l.id), utilPct: uNow, level: level ?? 'WARN', daysToSaturation },
            {
              utilPct: Math.round(uNow * 10) / 10,
              sustained,
              dailyPoints: pts.length,
              r2: r2 === undefined ? null : Math.round(r2 * 100) / 100,
              indicative: daysToSaturation !== undefined,
            },
            { id: l.id, name: nameOf.get(l.id)! },
          ),
        );
      }
    }

    // ---------- unmet demand ----------
    const myNodes = new Set(
      links.flatMap((l) => [
        l.originName.trim().toLowerCase(),
        l.destinationName.trim().toLowerCase(),
      ]),
    );
    const covered = new Set(
      links
        .filter((l) => l.availability === 'AVAILABLE')
        .map((l) => routeKeyOf(l.originName, l.destinationName)),
    );
    const unmet = (await this.interactions.unmetRoutes(days))
      .filter(
        (u) =>
          u.n >= minEv &&
          u.routeKey.split('|').some((n) => myNodes.has(n)) &&
          !covered.has(u.routeKey),
      )
      .slice(0, 5)
      .map((u) =>
        item(
          'UNMET_DEMAND',
          'warn',
          { route: u.routeKey.split('|').join(' - '), searches: u.n },
          { n: u.n, windowDays: days },
        ),
      );

    const demandSection = (items: InsightItem[]): Section =>
      totalEvents < minEv && !items.length
        ? { insufficient: true, needed: minEv, have: totalEvents }
        : { items };

    // ---------- add-on opportunities ----------
    const rentals = await this.prisma.reservationItem.findMany({
      where: { networkLinkId: { in: ids }, reservation: { status: { in: ['PAID', 'CONFIRMED'] } } },
      select: { networkLinkId: true, reservation: { select: { buyerUserId: true } } },
    });
    const rentedIds = [...new Set(rentals.map((r) => r.networkLinkId))];
    const catalog = await this.prisma.addOnService.findMany({
      where: { operatorProfileId, isActive: true, deletedAt: null },
    });
    let addOnSection: Section;
    if (rentedIds.length < c['insight.minRentedLinks']) {
      addOnSection = {
        insufficient: true,
        needed: c['insight.minRentedLinks'],
        have: rentedIds.length,
      };
    } else {
      const items: InsightItem[] = [];
      for (const rule of c['insight.addonRules'] as { kind: string; when: Record<string, any> }[]) {
        const w = rule.when ?? {};
        if (w.minRentedLinks !== undefined && rentedIds.length < w.minRentedLinks) continue;
        const matched = links.filter((l) => {
          if (!rentedIds.includes(l.id)) return false;
          const util =
            l.capacityMbps && l.availableMbps !== null
              ? 100 * (1 - l.availableMbps / l.capacityMbps)
              : null;
          const k = perfOf(l.id)?.kpis as { slaAvailabilityBreach?: boolean } | null;
          return (
            (w.maxRedundancy === undefined ||
              (l.redundancyScore !== null && l.redundancyScore <= w.maxRedundancy)) &&
            (w.minUtilPct === undefined || (util !== null && util >= w.minUtilPct)) &&
            (w.availabilityBelowSla === undefined || k?.slaAvailabilityBreach === true) &&
            (w.categoriesIn === undefined || w.categoriesIn.includes(l.category))
          );
        });
        if (!matched.length) continue;
        const matchedIds = new Set(matched.map((m) => m.id));
        const renters = new Set(
          rentals
            .filter((r) => matchedIds.has(r.networkLinkId))
            .map((r) => r.reservation.buyerUserId),
        );
        const cat = catalog.find((a) => a.kind === rule.kind);
        const catName = cat ? (cat.name as Bi).en : null;
        items.push(
          item(
            'ADDON_OPPORTUNITY',
            'info',
            {
              kind: rule.kind,
              links: matched.map((m) => nameOf.get(m.id)).join(', '),
              renterCount: renters.size,
              catalogName: catName,
              action: cat ? 'LIST_ADDON' : 'CREATE_ADDON',
            },
            {
              renterCount: renters.size,
              matchedLinks: matched.length,
              rentedLinks: rentedIds.length,
              catalogAddOnId: cat?.id ?? null,
              rule: rule.when,
            },
          ),
        );
      }
      addOnSection = { items };
    }

    // ---------- improvements ----------
    const improvements: InsightItem[] = [];
    const nowMs = Date.now();
    const peers = await this.prisma.networkLink.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        operatorProfile: { approvalStatus: 'APPROVED' },
        capacityMbps: { gt: 0 },
        basePrice: { not: null },
      },
      select: {
        id: true,
        originName: true,
        destinationName: true,
        capacityMbps: true,
        basePrice: true,
      },
    });
    for (const l of links) {
      const link = { id: l.id, name: nameOf.get(l.id)! };
      const p = perfOf(l.id);
      const k = p?.kpis as any;
      if (p?.rated && k) {
        if (k.slaAvailabilityBreach)
          improvements.push(
            item(
              'LOW_UPTIME',
              'high',
              { link: link.name, uptimePct: k.uptimePct, slaTargetPct: k.slaTargetPct },
              {
                uptimePct: k.uptimePct,
                outages: k.outages,
                windowDays: (p.basis as any)?.windowDays,
              },
              link,
            ),
          );
        if (
          k.latencyMs?.p50 &&
          k.latencyMs?.p95 &&
          k.latencyMs.p95 / k.latencyMs.p50 - 1 > c['perf.latencyP95Tolerance']
        ) {
          improvements.push(
            item(
              'LATENCY_UNSTABLE',
              'warn',
              { link: link.name, p50: k.latencyMs.p50, p95: k.latencyMs.p95 },
              { ...k.latencyMs, samples: (p.basis as any)?.samples },
              link,
            ),
          );
        }
        if (
          k.tickets?.slaBreachRatePct !== null &&
          k.tickets?.slaBreachRatePct >= c['insight.slaBreachRatePct']
        ) {
          improvements.push(
            item(
              'SLA_BREACHES',
              'warn',
              { link: link.name, ratePct: k.tickets.slaBreachRatePct },
              { tickets: k.tickets.count, mttrMin: k.tickets.mttrMin },
              link,
            ),
          );
        }
        if (p.score !== null && p.score < c['insight.lowScore'])
          improvements.push(
            item(
              'LOW_SCORE',
              'warn',
              { link: link.name, score: p.score },
              { score: p.score, components: p.components },
              link,
            ),
          );
      } else if (p?.reason === 'NO_TELEMETRY') {
        improvements.push(
          item('NO_TELEMETRY', 'info', { link: link.name }, { reason: p.reason }, link),
        );
      }
      const same = peers.filter(
        (x) =>
          routeKeyOf(x.originName, x.destinationName) ===
          routeKeyOf(l.originName, l.destinationName),
      );
      if (same.length >= c['insight.minPeers'] && l.basePrice !== null && l.capacityMbps) {
        const unit = same
          .map((x) => Number(x.basePrice) / ((x.capacityMbps as number) / 1000))
          .sort((a, b) => a - b);
        const median = unit[Math.floor(unit.length / 2)];
        const mine = Number(l.basePrice) / (l.capacityMbps / 1000);
        const dev = Math.round(((mine - median) / median) * 100);
        if (Math.abs(dev) > c['insight.priceDeviationPct']) {
          improvements.push(
            item(
              'PRICE_OUTLIER',
              dev > 0 ? 'warn' : 'info',
              { link: link.name, devPct: dev, peers: same.length },
              {
                pricePerGbps: Math.round(mine),
                medianPerGbps: Math.round(median),
                peers: same.length,
              },
              link,
            ),
          );
        }
      }
      if (
        l.apiConfigId &&
        l.lastSyncedAt &&
        nowMs - l.lastSyncedAt.getTime() > c['quality.staleSyncHours'] * 3600_000
      ) {
        improvements.push(
          item(
            'STALE_SYNC',
            'high',
            { link: link.name, hours: Math.round((nowMs - l.lastSyncedAt.getTime()) / 3600_000) },
            { lastSyncedAt: l.lastSyncedAt },
            link,
          ),
        );
      }
      if (!l.geospatialDataId)
        improvements.push(item('NO_KMZ', 'info', { link: link.name }, {}, link));
    }

    return {
      windowStart,
      windowEnd,
      includesDemo: demand.includesDemo || perfRows.some((p) => (p.basis as any)?.includesDemo),
      sections: {
        demand: {
          topSearched: demandSection(topSearched),
          bestSelling: demandSection(bestSelling),
          rising: demandSection(rising),
          congestionRisk: { items: congestion } as Section,
          unmetDemand: demandSection(unmet),
        },
        addOns: addOnSection,
        improvements: { items: improvements } as Section,
      },
      params: { windowDays: days, minEvidence: minEv },
    };
  }

  private ruleNarrative(sections: Awaited<ReturnType<InsightsService['build']>>['sections']): {
    summary: Bi;
    actions: Bi[];
  } {
    const all: InsightItem[] = [];
    const take = (s: Section) => (!s.insufficient ? all.push(...s.items) : 0);
    Object.values(sections.demand).forEach(take);
    take(sections.addOns);
    take(sections.improvements);
    const high = all.filter((i) => i.severity === 'high').length;
    const warn = all.filter((i) => i.severity === 'warn').length;
    const rank = { high: 0, warn: 1, info: 2 } as const;
    const actions = [...all]
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .slice(0, 5)
      .map((i) => i.text);
    return {
      summary: {
        id: `${all.length} temuan: ${high} prioritas tinggi, ${warn} perlu perhatian. Lihat bagian permintaan, add-on, dan perbaikan.`,
        en: `${all.length} findings: ${high} high priority, ${warn} need attention. See the demand, add-on and improvement sections.`,
      },
      actions,
    };
  }

  async generate(user: AuthUser, operatorId?: string) {
    const op =
      user.roles.includes('ADMIN') && operatorId
        ? await this.prisma.operatorProfile.findUnique({ where: { id: operatorId } })
        : await this.operators.get(user.sub);
    if (!op) throw new HttpException({ code: 'NOT_FOUND', message: 'Operator not found' }, 404);
    const cooldown = await this.settings.cfg<number>('insight.generateCooldownMin');
    const last = await this.prisma.sellerInsightReport.findFirst({
      where: { operatorProfileId: op.id },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < cooldown * 60_000) {
      throw new HttpException(
        {
          code: 'COOLDOWN',
          message: `Wait ${cooldown} minutes between reports`,
          reportId: last.id,
        },
        429,
      );
    }
    const built = await this.build(op.id);
    let narrative = this.ruleNarrative(built.sections);
    let engine = 'rule-based';
    try {
      const out = await this.ai.completeJson(
        'You are a business analyst for telecom link sellers on a wholesale marketplace. Use ONLY the findings supplied; never invent numbers, links or customers. ' +
          'Reply with one JSON object {"summary":{"id":string,"en":string},"actions":[{"id":string,"en":string}]} with at most 5 prioritised actions, in Indonesian (id) and English (en).',
        JSON.stringify(built.sections),
      );
      if (out) {
        const parsed = JSON.parse(
          out.text.slice(out.text.indexOf('{'), out.text.lastIndexOf('}') + 1),
        );
        const bi = (v: any): Bi | null =>
          typeof v?.id === 'string' && typeof v?.en === 'string' ? { id: v.id, en: v.en } : null;
        const summary = bi(parsed.summary);
        const actions = Array.isArray(parsed.actions)
          ? parsed.actions
              .map(bi)
              .filter((x: Bi | null): x is Bi => !!x)
              .slice(0, 5)
          : [];
        if (summary && actions.length) {
          narrative = { summary, actions };
          engine = out.engine;
        }
      }
    } catch {
      // keep the deterministic narrative
    }
    const row = await this.prisma.sellerInsightReport.create({
      data: {
        operatorProfileId: op.id,
        windowStart: built.windowStart,
        windowEnd: built.windowEnd,
        engine,
        facts: {
          sections: built.sections,
          params: built.params,
        } as unknown as Prisma.InputJsonValue,
        narrative: narrative as unknown as Prisma.InputJsonValue,
        includesDemo: built.includesDemo,
      },
    });
    await this.ledger.appendSafe({
      eventType: 'INSIGHT',
      status: 'SUCCESS',
      action: 'insight.generated',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'SellerInsightReport',
      entityId: row.id,
      responsePayload: { engine },
    });
    return row;
  }

  async latest(user: AuthUser, operatorId?: string) {
    const opId =
      user.roles.includes('ADMIN') && operatorId
        ? operatorId
        : (await this.operators.get(user.sub)).id;
    return this.prisma.sellerInsightReport.findFirst({
      where: { operatorProfileId: opId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async history(user: AuthUser) {
    const op = await this.operators.get(user.sub);
    return this.prisma.sellerInsightReport.findMany({
      where: { operatorProfileId: op.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, engine: true, createdAt: true, includesDemo: true },
    });
  }

  // Per-link performance + demand for the operator's Performance tab (batch, no N+1).
  async performanceTable(user: AuthUser) {
    const op = await this.operators.get(user.sub);
    const links = await this.prisma.networkLink.findMany({
      where: { operatorProfileId: op.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    const ids = links.map((l) => l.id);
    const rows = await this.prisma.linkPerformance.findMany({
      where: { networkLinkId: { in: ids } },
    });
    const missing = ids.filter((id) => !rows.some((r) => r.networkLinkId === id));
    if (missing.length) {
      await this.perf.computeMany(missing);
      rows.push(
        ...(await this.prisma.linkPerformance.findMany({
          where: { networkLinkId: { in: missing } },
        })),
      );
    }
    const demand = await this.interactions.stats();
    const out = [];
    for (const l of links) {
      const r = rows.find((x) => x.networkLinkId === l.id);
      const hot = await this.interactions.hotInfo(
        demand.byLink.get(l.id),
        l.capacityMbps && l.availableMbps !== null
          ? (l.availableMbps / l.capacityMbps) * 100
          : null,
      );
      out.push({
        linkId: l.id,
        name: l.name,
        originName: l.originName,
        destinationName: l.destinationName,
        availability: l.availability,
        utilizationPct:
          l.capacityMbps && l.availableMbps !== null
            ? Math.round(100 * (1 - l.availableMbps / l.capacityMbps) * 10) / 10
            : null,
        rated: r?.rated ?? false,
        score: r?.score ?? null,
        reason: r?.reason ?? null,
        components: r?.components ?? null,
        kpis: r?.kpis ?? null,
        basis: r?.basis ?? null,
        demand: { score: hot.score, events: hot.events, trendPct: hot.trendPct, hot: hot.hot },
      });
    }
    return { items: out, includesDemo: demand.includesDemo };
  }
}

@Controller()
@UseGuards(AuthGuard)
export class InsightsController {
  constructor(private readonly svc: InsightsService) {}

  @Get('seller/insights/latest')
  @Perms('insight:read')
  latest(@CurrentUser() u: AuthUser, @Query('operatorId') operatorId?: string) {
    return this.svc.latest(u, operatorId);
  }

  @Post('seller/insights/generate')
  @Perms('insight:read')
  generate(@CurrentUser() u: AuthUser, @Body() b: { operatorId?: string }) {
    return this.svc.generate(u, b?.operatorId);
  }

  @Get('seller/insights')
  @Perms('insight:read')
  history(@CurrentUser() u: AuthUser) {
    return this.svc.history(u);
  }

  @Get('operator/performance')
  @Perms('insight:read')
  performance(@CurrentUser() u: AuthUser) {
    return this.svc.performanceTable(u);
  }
}

@Module({
  imports: [AiModule, InteractionsModule, QualityModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
