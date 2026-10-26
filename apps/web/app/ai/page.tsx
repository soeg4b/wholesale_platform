'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, capacity, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Map } from '@/components/Map';
import { ErrorNote, RequireRole } from '@/components/ui';

const COLORS = ['#38bdf8', '#f472b6', '#facc15'];

function Analyzer() {
  const { t, locale } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [routes, setRoutes] = useState<
    { id: string; geojson: GeoJSON.FeatureCollection; color: string; label: string }[]
  >([]);
  const fmt = (n: number, cur: string) => money(n, cur, locale === 'id' ? 'id-ID' : 'en-US');

  async function run() {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await api('/ai/analyze', { body: { prompt, locale: locale.toUpperCase() } });
      setRes(r);
      setSel([r.recommendedRank ?? 1, ...(r.redundancyRank ? [r.redundancyRank] : [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!res) return;
    let cancelled = false;
    (async () => {
      const out: typeof routes = [];
      for (const [idx, rank] of sel.entries()) {
        const opt = res.options.find((o: any) => o.rank === rank);
        if (!opt) continue;
        for (const seg of opt.segments) {
          try {
            const g = await api<GeoJSON.FeatureCollection>(`/geo/link/${seg.linkId}`);
            if (g.features.length)
              out.push({
                id: `${rank}-${seg.linkId}`,
                geojson: g,
                color: COLORS[idx % COLORS.length],
                label: `#${rank} ${seg.operator}`,
              });
          } catch {
            /* link without geometry */
          }
        }
      }
      if (!cancelled) setRoutes(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [res, sel]);

  const toggle = (rank: number) =>
    setSel((s) => (s.includes(rank) ? s.filter((x) => x !== rank) : [...s, rank].slice(-3)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('ai.title')}</h1>
        <p className="text-sm text-slate-400">{t('ai.subtitle')}</p>
      </div>

      <div className="card space-y-3">
        <textarea
          className="input min-h-[96px]"
          maxLength={1000}
          placeholder={t('ai.placeholder')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {['ai.example1', 'ai.example2'].map((k) => (
            <button key={k} className="btn-ghost !py-1 text-xs" onClick={() => setPrompt(t(k))}>
              {t(k)}
            </button>
          ))}
        </div>
        <ErrorNote error={error} />
        <button className="btn-primary" disabled={busy || prompt.trim().length < 5} onClick={run}>
          {busy ? t('ai.analyzing') : t('ai.analyze')}
        </button>
      </div>

      {res && (
        <div className="space-y-6">
          <div className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="badge bg-sky-500/15 text-sky-300">
                {t('ai.engine')}: {res.engine} ({res.model})
              </span>
              {res.intent.origin && (
                <span className="badge bg-slate-700 text-slate-200">
                  {res.intent.origin} &rarr; {res.intent.destination ?? '?'}
                </span>
              )}
              {res.intent.minCapacityMbps && (
                <span className="badge bg-slate-700 text-slate-200">
                  &ge; {capacity(res.intent.minCapacityMbps)}
                </span>
              )}
              {res.intent.maxLatencyMs && (
                <span className="badge bg-slate-700 text-slate-200">
                  &le; {res.intent.maxLatencyMs} ms
                </span>
              )}
            </div>
            {res.fallbackReason && (
              <p className="text-xs text-amber-300">
                {t('ai.fallback')}: {res.fallbackReason}
              </p>
            )}
            <p className="text-lg text-white">{res.summary}</p>
          </div>

          {res.options.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-4">
                {res.options.map((o: any) => (
                  <div
                    key={o.rank}
                    className={`card space-y-3 ${sel.includes(o.rank) ? 'border-brand-500' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-800 text-sm font-bold text-white">
                          {o.rank}
                        </span>
                        <div>
                          <p className="font-medium text-white">{o.operators.join(' + ')}</p>
                          <div className="flex gap-1">
                            {o.rank === res.recommendedRank && (
                              <span className="badge bg-emerald-500/15 text-emerald-300">
                                {t('ai.recommended')}
                              </span>
                            )}
                            {o.rank === res.redundancyRank && (
                              <span className="badge bg-pink-500/15 text-pink-300">
                                {t('ai.backup')}
                              </span>
                            )}
                            {!o.meetsConstraints && (
                              <span className="badge bg-red-500/15 text-red-300">
                                {t('ai.notMeet')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button className="btn-ghost !py-1 text-xs" onClick={() => toggle(o.rank)}>
                        {sel.includes(o.rank) ? t('ai.hideMap') : t('ai.showMap')}
                      </button>
                    </div>
                    <ul className="space-y-1 text-sm">
                      {o.segments.map((s: any) => (
                        <li key={s.linkId} className="flex justify-between gap-2 text-slate-300">
                          <Link className="hover:text-sky-400" href={`/links/${s.linkId}`}>
                            {s.from} &rarr; {s.to}
                          </Link>
                          <span className="text-slate-400">
                            {s.latencyMs} ms - {fmt(s.monthlyPrice, o.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <dl className="grid grid-cols-4 gap-2 border-t border-slate-800 pt-3 text-xs">
                      <div>
                        <dt className="text-slate-500">{t('ai.latency')}</dt>
                        <dd className="text-white">{o.totalLatencyMs} ms</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">P95</dt>
                        <dd className="text-white">{o.predictedLatencyMs.p95 ?? '-'} ms</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">{t('ai.cost')}</dt>
                        <dd className="text-white">{fmt(o.monthlyCost, o.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">SLA</dt>
                        <dd className="text-white">{o.compositeSlaPercent ?? '-'}%</dd>
                      </div>
                    </dl>
                    {(o.notes.pros.length > 0 || o.notes.cons.length > 0) && (
                      <ul className="space-y-0.5 text-xs">
                        {o.notes.pros.map((p: string) => (
                          <li key={p} className="text-emerald-300">
                            + {p}
                          </li>
                        ))}
                        {o.notes.cons.map((p: string) => (
                          <li key={p} className="text-amber-300">
                            - {p}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                <Map routes={routes} height={380} />
                {[
                  ['ai.costBenefit', res.costBenefit],
                  ['ai.redundancy', res.redundancyAdvice],
                  ['ai.latencyPrediction', res.latencyPrediction],
                ].map(
                  ([k, v]) =>
                    v && (
                      <div key={k} className="card">
                        <h3 className="text-sm font-semibold text-white">{t(k)}</h3>
                        <p className="mt-1 text-sm text-slate-300">{v}</p>
                      </div>
                    ),
                )}
                {res.risks?.length > 0 && (
                  <div className="card">
                    <h3 className="text-sm font-semibold text-white">{t('ai.risks')}</h3>
                    <ul className="mt-1 list-disc pl-5 text-sm text-slate-300">
                      {res.risks.map((r: string) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYEWA']}>
      <Analyzer />
    </RequireRole>
  );
}
