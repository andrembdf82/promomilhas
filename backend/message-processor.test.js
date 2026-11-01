import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageProcessor as createProcessor } from './message-processor.js';
import { createGroupMatcher } from './monitored-groups.js';
import { createSelfChatMatcher } from './self-chat.js';

const monitoredGroups = ['Mundo Plus #773'];
const isMonitoredGroup = createGroupMatcher(monitoredGroups);
const createMessageProcessor = options => createProcessor({ monitoredGroups, ...options });

test('slow image downloads cannot be overtaken by following images or text', async () => {
  const sent = [];
  let releaseFirst;
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const firstDownload = new Promise(resolve => { releaseFirst = resolve; });
  const process = createMessageProcessor({
    environment: 'production', testGroupId: '123@g.us', allowTestGroupInProduction: true,
    broadcast: data => sent.push(data), logError: error => assert.fail(error)
  });
  const own = { fromMe: true, from: '456@lid', to: '123@g.us' };
  const first = process(message('Para mim', {
    ...own, type: 'image', body: 'Ida',
    downloadMedia: async () => { firstStarted(); return firstDownload; }
  }), 'message_create');
  await started;
  const second = process(message('Para mim', {
    ...own, type: 'image', body: 'Volta',
    downloadMedia: async () => ({ data: 'volta', mimetype: 'image/jpeg' })
  }), 'message_create');
  const text = process(message('Para mim', { ...own, body: 'LATAM Pass' }), 'message_create');
  // Another conversation can still progress while this download is pending.
  await process(message(undefined, { from: 'other@g.us', body: 'Outro grupo monitorado' }));
  assert.deepEqual(sent.map(m => m.body), ['Outro grupo monitorado']);
  releaseFirst({ data: 'ida', mimetype: 'image/jpeg' });
  await Promise.all([first, second, text]);
  assert.deepEqual(sent.slice(1).map(m => [m.type, m.body]), [
    ['media', 'Ida'], ['media', 'Volta'], ['message', 'LATAM Pass']
  ]);
});

test('a failed message does not prevent the next message in its conversation', async () => {
  const sent = [];
  const errors = [];
  const process = createMessageProcessor({
    broadcast: data => sent.push(data), logError: (...args) => errors.push(args)
  });
  await Promise.all([
    process(message(undefined, { type: 'image', downloadMedia: async () => { throw new Error('download failed'); } })),
    process(message(undefined, { body: 'Mensagem seguinte' }))
  ]);
  assert.equal(errors.length, 1);
  assert.deepEqual(sent.map(m => m.body), ['Mensagem seguinte']);
});

for (const environment of ['development', 'production']) {
test(`${environment}: explicit test group forwards own text and images without chat lookup`, async () => {
  const sent = [];
  const process = createMessageProcessor({
    environment, selfChatTest: environment !== 'production', testGroupId: '123@g.us',
    allowTestGroupInProduction: environment === 'production',
    selfChatName: 'Mundo Plus #773', broadcast: data => sent.push(data),
    logError: error => assert.fail(error)
  });
  for (const type of ['chat', 'image']) {
    await process(message('Para mim', {
      fromMe: true, from: '456@lid', to: '123@g.us', type,
      getChat: async () => { throw new Error('r'); },
      downloadMedia: async () => ({ data: 'aW1hZ2U=', mimetype: 'image/jpeg' })
    }), 'message_create');
  }
  assert.deepEqual(sent.map(m => m.type), ['message', 'media']);
  assert.ok(sent.every(m => m.chatName === 'Mundo Plus #773' && m.isGroup));
});
}

test('production group opt-in preserves private, own-group and monitored-group restrictions', async () => {
  const sent = [];
  const process = createMessageProcessor({
    environment: 'production', selfChatTest: true, testGroupId: '123@g.us',
    allowTestGroupInProduction: true, broadcast: data => sent.push(data),
    matchesSelfChat: async () => assert.fail('Private self-chat must stay disabled'),
    logError: error => assert.fail(error)
  });
  await process(selfMessage(), 'message_create');
  await process(message('Para mim', { fromMe: true, to: '999@g.us' }), 'message_create');
  await process(message('Outro grupo'));
  await process(message('Outro grupo', { type: 'image', hasMedia: true }));
  await process(message('Privado', { getChat: async () => ({ isGroup: false }) }));
  await process(message('Para mim', { fromMe: true, to: '123@g.us' }), 'message');
  assert.equal(sent.length, 0);
  await process(message());
  assert.equal(sent.length, 1);
});

test('own test group messages stay blocked without opt-in, in production and for other destinations', async () => {
  for (const options of [
    { environment: 'production', selfChatTest: true, to: '123@g.us' },
    { environment: 'development', selfChatTest: false, to: '123@g.us' },
    { environment: 'development', selfChatTest: true, to: '999@g.us' },
    { environment: 'development', selfChatTest: true, to: '999@c.us' }
  ]) {
    await createMessageProcessor({
      ...options, testGroupId: '123@g.us', broadcast: () => assert.fail('Unexpected forward'),
      logError: error => assert.fail(error)
    })(message(undefined, {
      fromMe: true, from: '456@lid', to: options.to,
      getChat: async () => assert.fail('Unexpected chat lookup')
    }), 'message_create');
  }
});

function selfMessage(overrides = {}) {
  return message(undefined, {
    fromMe: true,
    from: 'self@c.us',
    to: 'self@c.us',
    getChat: async () => ({
      isGroup: false, name: 'Meu nome',
      getContact: async () => ({ isMe: true })
    }),
    ...overrides
  });
}

test('self-chat test forwards text and images with the configured backend name', async () => {
  const sent = [];
  const process = createMessageProcessor({
    environment: 'development', selfChatTest: true, selfChatName: 'Mundo Plus #773',
    broadcast: data => sent.push(data), logError: error => assert.fail(error)
  });
  await process(selfMessage(), 'message_create');
  await process(selfMessage({
    type: 'image', hasMedia: true, body: '', _data: { caption: 'Legenda' },
    downloadMedia: async () => ({ data: 'aW1hZ2U=', mimetype: 'image/jpeg' })
  }), 'message_create');
  assert.deepEqual(sent[0], {
    from: 'self@c.us', body: 'Oferta de viagem', isGroup: false,
    chatName: 'Mundo Plus #773', timestamp: 123, type: 'message'
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'media');
  assert.equal(sent[1].body, 'Legenda');
  assert.equal(sent[1].data, 'aW1hZ2U=');
});

test('self-chat is opt-in and stays disabled in production', async () => {
  for (const options of [
    { environment: 'development' },
    { environment: 'production', selfChatTest: true }
  ]) {
    await createMessageProcessor({
      ...options, broadcast: () => assert.fail('Unexpected forward'),
      logError: error => assert.fail(error)
    })(selfMessage(), 'message_create');
  }
});

test('self-chat mode excludes other private chats, own group messages and duplicate event route', async () => {
  const process = createMessageProcessor({
    environment: 'test', selfChatTest: true,
    broadcast: () => assert.fail('Unexpected forward'), logError: error => assert.fail(error)
  });
  await process(selfMessage(), 'message');
  await process(message(undefined, { fromMe: true }), 'message_create');
  for (const to of ['other@c.us', undefined, 'group@g.us', 'status@broadcast']) {
    await process(selfMessage({
      to, getChat: async () => assert.fail('Own messages must not look up chats')
    }), 'message_create');
  }
  await process(selfMessage({ fromMe: false }), 'message');
  await process(selfMessage({ type: 'video', hasMedia: true }), 'message_create');
});

test('self-chat identity lookup failures are contained without forwarding', async () => {
  const errors = [];
  await createMessageProcessor({
    environment: 'development', selfChatTest: true,
    matchesSelfChat: async () => { throw new Error('lookup failed'); },
    broadcast: () => assert.fail('Unexpected forward'), logError: (...args) => errors.push(args)
  })(selfMessage(), 'message_create');
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /etapa=identificar destinatário da própria conta/);
  assert.match(errors[0][1], /lookup failed/);
});

test('forwarded self images with different phone/LID identifiers bypass broken getChat', async () => {
  for (const account of ['123@c.us', '456@lid']) {
    const sent = [];
    const matchesSelfChat = createSelfChatMatcher({
      info: { wid: { _serialized: account } },
      getContactLidAndPhone: async ids => {
        assert.deepEqual(ids, [account]);
        return [{ pn: '123@c.us', lid: '456@lid' }];
      }
    });
    const process = createMessageProcessor({
      environment: 'development', selfChatTest: true, matchesSelfChat,
      broadcast: data => sent.push(data), logError: error => assert.fail(error)
    });
    for (const [from, to] of [['123@c.us', '456@lid'], ['456@lid', '123@c.us']]) {
      await process(selfMessage({
        from, to, type: 'image', hasMedia: true, isForwarded: true,
        getChat: async () => { throw new Error('r'); },
        downloadMedia: async () => ({ data: 'aW1hZ2U=', mimetype: 'image/jpeg' })
      }), 'message_create');
    }
    assert.equal(sent.length, 2);
    assert.ok(sent.every(data => data.type === 'media' && data.isGroup === false));
  }
});

test('self-chat with matching private identifiers forwards without browser chat/contact lookup', async () => {
  const sent = [];
  const process = createMessageProcessor({
    environment: 'development', selfChatTest: true,
    broadcast: data => sent.push(data), logError: error => assert.fail(error)
  });
  for (const id of ['123@c.us', '456@lid']) {
    await process(selfMessage({
      from: id, to: id,
      getChat: async () => { throw new Error('r'); }
    }), 'message_create');
  }
  assert.equal(sent.length, 2);
  assert.ok(sent.every(data => data.isGroup === false));
});

test('matching group identifiers never bypass the own-group filter', async () => {
  await createMessageProcessor({
    environment: 'development', selfChatTest: true,
    broadcast: () => assert.fail('Own group forwarded'), logError: error => assert.fail(error)
  })(message(undefined, { fromMe: true, from: 'group@g.us', to: 'group@g.us' }), 'message_create');
});

test('image failure reports stage and stack for opaque WhatsApp errors', async () => {
  const errors = [];
  const error = new Error('r');
  await createMessageProcessor({
    environment: 'development', selfChatTest: true,
    broadcast: () => assert.fail('Failed image forwarded'), logError: (...args) => errors.push(args)
  })(selfMessage({
    from: '123@c.us', to: '123@c.us', type: 'image', hasMedia: true,
    downloadMedia: async () => { throw error; }
  }), 'message_create');
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /etapa=baixar imagem/);
  assert.equal(errors[0][1], error.stack);
});

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
