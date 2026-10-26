'use client';

import dynamic from 'next/dynamic';
import { useI18n } from '@/lib/i18n';
import type { MapMarker, MapRoute } from './MapView';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-xl bg-slate-900" />,
});

export function Map(props: { routes: MapRoute[]; markers?: MapMarker[]; height?: number }) {
  const { t } = useI18n();
  if (!props.routes.length && !props.markers?.length) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-500">
        {t('map.empty')}
      </div>
    );
  }
  return <MapView {...props} />;
}
