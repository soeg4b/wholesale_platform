'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, capacity, errMessage, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DemoBadge, ErrorNote, Status } from '@/components/ui';

const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

export function PrebuildTab({ requestId }: { requestId?: string }) {
  const { t, tr, locale } = useI18n();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const [rows, setRows] = useState<any[] | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [request, setRequest] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!!requestId);
  const [f, setF] = useState({
    nameId: '',
    nameEn: '',
    category: 'DARK_FIBER',
    originName: '',
    destinationName: '',
    capacityMbps: '10000',
    targetReadyDate: day(180),
    basePrice: '',
    earlyBirdPrice: '',
    earlyBirdUntil: day(60),
    earlyBirdSlots: '5',
    minTermMonths: '12',
  });

  const load = useCallback(
    () =>
      api('/operator/prebuild')
        .then(setRows)
        .catch((e) => setError(errMessage(e, t))),
    [t],
  );
  useEffect(() => {
    load();
    api<{ name: string }[]>('/reference/locations')
      .then((r) => setCities(r.map((x) => x.name)))
      .catch(() => undefined);
  }, [load]);
  // Pre-fill from a customer link request ("Build it" on the requests board).
  useEffect(() => {
    if (!requestId) return;
    api<any[]>('/link-requests?sort=votes')
      .then((all) => {
        const r = all.find((x) => x.id === requestId);
        if (!r) return;
        setRequest(r);
        const label = `${r.originName} - ${r.destinationName}`;
        setF((p) => ({
          ...p,
          nameId: label,
          nameEn: label,
          originName: r.originName,
          destinationName: r.destinationName,
          capacityMbps: String(Math.max(r.capacityMbps, Number(p.capacityMbps))),
          category: r.category ?? p.category,
          basePrice: r.budgetMonthly ? String(r.budgetMonthly) : p.basePrice,
        }));
      })
      .catch(() => undefined);
  }, [requestId]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  };

  const saveProgress = (id: string, el: HTMLInputElement) =>
    run(() =>
      api(`/operator/prebuild/${id}`, { method: 'PATCH', body: { progressPct: Number(el.value) } }),
    );

  const create = () =>
    run(async () => {
      await api('/operator/prebuild', {
        body: {
          name: { id: f.nameId, en: f.nameEn || f.nameId },
          category: f.category,
          originName: f.originName,
          destinationName: f.destinationName,
          capacityMbps: Number(f.capacityMbps),
          targetReadyDate: new Date(f.targetReadyDate).toISOString(),
          basePrice: Number(f.basePrice),
          earlyBirdPrice: Number(f.earlyBirdPrice),
          earlyBirdUntil: new Date(f.earlyBirdUntil).toISOString(),
          earlyBirdSlots: Number(f.earlyBirdSlots),
          minTermMonths: Number(f.minTermMonths),
          linkRequestId: request?.id,
        },
      });
      setOpen(false);
      setRequest(null);
    });

  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <div key={k}>
      <label className="label">{t(label)}</label>
      <input
        className="input"
        type={type}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-2">
        <p className="text-sm text-slate-400">{t('pb.opHint')}</p>
        <button className="btn-primary" onClick={() => setOpen(!open)}>
          {t('pb.new')}
        </button>
      </div>
      {open && (
        <div className="card grid gap-3 md:grid-cols-4">
          {request && (
            <p className="rounded-lg bg-violet-500/10 p-2 text-sm text-violet-200 md:col-span-4">
              {t('pb.fromRequest', { ref: request.reference, votes: request.votes })}
            </p>
          )}
          {field('nameId', 'pb.nameId')}
          {field('nameEn', 'pb.nameEn')}
          {(['originName', 'destinationName'] as const).map((k) => (
            <div key={k}>
              <label className="label">
                {t(k === 'originName' ? 'explore.aEnd' : 'explore.zEnd')}
              </label>
              <select
                className="input"
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              >
                <option value="">-</option>
                {cities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          ))}
          {field('category', 'mp.category')}
          {field('capacityMbps', 'pb.capacityMbps', 'number')}
          {field('targetReadyDate', 'pb.ready', 'date')}
          {field('minTermMonths', 'req.term', 'number')}
          {field('basePrice', 'pb.basePrice', 'number')}
          {field('earlyBirdPrice', 'pb.earlyBirdPrice', 'number')}
          {field('earlyBirdUntil', 'pb.earlyBirdUntil', 'date')}
          {field('earlyBirdSlots', 'pb.earlyBirdSlots', 'number')}
          <div className="md:col-span-4">
            <button
              className="btn-primary"
              disabled={
                !f.nameId ||
                !f.originName ||
                !f.destinationName ||
                !f.basePrice ||
                !f.earlyBirdPrice
              }
              onClick={create}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      )}
      <ErrorNote error={error} />
      {rows?.map((p) => (
        <div key={p.id} className="card space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-white">{tr(p.name)}</p>
              <p className="text-xs text-slate-400">
                {p.category} - {capacity(p.capacityMbps)} -{' '}
                {money(p.earlyBirdPrice, p.currency, loc)} / {money(p.basePrice, p.currency, loc)} -{' '}
                {t('pb.slotsLeftShort', { n: p.slotsLeft })} {p.isDemo && <DemoBadge />}
              </p>
            </div>
            <Status value={p.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-slate-400">{t('pb.progress')}</label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              defaultValue={p.progressPct}
              disabled={!!p.convertedLinkId || p.status === 'CANCELLED'}
              onMouseUp={(e) => saveProgress(p.id, e.target as HTMLInputElement)}
              onKeyUp={(e) => saveProgress(p.id, e.target as HTMLInputElement)}
              onTouchEnd={(e) => saveProgress(p.id, e.target as HTMLInputElement)}
              aria-label={t('pb.progress')}
            />
            <span className="tabular-nums text-white">{p.progressPct}%</span>
            <select
              className="input !w-auto !py-1 text-xs"
              value={p.status}
              disabled={!!p.convertedLinkId || p.status === 'CANCELLED'}
              onChange={(e) =>
                run(() =>
                  api(`/operator/prebuild/${p.id}`, {
                    method: 'PATCH',
                    body: { status: e.target.value },
                  }),
                )
              }
            >
              {['PLANNED', 'BUILDING', 'READY'].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
            {!p.convertedLinkId && p.status !== 'CANCELLED' && (
              <>
                <button
                  className="btn-primary !py-1 text-xs"
                  onClick={() =>
                    run(() => api(`/operator/prebuild/${p.id}/launch`, { method: 'POST' }))
                  }
                >
                  {t('pb.launch')}
                </button>
                <button
                  className="text-xs text-red-400"
                  onClick={() => run(() => api(`/operator/prebuild/${p.id}`, { method: 'DELETE' }))}
                >
                  {t('pb.cancel')}
                </button>
              </>
            )}
            {p.convertedLinkId && (
              <span className="text-xs text-emerald-300">{t('pb.launched')}</span>
            )}
          </div>
          {p.pledges.length > 0 && (
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-800">
                {p.pledges.map((c: any) => (
                  <tr key={c.id}>
                    <td className="py-1 text-slate-300">{c.company}</td>
                    <td className="py-1">
                      {c.termMonths} {t('req.months')}
                    </td>
                    <td className="py-1">{money(c.lockedPrice, p.currency, loc)}</td>
                    <td className="py-1">
                      <Status value={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {rows && !rows.length && <p className="text-slate-500">{t('pb.empty')}</p>}
    </div>
  );
}
