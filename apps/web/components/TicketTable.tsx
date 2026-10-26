'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Status, ErrorNote } from '@/components/ui';
import { SlaCountdown } from '@/components/SlaCountdown';

export function TicketTable({ operator = false }: { operator?: boolean }) {
  const { t, tr, locale } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');

  useEffect(() => {
    const load = () => {
      const qs = new URLSearchParams({ pageSize: '50' });
      if (status) qs.set('status', status);
      if (source) qs.set('source', source);
      api(`/tickets?${qs}`)
        .then((r) => {
          setRows(r.items);
          setLoadError(null);
        })
        .catch(() => setLoadError(t('ticket.loadError')));
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, [status, source]);

  // Breached first, then the soonest deadline.
  const sorted = (rows ?? []).slice().sort((a, b) => {
    const breach = (x: any) =>
      (x.ackBreachedAt || x.resolveBreachedAt) && !['RESOLVED', 'CLOSED'].includes(x.status)
        ? 0
        : 1;
    return (
      breach(a) - breach(b) ||
      new Date(a.resolveDueAt).getTime() - new Date(b.resolveDueAt).getTime()
    );
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <select
          className="input !w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('link.status')}
        >
          <option value="">{t('mp.any')}</option>
          {['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <select
          className="input !w-auto"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label={t('ticket.source')}
        >
          <option value="">{t('mp.any')}</option>
          {['BUYER', 'OPERATOR', 'SYSTEM'].map((s) => (
            <option key={s} value={s}>
              {t(`ticket.source.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {loadError && <ErrorNote error={loadError} />}
      {rows && rows.length === 0 && !loadError && (
        <div className="card text-slate-400">{t('ticket.empty')}</div>
      )}
      {sorted.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  'ticket.ref',
                  'link.name',
                  'ticket.severity',
                  'ticket.kind',
                  'ticket.source',
                  'link.status',
                  'ticket.sla',
                  'ticket.opened',
                ].map((h) => (
                  <th key={h} className="th">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td className="td">
                    <Link className="text-sky-400 hover:underline" href={`/tickets/${r.id}`}>
                      {r.reference}
                    </Link>
                  </td>
                  <td className="td">
                    {tr(r.networkLink.name)}
                    {operator ? (
                      ''
                    ) : (
                      <span className="block text-xs text-slate-500">
                        {r.operatorProfile.displayName}
                      </span>
                    )}
                  </td>
                  <td className="td">{r.severity}</td>
                  <td className="td">{t(`ticket.kind.${r.kind}`)}</td>
                  <td className="td">
                    <span className="badge bg-slate-700 text-slate-200">
                      {t(`ticket.source.${r.source}`)}
                    </span>
                  </td>
                  <td className="td">
                    <Status value={r.status} />
                  </td>
                  <td className="td text-xs">
                    <SlaCountdown ticket={r} />
                  </td>
                  <td className="td whitespace-nowrap text-xs">
                    {new Date(r.createdAt).toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
