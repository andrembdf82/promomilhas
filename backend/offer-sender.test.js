import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfferSender } from './offer-sender.js';

const secret = 'test-secret-'.repeat(4);
const message = () => ({ id: 'a'.repeat(64), numero: '5561999999999', mensagem: 'Promoção de teste', expiraEm: Date.now() + 60000 });
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'offer-sender-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sent = [];
  const options = { client: { getNumberId: async n => ({ _serialized: `${n}@c.us` }),
    sendMessage: async (...args) => sent.push(args) }, isReady: () => true, secret,
    ledgerPath: join(dir, 'ledger.json'), ...overrides };
  async function start() {
    const server = await createOfferSender(options);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const post = (data, token = secret) => fetch(`http://127.0.0.1:${server.address().port}/ofertas`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(data)
    });
    return post;
  }
  return { post: await start(), sent, start };
}
test('requires secret and valid destination, without sending', async t => {
  const { post, sent } = await fixture(t);
  assert.equal((await post(message(), 'wrong')).status, 401);
  assert.equal((await post({ ...message(), numero: '123@g.us' })).status, 400);
  assert.equal(sent.length, 0);
});
test('sends once for concurrent retries and persists idempotency across restart', async t => {
  const { post, sent, start } = await fixture(t);
  const results = await Promise.all([post(message()), post(message())]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], '5561999999999@c.us');
  const afterRestart = await start();
  assert.equal((await afterRestart(message())).status, 200);
  assert.equal(sent.length, 1);
});
test('disconnected client retries, expired promotion is not sent', async t => {
  const { post, sent } = await fixture(t, { isReady: () => false });
  assert.equal((await post(message())).status, 503);
  assert.equal((await post({ ...message(), expiraEm: Date.now() - 1 })).status, 410);
  assert.equal(sent.length, 0);
});
test('invalid WhatsApp number is permanent and send failures can retry', async t => {
  let registered = false, fail = true, count = 0;
  const { post } = await fixture(t, { client: {
    getNumberId: async () => registered ? { _serialized: 'test@c.us' } : null,
    sendMessage: async () => { if (fail) throw Error('offline'); count++; }
  } });
  assert.equal((await post(message())).status, 422);
  registered = true;
  assert.equal((await post(message())).status, 503);
  fail = false;
  assert.equal((await post(message())).status, 200);
  assert.equal(count, 1);
});
