import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DynamicApiConfig, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { TelemetryService } from '../quality/telemetry.service';
import { NormalizedLink, OPERATOR_ADAPTERS, OperatorAdapter } from './adapter.types';

@Injectable()
export class AdapterRegistry {
  constructor(@Inject(OPERATOR_ADAPTERS) private readonly adapters: OperatorAdapter[]) {}

  for(config: Pick<DynamicApiConfig, 'adapterKey'>): OperatorAdapter {
    const adapter = this.adapters.find((a) => a.key === config.adapterKey);
    if (!adapter) throw new NotFoundException(`No adapter registered for "${config.adapterKey}"`);
    return adapter;
  }

  keys() {
    return this.adapters.map((a) => a.key);
  }
}

export interface IngestStats {
  seen: number;
  created: number;
  updated: number;
  failed: number;
}

@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);
  private running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AdapterRegistry,
    private readonly ledger: LedgerService,
    private readonly telemetry: TelemetryService,
  ) {}

  async ingest(
    config: DynamicApiConfig,
    rawItems: unknown[],
    markMissing: boolean,
  ): Promise<IngestStats> {
    const adapter = this.registry.for(config);
    const stats: IngestStats = { seen: 0, created: 0, updated: 0, failed: 0 };
    const seen = new Set<string>();

    for (const raw of rawItems) {
      const n = adapter.normalize(config, raw);
      if (!n) {
        stats.failed++;
        continue;
      }
      stats.seen++;
      seen.add(n.externalId);
      try {
        await this.upsertLink(config, n, stats);
      } catch (err) {
        stats.failed++;
        this.log.warn(`Link ${n.externalId} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (markMissing && seen.size > 0) {
      await this.prisma.networkLink.updateMany({
        where: {
          apiConfigId: config.id,
          deletedAt: null,
          externalId: { notIn: [...seen] },
          availability: { notIn: ['LOCKED', 'RESERVED'] },
        },
        data: { availability: 'UNAVAILABLE' },
      });
    }
    await this.autoAttachGeometry(config);
    return stats;
  }

  // Links whose external ID equals a KMZ/KML placemark name get that route automatically.
  private async autoAttachGeometry(config: DynamicApiConfig) {
    const unattached = await this.prisma.networkLink.findMany({
      where: {
        apiConfigId: config.id,
        deletedAt: null,
        geospatialDataId: null,
        externalId: { not: null },
      },
      select: { id: true, externalId: true },
    });
    if (!unattached.length) return;
    const geos = await this.prisma.geospatialData.findMany({
      where: { operatorProfileId: config.operatorProfileId, parseStatus: 'PARSED' },
      select: { id: true, geoJson: true },
    });
    const byFeature = new Map<string, string>();
    for (const g of geos) {
      const fc = g.geoJson as unknown as GeoJSON.FeatureCollection | null;
      fc?.features?.forEach((f) => byFeature.set(String(f.id ?? f.properties?.name), g.id));
    }
    for (const l of unattached) {
      const geoId = byFeature.get(l.externalId as string);
      if (geoId) {
        await this.prisma.networkLink.update({
          where: { id: l.id },
          data: { geospatialDataId: geoId, geometryFeatureId: l.externalId },
        });
      }
    }
  }

  private async upsertLink(config: DynamicApiConfig, n: NormalizedLink, stats: IngestStats) {
    // Telemetry is sampled separately, so it must not defeat the no-op checksum.
    const { telemetry: _telemetry, ...checksumInput } = n;
    const checksum = createHash('sha1').update(JSON.stringify(checksumInput)).digest('hex');
    const where = {
      operatorProfileId_externalId: {
        operatorProfileId: config.operatorProfileId,
        externalId: n.externalId,
      },
    };
    const existing = await this.prisma.networkLink.findUnique({ where });
    if (existing && existing.syncChecksum === checksum && existing.deletedAt === null) {
      await this.prisma.networkLink.update({
        where: { id: existing.id },
        data: { lastSyncedAt: new Date(), apiConfigId: config.id },
      });
      await this.telemetry
        .sample(existing.id, n, false)
        .catch((e) =>
          this.log.warn(`telemetry sample failed for ${existing.id}: ${e?.message ?? e}`),
        );
      return;
    }

    let availability = n.availability;
    if (
      existing &&
      ['LOCKED', 'RESERVED'].includes(existing.availability) &&
      availability === 'AVAILABLE'
    ) {
      availability = existing.availability as NormalizedLink['availability'];
    }
    const shared = {
      category: n.category,
      status: n.status,
      availability,
      originName: n.originName,
      originLat: n.originLat,
      originLng: n.originLng,
      destinationName: n.destinationName,
      destinationLat: n.destinationLat,
      destinationLng: n.destinationLng,
      distanceKm: n.distanceKm,
      capacityMbps: n.capacityMbps,
      availableMbps: n.availableMbps,
      latencyMs: n.latencyMs,
      slaPercent: n.slaPercent,
      redundancyScore: n.redundancyScore,
      basePrice: n.basePrice,
      ...(n.currency ? { currency: n.currency } : {}),
      attributes: (n.attributes ?? {}) as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
      syncChecksum: checksum,
      deletedAt: null,
    };

    let linkId: string;
    if (!existing) {
      const created = await this.prisma.networkLink.create({
        data: {
          ...shared,
          operatorProfileId: config.operatorProfileId,
          apiConfigId: config.id,
          externalId: n.externalId,
          name: { id: n.name, en: n.name },
        },
      });
      linkId = created.id;
      stats.created++;
    } else {
      const name = existing.name as { id?: string; en?: string };
      await this.prisma.networkLink.update({
        where: { id: existing.id },
        data: {
          ...shared,
          apiConfigId: config.id, // re-adopt links whose previous config was replaced
          ...(name?.id === name?.en ? { name: { id: n.name, en: n.name } } : {}),
        },
      });
      linkId = existing.id;
      stats.updated++;
    }

    const changed =
      !existing ||
      existing.latencyMs !== (n.latencyMs ?? null) ||
      existing.availableMbps !== (n.availableMbps ?? null) ||
      Number(existing.basePrice ?? -1) !== (n.basePrice ?? -1);
    await this.telemetry
      .sample(linkId, n, changed)
      .catch((e) => this.log.warn(`telemetry sample failed for ${linkId}: ${e?.message ?? e}`));
  }

  async runSync(
    configId: string,
    trigger: 'SCHEDULE' | 'WEBHOOK' | 'MANUAL',
    actorUserId?: string,
  ) {
    if (this.running.has(configId)) return { skipped: true };
    this.running.add(configId);
    const config = await this.prisma.dynamicApiConfig.findUnique({ where: { id: configId } });
    if (!config) {
      this.running.delete(configId);
      throw new NotFoundException();
    }
    const run = await this.prisma.apiSyncRun.create({ data: { apiConfigId: config.id, trigger } });
    const started = Date.now();
    try {
      const { items, httpStatus } = await this.registry.for(config).fetchRaw(config);
      const stats = await this.ingest(config, items, true);
      const durationMs = Date.now() - started;
      await this.prisma.$transaction([
        this.prisma.apiSyncRun.update({
          where: { id: run.id },
          data: {
            status: stats.failed ? 'PARTIAL' : 'SUCCESS',
            finishedAt: new Date(),
            durationMs,
            httpStatus,
            linksSeen: stats.seen,
            linksCreated: stats.created,
            linksUpdated: stats.updated,
            linksFailed: stats.failed,
          },
        }),
        this.prisma.dynamicApiConfig.update({
          where: { id: config.id },
          data: {
            status: 'ACTIVE',
            consecutiveFailures: 0,
            lastError: null,
            lastSyncedAt: new Date(),
            nextSyncAt: new Date(Date.now() + config.pollingIntervalSec * 1000),
          },
        }),
      ]);
      await this.ledger.appendSafe({
        eventType: 'API_SYNC',
        status: 'SUCCESS',
        action: `api.sync.${trigger.toLowerCase()}`,
        actorUserId,
        operatorProfileId: config.operatorProfileId,
        entityType: 'DynamicApiConfig',
        entityId: config.id,
        responsePayload: { ...stats, durationMs },
      });
      return { skipped: false, ...stats, durationMs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failures = config.consecutiveFailures + 1;
      const backoffSec = Math.min(config.pollingIntervalSec * 2 ** failures, 3600);
      await this.prisma.$transaction([
        this.prisma.apiSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            durationMs: Date.now() - started,
            errorMessage: message,
          },
        }),
        this.prisma.dynamicApiConfig.update({
          where: { id: config.id },
          data: {
            consecutiveFailures: failures,
            lastError: message.slice(0, 500),
            status: failures >= 5 ? 'ERROR' : config.status,
            nextSyncAt: new Date(Date.now() + backoffSec * 1000),
          },
        }),
      ]);
      await this.ledger.appendSafe({
        eventType: 'API_SYNC',
        status: 'FAILED',
        action: `api.sync.${trigger.toLowerCase()}`,
        actorUserId,
        operatorProfileId: config.operatorProfileId,
        entityType: 'DynamicApiConfig',
        entityId: config.id,
        message: message.slice(0, 500),
      });
      throw err;
    } finally {
      this.running.delete(configId);
    }
  }

  // Dry run used by the "Test connection" button: fetch + map but persist nothing.
  async preview(config: DynamicApiConfig) {
    const adapter = this.registry.for(config);
    const { items, httpStatus } = await adapter.fetchRaw(config);
    const sample = items
      .slice(0, 3)
      .map((raw) => ({ raw, mapped: adapter.normalize(config, raw) }));
    return { httpStatus, totalItems: items.length, sample };
  }

  @Interval(10_000)
  async tick() {
    const now = new Date();
    const due = await this.prisma.dynamicApiConfig.findMany({
      where: {
        isActive: true,
        syncMode: { in: ['POLLING', 'HYBRID'] },
        status: { not: 'PAUSED' },
        operatorProfile: { approvalStatus: 'APPROVED', deletedAt: null },
        OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
      },
      orderBy: { nextSyncAt: 'asc' },
      take: 20,
    });
    await Promise.allSettled(
      due.map(async (c) => {
        // Claim the slot so parallel API instances do not poll the same operator twice.
        const claimed = await this.prisma.dynamicApiConfig.updateMany({
          where: { id: c.id, OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }] },
          data: { nextSyncAt: new Date(Date.now() + Math.max(c.pollingIntervalSec, 30) * 1000) },
        });
        if (claimed.count === 1) await this.runSync(c.id, 'SCHEDULE').catch(() => undefined);
      }),
    );
  }
}
