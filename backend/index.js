import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

// Garantir que logs apareçam imediatamente no terminal
const log = (...args) => {
  console.log(...args);
  process.stdout.write('');
};

const logError = (...args) => {
  console.error(...args);
  process.stderr.write('');
};

log('Iniciando inicialização do cliente WhatsApp com Baileys...');

// Função para limpar cache da pasta sessions mantendo dados de autenticação
function cleanupSessionCache() {
  const sessionPath = './sessions';

  if (!fs.existsSync(sessionPath)) {
    return;
  }

  try {
    const dirs = fs.readdirSync(sessionPath);

    dirs.forEach((clientDir) => {
      const clientPath = path.join(sessionPath, clientDir);
      const stats = fs.statSync(clientPath);

      if (!stats.isDirectory()) return;

      // Lista de diretórios que podem ser limpos com SEGURANÇA
      const safeCacheDirs = [
        'creds.json.bak',
        'app-state-sync-version.json.bak'
      ];

      safeCacheDirs.forEach((cacheFile) => {
        const filePath = path.join(clientPath, cacheFile);
        if (fs.existsSync(filePath)) {
          try {
            fs.rmSync(filePath, { recursive: true, force: true });
            log(`♻️  Arquivo de backup removido: ${cacheFile}`);
          } catch (err) {
            logError(`⚠️  Erro ao remover ${cacheFile}:`, err.message);
          }
        }
      });
    });

    log('✅ Limpeza de cache concluída - autenticação preservada');
  } catch (err) {
    logError('⚠️  Erro ao executar limpeza de cache:', err.message);
  }
}

const wss = new WebSocketServer({ port: 3001 });
const sockets = [];

wss.on('connection', (ws) => {
  log(`🔌 Novo cliente conectado ao WebSocket (total: ${sockets.length + 1})`);
  sockets.push(ws);

  ws.send(JSON.stringify({
    type: 'status',
    message: 'Conectado ao WebSocket'
  }));

  ws.on('close', () => {
    log('🔌 Cliente WebSocket desconectado');
    const index = sockets.indexOf(ws);
    if (index !== -1) {
      sockets.splice(index, 1);
    }
  });

  ws.on('error', (err) => {
    logError('Erro no WebSocket:', err.message);
  });
});

function broadcast(data) {
  const json = JSON.stringify(data);
  log(`[DEBUG] Broadcasting ${data.type} para ${sockets.length} clientes`);

  for (let i = sockets.length - 1; i >= 0; i--) {
    const ws = sockets[i];
    if (ws.readyState === 1) {
      ws.send(json);
    } else {
      sockets.splice(i, 1);
    }
  }
}

async function processarMensagem(msg, sock) {
  const jid = msg.key.remoteJid;
  const fromMe = msg.key.fromMe;
  const isGroup = jid.endsWith('@g.us');

  log(`[DEBUG] Processando mensagem de ${jid} (fromMe=${fromMe})`);

  try {
    // Ignorar mensagens do próprio número (opcional)
    if (fromMe) {
      log(`[DEBUG] Ignorando mensagem enviada por mim`);
      return;
    }

    // Extrair texto da mensagem
    const body = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.imageMessage?.caption
      || '';

    // Obter nome do chat
    let chatName = jid;
    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(jid);
        chatName = meta?.subject || jid;
      } catch (err) {
        log(`[DEBUG] Erro ao obter metadata do grupo: ${err.message}`);
        chatName = jid;
      }
    }

    // Processar imagem
    if (msg.message?.imageMessage) {
      try {
        log('📎 Mensagem com mídia detectada...');
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const base64 = buffer.toString('base64');

        log(`✅ Mídia recebida (image/jpeg)`);

        broadcast({
          type: 'media',
          from: jid,
          body: msg.message.imageMessage.caption || '',
          mediaType: 'image/jpeg',
          data: base64,
          filename: msg.message.imageMessage.filename || null,
          messageType: 'image',
          isGroup,
          chatName,
          timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
          fromMe,
          sourceEvent: 'messages.upsert'
        });
        return;
      } catch (mediaError) {
        logError('❌ Erro ao processar mídia:', mediaError.message);
      }
    }

    // Processar texto
    if (body) {
      log(`\n📩 MENSAGEM RECEBIDA`);
      log(JSON.stringify({
        from: jid,
        body: body.substring(0, 100),
        isGroup,
        chatName,
        timestamp: new Date((msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toLocaleString('pt-BR'),
        fromMe
      }, null, 2));

      broadcast({
        type: 'message',
        from: jid,
        body,
        messageType: 'chat',
        isGroup,
        chatName,
        timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
        fromMe,
        sourceEvent: 'messages.upsert'
      });
    }
  } catch (error) {
    logError(`⚠️ Erro ao processar mensagem:`, error.message);
    logError(error.stack);
  }
}

async function connectWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./sessions');

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      logger: pino({ level: 'silent' })
    });

    // Salvar credenciais automaticamente
    sock.ev.on('creds.update', saveCreds);

    // Eventos de conexão
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log('📷 QR recebido - escaneie com o WhatsApp');
        broadcast({
          type: 'status',
          message: 'QR Code gerado - escaneie com o WhatsApp'
        });
      }

      if (connection === 'close') {
        const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          log('🔄 Reconectando ao WhatsApp...');
          broadcast({
            type: 'status',
            message: 'Reconectando...'
          });
          setTimeout(() => connectWhatsApp(), 3000);
        } else {
          log('❌ Desconectado permanentemente - faça login novamente');
          broadcast({
            type: 'status',
            message: 'Desconectado - faça login novamente'
          });
        }
      }

      if (connection === 'open') {
        log('✅ WhatsApp conectado e pronto para uso!');
        log('Usuário:', sock.user?.name);
        log('Número:', sock.user?.id);
        log('[DEBUG] Cliente pronto para receber mensagens!');

        broadcast({
          type: 'status',
          message: 'Conectado',
          user: sock.user?.name || 'Desconhecido'
        });
      }

      if (connection === 'connecting') {
        log('🔄 Conectando ao WhatsApp...');
        broadcast({
          type: 'status',
          message: 'Conectando...'
        });
      }
    });

    // Evento de erro
    sock.ev.on('error', (error) => {
      logError('⚠️ Erro no socket:', error.message);
      broadcast({
        type: 'status',
        message: 'Erro: ' + error.message
      });
    });

    // Processar mensagens
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // Ignora histórico de mensagens carregado ao conectar
      if (type !== 'notify') return;

      for (const msg of messages) {
        log(`[DEBUG] Evento messages.upsert disparado de: ${msg.key.remoteJid}`);
        await processarMensagem(msg, sock);
      }
    });

    // Status periódico
    setInterval(() => {
      if (sock.user) {
        log(`Status do cliente: ✅ Conectado (${sock.user.name})`);
      } else {
        log('Status do cliente: ❌ Desconectado (aguardando autenticação)');
      }
    }, 10000);

    return sock;
  } catch (err) {
    logError('❌ Erro ao inicializar o cliente WhatsApp:', err);
    broadcast({
      type: 'status',
      message: 'Erro ao inicializar: ' + err.message
    });
    process.exit(1);
  }
}

const exitHandler = async (signal) => {
  log(`Encerrando aplicação... Sinal recebido: ${signal || 'desconhecido'}`);
  try {
    process.exit(0);
  } catch (err) {
    logError('Erro ao encerrar a aplicação:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => exitHandler('SIGINT'));
process.on('SIGTERM', () => exitHandler('SIGTERM'));

process.on('uncaughtException', async (err) => {
  logError('Erro não tratado:', err);
  await exitHandler('uncaughtException');
});

process.on('unhandledRejection', async (reason) => {
  logError('Promise rejeitada sem tratamento:', reason);
  await exitHandler('unhandledRejection');
});

log('Iniciando cliente WhatsApp com Baileys...');

// Executa limpeza de cache a cada 24 horas (86400000 ms)
setInterval(() => {
  log('🧹 Iniciando limpeza de cache de sessão...');
  cleanupSessionCache();
}, 24 * 60 * 60 * 1000);

// Executa limpeza inicial na primeira inicialização
cleanupSessionCache();

// Conectar ao WhatsApp
connectWhatsApp().catch((err) => {
  logError('Erro ao conectar:', err);
  process.exit(1);
});
