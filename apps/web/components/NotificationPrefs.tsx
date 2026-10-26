'use client';

import { useEffect, useState } from 'react';
import { api, errMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote } from '@/components/ui';

interface Pref {
  category: string;
  enabled: boolean;
  channels: string[];
  filters: { cities?: string[]; operatorIds?: string[]; minDiscountPct?: number } | null;
}

// Categories with route/provider/discount filters (promotional offers).
const FILTERABLE = ['PROMO', 'DISCOUNT', 'EARLY_BIRD', 'LINK_REQUEST'];

export function NotificationPrefs() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [operators, setOperators] = useState<{ id: string; displayName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Pref[]>('/notifications/preferences')
      .then(setPrefs)
      .catch((e) => setError(errMessage(e, t)));
    api<{ name: string }[]>('/reference/locations')
      .then((r) => setCities(r.map((x) => x.name)))
      .catch(() => undefined);
    api<{ operators: { id: string; displayName: string }[] }>('/links/facets')
      .then((r) => setOperators(r.operators))
      .catch(() => undefined);
  }, []);

  const patch = (category: string, p: Partial<Pref>) => {
    setSaved(false);
    setPrefs((all) => all?.map((x) => (x.category === category ? { ...x, ...p } : x)) ?? null);
  };
  const toggle = (list: string[] = [], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  async function save() {
    setError(null);
    try {
      setPrefs(
        await api<Pref[]>('/notifications/preferences', { method: 'PUT', body: { items: prefs } }),
      );
      setSaved(true);
    } catch (e) {
      setError(errMessage(e, t));
    }
  }

  if (!prefs) return <p className="text-slate-400">{t('common.loading')}</p>;
  return (
    <div className="space-y-3">
      {prefs.map((p) => (
        <div key={p.category} className="rounded-lg border border-slate-800 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 font-medium text-white">
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) => patch(p.category, { enabled: e.target.checked })}
              />
              {t(`notif.cat.${p.category}`)}
            </label>
            <div className="flex gap-3 text-xs text-slate-300">
              {['IN_APP', 'EMAIL'].map((c) => (
                <label key={c} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!p.enabled}
                    checked={p.channels.includes(c)}
                    onChange={() => patch(p.category, { channels: toggle(p.channels, c) })}
                  />
                  {t(`notif.channel.${c}`)}
                </label>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t(`notif.cat.${p.category}.hint`)}</p>
          {p.enabled && FILTERABLE.includes(p.category) && (
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <div>
                <label className="label">{t('notif.filter.cities')}</label>
                <select
                  multiple
                  className="input h-24"
                  value={p.filters?.cities ?? []}
                  onChange={(e) =>
                    patch(p.category, {
                      filters: {
                        ...p.filters,
                        cities: [...e.target.selectedOptions].map((o) => o.value),
                      },
                    })
                  }
                >
                  {cities.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('notif.filter.providers')}</label>
                <select
                  multiple
                  className="input h-24"
                  value={p.filters?.operatorIds ?? []}
                  onChange={(e) =>
                    patch(p.category, {
                      filters: {
                        ...p.filters,
                        operatorIds: [...e.target.selectedOptions].map((o) => o.value),
                      },
                    })
                  }
                >
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.displayName}
                    </option>
                  ))}
                </select>
              </div>
              {p.category !== 'LINK_REQUEST' && (
                <div>
                  <label className="label">{t('notif.filter.minDiscount')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={p.filters?.minDiscountPct ?? ''}
                    onChange={(e) =>
                      patch(p.category, {
                        filters: {
                          ...p.filters,
                          minDiscountPct:
                            e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-slate-500">{t('notif.emailNote')}</p>
      <ErrorNote error={error} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save}>
          {t('common.save')}
        </button>
        {saved && <span className="text-sm text-emerald-300">{t('common.saved')}</span>}
      </div>
    </div>
  );
}
