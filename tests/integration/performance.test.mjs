import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, linkByExternalId, requireApi } from '../helpers.mjs';

let A;
let nl; // NusaLink link, owned by operator "op"
let gf; // Garuda link, owned by operator "op2"

before(async () => {
  await requireApi();
  A = await actors();
  nl = await linkByExternalId(A.buyer.token, 'NL-JKT-SBY-N');
  gf = await linkByExternalId(A.buyer.token, 'GF-1001');
});

const perf = (who, id) => call('GET', `/links/${id}/performance`, { token: A[who].token });

describe('GET /links/:id/performance', () => {
  test('requires authentication; unknown link is 404', async () => {
    assert.equal((await call('GET', `/links/${nl.id}/performance`)).status, 401);
    assert.equal((await perf('buyer', 'no-such-link')).status, 404);
  });

  test('buyer and owner get score, components, basis and KPIs', async () => {
    for (const who of ['buyer', 'op', 'admin']) {
      const r = await perf(who, nl.id);
      assert.equal(r.status, 200, who);
      assert.equal(r.json.rated, true, `${who} ${JSON.stringify(r.json).slice(0, 200)}`);
      assert.ok(r.json.score >= 0 && r.json.score <= 100);
      assert.ok(r.json.components && r.json.basis && r.json.kpis, `${who} sees full detail`);
      assert.ok(r.json.basis.samples >= 50);
    }
  });

  test('a competing operator gets only { rated, score } - no KPIs, components or sample counts', async () => {
    const r = await perf('op2', nl.id);
    assert.equal(r.status, 200);
    assert.equal(r.json.rated, true);
    assert.equal(typeof r.json.score, 'number');
    for (const k of ['kpis', 'components', 'outageList'])
      assert.ok(!(k in r.json), `${k} leaked to a rival`);
    assert.ok(!('samples' in (r.json.basis ?? {})), 'basis.samples leaked to a rival');
    assert.ok(!('coverageDays' in (r.json.basis ?? {})), 'basis.coverageDays leaked to a rival');
    const mirror = await perf('op', gf.id);
    assert.equal(mirror.status, 200);
    assert.ok(!('kpis' in mirror.json), 'NusaLink operator must not see Garuda KPIs');
  });

  test('the owner sees its own detail, including the outage list', async () => {
    const r = await perf('op', nl.id);
    assert.ok(Array.isArray(r.json.outageList));
    const own = await perf('op2', gf.id);
    assert.ok('kpis' in own.json || own.json.rated === false);
  });

  test('a link without telemetry is "not rated", never a default score', async () => {
    const bdg = await linkByExternalId(A.buyer.token, 'NL-JKT-BDG');
    const r = await perf('buyer', bdg.id);
    assert.equal(r.json.rated, false);
    assert.ok(!('score' in r.json) || r.json.score === null);
    assert.ok(r.json.reason);
  });
});

describe('GET /links/performance?ids=', () => {
  const batch = (who, qs) => call('GET', `/links/performance${qs}`, { token: A[who].token });

  test('unknown ids return rated:false with score null (no 500, no partial write)', async () => {
    const r = await batch('buyer', '?ids=bogus');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.bogus, { rated: false, score: null, reason: 'NO_TELEMETRY' });
  });

  test('mixed real + bogus ids; real id matches the single-link endpoint', async () => {
    const r = await batch('buyer', `?ids=${nl.id},bogus,,`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), [nl.id, 'bogus'].sort());
    assert.equal(r.json.bogus.rated, false);
    const single = (await perf('buyer', nl.id)).json;
    assert.equal(r.json[nl.id].rated, single.rated);
    assert.equal(r.json[nl.id].score, single.score);
  });

  test('empty list, unauthenticated, and oversized list', async () => {
    const empty = await batch('buyer', '');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json, {});
    assert.equal((await call('GET', '/links/performance?ids=x')).status, 401);
    const many = Array.from({ length: 700 }, (_, i) => `bogus${i}`).join(',');
    const big = await batch('buyer', `?ids=${many}`);
    assert.ok(big.status < 500, `got ${big.status}`);
    assert.ok(Object.keys(big.json).length <= 500, 'result is capped');
  });

  test('repeated ids parameter does not 5xx', async () => {
    const r = await batch('buyer', `?ids=${nl.id}&ids=bogus`);
    assert.ok(r.status < 500, `?ids=a&ids=b -> ${r.status}`);
  });

  test('a rival operator receives scores only (same shape as buyers)', async () => {
    const r = await batch('op2', `?ids=${nl.id}`);
    assert.equal(r.status, 200);
    assert.ok(Object.keys(r.json[nl.id]).every((k) => ['rated', 'score', 'reason'].includes(k)));
    assert.ok(!('kpis' in r.json[nl.id]));
  });
});

describe('operator performance table', () => {
  test('lists only the operator own links; buyers are forbidden', async () => {
    const mine = (await call('GET', '/operator/links?pageSize=100', { token: A.op.token })).json;
    const ownIds = new Set((mine.items ?? mine).map((l) => l.id));
    const r = await call('GET', '/operator/performance', { token: A.op.token });
    assert.equal(r.status, 200);
    assert.ok(r.json.items.length >= 5);
    assert.ok(
      r.json.items.every((x) => ownIds.has(x.linkId)),
      'foreign link in own performance table',
    );
    const other = await call('GET', '/operator/performance', { token: A.op2.token });
    assert.ok(other.json.items.every((x) => !ownIds.has(x.linkId)));
    assert.equal(
      (await call('GET', '/operator/performance', { token: A.buyer.token })).status,
      403,
    );
  });
});
