import { createGroupMatcher } from './monitored-groups.js';

export function createMessageProcessor({ broadcast, log = () => {}, logError = () => {}, onMatched = () => {}, downloadImages = true, environment = 'production', monitoredGroups = [] }) {
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error(`NODE_ENV inválido: ${environment}. Use development, test ou production.`);
  }
  const isMonitoredGroup = createGroupMatcher(monitoredGroups);
  return async function processMessage(msg, sourceEvent = 'message') {
    if (!msg || msg.fromMe) return;
    try {
      const chat = await msg.getChat();
      // Private conversations are excluded in every environment.
      if (chat?.isGroup !== true) return;
      const type = msg.type || 'desconhecido';
      if (type !== 'chat' && type !== 'image') return;
      if (type === 'chat' && msg.hasMedia) return;
      // Development/test permit text from other groups; images always stay scoped.
      if ((environment === 'production' || type === 'image') && !isMonitoredGroup(chat)) return;

      const text = msg.body || msg._data?.caption || msg._data?.body || '[Sem texto]';
      onMatched();
      log(`📩 ${sourceEvent} | tipo=${type} | grupo=${chat.name}`);
      const common = {
        from: msg.from,
        body: text,
        isGroup: true,
        chatName: chat.name,
        timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
      };

      if (type === 'image') {
        if (!downloadImages) return;
        const media = await msg.downloadMedia();
        if (!media) return;
        broadcast({
          ...common,
          type: 'media',
          data: media.data,
          mediaType: media.mimetype,
          filename: media.filename || null
        });
        log(`📤 Imagem encaminhada de ${chat.name}`);
        return;
      }
      broadcast({ ...common, type: 'message' });
    } catch (error) {
      logError('⚠️ Erro ao processar mensagem do grupo monitorado:', error.message);
    }
  };
}
