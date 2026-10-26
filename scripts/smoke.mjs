// End-to-end API smoke test. Usage: node scripts/smoke.mjs  (API must be running with seeded data)
const API = process.env.API || 'http://localhost:4000/api';
const PASSWORD = 'Demo@12345';
let failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failed++;
}

const login = async (email) =>
  (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).json;

const admin = await login('admin@demo.wnmp.test');
const op = await login('operator@nusalink.wnmp.test');
const buyer = await login('buyer@demo.wnmp.test');
check('login admin/operator/buyer', admin.token && op.token && buyer.token);
check(
  'wrong password rejected',
  (
    await call('POST', '/auth/login', {
      body: { email: 'buyer@demo.wnmp.test', password: 'nope-nope' },
    })
  ).status === 401,
);
check('no token rejected', (await call('GET', '/links')).status === 401);
check(
  'buyer cannot open admin',
  (await call('GET', '/admin/overview', { token: buyer.token })).status === 403,
);
check(
  'buyer cannot manage api configs',
  (await call('GET', '/operator/api-configs', { token: buyer.token })).status === 403,
);

const stats = (await call('GET', '/public/stats')).json;
check('public stats from DB', stats.links >= 9, JSON.stringify(stats));

const facets = (await call('GET', '/links/facets', { token: buyer.token })).json;
check('facets dynamic', facets.cities?.includes('Jakarta') && facets.operators?.length >= 2);

const search = (
  await call('GET', '/links?origin=Jakarta&destination=Surabaya&sort=price_asc', {
    token: buyer.token,
  })
).json;
check('filter Jakarta->Surabaya', search.total >= 3, `total=${search.total}`);
const link = search.items.find((l) => l.availability === 'AVAILABLE');
const detail = (await call('GET', `/links/${link.id}`, { token: buyer.token })).json;
check(
  'link detail with metrics + tiers',
  detail.metrics.length > 10 && detail.priceTiers.length === 4,
);
const geo = (await call('GET', `/geo/link/${link.id}`, { token: buyer.token })).json;
check(
  'KMZ geometry returned as GeoJSON',
  geo.features?.length === 1 && geo.features[0].geometry.type === 'LineString',
);

const ai = (
  await call('POST', '/ai/analyze', {
    token: buyer.token,
    body: {
      prompt:
        'Analyze the best route for 10Gbps capacity from Jakarta to Surabaya with sub-10ms latency',
      locale: 'EN',
    },
  })
).json;
check(
  'AI analysis',
  ai.options?.length > 0 && ai.options.every((o) => o.linkIds.length),
  `engine=${ai.engine} options=${ai.options?.length}`,
);
const aiId = (
  await call('POST', '/ai/analyze', {
    token: buyer.token,
    body: {
      prompt: 'Cari rute terbaik 10G dari Jakarta ke Surabaya latensi di bawah 10 ms',
      locale: 'ID',
    },
  })
).json;
check(
  'AI analysis (Indonesian)',
  aiId.intent?.origin === 'Jakarta' && aiId.intent?.maxLatencyMs === 10,
);

// Reservation flow with operator lock + payment
const add = await call('POST', '/cart/items', {
  token: buyer.token,
  body: { linkId: link.id, termMonths: 12 },
});
check('add to cart', add.status === 201 && add.json.items.length === 1);
const co = await call('POST', '/cart/checkout', { token: buyer.token });
check(
  'checkout locks link + creates payment',
  co.status === 201 &&
    co.json.status === 'AWAITING_PAYMENT' &&
    co.json.items[0].lockStatus === 'ACQUIRED',
  JSON.stringify(co.json).slice(0, 160),
);
const locked = (await call('GET', `/links/${link.id}`, { token: buyer.token })).json;
check('link now LOCKED', locked.availability === 'LOCKED');
const paymentId = co.json.payments?.[0]?.id;
const paid = await call('POST', `/payments/mock/${paymentId}/complete`, {
  token: buyer.token,
  body: { outcome: 'success' },
});
check(
  'payment completes -> CONFIRMED',
  paid.json.status === 'CONFIRMED' && paid.json.items[0].lockStatus === 'CONFIRMED',
  paid.json.status,
);
const after = (await call('GET', `/links/${link.id}`, { token: buyer.token })).json;
check('link now RESERVED', after.availability === 'RESERVED');
check(
  'duplicate payment is idempotent',
  (
    await call('POST', `/payments/mock/${paymentId}/complete`, {
      token: buyer.token,
      body: { outcome: 'success' },
    })
  ).status < 300,
);

// Failure path releases the lock
const other = search.items.find((l) => l.availability === 'AVAILABLE' && l.id !== link.id);
if (other) {
  await call('POST', '/cart/items', {
    token: buyer.token,
    body: { linkId: other.id, termMonths: 24 },
  });
  const co2 = await call('POST', '/cart/checkout', { token: buyer.token });
  const failPay = await call('POST', `/payments/mock/${co2.json.payments[0].id}/complete`, {
    token: buyer.token,
    body: { outcome: 'failure' },
  });
  const back = (await call('GET', `/links/${other.id}`, { token: buyer.token })).json;
  check(
    'failed payment releases lock',
    failPay.json.status === 'FAILED' && back.availability === 'AVAILABLE',
  );
}

check(
  'buyer sees reservations',
  (await call('GET', '/reservations', { token: buyer.token })).json.length >= 2,
);
const opOverview = (await call('GET', '/operator/overview', { token: op.token })).json;
check(
  'operator overview',
  opOverview.links >= 5 && opOverview.revenue > 0,
  JSON.stringify(opOverview),
);
const cfgs = (await call('GET', '/operator/api-configs', { token: op.token })).json;
check(
  'api configs hide credentials',
  cfgs.length >= 1 && !('credentialsEnc' in cfgs[0]) && cfgs[0].hasCredentials,
);
const sync = await call('POST', `/operator/api-configs/${cfgs[0].id}/sync`, { token: op.token });
check('manual sync', sync.status === 201 && sync.json.seen >= 5, JSON.stringify(sync.json));
const test = await call('POST', `/operator/api-configs/${cfgs[0].id}/test`, { token: op.token });
check('connection test preview', test.json.sample?.[0]?.mapped?.externalId);

const overview = (await call('GET', '/admin/overview', { token: admin.token })).json;
check('admin overview', overview.paidPayments >= 1, JSON.stringify(overview));
const verify = (await call('GET', '/admin/ledger/verify', { token: admin.token })).json;
check('ledger hash chain valid', verify.valid === true, JSON.stringify(verify));
const ledger = (await call('GET', '/admin/ledger?pageSize=5', { token: admin.token })).json;
check('ledger entries recorded', ledger.total > 10);

// ---------- Iteration 2: explorer, performance, tickets, incidents, seller insights ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = async (origin, destination, ext) =>
  (
    await call('GET', `/links?origin=${origin}&destination=${destination}&pageSize=50`, {
      token: buyer.token,
    })
  ).json.items.find((l) => l.externalId === ext);

const graph = (await call('GET', '/explorer/graph', { token: buyer.token })).json;
check(
  'explorer graph: nodes + edges from DB',
  graph.nodes?.length >= 7 && graph.edges?.length >= 7 && graph.nodes.every((n) => n.lat && n.lng),
  `nodes=${graph.nodes?.length} edges=${graph.edges?.length}`,
);
check(
  'explorer graph: hot route + promos + basis',
  graph.edges.some((e) => e.hot) && graph.promos?.length >= 1 && 'includesDemo' in graph.basis,
);
const rt = (await call('GET', '/explorer/routes?from=Jakarta&to=Surabaya', { token: buyer.token }))
  .json;
const direct = rt.routes.filter((r) => r.hops === 1);
check(
  'routes Jakarta->Surabaya aggregated direct route',
  direct.length === 1 && rt.unmet === false,
);
check(
  'route summary: hot, promos, chips',
  direct[0].hot === true &&
    direct[0].promos.length >= 1 &&
    direct[0].chips.kmz === true &&
    direct[0].legs[0].candidates.length >= 1,
);
const multi = (
  await call('GET', '/explorer/routes?from=Jakarta&to=Makassar', { token: buyer.token })
).json;
check(
  'multi-hop flagged indicative',
  multi.routes.length >= 1 && multi.routes.every((r) => r.hops > 1 && r.indicative && !r.hot),
);
const unmet = (await call('GET', '/explorer/routes?from=Medan&to=Denpasar', { token: buyer.token }))
  .json;
check('unmet demand state', unmet.unmet === true && unmet.routes.length === 0);
check(
  'same node rejected',
  (await call('GET', '/explorer/routes?from=Jakarta&to=jakarta', { token: buyer.token })).status ===
    400,
);
check(
  'unknown node 404',
  (await call('GET', '/explorer/routes?from=Atlantis&to=Jakarta', { token: buyer.token }))
    .status === 404,
);
check(
  'clients cannot forge CART_ADD demand',
  (
    await call('POST', '/interactions', {
      token: buyer.token,
      body: { type: 'CART_ADD', linkId: link.id },
    })
  ).status === 400,
);

const pantura = await find('Jakarta', 'Surabaya', 'NL-JKT-SBY-N');
const perf = (await call('GET', `/links/${pantura.id}/performance`, { token: buyer.token })).json;
check(
  'link performance: score + basis + demo flag',
  perf.rated === true &&
    perf.score >= 0 &&
    perf.basis.samples >= 50 &&
    perf.basis.includesDemo === true &&
    perf.kpis.uptimePct > 90,
  JSON.stringify({ score: perf.score, basis: perf.basis }),
);
const unrated = (
  await call('GET', `/links/${(await find('Jakarta', 'Bandung', 'NL-JKT-BDG')).id}/performance`, {
    token: buyer.token,
  })
).json;
check(
  'new link is "not rated", never default-good',
  unrated.rated === false && !('score' in unrated),
  unrated.reason,
);

// tickets: scope, lifecycle and RBAC
const dps = await find('Surabaya', 'Denpasar', 'NL-SBY-DPS');
const notRenter = await call('POST', '/tickets', {
  token: buyer.token,
  body: {
    linkId: dps.id,
    kind: 'OTHER',
    severity: 'SEV3',
    title: 'Not a customer',
    description: 'Smoke test: this buyer does not rent the link',
  },
});
check(
  'non-renter cannot open ticket',
  notRenter.status === 403 && notRenter.json.code === 'TICKET_NOT_RENTER',
);
const tk = await call('POST', '/tickets', {
  token: buyer.token,
  body: {
    linkId: pantura.id,
    kind: 'DEGRADATION',
    severity: 'SEV2',
    title: 'Smoke: latency high',
    description: 'Observed from smoke test',
  },
});
check(
  'renter opens ticket with SLA due times',
  tk.status === 201 &&
    tk.json.status === 'OPEN' &&
    tk.json.reference.startsWith('TKT-') &&
    tk.json.ackDueAt,
);
const op2 = await login('operator@garuda.wnmp.test');
check(
  'other operator cannot see ticket (404)',
  (await call('GET', `/tickets/${tk.json.id}`, { token: op2.token })).status === 404,
);
check(
  'buyer cannot acknowledge',
  (
    await call('POST', `/tickets/${tk.json.id}/transition`, {
      token: buyer.token,
      body: { to: 'ACKNOWLEDGED' },
    })
  ).status === 403,
);
check(
  'operator acknowledges',
  (
    await call('POST', `/tickets/${tk.json.id}/transition`, {
      token: op.token,
      body: { to: 'ACKNOWLEDGED' },
    })
  ).json.status === 'ACKNOWLEDGED',
);
check(
  'illegal transition rejected',
  (
    await call('POST', `/tickets/${tk.json.id}/transition`, {
      token: op.token,
      body: { to: 'CLOSED' },
    })
  ).json.code === 'TICKET_STATE_CONFLICT',
);
const reply = await call('POST', `/tickets/${tk.json.id}/updates`, {
  token: op.token,
  body: { message: 'Investigating', isPublicReply: true },
});
check(
  'operator public reply once',
  reply.status === 201 &&
    (
      await call('POST', `/tickets/${tk.json.id}/updates`, {
        token: op.token,
        body: { message: 'again', isPublicReply: true },
      })
    ).json.code === 'REPLY_EXISTS',
);
await call('POST', `/tickets/${tk.json.id}/updates`, {
  token: op.token,
  body: { message: 'internal root cause', isInternal: true },
});
const buyerView = (await call('GET', `/tickets/${tk.json.id}`, { token: buyer.token })).json;
check('internal notes hidden from buyer', !buyerView.updates.some((u) => u.isInternal));
await call('POST', `/tickets/${tk.json.id}/transition`, {
  token: op.token,
  body: { to: 'RESOLVED' },
});
check(
  'buyer confirms closure',
  (
    await call('POST', `/tickets/${tk.json.id}/transition`, {
      token: buyer.token,
      body: { to: 'CLOSED' },
    })
  ).json.status === 'CLOSED',
);
const tsum = (
  await call('GET', `/links/${pantura.id}/tickets/summary?days=30`, { token: buyer.token })
).json;
check(
  'ticket summary is aggregate-only',
  tsum.count >= 5 && !('items' in tsum) && !JSON.stringify(tsum).includes('Smoke'),
);

// auto-detection: inject an outage on the mock operator, sync, expect a SYSTEM ticket, then recover
const bdg = await find('Jakarta', 'Bandung', 'NL-JKT-BDG');
const inj = await call('POST', '/mock-operator/incidents', {
  token: admin.token,
  body: { operator: 'nusalink', linkId: 'NL-JKT-BDG', kind: 'OUTAGE', durationMin: 30 },
});
check(
  'incident injection (admin only)',
  inj.status === 201 &&
    (
      await call('POST', '/mock-operator/incidents', {
        token: buyer.token,
        body: { operator: 'nusalink', linkId: 'NL-JKT-BDG', kind: 'OUTAGE' },
      })
    ).status === 403,
);
const nusaCfg = cfgs.find((c) => c.name.includes('NusaLink'));
for (let i = 0; i < 3; i++)
  await call('POST', `/operator/api-configs/${nusaCfg.id}/sync`, { token: op.token });
const sysTickets = (
  await call('GET', `/tickets?linkId=${bdg.id}&source=SYSTEM`, { token: op.token })
).json;
const opened = sysTickets.items.find(
  (t) => t.kind === 'OUTAGE' && ['OPEN', 'ACKNOWLEDGED'].includes(t.status),
);
check('outage auto-opens SYSTEM ticket (SEV1)', !!opened && opened.severity === 'SEV1');
await call('DELETE', `/mock-operator/incidents/${inj.json.id}`, { token: admin.token });
for (let i = 0; i < 4; i++)
  await call('POST', `/operator/api-configs/${nusaCfg.id}/sync`, { token: op.token });
const after2 = (await call('GET', `/tickets/${opened?.id}`, { token: op.token })).json;
check(
  'recovery auto-resolves ticket',
  after2.status === 'RESOLVED' && after2.incidentEndAt,
  after2.status,
);

// seller AI
check(
  'buyer cannot read seller insights',
  (await call('GET', '/seller/insights/latest', { token: buyer.token })).status === 403,
);
let gen = await call('POST', '/seller/insights/generate', { token: op.token, body: {} });
if (gen.status === 429)
  gen = {
    status: 200,
    json: (await call('GET', '/seller/insights/latest', { token: op.token })).json,
  };
const sec = gen.json.facts.sections;
const items = (s) => s.items ?? [];
check(
  'seller insight: engine labelled + bilingual',
  ['rule-based'].includes(gen.json.engine) || gen.json.engine.startsWith('llm:'),
);
check(
  'demand: top searched + rising + congestion',
  items(sec.demand.topSearched).length >= 1 &&
    items(sec.demand.rising).length >= 1 &&
    items(sec.demand.congestionRisk).length >= 1,
  JSON.stringify(Object.keys(sec.demand)),
);
check('demand: unmet route surfaced', items(sec.demand.unmetDemand).length >= 1);
check(
  'add-on advice from rented links',
  items(sec.addOns).some(
    (i) => i.params.kind === 'REDUNDANCY' && i.params.action === 'CREATE_ADDON',
  ) && items(sec.addOns).every((i) => !JSON.stringify(i).includes('demo.buyer')),
);
check(
  'improvements: price outlier + uptime',
  items(sec.improvements).some((i) => i.code === 'PRICE_OUTLIER') &&
    items(sec.improvements).some((i) => i.code === 'LOW_UPTIME'),
);
check(
  'insight texts are bilingual',
  items(sec.improvements).every((i) => i.text.id && i.text.en),
);
const ptab = (await call('GET', '/operator/performance', { token: op.token })).json;
check(
  'operator performance table',
  ptab.items.length >= 5 && ptab.items.some((r) => r.rated) && ptab.items.some((r) => r.demand.hot),
);
const ao = await call('POST', '/operator/addons', {
  token: op.token,
  body: {
    kind: 'REDUNDANCY',
    name: { id: 'Jalur cadangan', en: 'Backup path' },
    price: 1000000,
    priceUnit: 'MONTH',
  },
});
check(
  'operator creates add-on; buyer cannot',
  ao.status === 201 &&
    (
      await call('POST', '/operator/addons', {
        token: buyer.token,
        body: { kind: 'OTHER', name: { en: 'x' } },
      })
    ).status === 403,
);
check(
  'buyers see add-on catalog',
  (await call('GET', '/addons', { token: buyer.token })).json.some((a) => a.id === ao.json.id),
);
await call('DELETE', `/operator/addons/${ao.json.id}`, { token: op.token });

const verify2 = (await call('GET', '/admin/ledger/verify', { token: admin.token })).json;
check(
  'ledger chain still valid with ticket events',
  verify2.valid === true,
  JSON.stringify(verify2),
);
const tl = (await call('GET', '/admin/ledger?eventType=TICKET&pageSize=5', { token: admin.token }))
  .json;
check('ticket events recorded in ledger', tl.total >= 5);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
