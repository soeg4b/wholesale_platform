'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, capacity, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Map } from '@/components/Map';
import { PerformanceCard } from '@/components/PerformanceCard';
import { ReportIssue } from '@/components/ReportIssue';
import { ErrorNote, RequireRole, Sparkline, Status } from '@/components/ui';

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { t, tr, locale } = useI18n();
  const { hasRole } = useAuth();
  const router = useRouter();
  const [link, setLink] = useState<any>(null);
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [term, setTerm] = useState(12);
  const [quote, setQuote] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = (n: number, cur: string) => money(n, cur, locale === 'id' ? 'id-ID' : 'en-US');

  useEffect(() => {
    api(`/links/${id}`)
      .then(setLink)
      .catch((e) => setError(e.message));
    api<GeoJSON.FeatureCollection>(`/geo/link/${id}`)
      .then(setGeo)
      .catch(() => setGeo(null));
  }, [id]);

  useEffect(() => {
    api(`/links/${id}/quote?termMonths=${term}`)
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [id, term]);

  async function addToCart() {
    setBusy(true);
    setError(null);
    try {
      await api('/cart/items', { body: { linkId: id, termMonths: term } });
      router.push('/cart');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!link) return <p className="text-slate-400">{error ?? t('common.loading')}</p>;

  const markers = [
    link.originLat !== null && { lat: link.originLat, lng: link.originLng, label: link.originName },
    link.destinationLat !== null && {
      lat: link.destinationLat,
      lng: link.destinationLng,
      label: link.destinationName,
    },
  ].filter(Boolean) as { lat: number; lng: number; label: string }[];
  const latencies = (link.metrics as any[]).map((m) => m.latencyMs).filter((v) => v !== null);

  return (
    <div className="space-y-6">
      <Link href="/marketplace" className="text-sm text-sky-400">
        &larr; {t('nav.marketplace')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-sky-400">
            <Link href={`/providers/${link.operator.id}`} className="hover:underline">
              {link.operator.displayName}
            </Link>{' '}
            - {link.category.replace('_', ' ')}
          </p>
          <h1 className="text-2xl font-bold text-white">{tr(link.name)}</h1>
          <p className="text-slate-400">
            {link.originName} &rarr; {link.destinationName}
          </p>
        </div>
        <Status value={link.availability} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="card">
            <h2 className="mb-3 font-semibold text-white">{t('link.route')}</h2>
            <Map
              routes={
                geo?.features.length ? [{ id: link.id, geojson: geo, label: tr(link.name) }] : []
              }
              markers={markers}
            />
            {!link.hasGeometry && (
              <p className="mt-2 text-xs text-slate-500">{t('link.noGeometry')}</p>
            )}
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold text-white">{t('link.specs')}</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              {[
                [t('link.capacity'), capacity(link.capacityMbps)],
                [t('link.available'), capacity(link.availableMbps)],
                [t('link.latency'), link.latencyMs === null ? '-' : `${link.latencyMs} ms`],
                ['SLA', link.slaPercent === null ? '-' : `${link.slaPercent}%`],
                [t('link.distance'), link.distanceKm === null ? '-' : `${link.distanceKm} km`],
                [
                  t('link.redundancy'),
                  link.redundancyScore === null
                    ? '-'
                    : `${Math.round(link.redundancyScore * 100)}%`,
                ],
                [
                  t('link.synced'),
                  link.lastSyncedAt
                    ? new Date(link.lastSyncedAt).toLocaleString(
                        locale === 'id' ? 'id-ID' : 'en-US',
                      )
                    : '-',
                ],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="text-white">{v}</dd>
                </div>
              ))}
            </dl>
            {latencies.length > 1 && (
              <div className="mt-5">
                <p className="mb-1 text-xs text-slate-500">{t('link.latencyTrend')}</p>
                <Sparkline values={latencies} width={420} height={56} />
              </div>
            )}
          </div>
          <PerformanceCard linkId={link.id} perf={link.performance} />
        </div>

        <aside className="card h-fit space-y-4">
          <h2 className="font-semibold text-white">{t('link.pricing')}</h2>
          <div>
            <label className="label">{t('link.term')}</label>
            <select
              className="input"
              value={term}
              onChange={(e) => setTerm(Number(e.target.value))}
            >
              {[1, 12, 24, 36].map((m) => (
                <option key={m} value={m}>
                  {m} {t('common.months')}
                </option>
              ))}
            </select>
          </div>
          {quote && (
            <div className="space-y-2 rounded-lg bg-slate-950 p-3 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>{t('link.basePrice')}</span>
                <span>{fmt(quote.basePrice, quote.currency)}</span>
              </div>
              {quote.applied.map((a: any) => (
                <div key={a.ruleId} className="flex justify-between text-emerald-300">
                  <span>{a.name}</span>
                  <span>{fmt(a.after - a.before, quote.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-800 pt-2 text-base font-semibold text-white">
                <span>{t('link.monthly')}</span>
                <span>{fmt(quote.unitPrice, quote.currency)}</span>
              </div>
            </div>
          )}
          <ErrorNote error={error} />
          {hasRole('PENYEWA') ? (
            <>
              <button
                className="btn-primary w-full"
                disabled={busy || link.availability !== 'AVAILABLE'}
                onClick={addToCart}
              >
                {link.availability === 'AVAILABLE' ? t('link.addToCart') : t('link.unavailable')}
              </button>
              <ReportIssue linkId={link.id} />
            </>
          ) : (
            <p className="text-xs text-slate-500">{t('link.buyerOnly')}</p>
          )}
          <p className="text-xs text-slate-500">{t('link.billingNote')}</p>
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['PENYEWA', 'PENYELENGGARA']}>
      <Detail />
    </RequireRole>
  );
}
