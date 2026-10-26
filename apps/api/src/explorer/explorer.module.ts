import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Injectable,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { nodeKey, routeKeyOf } from '../common/nodes';
import {
  InteractionsModule,
  InteractionsService,
  HotInfo,
} from '../interactions/interactions.module';
import { LinksModule } from '../links/links.module';
import { PricingService } from '../links/pricing.service';
import { PerformanceService, QualityModule } from '../quality/quality.module';

const err = (status: number, code: string, message: string) =>
  new HttpException({ code, message }, status);

type LinkRow = Prisma.NetworkLinkGetPayload<{
  select: {
    id: true;
    name: true;
    category: true;
    originName: true;
    destinationName: true;
    originLat: true;
    originLng: true;
    destinationLat: true;
    destinationLng: true;
    capacityMbps: true;
    availableMbps: true;
    availability: true;
    basePrice: true;
    currency: true;
    latencyMs: true;
    slaPercent: true;
    redundancyScore: true;
    geospatialDataId: true;
    operatorProfileId: true;
    operatorProfile: { select: { id: true; displayName: true } };
  };
}>;

interface Candidate {
  linkId: string;
  operator: { id: string; displayName: string };
  priceFrom: number;
  currency: string;
  latencyMs: number | null;
  availableMbps: number | null;
  slaPercent: number | null;
  redundancyScore: number | null;
  performance: { rated: boolean; score: number | null };
  hot: boolean;
  hasGeometry: boolean;
}

@Injectable()
export class ExplorerService {
  private cache = new Map<string, { at: number; value: any }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly interactions: InteractionsService,
    private readonly perf: PerformanceService,
  ) {}

  private async load() {
    const links = await this.prisma.networkLink.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        operatorProfile: { approvalStatus: 'APPROVED', deletedAt: null },
      },
      select: {
        id: true,
        name: true,
        category: true,
        originName: true,
        destinationName: true,
        originLat: true,
        originLng: true,
        destinationLat: true,
        destinationLng: true,
        capacityMbps: true,
        availableMbps: true,
        availability: true,
        basePrice: true,
        currency: true,
        latencyMs: true,
        slaPercent: true,
        redundancyScore: true,
        geospatialDataId: true,
        operatorProfileId: true,
        operatorProfile: { select: { id: true, displayName: true } },
      },
    });
    const opIds = [...new Set(links.map((l) => l.operatorProfileId))];
    const now = new Date();
    const rules = await this.prisma.pricingRule.findMany({
      where: {
        operatorProfileId: { in: opIds },
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
    });
    return {
      links,
      rules,
      opIds,
      names: new Map(links.map((l) => [l.operatorProfileId, l.operatorProfile.displayName])),
    };
  }

  private priceFrom(l: LinkRow, rules: Awaited<ReturnType<ExplorerService['load']>>['rules']) {
    return l.basePrice === null
      ? null
      : this.pricing.compute(
          l,
          rules.filter((r) => r.operatorProfileId === l.operatorProfileId),
          { termMonths: 12 },
        ).unitPrice;
  }

  private scarcity(links: LinkRow[]) {
    const cap = links.reduce((s, l) => s + (l.capacityMbps ?? 0), 0);
    const known = links.every((l) => l.capacityMbps !== null && l.availableMbps !== null);
    if (!known || cap === 0) return null;
    return (links.reduce((s, l) => s + (l.availableMbps ?? 0), 0) / cap) * 100;
  }

  private async promos(
    rules: Awaited<ReturnType<ExplorerService['load']>>['rules'],
    names: Map<string, string>,
    linkIds?: Set<string>,
    opIds?: Set<string>,
  ) {
    const platform = await this.settings.cfg<any[]>('promo.platform');
    const name = (id: string) => names.get(id) ?? '';
    const own = rules
      .filter(
        (r) =>
          !linkIds ||
          !opIds ||
          (r.networkLinkId ? linkIds.has(r.networkLinkId) : opIds.has(r.operatorProfileId)),
      )
      .filter(
        (r) =>
          (r.adjustment as { value?: number }).value !== undefined &&
          ((r.adjustment as { value: number }).value ?? 0) < 0,
      )
      .map((r) => ({
        ruleId: r.id,
        operator: name(r.operatorProfileId),
        operatorId: r.operatorProfileId,
        linkId: r.networkLinkId,
        name: r.name,
        type: r.type,
        isPromotion: r.type === 'PROMOTION',
        adjustment: r.adjustment,
        conditions: r.conditions,
        validUntil: r.validUntil,
      }));
    return [
      ...own,
      ...(Array.isArray(platform) && !linkIds
        ? platform.map((p, i) => ({
            ruleId: `platform-${i}`,
            operator: 'Platform',
            isPromotion: true,
            ...p,
          }))
        : []),
    ];
  }

  async graph(minMbpsIn?: number) {
    // Normalised so arbitrary query values cannot create unbounded cache entries.
    const minMbps =
      minMbpsIn !== undefined && Number.isFinite(minMbpsIn) && minMbpsIn > 0
        ? Math.min(Math.floor(minMbpsIn), 10_000_000)
        : undefined;
    const includeDemo = await this.settings.cfg<boolean>('demo.countInMetrics');
    const key = `graph:${minMbps ?? ''}:${includeDemo}`;
    const ttl = (await this.settings.cfg<number>('explorer.cacheSeconds')) * 1000;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    if (this.cache.size >= 50) this.cache.clear();

    const { links, rules, names } = await this.load();
    const demand = await this.interactions.stats();
    const limit = await this.settings.cfg<number>('explorer.hotRankingLimit');

    type NodeAcc = {
      key: string;
      name: string;
      lat: number[];
      lng: number[];
      linkCount: number;
      availableCount: number;
    };
    const nodes = new Map<string, NodeAcc>();
    const touch = (name: string, lat: number | null, lng: number | null, available: boolean) => {
      const k = nodeKey(name);
      const n = nodes.get(k) ?? {
        key: k,
        name: name.trim(),
        lat: [],
        lng: [],
        linkCount: 0,
        availableCount: 0,
      };
      if (lat !== null && lng !== null) {
        n.lat.push(lat);
        n.lng.push(lng);
      }
      n.linkCount++;
      if (available) n.availableCount++;
      nodes.set(k, n);
    };

    const edges = new Map<string, LinkRow[]>();
    for (const l of links) {
      const ok =
        l.availability === 'AVAILABLE' &&
        l.basePrice !== null &&
        (!minMbps || (l.availableMbps ?? 0) >= minMbps);
      touch(l.originName, l.originLat, l.originLng, ok);
      touch(l.destinationName, l.destinationLat, l.destinationLng, ok);
      const rk = routeKeyOf(l.originName, l.destinationName);
      edges.set(rk, [...(edges.get(rk) ?? []), l]);
    }

    const outEdges = [];
    for (const [rk, ls] of edges) {
      const [a, b] = rk.split('|');
      const eligible = ls.filter(
        (l) =>
          l.availability === 'AVAILABLE' &&
          l.basePrice !== null &&
          (!minMbps || (l.availableMbps ?? 0) >= minMbps),
      );
      const prices = eligible
        .map((l) => this.priceFrom(l, rules))
        .filter((p): p is number => p !== null);
      const lats = eligible.map((l) => l.latencyMs).filter((v): v is number => v !== null);
      const hot = await this.interactions.hotInfo(
        demand.byRoute.get(rk),
        this.scarcity(eligible.length ? eligible : ls),
      );
      outEdges.push({
        a,
        b,
        linkCount: ls.length,
        availableCount: eligible.length,
        availableMbps: eligible.reduce((s, l) => s + (l.availableMbps ?? 0), 0),
        minPrice: prices.length ? Math.min(...prices) : null,
        currency: ls[0].currency,
        bestLatencyMs: lats.length ? Math.min(...lats) : null,
        hot: hot.hot,
        hotScore: hot.score,
        trendPct: hot.trendPct,
        hasGeometry: ls.some((l) => l.geospatialDataId),
      });
    }

    const ranking = [];
    for (const l of links) {
      const hot = await this.interactions.hotInfo(demand.byLink.get(l.id), this.scarcity([l]));
      if (hot.hot) ranking.push({ l, hot });
    }
    ranking.sort((x, y) => y.hot.score - x.hot.score);

    const value = {
      nodes: [...nodes.values()]
        .filter((n) => n.lat.length)
        .map((n) => ({
          key: n.key,
          name: n.name,
          lat: n.lat.reduce((a, b) => a + b, 0) / n.lat.length,
          lng: n.lng.reduce((a, b) => a + b, 0) / n.lng.length,
          linkCount: n.linkCount,
          availableCount: n.availableCount,
        })),
      edges: outEdges,
      hotRanking: ranking.slice(0, limit).map(({ l, hot }) => ({
        linkId: l.id,
        name: l.name,
        from: l.originName,
        to: l.destinationName,
        operator: l.operatorProfile.displayName,
        score: hot.score,
        trendPct: hot.trendPct,
        priceFrom: this.priceFrom(l, rules),
        currency: l.currency,
      })),
      promos: await this.promos(rules, names),
      basis: {
        includesDemo: demand.includesDemo,
        windowDays: await this.settings.cfg<number>('hot.windowDays'),
        generatedAt: new Date().toISOString(),
      },
    };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async routes(
    user: AuthUser,
    q: { from?: string; to?: string; minMbps?: string; maxHops?: string; sort?: string },
  ) {
    if (typeof q.from !== 'string' || typeof q.to !== 'string' || !q.from.trim() || !q.to.trim()) {
      throw new BadRequestException('from and to are required (single values)');
    }
    const from = nodeKey(q.from);
    const to = nodeKey(q.to);
    if (from === to) throw err(400, 'SAME_NODE', 'A-End and Z-End must differ');
    const minMbps = q.minMbps ? Number(q.minMbps) : undefined;
    if (minMbps !== undefined && (!Number.isFinite(minMbps) || minMbps < 0)) {
      throw new BadRequestException('minMbps must be a non-negative number');
    }
    const cfg = await this.settings.cfgMany([
      'explorer.maxHops',
      'explorer.maxRoutes',
      'explorer.maxParallelPerEdge',
    ]);
    const requestedHops = q.maxHops === undefined ? cfg['explorer.maxHops'] : Number(q.maxHops);
    if (!Number.isInteger(requestedHops) || requestedHops < 1) {
      throw new BadRequestException('maxHops must be a positive integer');
    }
    const maxHops = Math.min(requestedHops, cfg['explorer.maxHops']);

    const { links, rules, names } = await this.load();
    const known = new Set(
      links.flatMap((l) => [nodeKey(l.originName), nodeKey(l.destinationName)]),
    );
    if (!known.has(from) || !known.has(to))
      throw err(404, 'NODE_NOT_FOUND', 'Unknown A-End or Z-End');

    const eligible = links.filter(
      (l) =>
        l.availability === 'AVAILABLE' &&
        l.basePrice !== null &&
        (!minMbps || (l.availableMbps ?? 0) >= minMbps),
    );
    const cand = new Map<string, { link: LinkRow; price: number }[]>();
    const adj = new Map<string, Set<string>>();
    for (const l of eligible) {
      const a = nodeKey(l.originName);
      const b = nodeKey(l.destinationName);
      const rk = routeKeyOf(l.originName, l.destinationName);
      cand.set(rk, [...(cand.get(rk) ?? []), { link: l, price: this.priceFrom(l, rules) ?? 0 }]);
      (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
      (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
    }
    for (const [k, v] of cand)
      cand.set(k, v.sort((x, y) => x.price - y.price).slice(0, cfg['explorer.maxParallelPerEdge']));

    // BFS from Z gives hop distance used to prune the DFS.
    const dist = new Map<string, number>([[to, 0]]);
    const queue = [to];
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of adj.get(n) ?? [])
        if (!dist.has(m)) {
          dist.set(m, dist.get(n)! + 1);
          queue.push(m);
        }
    }
    // Iterative deepening: shorter routes are always enumerated first, so a direct route can never be crowded out.
    const paths: string[][] = [];
    const seen = new Set<string>();
    let truncated = false;
    const dfs = (node: string, path: string[], limit: number) => {
      if (truncated) return;
      if (node === to) {
        const key = path.join('>');
        if (!seen.has(key)) {
          if (paths.length >= cfg['explorer.maxRoutes']) {
            truncated = true;
            return;
          }
          seen.add(key);
          paths.push([...path]);
        }
        return;
      }
      for (const m of adj.get(node) ?? []) {
        if (path.includes(m)) continue;
        if (path.length + (dist.get(m) ?? Infinity) > limit) continue;
        path.push(m);
        dfs(m, path, limit);
        path.pop();
      }
    };
    if (dist.has(from)) for (let limit = 1; limit <= maxHops; limit++) dfs(from, [from], limit);

    const allIds = [
      ...new Set(
        paths.flatMap((p) =>
          p.slice(1).flatMap((n, i) => (cand.get(routeKeyOf(p[i], n)) ?? []).map((c) => c.link.id)),
        ),
      ),
    ];
    const [perf, demand, addOns] = await Promise.all([
      this.perf.many(user, allIds),
      this.interactions.stats(),
      this.prisma.addOnService.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          operatorProfileId: { in: [...new Set(eligible.map((l) => l.operatorProfileId))] },
        },
        select: { operatorProfileId: true, kind: true },
      }),
    ]);

    const routes = [];
    for (const p of paths) {
      const legs = [];
      for (let i = 1; i < p.length; i++) {
        const key = routeKeyOf(p[i - 1], p[i]);
        const cands: Candidate[] = [];
        for (const { link: l, price } of cand.get(key) ?? []) {
          const hot = await this.interactions.hotInfo(demand.byLink.get(l.id), this.scarcity([l]));
          cands.push({
            linkId: l.id,
            operator: l.operatorProfile,
            priceFrom: price,
            currency: l.currency,
            latencyMs: l.latencyMs,
            availableMbps: l.availableMbps,
            slaPercent: l.slaPercent,
            redundancyScore: l.redundancyScore,
            performance: { rated: perf[l.id]?.rated ?? false, score: perf[l.id]?.score ?? null },
            hot: hot.hot,
            hasGeometry: !!l.geospatialDataId,
          });
        }
        legs.push({ from: p[i - 1], to: p[i], candidates: cands });
      }
      const mins = legs.map((lg) => Math.min(...lg.candidates.map((c) => c.priceFrom)));
      const maxs = legs.map((lg) => Math.max(...lg.candidates.map((c) => c.priceFrom)));
      const lats = legs.map((lg) => Math.min(...lg.candidates.map((c) => c.latencyMs ?? Infinity)));
      const ops = [
        ...new Set(legs.flatMap((lg) => lg.candidates.map((c) => c.operator.displayName))),
      ];
      const opIds = new Set(legs.flatMap((lg) => lg.candidates.map((c) => c.operator.id)));
      const linkIds = new Set(legs.flatMap((lg) => lg.candidates.map((c) => c.linkId)));
      const hops = p.length - 1;
      const legLinks = legs.flatMap((lg) =>
        cand.get(routeKeyOf(lg.from, lg.to))!.map((c) => c.link),
      );
      const hotInfo: HotInfo | null =
        hops === 1
          ? await this.interactions.hotInfo(
              demand.byRoute.get(routeKeyOf(p[0], p[1])),
              this.scarcity(legLinks),
            )
          : null;
      const scores = legs.map((lg) =>
        lg.candidates.filter((c) => c.performance.rated).map((c) => c.performance.score as number),
      );
      const reds = legs.flatMap((lg) =>
        lg.candidates.map((c) => c.redundancyScore).filter((v): v is number => v !== null),
      );
      routes.push({
        id: p.join('>'),
        hops,
        indicative: hops > 1, // multi-hop = sum of independent legs, never a single end-to-end guarantee
        legs,
        operators: ops,
        priceRange: {
          min: mins.reduce((a, b) => a + b, 0),
          max: maxs.reduce((a, b) => a + b, 0),
          currency: legLinks[0]?.currency ?? 'IDR',
        },
        bestLatencyMs: lats.every((v) => v !== Infinity)
          ? Math.round(lats.reduce((a, b) => a + b, 0) * 100) / 100
          : null,
        availableMbps: legs.every((lg) => lg.candidates.some((c) => c.availableMbps !== null))
          ? Math.min(
              ...legs.map((lg) => Math.max(...lg.candidates.map((c) => c.availableMbps ?? 0))),
            )
          : null,
        hot: !!hotInfo?.hot,
        hotInfo,
        promos: await this.promos(rules, names, linkIds, opIds),
        chips: {
          addOns: [
            ...new Set(addOns.filter((a) => opIds.has(a.operatorProfileId)).map((a) => a.kind)),
          ],
          redundancy: reds.length ? { min: Math.min(...reds), max: Math.max(...reds) } : null,
          slaPercent:
            Math.min(
              ...legs.map((lg) => Math.max(...lg.candidates.map((c) => c.slaPercent ?? 0))),
            ) || null,
          performance: scores.every((s) => s.length)
            ? { rated: true, minScore: Math.min(...scores.map((s) => Math.max(...s))) }
            : { rated: false, minScore: null },
          kmz: legs.every((lg) => lg.candidates.some((c) => c.hasGeometry)),
        },
      });
    }
    const sorters: Record<string, (a: any, b: any) => number> = {
      price: (a, b) => a.priceRange.min - b.priceRange.min,
      latency: (a, b) => (a.bestLatencyMs ?? 1e9) - (b.bestLatencyMs ?? 1e9),
      score: (a, b) => (b.chips.performance.minScore ?? -1) - (a.chips.performance.minScore ?? -1),
      hot: (a, b) => (b.hotInfo?.score ?? 0) - (a.hotInfo?.score ?? 0),
    };
    routes.sort(
      sorters[q.sort ?? ''] ?? ((a, b) => a.hops - b.hops || a.priceRange.min - b.priceRange.min),
    );

    // Unmet demand only counts when the full search depth was used; a hop-restricted search is the user's choice.
    const unmet = routes.length === 0 && maxHops >= cfg['explorer.maxHops'];
    this.interactions.track(user, 'SEARCH', { from: q.from, to: q.to, minMbps, unmet });
    return {
      from,
      to,
      unmet,
      routes,
      basis: {
        includesDemo: demand.includesDemo,
        generatedAt: new Date().toISOString(),
        maxHops,
        truncated,
      },
    };
  }
}

@Controller('explorer')
@UseGuards(AuthGuard)
@Perms('link:read')
export class ExplorerController {
  constructor(private readonly svc: ExplorerService) {}

  @Get('graph')
  graph(@Query('minMbps') minMbps?: string) {
    return this.svc.graph(minMbps ? Number(minMbps) : undefined);
  }

  @Get('routes')
  routes(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.svc.routes(u, q);
  }
}

@Module({
  imports: [InteractionsModule, LinksModule, QualityModule],
  controllers: [ExplorerController],
  providers: [ExplorerService],
  exports: [ExplorerService],
})
export class ExplorerModule {}
