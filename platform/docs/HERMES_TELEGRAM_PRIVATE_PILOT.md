# Hermes Telegram Privado — Primeiro Canal Conversável (staging)

> Estado inicial: código e testes. O canal **não está ativado** até o operador criar um bot oficial, instalar o token **somente na VPS** e vincular a própria conta privada.

## O que entrega

Bot privado de **somente leitura**, usando Telegram Bot API por `getUpdates` com *long polling* outbound da VPS, sem nova rota HTTP pública, sem webhook Telegram e sem agente adicional. Cada mensagem é processada por um mapa fechado de intenções:
- `/status`: consulta a saúde do staging, sem consumir cota de indicadores;
- `/compras` ou "resumo das compras": consulta **uma vez** o `/internal/commercial-read-pilot/brief` do Hermes;
- `/lotoia` ou "situação do LotoIA": consulta **uma vez** o `/internal/lotoia-read-pilot/health` do Hermes;
- `/ajuda`: explica os comandos e limites, sem consulta ao backend.

Não há interpretação livre de comandos, escrita operacional, disparo a funcionários, pagamento, apostas, consulta irrestrita de conversas nem segundo cérebro nesta entrega. As respostas exibem data, fonte e prefixo de trace da auditoria real e deixam clara a falta de conciliação com o ERP e de lançamentos no LotoIA.

## Restrição de identidade e acesso

Somente mensagens de **chat privado** com `from.id === chat.id`, **não encaminhadas** e enviadas por usuário não-bot podem acessar as rotas; nenhum grupo ou canal. A primeira pessoa autorizada vincula seu Telegram com `/vincular CÓDIGO`, usando um código aleatório de 12 caracteres gerado **localmente na VPS**, válido por 15 minutos, hash SHA-256 salvo mode0600 e máximo de 5 erros. A identidade autorizada é imutável para o runtime: mudança de proprietário exige procedimento administrativo explícito; nunca aceitar proprietário por texto livre.

O token oficial do bot é secreto e não pode ser enviado por chat, issue, commit ou log. Guardar somente no arquivo protegido `/home/hermesadmin/.hermes-telegram/secret/token` mode0600 e montar read-only no contêiner. O bearer machine existente do Hermes também é montado read-only, nunca impresso, compartilhado ou copiado para o bot Telegram. Usar uma pasta de estado mode0700 com `owner.json`, `pairing.json`, `offset.json`, `audit.jsonl` mode0600.

O canal é fail-closed sem `HERMES_TELEGRAM_ENABLED=true`, `HERMES_DEPLOYMENT_STAGE=staging`, execução desativada, kill switch habilitado, ingresso de missões desativado, token válido e arquivos protegidos. O polling nunca recupera conversas de terceiros; recebe apenas novas mensagens ao próprio bot. O ledger escreve apenas update IDs e intenções aprovadas, **nunca o texto bruto**. O cursor de update é persistido **antes** da consulta de leitura: uma falha na entrega da resposta do Telegram não repete automaticamente a consulta nem consome a cota duas vezes. Uma resposta perdida pode ser solicitada de novo pelo usuário.

## Provisionamento simplificado (preferencial)

No Web Console da VPS como `hermesadmin`, depois de atualizar a cópia de trabalho para o commit aprovado no CI, execute:

```bash
bash platform/services/api/scripts/hermes-telegram-provision.sh
```

O script solicita o token **somente no terminal com eco desativado**, instala no arquivo protegido do contrato oficial, e gera um código de vínculo de 15 minutos usando o gerador já existente. Não cole o token/código em chats, GitHub, logs ou comandos de processo. O serviço continuará inativo até a implantação do polling, com identidade de máquina e flags fail-closed.

## Operação de ativação (depende de ação humana)

1. **Criar bot:** no Telegram, abrir `@BotFather` oficial e executar `/newbot`. Escolher nome e username. O BotFather fornecerá um token. **Não colar o token nesta conversa.** [Guia oficial](https://core.telegram.org/bots/tutorial).
2. **Na VPS autenticada** `srv1908789`, usuário `hermesadmin`, via console SSH seguro: `umask 077`; criar pastas `~/.hermes-telegram/secret` e `~/.hermes-telegram/state` mode0700; usar entrada de terminal silenciosa, por exemplo `read -rs -p 'Token do BotFather: ' TG_TOKEN; echo; printf '%s' "$TG_TOKEN" > ~/.hermes-telegram/secret/token; chmod 600 ~/.hermes-telegram/secret/token; unset TG_TOKEN`. **Não usar parâmetros de shell, variável de ambiente persistente, logs nem URL contendo o token.**
3. Iniciar o contêiner exclusivo de polling com código do **HEAD aprovado**, processo Node `scripts/run-hermes-telegram-private.js`, uid1000, rootfs read-only, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--restart unless-stopped` e `--network host`. Montar o token e a credencial machine separadamente em read-only e o estado sob `/var/lib/hermes-telegram` com leitura/gravação. **Um único poller por token.**
4. Gerar o código pelo comando `node platform/services/api/scripts/hermes-telegram-pair.js` **executado na VPS**, não no chat; enviar pelo Telegram privado ao bot `/vincular CODIGO`. A mensagem de confirmação ocorre após persistir o proprietário. Jamais colocar o código de vínculo em repositório.
5. Enviar `/status`, `/lotoia`, `/compras`; confirmar entrega de respostas verdadeiras, origem, trace, eventos de auditoria Hermes, persistência de cursor, negativa a contas/grupos não autorizados e recusa de comandos de escrita. **Somente então registrar o canal como operacional**. Não ativar produção financeira.

## Limites existentes

O leitor Hermes em staging compartilha **12 tentativas por 24 horas** com GitHub, economia, Compras e LotoIA. A primeira versão do bot *não* contorna esse orçamento nem tenta consultas repetitivas para evitar limites. Durante o piloto, as mensagens comerciais podem retornar limite atingido. Para escalonar uso diário, será necessária uma decisão explícita sobre quota, cache seguro e concorrência, com auditoria.

## Segundo cérebro — próximo marco, não presumir implementado

O contrato `SECOND_BRAIN_INBOX_CONTRACT.md` atualmente é declarativo. ChatGPT e Claude requerem importação autorizada de exportações; histórico pessoal de WhatsApp não pode ser tratado como automaticamente acessível pela API do WhatsApp Business. Ingestão real precisa de armazenamento e busca, segregação de contexto pessoal/empresarial, controle por pessoa, retenção, revogação de consentimento e origem citável. **Não confundir o canal conversável com segundo cérebro pronto.**

## Endurecimento adicional da autorização do bot

O processo valida o token pelo método getMe e confirma que o username é **@Grupoerick_bot**; também verifica getWebhookInfo e falha se houver webhook ativo, sem removê-lo automaticamente. A conexão não deve ser declarada operacional até uma mensagem real ser respondida no Telegram.
