import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { getChatSummary } from './chat-summary.js';
import { createMessageProcessor } from './message-processor.js';

function pageFor(chat) {
  return {
    async evaluate(fn, id) {
      const result = vm.runInNewContext(`(${fn.toString()})(id)`, {
        id,
        window: { require: name => {
          assert.equal(name, 'WAWebCollections');
          return { Chat: { get: key => {
            assert.equal(key, '123@g.us');
            return chat;
          } } };
        } }
      });
      return JSON.parse(JSON.stringify(result));
    }
  };
}

test('forwards monitored messages without serializing chats or fetching metadata', async () => {
  const page = pageFor({
    formattedTitle: 'Mundo Plus #773',
    get lastReceivedKey() { throw new Error('last message must not be fetched'); },
    get groupMetadata() { throw new Error('participants must not be refreshed'); },
    serialize() { throw new Error('full chat must not be serialized'); }
  });
  const sent = [];
  const process = createMessageProcessor({
    monitoredGroups: ['Mundo Plus #773'],
    getChat: msg => getChatSummary(page, msg),
    broadcast: data => sent.push(data),
    logError: error => assert.fail(error)
  });
  await process({ from: '123@g.us', type: 'chat', body: 'Oferta',
    getChat: () => { throw new Error('broken library getChat'); } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatName, 'Mundo Plus #773');
  assert.equal(sent[0].type, 'message');
});

test('private messages are rejected without accessing the browser', async () => {
  assert.deepEqual(await getChatSummary(null, { from: '123@lid' }), { isGroup: false, name: '' });
});

test('missing chats and names fail closed', async () => {
  await assert.rejects(getChatSummary(pageFor(null), { from: '123@g.us' }), /não encontrada/);
  await assert.rejects(getChatSummary(pageFor({}), { from: '123@g.us' }), /Nome do grupo/);
});

test('cached subject fallback still respects the monitored group allowlist', async () => {
  const page = pageFor({ groupMetadata: { subject: 'Outro grupo' } });
  assert.deepEqual(await getChatSummary(page, { from: '123@g.us' }), { isGroup: true, name: 'Outro grupo' });
  const process = createMessageProcessor({
    monitoredGroups: ['Mundo Plus #773'], getChat: msg => getChatSummary(page, msg),
    broadcast: () => assert.fail('unmonitored group forwarded')
  });
  await process({ from: '123@g.us', type: 'chat', body: 'Oferta' });
});
