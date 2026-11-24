# Auditoria Hermes — o que falta para uso diário

Data: 2026-11-24 (2ª rodada; a 1ª foi em 18/11) · Base: `main` em `a025b51`
(PR #578), **sem nenhum commit novo desde 17/11** · Também avaliadas as PRs
de correção #579–#582, abertas em 19/11.

Escopo: código do repositório inteiro, testes rodados de novo nesta sessão,
CI do GitHub, PRs abertas, dependências e o projeto Supabase acessível. A VPS
e os projetos Supabase de dados das lojas e do segundo cérebro **não** estavam
acessíveis daqui. O que depende deles está marcado como *não verificado*, com
comandos para você conferir (seções 7 e 8).

Legenda: **observado** = conferi no código, nos testes ou na API ·
**não verificado** = depende da VPS ou de um banco que não acessei.

---

## 0. O que mudou desde 18/11

| Achado de 18/11 | Situação hoje | O que falta |
| --- | --- | --- |
| Chat v1 sem login | PR #582 (rascunho, CI verde) põe token e limite de uso no servidor | A página web não envia o token: depois do merge, o chat web para de funcionar. Decidir entre desligar a v1 ou adicionar login na página |
| Filtro de SQL com brecha da vírgula | PR #579 (rascunho) fecha a vírgula simples | **Incompleta**, e há brecha nova pior (ver S1) |
| XSS na pílula de consulta | nenhuma PR | tudo |
| 38 testes quebrados, CI sem a raiz | PR #580 (rascunho) corrige os 38 e cria o workflow da raiz; CI verde | Merge. O workflow ignora mudanças em `server.js` e `public/` |
| Supabase staging pausado | reativado em 18/11; hoje **hibernando de novo** | Confirma que nada usa esse banco |
| PRs substituídas abertas | de 12 abertas passou para **16** | Fechar 11 (seção 3, Q2) |
| Lacunas de uso diário (G1–G13) | **nenhuma mudou** | tudo |

Resumo: houve um dia de trabalho (19/11) sobre os achados de segurança e de
testes, em PRs que estão paradas como rascunho. Nenhuma lacuna de uso diário
foi atacada.

---

## 1. Veredito

O Hermes continua com muita governança e pouca entrega no dia a dia.

- **Uso real**: um bot no Telegram (`@grupoerick_bot`) rodando na VPS em modo
  *staging*, para **um único dono**. Ele responde vendas e cancelamentos de
  2025/2026, um resumo de Compras (vindo de uma **cópia de homologação** do
  app Base44) e a saúde do LotoIA. *(observado no código; estado na VPS não
  verificado)*
- **Os dados param em 08/06/2026.** Hoje é 24/11: são mais de 5 meses sem
  dado novo desde a troca do Softcom pelo Linx. *(observado)*
- **O agente com IA aceita 4 perguntas por dia**, mais 8 de reserva via
  OpenRouter. *(observado)*
- **Só ~7% do código atende quem usa o Hermes.** De 146 mil linhas de JS
  (fora testes), cerca de 10 mil são alcançáveis a partir do bot e da API. O
  resto são contratos e simulações sem dado real. *(observado)*

**Para virar ferramenta diária**, o Hermes precisa de **dado atual (Linx)**,
**cota e cobertura de perguntas compatíveis com o uso** e **dois usuários**.
Isso vem antes de qualquer nova camada de governança.

---

## 2. O que existe de fato

| Componente | Onde | Estado | O que faz |
| --- | --- | --- | --- |
| Bot Telegram privado | VPS, container `hermes-telegram-private-v1` | ativo segundo os scripts de deploy (*não verificado*) | `/historico`, `/compras`, `/prioridades`, `/lotoia`, `/decisao`, `/cerebro`, `/diagnostico`, `/alertas`, `/economia` + perguntas livres limitadas |
| Agente governado (IA) | dentro do bot | ligado se `HERMES_AGENT_LLM_ENABLED=true` | Planeja até 3 consultas (histórico ou compras) e redige a resposta. Modelo: Codex via login ChatGPT (socket local), reserva OpenRouter |
| API v2 (`platform/services/api`) | VPS (`hermes-staging.grupoerick.tech`) | staging | `/message` só **classifica** a intenção e responde `planned`. Serve os read-pilots que o bot consulta (compras, LotoIA, status) |
| Worker v2 | `docker-compose` | só emite heartbeat | Não processa fila nenhuma |
| App v1 (`server.js` + `public/`) | Railway, segundo o README | **não verificado se está no ar** | Chat web com Claude (`claude-sonnet-4-6`) que escreve SQL livre no banco |

### Bancos (três projetos Supabase, não dois)

| Projeto | Ref | O que guarda | Acesso nesta auditoria |
| --- | --- | --- | --- |
| Dados das lojas | `yxmdrrwqxwzsdgcgskrm` | `softcom_import`, views `public`, `hermes_history` (histórico do bot e da v1) | não acessível |
| hermes-brain | `asceucchdnuoaqgdjbtg` | `hermes_brain` (segundo cérebro, `/brain/`, migrations 038–045), Outlook via Composio | não acessível |
| hermes-insight-hub-staging | `vvzvqinbzdqzcwrfoomd` | canários, reautenticação por e-mail, inbox de missões | acessível; hibernando |

*Correção em relação a 18/11: eu tinha atribuído `hermes_brain` ao projeto
das lojas. Ele fica no projeto `hermes-brain`.*

---

## 3. Achados críticos

### S1. Filtro de SQL da v1: tabela entre aspas passa direto  *(observado, novo)*

O filtro (`src/hermes/sql-guardrails/index.js`) só reconhece nomes de tabela
que começam com letra. Com aspas, ele não vê tabela nenhuma e libera. Teste
no `main` e na PR #579:

| Consulta | `main` | PR #579 |
| --- | --- | --- |
| `SELECT * FROM "auth"."users"` | passa | **passa** |
| `SELECT * FROM vw_faturamento_mensal, "auth".users` | passa | **passa** |
| `SELECT * FROM vw_faturamento_mensal a JOIN vw_itens_vendidos b ON true, auth.users` | passa | **passa** |
| `SELECT * FROM vw_faturamento_mensal, auth.users` | passa | bloqueia |
| `SELECT * FROM (SELECT 1) x, auth.users` | passa | bloqueia |
| `SELECT set_config('statement_timeout','0',false)` | passa | passa |
| `SELECT pg_sleep(14)` | passa | passa |
| `SELECT loja, extract(year from mes) FROM vw_faturamento_mensal` (legítima) | **bloqueia** | **bloqueia** |

Filtro por expressão regular não fecha esse tipo de brecha: sempre aparece
uma variação nova. **Ação:** a proteção de verdade é no banco. Criar um papel
só de leitura que enxerga **apenas** as views e tabelas permitidas, sem
`auth`, `pg_catalog` nem funções administrativas, e fazer a v1 conectar com
ele. O filtro vira segunda barreira. Se a v1 não for mais usada, desligar
resolve tudo de uma vez.

### S2. Chat v1 sem login  *(observado)*

`POST /api/chat` segue aberto no `main`, sem limite de uso. A PR #582 resolve
no servidor (token + 20 req/min, falha fechada se não houver token
configurado), mas `public/index.html` não envia token. **Ação:** decidir se a
v1 ainda tem uso. Se não tiver, desligar no Railway e fechar #579/#582. Se
tiver, completar #582 com tela de login.

### S3. XSS na pílula de consulta da v1  *(observado)*

`public/index.html:551` (`addQuerying`) insere a `descricao` gerada pelo
modelo com `innerHTML`. Nenhuma PR trata. **Ação:** usar `textContent`.

### S4. Dependências vulneráveis na v1  *(observado, novo)*

`npm audit` na raiz: `proxy-addr` (crítica, falsificação de IP),
`body-parser` (alta, negação de serviço) e `qs` (moderada), todas puxadas
pelo Express 4.22. Há correção disponível (`npm audit fix`). A API da
plataforma não tem vulnerabilidades.

### S5. Node 20 fora de suporte  *(observado, novo)*

As imagens Docker (`node:20-alpine`) e todos os jobs de CI usam Node 20, cujo
suporte acabou em abril de 2026: não recebe mais correções de segurança.
**Ação:** subir para Node 22 ou 24 nos Dockerfiles e no CI.

### S6. API v2 acumula memória sem limite  *(observado, novo)*

Cada `POST /message` que cai num domínio sensível cria uma confirmação
pendente num `Map` em memória que **nunca é apagado**
(`memory-confirmation-persistence.js`); expirar só muda o status. Medi
~13,5 MB a cada 20 mil chamadas. No código a rota não exige identidade; se o
proxy da VPS a expõe na internet, é *não verificado* (comando na seção 7).
Exposta, com volume suficiente o processo cai, e é **o mesmo processo** que serve os
read-pilots que o bot usa para `/compras`, `/lotoia` e `/status`. **Ação:**
remover expiradas e pôr um teto, ou fechar `/message` e `/confirm` no proxy
enquanto não forem usados.

### Q1. 38 testes quebrados no `main`  *(observado)*

Rodei de novo: os testes próprios da raiz são **744, com 38 falhas**
(Contabilidade e Jurídico). A suíte da plataforma segue **5821/5821**. A PR
#580 corrige as 38 (conferi: 274/274 nos arquivos afetados) e cria o workflow
`hermes-root-regression.yml`. **Ação:** merge da #580. Incluir `server.js`,
`public/**` e `scripts/**` no filtro `paths` do workflow; hoje uma PR que só
mexe no chat da v1 não dispara os testes da raiz.

*(Em 18/11 eu informei "6588 testes"; esse número somava as duas suítes.)*

### Q2. 16 PRs abertas, 11 podem ser fechadas  *(observado)*

| PR | Motivo |
| --- | --- |
| #453, #400, #250, #531, #530, #544, #543 | Substituídas por #571, #572, #568, #569, #570 e #567 (segundo `docs/HERMES_GOAL_MODE_STATUS_2026-11-13.md`) |
| #146, #118, #19 | Snapshots antigos sem falha comprovada (mesmo documento) |
| #581 | Versão anterior da #582; ainda carrega as 38 falhas e o CI dela falhou |

Continuam válidas: #580 (merge), #582 (completar ou fechar), #579 (refazer),
#575 (rollout do histórico) e #510 (Contabilidade; conferir se a #574 já a
substituiu).

### Supabase staging: RLS desligado  *(verificado em 18/11; não reverificado hoje)*

RLS desligado em `hermes.strong_human_reauth_email_challenges` e
`hermes.strong_human_reauth_email_evidence`. Risco baixo, porque `anon` e
`authenticated` não têm acesso ao schema `hermes`. O banco estava hibernando
hoje e não aceitou conexão para reverificar. Correção sugerida, **não
aplicada**:

```sql
ALTER TABLE hermes.strong_human_reauth_email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes.strong_human_reauth_email_evidence ENABLE ROW LEVEL SECURITY;
```

---

## 4. Lacunas para uso diário (sem mudança desde 18/11)

Reconferi cada uma no `main` de hoje.

### P0 — Sem isso, o Hermes não serve para o dia a dia

**G1. Dado atual (Linx da Seta).** Tudo termina em 08/06/2026. O adaptador
Seta/Linx existe só como contrato (`transportStatus: 'DISCOVERY_REQUIRED'`).
As pendências da decisão de 29/09 continuam abertas: produto/versão do Linx,
contato técnico da Seta e método de exportação/API. **Ação:** destravar com a
Seta agora. Enquanto não houver API, um export diário (CSV) carregado no
Supabase já entrega boa parte do valor.

**G2. Cotas fixas e pequenas** (`scripts/run-hermes-telegram-private.js`):

| Recurso | Limite/dia | Linha |
| --- | --- | --- |
| Perguntas ao agente com IA (Codex) | **4** | 289 |
| Reserva OpenRouter | 8 | 336 |
| Consultas ao histórico | 24 (8 no formato antigo) | 262, 418 |
| Leituras do segundo cérebro | 12 | 218 |

**Ação:** variáveis de ambiente com teto, dimensionadas para 2 usuários ×
~20 perguntas/dia.

**G3. Períodos e anos fixos.** Meses `2026-01…2026-06` fixos
(`hermes-telegram-private-channel.js:123`); o parser só reconhece **2025 e
2026** (`hermes-analyst-templates.js:12–14`). 2011–2024 ficam inacessíveis e
2027 não será reconhecido. **Ação:** derivar a janela de datas do banco.

### P1 — Necessário para duas pessoas usarem todo dia

**G4. Um único dono** (`telegram_owner_already_bound`). Erick e Pericles não
podem usar ao mesmo tempo. **Ação:** lista de usuários autorizados com papel.

**G5. Perguntas que a v1 respondia e o bot não.** Inadimplência recuperável
por loja (R$ 938 mil recuperáveis e R$ 1,2 mi em perda provável, segundo o
prompt da v1), top vendedores e ticket médio. **Ação:** portar
`recoverable_delinquency_by_store`, `top_salespeople_by_year` e
`average_ticket_last_three_months` como consultas fixas no bot.

**G6. Nada é proativo.** Sem resumo matinal nem alertas. **Ação:** um
agendador na VPS que às 7h30 envia vendas de ontem, inadimplência vencida e
compras a pagar na semana. Usa só consultas fixas, sem IA.

**G7. Palavras proibidas bloqueiam perguntas legítimas.**
`hermes-governed-agent.js:10` recusa perguntas com `pix`, `cnpj`, `sql`,
`token` etc. "Quanto entrou no Pix ontem?" é recusada. **Ação:** bloquear a
*ação* (pagar, transferir), não a palavra.

### P2 — Operação confiável

**G8. Estado em arquivos JSON de 2 a 32 KB na VPS**, sem backup documentado.
**Ação:** levar para o Postgres ou, no mínimo, backup diário.

**G9. 20 scripts de deploy quase iguais**, e 20 deles checam `n === 25482`:
o deploy **vai falhar assim que entrar dado novo**. **Ação:** um script único
parametrizado e checagem "não diminuiu".

**G10. Monitoramento.** O único sinal de vida é `heartbeat.json`. **Ação:**
healthcheck pela idade do heartbeat + aviso externo.

**G11. IA via login pessoal** (Codex CLI com conta ChatGPT). Se a sessão
expirar, o agente para. **Ação:** chave de API dedicada com teto mensal; e
conferir os termos do plano para uso automatizado.

**G12. "Staging" é obrigatório** no código. Na prática ele é a produção.
**Ação:** documentar isso, com backup, monitoramento e rollback.

### P3 — Foco

**G13. Congelar trabalho especulativo** (Contabilidade, Marketing, Jurídico,
filas e workers simulados, canários de escrita) até G1–G6 estarem entregues.

---

## 5. Plano atualizado (PRs pequenas)

| Quando | Entrega | Itens |
| --- | --- | --- |
| Esta semana | Merge da #580 (+ `paths` do workflow); fechar as 11 PRs da Q2 | Q1, Q2 |
| Esta semana | Decidir a v1: desligar (e fechar #579/#582) **ou** papel de banco só leitura + #582 com login + XSS + `npm audit fix` | S1–S4 |
| Esta semana | Node 22/24 nas imagens e no CI; teto/limpeza no store da API v2 | S5, S6 |
| Semana 2 | Janela de datas derivada do banco; anos desde 2011; trocar `25482` | G3, G9 |
| Semana 2 | Cotas por variável de ambiente; 2 usuários; ajustar palavras proibidas | G2, G4, G7 |
| Semana 3 | Inadimplência, top vendedores e ticket médio no bot | G5 |
| Semana 3 | Resumo matinal + aviso de bot fora do ar + backup do estado | G6, G8, G10 |
| em paralelo | Seta/Linx: produto, versão, API/export; carga diária provisória | G1 |
| Semana 4+ | Conector Linx incremental em staging, reconciliado | G1 |

---

## 6. Supabase

- **Staging (`vvzvqinbzdqzcwrfoomd`)**: reativado em 18/11; em 24/11 a API
  de gestão mostra `ACTIVE_HEALTHY`, mas o banco estava hibernando e não
  aceitou conexão (quatro tentativas). Em 18/11: 4 tabelas em `hermes`, só
  as de reautenticação com linhas (36/15); das 45 migrations do repo, só as
  de canário, reautenticação e inbox (017–019, 029–032) têm tabela lá. Se
  nada for usá-lo, pausar.
- **Dados das lojas (`yxmdrrwqxwzsdgcgskrm`)** e **hermes-brain
  (`asceucchdnuoaqgdjbtg`)**: fora do alcance do conector desta sessão.
  Script somente leitura em `docs/sql/AUDITORIA_PRODUCAO_SOMENTE_LEITURA.sql`
  (blocos 1–8 no projeto das lojas; bloco 9 no hermes-brain). Ele confere
  frescor dos dados, schemas do Linx, RLS, o que `anon`/`authenticated` leem,
  views que ignoram RLS, papéis `hermes_*`, `pg_cron`, tamanho das tabelas e
  itens do segundo cérebro.
- **Falta um registro** de qual migration foi aplicada em qual projeto.

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

# perguntas por dia (últimos 14 dias) e resultados
sudo -u hermesadmin grep '"event":"outcome"' $B/audit.jsonl | cut -c8-17 | sort | uniq -c | tail -14
sudo -u hermesadmin grep '"event":"outcome"' $B/audit.jsonl | grep -o '"outcome":"[a-z_]*"' | sort | uniq -c

# tamanho dos arquivos de estado (perto do teto = memória cheia)
sudo -u hermesadmin ls -la $B

# /confirm (e portanto /message) está exposto na internet? (S6)
# 200 com "not_found" = exposto; 404 vazio do proxy = fechado
curl -s https://hermes-staging.grupoerick.tech/confirm/auditoria-teste

# memória do processo da API
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}'

# disco, agendamentos e certificado
df -h /
sudo crontab -l; sudo -u hermesadmin crontab -l
echo | openssl s_client -connect hermes-staging.grupoerick.tech:443 -servername hermes-staging.grupoerick.tech 2>/dev/null | openssl x509 -noout -enddate
```

---

## 8. O que preciso de você

1. **A v1 ainda está no Railway e alguém usa?** Isso decide S1–S4.
2. **Linx da Seta:** nome/versão do produto, contato técnico e se existe
   exportação (relatório, CSV, API).
3. **Saída do checklist da VPS** (seção 7).
4. **Saída do script SQL** (seção 6), ou acesso aos projetos
   `yxmdrrwqxwzsdgcgskrm` e `asceucchdnuoaqgdjbtg` no conector Supabase.
5. **Prioridade:** confirmar o plano da seção 5.
