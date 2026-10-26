import { Injectable, Logger } from '@nestjs/common';
import { LinkOpStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { TicketsService } from '../tickets/tickets.module';

type SampleClass = 'GOOD' | 'DEGRADE' | 'OUTAGE' | 'PLANNED';

@Injectable()
export class IncidentDetector {
  private readonly log = new Logger(IncidentDetector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tickets: TicketsService,
  ) {}

  private classify(
    s: {
      latencyMs: number | null;
      lossPct: number | null;
      opStatus: LinkOpStatus | null;
      plannedMaintenance: boolean;
    },
    baseline: number | null,
    c: Record<string, any>,
  ): SampleClass {
    if (s.plannedMaintenance) return 'PLANNED';
    if (s.opStatus === 'DOWN' || (s.lossPct !== null && s.lossPct >= c['perf.outageLossPct']))
      return 'OUTAGE';
    if (
      s.opStatus === 'DEGRADED' ||
      (s.lossPct !== null && s.lossPct > c['perf.lossDegradePct']) ||
      (s.latencyMs !== null &&
        baseline !== null &&
        s.latencyMs > c['perf.latencyDegradeFactor'] * baseline)
    ) {
      return 'DEGRADE';
    }
    return 'GOOD';
  }

  // Runs on every new telemetry sample. Demo (seeded) samples never open tickets.
  async evaluate(linkId: string) {
    const link = await this.prisma.networkLink.findFirst({
      where: {
        id: linkId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'MAINTENANCE'] },
        operatorProfile: { approvalStatus: 'APPROVED' },
      },
      select: { id: true, operatorProfileId: true, originName: true, destinationName: true },
    });
    if (!link) return;
    const c = await this.settings.cfgMany([
      'perf.outageMinSamples',
      'perf.degradeMinSamples',
      'perf.outageLossPct',
      'perf.lossDegradePct',
      'perf.latencyDegradeFactor',
      'perf.baselineMinSamples',
      'ticket.autoResolveSamples',
      'ticket.flapWindowMin',
    ]);
    const need = Math.max(
      c['perf.outageMinSamples'],
      c['perf.degradeMinSamples'],
      c['ticket.autoResolveSamples'],
    );
    const recent = await this.prisma.linkMetricSnapshot.findMany({
      where: { networkLinkId: linkId, isDemo: false },
      orderBy: { recordedAt: 'desc' },
      take: need + 40,
    });
    if (!recent.length) return;

    // Baseline = median latency of the samples older than the ones being judged.
    const older = recent
      .slice(need)
      .map((r) => r.latencyMs)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const baseline =
      older.length >= Math.min(c['perf.baselineMinSamples'], 20)
        ? older[Math.floor(older.length / 2)]
        : null;

    const judged = recent
      .slice(0, need)
      .map((s) => ({ s, k: this.classify(s, baseline, c) }))
      .filter((x) => x.k !== 'PLANNED');
    if (!judged.length) return;

    const lead = (pred: (k: SampleClass) => boolean) => {
      let n = 0;
      while (n < judged.length && pred(judged[n].k)) n++;
      return n;
    };
    const outageStreak = lead((k) => k === 'OUTAGE');
    const badStreak = lead((k) => k === 'OUTAGE' || k === 'DEGRADE');
    const want: 'OUTAGE' | 'DEGRADATION' | null =
      outageStreak >= c['perf.outageMinSamples']
        ? 'OUTAGE'
        : badStreak >= c['perf.degradeMinSamples']
          ? 'DEGRADATION'
          : null;

    const open = await this.prisma.linkTicket.findFirst({
      where: {
        networkLinkId: linkId,
        source: 'SYSTEM',
        status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] },
      },
    });

    if (want) {
      const streak = want === 'OUTAGE' ? outageStreak : badStreak;
      const startedAt = judged[streak - 1].s.recordedAt; // oldest sample of the streak
      if (open) {
        if (open.kind === 'DEGRADATION' && want === 'OUTAGE')
          await this.tickets.escalateSystem(open.id, startedAt);
        return;
      }
      const flapSince = new Date(Date.now() - c['ticket.flapWindowMin'] * 60_000);
      const recentlyResolved = await this.prisma.linkTicket.findFirst({
        where: {
          networkLinkId: linkId,
          source: 'SYSTEM',
          kind: want,
          status: 'RESOLVED',
          resolvedAt: { gte: flapSince },
        },
        orderBy: { resolvedAt: 'desc' },
      });
      if (recentlyResolved) {
        await this.tickets.reopenSystem(recentlyResolved.id);
        return;
      }
      const last = judged[0].s;
      await this.tickets.createSystem(
        link,
        want,
        startedAt,
        `${streak} consecutive bad samples (status ${last.opStatus ?? 'n/a'}, loss ${last.lossPct ?? 'n/a'}%, latency ${last.latencyMs ?? 'n/a'} ms${baseline ? `, baseline ${Math.round(baseline * 100) / 100} ms` : ''}).`,
      );
      return;
    }

    if (open && judged.length >= c['ticket.autoResolveSamples']) {
      const lastN = judged.slice(0, c['ticket.autoResolveSamples']);
      if (lastN.every((x) => x.k === 'GOOD')) {
        await this.tickets.autoResolveSystem(open.id, lastN[lastN.length - 1].s.recordedAt);
      }
    }
  }
}
