import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageProcessor as createProcessor } from './message-processor.js';
import { createGroupMatcher } from './monitored-groups.js';

const monitoredGroups = ['Mundo Plus #773'];
const isMonitoredGroup = createGroupMatcher(monitoredGroups);
const createMessageProcessor = options => createProcessor({ monitoredGroups, ...options });

function message(name = 'Mundo Plus 773', overrides = {}) {
  return {
    from: 'group@g.us', type: 'chat', body: 'Oferta de viagem', timestamp: 123,
    getChat: async () => ({ isGroup: true, name }),
    downloadMedia: async () => assert.fail('Unexpected media download'),
    ...overrides
  };
}

test('matches target name, prefixes and legacy hash, but not another group number', () => {
  for (const name of ['Mundo Plus 773', 'Ofertas — MUNDO PLUS #773 ✈', 'Mundo  Plus 773 - Viagens']) {
    assert.equal(isMonitoredGroup({ isGroup: true, name }), true);
  }
  for (const name of ['Mundo Plus 774', 'Mundo Plus 7730', 'Mundo Plus 1773', '', null]) {
    assert.equal(isMonitoredGroup({ isGroup: true, name }), false);
  }
  assert.equal(isMonitoredGroup({ isGroup: false, name: 'Mundo Plus 773' }), false);
});

test('does not forward or download anything from other conversations', async () => {
  const process = createMessageProcessor({
    broadcast: () => assert.fail('Unrelated message forwarded'),
    log: () => assert.fail('Unrelated message logged'),
    logError: error => assert.fail(error)
  });
  await process(message('Outro grupo'));
  await process(message('Outro grupo', { type: 'image', hasMedia: true }));
  await process(message('Mundo Plus 773', {
    getChat: async () => ({ isGroup: false, name: 'Mundo Plus 773' })
  }));
});

test('forwards monitored text with the backend-compatible payload', async () => {
  const sent = [];
  await createMessageProcessor({ broadcast: data => sent.push(data) })(message());
  assert.deepEqual(sent, [{
    type: 'message', from: 'group@g.us', body: 'Oferta de viagem',
    isGroup: true, chatName: 'Mundo Plus 773', timestamp: 123
  }]);
});

test('downloads monitored images once and preserves caption and media metadata', async () => {
  const sent = [];
  let downloads = 0;
  await createMessageProcessor({ broadcast: data => sent.push(data) })(message('Mundo Plus #773', {
    type: 'image', hasMedia: true, body: '', _data: { caption: 'Promoção' },
    downloadMedia: async () => {
      downloads++;
      return { data: 'aW1hZ2U=', mimetype: 'image/jpeg', filename: 'oferta.jpg' };
    }
  }));
  assert.equal(downloads, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'media');
  assert.equal(sent[0].body, 'Promoção');
  assert.equal(sent[0].data, 'aW1hZ2U=');
  assert.equal(sent[0].mediaType, 'image/jpeg');
});

test('ignores own messages and unsupported media', async () => {
  const process = createMessageProcessor({
    broadcast: () => assert.fail('Unexpected forward'),
    logError: error => assert.fail(error)
  });
  await process(message(undefined, { fromMe: true, getChat: () => assert.fail('Own message looked up') }));
  for (const type of ['video', 'audio', 'ptt', 'document', 'sticker']) {
    await process(message(undefined, { type, hasMedia: true }));
  }
});

test('failed chat lookup does not bypass the filter; failed image download is contained', async () => {
  const errors = [];
  const process = createMessageProcessor({
    broadcast: () => assert.fail('Unexpected forward'),
    logError: (...error) => errors.push(error)
  });
  await process(message(undefined, { getChat: async () => { throw new Error('lookup failed'); } }));
  await process(message(undefined, {
    type: 'image', downloadMedia: async () => { throw new Error('download failed'); }
  }));
  assert.equal(errors.length, 2);
});

for (const environment of ['development', 'test', 'production']) {
  test(`${environment}: group text obeys environment and image scope is preserved`, async () => {
    const sent = [];
    let downloads = 0;
    const process = createMessageProcessor({
      environment,
      broadcast: data => sent.push(data),
      logError: error => assert.fail(error)
    });
    await process(message('Outro grupo'));
    assert.equal(sent.length, environment === 'production' ? 0 : 1);
    if (sent.length) assert.equal(sent[0].chatName, 'Outro grupo');
    sent.length = 0;

    const image = {
      type: 'image', hasMedia: true,
      downloadMedia: async () => {
        downloads++;
        return { data: 'aW1hZ2U=', mimetype: 'image/jpeg' };
      }
    };
    await process(message('Outro grupo', image));
    assert.equal(downloads, 0);
    assert.equal(sent.length, 0);
    await process(message('Mundo Plus #773', image));
    assert.equal(downloads, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'media');
  });

  test(`${environment}: private conversations remain excluded`, async () => {
    const process = createMessageProcessor({
      environment,
      broadcast: () => assert.fail('Private message forwarded'),
      logError: error => assert.fail(error)
    });
    await process(message('Mundo Plus #773', {
      getChat: async () => ({ isGroup: false, name: 'Mundo Plus #773' })
    }));
  });
}

test('rejects misspelled environments instead of silently broadening the filter', () => {
  assert.throws(() => createMessageProcessor({ broadcast() {}, environment: 'prodution' }), /NODE_ENV inválido/);
});

test('configured groups replace the old group for both texts and images', async () => {
  const sent = [];
  const process = createMessageProcessor({
    monitoredGroups: ['Novo grupo', 'Outro grupo'],
    broadcast: data => sent.push(data),
    logError: error => assert.fail(error)
  });
  await process(message('Mundo Plus #773'));
  assert.equal(sent.length, 0);
  await process(message('Novo grupo'));
  await process(message('Outro grupo', {
    type: 'image', hasMedia: true,
    downloadMedia: async () => ({ data: 'aW1hZ2U=', mimetype: 'image/jpeg' })
  }));
  assert.deepEqual(sent.map(data => data.type), ['message', 'media']);
});
