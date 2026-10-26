'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DemoBadge, ErrorNote, InsufficientNote } from './ui';

type Item = {
  code: string;
  severity: 'info' | 'warn' | 'high';
  linkName?: string;
  text: { id: string; en: string };
  evidence: Record<string, unknown>;
  params: Record<string, any>;
};
type Section = { insufficient?: boolean; needed?: number; have?: number; items?: Item[] };

const ICON = { high: '\u26A0', warn: '\u25B2', info: '\u2139' } as const;
const TONE = { high: 'text-red-300', warn: 'text-amber-300', info: 'text-sky-300' } as const;

function Items({ section, onAction }: { section: Section; onAction?: (i: Item) => void }) {
  const { t, locale } = useI18n();
  if (section.insufficient)
    return <InsufficientNote needed={section.needed ?? 0} have={section.have ?? 0} />;
  if (!section.items?.length) return <p className="text-sm text-slate-500">{t('insight.none')}</p>;
  return (
    <ul className="space-y-2">
      {section.items.map((i, idx) => (
        <li key={idx} className="rounded-lg bg-slate-950 p-3 text-sm">
          <p className="text-slate-200">
            <span className={TONE[i.severity]} aria-label={t(`insight.severity.${i.severity}`)}>
              {ICON[i.severity]}{' '}
            </span>
            {i.text[locale]}
          </p>
          <details className="mt-1 text-xs text-slate-500">
            <summary className="cursor-pointer">{t('insight.basis')}</summary>
            <pre className="mt-1 overflow-auto">{JSON.stringify(i.evidence, null, 1)}</pre>
          </details>
          {onAction && i.code === 'ADDON_OPPORTUNITY' && (
            <button className="btn-ghost mt-2 !py-1 text-xs" onClick={() => onAction(i)}>
              {i.params.action === 'LIST_ADDON'
                ? t('insight.action.list')
                : t('insight.action.create')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function InsightsTab({ onGoto }: { onGoto: (tab: string) => void }) {
  const { t, locale } = useI18n();
  const [report, setReport] = useState<any | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api('/seller/insights/latest')
        .then((r) => setReport(r ?? null))
        .catch((e) => setError(errMessage(e, t))),
    [t],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setReport(await api('/seller/insights/generate', { body: {} }));
    } catch (e) {
      setError(errMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  const s = report?.facts?.sections;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {report && (
          <>
            <span className="badge bg-sky-500/15 text-sky-300">
              {t('insight.engine')}: {report.engine}
            </span>
            <span className="text-xs text-slate-400">
              {new Date(report.createdAt).toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')}
            </span>
            {report.includesDemo && <DemoBadge />}
          </>
        )}
        <button className="btn-primary ml-auto" disabled={busy} onClick={generate}>
          {busy ? t('common.loading') : t('insight.generate')}
        </button>
      </div>
      <ErrorNote error={error} />
      {report === null && <div className="card text-slate-400">{t('insight.empty')}</div>}
      {report && s && (
        <>
          <section className="card space-y-2">
            <h2 className="font-semibold text-white">{t('insight.narrative')}</h2>
            <p className="text-slate-200">{report.narrative?.summary?.[locale]}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
              {(report.narrative?.actions ?? []).map((a: any, i: number) => (
                <li key={i}>{a[locale]}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">{t('insight.narrativeNote')}</p>
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold text-white">{t('insight.section.demand')}</h2>
            {(
              ['topSearched', 'bestSelling', 'rising', 'congestionRisk', 'unmetDemand'] as const
            ).map((k) => (
              <div key={k}>
                <h3 className="mb-1 text-sm font-medium text-slate-300">{t(`insight.${k}`)}</h3>
                <Items section={s.demand[k]} />
              </div>
            ))}
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold text-white">{t('insight.section.addons')}</h2>
            <p className="text-xs text-slate-500">{t('insight.addonsNote')}</p>
            <Items section={s.addOns} onAction={() => onGoto('addons')} />
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold text-white">{t('insight.section.improvements')}</h2>
            <Items section={s.improvements} />
          </section>
        </>
      )}
    </div>
  );
}
