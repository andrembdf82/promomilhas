import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfChatMatcher } from './self-chat.js';

test('matches own aliases only and caches identity lookup', async () => {
  let calls = 0;
  const matches = createSelfChatMatcher({
    info: { wid: { _serialized: '123@c.us' } },
    getContactLidAndPhone: async () => {
      calls++;
      return [{ pn: '123@c.us', lid: '456@lid' }];
    }
  });
  const own = { fromMe: true, from: '123@c.us' };
  assert.equal(await matches({ ...own, to: '123@c.us' }), true);
  assert.equal(calls, 0);
  assert.equal(await matches({ ...own, to: '456@lid' }), true);
  for (const to of ['789@c.us', '123@lid', '456@c.us', 'group@g.us', 'status@broadcast', undefined]) {
    assert.equal(await matches({ ...own, to }), false);
  }
  assert.equal(await matches({ ...own, to: '456@lid', fromMe: false }), false);
  assert.equal(calls, 1);
});

test('failed lookup can be retried; changing accounts invalidates cached aliases', async () => {
  let calls = 0;
  const client = {
    info: { wid: { _serialized: '123@c.us' } },
    getContactLidAndPhone: async () => {
      if (++calls === 1) throw new Error('lookup failed');
      return [{ pn: client.info.wid._serialized, lid: calls === 2 ? '456@lid' : '999@lid' }];
    }
  };
  const matches = createSelfChatMatcher(client);
  const msg = { fromMe: true, from: '123@c.us', to: '456@lid' };
  await assert.rejects(matches(msg), /lookup failed/);
  assert.equal(await matches(msg), true);
  client.info.wid._serialized = '789@c.us';
  assert.equal(await matches({ ...msg, from: '789@c.us' }), false);
  assert.equal(calls, 3);
});
