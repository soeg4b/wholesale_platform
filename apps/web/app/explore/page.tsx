'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, capacity, errMessage, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DemoBadge, ErrorNote, PerfChip, RequireRole } from '@/components/ui';
import type { GraphEdge, GraphNode } from '@/components/ExplorerMap';

const ExplorerMap = dynamic(() => import('@/components/ExplorerMap'), {
  ssr: false,
  loading: () => <div className="h-[520px] animate-pulse rounded-xl bg-slate-900" />,
});

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hotRanking: {
    linkId: string;
    name: any;
    from: string;
    to: string;
    operator: string;
    score: number;
    trendPct: number;
    priceFrom: number | null;
    currency: string;
  }[];
  promos: any[];
  basis: { includesDemo: boolean; windowDays: number };
}

const SORTS = ['default', 'price', 'latency', 'score', 'hot'];

function Explorer() {
  const { t, tr, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [minGbps, setMinGbps] = useState(params.get('minGbps') ?? '');
  const [sort, setSort] = useState('default');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const fmt = (n: number | null | undefined, cur = 'IDR') =>
    money(n, cur, locale === 'id' ? 'id-ID' : 'en-US');

  useEffect(() => {
    api<Graph>('/explorer/graph')
      .then(setGraph)
      .catch((e) => setGraphError(errMessage(e, t)));
    // eslint-disable-next-line
  }, []);

  const nodeName = useMemo(() => new Map(graph?.nodes.map((n) => [n.key, n.name])), [graph]);

  const sync = useCallback(
    (f: string, z: string, g: string) => {
      const q = new URLSearchParams();
      if (f) q.set('from', f);
      if (z) q.set('to', z);
      if (g) q.set('minGbps', g);
      router.replace(`/explore${q.toString() ? `?${q}` : ''}`);
    },
    [router],
  );

  // Fetch routes whenever both ends are chosen; min capacity is debounced.
  useEffect(() => {
    if (!from || !to || from === to) {
      setData(null);
      return;
    }
    let stale = false; // ignore responses that arrive after the selection changed
    const id = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ from, to });
        if (minGbps) qs.set('minMbps', String(Number(minGbps) * 1000));
        if (sort !== 'default') qs.set('sort', sort);
        const res = await api(`/explorer/routes?${qs}`);
        if (!stale) setData(res);
      } catch (e) {
        if (stale) return;
        setData(null);
        setError(errMessage(e, t));
        // An unknown node in the URL clears the selection instead of leaving a broken state.
        if (e instanceof ApiError && e.code === 'NODE_NOT_FOUND') {
          setFrom('');
          setTo('');
          sync('', '', minGbps);
        }
      } finally {
        if (!stale) setLoading(false);
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line
  }, [from, to, minGbps, sort]);

  const pick = (key: string) => {
    let f = from;
    let z = to;
    if (!f) f = key;
    else if (key === f) f = '';
    else if (key === z) z = '';
    else z = key;
    setFrom(f);
    setTo(z);
    sync(f, z, minGbps);
  };
  const swap = () => {
    setFrom(to);
    setTo(from);
    sync(to, from, minGbps);
  };
  const clear = () => {
    setFrom('');
    setTo('');
    setData(null);
    sync('', '', minGbps);
  };

  const highlight = hover ? hover.split('>') : null;
  const edgeLabel = (e: GraphEdge, a: string, b: string) =>
    `${a} - ${b}: ${e.linkCount} link, ${capacity(e.availableMbps)} ${t('route.available').toLowerCase()}, ${t('route.from')} ${fmt(e.minPrice, e.currency)}` +
    (e.bestLatencyMs !== null ? `, ${e.bestLatencyMs} ms` : '') +
    (e.hot ? `, ${t('chip.hot')} +${e.trendPct}%` : '');

  if (graphError) return <ErrorNote error={graphError} />;
  if (!graph) return <p className="text-slate-400">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('explore.title')}</h1>
          <p className="text-sm text-slate-400">{t('explore.subtitle')}</p>
        </div>
        {graph.basis.includesDemo && <DemoBadge />}
      </div>

      <div className="card flex flex-wrap items-end gap-3 !p-3">
        <div className="min-w-[160px] flex-1">
          <label className="label" htmlFor="a-end">
            {t('explore.aEnd')}
          </label>
          <select
            id="a-end"
            className="input"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              sync(e.target.value, to, minGbps);
            }}
          >
            <option value="">{t('explore.pickA')}</option>
            {graph.nodes
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((n) => (
                <option key={n.key} value={n.key} disabled={n.key === to}>
                  {n.name} ({n.linkCount})
                </option>
              ))}
          </select>
        </div>
        <button
          className="btn-ghost"
          onClick={swap}
          aria-label={t('explore.swap')}
          disabled={!from && !to}
        >
          &#8644;
        </button>
        <div className="min-w-[160px] flex-1">
          <label className="label" htmlFor="z-end">
            {t('explore.zEnd')}
          </label>
          <select
            id="z-end"
            className="input"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              sync(from, e.target.value, minGbps);
            }}
          >
            <option value="">{t('explore.pickZ')}</option>
            {graph.nodes
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((n) => (
                <option key={n.key} value={n.key} disabled={n.key === from}>
                  {n.name} ({n.linkCount})
                </option>
              ))}
          </select>
        </div>
        <div className="w-32">
          <label className="label" htmlFor="min-g">
            {t('explore.minCapacity')}
          </label>
          <input
            id="min-g"
            className="input"
            type="number"
            min={0}
            step="any"
            placeholder="Gbps"
            value={minGbps}
            onChange={(e) => {
              setMinGbps(e.target.value);
              sync(from, to, e.target.value);
            }}
          />
        </div>
        <div className="w-44">
          <label className="label" htmlFor="sort">
            {t('mp.sort')}
          </label>
          <select
            id="sort"
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`explore.sort.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-ghost" onClick={clear}>
          {t('explore.clear')}
        </button>
        <Link className="btn-ghost" href={`/marketplace`}>
          {t('explore.asList')}
        </Link>
      </div>
      <p className="sr-only" aria-live="polite">
        {from && to && data
          ? t('explore.announce', {
              a: nodeName.get(from) ?? from,
              z: nodeName.get(to) ?? to,
              n: data.routes.length,
            })
          : ''}
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div>
          {graph.nodes.length === 0 ? (
            <div className="card text-center text-slate-400">{t('explore.empty')}</div>
          ) : (
            <ExplorerMap
              nodes={graph.nodes}
              edges={graph.edges}
              aKey={from || null}
              zKey={to || null}
              highlight={highlight}
              onPick={pick}
              height="min(70vh, 640px)"
              labels={{
                hot: t('chip.hot'),
                edge: edgeLabel,
                node: (n) => `${n.name} - ${n.linkCount} link`,
              }}
            />
          )}
          <details className="mt-2 text-xs text-slate-400">
            <summary className="cursor-pointer">{t('explore.legend')}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>{t('explore.legend.node')}</li>
              <li>{t('explore.legend.edge')}</li>
              <li>{t('explore.legend.dashed')}</li>
              <li>{t('explore.legend.hot')}</li>
              <li>{t('explore.legend.straight')}</li>
            </ul>
          </details>
        </div>

        <aside
          className="space-y-3 lg:max-h-[calc(70vh+90px)] lg:overflow-y-auto"
          aria-label={t('explore.panel')}
        >
          {!from && !to && (
            <>
              <p className="text-sm text-slate-300">{t('explore.hint')}</p>
              <section className="card space-y-2">
                <h2 className="font-semibold text-white">{t('explore.hot.title')}</h2>
                {graph.hotRanking.length === 0 && (
                  <p className="text-sm text-slate-500">{t('explore.hot.none')}</p>
                )}
                {graph.hotRanking.map((h) => (
                  <Link
                    key={h.linkId}
                    href={`/links/${h.linkId}`}
                    className="flex items-center justify-between gap-2 rounded-lg p-2 text-sm hover:bg-slate-800"
                  >
                    <span>
                      <span className="badge bg-amber-500/20 text-amber-300">
                        &#128293; {t('chip.hot')}
                      </span>{' '}
                      <span className="text-white">
                        {h.from} &rarr; {h.to}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {h.operator} - {tr(h.name)}
                      </span>
                    </span>
                    <span className="text-right text-xs text-slate-300">
                      +{h.trendPct}%<br />
                      {fmt(h.priceFrom, h.currency)}
                    </span>
                  </Link>
                ))}
              </section>
              <section className="card space-y-2">
                <h2 className="font-semibold text-white">{t('explore.promo.title')}</h2>
                {graph.promos.length === 0 && (
                  <p className="text-sm text-slate-500">{t('explore.promo.none')}</p>
                )}
                {graph.promos.map((p) => (
                  <div key={p.ruleId} className="rounded-lg bg-slate-950 p-2 text-sm">
                    <span className="text-white">{p.name}</span>
                    <span className="ml-2 text-emerald-300">
                      {p.adjustment?.mode === 'PERCENT'
                        ? `${p.adjustment.value}%`
                        : p.adjustment?.value}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {p.operator}
                      {p.validUntil
                        ? ` - ${t('route.until')} ${new Date(p.validUntil).toLocaleDateString(locale === 'id' ? 'id-ID' : 'en-US')}`
                        : ''}
                    </span>
                  </div>
                ))}
              </section>
            </>
          )}

          {from && !to && (
            <p className="card text-sm text-slate-300">
              {t('explore.pickZHint', { a: nodeName.get(from) ?? from })}
            </p>
          )}
          {loading &&
            [1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-800" />
            ))}
          <ErrorNote error={error} />

          {data && !loading && (
            <>
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>{t('explore.routesFound', { n: data.routes.length })}</span>
                {data.basis.includesDemo && <DemoBadge />}
              </div>
              {data.unmet && (
                <div className="card space-y-2 text-sm">
                  <p className="font-semibold text-white">
                    {t('explore.unmet', {
                      a: nodeName.get(from) ?? from,
                      z: nodeName.get(to) ?? to,
                    })}
                  </p>
                  <p className="text-slate-400">{t('explore.unmetHint')}</p>
                  <p className="text-xs text-slate-500">{t('explore.unmetLogged')}</p>
                </div>
              )}
              {data.routes.map((r: any) => (
                <article
                  key={r.id}
                  className={`card space-y-3 focus-within:border-brand-500 ${hover === r.id ? 'border-emerald-400' : ''}`}
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-slate-700 text-slate-200">
                      {r.hops === 1 ? t('route.direct') : t('route.hops', { n: r.hops })}
                    </span>
                    {r.indicative && (
                      <span className="badge bg-amber-500/20 text-amber-300">
                        {t('route.indicative')}
                      </span>
                    )}
                    {r.hot && (
                      <span className="badge bg-amber-500/20 text-amber-300">
                        &#128293; {t('chip.hot')} +{r.hotInfo?.trendPct}%
                      </span>
                    )}
                    <span className="text-sm text-slate-300">{r.operators.join(' + ')}</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {r.id
                      .split('>')
                      .map((k: string) => nodeName.get(k) ?? k)
                      .join(' \u2192 ')}
                  </p>
                  {r.indicative && (
                    <p className="text-xs text-amber-200/80">{t('route.indicativeNote')}</p>
                  )}
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">{t('route.priceRange')}</dt>
                      <dd className="text-white">
                        {r.priceRange.min === r.priceRange.max
                          ? fmt(r.priceRange.min, r.priceRange.currency)
                          : `${fmt(r.priceRange.min, r.priceRange.currency)} - ${fmt(r.priceRange.max, r.priceRange.currency)}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">{t('route.bestLatency')}</dt>
                      <dd className="text-white">
                        {r.bestLatencyMs === null ? t('route.noData') : `${r.bestLatencyMs} ms`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">{t('route.available')}</dt>
                      <dd className="text-white">{capacity(r.availableMbps)}</dd>
                    </div>
                  </dl>
                  {r.promos.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.promos.map((p: any) => (
                        <span
                          key={p.ruleId}
                          className="badge bg-emerald-500/15 text-emerald-300"
                          title={p.operator}
                        >
                          {p.isPromotion ? '\u2605 ' : ''}
                          {p.name} (
                          {p.adjustment?.mode === 'PERCENT'
                            ? `${p.adjustment.value}%`
                            : p.adjustment?.value}
                          )
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    <PerfChip
                      perf={
                        r.chips.performance.rated
                          ? { rated: true, score: r.chips.performance.minScore }
                          : { rated: false }
                      }
                    />
                    {r.chips.slaPercent && (
                      <span className="badge bg-slate-700 text-slate-200">
                        SLA {r.chips.slaPercent}%
                      </span>
                    )}
                    {r.chips.redundancy && (
                      <span className="badge bg-slate-700 text-slate-200">
                        {t('chip.redundancy')} {Math.round(r.chips.redundancy.min * 100)}-
                        {Math.round(r.chips.redundancy.max * 100)}%
                      </span>
                    )}
                    {r.chips.kmz && <span className="badge bg-sky-500/15 text-sky-300">KMZ</span>}
                    {r.chips.addOns.map((k: string) => (
                      <span key={k} className="badge bg-violet-500/15 text-violet-300">
                        + {t(`chip.addon.${k}`)}
                      </span>
                    ))}
                  </div>
                  <button
                    className="text-xs text-sky-400 underline"
                    aria-expanded={open === r.id}
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                  >
                    {open === r.id ? t('route.hideLegs') : t('route.showLegs')}
                  </button>
                  {open === r.id && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-500">{t('route.perLegReserve')}</p>
                      {r.legs.map((lg: any) => (
                        <div key={lg.from + lg.to}>
                          <p className="text-xs font-medium text-slate-300">
                            {nodeName.get(lg.from)} &rarr; {nodeName.get(lg.to)}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {lg.candidates.map((c: any) => (
                              <li key={c.linkId}>
                                <Link
                                  href={`/links/${c.linkId}`}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 p-2 text-xs hover:bg-slate-800"
                                >
                                  <span className="text-slate-200">
                                    {c.operator.displayName} {c.hot && '\u{1F525}'}
                                  </span>
                                  <span className="text-slate-400">
                                    {c.latencyMs ?? '-'} ms - {capacity(c.availableMbps)} -{' '}
                                    {fmt(c.priceFrom, c.currency)}
                                  </span>
                                  <PerfChip perf={c.performance} />
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RequireRole>
        <Explorer />
      </RequireRole>
    </Suspense>
  );
}
