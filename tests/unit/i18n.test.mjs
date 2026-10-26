import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'apps', 'web');
const read = (p) => fs.readFileSync(p, 'utf8');

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// dictionary.ts is a single object literal; evaluating it avoids a TypeScript toolchain.
function loadDictionary() {
  const src = read(path.join(WEB, 'lib', 'dictionary.ts'));
  const start = src.indexOf('= {', src.indexOf('export const dictionary')) + 2;
  const end = src.lastIndexOf('};');
  assert.ok(start > 1 && end > start, 'cannot locate the dictionary object literal');
  return vm.runInNewContext(`(${src.slice(start, end + 1)})`);
}

const dict = loadDictionary();
const sources = [
  ...walk(path.join(WEB, 'app'), ['.ts', '.tsx']),
  ...walk(path.join(WEB, 'components'), ['.ts', '.tsx']),
  ...walk(path.join(WEB, 'lib'), ['.ts', '.tsx']).filter((f) => !f.endsWith('dictionary.ts')),
];
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');

// Statically known values for t(`prefix.${x}`) call sites. A pattern found in the source that is
// not listed here fails the "no unknown dynamic key" test, so new dynamic keys must be enumerated.
const enumFromSchema = (...names) => {
  const schema = read(path.join(ROOT, 'apps', 'api', 'prisma', 'schema.prisma'));
  return names.flatMap((n) => {
    const m = schema.match(new RegExp(`enum ${n} \\{([^}]*)\\}`));
    assert.ok(m, `enum ${n} not found in schema.prisma`);
    return m[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[A-Z_0-9]+$/.test(l));
  });
};
const ADDON_KINDS = enumFromSchema('AddOnKind');
const UNREACHABLE_STATUS = new Set([
  'PENDING_VERIFICATION',
  'AUTHORIZED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
const ENUMS = {
  'admin.tab.${}': [
    'overview',
    'operators',
    'users',
    'ledger',
    'sync',
    'tickets',
    'settings',
    'locations',
    'export',
  ],
  'admin.locations.${}': ['name', 'province', 'lat', 'lng'],
  'notif.cat.${}': enumFromSchema('NotificationCategory'),
  'notif.cat.${}.hint': enumFromSchema('NotificationCategory'),
  'notif.channel.${}': ['IN_APP', 'EMAIL'],
  'alert.${}': ['BUDGET_EXCEEDED', 'BUDGET_NEAR', 'LOW_BALANCE', 'RENTAL_EXPIRING'],
  'alert.${}.detail': ['BUDGET_EXCEEDED', 'BUDGET_NEAR', 'LOW_BALANCE', 'RENTAL_EXPIRING'],
  'wallet.${}': enumFromSchema('WalletEntryType'),
  'prov.check.${}': [
    'approved',
    'profile',
    'link',
    'integration',
    'kmz',
    'pricing',
    'addon',
    'prebuild',
  ],
  'bulk.mode.${}': ['PERCENT', 'FIXED', 'SET'],
  'bulk.method.${}': ['BASE_PRICE', 'OVERRIDE_RULE'],
  'bulk.err.${}': ['LINK_NOT_FOUND', 'INVALID_PRICE'],
  'explore.sort.${}': ['default', 'price', 'latency', 'score', 'hot'],
  'chip.addon.${}': ADDON_KINDS,
  'mp.${}': ['origin', 'destination'],
  'mp.sort.${}': ['price_asc', 'price_desc', 'latency_asc', 'capacity_desc', 'newest'],
  'op.tab.${}': [
    'insights',
    'links',
    'performance',
    'tickets',
    'integrations',
    'geo',
    'pricing',
    'prebuild',
    'addons',
  ],
  'op.json.${}': ['credentials', 'endpoints', 'fieldMapping'],
  'home.stat.${}': ['links', 'available', 'operators', 'routes'],
  'home.feature.${}.title': ['api', 'map', 'ai', 'pay'],
  'home.feature.${}.body': ['api', 'map', 'ai', 'pay'],
  'role.${}': ['PENYEWA', 'PENYELENGGARA'],
  'role.${}.desc': ['PENYEWA', 'PENYELENGGARA'],
  // Every enum that is rendered through <Status value=...> (admin, operator, reservations, tickets pages).
  // Values that no code path ever assigns are excluded (nothing sets them; re-add when a feature does).
  'status.${}': [
    ...enumFromSchema(
      'AvailabilityState',
      'ApprovalStatus',
      'AccountStatus',
      'LedgerStatus',
      'SyncRunStatus',
      'IntegrationStatus',
      'ParseStatus',
      'ReservationStatus',
      'LockStatus',
      'PaymentStatus',
      'TicketStatus',
      'LinkRequestStatus',
      'PrebuildStatus',
      'CommitmentStatus',
      'LinkStatus',
    ).filter((v) => !UNREACHABLE_STATUS.has(v)),
    'ACTIVE',
    'INACTIVE',
    'HIGH',
    'WARN',
  ],
  'ticket.kind.${}': enumFromSchema('TicketKind'),
  'ticket.source.${}': enumFromSchema('TicketSource'),
  'ticket.severity.${}': enumFromSchema('TicketSeverity'),
  'insight.severity.${}': ['high', 'warn', 'info'],
  'insight.${}': ['topSearched', 'bestSelling', 'rising', 'congestionRisk', 'unmetDemand'],
  'perf.reason.${}': ['MIN_SAMPLES', 'MIN_COVERAGE', 'NO_TELEMETRY', 'PREVIEW'],
  'perf.component.${}': ['latency', 'availability', 'tickets', 'headroom'],
};

function scan() {
  const statics = new Map(); // key -> [files]
  const dynamics = new Map(); // pattern -> [files]
  const add = (m, k, f) => m.set(k, [...(m.get(k) ?? []), rel(f)]);
  for (const f of sources) {
    const src = read(f);
    for (const m of src.matchAll(/\bt\(\s*(['"])([^'"\n]+?)\1/g)) add(statics, m[2], f);
    for (const m of src.matchAll(/\bt\(\s*`([^`]*)`/g)) {
      const pattern = m[1].replace(/\$\{[^}]*\}/g, '${}');
      if (pattern.includes('${}')) add(dynamics, pattern, f);
      else add(statics, pattern, f);
    }
  }
  return { statics, dynamics };
}
const { statics, dynamics } = scan();

describe('dictionary integrity', () => {
  test('dictionary has a meaningful size and parses', () => {
    assert.ok(Object.keys(dict).length > 400, `only ${Object.keys(dict).length} keys parsed`);
  });

  test('every entry has a non-empty string for both id and en', () => {
    const bad = Object.entries(dict).filter(
      ([, v]) =>
        typeof v?.id !== 'string' || typeof v?.en !== 'string' || !v.id.trim() || !v.en.trim(),
    );
    assert.deepEqual(
      bad.map(([k]) => k),
      [],
    );
  });

  test('id and en carry the same {placeholders}', () => {
    const ph = (s) =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(',');
    const bad = Object.entries(dict).filter(([, v]) => ph(v.id) !== ph(v.en));
    assert.deepEqual(
      bad.map(([k, v]) => `${k}: id{${ph(v.id)}} en{${ph(v.en)}}`),
      [],
    );
  });

  test('no leftover markers (TODO, undefined, [object Object]) in translations', () => {
    const bad = Object.entries(dict).filter(([, v]) =>
      /TODO|FIXME|undefined|\[object/i.test(v.id + v.en),
    );
    assert.deepEqual(
      bad.map(([k]) => k),
      [],
    );
  });

  test('keys are unique (a duplicate key in the literal silently overrides the first)', () => {
    const src = read(path.join(WEB, 'lib', 'dictionary.ts'));
    const keys = [...src.matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual([...new Set(dup)], []);
  });
});

describe('static t(...) keys exist in both languages', () => {
  test('scan finds a realistic number of call sites', () => {
    assert.ok(statics.size > 200, `only ${statics.size} static keys found; scanner broken?`);
    assert.ok(dynamics.size >= 20, `only ${dynamics.size} dynamic patterns found`);
  });

  test('every static key is defined (id and en)', () => {
    const missing = [...statics]
      .filter(([k]) => !dict[k])
      .map(([k, f]) => `${k}  (${[...new Set(f)].join(', ')})`);
    assert.deepEqual(missing, []);
  });
});

describe('dynamic t(`prefix.${x}`) keys', () => {
  test('every dynamic pattern in the source has a known enumeration', () => {
    const unknown = [...dynamics]
      .filter(([p]) => p !== 'err.${}' && !(p in ENUMS))
      .map(([p, f]) => `${p} (${[...new Set(f)].join(', ')})`);
    assert.deepEqual(unknown, [], 'add the new pattern and its values to ENUMS in this test');
  });

  for (const [pattern, values] of Object.entries(ENUMS)) {
    test(`${pattern} -> ${values.length} values all translated`, () => {
      assert.ok(
        dynamics.has(pattern),
        `pattern ${pattern} no longer used in source; remove it from ENUMS`,
      );
      const missing = values.map((v) => pattern.replace('${}', v)).filter((k) => !dict[k]);
      assert.deepEqual(missing, []);
    });
  }

  test('API error codes surfaced through errMessage() (err.${code}) are translated', () => {
    const codes = new Set();
    const apiSrc = walk(path.join(ROOT, 'apps', 'api', 'src'), ['.ts']);
    for (const f of apiSrc) {
      const src = read(f);
      for (const m of src.matchAll(/\bcode:\s*'([A-Z][A-Z_0-9]+)'/g)) codes.add(m[1]);
      for (const m of src.matchAll(/\berr\(\s*\d{3}\s*,\s*'([A-Z][A-Z_0-9]+)'/g)) codes.add(m[1]);
    }
    assert.ok(codes.size >= 10, `only ${codes.size} server error codes found; scanner broken?`);
    const missing = [...codes].filter((c) => !dict[`err.${c}`]).sort();
    assert.deepEqual(
      missing,
      [],
      'server codes without err.<CODE> translation: the UI falls back to English server text',
    );
  });
});

describe('keys passed indirectly (string literals later given to t())', () => {
  test('literal keys in arrays/props that look like dictionary keys exist', () => {
    const prefixes = new Set(Object.keys(dict).map((k) => k.split('.')[0]));
    const candidates = new Map();
    for (const f of sources) {
      for (const m of read(f).matchAll(/(['"])([a-z][a-zA-Z0-9]*(?:\.[A-Za-z0-9_]+)+)\1/g)) {
        const key = m[2];
        if (!prefixes.has(key.split('.')[0])) continue;
        candidates.set(key, [...(candidates.get(key) ?? []), rel(f)]);
      }
    }
    const missing = [...candidates]
      .filter(([k]) => !dict[k])
      .map(([k, f]) => `${k} (${[...new Set(f)].join(', ')})`);
    assert.deepEqual(missing, []);
  });
});

describe('i18n completeness reporting', () => {
  test('dictionary keys never referenced by the scanner (informational, never fails)', (t) => {
    const used = new Set(statics.keys());
    for (const [p, vals] of Object.entries(ENUMS))
      for (const v of vals) used.add(p.replace('${}', v));
    const unused = Object.keys(dict).filter((k) => !used.has(k) && !k.startsWith('err.'));
    t.diagnostic(`${unused.length} of ${Object.keys(dict).length} keys not referenced statically`);
  });
});
