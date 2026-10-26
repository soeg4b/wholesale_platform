'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, capacity, download, errMessage, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorNote, Status } from '@/components/ui';

// Minimal RFC4180 CSV parser (quoted fields, escaped quotes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

export function OperatorLinksTab() {
  const { t, tr, locale } = useI18n();
  const loc = locale === 'id' ? 'id-ID' : 'en-US';
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState({ text: '', status: '' });
  const [sel, setSel] = useState<string[]>([]);
  const [bulk, setBulk] = useState({ mode: 'PERCENT', value: '' });
  const [preview, setPreview] = useState<any>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api('/operator/links')
        .then(setRows)
        .catch(() => setRows([])),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<any>) => {
    setError(null);
    setInfo(null);
    try {
      return await fn();
    } catch (e) {
      setError(errMessage(e, t));
    }
  };

  const shown = (rows ?? []).filter(
    (l) =>
      (!q.status || l.status === q.status) &&
      (!q.text ||
        `${l.originName} ${l.destinationName} ${l.category} ${l.externalId ?? ''}`
          .toLowerCase()
          .includes(q.text.toLowerCase())),
  );
  const allSel = shown.length > 0 && shown.every((l) => sel.includes(l.id));

  const bulkCall = (dryRun: boolean) =>
    run(async () => {
      const r = await api('/operator/links/bulk-price', {
        body: { linkIds: sel, mode: bulk.mode, value: Number(bulk.value), dryRun },
      });
      setPreview(dryRun ? r : null);
      if (!dryRun) {
        setInfo(t('bulk.applied', { n: r.count }));
        setSel([]);
        load();
      }
    });

  const single = (l: any) => {
    const v = edit[l.id];
    if (v === undefined || v === '' || Number(v) === l.effectivePrice) return;
    run(async () => {
      await api('/operator/links/bulk-price', {
        body: { linkIds: [l.id], mode: 'SET', value: Number(v) },
      });
      setInfo(t('bulk.applied', { n: 1 }));
      setEdit(({ [l.id]: _drop, ...rest }) => rest);
      load();
    });
  };

  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>, dryRun: boolean) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const table = parseCsv(await file.text());
    const head = table[0]?.map((h) => h.trim()) ?? [];
    const idx = (k: string) => head.indexOf(k);
    if (idx('price') < 0 || (idx('linkId') < 0 && idx('externalId') < 0)) {
      setError(t('bulk.csvHeader'));
      return;
    }
    const body = {
      dryRun,
      rows: table.slice(1).map((r) => ({
        linkId: idx('linkId') >= 0 ? r[idx('linkId')] || undefined : undefined,
        externalId: idx('externalId') >= 0 ? r[idx('externalId')] || undefined : undefined,
        price: Number(r[idx('price')]),
      })),
    };
    run(async () => {
      const r = await api('/operator/links/price-import', { body });
      setPreview(r);
      if (!r.dryRun) {
        setInfo(t('bulk.applied', { n: r.count }));
        load();
      }
    });
  };

  if (!rows) return <p className="text-slate-400">{t('common.loading')}</p>;
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('bulk.search')}</label>
          <input
            className="input"
            value={q.text}
            onChange={(e) => setQ({ ...q, text: e.target.value })}
          />
        </div>
        <div>
          <label className="label">{t('link.status')}</label>
          <select
            className="input"
            value={q.status}
            onChange={(e) => setQ({ ...q, status: e.target.value })}
          >
            <option value="">{t('mp.any')}</option>
            {['ACTIVE', 'DRAFT', 'MAINTENANCE', 'INACTIVE'].map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            className="btn-ghost !py-1 text-xs"
            onClick={() => run(() => download('/operator/links/export.csv', 'links.csv'))}
          >
            {t('bulk.exportCsv')}
          </button>
          <label className="btn-ghost cursor-pointer !py-1 text-xs">
            {t('bulk.previewCsv')}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => importCsv(e, true)}
            />
          </label>
          <label className="btn-primary cursor-pointer !py-1 text-xs">
            {t('bulk.importCsv')}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => importCsv(e, false)}
            />
          </label>
        </div>
        <p className="w-full text-xs text-slate-500">{t('bulk.csvHint')}</p>
      </div>

      {sel.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3 border-sky-500/40">
          <p className="text-sm text-white">{t('bulk.selected', { n: sel.length })}</p>
          <select
            className="input !w-auto"
            value={bulk.mode}
            onChange={(e) => setBulk({ ...bulk, mode: e.target.value })}
          >
            {['PERCENT', 'FIXED', 'SET'].map((m) => (
              <option key={m} value={m}>
                {t(`bulk.mode.${m}`)}
              </option>
            ))}
          </select>
          <input
            className="input !w-40"
            type="number"
            placeholder={bulk.mode === 'PERCENT' ? '-10' : '50000000'}
            value={bulk.value}
            onChange={(e) => setBulk({ ...bulk, value: e.target.value })}
          />
          <button className="btn-ghost" disabled={bulk.value === ''} onClick={() => bulkCall(true)}>
            {t('bulk.preview')}
          </button>
          <button
            className="btn-primary"
            disabled={bulk.value === ''}
            onClick={() => bulkCall(false)}
          >
            {t('bulk.apply')}
          </button>
        </div>
      )}

      <ErrorNote error={error} />
      {info && <p className="text-sm text-emerald-300">{info}</p>}
      {preview && (
        <div className="card space-y-2">
          <div className="flex justify-between">
            <p className="text-sm text-white">
              {preview.dryRun ? t('bulk.previewTitle') : t('bulk.applied', { n: preview.count })}
            </p>
            <button className="text-xs text-slate-400" onClick={() => setPreview(null)}>
              {t('common.close')}
            </button>
          </div>
          {preview.errors?.length > 0 && (
            <p className="text-sm text-red-300">
              {preview.errors.map((x: any) => `#${x.row}: ${t(`bulk.err.${x.reason}`)}`).join(', ')}
            </p>
          )}
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-800">
              {preview.changes.map((c: any) => (
                <tr key={c.linkId}>
                  <td className="py-1 text-slate-300">{c.route}</td>
                  <td className="py-1">{money(c.before, 'IDR', loc)}</td>
                  <td className="py-1">&rarr; {money(c.after, 'IDR', loc)}</td>
                  <td className="py-1 text-slate-500">{t(`bulk.method.${c.method}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card overflow-x-auto !p-0">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">
                <input
                  type="checkbox"
                  aria-label={t('bulk.selectAll')}
                  checked={allSel}
                  onChange={(e) => setSel(e.target.checked ? shown.map((l) => l.id) : [])}
                />
              </th>
              {[
                'link.name',
                'link.route',
                'link.capacity',
                'link.latency',
                'link.monthly',
                'op.source',
                'link.status',
              ].map((h) => (
                <th key={h} className="th">
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {shown.map((l) => (
              <tr key={l.id}>
                <td className="td">
                  <input
                    type="checkbox"
                    aria-label={`${l.originName} - ${l.destinationName}`}
                    checked={sel.includes(l.id)}
                    onChange={(e) =>
                      setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))
                    }
                  />
                </td>
                <td className="td">{tr(l.name)}</td>
                <td className="td">
                  {l.originName} &rarr; {l.destinationName}
                </td>
                <td className="td">
                  {capacity(l.availableMbps)} / {capacity(l.capacityMbps)}
                </td>
                <td className="td">{l.latencyMs ?? '-'} ms</td>
                <td className="td">
                  <input
                    className="input !w-36 !py-1 text-sm"
                    type="number"
                    min={0}
                    aria-label={t('link.monthly')}
                    value={edit[l.id] ?? l.effectivePrice ?? ''}
                    onChange={(e) => setEdit({ ...edit, [l.id]: e.target.value })}
                    onBlur={() => single(l)}
                    onKeyDown={(e) => e.key === 'Enter' && single(l)}
                  />
                  {l.hasOverride && (
                    <p className="text-[10px] text-slate-500">{t('bulk.method.OVERRIDE_RULE')}</p>
                  )}
                </td>
                <td className="td">{l.apiConfigId ? 'API' : t('op.manual')}</td>
                <td className="td space-y-1">
                  <Status value={l.status} />
                  {l.status === 'DRAFT' && (
                    <button
                      className="block text-xs text-sky-300"
                      onClick={() =>
                        run(async () => {
                          await api(`/operator/links/${l.id}`, {
                            method: 'PATCH',
                            body: { status: 'ACTIVE' },
                          });
                          load();
                        })
                      }
                    >
                      {t('bulk.activate')}
                    </button>
                  )}
                  <Status value={l.availability} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
