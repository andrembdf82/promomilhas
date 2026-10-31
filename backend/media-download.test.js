import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadWhatsAppMedia, serializedMessageId } from './media-download.js';

test('resolves legacy and new WhatsApp IDs, including group participants', () => {
  assert.equal(serializedMessageId({ _serialized: 'legacy' }), 'legacy');
  assert.equal(serializedMessageId({ $1: 'new-id' }), 'new-id');
  assert.equal(serializedMessageId({ fromMe: true, remote: '123@g.us', id: 'ABC', participant: { _serialized: '456@lid' } }), 'true_123@g.us_ABC_456@lid');
  assert.equal(serializedMessageId({ fromMe: false, remote: { _serialized: '123@c.us' }, id: 'ABC' }), 'false_123@c.us_ABC');
  assert.throws(() => serializedMessageId({}), /Identificador/);
});

test('image download supplies MIME type, preserves bytes and reports browser errors clearly', async () => {
  const model = { mediaData: { mediaStage: 'RESOLVED' }, type: 'image', mimetype: 'image/jpeg' };
  let calls = 0;
  const page = { evaluate: async (fn, id) => {
    assert.equal(id, 'message-id');
    globalThis.window = {
      require: name => name === 'WAWebCollections'
        ? { Msg: { get: () => model } }
        : { downloadManager: { downloadAndMaybeDecrypt: async options => {
          calls++;
          assert.equal(options.mimetype, 'image/jpeg');
          assert.equal(options.type, 'image');
          if (calls === 2) throw { name: 'InvalidMediaFileType', message: 'MIME inválido' };
          return new Uint8Array([255, 216, 255]).buffer;
        } } },
      WWebJS: { arrayBufferToBase64Async: async data => Buffer.from(data).toString('base64') }
    };
    try { return await fn(id); } finally { delete globalThis.window; }
  } };
  const message = { hasMedia: true, id: { _serialized: 'message-id' } };
  assert.deepEqual(await downloadWhatsAppMedia(page, message), {
    data: '/9j/', mimetype: 'image/jpeg', filename: null
  });
  await assert.rejects(downloadWhatsAppMedia(page, { ...message, id: { $1: 'message-id' } }), /InvalidMediaFileType: MIME inválido/);
  model.mediaData.mediaStage = 'REUPLOADING';
  assert.equal(await downloadWhatsAppMedia(page, message), undefined);
  assert.equal(await downloadWhatsAppMedia(page, { hasMedia: false }), undefined);
  assert.equal(calls, 2);
});
