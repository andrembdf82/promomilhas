import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';

// Logs simples
const log = (...args) => console.log(...args);
const logError = (...args) => console.error(...args);

// Evita múltiplos encerramentos
let shuttingDown = false;

// Cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './sessions'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints'
    ]
  },
  takeoverOnConflict: true,
  takeoverTimeoutMs: 10000
});

// Eventos principais
client.on('qr', (qr) => {
  log('\n📷 QR RECEBIDO - escaneie com o WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  log('✅ Autenticado com sucesso!');
});

client.on('ready', () => {
  log('✅ WhatsApp conectado e pronto para uso!');
  log('👤 Usuário:', client.info?.pushname || 'Desconhecido');
  log('📱 Número:', client.info?.wid?.user || 'Desconhecido');
});

client.on('auth_failure', (msg) => {
  logError('❌ Falha na autenticação:', msg);
});

client.on('loading_screen', (percent, message) => {
  log(`🔄 Carregando: ${percent}% - ${message}`);
});

client.on('change_state', (state) => {
  log('🔄 Estado do cliente:', state);
});

client.on('disconnected', (reason) => {
  logError('❌ Cliente desconectado:', reason);
});

// Função para extrair texto de vários tipos de mensagem
function extrairTexto(msg) {
  return (
    msg.body ||
    msg._data?.caption ||
    msg._data?.body ||
    '[Sem texto]'
  );
}

// Função para obter tipo amigável
function tipoMensagem(msg) {
  return msg.type || 'desconhecido';
}

// Processamento enxuto de mensagem
async function processarMensagem(msg, origemEvento) {
  try {
    // Ignora mensagens enviadas por você
    if (msg.fromMe) return;

    const texto = extrairTexto(msg);
    const tipo = tipoMensagem(msg);
    const dataHora = msg.timestamp
      ? new Date(msg.timestamp * 1000).toLocaleString('pt-BR')
      : new Date().toLocaleString('pt-BR');

    let chatNome = msg.from;
    let isGroup = false;

    try {
      const chat = await msg.getChat();
      if (chat) {
        isGroup = !!chat.isGroup;
        chatNome = chat.name || msg.from;
      }
    } catch (e) {
      // se falhar, usa o from
    }

    log('\n==============================');
    log(`📩 MENSAGEM RECEBIDA - ${origemEvento}`);
    log(`🕒 Data/Hora: ${dataHora}`);
    log(`👤 De: ${msg.from}`);
    log(`💬 Chat: ${chatNome}`);
    log(`👥 Grupo: ${isGroup ? 'sim' : 'não'}`);
    log(`🧩 Tipo: ${tipo}`);
    log(`📝 Texto: ${texto}`);
    log('==============================\n');
  } catch (error) {
    logError('❌ Erro ao processar mensagem:', error.message);
  }
}

// Escuta mensagens recebidas
client.on('message', async (msg) => {
  await processarMensagem(msg, 'message');
});

// Opcional: também escuta criação de mensagem
client.on('message_create', async (msg) => {
  // Mantém só para diagnóstico, mas ignora as suas próprias
  if (msg.fromMe) return;
  await processarMensagem(msg, 'message_create');
});

// Tratamento de erros
client.on('error', (err) => {
  logError('❌ Erro no cliente:', err);
});

process.on('uncaughtException', (err) => {
  logError('❌ uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  logError('❌ unhandledRejection:', reason);
});

// Encerramento gracioso
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  log(`🛑 Encerrando aplicação (${signal})...`);

  try {
    await client.destroy();
  } catch (err) {
    logError('⚠️ Erro ao destruir cliente:', err.message);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Inicialização
log('▶️ Iniciando cliente WhatsApp (whatsapp-web.js)...');

client.initialize().catch((err) => {
  logError('❌ Erro ao inicializar o cliente:', err);
  process.exit(1);
});