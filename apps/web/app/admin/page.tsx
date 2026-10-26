'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, download, errMessage, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, RequireRole, Status } from '@/components/ui';
import { TicketTable } from '@/components/TicketTable';

type Tab =
  | 'overview'
  | 'operators'
  | 'users'
  | 'ledger'
  | 'sync'
  | 'tickets'
  | 'settings'
  | 'locations'
  | 'export';
const TABS: Tab[] = [
  'overview',
  'operators',
  'users',
  'ledger',
  'sync',
  'tickets',
  'settings',
  'locations',
  'export',
];

function Shell() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{t('nav.admin')}</h1>
      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-brand-500 text-white' : 'text-slate-400'}`}
          >
            {t(`admin.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'operators' && <Operators />}
      {tab === 'users' && <Users />}
      {tab === 'ledger' && <Ledger />}
      {tab === 'sync' && <SyncRuns />}
      {tab === 'tickets' && <AdminTickets />}
      {tab === 'settings' && <Settings />}
      {tab === 'locations' && <Locations />}
      {tab === 'export' && <ExportData />}
    </div>
  );
}

function Locations() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ name: '', province: '', lat: '', lng: '' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api('/admin/reference/locations')
        .then(setRows)
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMessage(e, t));
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{t('admin.locations.hint')}</p>
      <div className="card grid gap-3 md:grid-cols-5">
        {(['name', 'province', 'lat', 'lng'] as const).map((k) => (
          <div key={k}>
            <label className="label">{t(`admin.locations.${k}`)}</label>
            <input
              className="input"
              type={k === 'lat' || k === 'lng' ? 'number' : 'text'}
              step="any"
              value={f[k]}
              onChange={(e) => setF({ ...f, [k]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex items-end">
          <button
            className="btn-primary w-full"
            disabled={!f.name || f.lat === '' || f.lng === ''}
            onClick={() =>
              run(async () => {
                await api('/admin/reference/locations', {
                  body: {
                    name: f.name,
                    province: f.province || null,
                    lat: Number(f.lat),
                    lng: Number(f.lng),
                  },
                });
                setF({ name: '', province: '', lat: '', lng: '' });
              })
            }
          >
            {t('common.add')}
          </button>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <tbody className="divide-y divide-slate-800">
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="td">{l.name}</td>
                <td className="td">{l.province}</td>
                <td className="td font-mono text-xs">
                  {l.lat}, {l.lng}
                </td>
                <td className="td">
                  <button
                    onClick={() =>
                      run(() =>
                        api(`/admin/reference/locations/${l.id}`, {
                          method: 'PATCH',
                          body: { isActive: !l.isActive },
                        }),
                      )
                    }
                  >
                    <Status value={l.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExportData() {
  const { t } = useI18n();
  const [rows, setRows] = useState<{ entity: string; rows: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api('/admin/export')
      .then(setRows)
      .catch((e) => setError(errMessage(e, t)));
  }, [t]);
  const get = async (entity: string, format: 'csv' | 'json') => {
    setError(null);
    try {
      await download(`/admin/export/${entity}?format=${format}`, `${entity}.${format}`);
    } catch (e) {
      setError(errMessage(e, t));
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{t('admin.export.hint')}</p>
      <ErrorNote error={error} />
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <tbody className="divide-y divide-slate-800">
            {rows?.map((r) => (
              <tr key={r.entity}>
                <td className="td font-mono text-sm">{r.entity}</td>
                <td className="td tabular-nums">{r.rows}</td>
                <td className="td">
                  <div className="flex gap-2">
                    <button
                      className="btn-ghost !py-1 text-xs"
                      onClick={() => get(r.entity, 'csv')}
                    >
                      CSV
                    </button>
                    <button
                      className="btn-ghost !py-1 text-xs"
                      onClick={() => get(r.entity, 'json')}
                    >
                      JSON
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Overview() {
  const { t } = useI18n();
  const [o, setO] = useState<any>(null);
  useEffect(() => {
    api('/admin/overview').then(setO);
  }, []);
  if (!o) return <p className="text-slate-400">{t('common.loading')}</p>;
  const cards: [string, string | number][] = [
    ['admin.stat.users', o.users],
    ['admin.stat.operators', o.operators],
    ['admin.stat.pending', o.pendingOperators],
    ['admin.stat.links', o.links],
    ['admin.stat.reservations', o.reservations],
    ['admin.stat.paid', o.paidPayments],
    ['admin.stat.volume', money(o.grossVolume)],
    ['admin.stat.ledger', o.ledgerEntries],
    ['admin.stat.syncFail', o.syncFailures24h],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([k, v]) => (
        <div key={k} className="card">
          <p className="text-2xl font-bold text-white">{v}</p>
          <p className="text-sm text-slate-400">{t(k)}</p>
        </div>
      ))}
    </div>
  );
}

function Operators() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api('/admin/operators').then(setRows), []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, kind: 'approve' | 'reject') {
    setError(null);
    try {
      const reason = kind === 'reject' ? window.prompt(t('admin.rejectReason')) : undefined;
      if (kind === 'reject' && !reason) return;
      await api(`/admin/operators/${id}/${kind}`, { body: { reason } });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  if (!rows) return <p className="text-slate-400">{t('common.loading')}</p>;
  return (
    <div className="space-y-3">
      <ErrorNote error={error} />
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <thead>
            <tr>
              {['op.name', 'auth.email', 'admin.col.links', 'link.status', ''].map((h, i) => (
                <th key={i} className="th">
                  {h && t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="td">
                  {o.displayName}
                  <p className="text-xs text-slate-500">{o.legalName}</p>
                </td>
                <td className="td">{o.user.email}</td>
                <td className="td">
                  {o._count.links} / {o._count.apiConfigs} API
                </td>
                <td className="td">
                  <Status value={o.approvalStatus} />
                </td>
                <td className="td space-x-2">
                  {o.approvalStatus !== 'APPROVED' && (
                    <button
                      className="btn-primary !py-1 text-xs"
                      onClick={() => act(o.id, 'approve')}
                    >
                      {t('admin.approve')}
                    </button>
                  )}
                  {o.approvalStatus === 'PENDING' && (
                    <button className="btn-ghost !py-1 text-xs" onClick={() => act(o.id, 'reject')}>
                      {t('admin.reject')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Users() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(() => api('/admin/users').then(setRows), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!rows) return <p className="text-slate-400">{t('common.loading')}</p>;
  return (
    <div className="card overflow-x-auto !p-0">
      <table className="w-full">
        <thead>
          <tr>
            {['auth.fullName', 'auth.email', 'admin.col.roles', 'link.status', ''].map((h, i) => (
              <th key={i} className="th">
                {h && t(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((u) => (
            <tr key={u.id}>
              <td className="td">{u.fullName}</td>
              <td className="td">{u.email}</td>
              <td className="td">{u.roles.map((r: any) => r.role.key).join(', ')}</td>
              <td className="td">
                <Status value={u.status} />
              </td>
              <td className="td">
                <button
                  className="text-xs text-slate-300 underline"
                  onClick={async () => {
                    await api(`/admin/users/${u.id}/status`, {
                      method: 'PATCH',
                      body: { status: u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' },
                    }).catch(() => undefined);
                    load();
                  }}
                >
                  {u.status === 'SUSPENDED' ? t('admin.activate') : t('admin.suspend')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ledger() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<{ total: number; items: any[] } | null>(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [verify, setVerify] = useState<any>(null);
  useEffect(() => {
    api(`/admin/ledger?page=${page}&pageSize=20${type ? `&eventType=${type}` : ''}`).then(setData);
  }, [page, type]);
  const pages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input !w-auto"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('mp.any')}</option>
          {[
            'USER_EVENT',
            'OPERATOR_APPROVAL',
            'API_CONFIG_CHANGE',
            'API_SYNC',
            'LINK_UPDATE',
            'LINK_LOCK',
            'RESERVATION',
            'PAYMENT',
            'AI_ANALYSIS',
            'ADMIN_ACTION',
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button
          className="btn-ghost"
          onClick={async () => setVerify(await api('/admin/ledger/verify'))}
        >
          {t('admin.verifyChain')}
        </button>
        {verify && (
          <span className={verify.valid ? 'text-emerald-300' : 'text-red-300'}>
            {verify.valid
              ? t('admin.chainOk', { n: verify.checked })
              : t('admin.chainBroken', { n: verify.brokenAtSequence })}
          </span>
        )}
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <thead>
            <tr>
              {[
                '#',
                'admin.col.time',
                'admin.col.event',
                'admin.col.action',
                'admin.col.actor',
                'admin.col.amount',
                'link.status',
                'admin.col.hash',
              ].map((h) => (
                <th key={h} className="th">
                  {h === '#' ? h : t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.sequence}</td>
                <td className="td whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')}
                </td>
                <td className="td">{r.eventType}</td>
                <td className="td">
                  {r.action}
                  {r.message && <p className="text-xs text-slate-500">{r.message}</p>}
                </td>
                <td className="td">{r.actor ?? '-'}</td>
                <td className="td">
                  {r.amount === null ? '-' : money(r.amount, r.currency ?? 'IDR')}
                </td>
                <td className="td">
                  <Status value={r.status} />
                </td>
                <td className="td font-mono text-xs text-slate-500">{r.hash.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-center gap-3">
        <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          &larr;
        </button>
        <span className="text-sm text-slate-400">
          {page} / {pages}
        </span>
        <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          &rarr;
        </button>
      </div>
    </div>
  );
}

function SyncRuns() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    const load = () => api('/admin/sync-runs').then(setRows);
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, []);
  if (!rows) return <p className="text-slate-400">{t('common.loading')}</p>;
  return (
    <div className="card overflow-x-auto !p-0">
      <table className="w-full">
        <thead>
          <tr>
            {[
              'admin.col.time',
              'op.name',
              'admin.col.trigger',
              'link.status',
              'admin.col.result',
              'admin.col.duration',
            ].map((h) => (
              <th key={h} className="th">
                {t(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="td whitespace-nowrap">{new Date(r.startedAt).toLocaleTimeString()}</td>
              <td className="td">{r.apiConfig.operatorProfile.displayName}</td>
              <td className="td">{r.trigger}</td>
              <td className="td">
                <Status value={r.status} />
              </td>
              <td className="td">
                {r.errorMessage ??
                  `${r.linksSeen} seen / ${r.linksUpdated} upd / ${r.linksCreated} new`}
              </td>
              <td className="td">{r.durationMs ?? '-'} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminTickets() {
  const { t } = useI18n();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          className="btn-ghost"
          onClick={async () => {
            const r = await api('/admin/quality/recompute', { method: 'POST', body: {} });
            setMsg(t('admin.tickets.queued', { n: r.recomputed }));
          }}
        >
          {t('admin.tickets.recompute')}
        </button>
        {msg && (
          <span className="text-sm text-emerald-300" role="status">
            {msg}
          </span>
        )}
      </div>
      <TicketTable />
    </div>
  );
}

function Settings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api('/admin/settings').then(setRows), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!rows) return <p className="text-slate-400">{t('common.loading')}</p>;
  return (
    <div className="space-y-3">
      <ErrorNote error={error} />
      <div className="card divide-y divide-slate-800 !p-0">
        {rows.map((s) => (
          <div key={s.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-mono text-sm text-white">{s.key}</p>
              <p className="text-xs text-slate-500">{s.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input !w-56"
                value={edit[s.key] ?? JSON.stringify(s.value)}
                onChange={(e) => setEdit({ ...edit, [s.key]: e.target.value })}
              />
              <button
                className="btn-ghost !py-1 text-xs"
                onClick={async () => {
                  setError(null);
                  try {
                    await api(`/admin/settings/${s.key}`, {
                      method: 'PUT',
                      body: { value: JSON.parse(edit[s.key] ?? JSON.stringify(s.value)) },
                    });
                    load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['ADMIN']}>
      <Shell />
    </RequireRole>
  );
}
