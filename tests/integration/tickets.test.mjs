import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, linkByExternalId, requireApi, sleep } from '../helpers.mjs';

// Every ticket created here is driven to CLOSED again, so the suite can be re-run.
const LINK = 'NL-JKT-SBY-N'; // rented by the demo buyer, owned by NusaLink
const MARK = 'TESTER-MARK';
const STATES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const ROLES = ['buyer', 'buyer2', 'op', 'op2', 'admin'];
const sharedIds = new Set();

let A; // actors
let link;
const created = new Set();

const body = (over = {}) => ({
  linkId: link.id,
  kind: 'DEGRADATION',
  severity: 'SEV3',
  title: `${MARK} latency`,
  description: `${MARK} created by the automated tester`,
  ...over,
});

const createTicket = async (who = 'buyer', over = {}) => {
  const r = await call('POST', '/tickets', { token: A[who].token, body: body(over) });
  if (r.status === 201) created.add(r.json.id);
  return r;
};
const transition = (who, id, to, note) =>
  call('POST', `/tickets/${id}/transition`, { token: A[who].token, body: { to, note } });
const getTicket = (who, id) => call('GET', `/tickets/${id}`, { token: A[who].token });

async function closeOut(id) {
  for (let i = 0; i < 4; i++) {
    const t = (await getTicket('admin', id)).json;
    if (!t || t.status === 'CLOSED') break;
    await transition('admin', id, t.status === 'RESOLVED' ? 'CLOSED' : 'RESOLVED');
  }
  created.delete(id);
}
const closeAllOpen = async () => {
  for (const id of [...created]) await closeOut(id);
};

const PATH = {
  OPEN: [],
  ACKNOWLEDGED: [['op', 'ACKNOWLEDGED']],
  IN_PROGRESS: [
    ['op', 'ACKNOWLEDGED'],
    ['op', 'IN_PROGRESS'],
  ],
  RESOLVED: [['op', 'RESOLVED']],
  CLOSED: [
    ['op', 'RESOLVED'],
    ['buyer', 'CLOSED'],
  ],
};

async function ticketIn(state) {
  const r = await createTicket('buyer');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  for (const [who, to] of PATH[state]) {
    const s = await transition(who, r.json.id, to);
    assert.equal(s.status, 201, `setup ${to}: ${JSON.stringify(s.json)}`);
  }
  return r.json.id;
}

// Expected outcome per the QA matrix (07-qa-test-plan.md section 3.3).
const LEGAL = {
  OPEN: ['ACKNOWLEDGED', 'RESOLVED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};
function expected(role, from, to) {
  if (role === 'buyer2' || role === 'op2') return 404;
  if (!LEGAL[from].includes(to)) return 409;
  const ok =
    to === 'CLOSED'
      ? ['buyer', 'admin']
      : to === 'OPEN'
        ? ['buyer', 'op', 'admin']
        : ['op', 'admin'];
  return ok.includes(role) ? 'ok' : 403;
}

before(async () => {
  await requireApi();
  A = await actors();
  link = await linkByExternalId(A.buyer.token, LINK);
});

after(closeAllOpen);

describe('ticket creation', () => {
  afterEach(closeAllOpen);
  test('requires authentication', async () => {
    assert.equal((await call('POST', '/tickets', { body: body() })).status, 401);
    assert.equal((await call('GET', '/tickets')).status, 401);
  });

  test('buyer opens a ticket with SLA due dates (SEV1 15/240 min, SEV3 240/1440 min)', async () => {
    const sev1 = await createTicket('buyer', { severity: 'SEV1' });
    assert.equal(sev1.status, 201, JSON.stringify(sev1.json));
    assert.equal(sev1.json.status, 'OPEN');
    assert.equal(sev1.json.source, 'BUYER');
    assert.match(sev1.json.reference, /^TKT-\d{4}-\d{6}$/);
    const t0 = Date.parse(sev1.json.createdAt);
    assert.equal(Date.parse(sev1.json.ackDueAt) - t0, 15 * 60_000);
    assert.equal(Date.parse(sev1.json.resolveDueAt) - t0, 240 * 60_000);
    const sev3 = await createTicket('buyer', { severity: 'SEV3' });
    const t3 = Date.parse(sev3.json.createdAt);
    assert.equal(Date.parse(sev3.json.ackDueAt) - t3, 240 * 60_000);
    assert.equal(Date.parse(sev3.json.resolveDueAt) - t3, 1440 * 60_000);
  });

  test('validation: kind, severity, title, description, linkId', async () => {
    const bad = [
      { kind: 'NOPE' },
      { severity: 'SEV9' },
      { title: 'ab' },
      { title: 'x'.repeat(161) },
      { title: 12345 },
      { description: 'short' },
      { description: 'y'.repeat(4001) },
    ];
    for (const over of bad) {
      const r = await createTicket('buyer', over);
      assert.equal(r.status, 400, JSON.stringify(over));
      assert.equal(r.json.code, 'INVALID_TICKET');
    }
    assert.equal((await createTicket('buyer', { linkId: 'does-not-exist' })).status, 404);
  });

  test('a buyer that does not rent the link gets 403 TICKET_NOT_RENTER', async () => {
    const r = await createTicket('buyer2');
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'TICKET_NOT_RENTER');
    const dps = await linkByExternalId(A.buyer.token, 'NL-SBY-DPS');
    const r2 = await createTicket('buyer', { linkId: dps.id });
    assert.equal(r2.status, 403);
    assert.equal(r2.json.code, 'TICKET_NOT_RENTER');
  });

  test('operator can open on own link (source OPERATOR) but gets 404 on a rival link', async () => {
    const own = await createTicket('op', { kind: 'OTHER' });
    assert.equal(own.status, 201, JSON.stringify(own.json));
    assert.equal(own.json.source, 'OPERATOR');
    assert.equal((await createTicket('op2')).status, 404);
  });

  test('per-user open-ticket cap per link (max 2) returns 409 TICKET_DUPLICATE', async () => {
    const r1 = await createTicket('buyer');
    const r2 = await createTicket('buyer');
    const r3 = await createTicket('buyer');
    assert.deepEqual([r1.status, r2.status, r3.status], [201, 201, 409], JSON.stringify(r3.json));
    assert.equal(r3.json.code, 'TICKET_DUPLICATE');
  });

  test('parallel creations cannot exceed the per-user cap (race)', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => createTicket('buyer')));
    const ok = rs.filter((r) => r.status === 201).length;
    assert.ok(
      rs.every((r) => r.status < 500),
      'no 5xx',
    );
    assert.ok(ok <= 2, `cap is 2 open tickets but ${ok} parallel requests succeeded`);
  });
});

describe('ticket read scope and filters', () => {
  let id;
  before(async () => {
    id = (await createTicket('buyer')).json.id;
  });
  after(closeAllOpen);

  test('reporter, owner operator and admin can read; other buyer / rival operator get 404', async () => {
    for (const who of ['buyer', 'op', 'admin'])
      assert.equal((await getTicket(who, id)).status, 200, who);
    for (const who of ['buyer2', 'op2']) assert.equal((await getTicket(who, id)).status, 404, who);
    assert.equal((await call('GET', `/tickets/${id}`)).status, 401);
    assert.equal((await getTicket('admin', 'no-such-ticket')).status, 404);
  });

  test('lists are tenant-scoped', async () => {
    const has = async (who) =>
      (
        await call('GET', `/tickets?linkId=${link.id}&pageSize=50`, { token: A[who].token })
      ).json.items.some((t) => t.id === id);
    assert.equal(await has('buyer'), true);
    assert.equal(await has('op'), true);
    assert.equal(await has('admin'), true);
    assert.equal(await has('buyer2'), false);
    assert.equal(await has('op2'), false);
    const all = (await call('GET', '/tickets?pageSize=50', { token: A.op2.token })).json.items;
    assert.ok(
      all.every((t) => t.networkLink.id !== link.id),
      'rival operator list leaks NusaLink tickets',
    );
  });

  test('invalid status/kind/source filters return 400 INVALID_FILTER (no 5xx)', async () => {
    for (const who of ['buyer', 'op', 'admin']) {
      for (const q of [
        'status=foo',
        'status=open',
        'kind=foo',
        'source=foo',
        'status=OPEN&status=CLOSED',
      ]) {
        const r = await call('GET', `/tickets?${q}`, { token: A[who].token });
        assert.equal(r.status, 400, `${who} ?${q} -> ${r.status} ${JSON.stringify(r.json)}`);
        assert.equal(r.json.code, 'INVALID_FILTER');
      }
    }
  });

  test('valid filters and paging clamp', async () => {
    const r = await call(
      'GET',
      '/tickets?status=OPEN&source=BUYER&kind=DEGRADATION&pageSize=1000&page=-3',
      {
        token: A.admin.token,
      },
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.pageSize, 50);
    assert.equal(r.json.page, 1);
    assert.ok(r.json.items.every((t) => t.status === 'OPEN' && t.source === 'BUYER'));
  });
});

describe('ticket transition matrix (role x from x to)', () => {
  afterEach(async () => {
    // Ad-hoc tickets of the single tests below; the per-state shared tickets are closed in their own hooks.
    for (const id of [...created]) if (!sharedIds.has(id)) await closeOut(id);
  });
  for (const from of STATES) {
    describe(`from ${from}`, () => {
      let shared;
      before(async () => {
        shared = await ticketIn(from);
        sharedIds.add(shared);
      });
      after(async () => {
        sharedIds.delete(shared);
        await closeOut(shared);
      });

      for (const to of STATES) {
        test(`${from} -> ${to}`, async () => {
          for (const role of ROLES) {
            const exp = expected(role, from, to);
            if (exp === 'ok') {
              // A successful move changes state, so each permitted role gets its own ticket.
              const id = await ticketIn(from);
              const r = await transition(role, id, to);
              assert.equal(r.status, 201, `${role} ${from}->${to}: ${JSON.stringify(r.json)}`);
              assert.equal(r.json.status, to);
              const tl = (await getTicket('admin', id)).json.updates;
              assert.ok(
                tl.some(
                  (u) => u.type === 'STATUS_CHANGE' && u.fromStatus === from && u.toStatus === to,
                ),
              );
              await closeOut(id);
            } else {
              const r = await transition(role, shared, to);
              assert.equal(r.status, exp, `${role} ${from}->${to}: ${JSON.stringify(r.json)}`);
              if (exp === 409) assert.equal(r.json.code, 'TICKET_STATE_CONFLICT');
              if (exp === 403) assert.equal(r.json.code, 'TICKET_FORBIDDEN');
            }
          }
          assert.equal(
            (await getTicket('admin', shared)).json.status,
            from,
            'rejected moves must not change state',
          );
        });
      }
    });
  }

  test('garbage / missing "to" is a 409, never a 5xx', async () => {
    const id = await ticketIn('OPEN');
    for (const to of ['BOGUS', undefined, null, 123, {}, ['OPEN'], '']) {
      const r = await call('POST', `/tickets/${id}/transition`, {
        token: A.op.token,
        body: to === undefined ? {} : { to },
      });
      assert.equal(
        r.status,
        409,
        `to=${JSON.stringify(to)} -> ${r.status} ${JSON.stringify(r.json)}`,
      );
    }
  });

  test('transition on an unknown ticket is 404 and unauthenticated is 401', async () => {
    assert.equal((await transition('admin', 'no-such-ticket', 'ACKNOWLEDGED')).status, 404);
    const id = await ticketIn('OPEN');
    const r = await call('POST', `/tickets/${id}/transition`, { body: { to: 'ACKNOWLEDGED' } });
    assert.equal(r.status, 401);
  });

  test('two parallel acknowledgements: exactly one wins, the other gets 409', async () => {
    const id = await ticketIn('OPEN');
    const rs = await Promise.all([
      transition('op', id, 'ACKNOWLEDGED'),
      transition('admin', id, 'ACKNOWLEDGED'),
    ]);
    assert.deepEqual(
      rs.map((r) => r.status).sort(),
      [201, 409],
      JSON.stringify(rs.map((r) => r.json)),
    );
  });

  test('transitions are written to the ledger', async () => {
    const count = async () =>
      (await call('GET', '/admin/ledger?eventType=TICKET&pageSize=1', { token: A.admin.token }))
        .json.total;
    const before = await count();
    await ticketIn('ACKNOWLEDGED'); // create + 1 transition = at least 2 events
    assert.ok((await count()) >= before + 2);
  });
});

describe('ticket reopen', () => {
  afterEach(closeAllOpen);
  test('reopening restarts the resolution clock and keeps the first acknowledgement time', async () => {
    const created0 = (await createTicket('buyer', { severity: 'SEV3' })).json;
    const due1 = Date.parse(created0.resolveDueAt);
    const res = await transition('op', created0.id, 'RESOLVED');
    assert.equal(res.status, 201);
    assert.ok(res.json.resolvedAt);
    const ack1 = res.json.ackAt;
    await sleep(1200);
    const re = await transition('buyer', created0.id, 'OPEN');
    assert.equal(re.status, 201, JSON.stringify(re.json));
    assert.equal(re.json.status, 'OPEN');
    assert.equal(re.json.resolvedAt, null);
    assert.equal(re.json.resolveBreachedAt, null);
    assert.ok(Date.parse(re.json.resolveDueAt) > due1, 'resolveDueAt must be re-stamped on reopen');
    const ack = await transition('op', created0.id, 'ACKNOWLEDGED');
    assert.equal(ack.status, 201);
    assert.equal(ack.json.ackAt, ack1, 'first ackAt must be preserved (MTTA)');
  });
});

describe('ticket updates (comments, public reply, internal notes)', () => {
  let id;
  before(async () => {
    id = await ticketIn('OPEN');
  });
  after(closeAllOpen);
  const post = (who, tid, b) =>
    call('POST', `/tickets/${tid}/updates`, { token: A[who].token, body: b });

  test('buyer can comment but not post internal/public notes', async () => {
    assert.equal((await post('buyer', id, { message: `${MARK} hello` })).status, 201);
    assert.equal((await post('buyer', id, { message: 'x', isInternal: true })).status, 403);
    assert.equal((await post('buyer', id, { message: 'x', isPublicReply: true })).status, 403);
  });

  test('other buyer and rival operator get 404; unauthenticated 401', async () => {
    assert.equal((await post('buyer2', id, { message: 'x' })).status, 404);
    assert.equal((await post('op2', id, { message: 'x', isInternal: true })).status, 404);
    assert.equal(
      (await call('POST', `/tickets/${id}/updates`, { body: { message: 'x' } })).status,
      401,
    );
  });

  test('internal + public in one update is rejected with 400 and not stored', async () => {
    const r = await post('op', id, {
      message: `${MARK}-both`,
      isInternal: true,
      isPublicReply: true,
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'INVALID_MESSAGE');
    const t = (await getTicket('op', id)).json;
    assert.ok(!t.updates.some((u) => u.message === `${MARK}-both`));
    assert.equal(t.publicReply, null);
  });

  test('message must be a non-empty string up to 2000 chars (no 5xx)', async () => {
    for (const message of [123, {}, null, undefined, '', '   ', 'z'.repeat(2001)]) {
      const r = await post('op', id, { message });
      assert.equal(
        r.status,
        400,
        `message=${JSON.stringify(message)?.slice(0, 20)} -> ${r.status}`,
      );
      assert.equal(r.json.code, 'INVALID_MESSAGE');
    }
  });

  test('internal notes stay hidden from the buyer; public reply is visible and allowed only once', async () => {
    assert.equal(
      (await post('op', id, { message: `${MARK}-secret`, isInternal: true })).status,
      201,
    );
    const first = await post('op', id, { message: `${MARK}-public`, isPublicReply: true });
    assert.equal(first.status, 201);
    const second = await post('op', id, { message: `${MARK}-again`, isPublicReply: true });
    assert.equal(second.status, 409);
    assert.equal(second.json.code, 'REPLY_EXISTS');
    const asBuyer = (await getTicket('buyer', id)).json;
    assert.ok(!JSON.stringify(asBuyer).includes(`${MARK}-secret`), 'internal note leaked to buyer');
    assert.equal(asBuyer.publicReply.text, `${MARK}-public`);
    const asOp = (await getTicket('op', id)).json;
    assert.ok(asOp.updates.some((u) => u.isInternal && u.message === `${MARK}-secret`));
  });

  test('two parallel public replies: exactly one 201 and one 409 REPLY_EXISTS', async () => {
    const tid = await ticketIn('OPEN');
    const rs = await Promise.all([
      post('op', tid, { message: `${MARK}-r1`, isPublicReply: true }),
      post('admin', tid, { message: `${MARK}-r2`, isPublicReply: true }),
    ]);
    assert.deepEqual(
      rs.map((r) => r.status).sort(),
      [201, 409],
      JSON.stringify(rs.map((r) => r.json)),
    );
    await closeOut(tid);
  });

  test('closed ticket rejects every update with 409 and stores nothing', async () => {
    const tid = await ticketIn('CLOSED');
    const before = (await getTicket('admin', tid)).json.updates.length;
    for (const [who, b] of [
      ['buyer', { message: 'late comment' }],
      ['op', { message: 'late comment' }],
      ['op', { message: 'late public', isPublicReply: true }],
      ['op', { message: 'late internal', isInternal: true }],
      ['admin', { message: 'late admin' }],
    ]) {
      const r = await post(who, tid, b);
      assert.equal(r.status, 409, `${who} ${JSON.stringify(b)} -> ${r.status}`);
      assert.equal(r.json.code, 'TICKET_STATE_CONFLICT');
    }
    assert.equal((await getTicket('admin', tid)).json.updates.length, before);
  });
});

describe('ticket KPI summary (aggregate only, tenant-safe)', () => {
  afterEach(closeAllOpen);
  test('buyer, owner operator and admin get an aggregate-only summary', async () => {
    const mark = await createTicket('buyer', { title: `${MARK} summary-leak-check` });
    for (const who of ['buyer', 'op', 'admin']) {
      const r = await call('GET', `/links/${link.id}/tickets/summary?days=30`, {
        token: A[who].token,
      });
      assert.equal(r.status, 200, who);
      assert.equal(r.json.periodDays, 30);
      assert.ok(Number.isInteger(r.json.count) && Number.isInteger(r.json.openCount));
      assert.ok(!('items' in r.json));
      assert.ok(!JSON.stringify(r.json).includes(MARK), 'ticket text leaked into aggregate');
      if (r.json.count < r.json.minForRates) {
        assert.equal(r.json.mttaMin, null);
        assert.equal(r.json.mttrMin, null);
        assert.equal(r.json.slaBreachRatePct, null);
      }
    }
    void mark;
  });

  test('a competing operator cannot read a rival link summary (404)', async () => {
    const r = await call('GET', `/links/${link.id}/tickets/summary`, { token: A.op2.token });
    assert.equal(r.status, 404);
  });

  test('unknown link 404, unauthenticated 401, days is clamped to 1..180', async () => {
    assert.equal(
      (await call('GET', '/links/nope/tickets/summary', { token: A.buyer.token })).status,
      404,
    );
    assert.equal((await call('GET', `/links/${link.id}/tickets/summary`)).status, 401);
    const big = await call('GET', `/links/${link.id}/tickets/summary?days=99999`, {
      token: A.buyer.token,
    });
    assert.equal(big.json.periodDays, 180);
    const junk = await call('GET', `/links/${link.id}/tickets/summary?days=abc`, {
      token: A.buyer.token,
    });
    assert.equal(junk.json.periodDays, 30);
  });
});
