'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, money } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

// Animated counter: counts up to the target once visible.
function Count({ value }: { value: number | undefined }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (value === undefined) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      (es) => {
        if (!es[0].isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const step = (t: number) => {
          const k = Math.min(1, (t - t0) / 900);
          setN(Math.round(value * (1 - (1 - k) ** 3)));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    if (el) io.observe(el);
    return () => io.disconnect();
  }, [value]);
  return (
    <p ref={ref} className="text-3xl font-bold tabular-nums text-white">
      {value === undefined ? '-' : n.toLocaleString()}
    </p>
  );
}

interface Hot {
  linkId: string;
  from: string;
  to: string;
  operator: string;
  trendPct: number | null;
  priceFrom: number | null;
  currency: string;
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const [stats, setStats] = useState<{
    links: number;
    operators: number;
    availableLinks: number;
    routes: number;
  } | null>(null);
  const [hot, setHot] = useState<Hot[]>([]);

  useEffect(() => {
    api('/public/stats')
      .then(setStats)
      .catch(() => setStats(null));
  }, []);
  useEffect(() => {
    if (!user) return;
    api<{ hotRanking: Hot[] }>('/explorer/graph')
      .then((g) => setHot(g.hotRanking ?? []))
      .catch(() => setHot([]));
  }, [user]);

  const features = ['api', 'map', 'ai', 'pay'] as const;
  const FADE = ['animate-fade-up', 'animate-fade-up-1', 'animate-fade-up-2', 'animate-fade-up-3'];
  const icons: Record<(typeof features)[number], string> = {
    api: '⇄',
    map: '⌖',
    ai: '✦',
    pay: '▣',
  };
  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-brand-700 via-brand-500 to-slate-950 p-10 md:p-14">
        <div className="animate-blob pointer-events-none absolute -right-28 -top-28 h-96 w-96 rounded-full bg-accent-500/25 blur-3xl" />
        <div className="animate-blob pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-sky-400/15 blur-3xl [animation-delay:-6s]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:linear-gradient(rgba(255,255,255,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative">
          <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.3em] text-sky-200">
            {t('brand.tagline')}
          </p>
          <h1 className="animate-fade-up-1 mt-4 max-w-3xl text-4xl font-bold leading-tight text-white md:text-5xl">
            {t('home.title')}
          </h1>
          <p className="animate-fade-up-2 mt-4 max-w-2xl text-lg text-slate-200">
            {t('home.subtitle')}
          </p>
          <p className="animate-fade-up-2 mt-2 max-w-2xl text-sm text-slate-300">
            {t('brand.universal')}
          </p>
          <div className="animate-fade-up-3 mt-9 flex flex-wrap gap-3">
            {user ? (
              <Link href={homeFor(user)} className="btn-primary !px-6 !py-3 text-base">
                {t('home.openApp')}
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-primary !px-6 !py-3 text-base">
                  {t('nav.login')}
                </Link>
                <Link href="/register" className="btn-ghost !px-6 !py-3 text-base">
                  {t('home.register')}
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {user && hot.length > 0 && (
        <section aria-label={t('home.live')} className="overflow-hidden">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-red-500" />
            {t('home.live')}
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#020617] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#020617] to-transparent" />
            <div className="animate-marquee flex w-max gap-3">
              {[...hot, ...hot].map((h, i) => (
                <Link
                  key={`${h.linkId}-${i}`}
                  href={`/links/${h.linkId}`}
                  className="card card-hover flex items-center gap-3 !rounded-full !px-4 !py-2 whitespace-nowrap"
                >
                  <span className="text-white">
                    {h.from} → {h.to}
                  </span>
                  {h.trendPct !== null && (
                    <span
                      className={`text-xs font-semibold ${h.trendPct >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                    >
                      {h.trendPct >= 0 ? '▲' : '▼'} {Math.abs(Math.round(h.trendPct))}%
                    </span>
                  )}
                  <span className="text-xs text-slate-400">
                    {money(h.priceFrom, h.currency, loc)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ['links', stats?.links],
            ['available', stats?.availableLinks],
            ['operators', stats?.operators],
            ['routes', stats?.routes],
          ] as const
        ).map(([k, v], i) => (
          <div key={k} className={`card card-hover ${FADE[i]}`}>
            <Count value={v} />
            <p className="mt-1 text-sm text-slate-400">{t(`home.stat.${k}`)}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {features.map((f, i) => (
          <div key={f} className={`card card-hover ${FADE[Math.min(i, 3)]} group`}>
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-xl text-sky-300 transition group-hover:scale-110 group-hover:bg-brand-500/30">
              {icons[f]}
            </div>
            <h3 className="font-semibold text-white">{t(`home.feature.${f}.title`)}</h3>
            <p className="mt-2 text-sm text-slate-400">{t(`home.feature.${f}.body`)}</p>
          </div>
        ))}
      </section>

      <section className="card relative overflow-hidden !border-brand-500/40 p-8 text-center">
        <div className="animate-blob pointer-events-none absolute -left-16 top-0 h-56 w-56 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative space-y-3">
          <h2 className="text-2xl font-bold text-white">{t('home.ctaTitle')}</h2>
          <p className="mx-auto max-w-xl text-slate-400">{t('home.ctaBody')}</p>
          <div className="pt-2">
            <Link href={user ? '/explore' : '/register'} className="btn-primary !px-6 !py-3">
              {t(user ? 'home.openApp' : 'home.ctaButton')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
