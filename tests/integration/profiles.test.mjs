import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, login, actors, requireApi } from '../helpers.mjs';

// Iteration 3: buyer/provider profiles, wallet, notifications, link requests, pre-build, reviews,
// bulk pricing, filters, reference data and export. Uses the scenario accounts from seed-scenarios.ts.
let A;
let S;
const get = (path, who) => call('GET', path, { token: (S[who] ?? A[who]).token });

before(async () => {
  await requireApi();
  A = await actors();
  const [low, over, fresh, early, borneo] = await Promise.all([
    login('buyer.lowbalance@demo.wnmp.test'),
    login('buyer.overbudget@demo.wnmp.test'),
    login('buyer.new@demo.wnmp.test'),
    login('buyer.earlybird@demo.wnmp.test'),
    login('operator@borneo.wnmp.test'),
  ]);
  S = { low, over, fresh, early, borneo };
});

describe('scenario accounts', () => {
  test('suspended buyer cannot log in; rejected/suspended operators cannot manage', async () => {
    const r = await call('POST', '/auth/login', {
      body: { email: 'buyer.suspended@demo.wnmp.test', password: 'Demo@12345' },
    });
    assert.ok(r.status >= 400 && r.status < 500, String(r.status));
    const rej = await login('rejected@operator.wnmp.test');
    const p = await call('POST', '/operator/prebuild', { token: rej.token, body: {} });
    assert.equal(p.status, 403);
  });
});

describe('buyer profile', () => {
  test('overview reports balance, monthly charge, projection, rentals and map', async () => {
    const r = await get('/profile/buyer', 'buyer');
    assert.equal(r.status, 200);
    const b = r.json;
    assert.equal(typeof b.wallet.balance, 'number');
    assert.ok(b.billing.monthlyCharge > 0);
    assert.ok(b.billing.projection.length >= 1);
    assert.ok(b.rentals.length >= 1);
    for (const x of b.rentals) {
      assert.ok(x.link.originName && x.link.destinationName);
      assert.ok('performance' in x);
    }
    assert.equal(b.map.type, 'FeatureCollection');
    assert.ok(b.map.features.length >= 1);
  });

  test('alerts per scenario: low balance, over budget, expiring rental', async () => {
    const codes = async (who) =>
      (await get('/profile/buyer', who)).json.billing.alerts.map((a) => a.code);
    assert.ok((await codes('low')).includes('LOW_BALANCE'));
    assert.ok((await codes('over')).includes('BUDGET_EXCEEDED'));
    assert.ok((await codes('early')).includes('RENTAL_EXPIRING'));
    const n = await get('/notifications', 'over');
    assert.ok(n.json.items.some((x) => x.category === 'BILLING_ALERT'));
  });

  test('profile update validates; budget/threshold persist', async () => {
    assert.equal(
      (
        await call('PATCH', '/profile/buyer', {
          token: S.fresh.token,
          body: { alertThresholdPct: 500 },
        })
      ).status,
      400,
    );
    const r = await call('PATCH', '/profile/buyer', {
      token: S.fresh.token,
      body: { monthlyBudget: 75000000, alertThresholdPct: 70 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.billing.budget, 75000000);
    assert.equal(r.json.billing.thresholdPct, 70);
  });

  test('top-up adds to balance; invalid amounts rejected; operators forbidden', async () => {
    const before = (await get('/profile/buyer', 'fresh')).json.wallet.balance;
    const r = await call('POST', '/profile/wallet/topup', {
      token: S.fresh.token,
      body: { amount: 1000 },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.balance, before + 1000);
    assert.equal(
      (await call('POST', '/profile/wallet/topup', { token: S.fresh.token, body: { amount: -5 } }))
        .status,
      400,
    );
    assert.equal((await get('/profile/buyer', 'op')).status, 403);
  });
});

describe('notification preferences', () => {
  test('defaults for every category; save validates channels', async () => {
    const r = await get('/notifications/preferences', 'buyer');
    assert.equal(r.status, 200);
    assert.ok(
      ['PROMO', 'DISCOUNT', 'EARLY_BIRD'].every((c) => r.json.some((p) => p.category === c)),
    );
    const bad = await call('PUT', '/notifications/preferences', {
      token: S.fresh.token,
      body: { items: [{ category: 'PROMO', enabled: true, channels: ['SMS'] }] },
    });
    assert.equal(bad.status, 400);
    const ok = await call('PUT', '/notifications/preferences', {
      token: S.fresh.token,
      body: {
        items: [
          {
            category: 'PROMO',
            enabled: true,
            channels: ['IN_APP'],
            filters: { cities: ['Jakarta'], minDiscountPct: 5 },
          },
        ],
      },
    });
    assert.equal(ok.status, 200);
    const promo = ok.json.find((p) => p.category === 'PROMO');
    assert.deepEqual(promo.filters.cities, ['Jakarta']);
  });

  test('read / read-all only touch own notifications', async () => {
    const list = (await get('/notifications', 'buyer')).json;
    if (list.items.length) {
      const id = list.items[0].id;
      assert.equal(
        (await call('POST', `/notifications/${id}/read`, { token: S.fresh.token })).status,
        404,
      );
      assert.equal(
        (await call('POST', `/notifications/${id}/read`, { token: A.buyer.token })).status,
        201,
      );
    }
    assert.equal(
      (await call('POST', '/notifications/read-all', { token: A.buyer.token })).status,
      201,
    );
  });
});

describe('link requests (customer wish list)', () => {
  test('buyer creates, providers see it with budget, other buyers do not; vote and respond', async () => {
    const c = await call('POST', '/link-requests', {
      token: S.fresh.token,
      body: {
        originName: 'Ambon',
        destinationName: 'makassar',
        capacityMbps: 1000,
        budgetMonthly: 25000000,
        termMonths: 12,
      },
    });
    assert.equal(c.status, 201);
    assert.equal(c.json.destinationName, 'Makassar', 'name normalised from reference locations');
    assert.equal(typeof c.json.originLat, 'number');
    const id = c.json.id;

    const asOp = (await get('/link-requests', 'borneo')).json.find((x) => x.id === id);
    assert.equal(asOp.budgetMonthly, 25000000);
    const asBuyer = (await get('/link-requests', 'buyer')).json.find((x) => x.id === id);
    assert.equal(asBuyer.budgetMonthly, null);
    assert.equal(asBuyer.requesterCompany, null);

    const v = await call('POST', `/link-requests/${id}/vote`, { token: A.buyer.token });
    assert.equal(v.json.voted, true);
    assert.equal(v.json.votes, 2);
    assert.equal(
      (await call('POST', `/link-requests/${id}/vote`, { token: S.fresh.token })).status,
      400,
    );

    const note = (await get('/notifications', 'borneo')).json.items;
    assert.ok(note.some((n) => n.entityId === id && n.category === 'LINK_REQUEST'));

    assert.equal(
      (
        await call('POST', `/link-requests/${id}/responses`, {
          token: A.buyer.token,
          body: { message: 'x' },
        })
      ).status,
      403,
    );
    const resp = await call('POST', `/link-requests/${id}/responses`, {
      token: S.borneo.token,
      body: { message: 'We can build this', proposedPrice: 30000000 },
    });
    assert.equal(resp.status, 201);
    const mine = (await get('/link-requests?mine=true', 'fresh')).json.find((x) => x.id === id);
    assert.equal(mine.status, 'IN_PROGRESS');
    assert.equal(mine.responses.length, 1);

    assert.equal(
      (
        await call('PATCH', `/link-requests/${id}`, {
          token: A.buyer.token,
          body: { status: 'CLOSED' },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call('PATCH', `/link-requests/${id}`, {
          token: S.fresh.token,
          body: { status: 'CLOSED' },
        })
      ).status,
      200,
    );
  });

  test('validation: same endpoints, bad capacity', async () => {
    for (const body of [
      { originName: 'Jakarta', destinationName: 'jakarta', capacityMbps: 10 },
      { originName: 'Jakarta', destinationName: 'Medan', capacityMbps: 0 },
    ])
      assert.equal(
        (await call('POST', '/link-requests', { token: S.fresh.token, body })).status,
        400,
      );
  });
});

describe('pre-build products and early bird', () => {
  test('provider creates, buyer commits at early-bird price, launch creates a link', async () => {
    const day = 86400_000;
    const c = await call('POST', '/operator/prebuild', {
      token: S.borneo.token,
      body: {
        name: { id: 'Uji Banjarmasin - Pontianak', en: 'Test Banjarmasin - Pontianak' },
        category: 'dark_fiber',
        originName: 'Banjarmasin',
        destinationName: 'Pontianak',
        capacityMbps: 10000,
        targetReadyDate: new Date(Date.now() + 90 * day).toISOString(),
        basePrice: 50000000,
        earlyBirdPrice: 40000000,
        earlyBirdUntil: new Date(Date.now() + 30 * day).toISOString(),
        earlyBirdSlots: 1,
      },
    });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.equal(c.json.discountPct, 20);
    const id = c.json.id;

    assert.equal(
      (
        await call('POST', `/prebuild/${id}/commit`, {
          token: A.buyer.token,
          body: { termMonths: 1 },
        })
      ).status,
      400,
    );
    const k1 = await call('POST', `/prebuild/${id}/commit`, {
      token: A.buyer.token,
      body: { termMonths: 12 },
    });
    assert.equal(k1.status, 201);
    assert.equal(k1.json.lockedPrice, 40000000);
    const k2 = await call('POST', `/prebuild/${id}/commit`, {
      token: S.fresh.token,
      body: { termMonths: 12 },
    });
    assert.equal(k2.json.lockedPrice, 50000000, 'early-bird slots exhausted -> base price');
    assert.equal(
      (
        await call('POST', `/prebuild/${id}/commit`, {
          token: A.buyer.token,
          body: { termMonths: 12 },
        })
      ).status,
      409,
    );

    const pub = (await get('/prebuild', 'buyer')).json.find((x) => x.id === id);
    assert.equal(pub.slotsLeft, 0);
    assert.equal(pub.myCommitment.status, 'PLEDGED');

    assert.equal(
      (
        await call('PATCH', `/operator/prebuild/${id}`, {
          token: S.borneo.token,
          body: { progressPct: 60, status: 'BUILDING' },
        })
      ).status,
      200,
    );
    const prog = (await get('/notifications', 'buyer')).json.items;
    assert.ok(prog.some((n) => n.entityId === id && n.category === 'EARLY_BIRD'));

    assert.equal(
      (
        await call('PATCH', `/operator/prebuild/${id}`, {
          token: A.op.token,
          body: { progressPct: 70 },
        })
      ).status,
      404,
    );
    const l = await call('POST', `/operator/prebuild/${id}/launch`, { token: S.borneo.token });
    assert.equal(l.status, 201);
    assert.equal(
      (await call('POST', `/operator/prebuild/${id}/launch`, { token: S.borneo.token })).status,
      409,
    );
    const own = (await get('/operator/prebuild', 'borneo')).json.find((x) => x.id === id);
    assert.ok(own.pledges.every((p) => p.status === 'CONVERTED'));
    // Clean up the launched test link.
    assert.equal(
      (await call('DELETE', `/operator/links/${l.json.linkId}`, { token: S.borneo.token })).status,
      200,
    );
  });
});

describe('provider profile and reviews', () => {
  test('income, trend, progress, reviews and tier', async () => {
    const r = await get('/provider/profile', 'op');
    assert.equal(r.status, 200);
    const p = r.json;
    assert.ok(p.income.total > 0);
    assert.ok(p.trend.length >= 1 && 'newCustomers' in p.trend[0]);
    assert.ok(p.progress.checklist.length >= 5);
    assert.ok(p.reviews.count >= 1);
    assert.ok(p.tier.current?.key);
    assert.equal((await get('/provider/profile', 'buyer')).status, 403);
  });

  test('public provider page; reviews limited to own confirmed reservations, once', async () => {
    const opId = (await get('/provider/profile', 'op')).json.profile.id;
    const pub = await get(`/providers/${opId}`, 'buyer');
    assert.equal(pub.status, 200);
    assert.ok(pub.json.reviews.average !== undefined);
    const mine = (await get('/reviews/mine', 'buyer')).json;
    assert.ok(mine.length >= 1);
    const dup = await call('POST', '/reviews', {
      token: A.buyer.token,
      body: {
        reservationId: mine[0].reservationId,
        operatorProfileId: mine[0].operatorProfileId,
        rating: 5,
      },
    });
    assert.equal(dup.status, 409);
    const foreign = await call('POST', '/reviews', {
      token: S.fresh.token,
      body: { reservationId: mine[0].reservationId, rating: 5 },
    });
    assert.equal(foreign.status, 404);
  });
});

describe('pricing maintenance', () => {
  test('bulk dry-run, single apply and CSV import with errors', async () => {
    const links = (await get('/operator/links', 'borneo')).json.filter((l) => !l.deletedAt);
    const target = links.find((l) => l.externalId === 'BL-BJM-BPN');
    const dry = await call('POST', '/operator/links/bulk-price', {
      token: S.borneo.token,
      body: { filter: { origin: 'Banjarmasin' }, mode: 'PERCENT', value: -10, dryRun: true },
    });
    assert.equal(dry.status, 201);
    assert.ok(
      dry.json.changes.some(
        (c) => c.linkId === target.id && c.after === Math.round(target.basePrice * 0.9 * 100) / 100,
      ),
    );

    const set = await call('POST', '/operator/links/bulk-price', {
      token: S.borneo.token,
      body: { linkIds: [target.id], mode: 'SET', value: target.basePrice },
    });
    assert.equal(set.json.dryRun, false);
    assert.equal(set.json.changes[0].method, 'BASE_PRICE');

    const imp = await call('POST', '/operator/links/price-import', {
      token: S.borneo.token,
      body: {
        rows: [
          { externalId: 'BL-BJM-BPN', price: target.basePrice },
          { externalId: 'NOPE', price: 1 },
        ],
      },
    });
    assert.equal(imp.json.dryRun, true, 'any invalid row blocks the whole import');
    assert.equal(imp.json.errors[0].reason, 'LINK_NOT_FOUND');

    // API-managed links get an override rule instead of a base price edit.
    const nl = (await get('/operator/links', 'op')).json.find((l) => l.apiConfigId);
    const ov = await call('POST', '/operator/links/bulk-price', {
      token: A.op.token,
      body: { linkIds: [nl.id], mode: 'FIXED', value: 0, dryRun: true },
    });
    assert.equal(ov.json.changes[0].method, 'OVERRIDE_RULE');

    const csv = await get('/operator/links/export.csv', 'borneo');
    assert.equal(csv.status, 200);
    assert.ok(String(csv.json).startsWith('linkId,externalId,origin'));
  });
});

describe('filters, reference data and export', () => {
  test('link search: city either end, several providers, min SLA', async () => {
    const r = await get('/links?city=Surabaya&pageSize=50', 'buyer');
    assert.ok(r.json.items.length >= 2);
    assert.ok(
      r.json.items.every((l) => l.originName === 'Surabaya' || l.destinationName === 'Surabaya'),
    );
    const ops = (await get('/links/facets', 'buyer')).json.operators.map((o) => o.id);
    const two = await get(`/links?operatorId=${ops.slice(0, 2).join(',')}&pageSize=50`, 'buyer');
    assert.ok(two.json.items.every((l) => ops.slice(0, 2).includes(l.operator.id)));
    const sla = await get('/links?minSlaPercent=99.9&pageSize=50', 'buyer');
    assert.ok(sla.json.items.every((l) => l.slaPercent >= 99.9));
  });

  test('reference locations come from the database; admin-only management', async () => {
    const r = await get('/reference/locations', 'buyer');
    assert.ok(r.json.some((l) => l.name === 'Pontianak'));
    assert.equal(
      (
        await call('POST', '/admin/reference/locations', {
          token: A.buyer.token,
          body: { name: 'X', lat: 0, lng: 0 },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('POST', '/admin/reference/locations', {
          token: A.admin.token,
          body: { name: 'Jakarta', lat: 0, lng: 0 },
        })
      ).status,
      400,
    );
  });

  test('admin export: catalog, csv/json, secrets stripped, others forbidden', async () => {
    const cat = await get('/admin/export', 'admin');
    assert.ok(cat.json.some((e) => e.entity === 'walletEntries'));
    const users = await get('/admin/export/users?format=json', 'admin');
    assert.equal(users.status, 200);
    assert.ok(users.json.length >= 5);
    assert.ok(users.json.every((u) => !('passwordHash' in u)));
    const csv = await get('/admin/export/linkRequests?format=csv', 'admin');
    assert.ok(String(csv.json).split('\n')[0].includes('reference'));
    assert.equal((await get('/admin/export/nope', 'admin')).status, 404);
    assert.equal((await get('/admin/export/users', 'buyer')).status, 403);
  });
});
