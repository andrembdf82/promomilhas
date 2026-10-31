# Bot WhatsApp na Oracle E2.1.Micro

Destino: Ubuntu 24.04 Minimal x86_64, usuário `ubuntu`, 1 GB RAM.
Este pacote instala somente o bot Node.js; Java, MySQL e Docker não são necessários.
O volume esperado é uma conta e aproximadamente 100 mensagens/dia do grupo
Mundo Plus #773. O consumo do Chromium ainda precisa ser medido na VM.

## Enviar do computador para a VM

Na raiz de `promomilhas/backend`, prepare a configuração local dos grupos antes de empacotar:

```bash
cp -n grupos-monitorados.example.txt grupos-monitorados.txt
# Edite grupos-monitorados.txt com os nomes dos grupos autorizados.
```

A lista real é ignorada pelo Git; somente o exemplo é versionado.

Depois execute:

```bash
tar -czf /tmp/airlert-whatsapp.tar.gz \
  package.json package-lock.json index.js whatsapp-client.js \
  page-bindings.js message-processor.js monitored-groups.js grupos-monitorados.txt deploy/oracle
scp -i /caminho/chave.key /tmp/airlert-whatsapp.tar.gz ubuntu@IP_PUBLICO:~/
ssh -i /caminho/chave.key ubuntu@IP_PUBLICO
```

Não copie `node_modules`, `sessions`, arquivos `.env` ou versões antigas do bot.
O arquivo de sessão será criado no servidor depois da leitura do QR code.

## Instalar na VM

Execute como `ubuntu`:

```bash
mkdir -p ~/whatsapp-bot
tar -xzf ~/airlert-whatsapp.tar.gz -C ~/whatsapp-bot
cd ~/whatsapp-bot
bash deploy/oracle/install-system.sh
bash deploy/oracle/setup-swap.sh
/usr/local/bin/npm ci --omit=dev
```

O instalador usa binários oficiais Node 22 com verificação SHA-256 e bibliotecas
Linux necessárias ao Chrome. `npm ci` baixa a versão do navegador compatível
com o Puppeteer do lockfile. Não execute `npm ci` com sudo: o navegador deve ser
instalado no cache do usuário `ubuntu`, o mesmo utilizado pelo serviço.
O script de swap não sobrescreve um arquivo existente e não cria outro swap se
já houver algum ativo. Swap usa disco e não substitui RAM.

Fontes: [Node.js](https://nodejs.org/dist/latest-v22.x/),
[dependências do Puppeteer](https://pptr.dev/troubleshooting).

## Vincular ao WhatsApp

Na mesma pasta, com o serviço ainda parado:

```bash
NODE_ENV=production WS_HOST=127.0.0.1 \
  NODE_OPTIONS=--max-old-space-size=256 /usr/local/bin/node index.js
```

No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho**.
Escaneie o último QR code exibido e aguarde a mensagem
`WhatsApp conectado e pronto para uso!`. Depois pressione **Ctrl+C** para
encerrar o processo manual antes de iniciar o serviço.

Mantenha a pasta `~/whatsapp-bot/sessions`: ela guarda o login. Não execute
processos manual e systemd simultaneamente usando essa mesma pasta.
Se ocorrer logout ou revogação da sessão, será necessário vincular novamente.
O limite de 256 MB afeta somente o heap do Node, não a memória do Chromium.

## Criar e iniciar o serviço

```bash
sudo install -d -m 755 /etc/airlert
sudo install -m 600 deploy/oracle/whatsapp.env.example /etc/airlert/whatsapp.env
sudo install -m 644 deploy/oracle/whatsapp-bot.service /etc/systemd/system/whatsapp-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-bot
sudo systemctl status whatsapp-bot --no-pager
```

O template contém `NODE_ENV=production`, então somente textos e imagens dos
grupos listados em `grupos-monitorados.txt` são encaminhados.
O bloqueio opcional de recursos do navegador fica desligado para preservar
o download das imagens.

A configuração usa `Restart=always`, intervalo de 20 segundos e limite de
reinícios para não repetir indefinidamente falhas rápidas. Parar pelo systemctl
não dispara reinício automático. [Referência systemd](https://www.freedesktop.org/software/systemd/man/255/systemd.service.html).

## Logs, consumo e manutenção

```bash
sudo journalctl -u whatsapp-bot -f -o cat
free -h
sudo systemctl show whatsapp-bot -p MemoryCurrent -p NRestarts
sudo systemctl restart whatsapp-bot
sudo systemctl stop whatsapp-bot
```

Para ver o QR code sem os prefixos de data, use `journalctl -o cat`. Os logs
podem conter dados de vinculação; não os compartilhe integralmente.
Para retomar após atingir o limite de reinícios, corrija o erro e execute:

```bash
sudo systemctl reset-failed whatsapp-bot
sudo systemctl start whatsapp-bot
```

Para atualizar: pare o serviço, envie/extraia o pacote, execute `npm ci --omit=dev`
como `ubuntu` e inicie o serviço novamente. Preserve `sessions` e sua lista `grupos-monitorados.txt` ao extrair atualizações. Não substitua o
arquivo de ambiente se tiver feito personalizações. Após mudar o arquivo
`.service`, execute `daemon-reload`; após mudar somente o `.env`, basta reiniciar.

## Conectar o backend ao bot

O bot não exige nenhuma porta pública além do SSH. O WebSocket escuta somente
em `127.0.0.1:3001`. Enquanto o backend estiver no seu computador, mantenha este
túnel aberto no computador:

```bash
ssh -i /caminho/chave.key -N \
  -L 3001:127.0.0.1:3001 ubuntu@IP_PUBLICO
```

Pare qualquer bot local que já ocupe a porta 3001. Configure no backend Java
`whatsapp.websocket.url=ws://127.0.0.1:3001` e `whatsapp.enabled=true`.
Também é possível usar as variáveis `WHATSAPP_WEBSOCKET_URL` e
`WHATSAPP_ENABLED` ao iniciar o backend. Esse túnel precisa continuar aberto
para o backend receber mensagens.

O bot encaminha mensagens em tempo real; **não há fila persistente nem reenvio**
quando o backend está desconectado. Para funcionamento contínuo, o backend e a
conexão com o bot também precisam permanecer disponíveis.

## Problemas comuns

- `Could not find Chrome`: execute `./node_modules/.bin/puppeteer browsers install chrome`
  como `ubuntu`, dentro de `~/whatsapp-bot`, e reinicie.
- Biblioteca Linux ausente: confira a mensagem do navegador e o resultado do
  instalador. Não é necessário instalar ambiente gráfico.
- `EADDRINUSE`: existe outro processo usando a porta 3001.
- Sessão/perfil em uso: pare o processo manual antes de iniciar systemd.
- Processo morto por falta de memória: confira `sudo journalctl -k -n 100` e
  `free -h`. Se houver swap constante ou reinícios frequentes, aumente a RAM.
- Conectado sem encaminhar: confirme o nome do grupo, mensagens recebidas de
  terceiros, backend conectado e túnel ativo. Mensagens da própria conta são ignoradas.

## Alterar os grupos monitorados

Edite `~/whatsapp-bot/grupos-monitorados.txt`, colocando um nome por linha:

```text
Mundo Plus #773
Outro grupo de viagens
```

A lista é carregada ao iniciar o bot, independentemente da pasta de execução.
Depois de editar, execute `sudo systemctl restart whatsapp-bot`.
Linhas vazias são ignoradas. Cada linha preenchida é um nome, sem sintaxe de comentários.
A comparação aceita nomes contendo o texto configurado, sem distinguir maiúsculas
ou espaços repetidos. O caractere # antes de números é opcional, preservando a
compatibilidade entre Mundo Plus 773 e Mundo Plus #773; 773 não corresponde a 7730.

Em produção, a lista filtra textos e imagens. Em desenvolvimento, textos de
outros grupos continuam passando; imagens usam a lista. Conversas privadas
continuam excluídas. Arquivo vazio não libera todos os grupos: nenhuma imagem
passa e, em produção, nenhum texto passa. Arquivo ausente impede a inicialização.
