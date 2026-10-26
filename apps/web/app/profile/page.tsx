'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, capacity, errMessage, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Map } from '@/components/Map';
import { Bars } from '@/components/Bars';
import { NotificationPrefs } from '@/components/NotificationPrefs';
import { DemoBadge, ErrorNote, PerfChip, RequireRole } from '@/components/ui';

const LEVEL: Record<string, string> = {
  critical: 'border-red-500/50 bg-red-500/10 text-red-200',
  warning: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  info: 'border-sky-500/50 bg-sky-500/10 text-sky-200',
};

function Profile() {
  const { t, tr, locale } = useI18n();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const [d, setD] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<any>(null);
  const [topup, setTopup] = useState('');
  const [rate, setRate] = useState<Record<string, { rating: number; comment: string }>>({});

  const load = useCallback(async () => {
    try {
      const data = await api('/profile/buyer');
      setD(data);
      setForm({
        fullName: data.account.fullName,
        phone: data.account.phone ?? '',
        companyName: data.profile.companyName,
        taxId: data.profile.taxId ?? '',
        billingEmail: data.profile.billingEmail ?? '',
        monthlyBudget: data.profile.monthlyBudget ?? '',
        alertThresholdPct: data.profile.alertThresholdPct ?? '',
      });
      setReviews(await api('/reviews/mine'));
    } catch (e) {
      setError(errMessage(e, t));
    }
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setError(null);
    try {
      await api('/profile/buyer', {
        method: 'PATCH',
        body: {
          fullName: form.fullName,
          phone: form.phone || null,
          companyName: form.companyName,
          taxId: form.taxId || null,
          billingEmail: form.billingEmail || null,
          monthlyBudget: form.monthlyBudget === '' ? null : Number(form.monthlyBudget),
          alertThresholdPct: form.alertThresholdPct === '' ? null : Number(form.alertThresholdPct),
        },
      });
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  }

  async function doTopup() {
    setError(null);
    try {
      await api('/profile/wallet/topup', { body: { amount: Number(topup) } });
      setTopup('');
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  }

  async function review(r: any) {
    const v = rate[r.itemId];
    if (!v?.rating) return;
    setError(null);
    try {
      await api('/reviews', {
        body: {
          reservationId: r.reservationId,
          operatorProfileId: r.link.operator.id,
          rating: v.rating,
          comment: v.comment || undefined,
        },
      });
      setReviews(await api('/reviews/mine'));
    } catch (e) {
      setError(errMessage(e, t));
    }
  }

  if (!d)
    return error ? (
      <ErrorNote error={error} />
    ) : (
      <p className="text-slate-400">{t('common.loading')}</p>
    );
  const cur = d.wallet.currency;
  const fmt = (n: number) => money(n, cur, loc);
  const reviewed = (r: any) =>
    reviews.find(
      (x) => x.reservationId === r.reservationId && x.operatorProfileId === r.link.operator.id,
    );
  const routes = d.map.features.map((f: any) => ({
    id: f.id,
    geojson: { type: 'FeatureCollection', features: [f] },
    color: f.properties.active ? '#38bdf8' : '#64748b',
    label: f.properties.name,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('profile.title')}</h1>
        <p className="text-slate-400">
          {d.account.fullName} - {d.profile.companyName} - {d.account.email}
        </p>
      </div>

      {d.billing.alerts.length > 0 && (
        <div className="space-y-2" role="alert">
          {d.billing.alerts.map((a: any, i: number) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${LEVEL[a.level]}`}>
              <strong>{t(`alert.${a.code}`)}</strong>{' '}
              {t(`alert.${a.code}.detail`, {
                ...a.values,
                budget: a.values.budget !== undefined ? fmt(a.values.budget) : '',
                monthlyCharge:
                  a.values.monthlyCharge !== undefined ? fmt(a.values.monthlyCharge) : '',
                balance: a.values.balance !== undefined ? fmt(a.values.balance) : '',
                needed: a.values.needed !== undefined ? fmt(a.values.needed) : '',
                endDate: a.values.endDate ? new Date(a.values.endDate).toLocaleDateString(loc) : '',
              })}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-2xl font-bold text-white">{fmt(d.wallet.balance)}</p>
          <p className="text-sm text-slate-400">{t('profile.balance')}</p>
          {d.wallet.demoTopupEnabled && (
            <div className="mt-2 flex gap-2">
              <input
                className="input !py-1 text-sm"
                type="number"
                min={1}
                placeholder={t('profile.topupAmount')}
                value={topup}
                onChange={(e) => setTopup(e.target.value)}
              />
              <button
                className="btn-primary !py-1 text-xs"
                disabled={!(Number(topup) > 0)}
                onClick={doTopup}
              >
                {t('profile.topup')}
              </button>
            </div>
          )}
        </div>
        <div className="card">
          <p className="text-2xl font-bold text-white">{fmt(d.billing.monthlyCharge)}</p>
          <p className="text-sm text-slate-400">{t('profile.monthlyCharge')}</p>
        </div>
        <div className="card">
          <p className="text-2xl font-bold text-white">
            {d.billing.usagePct === null ? '-' : `${d.billing.usagePct}%`}
          </p>
          <p className="text-sm text-slate-400">
            {t('profile.budgetUsage')} {d.billing.budget ? `(${fmt(d.billing.budget)})` : ''}
          </p>
          {d.billing.usagePct !== null && (
            <div className="mt-2 h-2 rounded-full bg-slate-800">
              <div
                className={`h-2 rounded-full ${d.billing.usagePct >= 100 ? 'bg-red-400' : d.billing.usagePct >= d.billing.thresholdPct ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${Math.min(100, d.billing.usagePct)}%` }}
              />
            </div>
          )}
        </div>
        <div className="card">
          <p className="text-2xl font-bold text-white">
            {d.rentals.filter((r: any) => r.active).length}
          </p>
          <p className="text-sm text-slate-400">{t('profile.activeLinks')}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card space-y-2">
          <h2 className="font-semibold text-white">{t('profile.mapTitle')}</h2>
          <Map routes={routes} height={360} />
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-white">{t('profile.projection')}</h2>
          <Bars
            labels={d.billing.projection.map((p: any) => p.month.slice(2))}
            series={[
              {
                name: t('profile.monthlyCharge'),
                values: d.billing.projection.map((p: any) => p.amount),
                color: '#38bdf8',
              },
            ]}
            format={fmt}
          />
          <p className="text-xs text-slate-500">{t('profile.projectionHint')}</p>
        </div>
      </div>

      <div className="card overflow-x-auto !p-0">
        <h2 className="px-4 pt-4 font-semibold text-white">{t('profile.myLinks')}</h2>
        <table className="w-full">
          <thead>
            <tr>
              {[
                'link.route',
                'mp.operator',
                'link.capacity',
                'link.monthly',
                'profile.period',
                'perf.score',
                'profile.review',
              ].map((h) => (
                <th key={h} className="th">
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {d.rentals.map((r: any) => {
              const done = reviewed(r);
              return (
                <tr key={r.itemId} className={r.active ? '' : 'opacity-60'}>
                  <td className="td">
                    <Link href={`/links/${r.link.id}`} className="text-sky-300 hover:underline">
                      {r.link.originName} &rarr; {r.link.destinationName}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {r.reference} {r.isDemo && <DemoBadge />}
                    </p>
                  </td>
                  <td className="td">
                    <Link href={`/providers/${r.link.operator.id}`} className="hover:underline">
                      {r.link.operator.displayName}
                    </Link>
                  </td>
                  <td className="td">{capacity(r.link.capacityMbps)}</td>
                  <td className="td">{money(r.monthlyPrice, r.currency, loc)}</td>
                  <td className="td text-xs">
                    {new Date(r.startDate).toLocaleDateString(loc)} -{' '}
                    {new Date(r.endDate).toLocaleDateString(loc)}
                    {!r.active && <p className="text-slate-500">{t('profile.ended')}</p>}
                  </td>
                  <td className="td">
                    <PerfChip perf={r.performance} />
                  </td>
                  <td className="td">
                    {done ? (
                      <span className="text-amber-300" aria-label={`${done.rating}/5`}>
                        {'★'.repeat(done.rating)}
                        <span className="text-slate-600">{'★'.repeat(5 - done.rating)}</span>
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <select
                          className="input !py-1 text-xs"
                          aria-label={t('profile.rating')}
                          value={rate[r.itemId]?.rating ?? ''}
                          onChange={(e) =>
                            setRate({
                              ...rate,
                              [r.itemId]: {
                                comment: rate[r.itemId]?.comment ?? '',
                                rating: Number(e.target.value),
                              },
                            })
                          }
                        >
                          <option value="">{t('profile.rating')}</option>
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                              {'★'.repeat(n)}
                            </option>
                          ))}
                        </select>
                        {rate[r.itemId]?.rating ? (
                          <>
                            <input
                              className="input !py-1 text-xs"
                              placeholder={t('profile.comment')}
                              value={rate[r.itemId]?.comment ?? ''}
                              onChange={(e) =>
                                setRate({
                                  ...rate,
                                  [r.itemId]: { ...rate[r.itemId], comment: e.target.value },
                                })
                              }
                            />
                            <button className="btn-primary !py-1 text-xs" onClick={() => review(r)}>
                              {t('profile.submitReview')}
                            </button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!d.rentals.length && (
              <tr>
                <td className="td text-slate-500" colSpan={7}>
                  {t('profile.noLinks')}{' '}
                  <Link href="/explore" className="text-sky-300">
                    {t('nav.explore')}
                  </Link>{' '}
                  /{' '}
                  <Link href="/requests" className="text-sky-300">
                    {t('nav.requests')}
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ErrorNote error={error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold text-white">{t('profile.account')}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                ['fullName', 'profile.fullName', 'text'],
                ['phone', 'profile.phone', 'text'],
                ['companyName', 'profile.company', 'text'],
                ['taxId', 'profile.taxId', 'text'],
                ['billingEmail', 'profile.billingEmail', 'email'],
                ['monthlyBudget', 'profile.monthlyBudget', 'number'],
                ['alertThresholdPct', 'profile.alertThreshold', 'number'],
              ] as const
            ).map(([k, label, type]) => (
              <div key={k}>
                <label className="label">{t(label)}</label>
                <input
                  className="input"
                  type={type}
                  value={form[k]}
                  placeholder={
                    k === 'alertThresholdPct' ? String(d.profile.effectiveThresholdPct) : undefined
                  }
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <button className="btn-primary" onClick={save}>
            {t('common.save')}
          </button>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-white">{t('profile.wallet')}</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-800">
              {d.wallet.entries.map((e: any) => (
                <tr key={e.id}>
                  <td className="py-1.5 text-xs text-slate-400">
                    {new Date(e.createdAt).toLocaleDateString(loc)}
                  </td>
                  <td className="py-1.5">
                    {t(`wallet.${e.type}`)}
                    <p className="text-xs text-slate-500">
                      {e.description ? tr(e.description) : e.reference}
                    </p>
                  </td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${e.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}
                  >
                    {fmt(e.amount)}
                  </td>
                </tr>
              ))}
              {!d.wallet.entries.length && (
                <tr>
                  <td className="py-2 text-slate-500">{t('profile.noEntries')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-white">{t('profile.notifications')}</h2>
        <NotificationPrefs />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYEWA']}>
      <Profile />
    </RequireRole>
  );
}
