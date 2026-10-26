'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DemoBadge, ScoreBar } from './ui';

interface Perf {
  rated: boolean;
  reason?: string | null;
  score?: number | null;
  components?: Record<string, number | null> | null;
  basis?: {
    windowDays: number;
    samples: number;
    coverageDays: number;
    computedAt: string;
    includesDemo: boolean;
  } | null;
  kpis?: any;
  outageList?: {
    reference: string;
    incidentStartAt: string;
    incidentEndAt: string | null;
    status: string;
  }[];
}

export function PerformanceCard({
  linkId,
  perf,
}: {
  linkId: string;
  perf: Perf | null | undefined;
}) {
  const { t, locale } = useI18n();
  const [tickets, setTickets] = useState<any>(null);
  useEffect(() => {
    api(`/links/${linkId}/tickets/summary?days=30`)
      .then(setTickets)
      .catch(() => setTickets(null));
  }, [linkId]);
  if (!perf) return null;
  const when = (iso?: string) =>
    iso ? new Date(iso).toLocaleString(locale === 'id' ? 'id-ID' : 'en-US') : '-';
  const dash = (v: unknown, unit = '') =>
    v === null || v === undefined ? t('perf.insufficient') : `${v}${unit}`;

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-white">{t('perf.title')}</h2>
        {perf.basis?.includesDemo && <DemoBadge />}
      </div>

      {!perf.rated ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          <p className="font-medium text-slate-200">{t('perf.notRated')}</p>
          <p>{t(`perf.reason.${perf.reason ?? 'NO_TELEMETRY'}`)}</p>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-bold text-white" title={t('perf.basisInfo')}>
              {perf.score}
            </span>
            <span className="pb-1 text-slate-400">/ 100</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(perf.components ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-400">{t(`perf.component.${k}`)}</span>
                <ScoreBar value={v} label={t(`perf.component.${k}`)} />
              </div>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              [t('perf.kpi.uptime'), dash(perf.kpis?.uptimePct, '%')],
              [t('perf.kpi.slaTarget'), dash(perf.kpis?.slaTargetPct, '%')],
              [t('perf.kpi.latencyMean'), dash(perf.kpis?.latencyMs?.mean, ' ms')],
              [t('perf.kpi.latencyP95'), dash(perf.kpis?.latencyMs?.p95, ' ms')],
              [t('perf.kpi.jitter'), dash(perf.kpis?.latencyMs?.stddev, ' ms')],
              [
                t('perf.kpi.outages'),
                `${perf.kpis?.outages?.count ?? 0} / ${perf.kpis?.outages?.totalMinutes ?? 0} min`,
              ],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="text-white">{v}</dd>
              </div>
            ))}
          </dl>
          {perf.kpis?.slaAvailabilityBreach && (
            <p className="text-sm text-amber-300">&#9888; {t('perf.kpi.slaBreach')}</p>
          )}
        </>
      )}

      {tickets && (
        <div>
          <h3 className="mb-1 text-sm font-medium text-slate-300">
            {t('perf.tickets', { n: tickets.periodDays })}
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [t('perf.tickets.count'), tickets.count],
              [t('perf.tickets.open'), tickets.openCount],
              [t('perf.tickets.mtta'), dash(tickets.mttaMin, ' min')],
              [t('perf.tickets.mttr'), dash(tickets.mttrMin, ' min')],
              [t('perf.tickets.breach'), dash(tickets.slaBreachRatePct, '%')],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {perf.basis && (
        <p className="border-t border-slate-800 pt-2 text-xs text-slate-500">
          {t('perf.basis', {
            days: perf.basis.windowDays,
            samples: perf.basis.samples,
            coverage: perf.basis.coverageDays,
            at: when(perf.basis.computedAt),
          })}
        </p>
      )}

      {perf.outageList && perf.outageList.length > 0 && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer">{t('perf.outageList')}</summary>
          <ul className="mt-1 space-y-0.5">
            {perf.outageList.map((o) => (
              <li key={o.reference}>
                {o.reference}: {when(o.incidentStartAt)} &rarr;{' '}
                {o.incidentEndAt ? when(o.incidentEndAt) : t('perf.ongoing')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
