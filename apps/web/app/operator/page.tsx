'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, RequireRole, Status } from '@/components/ui';
import { InsightsTab } from '@/components/InsightsTab';
import { PerformanceTab } from '@/components/PerformanceTab';
import { AddOnsTab } from '@/components/AddOnsTab';
import { TicketTable } from '@/components/TicketTable';
import { PrebuildTab } from '@/components/PrebuildTab';
import { OperatorLinksTab } from '@/components/OperatorLinksTab';

type Tab =
  | 'links'
  | 'integrations'
  | 'geo'
  | 'pricing'
  | 'insights'
  | 'tickets'
  | 'performance'
  | 'addons'
  | 'prebuild';
const TABS: Tab[] = [
  'insights',
  'links',
  'performance',
  'tickets',
  'integrations',
  'geo',
  'pricing',
  'prebuild',
  'addons',
];

function Shell() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('insights');
  const [requestId, setRequestId] = useState<string | undefined>();
  useEffect(() => {
    // Deep link from the requests board: /operator?tab=prebuild&request=<id>
    const q = new URLSearchParams(window.location.search);
    const want = q.get('tab') as Tab | null;
    if (want && TABS.includes(want)) setTab(want);
    setRequestId(q.get('request') ?? undefined);
  }, []);
  const [overview, setOverview] = useState<any>(null);
  useEffect(() => {
    api('/operator/overview')
      .then(setOverview)
      .catch(() => undefined);
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {user?.operator?.displayName ?? t('nav.operator')}
          </h1>
          {overview && <Status value={overview.profile.approvalStatus} />}
        </div>
      </div>
      {overview?.profile.approvalStatus === 'PENDING' && (
        <div className="card border-amber-500/40 text-amber-300">{t('op.pending')}</div>
      )}
      {overview?.profile.approvalStatus === 'REJECTED' && (
        <div className="card border-red-500/40 text-red-300">
          {t('op.rejected')}: {overview.profile.rejectionReason}
        </div>
      )}
      {overview && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['op.stat.links', overview.links],
            ['op.stat.available', overview.available],
            ['op.stat.integrations', overview.activeIntegrations],
            ['op.stat.revenue', money(overview.revenue)],
          ].map(([k, v]) => (
            <div key={k as string} className="card">
              <p className="text-2xl font-bold text-white">{v}</p>
              <p className="text-sm text-slate-400">{t(k as string)}</p>
            </div>
          ))}
        </div>
      )}
      <div
        className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-slate-800"
        role="tablist"
      >
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-brand-500 text-white' : 'text-slate-400'}`}
          >
            {t(`op.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'insights' && <InsightsTab onGoto={(k) => setTab(k as Tab)} />}
      {tab === 'links' && <OperatorLinksTab />}
      {tab === 'performance' && <PerformanceTab />}
      {tab === 'tickets' && <TicketTable operator />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'geo' && <GeoTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'prebuild' && <PrebuildTab requestId={requestId} />}
      {tab === 'addons' && <AddOnsTab />}
    </div>
  );
}

function IntegrationsTab() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>({ name: '', baseUrl: '', authType: 'BEARER' });
  const [text, setText] = useState({ credentials: '{}', endpoints: '{}', fieldMapping: '{}' });
  // The starter configuration is a platform setting (integration.template), editable by admins.
  useEffect(() => {
    api('/reference/integration-template')
      .then((tpl: any) => {
        setForm({ name: tpl.name, baseUrl: tpl.baseUrl, authType: tpl.authType });
        setText({
          credentials: JSON.stringify(tpl.credentials, null, 2),
          endpoints: JSON.stringify(tpl.endpoints, null, 2),
          fieldMapping: JSON.stringify(tpl.fieldMapping, null, 2),
        });
      })
      .catch(() => undefined);
  }, []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);
  const load = useCallback(
    () =>
      api('/operator/api-configs')
        .then(setRows)
        .catch(() => setRows([])),
    [],
  );
  useEffect(() => {
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [load]);

  async function create() {
    setError(null);
    try {
      await api('/operator/api-configs', {
        body: {
          name: form.name,
          baseUrl: form.baseUrl,
          authType: form.authType,
          syncMode: form.syncMode ?? 'POLLING',
          pollingIntervalSec: Number(form.pollingIntervalSec ?? 300),
          credentials: JSON.parse(text.credentials),
          endpoints: JSON.parse(text.endpoints),
          fieldMapping: JSON.parse(text.fieldMapping),
        },
      });
      setOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function action(id: string, kind: 'test' | 'sync' | 'runs') {
    setError(null);
    setInfo(null);
    try {
      setInfo({
        kind,
        id,
        data: await api(`/operator/api-configs/${id}/${kind}`, {
          method: kind === 'runs' ? 'GET' : 'POST',
        }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setOpen(!open)}>
          {t('op.addIntegration')}
        </button>
      </div>
      {open && (
        <div className="card space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">{t('op.name')}</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Base URL</label>
              <input
                className="input"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Auth</label>
              <select
                className="input"
                value={form.authType}
                onChange={(e) => setForm({ ...form, authType: e.target.value })}
              >
                {['NONE', 'BEARER', 'API_KEY', 'BASIC', 'OAUTH2_CLIENT_CREDENTIALS', 'HMAC'].map(
                  (a) => (
                    <option key={a}>{a}</option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label className="label">{t('op.interval')}</label>
              <input
                className="input"
                type="number"
                min={30}
                value={form.pollingIntervalSec ?? 300}
                onChange={(e) => setForm({ ...form, pollingIntervalSec: e.target.value })}
              />
            </div>
          </div>
          {(['credentials', 'endpoints', 'fieldMapping'] as const).map((k) => (
            <div key={k}>
              <label className="label">{t(`op.json.${k}`)}</label>
              <textarea
                className="input min-h-[120px] font-mono text-xs"
                value={text[k]}
                onChange={(e) => setText({ ...text, [k]: e.target.value })}
              />
            </div>
          ))}
          <p className="text-xs text-slate-500">{t('op.json.hint')}</p>
          <ErrorNote error={error} />
          <button className="btn-primary" onClick={create}>
            {t('common.save')}
          </button>
        </div>
      )}
      <ErrorNote error={open ? null : error} />
      {rows?.map((c) => (
        <div key={c.id} className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-white">{c.name}</p>
              <p className="font-mono text-xs text-slate-500">{c.baseUrl}</p>
            </div>
            <div className="flex items-center gap-2">
              <Status value={c.status} />
              <span className="text-xs text-slate-400">
                {c.linkCount} {t('op.stat.links').toLowerCase()}
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            {c.authType} - {t('op.every')} {c.pollingIntervalSec}s - {t('op.lastSync')}:{' '}
            {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleTimeString() : '-'}
            {c.lastError && <span className="text-red-300"> - {c.lastError}</span>}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1 text-xs" onClick={() => action(c.id, 'test')}>
              {t('op.test')}
            </button>
            <button className="btn-ghost !py-1 text-xs" onClick={() => action(c.id, 'sync')}>
              {t('op.syncNow')}
            </button>
            <button className="btn-ghost !py-1 text-xs" onClick={() => action(c.id, 'runs')}>
              {t('op.runs')}
            </button>
          </div>
          {info?.id === c.id && (
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
              {JSON.stringify(info.data, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function GeoTab() {
  const { t } = useI18n();
  const [files, setFiles] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState({ geoId: '', linkId: '', featureId: '' });
  const load = useCallback(() => {
    api('/geo')
      .then(setFiles)
      .catch(() => undefined);
    api('/operator/links')
      .then(setLinks)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name);
    try {
      await api('/geo/upload', { form });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function doAttach() {
    setError(null);
    try {
      await api(`/geo/${attach.geoId}/attach`, {
        body: { linkId: attach.linkId, featureId: attach.featureId || undefined },
      });
      setAttach({ geoId: '', linkId: '', featureId: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selected = files.find((f) => f.id === attach.geoId);
  const [defaults, setDefaults] = useState({
    category: 'DARK_FIBER',
    capacityMbps: '10000',
    basePrice: '',
  });
  const [created, setCreated] = useState<any>(null);
  async function createLinks(geoId: string) {
    setError(null);
    try {
      setCreated(
        await api(`/geo/${geoId}/create-links`, {
          body: {
            defaults: {
              category: defaults.category || undefined,
              capacityMbps: defaults.capacityMbps ? Number(defaults.capacityMbps) : undefined,
              basePrice: defaults.basePrice ? Number(defaults.basePrice) : undefined,
            },
          },
        }),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <label className="label">{t('op.uploadKmz')}</label>
        <input
          type="file"
          accept=".kmz,.kml,.geojson,.json"
          disabled={busy}
          onChange={upload}
          className="text-sm text-slate-300"
        />
        <ErrorNote error={error} />
      </div>
      <div className="card grid gap-3 md:grid-cols-4">
        <p className="text-sm text-slate-400 md:col-span-4">{t('geo.createHint')}</p>
        <div>
          <label className="label">{t('mp.category')}</label>
          <input
            className="input"
            value={defaults.category}
            onChange={(e) => setDefaults({ ...defaults, category: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('pb.capacityMbps')}</label>
          <input
            className="input"
            type="number"
            value={defaults.capacityMbps}
            onChange={(e) => setDefaults({ ...defaults, capacityMbps: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('link.monthly')}</label>
          <input
            className="input"
            type="number"
            value={defaults.basePrice}
            onChange={(e) => setDefaults({ ...defaults, basePrice: e.target.value })}
          />
        </div>
        {created && (
          <p className="text-sm text-emerald-300 md:col-span-4">
            {t('geo.created', { n: created.created.length, s: created.skipped.length })}{' '}
            {created.created.map((c: any) => c.route).join(', ')}
          </p>
        )}
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <thead>
            <tr>
              {['op.name', 'op.format', 'op.features', 'op.length', 'link.status', ''].map(
                (h, i) => (
                  <th key={i} className="th">
                    {h && t(h)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {files.map((f) => (
              <tr key={f.id}>
                <td className="td">{f.name}</td>
                <td className="td">{f.sourceFormat}</td>
                <td className="td">{f.featureCount ?? '-'}</td>
                <td className="td">{f.totalLengthKm ?? '-'} km</td>
                <td className="td">
                  <Status value={f.parseStatus} />
                </td>
                <td className="td">
                  {f.parseStatus === 'PARSED' && (
                    <button className="btn-ghost !py-1 text-xs" onClick={() => createLinks(f.id)}>
                      {t('geo.createLinks')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {files.length > 0 && (
        <div className="card grid gap-3 md:grid-cols-4">
          <div>
            <label className="label">{t('op.geoFile')}</label>
            <select
              className="input"
              value={attach.geoId}
              onChange={(e) => setAttach({ ...attach, geoId: e.target.value, featureId: '' })}
            >
              <option value="">-</option>
              {files
                .filter((f) => f.parseStatus === 'PARSED')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="label">{t('op.feature')}</label>
            <select
              className="input"
              value={attach.featureId}
              onChange={(e) => setAttach({ ...attach, featureId: e.target.value })}
            >
              <option value="">{t('op.allFeatures')}</option>
              {selected?.features.map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('op.attachTo')}</label>
            <select
              className="input"
              value={attach.linkId}
              onChange={(e) => setAttach({ ...attach, linkId: e.target.value })}
            >
              <option value="">-</option>
              {links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.originName} - {l.destinationName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              className="btn-primary w-full"
              disabled={!attach.geoId || !attach.linkId}
              onClick={doAttach}
            >
              {t('op.attach')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingTab() {
  const { t } = useI18n();
  const [rules, setRules] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: '',
    type: 'TERM_DISCOUNT',
    mode: 'PERCENT',
    value: '-5',
    minTermMonths: '',
    minCapacityMbps: '',
    priority: '100',
  });
  const load = useCallback(
    () =>
      api('/operator/pricing-rules')
        .then(setRules)
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setError(null);
    const conditions: Record<string, number> = {};
    if (f.minTermMonths) conditions.minTermMonths = Number(f.minTermMonths);
    if (f.minCapacityMbps) conditions.minCapacityMbps = Number(f.minCapacityMbps);
    try {
      await api('/operator/pricing-rules', {
        body: {
          name: f.name,
          type: f.type,
          conditions,
          adjustment: { mode: f.mode, value: Number(f.value) },
          priority: Number(f.priority),
        },
      });
      setF({ ...f, name: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="label">{t('op.name')}</label>
          <input
            className="input"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('op.ruleType')}</label>
          <select
            className="input"
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value })}
          >
            {[
              'TERM_DISCOUNT',
              'VOLUME_DISCOUNT',
              'CAPACITY_TIER',
              'SURCHARGE',
              'PROMOTION',
              'BASE_OVERRIDE',
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('op.adjust')}</label>
          <div className="flex gap-2">
            <select
              className="input !w-28"
              value={f.mode}
              onChange={(e) => setF({ ...f, mode: e.target.value })}
            >
              {['PERCENT', 'FIXED', 'OVERRIDE'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input
              className="input"
              type="number"
              value={f.value}
              onChange={(e) => setF({ ...f, value: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label">{t('op.minTerm')}</label>
          <input
            className="input"
            type="number"
            value={f.minTermMonths}
            onChange={(e) => setF({ ...f, minTermMonths: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('op.minCap')} (Mbps)</label>
          <input
            className="input"
            type="number"
            value={f.minCapacityMbps}
            onChange={(e) => setF({ ...f, minCapacityMbps: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('op.priority')}</label>
          <input
            className="input"
            type="number"
            value={f.priority}
            onChange={(e) => setF({ ...f, priority: e.target.value })}
          />
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={!f.name} onClick={create}>
            {t('common.add')}
          </button>
        </div>
        <div className="md:col-span-4">
          <ErrorNote error={error} />
        </div>
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <thead>
            <tr>
              {['op.name', 'op.ruleType', 'op.adjust', 'op.priority', 'link.status', ''].map(
                (h, i) => (
                  <th key={i} className="th">
                    {h && t(h)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.name}</td>
                <td className="td">{r.type}</td>
                <td className="td">
                  {r.adjustment.mode} {r.adjustment.value}
                </td>
                <td className="td">{r.priority}</td>
                <td className="td">
                  <button
                    onClick={async () => {
                      await api(`/operator/pricing-rules/${r.id}`, {
                        method: 'PATCH',
                        body: { isActive: !r.isActive },
                      });
                      load();
                    }}
                  >
                    <Status value={r.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </button>
                </td>
                <td className="td">
                  <button
                    className="text-xs text-red-400"
                    onClick={async () => {
                      await api(`/operator/pricing-rules/${r.id}`, { method: 'DELETE' });
                      load();
                    }}
                  >
                    {t('common.remove')}
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

export default function Page() {
  return (
    <RequireRole roles={['PENYELENGGARA']}>
      <Shell />
    </RequireRole>
  );
}
