import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, requireApi, sleep } from '../helpers.mjs';

let A;
before(async () => {
  await requireApi();
  A = await actors();
});

describe('audit ledger', () => {
  test('hash chain verifies (retried once in case another test file was appending)', async () => {
    let v = (await call('GET', '/admin/ledger/verify', { token: A.admin.token })).json;
    if (!v.valid) {
      await sleep(1500);
      v = (await call('GET', '/admin/ledger/verify', { token: A.admin.token })).json;
    }
    assert.equal(v.valid, true, JSON.stringify(v));
    assert.equal(v.brokenAtSequence, null);
    assert.ok(v.checked > 100);
  });

  test('ledger list is ADMIN-only, paginated, and secrets are redacted', async () => {
    assert.equal((await call('GET', '/admin/ledger', { token: A.buyer.token })).status, 403);
    assert.equal((await call('GET', '/admin/ledger', { token: A.op.token })).status, 403);
    const r = await call('GET', '/admin/ledger?pageSize=1000', { token: A.admin.token });
    assert.equal(r.status, 200);
    assert.ok(r.json.items.length <= 100, 'pageSize is capped');
    const sequences = r.json.items.map((x) => x.sequence);
    assert.deepEqual(
      [...sequences].sort((a, b) => b - a),
      sequences,
      'newest first',
    );
    const text = JSON.stringify(r.json);
    assert.ok(
      !/Demo@12345|passwordHash|eyJhbGci/.test(text),
      'credential material in ledger output',
    );
  });

  test('chain is still valid after the whole suite (ticket, add-on and payment events included)', async () => {
    await sleep(500);
    const v = (await call('GET', '/admin/ledger/verify', { token: A.admin.token })).json;
    assert.equal(v.valid, true, JSON.stringify(v));
  });
});
