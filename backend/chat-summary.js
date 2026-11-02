// Only group identity is needed for filtering. getChat() also refreshes all
// participants and fetches the last message, which can fail on changed WA keys
// or wait for the network before an otherwise valid message can be forwarded.
export async function getChatSummary(page, message) {
  const id = message.fromMe ? message.to : message.from;
  if (typeof id !== 'string' || !id.endsWith('@g.us')) {
    return { isGroup: false, name: '' };
  }
  return page.evaluate(chatId => {
    const chat = window.require('WAWebCollections').Chat.get(chatId);
    if (!chat) throw new Error('Conversa recebida não encontrada no cache do WhatsApp.');
    const name = chat.formattedTitle || chat.name || chat.groupMetadata?.subject;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Nome do grupo indisponível no cache do WhatsApp.');
    }
    return { isGroup: true, name };
  }, id);
}
