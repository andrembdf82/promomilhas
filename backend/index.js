import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';

// =========================
// Configuração
// =========================
const WS_PORT = process.env.WS_PORT || 3001;
const STATUS_INTERVAL_MS = 60000; // 1 minuto
let shuttingDown = false;

// =========================
// Logs simples
// =========================
const log = (...args) => console.log(...args);
const logError = (...args) => console.error(...args);

log('▶️ Iniciando inicialização do cliente WhatsApp...');

// =========================
// Cliente WhatsApp
// =========================
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './sessions'
  }),
  webVersionCache: {
    type: 'local'
  },
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ]
  },
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 10000
});

log('✅ Cliente WhatsApp configurado, aguardando inicialização...');

// =========================
// WebSocket leve
// =========================
const wss = new WebSocketServer({ port: WS_PORT });
const sockets = new Set();

wss.on('connection', (ws) => {
  sockets.add(ws);
  log(`🔌 WebSocket conectado (${sockets.size} cliente(s))`);

  try {
    ws.send(JSON.stringify({
      type: 'status',
      message: 'Conectado ao WebSocket'
    }));
  } catch (err) {
    logError('Erro ao enviar status inicial do WebSocket:', err.message);
  }

  ws.on('close', () => {
    sockets.delete(ws);
    log(`🔌 WebSocket desconectado (${sockets.size} cliente(s))`);
  });

  ws.on('error', () => {
    sockets.delete(ws);
  });
});

function broadcast(data) {
  if (sockets.size === 0) return;

  const json = JSON.stringify(data);

  for (const ws of sockets) {
    if (ws.readyState === 1) {
      try {
        ws.send(json);
      } catch {
        sockets.delete(ws);
      }
    } else {
      sockets.delete(ws);
    }
  }
}

// =========================
// Eventos do WhatsApp
// =========================
client.on('qr', (qr) => {
  log('\n📷 QR recebido. Escaneie com o WhatsApp:\n');
  qrcode.generate(qr, { small: true });

  broadcast({
    type: 'status',
    message: 'QR gerado'
  });
});

client.on('authenticated', () => {
  log('✅ Autenticado com sucesso!');
  broadcast({
    type: 'status',
    message: 'Autenticado com sucesso'
  });
});

client.on('ready', () => {
  log('✅ WhatsApp conectado e pronto para uso!');
  log('👤 Usuário:', client.info?.pushname || 'Desconhecido');
  log('📱 Número:', client.info?.wid?.user || 'Desconhecido');

  broadcast({
    type: 'status',
    message: 'Conectado',
    user: client.info?.pushname || 'Desconhecido',
    number: client.info?.wid?.user || 'Desconhecido'
  });
});

client.on('auth_failure', (msg) => {
  logError('❌ Falha na autenticação:', msg);
  broadcast({
    type: 'status',
    message: `Falha na autenticação: ${msg}`
  });
});

client.on('disconnected', (reason) => {
  logError('❌ Cliente desconectado:', reason);
  broadcast({
    type: 'status',
    message: `Desconectado: ${reason}`
  });
});

client.on('loading_screen', (percent, message) => {
  log(`🔄 Carregando: ${percent}% - ${message}`);
});

client.on('change_state', (state) => {
  log('🔄 Estado do cliente:', state);
});

client.on('error', (err) => {
  logError('❌ Erro no cliente:', err);
});

// =========================
// Função segura para obter chat
// =========================
async function safeGetChat(msg) {
  try {
    return await msg.getChat();
  } catch (error) {
    logError('❌ Erro ao obter informações do chat:', error.message);
    return {
      isGroup: false,
      name: 'Chat desconhecido'
    };
  }
}

// =========================
// Extrair conteúdo textual
// =========================
function getMessageText(msg) {
  if (msg.body) return msg.body;
  if (msg._data?.caption) return msg._data.caption;
  if (msg._data?.body) return msg._data.body;
  return '[Sem texto]';
}

// =========================
// Processamento de mensagens
// =========================
async function processMessage(msg, sourceEvent) {
  try {
    if (!msg) return;
    if (msg.fromMe) return;

    const chat = await safeGetChat(msg);
    const text = getMessageText(msg);
    const type = msg.type || 'desconhecido';
    const timestamp = msg.timestamp
      ? new Date(msg.timestamp * 1000).toLocaleString('pt-BR')
      : new Date().toLocaleString('pt-BR');

    log('\n==============================');
    log(`📩 MENSAGEM RECEBIDA - ${sourceEvent}`);
    log(`🕒 ${timestamp}`);
    log(`👤 De: ${msg.from}`);
    log(`💬 Chat: ${chat.name || msg.from}`);
    log(`👥 Grupo: ${chat.isGroup ? 'sim' : 'não'}`);
    log(`🧩 Tipo: ${type}`);
    log(`📝 Texto: ${text.substring(0, 500)}`);
    log('==============================\n');

    // t2.micro: não baixa mídia, só sinaliza que chegou
    if (type === 'image' || type === 'video' || type === 'audio' || type === 'document' || msg.hasMedia) {
      broadcast({
        type: 'media_notice',
        from: msg.from,
        body: text,
        messageType: type,
        isGroup: chat.isGroup || false,
        chatName: chat.name || 'Chat privado',
        timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
      });
      return;
    }

    broadcast({
      type: 'message',
      from: msg.from,
      body: text,
      messageType: type,
      isGroup: chat.isGroup || false,
      chatName: chat.name || 'Chat privado',
      timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
    });
  } catch (error) {
    logError('⚠️ Erro ao processar mensagem:', error.message);
    logError(error.stack);
  }
}

// Evento principal
client.on('message', async (msg) => {
  await processMessage(msg, 'message');
});

// Mantém para diagnóstico, mas sem duplicar mensagens próprias
client.on('message_create', async (msg) => {
  if (msg.fromMe) return;
  await processMessage(msg, 'message_create');
});

// =========================
// Encerramento correto
// =========================
async function exitHandler(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  log(`🛑 Encerrando aplicação... Sinal recebido: ${signal}`);

  try {
    wss.close();
  } catch {}

  try {
    await client.destroy();
    log('✅ Cliente WhatsApp desconectado com sucesso');
    process.exit(0);
  } catch (err) {
    logError('❌ Erro ao encerrar o cliente:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => exitHandler('SIGINT'));
process.on('SIGTERM', () => exitHandler('SIGTERM'));

process.on('uncaughtException', async (err) => {
  logError('❌ Erro não tratado:', err);
  await exitHandler('uncaughtException');
});

process.on('unhandledRejection', async (reason) => {
  logError('❌ Promise rejeitada sem tratamento:', reason);
  await exitHandler('unhandledRejection');
});

// =========================
// Inicialização
// =========================
log('▶️ Iniciando cliente WhatsApp...');
client.initialize().catch((err) => {
  logError('❌ Erro ao inicializar o cliente WhatsApp:', err);
  process.exit(1);
});

// Status leve
setInterval(() => {
  log('ℹ️ Status do cliente:', client.info ? 'Conectado' : 'Desconectado');
}, STATUS_INTERVAL_MS);