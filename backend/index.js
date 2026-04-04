import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

// Garantir que logs apareçam imediatamente no terminal
const log = (msg) => {
  console.log(msg);
  process.stdout.write('');
};
const logError = (msg) => {
  console.error(msg);
  process.stderr.write('');
};

log('Iniciando inicialização do cliente WhatsApp...');

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
      // Contêm apenas cache do navegador, não dados de autenticação
      const safeCacheDirs = [
        'Cache',
        'Code Cache',
        'CertificateRevocation',
        'Subresource Filter'
      ];

      safeCacheDirs.forEach((cacheDir) => {
        const cachePath = path.join(clientPath, cacheDir);
        if (fs.existsSync(cachePath)) {
          try {
            fs.rmSync(cachePath, { recursive: true, force: true });
            log(`♻️  Cache limpo: ${cacheDir}`);
          } catch (err) {
            logError(`⚠️  Erro ao limpar ${cacheDir}:`, err.message);
          }
        }
      });

      // Limpa logs antigos em Default/
      const defaultPath = path.join(clientPath, 'Default');
      if (fs.existsSync(defaultPath)) {
        const logsToRemove = [
          'History',
          'History-journal',
          'Network Action Predictor',
          'Network Action Predictor-journal',
          'Top Sites',
          'Top Sites-journal'
        ];

        logsToRemove.forEach((logFile) => {
          const filePath = path.join(defaultPath, logFile);
          if (fs.existsSync(filePath)) {
            try {
              fs.rmSync(filePath, { recursive: true, force: true });
              log(`♻️  Log removido: ${logFile}`);
            } catch (err) {
              logError(`⚠️  Erro ao remover ${logFile}:`, err.message);
            }
          }
        });
      }
    });

    log('✅ Limpeza de cache concluída - autenticação preservada');
  } catch (err) {
    logError('⚠️  Erro ao executar limpeza de cache:', err.message);
  }
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './sessions',
    clientId: 'client-one'
  }),
  puppeteer: {
    headless: true, // true para servidor; false apenas para depuração local
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--no-first-run',
      '--single-process'
    ]
  },
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 10000
});

log('Cliente WhatsApp configurado, aguardando inicialização...');

const wss = new WebSocketServer({ port: 3001 });
const sockets = [];

wss.on('connection', (ws) => {
  log('🔌 Novo cliente conectado ao WebSocket');
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

  for (let i = sockets.length - 1; i >= 0; i--) {
    const ws = sockets[i];
    if (ws.readyState === 1) {
      ws.send(json);
    } else {
      sockets.splice(i, 1);
    }
  }
}

client.on('qr', (qr) => {
  log('📷 QR recebido');
  qrcode.generate(qr, { small: true });
  broadcast({
    type: 'status',
    message: 'QR Code gerado - escaneie com o WhatsApp'
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
  log('Usuário:', client.info?.pushname);
  log('Número:', client.info?.wid?.user);

  broadcast({
    type: 'status',
    message: 'Conectado',
    user: client.info?.pushname || 'Desconhecido'
  });
});

client.on('auth_failure', (msg) => {
  logError('❌ Falha na autenticação:', msg);
  broadcast({
    type: 'status',
    message: 'Falha na autenticação: ' + msg
  });
});

client.on('disconnected', (reason) => {
  log('❌ Cliente desconectado:', reason);
  broadcast({
    type: 'status',
    message: 'Desconectado: ' + reason
  });
});

client.on('change_state', (state) => {
  log('🔄 Estado do cliente mudou para:', state);
  broadcast({
    type: 'status',
    message: 'Estado: ' + state
  });
});

client.on('loading_screen', (percent, message) => {
  log(`🔄 Carregando: ${percent}% - ${message}`);
  broadcast({
    type: 'status',
    message: `Carregando: ${percent}% - ${message}`
  });
});

client.on('error', (error) => {
  logError('⚠️ Erro no cliente:', error);
  broadcast({
    type: 'status',
    message: 'Erro: ' + (error?.message || String(error))
  });
});

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

async function processarMensagem(msg, origemEvento) {
  if (msg.type === 'notification_template') {
    return;
  }

  try {
    const chat = await safeGetChat(msg);

    log(`\n📩 MENSAGEM RECEBIDA - ${origemEvento}`);
    log(JSON.stringify({
      id: msg.id?._serialized,
      from: msg.from,
      to: msg.to,
      fromMe: msg.fromMe,
      type: msg.type,
      hasMedia: msg.hasMedia,
      timestamp: new Date(msg.timestamp * 1000).toLocaleString('pt-BR'),
      body: msg.body?.substring(0, 100) || '[Sem texto]'
    }, null, 2));

    if (msg.hasMedia) {
      try {
        log('📎 Mensagem com mídia detectada...');
        const media = await msg.downloadMedia();

        if (media) {
          log(`✅ Mídia recebida (${media.mimetype || 'sem mimetype'})`);

          // Apenas faz broadcast se for imagem
          if (media.mimetype && media.mimetype.startsWith('image/')) {
            broadcast({
              type: 'media',
              from: msg.from,
              body: msg.body || '',
              mediaType: media.mimetype || '',
              data: media.data || null,
              filename: media.filename || null,
              messageType: msg.type,
              isGroup: chat.isGroup || false,
              chatName: chat.name || 'Chat privado',
              timestamp: msg.timestamp,
              fromMe: msg.fromMe,
              sourceEvent: origemEvento
            });

            return;
          } else {
            log(`⚠️ Mídia ignorada - tipo não suportado: ${media.mimetype}`);
          }
        } else {
          log('⚠️ downloadMedia retornou null');
        }
      } catch (mediaError) {
        logError('❌ Erro ao processar mídia:', mediaError.message);
      }
    }

    if (msg.body) {
      broadcast({
        type: 'message',
        from: msg.from,
        body: msg.body,
        messageType: msg.type,
        isGroup: chat.isGroup || false,
        chatName: chat.name || 'Chat privado',
        timestamp: msg.timestamp,
        fromMe: msg.fromMe,
        sourceEvent: origemEvento
      });
    }
  } catch (error) {
    logError(`⚠️ Erro ao processar mensagem no evento ${origemEvento}:`, error.message);
    logError(error.stack);
  }
}

client.on('message', async (msg) => {
  await processarMensagem(msg, 'message');
});

/*client.on('message_create', async (msg) => {
  await processarMensagem(msg, 'message_create');
});*/

const exitHandler = async (signal) => {
  log(`Encerrando aplicação... Sinal recebido: ${signal || 'desconhecido'}`);
  try {
    await client.destroy();
    log('Cliente WhatsApp desconectado com sucesso');
    process.exit(0);
  } catch (err) {
    logError('Erro ao encerrar o cliente:', err);
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

log('Iniciando cliente WhatsApp...');

// Executa limpeza de cache a cada 24 horas (86400000 ms)
// Pode ajustar o intervalo conforme necessário
setInterval(() => {
  log('🧹 Iniciando limpeza de cache de sessão...');
  cleanupSessionCache();
}, 24 * 60 * 60 * 1000);

// Executa limpeza inicial na primeira inicialização
cleanupSessionCache();

client.initialize().catch((err) => {
  logError('❌ Erro ao inicializar o cliente WhatsApp:', err);
  broadcast({
    type: 'status',
    message: 'Erro ao inicializar: ' + err.message
  });
  process.exit(1);
});

setInterval(() => {
  if (client.info) {
    log(`Status do cliente: ✅ Conectado (${client.info.pushname})`);
  } else {
    log('Status do cliente: ❌ Desconectado (aguardando autenticação)');
  }
}, 10000);