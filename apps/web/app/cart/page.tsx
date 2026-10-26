'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, RequireRole } from '@/components/ui';

function Cart() {
  const { t, tr, locale } = useI18n();
  const router = useRouter();
  const [cart, setCart] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = (n: number, cur = 'IDR') => money(n, cur, locale === 'id' ? 'id-ID' : 'en-US');

  const load = useCallback(
    () =>
      api('/cart')
        .then(setCart)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    setCart(await api(`/cart/items/${id}`, { method: 'DELETE' }));
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/cart/checkout', { method: 'POST' });
      const url: string | undefined = r.payments?.[0]?.checkoutUrl;
      if (url && /^https?:\/\//i.test(url)) window.location.href = url;
      else router.push(`/reservations/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!cart) return <p className="text-slate-400">{error ?? t('common.loading')}</p>;
  const cur = cart.currency;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-white">{t('cart.title')}</h1>
      {cart.items.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>{t('cart.empty')}</p>
          <Link href="/marketplace" className="btn-primary mt-4">
            {t('nav.marketplace')}
          </Link>
        </div>
      ) : (
        <>
          <div className="card divide-y divide-slate-800 !p-0">
            {cart.items.map((i: any) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link
                    href={`/links/${i.networkLink.id}`}
                    className="font-medium text-white hover:text-sky-400"
                  >
                    {tr(i.networkLink.name)}
                  </Link>
                  <p className="text-sm text-slate-400">
                    {i.networkLink.operatorProfile.displayName} - {i.termMonths}{' '}
                    {t('common.months')}
                  </p>
                  {(i.appliedRules as any[] | null)?.map((r) => (
                    <p key={r.ruleId} className="text-xs text-emerald-300">
                      {r.name}
                    </p>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-white">{fmt(i.lineTotal, cur)}</span>
                  <button className="btn-ghost" onClick={() => remove(i.id)}>
                    {t('common.remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="card space-y-2 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>{t('cart.subtotal')}</span>
              <span>{fmt(cart.subtotal, cur)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>{t('cart.tax')}</span>
              <span>{fmt(cart.taxAmount, cur)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-2 text-lg font-semibold text-white">
              <span>{t('cart.total')}</span>
              <span>{fmt(cart.totalAmount, cur)}</span>
            </div>
            <p className="text-xs text-slate-500">{t('cart.lockNote')}</p>
            <ErrorNote error={error} />
            <button className="btn-primary w-full" disabled={busy} onClick={checkout}>
              {busy ? t('common.loading') : t('cart.checkout')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYEWA']}>
      <Cart />
    </RequireRole>
  );
}
