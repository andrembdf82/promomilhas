import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';

// =========================
// Configuração
// =========================
const WS_PORT = Number(process.env.WS_PORT || 3001);
const STATUS_INTERVAL_MS = 60000; // 1 minuto
const LOG_HEARTBEAT = false; // deixe false para reduzir logs e uso de I/O
const ENABLE_VERBOSE_STATE_LOGS = false; // true só se precisar depurar
const ENABLE_MEDIA_DOWNLOAD = true; // se quiser economizar ainda mais RAM, mude para false

let shuttingDown = false;
let pageOptimized = false;
let lastKnownStatus = 'Desconhecido';

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
    defaultViewport: {
      width: 800,
      height: 600
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-features=site-per-process',

      // Redução extra de consumo
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-notifications',
      '--disable-infobars',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-ipc-flooding-protection',
      '--force-color-profile=srgb',
      '--window-size=800,600'
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
  if (sockets.size === 0) {
    return;
  }

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

  log('\n📷 QR recebido. Escaneie com o WhatsApp:\n');
  qrcode.generate(qr, { small: true });

  broadcast({
    type: 'status',
    message: 'QR gerado'
  });
});

client.on('authenticated', () => {
  lastKnownStatus = 'Autenticado';
  log('✅ Autenticado com sucesso!');

  broadcast({
    type: 'status',
    message: 'Autenticado com sucesso'
  });
});

client.on('ready', async () => {
  lastKnownStatus = 'Conectado';

  log('✅ WhatsApp conectado e pronto para uso!');
  log('👤 Usuário:', client.info?.pushname || 'Desconhecido');
  log('📱 Número:', client.info?.wid?.user || 'Desconhecido');

  await optimizeWhatsAppPage();

  broadcast({
    type: 'status',
    message: 'Conectado',
    user: client.info?.pushname || 'Desconhecido',
    number: client.info?.wid?.user || 'Desconhecido'
  });
});

client.on('auth_failure', (msg) => {
  lastKnownStatus = 'Falha na autenticação';
  logError('❌ Falha na autenticação:', msg);

  broadcast({
    type: 'status',
    message: `Falha na autenticação: ${msg}`
  });
});

client.on('disconnected', (reason) => {
  lastKnownStatus = `Desconectado: ${reason}`;
  pageOptimized = false;

  logError('❌ Cliente desconectado:', reason);

  broadcast({
    type: 'status',
    message: `Desconectado: ${reason}`
  });
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
// Grupos monitorados
// =========================
const GRUPOS_MONITORADOS = ['Mundo Plus #773'];

function isGrupoMonitorado(chatName) {
  if (!chatName) return false;
  const lower = chatName.toLowerCase();
  return GRUPOS_MONITORADOS.some((g) => lower.includes(g.toLowerCase()));
}

// =========================
// Processamento de mensagens
// =========================
async function processMessage(msg, sourceEvent) {
  try {
    if (!msg || msg.fromMe) return;

    const chat = await safeGetChat(msg);
    const text = getMessageText(msg);
    const type = msg.type || 'desconhecido';

    // Log mais enxuto para reduzir I/O
    log(
      `📩 ${sourceEvent} | tipo=${type} | chat="${chat.name || msg.from}" | grupo=${chat.isGroup ? 'sim' : 'não'} | texto="${text.substring(0, 120)}"`
    );

    // Imagens de grupos monitorados: baixa e envia como Base64
    if (
      ENABLE_MEDIA_DOWNLOAD &&
      type === 'image' &&
      isGrupoMonitorado(chat.name)
    ) {
      try {
        const media = await msg.downloadMedia();

        if (media) {
          broadcast({
            type: 'media',
            from: msg.from,
            body: text,
            data: media.data,
            mediaType: media.mimetype,
            filename: media.filename || null,
            isGroup: chat.isGroup || false,
            chatName: chat.name || 'Chat privado',
            timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
          });

          log(
            `📤 Imagem enviada de ${chat.name} (${(media.data.length / 1024).toFixed(0)} KB base64)`
          );
          return;
        }
      } catch (mediaErr) {
        logError('⚠️ Erro ao baixar mídia:', mediaErr.message);
      }
    }

    // Ignora mídias para economizar memória
    if (
      type === 'video' ||
      type === 'audio' ||
      type === 'document' ||
      type === 'image' ||
      msg.hasMedia
    ) {
      return;
    }

    broadcast({
      type: 'message',
      from: msg.from,
      body: text,
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

// =========================
// Encerramento correto
// =========================
async function exitHandler(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

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
  if (!LOG_HEARTBEAT) return;
  log('ℹ️ Status do cliente:', client.info ? 'Conectado' : lastKnownStatus);
}, STATUS_INTERVAL_MS);

// Evita manter o processo vivo só por causa do timer
if (typeof heartbeat.unref === 'function') {
  heartbeat.unref();
}