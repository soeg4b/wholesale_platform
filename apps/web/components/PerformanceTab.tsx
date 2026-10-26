'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DemoBadge, PerfChip, ScoreBar, Status } from './ui';

export function PerformanceTab() {
  const { t, tr } = useI18n();
  const [data, setData] = useState<{ items: any[]; includesDemo: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api('/operator/performance')
      .then(setData)
      .catch(() => setData({ items: [], includesDemo: false }));
  }, []);
  if (!data) return <p className="text-slate-400">{t('common.loading')}</p>;
  const d = (v: unknown, u = '') => (v === null || v === undefined ? '-' : `${v}${u}`);
  const sorted = data.items.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <div className="space-y-3">
      {data.includesDemo && <DemoBadge />}
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <thead>
            <tr>
              {[
                'link.name',
                'perf.score',
                'perf.kpi.uptime',
                'perf.kpi.latencyP95',
                'perf.kpi.outages',
                'perf.tickets.open',
                'perf.tickets.mttr',
                'perf.tickets.breach',
                'perf.demand',
              ].map((h) => (
                <th key={h} className="th">
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sorted.map((r) => (
              <Fragment key={r.linkId}>
                <tr
                  className="cursor-pointer hover:bg-slate-900"
                  onClick={() => setOpen(open === r.linkId ? null : r.linkId)}
                >
                  <td className="td">
                    {tr(r.name)}
                    <span className="block text-xs text-slate-500">
                      {r.originName} &rarr; {r.destinationName}
                    </span>
                  </td>
                  <td className="td">
                    <PerfChip perf={r} />
                  </td>
                  <td className="td">
                    {d(r.kpis?.uptimePct, '%')}
                    {r.kpis?.slaAvailabilityBreach && (
                      <span className="text-amber-300" title={t('perf.kpi.slaBreach')}>
                        {' '}
                        &#9888;
                      </span>
                    )}
                  </td>
                  <td className="td">{d(r.kpis?.latencyMs?.p95, ' ms')}</td>
                  <td className="td">
                    {r.kpis ? `${r.kpis.outages.count} / ${r.kpis.outages.totalMinutes} min` : '-'}
                  </td>
                  <td className="td">{d(r.kpis?.tickets?.openCount)}</td>
                  <td className="td">{d(r.kpis?.tickets?.mttrMin, ' min')}</td>
                  <td className="td">{d(r.kpis?.tickets?.slaBreachRatePct, '%')}</td>
                  <td className="td">
                    {r.demand.hot && (
                      <span className="badge bg-amber-500/20 text-amber-300">
                        &#128293; {t('chip.hot')}
                      </span>
                    )}{' '}
                    {r.demand.events} ({r.demand.trendPct >= 0 ? '+' : ''}
                    {r.demand.trendPct}%)
                  </td>
                </tr>
                {open === r.linkId && (
                  <tr>
                    <td colSpan={9} className="bg-slate-950 p-4 text-sm">
                      {r.rated ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {Object.entries(r.components ?? {}).map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">{t(`perf.component.${k}`)}</span>
                              <ScoreBar value={v as number | null} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-400">
                          {t(`perf.reason.${r.reason ?? 'NO_TELEMETRY'}`)}
                        </p>
                      )}
                      {r.basis && (
                        <p className="mt-2 text-xs text-slate-500">
                          {t('perf.basis', {
                            days: r.basis.windowDays,
                            samples: r.basis.samples,
                            coverage: r.basis.coverageDays,
                            at: new Date(r.basis.computedAt).toLocaleString(),
                          })}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {t('link.status')}: <Status value={r.availability} /> -{' '}
                        {t('perf.utilization')}: {d(r.utilizationPct, '%')}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t('perf.table.note')}</p>
    </div>
  );
}
