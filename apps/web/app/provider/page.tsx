'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errMessage, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Bars } from '@/components/Bars';
import { DemoBadge, ErrorNote, RequireRole, Stars, Status } from '@/components/ui';

function ProviderProfile() {
  const { t, tr, locale } = useI18n();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/provider/profile');
      setD(data);
      const p = data.profile;
      setForm({
        displayName: p.displayName,
        descId: p.description?.id ?? '',
        descEn: p.description?.en ?? '',
        contactEmail: p.contactEmail ?? '',
        contactPhone: p.contactPhone ?? '',
        website: p.website ?? '',
        logoUrl: p.logoUrl ?? '',
      });
    } catch (e) {
      setError(errMessage(e, t));
    }
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  };

  if (!d)
    return error ? (
      <ErrorNote error={error} />
    ) : (
      <p className="text-slate-400">{t('common.loading')}</p>
    );
  const fmt = (n: number) => money(n, d.profile.currency, loc);
  const tier = d.tier;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{d.profile.displayName}</h1>
          <p className="text-slate-400">{d.profile.legalName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Status value={d.profile.approvalStatus} />
          {tier.current && (
            <span className="badge bg-yellow-500/15 text-yellow-300">{tr(tier.current.name)}</span>
          )}
          <Link href={`/providers/${d.profile.id}`} className="btn-ghost !py-1 text-xs">
            {t('prov.publicPage')}
          </Link>
        </div>
      </div>
      {d.income.includesDemo && (
        <p className="text-xs text-slate-500">
          <DemoBadge /> {t('demo.note')}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['prov.income.total', fmt(d.income.total)],
          ['prov.income.last30', fmt(d.income.last30Days)],
          ['prov.income.recurring', fmt(d.income.recurringMonthly)],
          [
            'prov.rating',
            d.reviews.average === null ? '-' : `${d.reviews.average} / 5 (${d.reviews.count})`,
          ],
        ].map(([k, v]) => (
          <div key={k} className="card">
            <p className="text-2xl font-bold text-white">{v}</p>
            <p className="text-sm text-slate-400">{t(k)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2">
          <h2 className="font-semibold text-white">{t('prov.incomeTrend')}</h2>
          <Bars
            labels={d.trend.map((m: any) => m.month.slice(2))}
            series={[
              {
                name: t('prov.income'),
                values: d.trend.map((m: any) => m.income),
                color: '#38bdf8',
              },
            ]}
            format={fmt}
          />
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-white">{t('prov.customerTrend')}</h2>
          <Bars
            labels={d.trend.map((m: any) => m.month.slice(2))}
            series={[
              {
                name: t('prov.newCustomers'),
                values: d.trend.map((m: any) => m.newCustomers),
                color: '#34d399',
              },
              {
                name: t('prov.returning'),
                values: d.trend.map((m: any) => m.returningCustomers),
                color: '#a78bfa',
              },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-2">
          <h2 className="font-semibold text-white">
            {t('prov.progress')} ({d.progress.completionPct}%)
          </h2>
          <ul className="space-y-1 text-sm">
            {d.progress.checklist.map((c: any) => (
              <li key={c.key} className={c.done ? 'text-emerald-300' : 'text-slate-400'}>
                {c.done ? '✓' : '○'} {t(`prov.check.${c.key}`)}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 pt-2 text-xs text-slate-400">
            <span>
              {t('op.stat.links')}:{' '}
              {Object.values(d.progress.linksByStatus as Record<string, number>).reduce(
                (a, b) => a + b,
                0,
              )}
            </span>
            <span>
              {t('op.stat.integrations')}: {d.progress.integrations.active}/
              {d.progress.integrations.total}
            </span>
            <span>KMZ: {d.progress.kmzFiles}</span>
            <span>
              {t('op.tab.pricing')}: {d.progress.pricingRules}
            </span>
            <span>
              {t('op.tab.prebuild')}: {d.progress.prebuild.total}
              {d.progress.prebuild.avgProgressPct !== null &&
                ` (${d.progress.prebuild.avgProgressPct}%)`}
            </span>
            <span>
              {t('nav.tickets')}: {d.progress.openTickets}
            </span>
            <span>
              {t('req.responses')}: {d.progress.requestResponses}
            </span>
          </div>
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-white">{t('prov.tier')}</h2>
          <div className="space-y-2">
            {tier.all.map((x: any) => (
              <div
                key={x.key}
                className={`rounded-lg border p-2 text-sm ${x.key === tier.current?.key ? 'border-yellow-500/50' : 'border-slate-800'}`}
              >
                <p className="font-medium text-white">
                  {tr(x.name)}{' '}
                  <span className="text-xs text-slate-500">
                    ({fmt(x.minIncome)}, {x.minRating}★)
                  </span>
                </p>
                <ul className="list-inside list-disc text-xs text-slate-400">
                  {x.benefits.map((b: any, i: number) => (
                    <li key={i}>{tr(b)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {tier.next && (
            <div>
              <p className="text-xs text-slate-400">
                {t('prov.nextTier', {
                  tier: tr(tier.next.name),
                  income: fmt(tier.missing.income),
                  rating: tier.missing.rating,
                })}
              </p>
              <div className="mt-1 h-2 rounded-full bg-slate-800">
                <div
                  className="h-2 rounded-full bg-yellow-400"
                  style={{ width: `${tier.progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-white">{t('prov.topRoutes')}</h2>
          {d.topRoutes.map((r: any) => (
            <div key={r.route} className="flex justify-between text-sm">
              <span className="text-slate-300">{r.route}</span>
              <span className="tabular-nums text-white">{fmt(r.income)}</span>
            </div>
          ))}
          {!d.topRoutes.length && <p className="text-sm text-slate-500">-</p>}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-white">{t('prov.reviews')}</h2>
          <div className="flex gap-2 text-xs text-slate-400">
            {d.reviews.distribution
              .slice()
              .reverse()
              .map((x: any) => (
                <span key={x.rating}>
                  {x.rating}★ {x.count}
                </span>
              ))}
          </div>
        </div>
        {d.reviews.latest.map((r: any) => (
          <div key={r.id} className="rounded-lg border border-slate-800 p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <Stars value={r.rating} /> <span className="text-slate-300">{r.company}</span>{' '}
                <span className="text-xs text-slate-500">{r.route}</span>
              </span>
              <span className="text-xs text-slate-500">
                {new Date(r.createdAt).toLocaleDateString(loc)} {r.isDemo && <DemoBadge />}
              </span>
            </div>
            {r.comment && <p className="mt-1 text-slate-300">{r.comment}</p>}
            {r.reply ? (
              <p className="mt-1 border-l-2 border-sky-500 pl-2 text-xs text-sky-200">{r.reply}</p>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  className="input !py-1 text-xs"
                  placeholder={t('prov.replyPlaceholder')}
                  value={reply[r.id] ?? ''}
                  onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })}
                />
                <button
                  className="btn-primary !py-1 text-xs"
                  disabled={!reply[r.id]}
                  onClick={() =>
                    run(() =>
                      api(`/operator/reviews/${r.id}/reply`, { body: { reply: reply[r.id] } }),
                    )
                  }
                >
                  {t('prov.reply')}
                </button>
              </div>
            )}
          </div>
        ))}
        {!d.reviews.latest.length && (
          <p className="text-sm text-slate-500">{t('prov.noReviews')}</p>
        )}
      </div>

      <ErrorNote error={error} />
      <div className="card space-y-3">
        <h2 className="font-semibold text-white">{t('prov.edit')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              ['displayName', 'prov.displayName'],
              ['contactEmail', 'prov.contactEmail'],
              ['contactPhone', 'prov.contactPhone'],
              ['website', 'prov.website'],
              ['logoUrl', 'prov.logoUrl'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label className="label">{t(label)}</label>
              <input
                className="input"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
          {(['descId', 'descEn'] as const).map((k) => (
            <div key={k} className="md:col-span-2">
              <label className="label">
                {t('prov.description')} ({k === 'descId' ? 'ID' : 'EN'})
              </label>
              <textarea
                className="input"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button
          className="btn-primary"
          onClick={() =>
            run(() =>
              api('/provider/profile', {
                method: 'PATCH',
                body: {
                  displayName: form.displayName,
                  description: { id: form.descId, en: form.descEn },
                  contactEmail: form.contactEmail || null,
                  contactPhone: form.contactPhone || null,
                  website: form.website || null,
                  logoUrl: form.logoUrl || null,
                },
              }),
            )
          }
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYELENGGARA']}>
      <ProviderProfile />
    </RequireRole>
  );
}
