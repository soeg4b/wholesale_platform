'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, RequireRole } from '@/components/ui';

// Stand-in for a hosted gateway page (Midtrans/Xendit/Stripe) when payment.provider = mock.
function MockPay() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function complete(outcome: 'success' | 'failure') {
    setBusy(true);
    try {
      const r = await api(`/payments/mock/${paymentId}/complete`, { body: { outcome } });
      router.push(`/reservations/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-md space-y-4 text-center">
      <p className="badge mx-auto bg-amber-500/15 text-amber-300">{t('pay.sandbox')}</p>
      <h1 className="text-xl font-semibold text-white">{t('pay.title')}</h1>
      <p className="text-sm text-slate-400">{t('pay.body')}</p>
      <ErrorNote error={error} />
      <button className="btn-primary w-full" disabled={busy} onClick={() => complete('success')}>
        {t('pay.success')}
      </button>
      <button className="btn-ghost w-full" disabled={busy} onClick={() => complete('failure')}>
        {t('pay.fail')}
      </button>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYEWA']}>
      <MockPay />
    </RequireRole>
  );
}
