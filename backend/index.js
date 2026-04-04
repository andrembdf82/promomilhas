import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';

// Logs leves apenas para o console
const log = (...args) => console.log(...args);
const logError = (...args) => console.error(...args);

// Logger minimal para Baileys (precisa de .child() e .level)
const noop = () => {};
const minimalLogger = {
  level: 'silent',
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child() { return minimalLogger; }
};

// Configuração
const SESSION_PATH = './sessions';
const WS_PORT = 3001;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 segundos
const STATUS_INTERVAL = 60000; // 1 minuto (em vez de 10 segundos)

log('▶️  Iniciando cliente WhatsApp (Baileys)...');

// WebSocket Server
const wss = new WebSocketServer({ port: WS_PORT });
const sockets = [];

wss.on('connection', (ws) => {
  sockets.push(ws);
  log(`🔌 WebSocket conectado (${sockets.length} clientes)`);

  ws.send(JSON.stringify({ type: 'status', message: 'Conectado ao WebSocket' }));

  ws.on('close', () => {
    const idx = sockets.indexOf(ws);
    if (idx !== -1) sockets.splice(idx, 1);
    log(`🔌 WebSocket desconectado (${sockets.length} clientes)`);
  });

  ws.on('error', () => {
    const idx = sockets.indexOf(ws);
    if (idx !== -1) sockets.splice(idx, 1);
  });
});

// Broadcast leve
function broadcast(data) {
  if (sockets.length === 0) return;
  const json = JSON.stringify(data);
  for (let i = sockets.length - 1; i >= 0; i--) {
    const ws = sockets[i];
    if (ws.readyState === 1) {
      ws.send(json);
    } else {
      sockets.splice(i, 1);
    }
  }
}

// Processar mensagens
async function processarMensagem(msg, sock) {
  try {
    const jid = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const isGroup = jid.endsWith('@g.us');

    if (fromMe) return; // Ignorar mensagens próprias

    let chatName = jid;
    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(jid).catch(() => null);
        chatName = meta?.subject || jid;
      } catch (e) {
        // Ignorar erro silenciosamente
      }
    }

    // Imagem
    if (msg.message?.imageMessage) {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        broadcast({
          type: 'media',
          from: jid,
          body: msg.message.imageMessage.caption || '',
          mediaType: 'image/jpeg',
          data: buffer.toString('base64'),
          filename: null,
          messageType: 'image',
          isGroup,
          chatName,
          timestamp: msg.messageTimestamp || Date.now(),
          fromMe,
          sourceEvent: 'messages.upsert'
        });
      } catch (e) {
        logError('Erro ao processar imagem:', e.message);
      }
      return;
    }

    // Texto
    const body = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text || '';

    if (body) {
      log(`📨 ${jid}: ${body.substring(0, 50)}`);
      broadcast({
        type: 'message',
        from: jid,
        body,
        messageType: 'chat',
        isGroup,
        chatName,
        timestamp: msg.messageTimestamp || Date.now(),
        fromMe,
        sourceEvent: 'messages.upsert'
      });
    }
  } catch (error) {
    logError('Erro ao processar mensagem:', error.message);
  }
}

// Conectar ao WhatsApp
let reconnectAttempts = 0;
let sock = null;

async function connectWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    sock = makeWASocket({
      auth: state,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      // Otimizações de memória
      logger: minimalLogger,
      shouldIgnoreJid: () => false,
      markOnlineAfterReceivingMessage: true,
      syncFullHistory: false,
      retryRequestDelayMs: 100,
      maxMsgsInMemory: 10,
    });

    reconnectAttempts = 0;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log('📷 QR recebido - escaneie com seu WhatsApp');
        QRCode.toString(qr, { type: 'terminal', width: 10 }, (err, qrString) => {
          if (!err) {
            console.log(qrString);
          }
        });
        broadcast({ type: 'status', message: 'QR Code gerado - escaneie' });
      }

      if (connection === 'close') {
        const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          log(`🔄 Reconectando... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(() => connectWhatsApp(), RECONNECT_DELAY);
        } else {
          logError('❌ Desconectado - faça login novamente');
          broadcast({ type: 'status', message: 'Desconectado' });
        }
      }

      if (connection === 'open') {
        log(`✅ Conectado (${sock.user?.name})`);
        broadcast({
          type: 'status',
          message: 'Conectado',
          user: sock.user?.name || 'Anônimo'
        });
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        await processarMensagem(msg, sock);
      }
    });

    // Status leve (1x por minuto)
    setInterval(() => {
      if (sock?.user) {
        log(`✅ Online (${sock.user.name})`);
      } else {
        log('❌ Offline');
      }
    }, STATUS_INTERVAL);

  } catch (err) {
    logError('Erro ao inicializar:', err.message);
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(() => connectWhatsApp(), RECONNECT_DELAY);
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('Encerrando...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Encerrando...');
  process.exit(0);
});

// Conectar
connectWhatsApp();
