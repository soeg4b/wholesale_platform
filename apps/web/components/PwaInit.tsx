'use client';

import { useEffect, useState } from 'react';
import { api, BASE, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

const API = BASE;

// Registers the service worker, offers "Add to home screen" on Android, and shows an
// offline banner. Runs once for the whole app (mounted in the root layout).
export function PwaInit() {
  const { t } = useI18n();
  const [install, setInstall] = useState<any>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const onInstallable = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('beforeinstallprompt', onInstallable);
    window.addEventListener('appinstalled', () => setInstall(null));
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallable);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <>
      {offline && (
        <div className="fixed inset-x-0 bottom-0 z-[1200] bg-red-500/90 px-4 py-2 text-center text-sm font-medium text-white">
          {t('pwa.offline')}
        </div>
      )}
      {install && !offline && (
        <div className="fixed inset-x-4 bottom-4 z-[1200] flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <p className="text-sm text-slate-200">{t('pwa.installHint')}</p>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1 text-xs" onClick={() => setInstall(null)}>
              {t('pwa.later')}
            </button>
            <button
              className="btn-primary !py-1 text-sm"
              onClick={async () => {
                await install.prompt();
                setInstall(null);
              }}
            >
              {t('pwa.install')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export interface NotifySnapshot {
  unread: number;
  latest: {
    id: string;
    category: string;
    title: { id: string; en: string };
    href: string | null;
  } | null;
}

// Realtime notification updates over Server-Sent Events; the 30s polling only runs when the
// stream is unavailable (very old browsers, proxy blocks SSE).
export function useNotifyStream(onChange?: (snap: NotifySnapshot) => void) {
  const { user } = useAuth();
  const [snap, setSnap] = useState<NotifySnapshot>({ unread: 0, latest: null });
  const apply = (s: NotifySnapshot) => {
    setSnap(s);
    onChange?.(s);
  };
  useEffect(() => {
    if (!user) return;
    const token = tokenStore.get();
    if (!token) return;
    let es: EventSource | null = null;
    let poller: ReturnType<typeof setInterval> | null = null;

    const poll = () =>
      api<{ unread: number }>('/notifications?unread=true&take=1')
        .then((r) => apply({ unread: r.unread, latest: null }))
        .catch(() => undefined);
    const startPolling = () => {
      es?.close();
      es = null;
      poller ??= setInterval(poll, 30000);
      poll();
    };
    try {
      es = new EventSource(`${API}/notifications/stream?token=${encodeURIComponent(token)}`);
      es.onmessage = (e) => {
        try {
          apply(JSON.parse(e.data));
        } catch {
          /* ignore malformed events */
        }
      };
      es.onerror = () => startPolling();
    } catch {
      startPolling();
    }
    return () => {
      es?.close();
      if (poller) clearInterval(poller);
    };
  }, [user?.id]);
  return snap;
}
