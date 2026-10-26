import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Module,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InteractionType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser, Perms, Roles } from '../common/auth.guard';
import { dayKey, nodeKey, routeKeyOf } from '../common/nodes';

export interface HotInfo {
  score: number;
  prevScore: number;
  events: number;
  trendPct: number;
  hot: boolean;
  scarcityPct: number | null;
}

export interface DemandStats {
  byLink: Map<string, Record<string, { cur: number; prev: number }>>;
  byRoute: Map<string, Record<string, { cur: number; prev: number }>>;
  includesDemo: boolean;
  generatedAt: Date;
}

interface Target {
  link?: { id: string; originName: string; destinationName: string } | null;
  from?: string;
  to?: string;
  minMbps?: number;
  unmet?: boolean;
}

@Injectable()
export class InteractionsService {
  private readonly log = new Logger(InteractionsService.name);
  private throttle = new Map<string, { count: number; minute: number }>();
  private statsCache: { at: number; value: DemandStats } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private checkThrottle(userId: string, max: number) {
    const minute = Math.floor(Date.now() / 60_000);
    const rec = this.throttle.get(userId);
    if (!rec || rec.minute !== minute) {
      if (this.throttle.size > 5000) {
        for (const [k, v] of this.throttle) if (v.minute !== minute) this.throttle.delete(k);
      }
      this.throttle.set(userId, { count: 1, minute });
      return;
    }
    if (++rec.count > max)
      throw new HttpException(
        { code: 'THROTTLED', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  // Fire-and-forget: tracking must never slow down or break the request.
  track(user: AuthUser, type: InteractionType, target: Target) {
    void this.record(user, type, target).catch((e) =>
      this.log.warn(`interaction failed: ${e?.message ?? e}`),
    );
  }

  async record(user: AuthUser, type: InteractionType, target: Target) {
    const max = await this.settings.cfg<number>('interaction.maxPerMinute');
    this.checkThrottle(user.sub, max);
    const routeKey = target.link
      ? routeKeyOf(target.link.originName, target.link.destinationName)
      : target.from && target.to
        ? routeKeyOf(target.from, target.to)
        : null;
    const linkId = target.link?.id ?? null;
    if (!linkId && !routeKey) return;

    // Only buyers generate demand; seller/admin activity is stored for audit but never counted.
    const counts = user.roles.includes('PENYEWA') && !user.roles.includes('ADMIN');
    const base = {
      userId: user.sub,
      networkLinkId: linkId,
      routeKey,
      type,
      minMbps: target.minMbps ?? null,
      unmet: !!target.unmet,
    };
    if (counts) {
      const tz = await this.settings.cfg<string>('platform.timezone');
      const countedKey = `${user.sub}|${linkId ?? routeKey}|${type}|${dayKey(tz)}`;
      try {
        await this.prisma.linkInteraction.create({ data: { ...base, counted: true, countedKey } });
        return;
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    await this.prisma.linkInteraction.create({
      data: { ...base, counted: false, countedKey: null },
    });
  }

  async stats(): Promise<DemandStats> {
    const demoNow = await this.settings.cfg<boolean>('demo.countInMetrics');
    if (
      this.statsCache &&
      Date.now() - this.statsCache.at < 60_000 &&
      this.statsCache.value.includesDemo === demoNow
    ) {
      return this.statsCache.value;
    }
    const [days, includeDemo] = await Promise.all([
      this.settings.cfg<number>('hot.windowDays'),
      this.settings.cfg<boolean>('demo.countInMetrics'),
    ]);
    const curStart = new Date(Date.now() - days * 86400_000);
    const prevStart = new Date(Date.now() - 2 * days * 86400_000);
    type Row = { id: string | null; route: string | null; type: string; cur: number; prev: number };
    const [linkRows, routeRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT "networkLinkId" AS id, NULL AS route, "type"::text AS type,
               (COUNT(*) FILTER (WHERE "createdAt" >= ${curStart}))::int AS cur,
               (COUNT(*) FILTER (WHERE "createdAt" < ${curStart}))::int AS prev
        FROM link_interactions
        WHERE counted AND "networkLinkId" IS NOT NULL AND "createdAt" >= ${prevStart}
          AND (${includeDemo}::boolean OR NOT "isDemo")
        GROUP BY 1, 3`,
      this.prisma.$queryRaw<Row[]>`
        SELECT NULL AS id, "routeKey" AS route, "type"::text AS type,
               (COUNT(*) FILTER (WHERE "createdAt" >= ${curStart}))::int AS cur,
               (COUNT(*) FILTER (WHERE "createdAt" < ${curStart}))::int AS prev
        FROM link_interactions
        WHERE counted AND "routeKey" IS NOT NULL AND "createdAt" >= ${prevStart}
          AND (${includeDemo}::boolean OR NOT "isDemo")
        GROUP BY 2, 3`,
    ]);
    const fold = (rows: Row[], key: 'id' | 'route') => {
      const m = new Map<string, Record<string, { cur: number; prev: number }>>();
      for (const r of rows) {
        const k = r[key];
        if (!k) continue;
        const rec = m.get(k) ?? {};
        rec[r.type] = { cur: r.cur, prev: r.prev };
        m.set(k, rec);
      }
      return m;
    };
    const value: DemandStats = {
      byLink: fold(linkRows, 'id'),
      byRoute: fold(routeRows, 'route'),
      includesDemo: includeDemo,
      generatedAt: new Date(),
    };
    this.statsCache = { at: Date.now(), value };
    return value;
  }

  async hotInfo(
    rec: Record<string, { cur: number; prev: number }> | undefined,
    scarcityPct: number | null,
  ): Promise<HotInfo> {
    const c = await this.settings.cfgMany([
      'hot.weights',
      'hot.minEvents',
      'hot.minScore',
      'hot.minTrendPct',
      'hot.scarcityPct',
    ]);
    let score = 0;
    let prevScore = 0;
    let events = 0;
    for (const [type, v] of Object.entries(rec ?? {})) {
      const w = (c['hot.weights'][type] ?? 0) as number;
      score += w * v.cur;
      prevScore += w * v.prev;
      events += v.cur;
    }
    const trendPct = prevScore > 0 ? ((score - prevScore) / prevScore) * 100 : score > 0 ? 100 : 0;
    // A trend needs a previous-period baseline; brand-new activity alone is not "hot" by trend (cold-start guard).
    const hot =
      events >= c['hot.minEvents'] &&
      score >= c['hot.minScore'] &&
      ((prevScore > 0 && trendPct >= c['hot.minTrendPct']) ||
        (scarcityPct !== null && scarcityPct <= c['hot.scarcityPct']));
    return { score, prevScore, events, trendPct: Math.round(trendPct), hot, scarcityPct };
  }

  async unmetRoutes(sinceDays: number): Promise<{ routeKey: string; n: number }[]> {
    const includeDemo = await this.settings.cfg<boolean>('demo.countInMetrics');
    const since = new Date(Date.now() - sinceDays * 86400_000);
    return this.prisma.$queryRaw<{ routeKey: string; n: number }[]>`
      SELECT "routeKey", COUNT(*)::int AS n FROM link_interactions
      WHERE unmet AND counted AND "routeKey" IS NOT NULL AND "createdAt" >= ${since}
        AND (${includeDemo}::boolean OR NOT "isDemo")
      GROUP BY 1 ORDER BY n DESC LIMIT 50`;
  }

  @Interval(6 * 3600_000)
  async purge() {
    const days = await this.settings.cfg<number>('retention.interactionDays');
    const cutoff = new Date(Date.now() - days * 86400_000);
    await this.prisma.$executeRaw`
      DELETE FROM link_interactions WHERE id IN (
        SELECT id FROM link_interactions WHERE "createdAt" < ${cutoff} AND NOT "isDemo" LIMIT 10000)`;
  }
}

@Controller()
@UseGuards(AuthGuard)
export class InteractionsController {
  constructor(
    private readonly svc: InteractionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('interactions')
  @Perms('link:read')
  @HttpCode(204)
  async post(
    @CurrentUser() u: AuthUser,
    @Body()
    b: { type: 'SEARCH' | 'VIEW'; linkId?: string; from?: string; to?: string; minMbps?: number },
  ) {
    if (b.type !== 'SEARCH' && b.type !== 'VIEW') {
      throw new HttpException(
        { code: 'INVALID_TYPE', message: 'Only SEARCH and VIEW may be reported by clients' },
        400,
      );
    }
    const link = b.linkId
      ? await this.prisma.networkLink.findFirst({
          where: {
            id: String(b.linkId),
            deletedAt: null,
            status: 'ACTIVE',
            operatorProfile: { approvalStatus: 'APPROVED' },
          },
          select: { id: true, originName: true, destinationName: true },
        })
      : null;
    if (b.linkId && !link)
      throw new HttpException({ code: 'NODE_NOT_FOUND', message: 'Unknown link' }, 404);
    // Route searches may only reference cities that exist, so arbitrary keys cannot inflate demand.
    for (const name of [b.from, b.to]) {
      if (name === undefined) continue;
      if (typeof name !== 'string' || !name.trim() || name.length > 80) {
        throw new HttpException({ code: 'NODE_NOT_FOUND', message: 'Invalid node' }, 400);
      }
      const exists = await this.prisma.networkLink.findFirst({
        where: {
          status: 'ACTIVE',
          OR: [
            { originName: { equals: name.trim(), mode: 'insensitive' } },
            { destinationName: { equals: name.trim(), mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (!exists)
        throw new HttpException({ code: 'NODE_NOT_FOUND', message: 'Unknown node' }, 404);
    }
    await this.svc.record(u, b.type, {
      link,
      from: b.from,
      to: b.to,
      minMbps:
        typeof b.minMbps === 'number' && Number.isInteger(b.minMbps) && b.minMbps >= 0
          ? b.minMbps
          : undefined,
    });
  }

  @Get('admin/interactions')
  @Roles('ADMIN')
  async audit(
    @Query('userId') userId?: string,
    @Query('linkId') linkId?: string,
    @Query('type') type?: InteractionType,
  ) {
    const where: Prisma.LinkInteractionWhereInput = {
      ...(userId && { userId }),
      ...(linkId && { networkLinkId: linkId }),
      ...(type && { type }),
    };
    return this.prisma.linkInteraction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

export { nodeKey };

@Module({
  controllers: [InteractionsController],
  providers: [InteractionsService],
  exports: [InteractionsService],
})
export class InteractionsModule {}
