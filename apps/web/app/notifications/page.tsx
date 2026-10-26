'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { NotificationPrefs } from '@/components/NotificationPrefs';
import { useNotifyStream } from '@/components/PwaInit';
import { DemoBadge, RequireRole } from '@/components/ui';

function Inbox() {
  const { t, tr, locale } = useI18n();
  const [data, setData] = useState<{ items: any[]; unread: number } | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const load = useCallback(
    () =>
      api(`/notifications?take=100${unreadOnly ? '&unread=true' : ''}`)
        .then(setData)
        .catch(() => setData({ items: [], unread: 0 })),
    [unreadOnly],
  );
  useEffect(() => {
    load();
  }, [load]);
  // Reload the list when a notification arrives in realtime.
  const snap = useNotifyStream();
  useEffect(() => {
    load();
  }, [snap.latest?.id, snap.unread]);

  const read = async (id: string) => {
    await api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
    load();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-white">
            {t('nav.notifications')} {data ? `(${data.unread})` : ''}
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1 text-slate-300">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              {t('notif.unreadOnly')}
            </label>
            <button
              className="btn-ghost !py-1 text-xs"
              onClick={async () => {
                await api('/notifications/read-all', { method: 'POST' });
                load();
              }}
            >
              {t('notif.readAll')}
            </button>
          </div>
        </div>
        {!data && <p className="text-slate-400">{t('common.loading')}</p>}
        {data?.items.map((n) => (
          <div
            key={n.id}
            className={`card space-y-1 ${n.readAt ? 'opacity-70' : 'border-sky-500/40'}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="badge bg-slate-800 text-slate-300">
                {t(`notif.cat.${n.category}`)}
              </span>
              <span className="text-xs text-slate-500">
                {new Date(n.createdAt).toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')}{' '}
                {n.isDemo && <DemoBadge />}
              </span>
            </div>
            <p className="font-medium text-white">{tr(n.title)}</p>
            {n.body && <p className="text-sm text-slate-400">{tr(n.body)}</p>}
            <div className="flex gap-3 text-xs">
              {n.href && (
                <Link
                  href={n.href}
                  className="text-sky-300"
                  onClick={() => !n.readAt && read(n.id)}
                >
                  {t('notif.open')}
                </Link>
              )}
              {!n.readAt && (
                <button className="text-slate-400 hover:text-white" onClick={() => read(n.id)}>
                  {t('notif.markRead')}
                </button>
              )}
            </div>
          </div>
        ))}
        {data && !data.items.length && <p className="text-slate-500">{t('notif.empty')}</p>}
      </section>
      <section className="card h-fit space-y-3">
        <h2 className="font-semibold text-white">{t('profile.notifications')}</h2>
        <NotificationPrefs />
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole>
      <Inbox />
    </RequireRole>
  );
}
