import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { call, actors, requireApi, API } from '../helpers.mjs';

// Realtime notification stream (Server-Sent Events) used by the PWA / Android app.
let A;

before(async () => {
  await requireApi();
  A = await actors();
});

describe('GET /notifications/stream (SSE)', () => {
  const firstEvent = async (token) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(`${API}/notifications/stream?token=${token}`, { signal: ctl.signal });
      assert.equal(res.status, 200);
      assert.match(String(res.headers.get('content-type')), /text\/event-stream/);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (let i = 0; i < 40; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const line = buf.split('\n').find((l) => l.startsWith('data:'));
        if (line) return JSON.parse(line.slice(5));
      }
      throw new Error('no SSE event received');
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
  };

  test('rejects missing or invalid token', async () => {
    for (const q of ['', '?token=nope']) {
      const res = await fetch(`${API}/notifications/stream${q}`);
      assert.equal(res.status, 401);
      await res.text();
    }
  });

  test('streams a snapshot with the unread count', async () => {
    const snap = await firstEvent(A.buyer.token);
    assert.equal(typeof snap.unread, 'number');
    assert.ok('latest' in snap && 'at' in snap);
  });

  test('snapshot matches the REST unread count', async () => {
    const [rest, snap] = await Promise.all([
      call('GET', '/notifications?unread=true&take=1', { token: A.buyer.token }),
      firstEvent(A.buyer.token),
    ]);
    assert.equal(snap.unread, rest.json.unread);
  });
});
