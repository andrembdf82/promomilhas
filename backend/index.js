import { loadMonitoredGroups } from './monitored-groups.js';
import { createMessageProcessor } from './message-processor.js';
import { createSelfChatMatcher } from './self-chat.js';
import { downloadWhatsAppMedia } from './media-download.js';
import pkg from './whatsapp-client.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';

// =========================
// Configuração
// =========================
const WS_PORT = Number(process.env.WS_PORT || 3001);
const WS_HOST = process.env.WS_HOST || '127.0.0.1';
const ENVIRONMENT = process.env.NODE_ENV || 'development';
const SELF_CHAT_TEST = process.env.WHATSAPP_SELF_CHAT_TEST === '1' && ENVIRONMENT !== 'production';
const SELF_CHAT_NAME = process.env.WHATSAPP_SELF_CHAT_NAME?.trim() || 'Teste WhatsApp';
const TEST_GROUP_ID = process.env.WHATSAPP_TEST_GROUP_ID?.trim() || '';
const MONITORED_GROUPS = loadMonitoredGroups();
const STATUS_INTERVAL_MS = 60000; // 1 minuto
const LOG_HEARTBEAT = false; // deixe false para reduzir logs e uso de I/O
const ENABLE_VERBOSE_STATE_LOGS = process.env.DEBUG_WHATSAPP === '1';
const ENABLE_MEDIA_DOWNLOAD = true; // se quiser economizar ainda mais RAM, mude para false

let shuttingDown = false;
let pageOptimized = false;
let lastKnownStatus = 'Desconhecido';
let readyTimer;
let receivedMessages = 0;
const observedPages = new WeakSet();

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
    dataPath: './sessions',
    clientId: process.env.WHATSAPP_SESSION_ID || undefined
  }),
  webVersionCache: {
    type: 'none'
  },
  puppeteer: {
    headless: true,
    defaultViewport: {
      width: 800,
      height: 600
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
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
const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT });
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
  const isMessage = data.type === 'message' || data.type === 'media';
  if (sockets.size === 0) {
    if (isMessage) logError('⚠️ Mensagem não encaminhada: nenhum cliente WebSocket conectado.');
    return;
  }

  const json = JSON.stringify(data);

  for (const ws of sockets) {
    if (ws.readyState === 1) {
      try {
        ws.send(json, error => {
          if (error) {
            logError('⚠️ Falha no envio ao cliente WebSocket:', error.message);
          } else if (isMessage) {
            log(`📡 ${data.type} enviada ao cliente WebSocket | conversa=${data.chatName}`);
          }
        });
      } catch {
        sockets.delete(ws);
      }
    } else {
      sockets.delete(ws);
    }
  }
}

// =========================
// Otimizações da página Puppeteer
// =========================
async function optimizeWhatsAppPage() {
  if (pageOptimized) return;

  try {
    const page = client.pupPage;
    if (!page) {
      log('⚠️ Página do Puppeteer ainda não disponível para otimização');
      return;
    }

    // Desabilita cache para evitar acúmulo
    await page.setCacheEnabled(false);

    // Bloqueia recursos pesados e supérfluos
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      try {
        const resourceType = req.resourceType();
        const url = req.url();

        // Recursos mais pesados ou desnecessários
        if (
          resourceType === 'image' ||
          resourceType === 'media' ||
          resourceType === 'font'
        ) {
          return req.abort();
        }

        // Alguns endpoints acessórios que não ajudam no bot
        if (
          url.includes('doubleclick.net') ||
          url.includes('google-analytics.com') ||
          url.includes('googletagmanager.com')
        ) {
          return req.abort();
        }

        return req.continue();
      } catch {
        try {
          return req.continue();
        } catch {
          return;
        }
      }
    });

    page.on('error', (err) => {
      logError('❌ Erro na página Puppeteer:', err.message);
    });

    page.on('pageerror', (err) => {
      logError('❌ Erro de execução na página Puppeteer:', err.message);
    });

    pageOptimized = true;
    log('✅ Otimizações de RAM aplicadas na página do WhatsApp Web');
  } catch (error) {
    logError('⚠️ Não foi possível otimizar a página Puppeteer:', error.message);
  }
}

// =========================
// Eventos do WhatsApp
// =========================
client.on('qr', (qr) => {
  lastKnownStatus = 'QR gerado';

  log(`\n📷 QR atualizado às ${new Date().toLocaleTimeString()}. Escaneie somente o último QR exibido:\n`);
  qrcode.generate(qr, { small: true });

  broadcast({
    type: 'status',
    message: 'QR gerado'
  });
});

client.on('authenticated', () => {
  const page = client.pupPage;
  if (page && !observedPages.has(page)) {
    observedPages.add(page);
    page.on('pageerror', err => logError('❌ Erro no WhatsApp Web durante sincronização:', err.message));
    page.on('error', err => logError('❌ Falha na página do WhatsApp Web:', err.message));
  }
  lastKnownStatus = 'Autenticado';
  log('✅ Autenticado. Aguardando sincronização e ativação dos eventos de mensagens...');
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    logError('⚠️ A autenticação terminou, mas o cliente ainda não ficou pronto para receber mensagens. Último status:', lastKnownStatus);
  }, 60000);
  readyTimer.unref();

  broadcast({
    type: 'status',
    message: 'Autenticado com sucesso'
  });
});

client.on('ready', async () => {
  clearTimeout(readyTimer);
  lastKnownStatus = 'Conectado';

  log('✅ WhatsApp conectado e pronto para uso!');
  log('👤 Usuário:', client.info?.pushname || 'Desconhecido');
  log('📱 Número:', client.info?.wid?.user || 'Desconhecido');

  // Resource interception is optional while diagnosing connection issues.
  if (process.env.OPTIMIZE_WHATSAPP === '1') await optimizeWhatsAppPage();

  broadcast({
    type: 'status',
    message: 'Conectado',
    user: client.info?.pushname || 'Desconhecido',
    number: client.info?.wid?.user || 'Desconhecido'
  });
});

client.on('auth_failure', (msg) => {
  clearTimeout(readyTimer);
  lastKnownStatus = 'Falha na autenticação';
  logError('❌ Falha na autenticação:', msg);

  broadcast({
    type: 'status',
    message: `Falha na autenticação: ${msg}`
  });
});

client.on('disconnected', (reason) => {
  clearTimeout(readyTimer);
  lastKnownStatus = `Desconectado: ${reason}`;
  pageOptimized = false;

  logError('❌ Cliente desconectado:', reason);

  broadcast({
    type: 'status',
    message: `Desconectado: ${reason}`
  });
  if (process.env.RESTART_ON_DISCONNECT === '1') void exitHandler('disconnected');
});

if (ENABLE_VERBOSE_STATE_LOGS) {
  client.on('loading_screen', (percent, message) => {
    log(`🔄 Carregando: ${percent}% - ${message}`);
  });

  client.on('change_state', (state) => {
    log('🔄 Estado do cliente:', state);
  });
}

client.on('error', (err) => {
  logError('❌ Erro no cliente:', err);
});

// Produção restringe textos e imagens; desenvolvimento libera textos de outros grupos.
const processMessage = createMessageProcessor({
  environment: ENVIRONMENT,
  selfChatTest: SELF_CHAT_TEST,
  selfChatName: SELF_CHAT_NAME,
  testGroupId: TEST_GROUP_ID,
  matchesSelfChat: createSelfChatMatcher(client),
  monitoredGroups: MONITORED_GROUPS,
  broadcast,
  log,
  logError,
  downloadImages: ENABLE_MEDIA_DOWNLOAD,
  downloadImage: msg => downloadWhatsAppMedia(client.pupPage, msg),
  onMatched: () => { receivedMessages++; }
});

log(`🌍 Ambiente: ${ENVIRONMENT} | textos: ${ENVIRONMENT === 'production' ? 'somente grupos do arquivo' : 'todos os grupos'} | imagens: somente grupos do arquivo`);

log('📋 Grupos monitorados:', MONITORED_GROUPS.length ? MONITORED_GROUPS.join(' | ') : 'nenhum (lista vazia)');
log(`🧪 Teste consigo mesmo: ${SELF_CHAT_TEST ? `ativo | nome enviado ao backend: ${SELF_CHAT_NAME}` : 'desativado'}`);
if (SELF_CHAT_TEST && TEST_GROUP_ID) log('🧪 Mensagens próprias do grupo de teste configurado também estão habilitadas.');

// Evento principal
client.on('message', async (msg) => {
  await processMessage(msg, 'message');
});

// Incoming messages also emit this event; process only our own messages here.
client.on('message_create', async (msg) => {
  if (!msg.fromMe) return;
  if (SELF_CHAT_TEST) {
    await processMessage(msg, 'message_create');
  } else if (ENABLE_VERBOSE_STATE_LOGS) {
    log('📤 Mensagem enviada pela própria conta; não conta como recebida.');
  }
});

// =========================
// Encerramento correto
// =========================
async function exitHandler(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(readyTimer);

  log(`🛑 Encerrando aplicação... Sinal recebido: ${signal}`);

  try {
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {}
    }
    sockets.clear();
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

// Heartbeat leve
const heartbeat = setInterval(() => {
  if (!LOG_HEARTBEAT && !ENABLE_VERBOSE_STATE_LOGS) return;
  log('ℹ️ Status do cliente:', lastKnownStatus, '| Mensagens recebidas:', receivedMessages);
}, STATUS_INTERVAL_MS);

// Evita manter o processo vivo só por causa do timer
if (typeof heartbeat.unref === 'function') {
  heartbeat.unref();
}
