'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export function RequireRole({ roles, children }: { roles?: string[]; children: React.ReactNode }) {
  const { user, loading, hasRole } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) return <p className="text-slate-400">{t('common.loading')}</p>;
  if (roles && !hasRole(...roles)) return <p className="text-red-400">{t('common.forbidden')}</p>;
  return <>{children}</>;
}

const COLORS: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500/15 text-emerald-300',
  ACTIVE: 'bg-emerald-500/15 text-emerald-300',
  APPROVED: 'bg-emerald-500/15 text-emerald-300',
  PAID: 'bg-emerald-500/15 text-emerald-300',
  CONFIRMED: 'bg-emerald-500/15 text-emerald-300',
  SUCCESS: 'bg-emerald-500/15 text-emerald-300',
  LOCKED: 'bg-amber-500/15 text-amber-300',
  PENDING: 'bg-amber-500/15 text-amber-300',
  AWAITING_PAYMENT: 'bg-amber-500/15 text-amber-300',
  INITIATED: 'bg-amber-500/15 text-amber-300',
  RESERVED: 'bg-sky-500/15 text-sky-300',
  PARTIAL: 'bg-amber-500/15 text-amber-300',
  UNAVAILABLE: 'bg-slate-500/20 text-slate-300',
  MAINTENANCE: 'bg-slate-500/20 text-slate-300',
  INACTIVE: 'bg-slate-500/20 text-slate-300',
  DRAFT: 'bg-slate-500/20 text-slate-300',
  EXPIRED: 'bg-slate-500/20 text-slate-300',
  CANCELLED: 'bg-slate-500/20 text-slate-300',
  FAILED: 'bg-red-500/15 text-red-300',
  REJECTED: 'bg-red-500/15 text-red-300',
  SUSPENDED: 'bg-red-500/15 text-red-300',
  ERROR: 'bg-red-500/15 text-red-300',
  OPEN: 'bg-amber-500/15 text-amber-300',
  ACKNOWLEDGED: 'bg-sky-500/15 text-sky-300',
  IN_PROGRESS: 'bg-sky-500/15 text-sky-300',
  RESOLVED: 'bg-emerald-500/15 text-emerald-300',
  CLOSED: 'bg-slate-500/20 text-slate-300',
  HIGH: 'bg-red-500/15 text-red-300',
  WARN: 'bg-amber-500/15 text-amber-300',
};

export function Status({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span className={`badge ${COLORS[value] ?? 'bg-slate-700 text-slate-200'}`}>
      {t(`status.${value}`)}
    </span>
  );
}

export function Sparkline({
  values,
  width = 240,
  height = 48,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * width},${height - 4 - ((v - min) / span) * (height - 8)}`,
    )
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend"
    >
      <polyline fill="none" stroke="#38bdf8" strokeWidth="2" points={pts} />
    </svg>
  );
}

export function DemoBadge() {
  const { t } = useI18n();
  return (
    <span className="badge bg-fuchsia-500/15 text-fuchsia-300" title={t('demo.note')}>
      {t('demo.badge')}
    </span>
  );
}

// Neutral bar on purpose: the UI never encodes a good/bad threshold, only the number and its basis.
export function ScoreBar({ value, label }: { value: number | null; label?: string }) {
  const { t } = useI18n();
  if (value === null) return <span className="text-xs text-slate-500">{t('perf.noData')}</span>;
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <div className="h-2 w-24 rounded-full bg-slate-800">
        <div className="h-2 rounded-full bg-sky-400" style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="text-sm tabular-nums text-white">{Math.round(value)}</span>
    </div>
  );
}

export function PerfChip({ perf }: { perf?: { rated: boolean; score?: number | null } | null }) {
  const { t } = useI18n();
  if (!perf?.rated)
    return <span className="badge bg-slate-700 text-slate-300">{t('perf.notRated')}</span>;
  return (
    <span className="badge bg-sky-500/15 text-sky-300">
      {t('perf.score')} {perf.score}/100
    </span>
  );
}

export function InsufficientNote({ needed, have }: { needed: number; have: number }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">
      {t('insight.insufficient', { needed, have })}
    </div>
  );
}

export function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-500">-</span>;
  const full = Math.round(value);
  return (
    <span className="text-amber-300" aria-label={`${value}/5`}>
      {'★'.repeat(full)}
      <span className="text-slate-600">{'★'.repeat(5 - full)}</span>
    </span>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {error}
    </p>
  ) : null;
}
