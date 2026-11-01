import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

// One process owns this ledger and serializes sends. No phone numbers or bodies are logged.
export async function createOfferSender({ client, isReady, secret, ledgerPath }) {
  if (!secret || secret.length < 32) throw new Error('WHATSAPP_SEND_SECRET precisa ter pelo menos 32 caracteres');
  let sent = {};
  try { sent = JSON.parse(await readFile(ledgerPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let queue = Promise.resolve();
  const inFlight = new Map();
  async function deliver(data) {
    if (sent[data.id]) return 200;
    if (data.expiraEm <= Date.now()) return 410;
    if (!isReady()) return 503;
    const number = await client.getNumberId(data.numero);
    if (!number) return 422;
    if (data.expiraEm <= Date.now()) return 410;
    await client.sendMessage(number._serialized, data.mensagem, { sendSeen: false });
    sent[data.id] = Date.now();
    sent = Object.fromEntries(Object.entries(sent).filter(([, time]) => time > Date.now() - 7 * 86400000));
    await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 });
    await writeFile(`${ledgerPath}.tmp`, JSON.stringify(sent), { mode: 0o600 });
    await rename(`${ledgerPath}.tmp`, ledgerPath);
    return 200;
  }
  const server = createServer(async (request, response) => {
    const reply = status => { if (!response.writableEnded) { response.writeHead(status); response.end(); } };
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(request.headers.authorization || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(401);
    if (request.method !== 'POST' || request.url !== '/ofertas') return reply(404);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) return reply(413);
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data.id !== 'string' || !/^[a-f0-9]{64}$/.test(data.id)
          || typeof data.numero !== 'string' || !/^[1-9][0-9]{7,14}$/.test(data.numero)
          || typeof data.mensagem !== 'string' || !data.mensagem.trim() || data.mensagem.length > 4000
          || !Number.isSafeInteger(data.expiraEm) || data.expiraEm > Date.now() + 31 * 60000) return reply(400);
      if (!inFlight.has(data.id)) {
        const job = queue.then(() => deliver(data)).catch(() => 503);
        inFlight.set(data.id, job);
        queue = job.then(() => { inFlight.delete(data.id); });
      }
      // A timed-out HTTP request does not start another WhatsApp send on retry.
      const timer = setTimeout(() => reply(503), 18000);
      try { reply(await inFlight.get(data.id)); }
      finally { clearTimeout(timer); }
    } catch { reply(400); }
  });
  server.requestTimeout = 25000;
  server.headersTimeout = 10000;
  return server;
}
