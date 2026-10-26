import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { NormalizedLink } from '../integrations/adapter.types';
import { IncidentDetector } from './incident-detector';

@Injectable()
export class TelemetryService {
  private readonly log = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly detector: IncidentDetector,
  ) {}

  // Writes a time-series sample on change, or on every poll interval when the operator reports telemetry.
  async sample(linkId: string, n: NormalizedLink, changed: boolean) {
    const t = n.telemetry;
    const hasTelemetry = !!t && (t.lossPct !== null || t.opStatus !== null || t.plannedMaintenance);
    const pollMin = await this.settings.cfg<number>('telemetry.pollMinutes');
    const last = await this.prisma.linkMetricSnapshot.findFirst({
      where: { networkLinkId: linkId, isDemo: false },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    const age = last ? Date.now() - last.recordedAt.getTime() : Infinity;
    if (!changed && !(hasTelemetry && age >= pollMin * 60_000)) return;

    await this.prisma.linkMetricSnapshot.create({
      data: {
        networkLinkId: linkId,
        latencyMs: n.latencyMs,
        availableMbps: n.availableMbps,
        price: n.basePrice,
        utilizationPct:
          n.capacityMbps && n.availableMbps !== null && n.availableMbps !== undefined
            ? Math.round((1 - n.availableMbps / n.capacityMbps) * 1000) / 10
            : null,
        lossPct: t?.lossPct ?? null,
        opStatus: t?.opStatus ?? null,
        plannedMaintenance: !!t?.plannedMaintenance || n.status === 'MAINTENANCE',
      },
    });
    if (hasTelemetry) {
      // A detection failure must never fail the sync.
      await this.detector
        .evaluate(linkId)
        .catch((e) => this.log.warn(`detector failed for ${linkId}: ${e?.message ?? e}`));
    }
  }
}
