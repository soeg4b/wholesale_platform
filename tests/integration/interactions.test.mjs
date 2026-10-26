import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, linkByExternalId, requireApi } from '../helpers.mjs';

// Valid reports are sent as the operator: seller/admin interactions are stored for audit but never counted as demand.
let A;
let link;
const post = (who, body) =>
  call('POST', '/interactions', { token: who ? A[who].token : undefined, body });

before(async () => {
  await requireApi();
  A = await actors();
  link = await linkByExternalId(A.buyer.token, 'NL-JKT-SBY-N');
});

describe('POST /interactions validation', () => {
  test('requires authentication', async () => {
    assert.equal((await post(null, { type: 'VIEW', linkId: link.id })).status, 401);
  });

  test('server-only types and junk types are rejected with 400 INVALID_TYPE', async () => {
    for (const type of [
      'CART_ADD',
      'RESERVE',
      'view',
      'DROP TABLE',
      123,
      null,
      undefined,
      {},
      ['VIEW'],
    ]) {
      const r = await post(
        'buyer',
        type === undefined ? { linkId: link.id } : { type, linkId: link.id },
      );
      assert.equal(r.status, 400, `type=${JSON.stringify(type)} -> ${r.status}`);
      assert.equal(r.json.code, 'INVALID_TYPE');
    }
  });

  test('unknown link id is 404 (strings, numbers and objects never 5xx)', async () => {
    for (const linkId of ['no-such-link', 123, {}, ['x']]) {
      const r = await post('op', { type: 'VIEW', linkId });
      assert.equal(
        r.status,
        404,
        `linkId=${JSON.stringify(linkId)} -> ${r.status} ${JSON.stringify(r.json)}`,
      );
    }
  });

  test('unknown node is 404 NODE_NOT_FOUND', async () => {
    for (const body of [
      { type: 'SEARCH', from: 'Atlantis', to: 'Jakarta' },
      { type: 'SEARCH', from: 'Jakarta', to: 'Atlantis' },
    ]) {
      const r = await post('op', body);
      assert.equal(r.status, 404);
      assert.equal(r.json.code, 'NODE_NOT_FOUND');
    }
  });

  test('non-string / empty / oversized node names are 400', async () => {
    for (const from of [123, {}, ['Jakarta'], true, '', '   ', 'x'.repeat(81)]) {
      const r = await post('op', { type: 'SEARCH', from, to: 'Surabaya' });
      assert.equal(r.status, 400, `from=${JSON.stringify(from)?.slice(0, 20)} -> ${r.status}`);
    }
    const r = await post('op', { type: 'SEARCH', from: 'Jakarta', to: 42 });
    assert.equal(r.status, 400);
  });

  test('valid SEARCH and VIEW reports return 204', async () => {
    assert.equal((await post('op', { type: 'VIEW', linkId: link.id })).status, 204);
    assert.equal(
      (await post('op', { type: 'SEARCH', from: 'jakarta', to: 'Surabaya' })).status,
      204,
    );
  });

  test('empty body does not 5xx', async () => {
    const r = await post('op', {});
    assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
  });
});

describe('interaction audit access', () => {
  test('only admin can read GET /admin/interactions', async () => {
    assert.equal((await call('GET', '/admin/interactions', { token: A.buyer.token })).status, 403);
    assert.equal((await call('GET', '/admin/interactions', { token: A.op.token })).status, 403);
    assert.equal((await call('GET', '/admin/interactions')).status, 401);
    const r = await call('GET', '/admin/interactions', { token: A.admin.token });
    assert.equal(r.status, 200);
    assert.ok(r.json.length <= 100);
  });

  test('operator interactions are stored uncounted (never inflate demand)', async () => {
    await post('op', { type: 'VIEW', linkId: link.id });
    const rows = (
      await call('GET', `/admin/interactions?userId=${A.op.user.id}&linkId=${link.id}`, {
        token: A.admin.token,
      })
    ).json;
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.counted === false));
  });
});
