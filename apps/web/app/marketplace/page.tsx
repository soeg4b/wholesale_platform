'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, capacity, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PerfChip, RequireRole, Status } from '@/components/ui';

interface Facets {
  operators: { id: string; displayName: string }[];
  cities: string[];
  categories: string[];
  ranges: {
    price: { min: number; max: number };
    latencyMs: { min: number; max: number };
    capacityMbps: { min: number; max: number };
  };
}

const EMPTY = {
  city: '',
  origin: '',
  destination: '',
  category: '',
  operatorIds: [] as string[],
  minCapGbps: '',
  maxLatencyMs: '',
  maxPrice: '',
  minSla: '',
  minScore: '',
  hasGeometry: false,
  availableOnly: true,
  sort: 'price_asc',
};

function Marketplace() {
  const { t, tr, locale } = useI18n();
  const [facets, setFacets] = useState<Facets | null>(null);
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: any[]; total: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Facets>('/links/facets')
      .then(setFacets)
      .catch(() => undefined);
    // Deep links from notifications / provider pages: /marketplace?operatorId=..&city=..
    const q = new URLSearchParams(window.location.search);
    const ops = q.get('operatorId');
    const city = q.get('city');
    if (ops || city)
      setF((p) => ({ ...p, operatorIds: ops ? ops.split(',') : [], city: city ?? '' }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (f.city) qs.set('city', f.city);
    if (f.origin) qs.set('origin', f.origin);
    if (f.destination) qs.set('destination', f.destination);
    if (f.category) qs.set('category', f.category);
    if (f.operatorIds.length) qs.set('operatorId', f.operatorIds.join(','));
    if (f.minCapGbps) qs.set('minCapacityMbps', String(Number(f.minCapGbps) * 1000));
    if (f.maxLatencyMs) qs.set('maxLatencyMs', f.maxLatencyMs);
    if (f.maxPrice) qs.set('maxPrice', f.maxPrice);
    if (f.minSla) qs.set('minSlaPercent', f.minSla);
    if (f.minScore) qs.set('minScore', f.minScore);
    if (f.hasGeometry) qs.set('hasGeometry', 'true');
    if (f.availableOnly) qs.set('availableOnly', 'true');
    qs.set('sort', f.sort);
    qs.set('page', String(page));
    try {
      setData(await api(`/links?${qs}`));
    } finally {
      setLoading(false);
    }
  }, [f, page]);

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  const set = (k: keyof typeof EMPTY, v: string | boolean | string[]) => {
    setPage(1);
    setF((p) => ({ ...p, [k]: v }));
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="card h-fit space-y-4">
        <h2 className="font-semibold text-white">{t('mp.filters')}</h2>
        <div>
          <label className="label">{t('mp.city')}</label>
          <select className="input" value={f.city} onChange={(e) => set('city', e.target.value)}>
            <option value="">{t('mp.any')}</option>
            {facets?.cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {(['origin', 'destination'] as const).map((k) => (
          <div key={k}>
            <label className="label">{t(`mp.${k}`)}</label>
            <select className="input" value={f[k]} onChange={(e) => set(k, e.target.value)}>
              <option value="">{t('mp.any')}</option>
              {facets?.cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        ))}
        <fieldset>
          <legend className="label">{t('mp.operator')}</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {facets?.operators.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={f.operatorIds.includes(o.id)}
                  onChange={(e) =>
                    set(
                      'operatorIds',
                      e.target.checked
                        ? [...f.operatorIds, o.id]
                        : f.operatorIds.filter((x) => x !== o.id),
                    )
                  }
                />
                {o.displayName}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label">{t('mp.category')}</label>
          <select
            className="input"
            value={f.category}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">{t('mp.any')}</option>
            {facets?.categories.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('mp.minCapacity')} (Gbps)</label>
          <input
            className="input"
            type="number"
            min={0}
            step="any"
            placeholder={
              facets
                ? `${facets.ranges.capacityMbps.min / 1000} - ${facets.ranges.capacityMbps.max / 1000}`
                : ''
            }
            value={f.minCapGbps}
            onChange={(e) => set('minCapGbps', e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('mp.maxLatency')} (ms)</label>
          <input
            className="input"
            type="number"
            min={0}
            step="any"
            placeholder={
              facets ? `${facets.ranges.latencyMs.min} - ${facets.ranges.latencyMs.max}` : ''
            }
            value={f.maxLatencyMs}
            onChange={(e) => set('maxLatencyMs', e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('mp.maxPrice')}</label>
          <input
            className="input"
            type="number"
            min={0}
            placeholder={
              facets
                ? `${facets.ranges.price.min.toLocaleString()} - ${facets.ranges.price.max.toLocaleString()}`
                : ''
            }
            value={f.maxPrice}
            onChange={(e) => set('maxPrice', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">{t('mp.minSla')} (%)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step="any"
              value={f.minSla}
              onChange={(e) => set('minSla', e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('mp.minScore')}</label>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={f.minScore}
              onChange={(e) => set('minScore', e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={f.hasGeometry}
            onChange={(e) => set('hasGeometry', e.target.checked)}
          />
          {t('mp.hasGeometry')}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={f.availableOnly}
            onChange={(e) => set('availableOnly', e.target.checked)}
          />
          {t('mp.availableOnly')}
        </label>
        <button
          className="btn-ghost w-full"
          onClick={() => {
            setF(EMPTY);
            setPage(1);
          }}
        >
          {t('mp.reset')}
        </button>
      </aside>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">
            {loading ? t('common.loading') : t('mp.results', { n: data?.total ?? 0 })}
          </p>
          <select
            className="input !w-auto"
            value={f.sort}
            onChange={(e) => set('sort', e.target.value)}
            aria-label={t('mp.sort')}
          >
            {['price_asc', 'price_desc', 'latency_asc', 'capacity_desc', 'newest'].map((s) => (
              <option key={s} value={s}>
                {t(`mp.sort.${s}`)}
              </option>
            ))}
          </select>
        </div>

        {data?.items.length === 0 && (
          <div className="card text-center text-slate-400">{t('mp.empty')}</div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          {data?.items.map((l) => (
            <Link
              key={l.id}
              href={`/links/${l.id}`}
              className="card block transition hover:border-brand-500"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-sky-400">
                    {l.operator.displayName} - {l.category.replace('_', ' ')}
                  </p>
                  <h3 className="mt-1 font-semibold text-white">{tr(l.name)}</h3>
                  <p className="text-sm text-slate-400">
                    {l.originName} &rarr; {l.destinationName}
                  </p>
                </div>
                <Status value={l.availability} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">{t('link.capacity')}</dt>
                  <dd className="text-white">{capacity(l.capacityMbps)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t('link.latency')}</dt>
                  <dd className="text-white">{l.latencyMs ?? '-'} ms</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">SLA</dt>
                  <dd className="text-white">{l.slaPercent ?? '-'}%</dd>
                </div>
              </dl>
              <div className="mt-4 flex items-end justify-between border-t border-slate-800 pt-3">
                <div>
                  <p className="text-xs text-slate-500">{t('link.priceFrom')}</p>
                  <p className="text-lg font-semibold text-white">
                    {money(l.priceFrom, l.currency, locale === 'id' ? 'id-ID' : 'en-US')}
                    <span className="text-xs font-normal text-slate-400">
                      {' '}
                      /{t('common.month')}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  <PerfChip perf={l.performance} />
                  {l.hasGeometry && (
                    <span className="badge bg-sky-500/15 text-sky-300">{t('link.hasMap')}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              &larr;
            </button>
            <span className="text-sm text-slate-400">
              {page} / {pages}
            </span>
            <button
              className="btn-ghost"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              &rarr;
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYEWA', 'PENYELENGGARA']}>
      <Marketplace />
    </RequireRole>
  );
}
