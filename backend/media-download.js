// whatsapp-web.js 1.34.7 omits mimetype in DownloadManager's arguments.
// Current WhatsApp Web rejects uncached images without that declared MIME type.
export function serializedMessageId(id) {
  if (typeof id?._serialized === 'string' && id._serialized) return id._serialized;
  if (typeof id?.$1 === 'string' && id.$1) return id.$1;
  const wid = value => typeof value === 'string' ? value : value?._serialized;
  const remote = wid(id?.remote);
  const participant = wid(id?.participant);
  if (typeof id?.fromMe !== 'boolean' || !remote || !id.id || (id.participant && !participant)) {
    throw new Error('Identificador da mensagem indisponível para baixar mídia.');
  }
  return `${id.fromMe}_${remote}_${id.id}${participant ? `_${participant}` : ''}`;
}

export async function downloadWhatsAppMedia(page, message) {
  if (!message.hasMedia) return undefined;
  return page.evaluate(async id => {
    try {
      const { Msg } = window.require('WAWebCollections');
      const msg = Msg.get(id) || (await Msg.getMessagesById([id]))?.messages?.[0];
      if (!msg?.mediaData || msg.mediaData.mediaStage === 'REUPLOADING') return undefined;
      if (msg.mediaData.mediaStage !== 'RESOLVED') {
        await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
      }
      if (msg.mediaData.mediaStage.includes('ERROR') || msg.mediaData.mediaStage === 'FETCHING') return undefined;
      const data = await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
        directPath: msg.directPath,
        encFilehash: msg.encFilehash,
        filehash: msg.filehash,
        mediaKey: msg.mediaKey,
        mediaKeyTimestamp: msg.mediaKeyTimestamp,
        type: msg.type,
        mimetype: msg.mimetype,
        signal: new AbortController().signal,
        downloadQpl: { addAnnotations() { return this; }, addPoint() { return this; } }
      });
      return {
        data: await window.WWebJS.arrayBufferToBase64Async(data),
        mimetype: msg.mimetype,
        filename: msg.filename || null
      };
    } catch (error) {
      if (error?.status === 404) return undefined;
      // Convert minified WhatsApp exceptions before Puppeteer reduces them to "r".
      throw new Error(`Download WhatsApp: ${error?.name || 'Erro'}: ${error?.message || String(error)}`);
    }
  }, serializedMessageId(message.id));
}
