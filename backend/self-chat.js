const isPrivateId = id => typeof id === 'string' && /@(c\.us|lid)$/.test(id);

// Resolve only the logged-in account; never infer identity from matching digits
// across phone-number and LID namespaces.
export function createSelfChatMatcher(client) {
  let cachedAccount;
  let aliasesPromise;
  return async msg => {
    if (msg.fromMe !== true || !isPrivateId(msg.to)) return false;
    if (msg.from === msg.to) return true;
    const account = client.info?.wid?._serialized;
    if (!isPrivateId(account)) throw new Error('Conta WhatsApp ainda não está pronta para identificar a conversa consigo mesmo.');
    if (msg.to === account) return true;
    if (cachedAccount !== account || !aliasesPromise) {
      cachedAccount = account;
      aliasesPromise = client.getContactLidAndPhone([account]);
    }
    let aliases;
    try {
      aliases = await aliasesPromise;
    } catch (error) {
      aliasesPromise = undefined;
      throw error;
    }
    if (!aliases?.length || !aliases[0]?.lid || !aliases[0]?.pn) aliasesPromise = undefined;
    return aliases?.some(({ lid, pn }) => msg.to === lid || msg.to === pn) === true;
  };
}
