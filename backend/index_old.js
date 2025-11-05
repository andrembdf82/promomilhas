//import { Client, LocalAuth } from 'whatsapp-web.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

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
  console.log('WhatsApp pronto!');
});

client.on('message', async msg => {
  const chat = await msg.getChat();
  // Verifica se a mensagem tem mídia
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      broadcast({
        type: 'media',
        from: msg.from,
        mediaType: media.mimetype, // ex: 'image/jpeg'
        data: media.data, // dados em base64
        filename: media.filename,
        isGroup: chat.isGroup,
        chatName: chat.name
      });
    } catch (error) {
      console.error('Erro ao processar mídia:', error);
    }
  } else {
    // Mensagem de texto normal
    broadcast({
      type: 'message',
      from: msg.from,
      body: msg.body,
      isGroup: chat.isGroup,
      chatName: chat.name
    });
  }
});

client.initialize();