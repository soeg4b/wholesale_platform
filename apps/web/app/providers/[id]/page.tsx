'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, capacity, errMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { DemoBadge, ErrorNote, RequireRole, Stars } from '@/components/ui';

function PublicProvider() {
  const { id } = useParams<{ id: string }>();
  const { t, tr, locale } = useI18n();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/providers/${id}`)
      .then(setD)
      .catch((e) => setError(errMessage(e, t)));
  }, [id, t]);

  if (!d)
    return error ? (
      <ErrorNote error={error} />
    ) : (
      <p className="text-slate-400">{t('common.loading')}</p>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{d.displayName}</h1>
          <p className="text-slate-400">{tr(d.description)}</p>
          <p className="text-xs text-slate-500">
            {t('prov.memberSince')} {new Date(d.memberSince).toLocaleDateString(loc)}
            {d.website && (
              <>
                {' - '}
                <a
                  href={d.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300"
                >
                  {d.website}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          {d.tier && (
            <span className="badge bg-yellow-500/15 text-yellow-300">{tr(d.tier.name)}</span>
          )}
          <p className="mt-1">
            <Stars value={d.reviews.average} />{' '}
            <span className="text-sm text-slate-400">({d.reviews.count})</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/marketplace?operatorId=${d.id}`} className="btn-primary">
          {t('prov.seeLinks', { n: d.links.length })}
        </Link>
        {d.prebuildProducts > 0 && (
          <Link href="/prebuild" className="btn-ghost">
            {t('prov.seePrebuild', { n: d.prebuildProducts })}
          </Link>
        )}
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <tbody className="divide-y divide-slate-800">
            {d.links.map((l: any) => (
              <tr key={l.id}>
                <td className="td">
                  <Link href={`/links/${l.id}`} className="text-sky-300 hover:underline">
                    {l.originName} &rarr; {l.destinationName}
                  </Link>
                </td>
                <td className="td">{l.category}</td>
                <td className="td">{capacity(l.capacityMbps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold text-white">{t('prov.reviews')}</h2>
        {d.reviews.latest.map((r: any) => (
          <div key={r.id} className="rounded-lg border border-slate-800 p-3 text-sm">
            <div className="flex justify-between">
              <span>
                <Stars value={r.rating} /> <span className="text-slate-300">{r.company}</span>
              </span>
              <span className="text-xs text-slate-500">
                {new Date(r.createdAt).toLocaleDateString(loc)} {r.isDemo && <DemoBadge />}
              </span>
            </div>
            {r.comment && <p className="mt-1 text-slate-300">{r.comment}</p>}
            {r.reply && (
              <p className="mt-1 border-l-2 border-sky-500 pl-2 text-xs text-sky-200">{r.reply}</p>
            )}
          </div>
        ))}
        {!d.reviews.latest.length && (
          <p className="text-sm text-slate-500">{t('prov.noReviews')}</p>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole>
      <PublicProvider />
    </RequireRole>
  );
}
