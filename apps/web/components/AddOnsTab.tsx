'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errMessage, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote } from './ui';

const KINDS = [
  'REDUNDANCY',
  'CAPACITY_UPGRADE',
  'MONITORING',
  'PREMIUM_SLA',
  'DDOS_PROTECTION',
  'MANAGED_SERVICE',
  'OTHER',
];
const EMPTY = {
  kind: 'MONITORING',
  nameId: '',
  nameEn: '',
  descId: '',
  descEn: '',
  price: '',
  priceUnit: 'MONTH',
};

export function AddOnsTab() {
  const { t, tr, locale } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api('/operator/addons')
        .then(setRows)
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setError(null);
    try {
      await api('/operator/addons', {
        body: {
          kind: f.kind,
          name: { id: f.nameId, en: f.nameEn },
          description: f.descId || f.descEn ? { id: f.descId, en: f.descEn } : undefined,
          price: f.price ? Number(f.price) : undefined,
          priceUnit: f.priceUnit,
        },
      });
      setF(EMPTY);
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  }

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 md:grid-cols-4">
        <div>
          <label className="label">{t('addon.kind')}</label>
          <select
            className="input"
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`chip.addon.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('addon.name')} (ID)</label>
          <input
            className="input"
            value={f.nameId}
            onChange={(e) => setF({ ...f, nameId: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('addon.name')} (EN)</label>
          <input
            className="input"
            value={f.nameEn}
            onChange={(e) => setF({ ...f, nameEn: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('addon.price')}</label>
          <input
            className="input"
            type="number"
            min={0}
            value={f.price}
            onChange={(e) => setF({ ...f, price: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">{t('addon.description')} (ID)</label>
          <input
            className="input"
            value={f.descId}
            onChange={(e) => setF({ ...f, descId: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">{t('addon.description')} (EN)</label>
          <input
            className="input"
            value={f.descEn}
            onChange={(e) => setF({ ...f, descEn: e.target.value })}
          />
        </div>
        <div className="md:col-span-4">
          <ErrorNote error={error} />
        </div>
        <div className="md:col-span-4">
          <button className="btn-primary" disabled={!f.nameId && !f.nameEn} onClick={create}>
            {t('common.add')}
          </button>
        </div>
      </div>
      {rows.length === 0 && <div className="card text-slate-400">{t('addon.empty')}</div>}
      {rows.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full">
            <thead>
              <tr>
                {['addon.kind', 'addon.name', 'addon.price', 'link.status', ''].map((h, i) => (
                  <th key={i} className="th">
                    {h && t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="td">{t(`chip.addon.${a.kind}`)}</td>
                  <td className="td">
                    {tr(a.name)}
                    <span className="block text-xs text-slate-500">
                      {a.description ? tr(a.description) : ''}
                    </span>
                  </td>
                  <td className="td">
                    {a.price === null
                      ? '-'
                      : money(a.price, a.currency, locale === 'id' ? 'id-ID' : 'en-US')}
                    {a.priceUnit ? ` / ${a.priceUnit}` : ''}
                  </td>
                  <td className="td">
                    <button
                      role="switch"
                      aria-checked={a.isActive}
                      className={`badge ${a.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}
                      onClick={async () => {
                        await api(`/operator/addons/${a.id}`, {
                          method: 'PATCH',
                          body: { isActive: !a.isActive },
                        });
                        load();
                      }}
                    >
                      {a.isActive ? t('status.ACTIVE') : t('status.INACTIVE')}
                    </button>
                  </td>
                  <td className="td">
                    <button
                      className="text-xs text-red-400"
                      onClick={async () => {
                        await api(`/operator/addons/${a.id}`, { method: 'DELETE' });
                        load();
                      }}
                    >
                      {t('common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
