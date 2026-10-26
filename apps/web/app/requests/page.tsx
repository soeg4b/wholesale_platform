'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, capacity, errMessage, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Map } from '@/components/Map';
import { DemoBadge, ErrorNote, RequireRole, Status } from '@/components/ui';

const EMPTY = {
  originName: '',
  destinationName: '',
  capacityMbps: '',
  category: '',
  termMonths: '12',
  budgetMonthly: '',
  neededBy: '',
  notes: '',
};

function Board() {
  const { t, tr, locale } = useI18n();
  const { hasRole } = useAuth();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const isBuyer = hasRole('PENYEWA');
  const isOp = hasRole('PENYELENGGARA');
  const [rows, setRows] = useState<any[] | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState({ city: '', status: '', sort: 'votes', mine: false });
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState<
    Record<string, { message: string; proposedPrice: string; etaDate: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const setReplyField = (id: string, key: 'message' | 'proposedPrice' | 'etaDate', value: string) =>
    setReply((all) => ({
      ...all,
      [id]: { ...(all[id] ?? { message: '', proposedPrice: '', etaDate: '' }), [key]: value },
    }));

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q.city) qs.set('city', q.city);
    if (q.status) qs.set('status', q.status);
    if (q.mine) qs.set('mine', 'true');
    qs.set('sort', q.sort);
    api(`/link-requests?${qs}`)
      .then(setRows)
      .catch((e) => setError(errMessage(e, t)));
  }, [q, t]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api<{ name: string }[]>('/reference/locations')
      .then((r) => setCities(r.map((x) => x.name)))
      .catch(() => undefined);
    api<{ categories: string[] }>('/links/facets')
      .then((r) => setCategories(r.categories))
      .catch(() => undefined);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  };

  const create = () =>
    run(async () => {
      await api('/link-requests', {
        body: {
          originName: form.originName,
          destinationName: form.destinationName,
          capacityMbps: Number(form.capacityMbps),
          category: form.category || undefined,
          termMonths: form.termMonths ? Number(form.termMonths) : undefined,
          budgetMonthly: form.budgetMonthly ? Number(form.budgetMonthly) : undefined,
          neededBy: form.neededBy || undefined,
          notes: form.notes || undefined,
        },
      });
      setForm(EMPTY);
      setOpen(false);
    });

  const routes = (rows ?? [])
    .filter((r) => r.originLat !== null && r.destinationLat !== null)
    .map((r) => ({
      id: r.id,
      color: r.hot ? '#f97316' : '#a78bfa',
      label: `${r.originName} - ${r.destinationName}`,
      geojson: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { name: `${r.originName} - ${r.destinationName} (${r.votes})` },
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [r.originLng, r.originLat],
                [r.destinationLng, r.destinationLat],
              ],
            },
          },
        ],
      },
    }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('req.title')}</h1>
          <p className="text-slate-400">{t(isOp ? 'req.subtitleOp' : 'req.subtitle')}</p>
        </div>
        {isBuyer && (
          <button className="btn-primary" onClick={() => setOpen(!open)}>
            {t('req.new')}
          </button>
        )}
      </div>

      {open && (
        <div className="card grid gap-3 md:grid-cols-4">
          {(['originName', 'destinationName'] as const).map((k) => (
            <div key={k}>
              <label className="label">
                {t(k === 'originName' ? 'explore.aEnd' : 'explore.zEnd')}
              </label>
              <select
                className="input"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              >
                <option value="">-</option>
                {cities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          ))}
          <div>
            <label className="label">{t('link.capacity')} (Mbps)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.capacityMbps}
              onChange={(e) => setForm({ ...form, capacityMbps: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('mp.category')}</label>
            <select
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">{t('mp.any')}</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('req.term')}</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.termMonths}
              onChange={(e) => setForm({ ...form, termMonths: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('req.budget')}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.budgetMonthly}
              onChange={(e) => setForm({ ...form, budgetMonthly: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('req.neededBy')}</label>
            <input
              className="input"
              type="date"
              value={form.neededBy}
              onChange={(e) => setForm({ ...form, neededBy: e.target.value })}
            />
          </div>
          <div className="md:col-span-4">
            <label className="label">{t('req.notes')}</label>
            <textarea
              className="input"
              maxLength={2000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="md:col-span-4">
            <button
              className="btn-primary"
              disabled={
                !form.originName || !form.destinationName || !(Number(form.capacityMbps) > 0)
              }
              onClick={create}
            >
              {t('req.submit')}
            </button>
          </div>
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('mp.city')}</label>
          <select
            className="input"
            value={q.city}
            onChange={(e) => setQ({ ...q, city: e.target.value })}
          >
            <option value="">{t('mp.any')}</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('link.status')}</label>
          <select
            className="input"
            value={q.status}
            onChange={(e) => setQ({ ...q, status: e.target.value })}
          >
            <option value="">{t('req.openOnly')}</option>
            {['OPEN', 'IN_PROGRESS', 'FULFILLED', 'CLOSED'].map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('mp.sort')}</label>
          <select
            className="input"
            value={q.sort}
            onChange={(e) => setQ({ ...q, sort: e.target.value })}
          >
            <option value="votes">{t('req.sort.votes')}</option>
            <option value="newest">{t('mp.sort.newest')}</option>
          </select>
        </div>
        {isBuyer && (
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={q.mine}
              onChange={(e) => setQ({ ...q, mine: e.target.checked })}
            />
            {t('req.mine')}
          </label>
        )}
      </div>

      <ErrorNote error={error} />
      <Map routes={routes} height={320} />

      <div className="grid gap-4 md:grid-cols-2">
        {rows?.map((r) => (
          <div key={r.id} id={r.id} className="card space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-lg font-semibold text-white">
                  {r.originName} &rarr; {r.destinationName}
                </p>
                <p className="text-xs text-slate-500">
                  {r.reference} {r.requesterCompany && `- ${r.requesterCompany}`}{' '}
                  {r.isDemo && <DemoBadge />}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.hot && (
                  <span className="badge bg-orange-500/15 text-orange-300">{t('req.hot')}</span>
                )}
                <Status value={r.status} />
              </div>
            </div>
            <p className="text-sm text-slate-300">
              {capacity(r.capacityMbps)} {r.category && `- ${r.category}`}{' '}
              {r.termMonths && `- ${r.termMonths} ${t('req.months')}`}
              {r.budgetMonthly !== null &&
                ` - ${t('req.budget')}: ${money(r.budgetMonthly, r.currency, loc)}`}
              {r.neededBy &&
                ` - ${t('req.neededBy')}: ${new Date(r.neededBy).toLocaleDateString(loc)}`}
            </p>
            {r.notes && <p className="text-sm text-slate-400">{r.notes}</p>}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-slate-300">
                {r.votes} {t('req.votes')}
              </span>
              {isBuyer && !r.isMine && (
                <button
                  className="btn-ghost !py-1 text-xs"
                  onClick={() => run(() => api(`/link-requests/${r.id}/vote`, { method: 'POST' }))}
                >
                  {r.hasVoted ? t('req.unvote') : t('req.vote')}
                </button>
              )}
              <span className="text-slate-500">
                {r.responseCount} {t('req.responses')}
              </span>
              {r.isMine && ['OPEN', 'IN_PROGRESS'].includes(r.status) && (
                <>
                  <button
                    className="btn-ghost !py-1 text-xs"
                    onClick={() =>
                      run(() =>
                        api(`/link-requests/${r.id}`, {
                          method: 'PATCH',
                          body: { status: 'FULFILLED' },
                        }),
                      )
                    }
                  >
                    {t('req.markFulfilled')}
                  </button>
                  <button
                    className="text-xs text-red-400"
                    onClick={() =>
                      run(() =>
                        api(`/link-requests/${r.id}`, {
                          method: 'PATCH',
                          body: { status: 'CLOSED' },
                        }),
                      )
                    }
                  >
                    {t('req.close')}
                  </button>
                </>
              )}
            </div>
            {r.products.length > 0 && (
              <div className="space-y-1 rounded-lg bg-slate-900 p-2 text-sm">
                {r.products.map((p: any) => (
                  <Link
                    key={p.id}
                    href={`/prebuild#${p.id}`}
                    className="flex items-center justify-between text-sky-300"
                  >
                    <span>{tr(p.name)}</span>
                    <span className="text-xs text-slate-400">
                      {p.progressPct}% - {new Date(p.targetReadyDate).toLocaleDateString(loc)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {r.responses.map((x: any) => (
              <div key={x.id} className="rounded-lg border border-slate-800 p-2 text-sm">
                <p className="font-medium text-white">{x.operatorProfile.displayName}</p>
                <p className="text-slate-300">{x.message}</p>
                <p className="text-xs text-slate-500">
                  {x.proposedPrice !== null &&
                    `${money(x.proposedPrice, r.currency, loc)} / ${t('req.month')}`}
                  {x.etaDate && ` - ETA ${new Date(x.etaDate).toLocaleDateString(loc)}`}
                </p>
              </div>
            ))}
            {isOp && ['OPEN', 'IN_PROGRESS'].includes(r.status) && (
              <div className="space-y-2 border-t border-slate-800 pt-2">
                <textarea
                  className="input text-sm"
                  placeholder={t('req.replyPlaceholder')}
                  value={reply[r.id]?.message ?? ''}
                  onChange={(e) => setReplyField(r.id, 'message', e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input !w-40 text-sm"
                    type="number"
                    placeholder={t('req.proposedPrice')}
                    value={reply[r.id]?.proposedPrice ?? ''}
                    onChange={(e) => setReplyField(r.id, 'proposedPrice', e.target.value)}
                  />
                  <input
                    className="input !w-40 text-sm"
                    type="date"
                    aria-label="ETA"
                    value={reply[r.id]?.etaDate ?? ''}
                    onChange={(e) => setReplyField(r.id, 'etaDate', e.target.value)}
                  />
                  <button
                    className="btn-primary !py-1 text-xs"
                    disabled={!reply[r.id]?.message}
                    onClick={() =>
                      run(() =>
                        api(`/link-requests/${r.id}/responses`, {
                          body: {
                            message: reply[r.id].message,
                            proposedPrice: reply[r.id].proposedPrice
                              ? Number(reply[r.id].proposedPrice)
                              : undefined,
                            etaDate: reply[r.id].etaDate || undefined,
                          },
                        }),
                      )
                    }
                  >
                    {t('req.respond')}
                  </button>
                  <Link
                    href={`/operator?tab=prebuild&request=${r.id}`}
                    className="btn-ghost !py-1 text-xs"
                  >
                    {t('req.buildIt')}
                  </Link>
                </div>
              </div>
            )}
          </div>
        ))}
        {rows && !rows.length && <p className="text-slate-500">{t('req.empty')}</p>}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYEWA', 'PENYELENGGARA', 'ADMIN']}>
      <Board />
    </RequireRole>
  );
}
