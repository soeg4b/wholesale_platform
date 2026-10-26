import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LinkPerformance, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { LedgerService } from '../common/ledger.service';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../common/auth.guard';
import { TicketsModule, TicketsService } from '../tickets/tickets.module';
import { IncidentDetector } from './incident-detector';
import { TelemetryService } from './telemetry.service';

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const r1 = (x: number | null | undefined) =>
  x === null || x === undefined ? null : Math.round(x * 100) / 100;

type LatRow = {
  network_link_id: string;
  samples: number;
  latency_samples: number;
  mean_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  stddev_ms: number | null;
  p95_util_pct: number | null;
  first_at: Date;
  last_at: Date;
  coverage_days: number | null;
  includes_demo: boolean | null;
};
type OutRow = { network_link_id: string; outage_count: number; outage_minutes: number | null };

@Injectable()
export class PerformanceService {
  private readonly log = new Logger(PerformanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tickets: TicketsService,
    private readonly ledger: LedgerService,
  ) {}

  async computeMany(requested: string[]) {
    if (!requested.length) return;
    // Only existing links get a row (a bogus id must never reach the FK).
    const known = await this.prisma.networkLink.findMany({
      where: { id: { in: requested } },
      select: { id: true, slaPercent: true },
    });
    const ids = known.map((k) => k.id);
    if (!ids.length) return;
    const c = await this.settings.cfgMany([
      'perf.windowDays',
      'perf.minSamples',
      'perf.minCoverageDays',
      'perf.weights',
      'perf.latencyP95Tolerance',
      'perf.availabilityFloorPct',
      'perf.headroomFullPct',
      'perf.ticketCap',
      'sla.defaultAvailabilityPct',
      'demo.countInMetrics',
      'ticket.minForRates',
    ]);
    const now = new Date();
    const from = new Date(now.getTime() - c['perf.windowDays'] * 86400_000);
    const includeDemo = !!c['demo.countInMetrics'];
    const [lat, out, tix, existing] = await Promise.all([
      this.prisma.$queryRaw<
        LatRow[]
      >`SELECT * FROM link_latency_stats(${ids}::text[], ${from}::timestamptz, ${now}::timestamptz, ${includeDemo}::boolean)`,
      this.prisma.$queryRaw<
        OutRow[]
      >`SELECT * FROM link_outage_minutes(${ids}::text[], ${from}::timestamptz, ${now}::timestamptz, ${includeDemo}::boolean)`,
      this.tickets.stats(ids, c['perf.windowDays']),
      this.prisma.linkPerformance.findMany({
        where: { networkLinkId: { in: ids } },
        select: { networkLinkId: true, firstRatedAt: true },
      }),
    ]);
    const links = known;
    const windowMin = c['perf.windowDays'] * 1440;

    for (const id of ids) {
      const s = lat.find((r) => r.network_link_id === id);
      const o = out.find((r) => r.network_link_id === id);
      const sampleCount = Number(s?.samples ?? 0);
      const t = tix.get(id)!;
      // Rates need enough tickets to mean anything (PM min-evidence rule).
      const rate = t.count >= c['ticket.minForRates'] ? t.slaBreachRatePct : null;
      const mtta = t.count >= c['ticket.minForRates'] ? t.mttaMin : null;
      const mttr = t.count >= c['ticket.minForRates'] ? t.mttrMin : null;
      const link = links.find((l) => l.id === id);
      const prev = existing.find((e) => e.networkLinkId === id);
      const coverage = s?.coverage_days ?? 0;
      let reason: string | null = null;
      if (!s || sampleCount === 0) reason = 'NO_TELEMETRY';
      else if (sampleCount < c['perf.minSamples']) reason = 'MIN_SAMPLES';
      else if (coverage < c['perf.minCoverageDays']) reason = 'MIN_COVERAGE';

      const outageMin = o?.outage_minutes ?? 0;
      const availability = Math.max(0, 100 * (1 - outageMin / windowMin));
      const basis = {
        windowDays: c['perf.windowDays'],
        samples: sampleCount,
        coverageDays: r1(coverage) ?? 0,
        computedAt: now.toISOString(),
        includesDemo: !!s?.includes_demo,
      };
      const sla = Number(link?.slaPercent ?? c['sla.defaultAvailabilityPct']);
      const kpis = {
        uptimePct: r1(availability),
        slaTargetPct: sla,
        slaAvailabilityBreach: s ? availability < sla : null,
        latencyMs: {
          mean: r1(s?.mean_ms),
          p50: r1(s?.p50_ms),
          p95: r1(s?.p95_ms),
          stddev: r1(s?.stddev_ms),
        },
        outages: { count: Number(o?.outage_count ?? 0), totalMinutes: Math.round(outageMin) },
        tickets: {
          count: t.count,
          openCount: t.openCount,
          mttaMin: mtta,
          mttrMin: mttr,
          slaBreachRatePct: rate,
        },
      };

      let score: number | null = null;
      let components: Record<string, number | null> | null = null;
      if (!reason && s) {
        const floor = c['perf.availabilityFloorPct'];
        const latency =
          s.p50_ms && s.p95_ms !== null
            ? 100 * (1 - clamp((s.p95_ms / s.p50_ms - 1) / c['perf.latencyP95Tolerance']))
            : null;
        const avail = 100 * clamp((availability - floor) / (100 - floor));
        const tickets =
          100 *
          (1 -
            clamp(
              0.5 * ((rate ?? 0) / 100) +
                0.5 * Math.min(1, t.buyerOperatorCount / c['perf.ticketCap']),
            ));
        const headroom =
          s.p95_util_pct === null
            ? null
            : 100 * clamp((100 - s.p95_util_pct) / c['perf.headroomFullPct']);
        components = {
          latency: r1(latency),
          availability: r1(avail),
          tickets: r1(tickets),
          headroom: r1(headroom),
        };
        const w = c['perf.weights'] as Record<string, number>;
        let num = 0;
        let den = 0;
        for (const [k, v] of Object.entries({ latency, availability: avail, tickets, headroom })) {
          if (v === null) continue;
          num += (w[k] ?? 0) * v;
          den += w[k] ?? 0;
        }
        score = den > 0 ? Math.round(num / den) : null;
        if (score === null) reason = 'NO_TELEMETRY';
      }
      const rated = score !== null;
      const firstRatedAt = prev?.firstRatedAt ?? (rated ? now : null);
      const data = {
        score,
        rated,
        reason,
        components: (components ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        basis: basis as Prisma.InputJsonValue,
        kpis: kpis as unknown as Prisma.InputJsonValue,
        firstRatedAt,
        computedAt: now,
      };
      await this.prisma.linkPerformance.upsert({
        where: { networkLinkId: id },
        create: { networkLinkId: id, ...data },
        update: data,
      });
      if (rated && !prev?.firstRatedAt) {
        await this.ledger.appendSafe({
          eventType: 'LINK_UPDATE',
          status: 'SUCCESS',
          action: 'link.performance.rated',
          networkLinkId: id,
          responsePayload: { score, samples: basis.samples },
        });
      }
    }
  }

  // Seller/admin see a fresh score immediately; buyers wait out the preview period.
  private async visible(row: { rated: boolean; firstRatedAt: Date | null }, owner: boolean) {
    if (!row.rated || owner) return true;
    const days = await this.settings.cfg<number>('perf.previewDays');
    return !!row.firstRatedAt && row.firstRatedAt.getTime() + days * 86400_000 <= Date.now();
  }

  async forLink(user: AuthUser, id: string) {
    const owner0 = user.roles.includes('ADMIN');
    const link = await this.prisma.networkLink.findFirst({
      where: {
        id,
        deletedAt: null,
        // Draft/suspended links are only visible to their owner and admins.
        ...(owner0
          ? {}
          : {
              OR: [
                { status: 'ACTIVE', operatorProfile: { approvalStatus: 'APPROVED' } },
                { operatorProfile: { userId: user.sub } },
              ],
            }),
      },
      select: { id: true, operatorProfile: { select: { userId: true } } },
    });
    if (!link) throw new NotFoundException();
    let row = await this.prisma.linkPerformance.findUnique({ where: { networkLinkId: id } });
    if (!row) {
      await this.computeMany([id]);
      row = await this.prisma.linkPerformance.findUnique({ where: { networkLinkId: id } });
    }
    const owner = user.roles.includes('ADMIN') || link.operatorProfile.userId === user.sub;
    if (!row || !row.rated || !(await this.visible(row, owner))) {
      return {
        rated: false,
        reason: row?.rated ? 'PREVIEW' : (row?.reason ?? 'NO_TELEMETRY'),
        basis: row?.basis ?? null,
      };
    }
    // Competing operators only get the headline score of a rival's link, not its KPIs.
    if (!owner && user.roles.includes('PENYELENGGARA')) {
      return {
        rated: true,
        score: row.score,
        basis: { windowDays: (row.basis as any)?.windowDays },
      };
    }
    const extra = owner
      ? {
          outageList: await this.prisma.linkTicket.findMany({
            where: { networkLinkId: id, source: 'SYSTEM', kind: 'OUTAGE' },
            orderBy: { incidentStartAt: 'desc' },
            take: 10,
            select: { reference: true, incidentStartAt: true, incidentEndAt: true, status: true },
          }),
        }
      : {};
    return {
      rated: row.rated,
      reason: row.reason,
      score: row.score,
      components: row.components,
      basis: row.basis,
      kpis: row.kpis,
      ...extra,
    };
  }

  async many(user: AuthUser, requested: string[]) {
    // Only visible links are scored; unknown/hidden ids come back as not rated.
    const unique = [...new Set(requested)].slice(0, 500);
    const visible = await this.prisma.networkLink.findMany({
      where: {
        id: { in: unique },
        deletedAt: null,
        ...(user.roles.includes('ADMIN')
          ? {}
          : {
              OR: [
                { status: 'ACTIVE', operatorProfile: { approvalStatus: 'APPROVED' } },
                { operatorProfile: { userId: user.sub } },
              ],
            }),
      },
      select: { id: true },
    });
    const ids = visible.map((v) => v.id);
    let rows: LinkPerformance[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      let part = await this.prisma.linkPerformance.findMany({
        where: { networkLinkId: { in: chunk } },
      });
      const missing = chunk.filter((id) => !part.some((r) => r.networkLinkId === id));
      if (missing.length) {
        await this.computeMany(missing);
        part = await this.prisma.linkPerformance.findMany({
          where: { networkLinkId: { in: chunk } },
        });
      }
      rows = rows.concat(part);
    }
    const owned = user.roles.includes('ADMIN')
      ? new Set(ids)
      : new Set(
          (
            await this.prisma.networkLink.findMany({
              where: { id: { in: ids }, operatorProfile: { userId: user.sub } },
              select: { id: true },
            })
          ).map((l) => l.id),
        );
    const out: Record<string, { rated: boolean; score: number | null; reason?: string | null }> =
      {};
    for (const id of unique) {
      const r = rows.find((x) => x.networkLinkId === id);
      const ok = r ? await this.visible(r, owned.has(id)) : false;
      out[id] =
        r && r.rated && ok
          ? { rated: true, score: r.score }
          : {
              rated: false,
              score: null,
              reason: r?.rated ? 'PREVIEW' : (r?.reason ?? 'NO_TELEMETRY'),
            };
    }
    return out;
  }

  @Interval(5 * 60_000)
  async scheduled() {
    try {
      const mins = await this.settings.cfg<number>('perf.recomputeMinutes');
      const cutoff = new Date(Date.now() - mins * 60_000);
      const due = await this.prisma.networkLink.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          OR: [{ performance: null }, { performance: { computedAt: { lt: cutoff } } }],
        },
        select: { id: true },
        take: 50,
      });
      await this.computeMany(due.map((d) => d.id));
      const days = await this.settings.cfg<number>('retention.snapshotDays');
      await this.prisma.$executeRaw`
        DELETE FROM link_metric_snapshots WHERE id IN (
          SELECT id FROM link_metric_snapshots WHERE "recordedAt" < ${new Date(Date.now() - days * 86400_000)} AND NOT "isDemo" LIMIT 10000)`;
    } catch (e) {
      this.log.warn(`performance recompute failed: ${(e as Error).message}`);
    }
  }
}

@Controller()
@UseGuards(AuthGuard)
export class QualityController {
  constructor(
    private readonly perf: PerformanceService,
    private readonly prisma: PrismaService,
    private readonly detector: IncidentDetector,
  ) {}

  @Get('links/:id/performance')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.perf.forLink(u, id);
  }

  @Post('admin/quality/recompute')
  @Roles('ADMIN')
  @HttpCode(202)
  async recompute(@Body() b: { linkIds?: string[] }) {
    const ids = b?.linkIds?.length
      ? b.linkIds
      : (
          await this.prisma.networkLink.findMany({
            where: { deletedAt: null, status: 'ACTIVE' },
            select: { id: true },
          })
        ).map((l) => l.id);
    for (const id of ids) await this.detector.evaluate(id).catch(() => undefined);
    await this.perf.computeMany(ids.slice(0, 200));
    return { recomputed: Math.min(ids.length, 200) };
  }
}

@Module({
  imports: [TicketsModule],
  controllers: [QualityController],
  providers: [IncidentDetector, TelemetryService, PerformanceService],
  exports: [TelemetryService, PerformanceService, IncidentDetector],
})
export class QualityModule {}
