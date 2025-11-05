//import { Client, LocalAuth } from 'whatsapp-web.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';

console.log('Iniciando inicialização do cliente WhatsApp...');

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './sessions',
    clientId: 'client-one'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ]
  },
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 10000
});

console.log('Cliente WhatsApp configurado, aguardando inicialização...');

const wss = new WebSocketServer({ port: 3001 });
const sockets = [];

wss.on('connection', (ws) => {
  sockets.push(ws);
  ws.send(JSON.stringify({ type: 'status', message: 'Conectado ao WebSocket' }));
});

function broadcast(data) {
  const json = JSON.stringify(data);
  sockets.forEach(ws => ws.readyState === 1 && ws.send(json));
}

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('Escaneie o QR code com o WhatsApp');
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado e pronto para uso!');
  console.log('Usuário:', client.info.pushname);
  console.log('Número:', client.info.wid.user);
});

client.on('auth_failure', msg => {
  console.error('❌ Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
  console.log('❌ Cliente desconectado:', reason);
});

client.on('loading_screen', (percent, message) => {
  console.log(`🔄 Carregando: ${percent}% - ${message}`);
});

// Função segura para obter informações do chat
async function safeGetChat(msg) {
  try {
    return await msg.getChat();
  } catch (error) {
    console.error('❌ Erro ao obter informações do chat:', error.message);
    return {
      isGroup: false,
      name: 'Chat desconhecido'
    };
  }
}

client.on('message', async msg => {
  try {
    console.log('📩 Nova mensagem recebida');
    
    // Obter informações do chat de forma segura
    const chat = await safeGetChat(msg);
    
    // Log de depuração
    console.log(`Tipo: ${msg.type || 'desconhecido'}, De: ${msg.from}, Conteúdo: ${msg.body?.substring(0, 50) || '[Sem texto]'}`);
    
    // Processar apenas mensagens com conteúdo ou mídia
    if (msg.type === 'image') {
      try {
        console.log('🖼️ Processando imagem...');
        const media = await msg.downloadMedia();
        
        if (media && media.mimetype && media.mimetype.startsWith('image/')) {
          console.log(`✅ Imagem recebida (${media.mimetype})`);
          broadcast({
            type: 'image',
            from: msg.from,
            mediaType: media.mimetype,
            data: media.data,
            filename: media.filename || 'imagem.jpg',
            isGroup: chat.isGroup || false,
            chatName: chat.name || 'Chat privado',
            timestamp: msg.timestamp
          });
        }
      } catch (mediaError) {
        console.error('❌ Erro ao processar mídia:', mediaError.message);
      }
    } else if (msg.body) {
      // Mensagem de texto normal
      broadcast({
        type: 'message',
        from: msg.from,
        body: msg.body,
        isGroup: chat.isGroup || false,
        chatName: chat.name || 'Chat privado',
        timestamp: msg.timestamp
      });
    }
  } catch (error) {
    console.error('⚠️ Erro ao processar mensagem:', error.message);
    console.error('Stack:', error.stack);
  }
});

// Função para encerrar o processo corretamente
const exitHandler = async () => {
  console.log('Encerrando aplicação...');
  try {
    await client.destroy();
    console.log('Cliente WhatsApp desconectado com sucesso');
    process.exit(0);
  } catch (err) {
    console.error('Erro ao encerrar o cliente:', err);
    process.exit(1);
  }
};

// Capturar eventos de encerramento
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);
process.on('uncaughtException', (err) => {
  console.error('Erro não tratado:', err);
  exitHandler();
});

// Inicialização do cliente
console.log('Iniciando cliente WhatsApp...');
client.initialize().catch(err => {
  console.error('❌ Erro ao inicializar o cliente WhatsApp:', err);
  process.exit(1);
});

// Verificação de status a cada 5 segundos
setInterval(() => {
  console.log('Status do cliente:', client.info ? 'Conectado' : 'Desconectado');
}, 5000);
