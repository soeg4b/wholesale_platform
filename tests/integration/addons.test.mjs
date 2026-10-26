import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, requireApi } from '../helpers.mjs';

let A;
const made = []; // [ownerKey, id]

before(async () => {
  await requireApi();
  A = await actors();
});

after(async () => {
  for (const [who, id] of made)
    await call('DELETE', `/operator/addons/${id}`, { token: A[who].token });
});

const create = async (who, over = {}) => {
  const r = await call('POST', '/operator/addons', {
    token: A[who].token,
    body: {
      kind: 'MONITORING',
      name: { id: 'Tes otomatis', en: 'Automated test add-on' },
      price: 1234,
      priceUnit: 'MONTH',
      ...over,
    },
  });
  if (r.status === 201) made.push([who, r.json.id]);
  return r;
};

describe('add-on CRUD and tenant isolation', () => {
  test('operator creates an add-on; it appears in own list and in the buyer catalog', async () => {
    const r = await create('op2');
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.price, 1234);
    assert.equal(r.json.isActive, true);
    assert.ok(
      (await call('GET', '/operator/addons', { token: A.op2.token })).json.some(
        (a) => a.id === r.json.id,
      ),
    );
    assert.ok(
      (await call('GET', '/addons', { token: A.buyer.token })).json.some((a) => a.id === r.json.id),
    );
    assert.ok(
      !(await call('GET', '/operator/addons', { token: A.op.token })).json.some(
        (a) => a.id === r.json.id,
      ),
    );
  });

  test('buyers cannot create; invalid payloads are 400 INVALID_ADDON', async () => {
    assert.equal((await create('buyer')).status, 403);
    for (const over of [
      { kind: 'BOGUS' },
      { kind: undefined },
      { name: {} },
      { name: undefined },
      { price: -1 },
      { price: '100' },
    ]) {
      const r = await create('op2', over);
      assert.equal(r.status, 400, JSON.stringify(over));
      assert.equal(r.json.code, 'INVALID_ADDON');
    }
  });

  test('another operator gets 404 on PATCH and DELETE of a rival add-on (and it is unchanged)', async () => {
    const r = await create('op2', { name: { id: 'Milik Garuda', en: 'Garuda owned' } });
    const patch = await call('PATCH', `/operator/addons/${r.json.id}`, {
      token: A.op.token,
      body: { price: 1, isActive: false },
    });
    assert.equal(patch.status, 404);
    const del = await call('DELETE', `/operator/addons/${r.json.id}`, { token: A.op.token });
    assert.equal(del.status, 404);
    const mine = (await call('GET', '/operator/addons', { token: A.op2.token })).json.find(
      (a) => a.id === r.json.id,
    );
    assert.equal(mine.price, 1234);
    assert.equal(mine.isActive, true);
  });

  test('owner can toggle inactive (hidden from catalog), then soft-delete', async () => {
    const r = await create('op2');
    const off = await call('PATCH', `/operator/addons/${r.json.id}`, {
      token: A.op2.token,
      body: { isActive: false },
    });
    assert.equal(off.status, 200);
    assert.equal(off.json.isActive, false);
    assert.ok(
      !(await call('GET', '/addons', { token: A.buyer.token })).json.some(
        (a) => a.id === r.json.id,
      ),
    );
    const bad = await call('PATCH', `/operator/addons/${r.json.id}`, {
      token: A.op2.token,
      body: { price: -5 },
    });
    assert.equal(bad.status, 400);
    const del = await call('DELETE', `/operator/addons/${r.json.id}`, { token: A.op2.token });
    assert.equal(del.status, 200);
    assert.ok(
      !(await call('GET', '/operator/addons', { token: A.op2.token })).json.some(
        (a) => a.id === r.json.id,
      ),
    );
    assert.equal(
      (await call('DELETE', `/operator/addons/${r.json.id}`, { token: A.op2.token })).status,
      404,
    );
  });

  test('add-on changes are written to the ledger', async () => {
    const count = async () =>
      (
        await call('GET', '/admin/ledger?eventType=ADDON_CHANGE&pageSize=1', {
          token: A.admin.token,
        })
      ).json.total;
    const before0 = await count();
    await create('op2');
    assert.ok((await count()) > before0);
  });
});
