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
**confirmado** = informado pelo proprietário · **não verificado** = depende
da VPS ou de um banco que não acessei.

### Semana 1 executada (24/11, com aprovação do proprietário)

| Item | O que foi feito |
| --- | --- |
| Q1 | PR #580 mergeada no `main` (`ccafa05`): os 38 testes passam e a suíte da raiz roda no CI. Raiz agora: 745/745 |
| S1–S4 | v1 aposentada: `server.js`, `public/`, Express e node-fetch removidos; `npm audit` da raiz: 0 vulnerabilidades |
| S5 | Imagens Docker e todos os jobs de CI em Node 22 |
| S6 | Store de confirmações em memória limitado a 10 mil registros (antes, sem limite) |
| Q2 | 13 PRs substituídas fechadas com comentário apontando o substituto |

As mudanças de S1–S6 vão numa PR única a partir de
`claude/admiring-ptolemy-47dhk9`, com um commit por item. O próximo deploy na
VPS vai baixar a imagem `node:22-alpine`.

### Respostas do proprietário (24/11)

1. **A v1 não está mais no Railway.** *(confirmado)* Os achados S1–S4, todos
   da v1, deixam de ser risco em produção. Ver seção 3.
2. **Os dados do Linx ainda não estão integrados via API.** *(confirmado)*
   G1 segue como a maior lacuna.
3. **Checklist da VPS:** não sabe como rodar. Ver seção 8.
4. **Script SQL dos projetos de produção:** não sabe como rodar. Ver seção 8.

---

## 0. O que mudou desde 18/11

| Achado de 18/11 | Situação hoje | O que falta |
| --- | --- | --- |
| Chat v1 sem login | **v1 fora do Railway** (confirmado); PR #582 ficou desnecessária | Aposentar o código da v1 e fechar #582 |
| Filtro de SQL com brecha da vírgula | v1 fora do ar; PR #579 incompleta | Fechar #579 junto com a aposentadoria da v1 |
| XSS na pílula de consulta | v1 fora do ar | Some com a aposentadoria da v1 |
| 38 testes quebrados, CI sem a raiz | PR #580 (rascunho) corrige os 38 e cria o workflow da raiz; CI verde | Merge. O workflow ignora mudanças em `server.js` e `public/` |
| Supabase staging pausado | reativado em 18/11; hoje **hibernando de novo** | Confirma que nada usa esse banco |
| PRs substituídas abertas | de 12 abertas passou para **16** | Fechar 13 (seção 3, Q2) |
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

- **Ninguém na empresa sabe inspecionar a VPS nem os bancos de produção.**
  *(confirmado em 24/11)* O bot depende de uma VPS, de três projetos Supabase
  e de um login pessoal do ChatGPT, sem dono técnico conhecido. Ver seção 8.

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
| App v1 (`server.js` + `public/`) | **fora do ar** (confirmado); o README ainda manda publicar no Railway | código parado no repositório | Chat web com Claude (`claude-sonnet-4-6`) que escreve SQL livre no banco |

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

> **Situação em 24/11:** a v1 não está mais publicada (confirmado). S1–S4 não
> são exploráveis hoje. Mas o código continua no repositório e o `README.md`
> ainda ensina a publicá-la no Railway: se alguém republicar, os quatro
> problemas voltam juntos. **Ação recomendada:** uma PR que aposenta a v1,
> removendo `server.js`, `public/` e o Express. Os módulos de
> `src/hermes/` (templates, cache, filtro) têm testes próprios e ficam,
> porque os templates da v1 vão ser portados para o bot (G5). Com isso,
> fechar #579, #581 e #582.

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
uma variação nova. Lição para qualquer SQL gerado por IA no futuro: a proteção
de verdade é um papel de banco que só enxerga as views permitidas (como o bot
já faz com `hermes_history_login`), e o filtro é só segunda barreira.

### S2. Chat v1 sem login  *(observado; v1 fora do ar)*

`POST /api/chat` não tem login nem limite de uso. A PR #582 resolveria no
servidor, mas a página web não envia o token. Com a v1 fora do ar, não vale
completar: aposentar.

### S3. XSS na pílula de consulta da v1  *(observado; v1 fora do ar)*

`public/index.html:551` (`addQuerying`) insere a `descricao` gerada pelo
modelo com `innerHTML`. Some com a aposentadoria da v1.

### S4. Dependências vulneráveis na v1  *(observado; v1 fora do ar)*

`npm audit` na raiz: `proxy-addr` (crítica, falsificação de IP),
`body-parser` (alta, negação de serviço) e `qs` (moderada), todas puxadas
pelo Express 4.22, que só a v1 usa. Somem ao remover o Express. A API da
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
`hermes-root-regression.yml`. **Ação:** merge da #580. Incluir `scripts/**`
no filtro `paths` do workflow (com a v1 aposentada, `server.js` e `public/`
deixam de existir).

*(Em 18/11 eu informei "6588 testes"; esse número somava as duas suítes.)*

### Q2. 16 PRs abertas, 13 podem ser fechadas  *(observado)*

| PR | Motivo |
| --- | --- |
| #453, #400, #250, #531, #530, #544, #543 | Substituídas por #571, #572, #568, #569, #570 e #567 (segundo `docs/HERMES_GOAL_MODE_STATUS_2026-11-13.md`) |
| #146, #118, #19 | Snapshots antigos sem falha comprovada (mesmo documento) |
| #579, #581, #582 | Corrigem a v1, que está fora do ar; resolvidas pela aposentadoria da v1 |

Continuam válidas: #580 (merge), #575 (rollout do histórico) e #510
(Contabilidade; conferir se a #574 já a substituiu).

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

**G1. Dado atual (Linx da Seta).** Tudo termina em 08/06/2026. Confirmado em
24/11: **os dados do Linx não estão integrados via API.** O adaptador
Seta/Linx existe só como contrato (`transportStatus: 'DISCOVERY_REQUIRED'`).

Como a API não existe hoje, o caminho mais curto não depende dela:

1. **Descobrir o que o Linx já exporta.** Quase todo ERP de loja gera
   relatórios de vendas, contas a receber e compras em Excel ou CSV. Basta
   alguém da loja exportar **um dia** de cada relatório e mandar o arquivo.
2. **Carga diária a partir do arquivo.** Um script na VPS lê o arquivo e
   grava no Supabase, num schema próprio (ex.: `linx_import`), registrando
   origem e data da carga. O bot passa a ler dali.
3. **API depois.** Quando a Seta liberar API, troca-se só o passo 2, sem
   mexer no bot.

O que falta para começar: o nome/versão do Linx que a loja usa, quem na loja
consegue exportar os relatórios, e um arquivo de exemplo de cada um.

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
| Esta semana | Merge da #580 (+ `paths` do workflow); fechar as 13 PRs da Q2 | Q1, Q2 |
| Esta semana | Aposentar a v1: remover `server.js`, `public/` e Express; atualizar o README | S1–S4 |
| Esta semana | Node 22/24 nas imagens e no CI; teto/limpeza no store da API v2 | S5, S6 |
| Esta semana | Pedir à loja um export de 1 dia de vendas, contas a receber e compras do Linx | G1 |
| Semana 2 | Janela de datas derivada do banco; anos desde 2011; trocar `25482` | G3, G9 |
| Semana 2 | Cotas por variável de ambiente; 2 usuários; ajustar palavras proibidas | G2, G4, G7 |
| Semana 3 | Inadimplência, top vendedores e ticket médio no bot | G5 |
| Semana 3 | Resumo matinal + aviso de bot fora do ar + backup do estado | G6, G8, G10 |
| Semana 2–3 | Carga diária do export do Linx para o Supabase; bot lê os dados novos | G1 |
| Quando a Seta liberar | Trocar a carga por arquivo pela API, sem mexer no bot | G1 |

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

## 7. Checklist da VPS

Quem tem acesso SSH à VPS (usuário `hermesadmin`) roda estes comandos e manda
a saída. Todos são só leitura e não mostram conteúdo de mensagem nem segredo.
Se ninguém souber quem tem esse acesso, isso já é um achado: ver seção 8.

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

## 8. Próximos passos que dependem de você

Itens 1 e 2 respondidos (v1 fora do Railway; Linx sem API). Os
itens 3 e 4 ficaram como "não sei". Isso é, por si só, um achado de
operação: **o Hermes roda numa VPS e em três bancos que hoje ninguém na
empresa sabe inspecionar.** Se a pessoa que montou cair fora, o bot fica sem
dono técnico. Caminhos, do mais simples ao mais completo:

1. **Supabase (resolve o item 4 sem terminal):** em
   https://claude.ai/customize/connectors, reconectar o Supabase dando acesso
   à organização onde estão os projetos `yxmdrrwqxwzsdgcgskrm` (dados das
   lojas) e `asceucchdnuoaqgdjbtg` (hermes-brain). Depois abrir uma sessão
   nova: eu rodo o script de leitura e audito RLS, frescor e permissões
   diretamente.
2. **VPS (item 3):** descobrir quem tem o acesso SSH (usuário `hermesadmin`)
   e quem paga a VPS. Essa pessoa roda o checklist da seção 7. Uma
   alternativa é instalar o Claude Code na VPS e ligar o Remote Control
   (`claude remote-control` na pasta do projeto); aí uma sessão como esta
   pode rodar os comandos com a sua aprovação. Isso dá acesso de terminal ao
   servidor, então decida com cuidado.
3. **Linx:** pedir à loja um export de **um dia** de vendas, contas a
   receber e compras, no formato que o Linx gerar (Excel ou CSV), e o
   nome/versão do Linx.
4. **Prioridade:** confirmar o plano da seção 5. A semana 1 não depende de
   nenhum dos itens acima.
