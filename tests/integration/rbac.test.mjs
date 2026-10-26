import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, requireApi } from '../helpers.mjs';

let A;
before(async () => {
  await requireApi();
  A = await actors();
});

const SELLER = [
  ['GET', '/seller/insights/latest'],
  ['GET', '/seller/insights'],
  ['POST', '/seller/insights/generate', {}],
  ['GET', '/operator/performance'],
  ['GET', '/operator/overview'],
  ['GET', '/operator/links'],
  ['GET', '/operator/api-configs'],
  ['GET', '/operator/pricing-rules'],
  ['GET', '/operator/addons'],
  ['POST', '/operator/addons', { kind: 'OTHER', name: { en: 'rbac' } }],
  ['PATCH', '/operator/addons/x', { isActive: false }],
  ['DELETE', '/operator/addons/x'],
];
const ADMIN = [
  ['GET', '/admin/overview'],
  ['GET', '/admin/operators'],
  ['GET', '/admin/users'],
  ['GET', '/admin/ledger'],
  ['GET', '/admin/ledger/verify'],
  ['GET', '/admin/sync-runs'],
  ['GET', '/admin/settings'],
  ['GET', '/admin/interactions'],
  ['POST', '/admin/quality/recompute', { linkIds: [] }],
  [
    'POST',
    '/mock-operator/incidents',
    { operator: 'nusalink', linkId: 'NL-JKT-BDG', kind: 'OUTAGE' },
  ],
  ['GET', '/mock-operator/incidents'],
];

const hit = (who, [m, p, b]) => call(m, p, { token: who ? A[who].token : undefined, body: b });
const label = ([m, p]) => `${m} ${p}`;

describe('RBAC: unauthenticated', () => {
  for (const ep of [
    ...SELLER,
    ...ADMIN,
    ['GET', '/tickets'],
    ['GET', '/explorer/graph'],
    ['GET', '/links'],
  ]) {
    test(`401 ${label(ep)}`, async () => assert.equal((await hit(null, ep)).status, 401));
  }
  test('401 for malformed / garbage bearer tokens', async () => {
    for (const token of ['garbage', 'Bearer', '', 'a.b.c']) {
      const r = await call('GET', '/links', { headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.status, 401, token);
    }
  });
});

describe('RBAC: buyer (PENYEWA)', () => {
  for (const ep of [...SELLER, ...ADMIN]) {
    test(`403 ${label(ep)}`, async () => assert.equal((await hit('buyer', ep)).status, 403));
  }
  test('buyer keeps access to marketplace, explorer, tickets and add-on catalog', async () => {
    for (const p of [
      '/links',
      '/explorer/graph',
      '/tickets',
      '/addons',
      '/reservations',
      '/cart',
    ]) {
      assert.equal((await call('GET', p, { token: A.buyer.token })).status, 200, p);
    }
  });
});

describe('RBAC: second buyer (no rentals)', () => {
  test('cannot reach seller or admin endpoints', async () => {
    for (const ep of [...SELLER, ...ADMIN])
      assert.equal((await hit('buyer2', ep)).status, 403, label(ep));
  });
});

describe('RBAC: operator (PENYELENGGARA)', () => {
  for (const ep of ADMIN) {
    test(`403 ${label(ep)}`, async () => assert.equal((await hit('op', ep)).status, 403));
  }
  test('operators cannot use the buyer-only payment completion or cart', async () => {
    assert.equal(
      (
        await call('POST', '/payments/mock/x/complete', {
          token: A.op.token,
          body: { outcome: 'success' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('POST', '/cart/items', {
          token: A.op.token,
          body: { linkId: 'x', termMonths: 12 },
        })
      ).status,
      403,
    );
  });
});

describe('RBAC: pending (unapproved) operator', () => {
  test('cannot create add-ons', async () => {
    const a = await call('POST', '/operator/addons', {
      token: A.pending.token,
      body: { kind: 'OTHER', name: { en: 'x' } },
    });
    assert.equal(a.status, 403);
  });
});

describe('RBAC: admin', () => {
  test('admin can read admin endpoints', async () => {
    for (const p of [
      '/admin/overview',
      '/admin/users',
      '/admin/ledger?pageSize=1',
      '/admin/settings',
      '/admin/sync-runs',
    ]) {
      assert.equal((await call('GET', p, { token: A.admin.token })).status, 200, p);
    }
  });
  test('admin without operatorId has no operator context for insights (403, not 5xx)', async () => {
    const r = await call('GET', '/seller/insights/latest', { token: A.admin.token });
    assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
  });
});

describe('Auth edge cases', () => {
  test('wrong password and unknown user are both 401 with the same message', async () => {
    const a = await call('POST', '/auth/login', {
      body: { email: 'buyer@demo.wnmp.test', password: 'wrong-wrong' },
    });
    const b = await call('POST', '/auth/login', {
      body: { email: 'nobody@demo.wnmp.test', password: 'wrong-wrong' },
    });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.json.message, b.json.message);
  });
  test('malformed login payload is 400, not 5xx', async () => {
    for (const body of [{}, { email: 'x' }, { email: 'a@b.co', password: 1 }]) {
      const r = await call('POST', '/auth/login', { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });
  test('role escalation through register is rejected', async () => {
    const r = await call('POST', '/auth/register', {
      body: {
        email: 'tester.escalate@wnmp.test',
        password: 'Tester@12345',
        fullName: 'Eve',
        companyName: 'Eve Co',
        role: 'ADMIN',
      },
    });
    assert.equal(r.status, 400);
  });
  test('JWT perms for the demo buyer include ticket:create (needed to report issues)', async () => {
    assert.ok(A.buyer.user.perms.includes('ticket:create'));
    assert.ok(!A.buyer.user.perms.includes('insight:read'));
  });
});
