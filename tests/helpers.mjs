// Shared HTTP helpers for integration tests. Requires a running, seeded API (see README in tests/e2e).
export const API = process.env.API || 'http://localhost:4000/api';
export const PASSWORD = 'Demo@12345';

export const ACCOUNTS = {
  admin: 'admin@demo.wnmp.test',
  buyer: 'buyer@demo.wnmp.test',
  op: 'operator@nusalink.wnmp.test',
  op2: 'operator@garuda.wnmp.test',
  pending: 'pending@operator.wnmp.test',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Raw HTTP call. Returns { status, json } where json is the parsed body (or the text if not JSON). */
export async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

export async function login(email, password = PASSWORD) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json; // { token, user }
}

// A second, non-renting buyer is registered once (fixed email) and re-used on later runs.
const BUYER2 = { email: 'tester.buyer2@wnmp.test', password: 'Tester@12345' };

async function secondBuyer() {
  const reg = await call('POST', '/auth/register', {
    body: {
      email: BUYER2.email,
      password: BUYER2.password,
      fullName: 'Tester Second Buyer',
      companyName: 'PT Tester Dua',
      role: 'PENYEWA',
    },
  });
  if (reg.status === 201) return reg.json;
  return login(BUYER2.email, BUYER2.password);
}

let cached;
/** Logs in all actors once per test process. Each entry: { token, user }. */
export async function actors() {
  cached ??= (async () => {
    const [admin, buyer, op, op2, pending, buyer2] = await Promise.all([
      login(ACCOUNTS.admin),
      login(ACCOUNTS.buyer),
      login(ACCOUNTS.op),
      login(ACCOUNTS.op2),
      login(ACCOUNTS.pending),
      secondBuyer(),
    ]);
    return { admin, buyer, op, op2, pending, buyer2 };
  })();
  return cached;
}

/** Finds a link by its operator external id (e.g. 'NL-JKT-SBY-N') through the public search. */
export async function linkByExternalId(token, externalId) {
  const r = await call('GET', '/links?pageSize=50', { token });
  const found = r.json?.items?.find((l) => l.externalId === externalId);
  if (!found) throw new Error(`seed link ${externalId} not found (is the demo data seeded?)`);
  return found;
}

/** Fails fast with a clear message when the API is not reachable. */
export async function requireApi() {
  try {
    const r = await call('GET', '/public/stats');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
  } catch (e) {
    throw new Error(`API not reachable at ${API}: ${e.message}`);
  }
}

export const isUnsafe = (status) => status >= 500;
