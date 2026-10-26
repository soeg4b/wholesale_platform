'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { RequireRole, Status } from '@/components/ui';

function List() {
  const { t, tr, locale } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api('/reservations')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  if (!rows) return <p className="text-slate-400">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">{t('nav.reservations')}</h1>
      {rows.length === 0 && <div className="card text-slate-400">{t('res.empty')}</div>}
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/reservations/${r.id}`}
          className="card block hover:border-brand-500"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-sm text-sky-400">{r.reference}</p>
              <p className="text-sm text-slate-400">
                {r.items.map((i: any) => tr(i.networkLink.name)).join(', ')}
              </p>
            </div>
            <div className="text-right">
              <Status value={r.status} />
              <p className="mt-1 font-semibold text-white">
                {money(r.totalAmount, r.currency, locale === 'id' ? 'id-ID' : 'en-US')}
              </p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole>
      <List />
    </RequireRole>
  );
}
