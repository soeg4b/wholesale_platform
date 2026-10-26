'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useNotifyStream } from './PwaInit';

export function Navbar() {
  const { user, logout, hasRole } = useAuth();
  const { t, tr, locale, setLocale } = useI18n();
  const path = usePathname();
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<string | null>(null);
  const { unread, latest } = useNotifyStream();
  // A toast for each newly arrived notification; disappears with the next route change or after 8s.
  useEffect(() => {
    if (!latest || latest.id === seen.current) return;
    seen.current = latest.id;
    setToast(tr(latest.title));
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [latest?.id]);

  const items: { href: string; label: string; show: boolean }[] = [
    { href: '/explore', label: t('nav.explore'), show: !!user },
    { href: '/marketplace', label: t('nav.marketplace'), show: !!user && !hasRole('ADMIN') },
    { href: '/ai', label: t('nav.ai'), show: hasRole('PENYEWA') },
    { href: '/cart', label: t('nav.cart'), show: hasRole('PENYEWA') },
    { href: '/reservations', label: t('nav.reservations'), show: !!user },
    { href: '/tickets', label: t('nav.tickets'), show: hasRole('PENYEWA') },
    { href: '/requests', label: t('nav.requests'), show: hasRole('PENYEWA', 'PENYELENGGARA') },
    { href: '/prebuild', label: t('nav.prebuild'), show: hasRole('PENYEWA') },
    { href: '/profile', label: t('nav.profile'), show: hasRole('PENYEWA') },
    { href: '/operator', label: t('nav.operator'), show: hasRole('PENYELENGGARA') },
    { href: '/provider', label: t('nav.provider'), show: hasRole('PENYELENGGARA') },
    { href: '/admin', label: t('nav.admin'), show: hasRole('ADMIN') },
  ];

  return (
    <header className="sticky top-0 z-[1000] border-b border-slate-800/80 bg-slate-950/75 shadow-lg shadow-slate-950/40 backdrop-blur-xl">
      {toast && latest && (
        <Link
          href={latest.href ?? '/notifications'}
          onClick={() => setToast(null)}
          role="status"
          className="absolute inset-x-4 top-14 z-[1100] rounded-xl border border-sky-500/50 bg-slate-900 p-3 text-sm text-white shadow-xl md:inset-x-auto md:right-4 md:w-96"
        >
          <span className="mr-2 badge bg-sky-500/15 text-sky-300">
            {t(`notif.cat.${latest.category}`)}
          </span>
          {toast}
        </Link>
      )}
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <span className="relative h-8 w-8 overflow-hidden rounded-full bg-brand-500">
            <Image src="/brand/tbg-avatar.svg" alt="" width={32} height={32} />
          </span>
          <span className="hidden sm:inline">{t('app.name')}</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm">
          {items
            .filter((i) => i.show)
            .map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  path.startsWith(i.href)
                    ? 'bg-brand-500/15 text-white shadow-[inset_0_-2px_0_0_#184c9b]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {i.label}
              </Link>
            ))}
        </nav>
        <div
          className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5 text-xs"
          role="group"
          aria-label="Language"
        >
          {(['id', 'en'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`rounded-md px-2 py-1 font-semibold uppercase ${locale === l ? 'bg-brand-500 text-white' : 'text-slate-400'}`}
            >
              {l}
            </button>
          ))}
        </div>
        {user ? (
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/notifications"
              className="relative rounded-md px-2 py-1 text-slate-300 hover:text-white"
              aria-label={t('nav.notifications')}
              title={t('nav.notifications')}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
            <span className="hidden text-slate-400 md:inline">{user.fullName}</span>
            <button className="btn-ghost" onClick={logout}>
              {t('nav.logout')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">
              {t('nav.login')}
            </Link>
            <Link href="/register" className="btn-primary">
              {t('nav.register')}
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
