import { createGroupMatcher } from './monitored-groups.js';

export function createMessageProcessor({ broadcast, log = () => {}, logError = () => {}, onMatched = () => {}, downloadImages = true, downloadImage = msg => msg.downloadMedia(), environment = 'production', monitoredGroups = [], selfChatTest = false, selfChatName = 'Teste WhatsApp', testGroupId = '', allowTestGroupInProduction = false, matchesSelfChat = async msg => typeof msg.to === 'string' && /@(c\.us|lid)$/.test(msg.to) && msg.from === msg.to }) {
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error(`NODE_ENV inválido: ${environment}. Use development, test ou production.`);
  }
  const isMonitoredGroup = createGroupMatcher(monitoredGroups);
  const allowSelfChat = selfChatTest && environment !== 'production';
  const allowTestGroup = Boolean(testGroupId && (allowSelfChat ||
    (environment === 'production' && allowTestGroupInProduction)));
  if (testGroupId && !/^\d+(?:-\d+)?@g\.us$/.test(testGroupId)) {
    throw new Error('WHATSAPP_TEST_GROUP_ID deve ser o identificador completo do grupo (@g.us).');
  }
  const processMessage = async (msg, sourceEvent) => {
    if (!msg || (msg.fromMe && ((!allowSelfChat && !allowTestGroup) || sourceEvent !== 'message_create'))) return;
    let stage = 'identificar conversa';
    try {
      const type = msg.type || 'desconhecido';
      if (type !== 'chat' && type !== 'image') return;
      if (type === 'chat' && msg.hasMedia) return;
      let isSelfChat = false;
      const isTestGroup = Boolean(msg.fromMe && allowTestGroup && msg.to === testGroupId);
      if (msg.fromMe) {
        stage = 'identificar destinatário da própria conta';
        isSelfChat = allowSelfChat && !isTestGroup && await matchesSelfChat(msg);
        if (!isSelfChat && !isTestGroup) return;
      }
      const isTestMessage = isSelfChat || isTestGroup;
      stage = 'identificar conversa';
      const chat = isTestMessage
        ? { isGroup: isTestGroup, name: selfChatName }
        : await msg.getChat();
      if (!isSelfChat && chat?.isGroup !== true) return;
      // Development/test permit text from other groups; images always stay scoped.
      if (!isTestMessage && (environment === 'production' || type === 'image') && !isMonitoredGroup(chat)) return;

      const text = msg.body || msg._data?.caption || msg._data?.body || '[Sem texto]';
      stage = 'preparar mensagem';
      onMatched();
      const chatName = isTestMessage ? selfChatName : chat.name;
      log(`📩 ${sourceEvent} | tipo=${type} | conversa=${chatName}${isSelfChat ? ' | teste consigo mesmo' : isTestGroup ? ' | grupo de teste' : ''}`);
      const common = {
        from: msg.from,
        body: text,
        isGroup: chat.isGroup,
        chatName,
        timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
      };

      if (type === 'image') {
        if (!downloadImages) return;
        stage = 'baixar imagem';
        const media = await downloadImage(msg);
        if (!media) {
          logError('⚠️ Imagem detectada, mas o WhatsApp ainda não disponibilizou a mídia; não encaminhada.');
          return;
        }
        stage = 'encaminhar imagem ao WebSocket';
        broadcast({
          ...common,
          type: 'media',
          data: media.data,
          mediaType: media.mimetype,
          filename: media.filename || null
        });
        log(`📤 Imagem encaminhada de ${chatName}`);
        return;
      }
      stage = 'encaminhar texto ao WebSocket';
      broadcast({ ...common, type: 'message' });
    } catch (error) {
      logError(`⚠️ Erro ao processar mensagem | etapa=${stage} | evento=${sourceEvent} | tipo=${msg.type} | propria=${Boolean(msg.fromMe)}:`,
        error?.stack || error?.message || String(error));
    }
  };

  // EventEmitter does not await async listeners. Queue by conversation so a
  // text cannot overtake image downloads, without blocking unrelated chats.
  const pending = new Map();
  return (msg, sourceEvent = 'message') => {
    if (!msg) return Promise.resolve();
    const chatId = msg.fromMe ? msg.to : msg.from;
    const previous = pending.get(chatId) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => processMessage(msg, sourceEvent));
    pending.set(chatId, current);
    const cleanup = () => {
      if (pending.get(chatId) === current) pending.delete(chatId);
    };
    current.then(cleanup, cleanup);
    return current;
  };
}
