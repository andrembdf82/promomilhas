import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';

const SESSION_PATH = './sessions';
const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 20;

const log = (...args) => console.log(...args);
const logError = (...args) => console.error(...args);

const noop = () => {};
const minimalLogger = {
  level: 'silent',
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child() {
    return minimalLogger;
  }
};

let sock = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isConnecting = false;
let statusTimer = null;

function limparTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

function extrairTexto(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.documentMessage?.caption ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.listResponseMessage?.title ||
    msg.message?.templateButtonReplyMessage?.selectedId ||
    msg.message?.interactiveResponseMessage?.body?.text ||
    ''
  );
}

function agendarReconexao(motivo) {
  if (reconnectTimer) return;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logError(`❌ Limite de reconexões atingido. Último motivo: ${motivo}`);
    return;
  }

  reconnectAttempts += 1;
  log(`🔄 Reconectando em ${RECONNECT_DELAY / 1000}s... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) Motivo: ${motivo}`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWhatsApp().catch((err) => {
      logError('❌ Erro ao reconectar:', err?.message || err);
      agendarReconexao('erro no connectWhatsApp');
    });
  }, RECONNECT_DELAY);
}

async function imprimirQR(qr) {
  try {
    const qrString = await QRCode.toString(qr, {
      type: 'terminal',
      small: true
    });
    console.log(qrString);
  } catch (err) {
    logError('❌ Erro ao gerar QR no terminal:', err.message);
  }
}

async function connectWhatsApp() {
  if (isConnecting) {
    log('⏳ Já existe uma conexão em andamento, ignorando nova tentativa...');
    return;
  }

  isConnecting = true;

  try {
    log('▶️ Iniciando cliente WhatsApp (Baileys)...');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      logger: minimalLogger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      qrTimeout: 40000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      log('🔍 connection.update:', JSON.stringify({
        connection,
        qr: qr ? '(QR presente)' : undefined,
        error: lastDisconnect?.error?.message
      }));

      if (qr) {
        log('\n📷 QR recebido - escaneie com o WhatsApp:\n');
        await imprimirQR(qr);
      }

      if (connection === 'open') {
        reconnectAttempts = 0;
        log(`✅ Conectado com sucesso!`);
        log(`👤 Usuário: ${sock.user?.name || 'Desconhecido'}`);
        log(`📱 JID: ${sock.user?.id || 'Desconhecido'}`);

        if (!statusTimer) {
          statusTimer = setInterval(() => {
            if (sock?.user) {
              log(`✅ Online (${sock.user?.name || 'sem nome'})`);
            } else {
              log('❌ Offline');
            }
          }, 60000);
        }
      }

      if (connection === 'close') {
        const boom = new Boom(lastDisconnect?.error);
        const statusCode = boom?.output?.statusCode;
        const motivo = lastDisconnect?.error?.message || 'desconhecido';

        log(`❌ Conexão fechada (código: ${statusCode}, motivo: ${motivo})`);

        const foiLogout = statusCode === DisconnectReason.loggedOut;

        if (foiLogout) {
          logError('❌ Sessão deslogada. Apague a pasta sessions e escaneie o QR novamente.');
          return;
        }

        agendarReconexao(`close ${statusCode || ''} ${motivo}`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          if (!msg?.message) continue;
          if (msg.key?.fromMe) continue;

          const jid = msg.key?.remoteJid || 'desconhecido';
          const texto = extrairTexto(msg);
          const isGroup = jid.endsWith('@g.us');
          const tipoMensagem = Object.keys(msg.message || {})[0] || 'desconhecido';
          const data = msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000).toLocaleString('pt-BR')
            : new Date().toLocaleString('pt-BR');

          if (texto) {
            log('\n==============================');
            log('📩 MENSAGEM RECEBIDA');
            log(`🕒 ${data}`);
            log(`👤 De: ${jid}`);
            log(`👥 Grupo: ${isGroup ? 'sim' : 'não'}`);
            log(`🧩 Tipo: ${tipoMensagem}`);
            log(`💬 Texto: ${texto}`);
            log('==============================\n');
          } else {
            log('\n==============================');
            log('📩 MENSAGEM RECEBIDA (sem texto)');
            log(`🕒 ${data}`);
            log(`👤 De: ${jid}`);
            log(`👥 Grupo: ${isGroup ? 'sim' : 'não'}`);
            log(`🧩 Tipo: ${tipoMensagem}`);
            log('==============================\n');
          }
        } catch (err) {
          logError('❌ Erro ao processar mensagem:', err.message);
        }
      }
    });

  } catch (err) {
    logError('❌ Erro ao inicializar:', err?.message || err);
    agendarReconexao('erro na inicialização');
  } finally {
    isConnecting = false;
  }
}

process.on('SIGINT', () => {
  log('🛑 Encerrando aplicação...');
  limparTimers();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('🛑 Encerrando aplicação...');
  limparTimers();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logError('❌ uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  logError('❌ unhandledRejection:', reason);
});

connectWhatsApp();