import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, requireApi } from '../helpers.mjs';

// Route searches use the admin token: only PENYEWA searches are counted as demand,
// so these tests never skew hot/unmet-demand statistics of the demo data.
let A;
const routes = (q, who = 'admin') => call('GET', `/explorer/routes?${q}`, { token: A[who].token });

before(async () => {
  await requireApi();
  A = await actors();
});

describe('explorer graph', () => {
  test('requires authentication; returns nodes, edges, promos and basis', async () => {
    assert.equal((await call('GET', '/explorer/graph')).status, 401);
    const r = await call('GET', '/explorer/graph', { token: A.admin.token });
    assert.equal(r.status, 200);
    const keys = new Set(r.json.nodes.map((n) => n.key));
    assert.ok(r.json.nodes.length >= 7);
    for (const n of r.json.nodes) {
      assert.equal(typeof n.lat, 'number');
      assert.equal(typeof n.lng, 'number');
      assert.ok(n.availableCount <= n.linkCount);
    }
    for (const e of r.json.edges) {
      assert.ok(keys.has(e.a) && keys.has(e.b), `edge ${e.a}-${e.b} references an unknown node`);
      assert.ok(e.availableCount <= e.linkCount);
    }
    assert.ok(Array.isArray(r.json.promos));
    assert.equal(typeof r.json.basis.includesDemo, 'boolean');
    assert.ok(r.json.basis.generatedAt);
  });

  test('minMbps filter and junk values do not cause a 5xx', async () => {
    for (const q of ['minMbps=999999999', 'minMbps=abc', 'minMbps=-5']) {
      const r = await call('GET', `/explorer/graph?${q}`, { token: A.admin.token });
      assert.ok(r.status < 500, `${q} -> ${r.status}`);
    }
  });
});

describe('explorer routes', () => {
  test('same node (case / whitespace variants) is 400 SAME_NODE', async () => {
    for (const [f, t] of [
      ['Jakarta', 'jakarta'],
      ['Jakarta%20', 'JAKARTA'],
      ['%20jakarta', 'Jakarta'],
    ]) {
      const r = await routes(`from=${f}&to=${t}`);
      assert.equal(r.status, 400, `${f}/${t}`);
      assert.equal(r.json.code, 'SAME_NODE');
    }
  });

  test('unknown node is 404 NODE_NOT_FOUND (either end)', async () => {
    for (const q of ['from=Atlantis&to=Jakarta', 'from=Jakarta&to=Atlantis']) {
      const r = await routes(q);
      assert.equal(r.status, 404, q);
      assert.equal(r.json.code, 'NODE_NOT_FOUND');
    }
  });

  test('missing from/to is 400; unauthenticated is 401', async () => {
    assert.equal((await routes('from=Jakarta')).status, 400);
    assert.equal((await routes('')).status, 400);
    assert.equal((await call('GET', '/explorer/routes?from=Jakarta&to=Surabaya')).status, 401);
  });

  test('direct route Jakarta -> Surabaya is present (and symmetric), aggregated by operator', async () => {
    for (const q of ['from=Jakarta&to=Surabaya', 'from=surabaya&to=jakarta']) {
      const r = await routes(q);
      assert.equal(r.status, 200);
      assert.equal(r.json.unmet, false);
      const direct = r.json.routes.filter((x) => x.hops === 1);
      assert.equal(direct.length, 1, `${q}: exactly one aggregated direct route`);
      assert.equal(direct[0].indicative, false);
      const cands = direct[0].legs[0].candidates;
      assert.ok(cands.length >= 2 && cands.length <= 5, 'parallel candidates are capped at 5');
      assert.ok(direct[0].priceRange.min <= direct[0].priceRange.max);
      assert.ok(direct[0].operators.length >= 2);
    }
  });

  test('routes are sorted by hops then price by default; every route has hops <= maxHops', async () => {
    const r = await routes('from=Jakarta&to=Makassar');
    assert.ok(r.json.routes.length >= 1);
    for (let i = 1; i < r.json.routes.length; i++) {
      const a = r.json.routes[i - 1];
      const b = r.json.routes[i];
      assert.ok(a.hops < b.hops || (a.hops === b.hops && a.priceRange.min <= b.priceRange.min));
    }
    assert.ok(r.json.routes.every((x) => x.hops > 1 && x.indicative && x.hot === false));
  });

  test('maxHops limits the search and is capped by the server setting', async () => {
    const one = await routes('from=Jakarta&to=Makassar&maxHops=1');
    assert.equal(one.status, 200);
    assert.equal(one.json.routes.length, 0);
    assert.equal(one.json.basis.maxHops, 1);
    const two = await routes('from=Jakarta&to=Makassar&maxHops=2');
    assert.ok(two.json.routes.length >= 1);
    assert.ok(two.json.routes.every((x) => x.hops <= 2));
    const huge = await routes('from=Jakarta&to=Makassar&maxHops=99');
    assert.ok(
      huge.json.basis.maxHops <= 3,
      `maxHops must be capped (got ${huge.json.basis.maxHops})`,
    );
    assert.ok(huge.json.routes.every((x) => x.hops <= huge.json.basis.maxHops));
    for (const v of ['0', 'abc']) {
      const r = await routes(`from=Jakarta&to=Makassar&maxHops=${v}`);
      assert.equal(r.status, 400, `maxHops=${v} must be rejected`);
    }
  });

  test('a negative maxHops is rejected or ignored, never an empty "unmet" result', async () => {
    const r = await routes('from=Jakarta&to=Makassar&maxHops=-1');
    assert.ok(
      r.status === 400 || (r.status === 200 && r.json.routes.length >= 1),
      `status ${r.status}, routes ${r.json.routes?.length}, basis.maxHops ${r.json.basis?.maxHops}`,
    );
  });

  test('a hop limit that excludes every route does not report unmet capacity', async () => {
    // The nodes are connected (2 hops); "unmet" should mean no capacity exists, not "your hop limit hid it".
    const r = await routes('from=Jakarta&to=Makassar&maxHops=1');
    assert.equal(r.json.unmet, false, 'unmet=true here would be logged as false unmet-demand');
  });

  test('unmet demand state for a connected-less pair (Medan -> Denpasar)', async () => {
    const r = await routes('from=Medan&to=Denpasar');
    assert.equal(r.status, 200);
    assert.equal(r.json.unmet, true);
    assert.deepEqual(r.json.routes, []);
  });

  test('minMbps filter, sort and junk parameters never 5xx', async () => {
    const huge = await routes('from=Jakarta&to=Surabaya&minMbps=999999999');
    assert.equal(huge.status, 200);
    assert.equal(huge.json.unmet, true);
    for (const q of ['minMbps=abc', 'minMbps=-1']) {
      const bad = await routes(`from=Jakarta&to=Surabaya&${q}`);
      assert.equal(bad.status, 400, `${q} must be rejected`);
    }
    for (const q of ['sort=bogus', 'sort=price', 'sort=latency', 'sort=score', 'sort=hot']) {
      const r = await routes(`from=Jakarta&to=Surabaya&${q}`);
      assert.equal(r.status, 200, q);
      assert.ok(r.json.routes.length >= 1, q);
    }
  });

  test('repeated query parameters (from=a&from=b) are rejected, not a 5xx', async () => {
    const r = await routes('from=Jakarta&from=Surabaya&to=Medan');
    assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
  });

  test('every route carries chips and basis fields the UI relies on', async () => {
    const r = await routes('from=Jakarta&to=Surabaya');
    assert.equal(typeof r.json.basis.includesDemo, 'boolean');
    assert.equal(typeof r.json.basis.truncated, 'boolean');
    const route = r.json.routes[0];
    for (const k of ['addOns', 'redundancy', 'slaPercent', 'performance', 'kmz'])
      assert.ok(k in route.chips, k);
    for (const c of route.legs[0].candidates) {
      assert.equal(typeof c.performance.rated, 'boolean');
      if (!c.performance.rated) assert.equal(c.performance.score, null);
    }
  });
});
