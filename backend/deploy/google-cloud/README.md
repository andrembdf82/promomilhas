# Bot WhatsApp no Google Cloud e backend na Oracle

VM do bot: Ubuntu 26.04 x86_64, usuário `andremarquesdf`, IP `136.72.12.220`.
Backend: `ubuntu@144.22.131.138`, serviço `airlert-backend`.

O bot escuta somente em `127.0.0.1:3001`. Na Oracle, o serviço
`airlert-whatsapp-tunnel` abre a mesma porta local e a encaminha por SSH para o
Google Cloud. Não é necessário liberar a porta 3001 no firewall público.
Se o IP externo mudar, atualize o destino no serviço do túnel e valide a chave
do host. Para estabilidade, reserve o endereço externo no Google Cloud.

## Instalação do bot

Cadastre a chave pública de administração em **Editar VM → Chaves SSH**.
Chaves adicionadas apenas em `~/.ssh/authorized_keys` podem ser sobrescritas pelo
agente do Google. O usuário precisa de sudo para instalar os componentes.

Copie os arquivos ativos de `backend`, incluindo `package-lock.json`,
`grupos-monitorados.txt`, `self-chat.js`, `media-download.js`, `offer-sender.js` e `deploy`.
Não copie sessões, credenciais ou `node_modules` do computador.

Na VM, dentro de `~/whatsapp-bot`:

```bash
bash deploy/oracle/setup-swap.sh
bash deploy/google-cloud/install-system.sh
npm ci --omit=dev
sudo install -d -m 755 /etc/airlert
# Em instalação nova; preserve o arquivo existente durante atualizações.
sudo install -m 600 deploy/oracle/whatsapp.env.example /etc/airlert/whatsapp.env
sudo install -m 644 deploy/google-cloud/whatsapp-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-bot
sudo journalctl -u whatsapp-bot -n 60 -f -o cat
```

A swap tem 2 GiB e é persistida no `/etc/fstab`. O instalador não substitui swap
existente. Node 22 é instalado a partir do binário oficial com checksum validado.
O Puppeteer baixa seu navegador durante `npm ci`, sob o mesmo usuário do serviço.

No WhatsApp, abra **Aparelhos conectados → Conectar aparelho** e escaneie o QR mais
recente dos logs. Aguarde `WhatsApp conectado e pronto para uso!`. Preserve
`~/whatsapp-bot/sessions` nas atualizações. Não rode dois bots com a mesma pasta.

## Túnel da Oracle

Gere a chave dedicada **na Oracle**, sem copiar sua chave privada para outras
máquinas. O serviço espera `/home/ubuntu/.ssh/airlert-whatsapp-google`.
Salve a chave pública do host Google previamente verificada em
`/home/ubuntu/.ssh/airlert-whatsapp-google-known-hosts`.

No Google, crie o usuário de sistema `airlert-tunnel`, sem acesso a shell, e
instale `60-airlert-tunnel.conf` em `/etc/ssh/sshd_config.d/`.
Grave a chave pública da Oracle em `/etc/airlert/tunnel_authorized_keys`, com
proprietário root e modo 644. Use o prefixo de restrições:

```text
restrict,port-forwarding,permitopen="127.0.0.1:3001",permitopen="127.0.0.1:3002" ssh-ed25519 CHAVE_PUBLICA comentario
```

Valide com `sudo sshd -t` antes de `sudo systemctl reload ssh`. A configuração
permite apenas encaminhamento local para a porta do bot, sem terminal, shell,
agente ou X11. O arquivo de chaves dedicado não depende dos metadados do Google.

Na Oracle:

```bash
sudo install -m 644 airlert-whatsapp-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now airlert-whatsapp-tunnel
```

Faça backup do JAR e de `/etc/airlert/backend.env` antes de alterar o backend.
Nesse arquivo, configure `WHATSAPP_ENABLED=true` e
`WHATSAPP_WEBSOCKET_URL=ws://127.0.0.1:3001`, depois reinicie `airlert-backend`.
Interpretar imagens exige também `OPENAI_API_KEY` no ambiente do Java; ela não
pertence ao bot e não deve entrar no repositório.

## Verificação

Google:

```bash
sudo systemctl status whatsapp-bot --no-pager
sudo journalctl -u whatsapp-bot -n 60 -o cat
sudo systemctl show whatsapp-bot -p MemoryCurrent -p NRestarts
free -h
```

Oracle:

```bash
sudo systemctl status airlert-whatsapp-tunnel --no-pager
sudo journalctl -u airlert-backend -n 60 -o cat
ss -ltn '( sport = :3001 )'
```

Em produção só passam mensagens recebidas dos grupos do arquivo
`grupos-monitorados.txt`. Mensagens próprias ficam desativadas por padrão.
Não há fila persistente no bot: mensagens durante desconexões não são reenviadas.
Enquanto o bot está ativo, o processamento é sequencial por conversa: o texto
aguarda o download das imagens anteriores, preservando a ordem esperada pelo
Java (imagem de ida, imagem de volta, texto com o programa de milhas).

## Teste temporário no grupo “Para mim” em produção

Para liberar somente mensagens próprias de um grupo específico, mantenha
`NODE_ENV=production` e configure em `/etc/airlert/whatsapp.env`:

```ini
WHATSAPP_ALLOW_TEST_GROUP_IN_PRODUCTION=1
WHATSAPP_TEST_GROUP_ID=IDENTIFICADOR_DO_GRUPO@g.us
WHATSAPP_SELF_CHAT_NAME=Mundo Plus #773
```

Reinicie `whatsapp-bot`. A exceção aceita textos e imagens apenas do ID exato
informado e não libera conversas privadas, mensagens próprias em outros grupos
ou textos recebidos de grupos não monitorados. O nome enviado ao Java permite
usar o fluxo real de promoções e pode gerar registros e alertas reais.
Para encerrar os testes, altere `WHATSAPP_ALLOW_TEST_GROUP_IN_PRODUCTION=0` e
reinicie o serviço. A opção `WHATSAPP_SELF_CHAT_TEST` continua bloqueada em produção.

Referências: [Puppeteer](https://pptr.dev/troubleshooting),
[chaves SSH no Google Cloud](https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys).

## Envio de ofertas para os usuários

O endpoint de saída usa `127.0.0.1:3002`, protegido por segredo compartilhado.
O serviço de túnel deste diretório encaminha também a porta 3002. Em instalações
existentes, atualize o unit do túnel, `60-airlert-tunnel.conf` **e** os `permitopen`
da chave autorizada para incluir as duas portas; valide com `sshd -t`, recarregue
SSH e reinicie o túnel. As portas 3001 e 3002 continuam fechadas ao público.

Configure `WHATSAPP_SEND_SECRET` no ambiente do bot e o mesmo valor em
`AIRLERT_WHATSAPP_SECRET` no backend Oracle. No backend, use
`AIRLERT_WHATSAPP_URL=http://127.0.0.1:3002/ofertas`.
Veja o [contrato e fluxo de entrega](../../../../service-airlert/README.md#envio-de-ofertas-pelo-whatsapp).
