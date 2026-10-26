'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, errMessage, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, RequireRole, Status } from '@/components/ui';

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { t, tr, locale } = useI18n();
  const { hasRole } = useAuth();
  const [r, setR] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const fmt = (n: number, cur: string) => money(n, cur, locale === 'id' ? 'id-ID' : 'en-US');
  const load = useCallback(
    () =>
      api(`/reservations/${id}`)
        .then(setR)
        .catch((e) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (!r) return <p className="text-slate-400">{error ?? t('common.loading')}</p>;
  const pay = r.payments[0];

  async function cancel() {
    try {
      setR(await api(`/reservations/${id}/cancel`, { method: 'POST' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function payWallet() {
    setError(null);
    try {
      setR(await api(`/reservations/${id}/pay-wallet`, { method: 'POST' }));
    } catch (e) {
      setError(errMessage(e, t));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/reservations" className="text-sm text-sky-400">
        &larr; {t('nav.reservations')}
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-2xl font-bold text-white">{r.reference}</h1>
        <Status value={r.status} />
      </div>
      <div className="card divide-y divide-slate-800 !p-0">
        {r.items.map((i: any) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
            <div>
              <Link
                href={`/links/${i.networkLink.id}`}
                className="font-medium text-white hover:text-sky-400"
              >
                {tr(i.networkLink.name)}
              </Link>
              <p className="text-sm text-slate-400">
                {i.networkLink.operatorProfile.displayName} - {i.termMonths} {t('common.months')}
              </p>
              <p className="text-xs text-slate-500">
                {t('res.lock')}: {t(`status.${i.lockStatus}`)}
              </p>
            </div>
            <span className="font-semibold text-white">{fmt(i.lineTotal, r.currency)}</span>
          </div>
        ))}
      </div>
      <div className="card space-y-2 text-sm">
        <div className="flex justify-between text-slate-400">
          <span>{t('cart.subtotal')}</span>
          <span>{fmt(r.subtotal, r.currency)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>{t('cart.tax')}</span>
          <span>{fmt(r.taxAmount, r.currency)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-800 pt-2 text-lg font-semibold text-white">
          <span>{t('cart.total')}</span>
          <span>{fmt(r.totalAmount, r.currency)}</span>
        </div>
        {pay && (
          <div className="flex items-center justify-between border-t border-slate-800 pt-2">
            <span className="text-slate-400">
              {t('res.payment')} ({pay.provider})
            </span>
            <Status value={pay.status} />
          </div>
        )}
        {r.status === 'AWAITING_PAYMENT' && r.expiresAt && (
          <p className="text-amber-300">
            {t('res.expires')}:{' '}
            {new Date(r.expiresAt).toLocaleTimeString(locale === 'id' ? 'id-ID' : 'en-US')}
          </p>
        )}
        <ErrorNote error={error} />
        {r.status === 'AWAITING_PAYMENT' && hasRole('PENYEWA') && (
          <div className="flex gap-3 pt-2">
            {pay?.checkoutUrl && /^https?:\/\//i.test(pay.checkoutUrl) && (
              <a className="btn-primary" href={pay.checkoutUrl}>
                {t('res.payNow')}
              </a>
            )}
            <button className="btn-primary" onClick={payWallet}>
              {t('res.payWallet')}
            </button>
            <button className="btn-ghost" onClick={cancel}>
              {t('res.cancel')}
            </button>
          </div>
        )}
        {r.status === 'CONFIRMED' && <p className="text-emerald-300">{t('res.confirmed')}</p>}
      </div>
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
