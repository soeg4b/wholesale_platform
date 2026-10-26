'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, RequireRole, Status } from '@/components/ui';
import { SlaCountdown } from '@/components/SlaCountdown';

const STEPS = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { t, tr, locale } = useI18n();
  const { user, hasRole } = useAuth();
  const [tk, setTk] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const when = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString(locale === 'id' ? 'id-ID' : 'en-US') : '-';
  const load = useCallback(
    () =>
      api(`/tickets/${id}`)
        .then(setTk)
        .catch((e) => setError(errMessage(e, t))),
    [id, t],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setNote('');
      setReply('');
      await load();
    } catch (e) {
      setError(errMessage(e, t));
      load();
    }
  }

  if (!tk) return <p className="text-slate-400">{error ?? t('common.loading')}</p>;
  const staff = hasRole('ADMIN') || hasRole('PENYELENGGARA');
  const reporter = tk.reporterUserId === user?.id;
  const go = (to: string, label: string, ghost = false) => (
    <button
      key={to}
      className={ghost ? 'btn-ghost' : 'btn-primary'}
      onClick={() =>
        run(() => api(`/tickets/${id}/transition`, { body: { to, note: note || undefined } }))
      }
    >
      {label}
    </button>
  );
  const actions: React.ReactNode[] = [];
  if (staff) {
    if (tk.status === 'OPEN') actions.push(go('ACKNOWLEDGED', t('ticket.actions.ack')));
    if (tk.status === 'ACKNOWLEDGED') actions.push(go('IN_PROGRESS', t('ticket.actions.start')));
    if (['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(tk.status))
      actions.push(go('RESOLVED', t('ticket.actions.resolve'), tk.status === 'OPEN'));
  }
  if (tk.status === 'RESOLVED') {
    if (reporter || hasRole('ADMIN')) actions.push(go('CLOSED', t('ticket.confirm')));
    if (reporter || staff) actions.push(go('OPEN', t('ticket.reopen'), true));
  }
  const stepIndex = STEPS.indexOf(tk.status);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/tickets" className="text-sm text-sky-400">
        &larr; {t('nav.tickets')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-sm text-sky-400">{tk.reference}</p>
          <h1 className="text-xl font-bold text-white">{tk.title}</h1>
          <p className="text-sm text-slate-400">
            <Link className="hover:text-sky-400" href={`/links/${tk.networkLink.id}`}>
              {tr(tk.networkLink.name)}
            </Link>{' '}
            - {tk.operatorProfile.displayName}
          </p>
        </div>
        <Status value={tk.status} />
      </div>

      <ol className="flex flex-wrap gap-2 text-xs" aria-label={t('ticket.stepper')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`badge ${i < stepIndex ? 'bg-emerald-500/15 text-emerald-300' : i === stepIndex ? 'bg-sky-500/20 font-bold text-sky-200' : 'bg-slate-800 text-slate-500'}`}
          >
            {i < stepIndex ? '\u2713 ' : ''}
            {t(`status.${s}`)}
          </li>
        ))}
      </ol>

      <div className="card space-y-2 text-sm">
        <p className="whitespace-pre-wrap text-slate-200">{tk.description}</p>
        <dl className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">{t('ticket.severity')}</dt>
            <dd className="text-white">{tk.severity}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('ticket.kind')}</dt>
            <dd className="text-white">{t(`ticket.kind.${tk.kind}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('ticket.source')}</dt>
            <dd className="text-white">{t(`ticket.source.${tk.source}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('ticket.sla')}</dt>
            <dd>
              <SlaCountdown ticket={tk} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('ticket.due.ack')}</dt>
            <dd className="text-white">{when(tk.ackDueAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('ticket.due.resolve')}</dt>
            <dd className="text-white">{when(tk.resolveDueAt)}</dd>
          </div>
          {tk.source === 'SYSTEM' && (
            <div className="col-span-2">
              <dt className="text-xs text-slate-500">{t('ticket.system')}</dt>
              <dd className="text-slate-300">
                {when(tk.incidentStartAt)} &rarr;{' '}
                {tk.incidentEndAt ? when(tk.incidentEndAt) : t('perf.ongoing')}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {tk.publicReply && (
        <div className="card border-sky-500/40 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase text-sky-300">
            {t('ticket.publicReply')}
          </p>
          <p className="text-slate-200">{tk.publicReply.text}</p>
        </div>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">{t('ticket.timeline')}</h2>
        <ol className="space-y-2 text-sm">
          {tk.updates.map((u: any) => (
            <li
              key={u.id}
              className={`rounded-lg p-2 ${u.isInternal ? 'border border-dashed border-amber-500/40 bg-amber-500/5' : 'bg-slate-950'}`}
            >
              <span className="text-xs text-slate-500">
                {when(u.at)} - {u.actor.name}
                {u.isInternal ? ` (${t('ticket.internalNote')})` : ''}
              </span>
              <p className="text-slate-200">
                {u.fromStatus && u.toStatus
                  ? `${t(`status.${u.fromStatus}`)} \u2192 ${t(`status.${u.toStatus}`)}`
                  : u.type === 'CREATED'
                    ? t('ticket.created')
                    : u.type === 'SLA_BREACH'
                      ? `\u26A0 ${u.message}`
                      : ''}
                {u.message && u.type !== 'SLA_BREACH' ? ` ${u.message}` : ''}
              </p>
            </li>
          ))}
        </ol>

        <ErrorNote error={error} />
        {tk.status !== 'CLOSED' && (
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <label className="label" htmlFor="note">
              {t('ticket.note')}
            </label>
            <textarea
              id="note"
              className="input min-h-[70px]"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {actions}
              <button
                className="btn-ghost"
                disabled={!note.trim()}
                onClick={() =>
                  run(() => api(`/tickets/${id}/updates`, { body: { message: note } }))
                }
              >
                {t('ticket.comment')}
              </button>
              {staff && (
                <button
                  className="btn-ghost"
                  disabled={!note.trim()}
                  onClick={() =>
                    run(() =>
                      api(`/tickets/${id}/updates`, { body: { message: note, isInternal: true } }),
                    )
                  }
                >
                  {t('ticket.internalNote')}
                </button>
              )}
              {staff && !tk.publicReply && (
                <button
                  className="btn-ghost"
                  disabled={!note.trim()}
                  onClick={() =>
                    run(() =>
                      api(`/tickets/${id}/updates`, {
                        body: { message: note, isPublicReply: true },
                      }),
                    )
                  }
                >
                  {t('ticket.publicReply')}
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">{t('ticket.autoClose')}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole>
      <Detail />
    </RequireRole>
  );
}
