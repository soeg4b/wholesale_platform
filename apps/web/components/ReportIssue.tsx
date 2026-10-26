'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote } from './ui';

export function ReportIssue({ linkId }: { linkId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    kind: 'DEGRADATION',
    severity: 'SEV3',
    title: '',
    description: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tk = await api('/tickets', { body: { linkId, ...form } });
      router.push(`/tickets/${tk.id}`);
    } catch (err) {
      setError(errMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-ghost w-full" onClick={() => setOpen(true)}>
        {t('ticket.report')}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[2000] grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('ticket.report')}
        >
          <form onSubmit={submit} className="card w-full max-w-lg space-y-3">
            <h2 className="text-lg font-semibold text-white">{t('ticket.report')}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="kind">
                  {t('ticket.kind')}
                </label>
                <select
                  id="kind"
                  className="input"
                  value={form.kind}
                  onChange={(e) => set('kind', e.target.value)}
                >
                  {['DEGRADATION', 'OUTAGE', 'OTHER'].map((k) => (
                    <option key={k} value={k}>
                      {t(`ticket.kind.${k}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sev">
                  {t('ticket.severity')}
                </label>
                <select
                  id="sev"
                  className="input"
                  value={form.severity}
                  onChange={(e) => set('severity', e.target.value)}
                >
                  {['SEV1', 'SEV2', 'SEV3'].map((k) => (
                    <option key={k} value={k}>
                      {t(`ticket.severity.${k}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="title">
                {t('ticket.title')}
              </label>
              <input
                ref={first}
                id="title"
                className="input"
                required
                maxLength={160}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="desc">
                {t('ticket.description')}
              </label>
              <textarea
                id="desc"
                className="input min-h-[110px]"
                required
                minLength={10}
                maxLength={4000}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div role="alert">
              <ErrorNote error={error} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" disabled={busy}>
                {t('ticket.submit')}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
