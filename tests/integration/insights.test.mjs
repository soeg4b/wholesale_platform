import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, requireApi } from '../helpers.mjs';

const CODES = new Set([
  'TOP_SEARCHED',
  'BEST_SELLING',
  'RISING',
  'CONGESTION',
  'UNMET_DEMAND',
  'ADDON_OPPORTUNITY',
  'LOW_UPTIME',
  'LATENCY_UNSTABLE',
  'SLA_BREACHES',
  'LOW_SCORE',
  'PRICE_OUTLIER',
  'STALE_SYNC',
  'NO_KMZ',
  'NO_TELEMETRY',
]);
const SEVERITIES = new Set(['info', 'warn', 'high']);
const BUYER_IDENTITY = ['buyer@demo', 'Andi Penyewa', 'PT Cloud Nusantara', 'demo.buyer'];

let A;
let report; // latest report of operator "op"
let ownLinkIds;

before(async () => {
  await requireApi();
  A = await actors();
  let gen = await call('POST', '/seller/insights/generate', { token: A.op.token, body: {} });
  if (gen.status === 429) gen = await call('GET', '/seller/insights/latest', { token: A.op.token });
  assert.ok(
    gen.status === 200 || gen.status === 201,
    `could not obtain a report: ${gen.status} ${JSON.stringify(gen.json)}`,
  );
  report = gen.json;
  const links = (await call('GET', '/operator/links?pageSize=100', { token: A.op.token })).json;
  ownLinkIds = new Set((links.items ?? links).map((l) => l.id));
});

const sectionList = () => {
  const s = report.facts.sections;
  return [
    ...Object.entries(s.demand).map(([k, v]) => [`demand.${k}`, v]),
    ['addOns', s.addOns],
    ['improvements', s.improvements],
  ];
};

describe('seller insights: access and cooldown', () => {
  test('buyers and unauthenticated users cannot read or generate', async () => {
    for (const [m, p] of [
      ['GET', '/seller/insights/latest'],
      ['GET', '/seller/insights'],
      ['POST', '/seller/insights/generate'],
    ]) {
      assert.equal(
        (await call(m, p, { token: A.buyer.token, body: {} })).status,
        403,
        `buyer ${m} ${p}`,
      );
      assert.equal((await call(m, p, { body: {} })).status, 401, `anon ${m} ${p}`);
    }
  });

  test('a second generate inside the cooldown is 429 COOLDOWN and references the existing report', async () => {
    const r = await call('POST', '/seller/insights/generate', { token: A.op.token, body: {} });
    assert.equal(r.status, 429);
    assert.equal(r.json.code, 'COOLDOWN');
    assert.ok(r.json.reportId);
  });

  test('?operatorId= by a non-admin cannot read another operator report', async () => {
    const rivalId = A.op2.user.operator.id;
    const r = await call('GET', `/seller/insights/latest?operatorId=${rivalId}`, {
      token: A.op.token,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.operatorProfileId, A.op.user.operator.id);
    const body = await call('POST', '/seller/insights/generate', {
      token: A.op.token,
      body: { operatorId: rivalId },
    });
    assert.ok(body.status === 429 || body.json.operatorProfileId === A.op.user.operator.id);
  });

  test('admin can read a specific operator report with ?operatorId=', async () => {
    const r = await call('GET', `/seller/insights/latest?operatorId=${A.op.user.operator.id}`, {
      token: A.admin.token,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.operatorProfileId, A.op.user.operator.id);
  });

  test('history lists at most 20 own reports without facts', async () => {
    const r = await call('GET', '/seller/insights', { token: A.op.token });
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 1 && r.json.length <= 20);
    assert.ok(r.json.every((x) => x.id && x.engine && !('facts' in x)));
  });
});

describe('seller insights: report shape (evidence / insufficient)', () => {
  test('engine is labelled; narrative is bilingual', () => {
    assert.ok(report.engine === 'rule-based' || report.engine.startsWith('llm:'));
    assert.ok(report.narrative.summary.id && report.narrative.summary.en);
    assert.ok(report.narrative.actions.length <= 5);
    for (const a of report.narrative.actions) assert.ok(a.id && a.en);
    assert.equal(typeof report.includesDemo, 'boolean');
    assert.ok(report.windowStart < report.windowEnd);
  });

  test('every section is either { insufficient, needed, have } or { items }, never both', () => {
    for (const [name, s] of sectionList()) {
      if (s.insufficient) {
        assert.equal(s.insufficient, true, name);
        assert.ok(Number.isInteger(s.needed) && Number.isInteger(s.have), `${name} needed/have`);
        assert.ok(s.have < s.needed, `${name}: insufficient requires have < needed`);
        assert.ok(!('items' in s), `${name}: insufficient section must not carry items`);
      } else {
        assert.ok(Array.isArray(s.items), `${name} items`);
      }
    }
  });

  test('every item has code, severity, params, evidence and bilingual text without placeholders', () => {
    let n = 0;
    for (const [name, s] of sectionList()) {
      for (const it of s.items ?? []) {
        n++;
        const where = `${name}/${it.code}`;
        assert.ok(CODES.has(it.code), `${where}: unknown code`);
        assert.ok(SEVERITIES.has(it.severity), `${where}: severity ${it.severity}`);
        assert.equal(typeof it.params, 'object', where);
        assert.equal(typeof it.evidence, 'object', where);
        for (const lang of ['id', 'en']) {
          assert.equal(typeof it.text?.[lang], 'string', `${where}: text.${lang}`);
          assert.ok(it.text[lang].trim().length > 10, `${where}: text.${lang} empty`);
          assert.ok(
            !/undefined|NaN|\[object|null/.test(it.text[lang]),
            `${where}: text.${lang} has a placeholder: ${it.text[lang]}`,
          );
        }
        assert.notEqual(it.text.id, it.text.en, `${where}: id and en text are identical`);
        if (it.linkId) assert.ok(it.linkName, `${where}: linkId without linkName`);
      }
    }
    assert.ok(n > 0, 'the demo operator should have at least one insight');
  });

  test('every item cites non-empty evidence', () => {
    const empty = [];
    for (const [name, s] of sectionList()) {
      for (const it of s.items ?? [])
        if (!Object.keys(it.evidence).length) empty.push(`${name}/${it.code}`);
    }
    assert.deepEqual(
      empty,
      [],
      'items without evidence break the "every payload carries evidence" rule',
    );
  });

  test('add-on advice, congestion and demand items cite numeric evidence', () => {
    const s = report.facts.sections;
    for (const it of s.addOns.items ?? [])
      assert.ok(Number.isInteger(it.evidence.renterCount) && it.evidence.rentedLinks >= 3);
    for (const it of s.demand.congestionRisk.items ?? [])
      assert.equal(typeof it.evidence.utilPct, 'number');
    for (const k of ['topSearched', 'rising', 'bestSelling']) {
      for (const it of s.demand[k].items ?? []) assert.ok(it.evidence.n >= 1, k);
    }
  });

  test('tenant isolation: items only reference the operator own links; no buyer identity appears', () => {
    for (const [name, s] of sectionList()) {
      for (const it of s.items ?? []) {
        if (it.linkId)
          assert.ok(
            ownLinkIds.has(it.linkId),
            `${name}/${it.code} references foreign link ${it.linkId}`,
          );
      }
    }
    const text = JSON.stringify(report);
    for (const s of BUYER_IDENTITY)
      assert.ok(!text.includes(s), `buyer identity "${s}" leaked into the seller report`);
    assert.ok(!text.includes('Garuda'), 'rival operator name leaked into NusaLink report');
  });

  test('the rival operator report is likewise bilingual and self-contained', async () => {
    const r = await call('GET', '/seller/insights/latest', { token: A.op2.token });
    assert.equal(r.status, 200);
    if (!r.json) return; // no report generated yet for this operator
    const own = new Set(
      (
        (await call('GET', '/operator/links?pageSize=100', { token: A.op2.token })).json.items ?? []
      ).map((l) => l.id),
    );
    const s = r.json.facts.sections;
    for (const sec of [...Object.values(s.demand), s.addOns, s.improvements]) {
      for (const it of sec.items ?? []) {
        assert.ok(it.text.id && it.text.en);
        if (it.linkId) assert.ok(own.has(it.linkId));
      }
    }
  });
});
