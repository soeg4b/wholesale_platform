'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, capacity, errMessage, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Map } from '@/components/Map';
import { DemoBadge, ErrorNote, RequireRole, Status } from '@/components/ui';

function Catalog() {
  const { t, tr, locale } = useI18n();
  const { hasRole } = useAuth();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const [rows, setRows] = useState<any[] | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [operators, setOperators] = useState<{ id: string; displayName: string }[]>([]);
  const [q, setQ] = useState({ city: '', operatorId: '' });
  const [term, setTerm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q.city) qs.set('city', q.city);
    if (q.operatorId) qs.set('operatorId', q.operatorId);
    api(`/prebuild?${qs}`)
      .then(setRows)
      .catch((e) => setError(errMessage(e, t)));
  }, [q, t]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api<{ name: string }[]>('/reference/locations')
      .then((r) => setCities(r.map((x) => x.name)))
      .catch(() => undefined);
    api<{ operators: { id: string; displayName: string }[] }>('/links/facets')
      .then((r) => setOperators(r.operators))
      .catch(() => undefined);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  };

  const routes = (rows ?? [])
    .filter((p) => p.originLat !== null && p.destinationLat !== null)
    .map((p) => ({
      id: p.id,
      color: p.earlyBirdActive ? '#facc15' : '#94a3b8',
      label: tr(p.name),
      geojson: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { name: `${tr(p.name)} - ${p.progressPct}%` },
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [p.originLng, p.originLat],
                [p.destinationLng, p.destinationLat],
              ],
            },
          },
        ],
      },
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('pb.title')}</h1>
        <p className="text-slate-400">{t('pb.subtitle')}</p>
      </div>
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('mp.city')}</label>
          <select
            className="input"
            value={q.city}
            onChange={(e) => setQ({ ...q, city: e.target.value })}
          >
            <option value="">{t('mp.any')}</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('mp.operator')}</label>
          <select
            className="input"
            value={q.operatorId}
            onChange={(e) => setQ({ ...q, operatorId: e.target.value })}
          >
            <option value="">{t('mp.any')}</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorNote error={error} />
      <Map routes={routes} height={300} />
      <div className="grid gap-4 md:grid-cols-2">
        {rows?.map((p) => (
          <div key={p.id} id={p.id} className="card space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-lg font-semibold text-white">{tr(p.name)}</p>
                <p className="text-xs text-sky-400">
                  <Link href={`/providers/${p.operator.id}`} className="hover:underline">
                    {p.operator.displayName}
                  </Link>{' '}
                  - {p.category} - {capacity(p.capacityMbps)} {p.isDemo && <DemoBadge />}
                </p>
              </div>
              <Status value={p.status} />
            </div>
            {p.description && <p className="text-sm text-slate-400">{tr(p.description)}</p>}
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>{t('pb.progress')}</span>
                <span>
                  {p.progressPct}% - {t('pb.ready')}{' '}
                  {new Date(p.targetReadyDate).toLocaleDateString(loc)}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-800">
                <div
                  className="h-2 rounded-full bg-sky-400"
                  style={{ width: `${p.progressPct}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-xl font-bold text-white">
                {money(p.currentPrice, p.currency, loc)}
              </span>
              <span className="text-xs text-slate-400">/ {t('req.month')}</span>
              {p.earlyBirdActive && (
                <>
                  <span className="text-sm text-slate-500 line-through">
                    {money(p.basePrice, p.currency, loc)}
                  </span>
                  <span className="badge bg-yellow-500/15 text-yellow-300">
                    {t('pb.earlyBird')} -{p.discountPct}%
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-slate-400">
              {p.earlyBirdActive
                ? t('pb.slots', {
                    n: p.slotsLeft,
                    date: new Date(p.earlyBirdUntil).toLocaleDateString(loc),
                  })
                : t('pb.earlyClosed')}{' '}
              - {p.commitments} {t('pb.pledges')} - {t('pb.minTerm', { n: p.minTermMonths })}
            </p>
            {hasRole('PENYEWA') &&
              (p.myCommitment && p.myCommitment.status !== 'CANCELLED' ? (
                <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 p-2 text-sm text-emerald-200">
                  <span>
                    {t('pb.committed', {
                      price: money(p.myCommitment.lockedPrice, p.currency, loc),
                      n: p.myCommitment.termMonths,
                    })}
                  </span>
                  {p.myCommitment.status === 'PLEDGED' && (
                    <button
                      className="text-xs text-red-300"
                      onClick={() =>
                        run(() => api(`/prebuild/${p.id}/commit`, { method: 'DELETE' }))
                      }
                    >
                      {t('pb.withdraw')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    className="input !w-28 text-sm"
                    type="number"
                    min={p.minTermMonths}
                    aria-label={t('req.term')}
                    value={term[p.id] ?? String(p.minTermMonths)}
                    onChange={(e) => setTerm({ ...term, [p.id]: e.target.value })}
                  />
                  <button
                    className="btn-primary !py-1 text-sm"
                    onClick={() =>
                      run(() =>
                        api(`/prebuild/${p.id}/commit`, {
                          body: { termMonths: Number(term[p.id] ?? p.minTermMonths) },
                        }),
                      )
                    }
                  >
                    {t('pb.commit')}
                  </button>
                </div>
              ))}
          </div>
        ))}
        {rows && !rows.length && <p className="text-slate-500">{t('pb.empty')}</p>}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole>
      <Catalog />
    </RequireRole>
  );
}
