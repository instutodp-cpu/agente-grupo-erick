# Auditoria Hermes — o que falta para uso diário

Data: 2026-11-18 · Base: `main` em `a025b51` (PR #578)

Escopo: código do repositório inteiro, testes locais, CI do GitHub, PRs abertas
e o projeto Supabase acessível nesta sessão. A VPS e o projeto Supabase de
produção (`yxmdrrwqxwzsdgcgskrm`) **não** estavam acessíveis daqui; o que
depende deles está marcado como *não verificado*, com comandos para você
conferir (seções 7 e 8).

Legenda: **observado** = conferi no código, nos testes ou na API ·
**declarado** = só os docs afirmam · **não verificado** = depende da VPS ou do
banco de produção.

---

## 1. Veredito

O Hermes tem muita governança e pouca entrega no dia a dia.

- **Uso real hoje**: um bot no Telegram (`@grupoerick_bot`), rodando na VPS
  em modo *staging*, para **um único dono**. Ele responde vendas e
  cancelamentos de 2025/2026, um resumo de Compras (app Base44 de
  homologação) e a saúde do LotoIA. *(observado no código; estado na VPS não
  verificado)*
- **Os dados param em 08/06/2026.** Depois da troca do Softcom pelo Linx
  (jul/2026) não entrou nenhum dado novo. Hoje é 18/11: o bot está há
  **5 meses sem dado atual**. *(observado: meses fixos no código e avisos
  "Histórico 2026 termina em 08/06")*
- **O agente com IA tem cota de 4 perguntas por dia** (mais 8 de reserva via
  OpenRouter). Para uso diário de duas pessoas, isso acaba antes do almoço.
  *(observado em `scripts/run-hermes-telegram-private.js`)*
- **Só ~7% do código atende quem usa o Hermes.** De 146 mil linhas de JS
  (fora testes), cerca de 10 mil são alcançáveis a partir do bot e da API.
  O resto são contratos, simulações e canários: Contabilidade C0–C26,
  Marketing (40 simulações), Jurídico, filas e workers simulados. Nada disso
  está ligado a dado real. *(observado)*

**Resumindo:** para virar ferramenta diária, o Hermes precisa de **dado atual
(Linx)**, de **cota e cobertura de perguntas compatíveis com o uso** e de
**dois usuários**. Isso vem antes de qualquer nova camada de governança.

---

## 2. O que existe de fato

| Componente | Onde | Estado | O que faz |
| --- | --- | --- | --- |
| Bot Telegram privado | VPS, container `hermes-telegram-private-v1` | ativo segundo os scripts de deploy (*não verificado*) | Comandos `/historico`, `/compras`, `/prioridades`, `/lotoia`, `/decisao`, `/cerebro`, `/diagnostico`, `/alertas`, `/economia` + perguntas livres limitadas |
| Agente governado (IA) | dentro do bot | ligado se `HERMES_AGENT_LLM_ENABLED=true` | Planeja até 3 consultas (histórico ou compras) e redige a resposta. Modelo: Codex via login ChatGPT (socket local), reserva OpenRouter |
| Histórico de vendas | Supabase prod, schema `hermes_history` | leitura com papel próprio, somente leitura, TLS verificado | 3 views: vendas diárias, comercial mensal 2025–2026, produtos mensais |
| Segundo cérebro | Supabase prod, schema `hermes_brain` + `/brain/` web | staging, acesso por RLS | Memória aprovada; até 12 leituras/dia pelo bot |
| API v2 (`platform/services/api`) | VPS (`hermes-staging.grupoerick.tech`) | staging | `/message` só **classifica** a intenção e responde `planned`; nunca executa. Serve os read-pilots do bot |
| App v1 (`server.js` + `public/`) | Railway, segundo o README | **não verificado se ainda está no ar** | Chat web com Claude (`claude-sonnet-4-6`) que escreve SQL livre no banco |
| Supabase staging `hermes-insight-hub-staging` | org acessível nesta sessão | **estava PAUSADO**; reativado nesta auditoria | Tabelas das migrations 001–045 (canários, governança, cérebro) |

---

## 3. Achados críticos — resolver primeiro

### C1. App v1: chat sem login + filtro de SQL com brecha  *(observado)*

- `POST /api/chat` (`server.js`) não tem autenticação nem limite de uso.
  Qualquer pessoa com a URL pode consultar o banco das lojas e gastar a
  chave da Anthropic.
- O filtro de SQL (`src/hermes/sql-guardrails/index.js`) só confere a tabela
  logo após `FROM`/`JOIN`. Join por vírgula passa:

  ```
  PASS  SELECT * FROM vw_faturamento_mensal, auth.users
  PASS  SELECT * FROM vw_faturamento_mensal a, pg_catalog.pg_shadow b
  ```

  O README indica conexão como `postgres` (papel com muitos privilégios).
  Com uma injeção de prompt, o modelo pode montar essa consulta.
- `public/index.html:551` (`addQuerying`) insere a `descricao` gerada pelo
  modelo com `innerHTML` sem escapar (XSS por injeção de prompt).

**Ação:** confirmar se a v1 ainda está no Railway. Se estiver e ninguém usar,
desligar. Se for usada: login, papel de banco somente leitura sem acesso a
`auth`/`pg_catalog`, verificar todas as relações (inclusive após vírgula) e
escapar o texto da "pílula" de consulta.

### C2. 38 testes quebrados no `main`, e o CI não percebe  *(observado)*

- `npm test` na raiz: **6588 testes, 38 falhas** (Contabilidade e Jurídico).
  Suíte da plataforma (`platform/services/api`): **5821 testes, 0 falhas**.
- Nenhum workflow roda `test/accounting-*` nem a maior parte de `test/legal-*`.
  Por isso o merge #574 (Contabilidade C0–C26) aparece "verde".
- Bug real e determinístico: `src/hermes/accounting/ap-ar.js:27`, `required()`
  só aceita texto, mas `originalAmountCents` é número. `createObligation`
  falha com qualquer entrada válida.

| Arquivo de teste | Falhas |
| --- | --- |
| `test/accounting-ap-ar.test.js` | 10 |
| `test/accounting-journal-subledger.test.js` | 7 |
| `test/accounting-reverse-audit.test.js` | 6 |
| `test/accounting-continuous-close.test.js` | 4 |
| `test/accounting-payment-preparation.test.js` | 3 |
| `accounting-c0-c18-e2e`, `controlled-financial-execution`, `legal-evidence-engine-sim` | 2 cada |
| `accounting-intelligence`, `accounting-inventory-purchasing` | 1 cada |

**Ação:** um job de CI que rode `node --test test/` da raiz; corrigir
`required()` e as validações de data. Essa área não está em uso, então não é
urgente para o negócio, mas o CI verde hoje engana.

### C3. Supabase de staging estava pausado  *(observado)*

O projeto `hermes-insight-hub-staging` estava `INACTIVE`. Com ele pausado,
tudo que depende das migrations 001–045 (entrada de missões, canários,
reautenticação por e-mail, auditoria) fica fora do ar. Reativei nesta
auditoria com sua autorização. Ver seção 6.

### C4. 12 PRs abertas, 10 já substituídas  *(observado)*

Segundo `docs/HERMES_GOAL_MODE_STATUS_2026-11-13.md`: #453→#571, #400→#572,
#250→#568, #531→#569, #530→#570, #544 e #543→#567; #146, #118 e #19 são
snapshots antigos. Continuam abertas: #575 (rascunho atual) e #510
(Contabilidade). **Ação:** fechar as 10 com um comentário apontando o
substituto.

---

## 4. Lacunas para uso diário — em ordem de impacto

### P0 — Sem isso, o Hermes não serve para o dia a dia

**G1. Dado atual (Linx da Seta).**
Tudo que o bot sabe termina em 08/06/2026. O adaptador Seta/Linx existe só
como contrato: `transportStatus: 'DISCOVERY_REQUIRED'`
(`src/hermes/accounting/seta-read-adapter.js`). A decisão de 29/09 já define
o caminho: Linx → conector → Supabase → API de leitura → Hermes. Mas as
pendências factuais continuam abertas: produto/versão do Linx, contato
técnico da Seta e método de exportação/API.
**Ação:** destravar a conversa com a Seta **agora**, em paralelo a tudo.
Enquanto não houver API, um export diário (CSV/planilha) carregado no
Supabase já entrega 80% do valor.

**G2. Cotas pequenas demais.** *(observado, `scripts/run-hermes-telegram-private.js`)*

| Recurso | Limite/dia | Onde |
| --- | --- | --- |
| Perguntas ao agente com IA (Codex) | **4** | `agent-llm-budget.json` |
| Reserva OpenRouter | 8 | `agent-openrouter-budget.json` |
| Consultas ao histórico (analista) | 24 (8 para o formato antigo) | `history-live-budget.json` |
| Leituras do segundo cérebro | 12 | `brain-read-budget.json` |

Os limites estão fixos no código. Para mudar, é preciso nova versão e novo
deploy. **Ação:** mover para variáveis de ambiente com teto, e dimensionar
para 2 usuários × ~20 perguntas/dia.

**G3. Períodos e anos fixos no código.** *(observado)*
- `HISTORY_MONTHS = ['2026-01' … '2026-06']` em
  `hermes-telegram-private-channel.js:123`.
- O parser só reconhece **2025 e 2026** (regex `202[56]` em
  `hermes-analyst-templates.js:14`). Dados de 2011–2024 existem no banco mas
  ficam inacessíveis; 2027 não será reconhecido.
- O prompt do planejador cita "Histórico de 2026 termina 8 de junho".

**Ação:** derivar a janela de datas do próprio banco (`max(dia)`), sem lista
fixa. Quando chegar dado novo, o bot passa a enxergar sem deploy.

### P1 — Necessário para duas pessoas usarem todo dia

**G4. Um único dono.** O bot vincula um `owner_id` e recusa qualquer outro
(`telegram_owner_already_bound`, `msg.userId!==ownerId`). Erick e Pericles não
podem usar ao mesmo tempo. **Ação:** lista de usuários autorizados, com papel
(ex.: dono vê tudo; gerente vê a própria loja).

**G5. Perguntas que a v1 respondia e o bot não responde.** A v1 tinha
inadimplência recuperável por loja, contas a receber, top vendedores e ticket
médio. O bot atual cobre vendas, cancelamentos, produtos (2026) e compras.
**Inadimplência** (R$ 938 mil recuperáveis e R$ 1,2 mi em perda provável,
segundo o prompt da v1) é a pergunta mais valiosa no dia a dia e não está no
bot. **Ação:** portar os templates `recoverable_delinquency_by_store`,
`top_salespeople_by_year` e `average_ticket_last_three_months` para o
analista do bot, como consultas fixas (sem SQL livre).

**G6. Nada é proativo.** O bot só responde. Não há resumo matinal, alerta de
parcela vencendo, queda de vendas ou bot fora do ar. **Ação:** um agendador
(cron na VPS) que, às 7h30, envia aos usuários um resumo: vendas de ontem por
loja, inadimplência que venceu, compras a pagar na semana. Usa só consultas
fixas, sem IA, então não gasta cota.

**G7. Palavras proibidas bloqueiam perguntas legítimas.**
`hermes-governed-agent.js:10` nega qualquer pergunta com `pix`, `cnpj`,
`sql`, `token`, `enviar mensagem` etc. "Quanto entrou no Pix ontem?" é
recusada. **Ação:** bloquear a *ação* (pagar, transferir), não a palavra.

### P2 — Operação confiável

**G8. Estado em arquivos JSON pequenos na VPS.** Memória de decisões,
evidências, cache e contadores ficam em `/var/lib/hermes-telegram/*.json`, com
teto de 2 KB a 32 KB por arquivo. A memória "enche" rápido, e não há backup
documentado. **Ação:** levar esse estado para o Postgres (o schema
`hermes_brain` já existe) ou, no mínimo, backup diário do diretório.

**G9. Deploy frágil: 20 scripts quase iguais.**
`platform/services/api/scripts/deploy-hermes-telegram-*-staging.sh` (24
contando os de cérebro e automemória): cada funcionalidade ganhou um script
com caminhos, nomes de imagem (`v13`) e contagem de registros fixos. A
checagem `n === 25482`, presente em 20 deles, **bloqueia o deploy assim que
entrar dado novo**. **Ação:** um único script de
deploy/rollback, parametrizado, e trocar a contagem fixa por "não diminuiu".

**G10. Monitoramento.** O único sinal de vida é o arquivo `heartbeat.json`.
Se o bot cair, ninguém é avisado. **Ação:** healthcheck do container lendo a
idade do heartbeat + aviso externo (outro bot, e-mail ou UptimeRobot no
`/health`).

**G11. IA via login pessoal.** O modelo principal é o Codex CLI autenticado
com uma conta ChatGPT (`hermes-codex-login-bridge.js`). Se a sessão expirar ou
a conta atingir limite, o agente para. **Ação:** avaliar uma chave de API
dedicada, com teto de gasto mensal, como caminho principal. Conferir também
os termos de uso do plano para uso automatizado.

**G12. "Staging" é obrigatório.** O runner recusa iniciar se
`HERMES_DEPLOYMENT_STAGE !== 'staging'`. Na prática, o staging *é* a
produção. Tudo bem por ora, mas é bom nomear e documentar isso
explicitamente, com backup, monitoramento e rollback de produção.

### P3 — Foco

**G13. Congelar trabalho especulativo até o ciclo diário funcionar.**
Contabilidade (26 contratos), Marketing (40 simulações), Jurídico, filas e
workers simulados, canários de escrita no GitHub: nenhum tem fonte de dado
real nem usuário. Cada PR nova aumenta o custo de manutenção (CI de ~4 min,
6 mil testes). Recomendo pausar essas trilhas até G1–G6 estarem entregues.

---

## 5. Plano sugerido (PRs pequenas)

| Semana | Entrega | Lacunas |
| --- | --- | --- |
| 1 | Confirmar/desligar v1 no Railway; CI rodando `test/` da raiz; corrigir `ap-ar`; fechar as 10 PRs substituídas | C1, C2, C4 |
| 1 | Janela de datas derivada do banco; anos de 2011 em diante; trocar `25482` por "não diminuiu" | G3, G9 |
| 2 | Cotas por variável de ambiente; 2 usuários autorizados; ajustar palavras proibidas | G2, G4, G7 |
| 2 | Inadimplência, top vendedores e ticket médio no analista do bot | G5 |
| 3 | Resumo matinal agendado + aviso de bot fora do ar + backup do estado | G6, G8, G10 |
| 3 | Script único de deploy/rollback | G9 |
| em paralelo | Seta/Linx: levantar produto, versão, API/export; carga diária provisória | G1 |
| 4+ | Conector Linx incremental em staging, reconciliado com o Linx | G1 |

---

## 6. Supabase

### Projeto acessível: `hermes-insight-hub-staging` (`vvzvqinbzdqzcwrfoomd`)

Estava **pausado**; reativado em 18/11 (status `ACTIVE_HEALTHY`). *(observado)*

- **Quase vazio e sem uso.** Schema `hermes` tem 4 tabelas; só as de
  reautenticação por e-mail têm linhas (36 desafios, 15 evidências). Inbox de
  missões e auditoria de canário: 0 linhas. O Supabase pausa projetos
  gratuitos depois de dias sem acesso, ou seja, nada usava esse banco.
- **Migrations do repo não batem com o banco.** O banco registra 6 migrations
  (PoC multi-tenant, BFF Base44, auditoria do canário). Das 45 em
  `platform/migrations/hermes/`, só as de canário, reautenticação e inbox
  (017–019, 029–032) têm tabela correspondente. Ciclo de autorização,
  confirmações, jobs, workers, governança, escrita no GitHub e segundo
  cérebro (038–045) **não existem aqui**: ou estão no projeto de produção,
  ou nunca foram aplicadas. Falta um registro de qual migration está em qual
  banco.
- **Advisor de segurança (crítico):** RLS desligado em
  `hermes.strong_human_reauth_email_challenges` e
  `hermes.strong_human_reauth_email_evidence`. Risco real hoje é **baixo**:
  `anon` e `authenticated` não têm `USAGE` no schema `hermes` nem grants nas
  tabelas, então a API pública não chega lá. Mesmo assim, vale ligar o RLS
  como segunda barreira. O acesso do Hermes é pelo papel `postgres`, que
  ignora RLS, então isto não quebra nada do runtime. **Não apliquei**; decida
  você:

  ```sql
  ALTER TABLE hermes.strong_human_reauth_email_challenges ENABLE ROW LEVEL SECURITY;
  ALTER TABLE hermes.strong_human_reauth_email_evidence ENABLE ROW LEVEL SECURITY;
  ```

- `hermes_poc` (PoC de isolamento): RLS ligado, `authenticated` lê
  organizações e grava `tenant_records`; 0 linhas. Coerente com uma PoC.
- Advisor de performance: 9 índices nunca usados. Irrelevante com tabelas
  vazias.
- **Sugestão:** se nada for usar esse projeto nas próximas semanas, pausar de
  novo (Dashboard → Project Settings → Pause).

### Projeto de produção: `yxmdrrwqxwzsdgcgskrm` — *não verificado*

Não aparece no conector Supabase desta sessão (provavelmente está em outra
organização). Deixei um script **somente leitura** em
`docs/sql/AUDITORIA_PRODUCAO_SOMENTE_LEITURA.sql`. Ele confere:

1. até que data existem vendas (frescor);
2. se já existe algum schema com dados do Linx;
3. tabelas sem RLS em `public`, `softcom_import`, `hermes_history` e `hermes_brain`;
4. o que `anon`/`authenticated` conseguem ler (alerta se aparecer `softcom_import`);
5. views que ignoram RLS de quem consulta;
6. atributos dos papéis `hermes_*`;
7. jobs agendados (`pg_cron`);
8. maiores tabelas;
9. itens do segundo cérebro aprovados e expirados.

---

## 7. Checklist da VPS (rode e me mande a saída)

Todos os comandos são só leitura e não mostram conteúdo de mensagem nem segredo.

```bash
# containers e saúde
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker inspect hermes-telegram-private-v1 --format '{{.State.Health.Status}} desde {{.State.StartedAt}}'

# o bot está vivo? (idade do último heartbeat, em segundos)
B=/home/hermesadmin/.hermes-telegram/state
echo $(( $(date +%s) - $(sudo -u hermesadmin cat $B/heartbeat.json | sed 's/[^0-9]//g' | cut -c1-10) ))

# uso das cotas hoje
sudo -u hermesadmin cat $B/agent-llm-budget.json $B/history-live-budget.json 2>/dev/null

# quantas perguntas por dia (últimos 14 dias), e quantas falharam
sudo -u hermesadmin grep '"event":"outcome"' $B/audit.jsonl | cut -c8-17 | sort | uniq -c | tail -14
sudo -u hermesadmin grep '"event":"outcome"' $B/audit.jsonl | grep -o '"outcome":"[a-z_]*"' | sort | uniq -c

# tamanho dos arquivos de estado (perto do teto = memória cheia)
sudo -u hermesadmin ls -la $B

# disco, backup e certificado
df -h /
sudo crontab -l; sudo -u hermesadmin crontab -l
echo | openssl s_client -connect hermes-staging.grupoerick.tech:443 -servername hermes-staging.grupoerick.tech 2>/dev/null | openssl x509 -noout -enddate
```

---

## 8. O que preciso de você

1. **A v1 ainda está no Railway?** Se sim, a URL, e se alguém ainda usa.
2. **Linx da Seta:** nome/versão do produto, contato técnico e se existe
   exportação (relatório, CSV, API).
3. **Saída do checklist da VPS** (seção 7), para confirmar uso real e cotas.
4. **Saída do script SQL de produção** (seção 6), ou acesso ao projeto
   `yxmdrrwqxwzsdgcgskrm` no conector Supabase.
5. **Prioridade:** confirmar se o plano da seção 5 faz sentido ou se há outra
   dor mais urgente no dia a dia.
