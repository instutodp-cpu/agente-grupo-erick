# Hermes Telegram — operação diária (resumo matinal, vigia, backup)

Escopo: o bot privado `@grupoerick_bot` (Hermes, plano de execução). Maestro
continua sendo o plano de controle; nada aqui cria orquestrador, fila, banco
ou serviço novo. Complementa `HERMES_TELEGRAM_PRIVATE_PILOT.md`.

| Peça | Onde roda | O que faz |
| --- | --- | --- |
| Resumo matinal | dentro do bot (loop existente) | Uma mensagem por dia, sem IA, com fontes e atualidade |
| Atualidade nas respostas | dentro do bot | "Dados até DD/MM/AAAA (N dias atrás)" vindo da própria fonte |
| Isolamento de membros | dentro do bot | Membros leem dados operacionais; memória do dono não sai |
| Vigia | host, timer systemd a cada 5 min | Checa o bot e avisa o dono no Telegram; ping externo opcional |
| Backup | host, timer systemd diário | Cópia verificada do estado do bot, retenção de 14 dias |

Nenhuma peça grava em banco de produção, chama LLM ou executa ação de negócio.

---

## 1. Resumo matinal

Enviado pelo próprio processo do bot, uma vez por dia, no horário de Recife.

| Variável (no `docker run` do bot) | Padrão | Valores |
| --- | --- | --- |
| `HERMES_MORNING_BRIEF_ENABLED` | `false` | `true` liga |
| `HERMES_MORNING_BRIEF_TIME` | `07:30` | `HH:MM` |
| `HERMES_MORNING_BRIEF_TIMEZONE` | `America/Recife` | fuso IANA |
| `HERMES_MORNING_BRIEF_RECIPIENTS` | `owner` | `owner` ou `owner_and_members` |
| `HERMES_MORNING_BRIEF_SECTIONS` | `freshness,prioridades,lotoia` | subconjunto, sem repetir |

Valor inválido impede o bot de iniciar (falha fechada).

Seções, todas determinísticas e com a fonte da própria resposta:

- **freshness**: até quando vai o histórico de vendas
  (`hermes_history.monthly_commercial_2025_2026_v1`, `MAX(last_day)` da view
  inteira). Gasta 1 consulta do limite diário de histórico.
- **prioridades**: fila financeira por vencimento (Compras homologação), a
  mesma resposta de `/prioridades`. Gasta 1 leitura do leitor Hermes.
- **lotoia**: a mesma resposta de `/lotoia`. Gasta 1 leitura do leitor Hermes.

Regras:

- O dia é **reservado antes** de qualquer leitura ou envio: uma queda no meio
  nunca gera mensagem duplicada.
- Janela de 4 horas após o horário. Se o bot estiver fora do ar a manhã toda,
  o dia fica `missed` em vez de mandar "bom dia" à tarde.
- Seção indisponível (limite atingido, origem fora do ar) aparece como
  indisponível, nunca com número presumido.
- Estado em `morning-brief.json` (`claimed`, `sent`, `failed` ou `missed`); a
  auditoria registra só status e contagens.

## 2. Origem e atualidade nas respostas

Toda resposta do analista e do agente com IA mostra, além da fonte, a linha
`Dados até DD/MM/AAAA (N dias atrás)`, calculada a partir do último dia
existente na fonte (não do período perguntado nem de data fixa no código).
Mais de 2 dias sem dado novo marca `⚠️ … fonte sem atualização recente`.
Quando a fonte não informa, a resposta diz "não informada" em vez de supor.
Compras e LotoIA continuam mostrando a data de referência da própria origem.

## 3. Permissões de membros e isolamento de memória

| Recurso | Dono | Membro |
| --- | --- | --- |
| Vendas, cancelamentos, produtos, compras, prioridades, LotoIA, `/economia` | sim | sim |
| `/diagnostico`, `/alertas historicos` | sim | sim, sem as decisões do dono ("visível somente ao dono") |
| Agente com IA | sim, com decisões, memória automática e cérebro | sim, **sem** decisões, memória automática, cérebro ou fallback de memória |
| `/cerebro` (itens `owner_only` do Hermes Brain: memória pessoal) | sim | **não** |
| `/memorias` (curada a partir das decisões do dono) | sim | **não** |
| `/decisao`, `/decisoes`, `/convidar`, `/membros`, `/remover` | sim | não |

Memória empresarial compartilhada entre pessoas pertence ao Hermes Brain
multiempresa (`hermes_brain.memberships`, visibilidade `tenant_shared` ou
`scoped`), não a este bot. O bot só lê itens `owner_only` e só para o dono.

## 4. Vigia (monitoramento e alertas)

`node scripts/hermes-telegram-ops.js watchdog`, a cada 5 minutos, pelo
`hermes-telegram-watchdog.timer`. Checagens:

| Checagem | Falha quando |
| --- | --- |
| `bot_heartbeat` | `heartbeat.json` com mais de 180 s (bot parado ou sem Telegram) |
| `health_N` | URL de `HERMES_WATCHDOG_HEALTH_URLS` não responde 200 |
| `codex_bridge` | socket da ponte Codex não responde (se configurado) |
| `disk` | menos de 10% livre na partição do estado |
| `backup` | último backup com mais de 26 h |
| `morning_brief` | depois de `HERMES_WATCHDOG_BRIEF_DEADLINE`, o resumo do dia não está `sent` |

Alertas vão para o Telegram do dono na **segunda** falha seguida (evita
alarme por oscilação), repetem a cada 6 h enquanto persistir e avisam a
recuperação. Se o Telegram estiver fora, o alerta é tentado de novo na rodada
seguinte.

**Monitor externo (VPS inteira fora do ar):** com
`HERMES_WATCHDOG_PING_URL`, o vigia faz um GET nessa URL só quando tudo está
saudável. Um serviço de "dead man's switch" (ex.: Healthchecks.io, período 10
min, tolerância 10 min) avisa por e-mail quando os pings param, o que cobre
VPS desligada, timer parado ou Telegram inacessível. Opcionalmente, um monitor
HTTP externo (ex.: UptimeRobot) em `https://hermes-staging.grupoerick.tech/health`.

## 5. Backup e restauração

`node scripts/hermes-telegram-ops.js backup`, diário às 03:17 de Recife, pelo
`hermes-telegram-backup.timer`.

- Copia todos os arquivos regulares do estado do bot (`owner.json`,
  `members.json`, decisões, memórias, caches, contadores, `audit.jsonl`),
  ignorando temporários com ponto, links e subpastas. O token do bot fica em
  `secret/` e **não** entra no backup.
- Formato: JSON compactado (`hermes-telegram-state-AAAAMMDDTHHMMSSZ.json.gz`)
  com SHA-256 de cada arquivo, modo 0600, pasta 0700, verificado após gravar.
- Retenção de 14 dias (`HERMES_BACKUP_RETENTION_DAYS`), sempre mantendo os 3
  mais recentes. Cópia opcional em `HERMES_BACKUP_COPY_DIR` (outro disco ou
  volume montado; inclua também em `ReadWritePaths` da unidade).

Restauração:

```bash
docker stop hermes-telegram-private-v1                      # 1. parar o bot
cd /home/hermesadmin/hermes-ops/platform/services/api
node scripts/hermes-telegram-ops.js verify ~/.hermes-telegram/backups/<arquivo>   # 2. conferir
node scripts/hermes-telegram-ops.js restore ~/.hermes-telegram/backups/<arquivo> \
  ~/.hermes-telegram/state                                  # 3. restaurar
docker start hermes-telegram-private-v1                     # 4. subir e testar /ajuda
```

A restauração recusa rodar se o heartbeat tiver menos de 2 minutos (bot
provavelmente ativo); `--force` só depois de confirmar que o bot parou. Ela
regrava apenas os arquivos do backup e informa quantos arquivos extras ficaram
na pasta, sem apagá-los.

---

## 6. Implantação (frente de infraestrutura)

Pré-requisitos: Node 22 no host (`/usr/bin/node`), usuário `hermesadmin`,
commit revisado e mergeado.

**Bot (resumo, atualidade, membros):**

1. Gerar a imagem a partir do commit mergeado, como nos deploys atuais.
2. No gate de importação do deploy, incluir
   `require("/app/src/runtime/hermes-morning-brief")` e
   `require("/app/src/runtime/hermes-data-freshness")`.
3. Acrescentar ao `docker run` do bot:
   `-e HERMES_MORNING_BRIEF_ENABLED=true` (e, se quiser,
   `-e HERMES_MORNING_BRIEF_RECIPIENTS=owner_and_members`).
4. Subir, confirmar `healthy` e responder `/ajuda`.
5. Rollback: o script de deploy usado mantém o contêiner anterior parado;
   ou desligar só o resumo com `HERMES_MORNING_BRIEF_ENABLED=false`.

**Vigia e backup (host):**

```bash
git clone <repo> /home/hermesadmin/hermes-ops && cd /home/hermesadmin/hermes-ops
git checkout <commit-mergeado>                                # checkout limpo e fixo
install -d -m 700 ~/.hermes-telegram/watchdog ~/.hermes-telegram/backups
install -m 600 /dev/null ~/.hermes-telegram/ops.env           # preencher abaixo
sudo cp platform/services/api/deploy/systemd/hermes-telegram-{watchdog,backup}.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start hermes-telegram-backup.service           # primeiro backup
sudo systemctl enable --now hermes-telegram-watchdog.timer hermes-telegram-backup.timer
journalctl -u hermes-telegram-watchdog.service -n 5           # deve mostrar healthy:true
```

`~/.hermes-telegram/ops.env` (sem segredos; o token é lido do arquivo):

```bash
HERMES_TELEGRAM_STATE_DIR=/home/hermesadmin/.hermes-telegram/state
HERMES_TELEGRAM_TOKEN_FILE=/home/hermesadmin/.hermes-telegram/secret/token
HERMES_WATCHDOG_STATE_DIR=/home/hermesadmin/.hermes-telegram/watchdog
HERMES_BACKUP_DIR=/home/hermesadmin/.hermes-telegram/backups
HERMES_WATCHDOG_HEALTH_URLS=https://hermes-staging.grupoerick.tech/health
HERMES_WATCHDOG_BRIEF_DEADLINE=09:30
HERMES_WATCHDOG_CODEX_SOCKET=/home/hermesadmin/.hermes-codex/bridge/bridge.sock
HERMES_WATCHDOG_PING_URL=https://hc-ping.com/<uuid-do-check>
```

Rollback: `sudo systemctl disable --now hermes-telegram-watchdog.timer hermes-telegram-backup.timer`.

## 7. Critérios de aceite

- [ ] Às 07:30 de Recife chega **uma** mensagem "☀️ Bom dia — resumo Hermes"
      com `Dados até …`, fila de Compras e LotoIA, cada uma com sua fonte;
      reiniciar o bot depois disso não gera segunda mensagem.
- [ ] Uma pergunta de vendas (ex.: "quanto vendemos em março de 2026?")
      mostra `Dados até 08/06/2026 (… dias atrás)` enquanto não houver dado novo.
- [ ] Um membro recebe recusa em `/cerebro` e `/memorias`; em `/diagnostico`
      vê "visível somente ao dono".
- [ ] `docker stop` do bot gera alerta no Telegram em até 10 minutos e o
      aviso de recuperação após `docker start`.
- [ ] Com o ping configurado, pausar o timer do vigia por 20 minutos dispara
      o e-mail do serviço externo.
- [ ] Existe um backup do dia; `verify` passa; uma restauração numa pasta de
      teste (`install -d -m 700 /tmp/teste-restore`) reproduz `owner.json` e
      `members.json`.
