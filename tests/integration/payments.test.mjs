import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, requireApi } from '../helpers.mjs';

// Replays use payments that are already final (PAID / FAILED) so no link is reserved or locked by this suite.
let A;
let paid; // { reservation, payment }
let failed;

const reservations = async () =>
  (await call('GET', '/reservations', { token: A.buyer.token })).json;
const find = (rows, status) => {
  for (const r of rows) {
    const p = (r.payments ?? []).find((x) => x.provider === 'mock' && x.status === status);
    if (p) return { reservation: r, payment: p };
  }
  return null;
};
const ledgerTotals = async () => {
  const out = {};
  for (const t of ['PAYMENT', 'RESERVATION', 'LINK_LOCK']) {
    out[t] = (
      await call('GET', `/admin/ledger?eventType=${t}&pageSize=1`, { token: A.admin.token })
    ).json.total;
  }
  return out;
};
const complete = (who, id, outcome) =>
  call('POST', `/payments/mock/${id}/complete`, {
    token: who ? A[who].token : undefined,
    body: { outcome },
  });

before(async () => {
  await requireApi();
  A = await actors();
  const rows = await reservations();
  paid = find(rows, 'PAID');
  failed = find(rows, 'FAILED');
});

describe('payment completion is idempotent', () => {
  test('replaying success on a PAID payment changes nothing and writes no ledger events', async (t) => {
    if (!paid) return t.skip('no PAID mock payment in demo data');
    const before0 = await ledgerTotals();
    const link0 = JSON.stringify(paid.reservation.items.map((i) => [i.id, i.lockStatus]));
    for (let i = 0; i < 3; i++) {
      const r = await complete('buyer', paid.payment.id, 'success');
      assert.ok(
        r.status < 300,
        `replay ${i} -> ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`,
      );
    }
    const after0 = await reservations();
    const same = after0.find((r) => r.id === paid.reservation.id);
    assert.equal(same.status, paid.reservation.status);
    assert.equal(same.payments.find((p) => p.id === paid.payment.id).status, 'PAID');
    assert.equal(JSON.stringify(same.items.map((i) => [i.id, i.lockStatus])), link0);
    assert.deepEqual(await ledgerTotals(), before0, 'a replay must not append ledger rows');
  });

  test('a late "failure" for an already PAID payment cannot undo it or release the link', async (t) => {
    if (!paid) return t.skip('no PAID mock payment in demo data');
    const r = await complete('buyer', paid.payment.id, 'failure');
    assert.ok(r.status < 300);
    const row = (await reservations()).find((x) => x.id === paid.reservation.id);
    assert.equal(row.payments.find((p) => p.id === paid.payment.id).status, 'PAID');
    assert.equal(row.status, paid.reservation.status);
    assert.ok(row.items.every((i) => i.lockStatus !== 'RELEASED'));
  });

  test('a late "success" for a FAILED payment does not resurrect it', async (t) => {
    if (!failed) return t.skip('no FAILED mock payment in demo data');
    const before0 = await ledgerTotals();
    const r = await complete('buyer', failed.payment.id, 'success');
    assert.ok(r.status < 300);
    const row = (await reservations()).find((x) => x.id === failed.reservation.id);
    assert.equal(row.payments.find((p) => p.id === failed.payment.id).status, 'FAILED');
    assert.equal(row.status, 'FAILED');
    assert.deepEqual(await ledgerTotals(), before0);
  });

  test('only the paying buyer can complete; operators are forbidden; unknown payment 404', async (t) => {
    const target = (paid ?? failed)?.payment.id;
    if (!target) return t.skip('no mock payment in demo data');
    assert.equal((await complete('buyer2', target, 'success')).status, 404);
    assert.equal((await complete('op', target, 'success')).status, 403);
    assert.equal((await complete('admin', target, 'success')).status, 403);
    assert.equal((await complete(null, target, 'success')).status, 401);
    assert.equal((await complete('buyer', 'no-such-payment', 'success')).status, 404);
  });

  test('reservation list is private to the buyer', async (t) => {
    if (!paid) return t.skip('no PAID mock payment in demo data');
    const other = (await call('GET', '/reservations', { token: A.buyer2.token })).json;
    assert.ok(!other.some((r) => r.id === paid.reservation.id));
    assert.equal(
      (await call('GET', `/reservations/${paid.reservation.id}`, { token: A.buyer2.token })).status,
      404,
    );
  });
});
