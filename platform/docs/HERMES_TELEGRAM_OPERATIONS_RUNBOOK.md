# Hermes Telegram — operação diária (resumo matinal, vigia, backup)

Escopo: o bot privado `@grupoerick_bot` (Hermes, plano de execução). Maestro
continua sendo o plano de controle; nada aqui cria orquestrador, fila, banco
ou serviço novo. Complementa `HERMES_TELEGRAM_PRIVATE_PILOT.md`.

| Peça | Onde roda | O que faz |
| --- | --- | --- |
| Resumo matinal | dentro do bot (loop existente) | Uma mensagem por dia, sem IA, com fontes e atualidade |
| Atualidade nas respostas | dentro do bot | "Dados até DD/MM/AAAA" da fonte e, quando há loja, da própria loja |
| Isolamento de membros | dentro do bot | Membros leem dados operacionais; memória do dono não sai |
| Vigia | host, timer systemd a cada 2 min | Checa o bot e avisa o dono no Telegram; ping externo opcional (URL secreta em arquivo) |
| Backup | host, timer systemd diário | Cópia consistente e verificada do estado, retenção de 14 dias; cópia externa só criptografada |

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

- O dia é **reservado antes** de qualquer leitura ou envio, e cada
  destinatário é gravado **antes e depois** do próprio envio. Uma queda,
  reinício ou erro no meio nunca gera mensagem duplicada: cada pessoa recebe
  no máximo **uma tentativa por dia**, sem reenvio automático.
- Janela de 4 horas após o horário. Se o bot estiver fora do ar a manhã toda,
  o dia fica `missed` em vez de mandar "bom dia" à tarde.
- Seção indisponível (limite atingido, origem fora do ar) aparece como
  indisponível, nunca com número presumido.

Controle de entrega em `morning-brief.json`:

| Por destinatário (`deliveries`) | Significado |
| --- | --- |
| `pending` | ainda não tentado |
| `attempted` | envio em curso; se o bot cair aqui, vira `unknown` |
| `sent` | Telegram confirmou |
| `failed` | Telegram recusou (ex.: pessoa bloqueou o bot, limite 429) |
| `unknown` | tempo esgotado ou rede caiu: **pode ter chegado**, por isso não é reenviado |

| Status do dia | Quando |
| --- | --- |
| `claimed` / `sending` | reservado / enviando |
| `sent` | **todos** os destinatários confirmados |
| `partial` | parte confirmada, parte `failed`/`unknown` |
| `failed` | nenhum confirmado |
| `missed` | janela de 4 h perdida |

A auditoria registra só status e contagens (`recipients`, `sent`, `failed`,
`unknown`), nunca IDs nem o texto. O vigia mostra, por exemplo,
`morning_brief: não entregue a todos hoje (partial (1 enviado, 1 em dúvida))`.
Para reenviar a alguém, a pessoa pede `/prioridades` ou `/lotoia` no próprio
chat: o resumo não é reenviado em lote.

## 2. Origem e atualidade nas respostas

Toda resposta do analista e do agente com IA mostra, além da fonte, a linha
`Dados até DD/MM/AAAA (N dias atrás)`, calculada a partir do último dia
existente na fonte (não do período perguntado nem de data fixa no código).
Mais de 2 dias sem dado novo marca `⚠️ … fonte sem atualização recente`.
Quando a fonte não informa, a resposta diz "não informada" em vez de supor.
Compras e LotoIA continuam mostrando a data de referência da própria origem.

**Fonte × loja.** A fonte pode estar em dia enquanto uma loja parou de
enviar. Por isso, quando a pergunta cita uma loja, aparecem as duas datas:

```
Fonte geral: Dados até 08/06/2026 (ontem)
Loja MAGAZINE: ⚠️ Dados até 20/05/2026 (20 dias atrás): loja sem atualização recente — anterior à fonte (08/06/2026)
```

- A data da loja é o último dia dela na view inteira (`scope_last_day`,
  subconsulta somente leitura na mesma view), não o fim do período.
- Loja um dia atrás da fonte já recebe `⚠️ … anterior à fonte`; loja sem
  nenhum registro mostra `⚠️ Loja X: sem dados registrados na fonte`.
- No ranking de lojas, só as atrasadas levam a própria data
  (`• MAGAZINE: 10 (dados até 20/05/2026)`).
- O agente com IA repete essas linhas no rodapé; o `/vendas` antigo mostra
  `Último dia com registro neste filtro (loja X): DD/MM/AAAA`.

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

`node scripts/hermes-telegram-ops.js watchdog`, a cada 2 minutos (folga de
15 s), pelo `hermes-telegram-watchdog.timer`. Checagens:

| Checagem | Falha quando |
| --- | --- |
| `bot_heartbeat` | `heartbeat.json` com mais de 150 s (bot parado ou sem Telegram) |
| `health_N` | URL de `HERMES_WATCHDOG_HEALTH_URLS` não responde 200 |
| `codex_bridge` | socket da ponte Codex não responde (se configurado) |
| `disk` | menos de 10% livre na partição do estado |
| `backup` | último backup com mais de 26 h |
| `morning_brief` | depois de `HERMES_WATCHDOG_BRIEF_DEADLINE`, o resumo do dia não está `sent` para todos |
| `external_ping_config` | o arquivo secreto da URL do monitor externo está ilegível, fora de 0600 ou não é `https` |

Alertas vão para o Telegram do dono na **segunda** falha seguida (evita
alarme por oscilação), repetem a cada 6 h enquanto persistir e avisam a
recuperação. Se o Telegram estiver fora, o alerta é tentado de novo na rodada
seguinte.

**Promessa de alerta em até 10 minutos — a conta.** Pior caso, com o
intervalo de 2 min, a folga de 15 s e a regra de duas falhas seguidas:

| Falha | Conta | Pior caso |
| --- | --- | --- |
| Bot parado (heartbeat) | 150 s até o sinal envelhecer + 2 × (120 s + 15 s) | **7 min** |
| URL de saúde, ponte Codex, disco | 2 × (120 s + 15 s) | **4,5 min** |
| VPS inteira, timer parado | último ping + período 2 min + tolerância 5 min no serviço externo | **≈ 8 min** |

Somam-se poucos segundos de envio. A versão anterior (heartbeat 180 s,
timer de 5 min) chegava a ~13,5 min e não cumpria a promessa; um teste
automatizado lê a unidade e a configuração e falha se a conta passar de 10 min.
`backup` (26 h) e `morning_brief` (prazo do dia) seguem o próprio prazo.

**Monitor externo (VPS inteira fora do ar):** o vigia faz um GET numa URL de
"dead man's switch" (ex.: Healthchecks.io) só quando tudo está saudável; o
serviço avisa por e-mail quando os pings param, o que cobre VPS desligada,
timer parado ou Telegram inacessível. Configure o check com **período 2 min e
tolerância 5 min**. Opcionalmente, um monitor HTTP externo (ex.: UptimeRobot)
em `https://hermes-staging.grupoerick.tech/health`.

**A URL do ping é segredo** (quem a tem consegue dizer "está tudo bem" no
lugar do vigia e esconder uma queda):

- fica só no arquivo `~/.hermes-telegram/secret/watchdog-ping-url`, modo
  0600, lido a cada rodada sem seguir links; o `ops.env` aponta apenas o
  caminho (`HERMES_WATCHDOG_PING_URL_FILE`);
- `HERMES_WATCHDOG_PING_URL` no ambiente faz o vigia **recusar iniciar**
  (`ops_ping_url_must_be_secret_file`): a URL nunca vai para `ops.env`,
  `systemctl show`, `journalctl` ou histórico do shell;
- a URL nunca aparece em log, alerta ou estado do vigia; arquivo ilegível,
  com outra permissão ou sem `https` vira a falha `external_ping_config` e o
  ping não é feito (falha fechada);
- gravar sem eco: `read -rs -p 'URL do ping: ' U; echo; install -m 600 /dev/null
  ~/.hermes-telegram/secret/watchdog-ping-url; printf '%s' "$U" >
  ~/.hermes-telegram/secret/watchdog-ping-url; unset U`;
- vazou? gerar nova URL no serviço (Healthchecks: *Regenerate ping URL*) e
  regravar o arquivo.

## 5. Backup e restauração

`node scripts/hermes-telegram-ops.js backup`, diário às 03:17 de Recife, pelo
`hermes-telegram-backup.timer`.

- Copia todos os arquivos regulares do estado do bot (`owner.json`,
  `members.json`, decisões, memórias, caches, contadores, `audit.jsonl`),
  ignorando temporários com ponto, links e subpastas. O token do bot e a URL
  do ping ficam em `secret/` e **não** entram no backup.
- Formato: JSON compactado (`hermes-telegram-state-AAAAMMDDTHHMMSSZ.json.gz`)
  com SHA-256 de cada arquivo, modo 0600, pasta 0700, verificado após gravar.
- Retenção de 14 dias (`HERMES_BACKUP_RETENTION_DAYS`), sempre mantendo os 3
  mais recentes. Cópia opcional em `HERMES_BACKUP_COPY_DIR` (outro disco
  **local** ou volume montado; inclua também em `ReadWritePaths` da unidade).

**Consistência com o bot ligado.** O bot grava cada JSON por arquivo
temporário + renomeação, então cada leitura vê um arquivo inteiro. O backup lê
a pasta **duas vezes** e só aceita se as duas leituras forem idênticas (até 3
tentativas; senão `backup_state_unstable`). O `audit.jsonl`, que só cresce, é
cortado na última linha completa. Antes de gravar, todo `.json` precisa ser
JSON válido e os arquivos críticos passam pela validação do próprio bot:
`owner.json` (ID inteiro), `members.json` (até 3, sem repetir, sem o dono),
`offset.json`, `owner-decisions.json` e `morning-brief.json`. Estado inválido
**não** vira ponto de restauração (`backup_state_invalid`, com os nomes dos
arquivos); o vigia acusa backup atrasado no dia seguinte.

### Restauração

Ela devolve **dados**, nunca **acesso**, e só roda com o bot comprovadamente
parado.

| Arquivo no backup | O que a restauração faz |
| --- | --- |
| `members.json`, `pairing.json` | **nunca** restaura: membro removido não volta, convite antigo não revive |
| `owner.json` | mantém o dono atual; só grava numa pasta **sem dono** e com `--restore-owner` |
| `history-analyst-context-<ID>.json` | só para quem ainda é membro |
| `offset.json`, `morning-brief.json`, contadores diários (`*-budget.json`, `auto-memory-day.json`, `ai-finops-daily.json`) | mantém o atual quando existe: cota gasta não é reposta e o resumo do dia não é reenviado |
| `heartbeat.json` | nunca restaura |
| decisões, memórias, caches, `audit.jsonl`, demais | restaura |

Prova de que o bot parou (as duas, nesta ordem):

1. `docker ps` (sem shell) não pode listar contêiner com o prefixo
   `HERMES_TELEGRAM_CONTAINER_PREFIX` (padrão `hermes-telegram-private-`).
   Se o Docker não responder: `restore_runtime_unverifiable`.
2. O `heartbeat.json` do destino não pode mudar durante **150 s** (o mesmo
   limite do vigia). Heartbeat antigo sozinho **não** prova nada: um bot sem
   Telegram para de bater e continua vivo; por isso o passo 1 vem antes.

`--no-docker-check` só para bot fora do Docker; a espera de 150 s continua.
Recusa não grava nada.

```bash
docker stop hermes-telegram-private-v1                      # 1. parar o bot
cd /home/hermesadmin/hermes-ops/platform/services/api
node scripts/hermes-telegram-ops.js verify ~/.hermes-telegram/backups/<arquivo>   # 2. conferir
node scripts/hermes-telegram-ops.js restore ~/.hermes-telegram/backups/<arquivo> \
  ~/.hermes-telegram/state                                  # 3. restaurar (~2,5 min)
docker start hermes-telegram-private-v1                     # 4. subir e testar /ajuda
```

A saída lista `skipped_access_files`, `current_ledgers_kept`, `owner`
(`kept_current`, `restored` ou `not_restored`) e `members_kept`.

**VPS nova (pasta de estado vazia):** use `--restore-owner` para reaver o
dono; depois o dono envia `/convidar` para cada membro que deve continuar.
Isso é proposital: quem foi removido depois do backup não volta sozinho.

### Cópia externa criptografada

O backup contém Telegram IDs do dono e dos membros, decisões do dono, memória
curada e resumos de Compras/LotoIA (dados empresariais). Não contém token,
credencial de máquina, URL do ping nem itens do Hermes Brain (que ficam no
Supabase). Mesmo assim, **nenhuma cópia sai da VPS sem criptografia**:

1. No computador do dono (fora da VPS): `age-keygen -o hermes-backup.key`.
   A chave privada fica **offline** (gerenciador de senhas ou pendrive), nunca
   na VPS, no GitHub ou em chat. A linha `age1…` impressa é a chave pública.
2. Na VPS, guardar só a chave pública (não é segredo):
   `printf '%s\n' 'age1…' > ~/.hermes-telegram/backup-recipient.txt`.
3. Depois do backup diário, a frente de infraestrutura cifra o mais novo e
   envia **apenas** o `.age` para o destino externo escolhido (outro servidor,
   bucket), com o próprio agendador:

   ```bash
   f=$(ls -1t ~/.hermes-telegram/backups/hermes-telegram-state-*.json.gz | head -1)
   age -R ~/.hermes-telegram/backup-recipient.txt -o "/tmp/$(basename "$f").age" "$f"
   # enviar /tmp/<arquivo>.age ao destino externo e apagar o temporário
   ```

4. Restaurar de fora: num computador confiável,
   `age -d -i hermes-backup.key -o x.json.gz x.json.gz.age`, copiar para a
   VPS, `verify` e `restore` como acima.

Regras: `HERMES_BACKUP_COPY_DIR` nunca aponta para pasta sincronizada com
nuvem (Dropbox, Drive, OneDrive) em texto claro; o destino externo só vê
arquivo cifrado com nome de data; a credencial de envio do destino (se houver)
fica em arquivo 0600 próprio, nunca em `ops.env`; perder a chave privada torna
as cópias externas ilegíveis (guarde duas cópias offline).

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

`~/.hermes-telegram/ops.env` (sem segredos; token e URL do ping são lidos dos arquivos em `secret/`):

```bash
HERMES_TELEGRAM_STATE_DIR=/home/hermesadmin/.hermes-telegram/state
HERMES_TELEGRAM_TOKEN_FILE=/home/hermesadmin/.hermes-telegram/secret/token
HERMES_WATCHDOG_STATE_DIR=/home/hermesadmin/.hermes-telegram/watchdog
HERMES_BACKUP_DIR=/home/hermesadmin/.hermes-telegram/backups
HERMES_WATCHDOG_HEALTH_URLS=https://hermes-staging.grupoerick.tech/health
HERMES_WATCHDOG_BRIEF_DEADLINE=09:30
HERMES_WATCHDOG_CODEX_SOCKET=/home/hermesadmin/.hermes-codex/bridge/bridge.sock
HERMES_WATCHDOG_PING_URL_FILE=/home/hermesadmin/.hermes-telegram/secret/watchdog-ping-url
# HERMES_TELEGRAM_CONTAINER_PREFIX=hermes-telegram-private-   (padrão)
```

A URL do ping vai no arquivo secreto (seção 4), nunca neste arquivo.

Rollback: `sudo systemctl disable --now hermes-telegram-watchdog.timer hermes-telegram-backup.timer`.

## 7. Critérios de aceite

- [ ] Às 07:30 de Recife chega **uma** mensagem "☀️ Bom dia — resumo Hermes"
      com `Dados até …`, fila de Compras e LotoIA, cada uma com sua fonte;
      reiniciar o bot depois disso não gera segunda mensagem.
- [ ] `morning-brief.json` do dia mostra `deliveries` por destinatário e
      status `sent`; com um membro que bloqueou o bot, `partial` sem reenvio.
- [ ] Uma pergunta de vendas (ex.: "quanto vendemos em março de 2026?")
      mostra `Dados até 08/06/2026 (… dias atrás)` enquanto não houver dado novo;
      com loja ("quanto a loja MAGAZINE vendeu em maio de 2026?") aparece
      também a linha `Loja MAGAZINE: …`.
- [ ] Um membro recebe recusa em `/cerebro` e `/memorias`; em `/diagnostico`
      vê "visível somente ao dono".
- [ ] `docker stop` do bot gera alerta no Telegram em até 10 minutos (pior
      caso calculado: 7 min) e o aviso de recuperação após `docker start`.
- [ ] `grep PING ~/.hermes-telegram/ops.env` mostra só a linha
      `HERMES_WATCHDOG_PING_URL_FILE=…`; `journalctl -u hermes-telegram-watchdog`
      não contém a URL.
- [ ] Com o ping configurado (período 2 min, tolerância 5 min), pausar o timer
      do vigia por 10 minutos dispara o e-mail do serviço externo.
- [ ] Existe um backup do dia; `verify` passa; `restore` com o bot ligado é
      recusado (`restore_bot_running`); numa pasta de teste vazia
      (`install -d -m 700 /tmp/teste-restore`), `restore --restore-owner
      --no-docker-check` grava `owner.json` e **não** grava `members.json`.
- [ ] A cópia externa existe só como `.age` e abre com a chave offline.
