# CHANGELOG.md



## 2026-07-03 — Sprint 1 / PR-17: Hermes Financeiro V2 — Daily Revenue integrado

### Adicionado

- Primeira capacidade financeira real integrada ao `/api/chat`: **faturamento diário** (`daily_revenue`).
- `src/hermes/finance/finance-execution.js` — `buildFinanceExecution(question)` produz uma execução **compatível com o motor de SQL Templates**, reaproveitando cache existente (perfil `current_day`, TTL 10 min), SQL parametrizado somente-leitura em `public.vw_itens_vendidos` e os logs já existentes.
- Formatação de `daily_revenue` em `financial-response-builder.js` (`buildFinancialResponse`, agora `implemented`).
- Logs estruturados `finance_capability_detected` e `finance_response_built`.
- Testes em `test/finance-execution.test.js`; `docs/HERMES_FINANCE.md` atualizado.

### Alterado

- O `/api/chat` passa a rotear perguntas **claras** de faturamento diário ("quanto vendemos hoje?", "faturamento de hoje", "como foram as vendas hoje?") para o Hermes Financeiro, antes do fluxo de templates.

### Não alterado

- Perguntas ambíguas ou fora do escopo continuam no fallback atual (SQL Templates → Claude), inalterado.
- Nenhuma nova chamada ao Claude (a resposta vem do banco/cache); SQL Templates existentes, cache e frontend não foram modificados.

## 2026-07-03 — Sprint 1 / PR-16: Fundação do Hermes Financeiro

### Adicionado

- Nova pasta `src/hermes/finance/` — fundação do módulo financeiro (o Hermes segue sendo um único sistema; sem novos agentes e sem WhatsApp).
- `finance-capabilities.js` — catálogo de 10 capacidades (`daily_revenue`, `monthly_revenue`, `accounts_receivable`, `accounts_payable`, `cash_flow`, `top_customers`, `store_comparison`, `ticket_average`, `payment_methods`, `financial_summary`) com fontes e `status`.
- `financial-intent-map.js` — `classifyFinancialIntent(question)` mapeia perguntas financeiras para capacidades (léxico/determinístico).
- `financial-response-builder.js` — `buildFinancialResponse(capability, data)` como interface (não implementada).
- Testes em `test/finance.test.js`; documentação em `docs/HERMES_FINANCE.md`; ROADMAP e HERMES_ARCHITECTURE atualizados.

### Não alterado

- Não integra ao chat: sem alteração no `/api/chat`, nos SQL Templates, no cache ou no frontend.
- Nenhuma consulta é executada; o construtor de resposta é interface (`implemented: false`). Nada removido.

## 2026-07-03 — PR-15: HIL Decision Report

### Adicionado

- `src/hermes/intelligence/report.js` com `buildDecisionReport(snapshot)` (função pura): percentuais por caminho recomendado, `topIntents` e uma recomendação operacional simples.
- Endpoint `GET /admin/hil/report` protegido por `ADMIN_SECRET`, derivado das métricas já coletadas (log `admin_hil_report`).
- Regras de recomendação: poucos dados → coletar mais; Claude > 50% → criar mais templates/respostas; SQL Template > 50% → otimizar cache/materialized views; Semantic Cache > 20% → priorizar semantic cache.
- Testes de unidade em `test/hil-report.test.js`; documentação em `docs/HIL_DECISION_REPORT.md` e entrada em `docs/ADMIN_ENDPOINTS.md`.

### Segurança

- Endpoint exige `ADMIN_SECRET` (503 sem segredo, 401 com segredo errado).
- Retorna apenas agregados/rótulos — **nunca** a pergunta real, parâmetros, SQL ou resposta.

### Não alterado

- `/api/chat` continua idêntico; nenhuma nova chamada ao Claude, sem frontend, nada removido.

## 2026-07-03 — PR-14: HIL Admin Metrics

### Adicionado

- Contadores em memória das decisões da HIL em shadow mode em `src/hermes/intelligence/metrics.js` (`recordDecision`, `snapshot`, `resetHilMetrics`): total de classificações, `byRecommendedPath`, `wouldCallClaude`/`wouldUseTemplate`/`wouldUseSemanticCache` (true/false) e intents mais comuns.
- Endpoint `GET /admin/hil/metrics` protegido por `ADMIN_SECRET`, retornando apenas métricas agregadas (log `admin_hil_metrics`).
- Registro da decisão de shadow mode nos contadores, dentro do bloco HIL do `/api/chat` (sem alterar o chat).
- Testes de unidade em `test/hil-metrics.test.js`; documentação em `docs/HIL_ADMIN_METRICS.md` e entrada em `docs/ADMIN_ENDPOINTS.md`.

### Segurança

- As métricas contêm apenas rótulos e contagens — **nunca** a pergunta real, parâmetros, SQL ou resposta.
- O endpoint exige `ADMIN_SECRET` (503 sem segredo, 401 com segredo errado).

### Não alterado

- `/api/chat` continua idêntico; nenhuma resposta muda e nenhuma chamada nova ao Claude. Sem mudança de frontend, nada removido.

## 2026-07-03 — PR-13: HIL Shadow Mode

### Adicionado

- `src/hermes/intelligence/shadow.js` com `simulateDecision(classification, question, context)` — função pura que retorna `{ recommendedPath, confidence, reason, wouldCallClaude, wouldUseTemplate, wouldUseSemanticCache, wouldUseResponseLibrary, wouldUseKnowledge }`.
- Log estruturado `hil_shadow_decision` no `/api/chat` (após `hil_classification`), com `requestId`, `intent`, `recommendedPath`, `confidence`, `reason` e as flags `wouldUse*`/`wouldCallClaude`.
- Testes de unidade em `test/hil-shadow.test.js`.
- Documentação em `docs/HIL_SHADOW_MODE.md`; ROADMAP e HERMES_ARCHITECTURE atualizados.

### Não alterado

- A decisão simulada **não** é usada para rotear: o usuário recebe exatamente a mesma resposta de hoje.
- Fluxo inalterado (SQL Templates → cache → fallback Claude); nenhuma chamada diferente ao Claude.
- Semantic Cache e Response Library **não** integrados. Sem mudança de frontend, nada removido.

## 2026-07-03 — PR-12: Fundação do Semantic Cache

### Adicionado

- Módulo `src/hermes/intelligence/semantic-cache.js` com `normalizeSemanticQuestion`, `canonicalTokenSignature`, `buildSemanticKey(classification, parameters)` e as interfaces no-op `findSemanticCacheEntry` (retorna `null`) e `saveSemanticCacheEntry` (retorna `false`).
- Chave semântica léxica estável: por `intent + parâmetros` (params independem da ordem) ou tokens canônicos quando a intenção é desconhecida.
- Tabela documentada `semantic_cache` em `docs/sql/SEMANTIC_CACHE.sql` (não aplicada; coluna `embedding` preparada para pgvector na fase futura).
- Testes de unidade em `test/semantic-cache.test.js` (equivalência de perguntas, estabilidade por parâmetros, pergunta vazia, no-ops).
- Documentação em `docs/SEMANTIC_CACHE.md`; ROADMAP e HERMES_ARCHITECTURE atualizados.

### Não alterado

- Sem embeddings e sem integração com o `/api/chat`: comportamento inalterado.
- O cache exato atual (`src/hermes/cache.js`) permanece intacto (apenas reutilizado via `stableStringify`).
- Nenhuma nova chamada ao Claude, nenhuma mudança de frontend, nada removido.

## 2026-07-03 — PR-11: Fundação da camada de aprendizado da HIL

### Adicionado

- Tabela documentada `question_statistics` em `docs/sql/QUESTION_STATISTICS.sql` (não aplicada automaticamente).
- Módulo `src/hermes/intelligence/statistics.js` com `recordQuestionStatistics()` (interface, no-op) e os agregadores (interfaces): top intents, top perguntas, top templates, maior custo, maior latência, mais cache hit, mais fallback Claude.
- Testes de unidade das interfaces em `test/statistics.test.js`.
- Documentação em `docs/HIL_ANALYTICS.md`; ROADMAP e HERMES_ARCHITECTURE atualizados.

### Não alterado

- Interfaces apenas: `recordQuestionStatistics` retorna `false` e os agregadores retornam `[]` (nada é calculado, persistido ou integrado).
- Nenhuma alteração no chat, frontend, SQL, cache, Claude ou na HIL. Nenhum arquivo removido.

## 2026-07-03 — PR-10: HIL em modo observação

### Adicionado

- Integração da HIL ao `/api/chat` em **modo observação**: `classify(question)` é chamado no início da requisição apenas para logar a decisão, sem alterar o fluxo.
- Log estruturado `hil_classification` com `requestId`, `mode: "observe"`, `intent`, `confidence`, `complexity`, `estimatedCost`, `estimatedLatency` e `recommendedPath` (+ `hil_classification_error` defensivo).
- Testes de robustez garantindo que `classify` nunca lança e sempre retorna um `recommendedPath` válido (não quebra o `/api/chat`).
- Seção "Modo observação" em `docs/HERMES_INTELLIGENCE_LAYER.md`.

### Não alterado

- `recommendedPath` não é usado para rotear: o fluxo continua SQL Templates → cache → fallback Claude, idêntico ao anterior.
- Nenhuma nova chamada ao Claude, nenhuma regra de negócio alterada, nenhum arquivo removido e nenhuma mudança de frontend.

## 2026-07-03 — PR-09: Fundação da Hermes Intelligence Layer (HIL)

### Adicionado

- Nova pasta `src/hermes/intelligence/` com a fundação da HIL (Fase 2), cujo objetivo é **reduzir o uso de IA** respondendo primeiro pelos caminhos mais baratos.
- `intent-classifier.js` — `classify(question)` retorna `{ intent, confidence, complexity, estimatedCost, estimatedLatency, recommendedPath }`, com `recommendedPath` em `response_library | semantic_cache | sql_template | workflow | knowledge | claude`.
- `response-library.js` — `findReusableResponse()` (interface apenas, sempre retorna `null`) e as colunas previstas; DDL documentada em `docs/sql/RESPONSE_LIBRARY.sql` (não aplicada automaticamente).
- `should-call-claude.js` — `shouldCallClaude()` retorna apenas `true`/`false` com base na classificação.
- Testes de unidade da fundação em `test/intelligence.test.js`.
- Documentação em `docs/HERMES_INTELLIGENCE_LAYER.md`; ROADMAP e HERMES_ARCHITECTURE atualizados.

### Não alterado

- Nenhuma integração com o `/api/chat`: comportamento atual inalterado.
- Nenhum código existente foi removido (SQL Templates, cache, guardrails, endpoints seguem iguais).
- Nenhuma nova chamada ao Claude. Nenhuma alteração de frontend nem de regra de negócio.

## 2026-07-03 — PR-08: Endpoints administrativos do Hermes

### Adicionado

- Endpoints `/admin/*` protegidos por `ADMIN_SECRET` (header `x-admin-secret`), com comparação em tempo constante.
- `GET /admin/health` — saúde do serviço e presença de configuração (apenas booleanos, nunca os valores dos segredos).
- `GET /admin/templates` — metadados dos SQL Templates, sem o SQL completo.
- `POST /admin/validate/templates` — validação somente-leitura dos templates, reutilizando `src/hermes/template-validation.js` (mesma lógica do script `scripts/validate-templates.js`, sem duplicação).
- Módulo `src/hermes/template-validation.js` extraído do script para ser compartilhado por CLI e endpoint.
- Logs estruturados `admin_auth_failed`, `admin_health_check`, `admin_template_validation_start` e `admin_template_validation_finish`.
- Testes do módulo de validação com pool falso (`test/template-validation.test.js`).
- Documentação em `docs/ADMIN_ENDPOINTS.md` e `ADMIN_SECRET` no `.env.example`.

### Segurança

- Sem `ADMIN_SECRET`, os endpoints admin ficam desabilitados (503); segredo ausente/errado retorna 401.
- Nunca expõe `DATABASE_URL`, `ANTHROPIC_API_KEY`, SQL completo ou o resultado real das queries (apenas template, status, rowCount, durationMs e erro redigido).
- O segredo nunca é registrado em log.

### Não alterado

- Nenhuma regra de negócio do chat foi modificada.
- O frontend não foi alterado.

## 2026-07-02 — PR-07: Validação real dos SQL Templates no Supabase/Railway

### Adicionado

- Script `scripts/validate-templates.js` que executa cada SQL Template contra o banco real, de forma somente-leitura, com parâmetros de teste.
- Transação `READ ONLY` + `ROLLBACK` por template: nenhuma escrita é possível; timeout por consulta via `SQL_TEMPLATE_VALIDATION_TIMEOUT_MS` (padrão 30000 ms).
- Saída apenas com metadados (template, status, rowCount, tempo e erro redigido) — nunca linhas/valores do banco.
- Falha amigável (sem conectar) quando `DATABASE_URL` não está definido; código de saída `1` se algum template falhar.
- Script npm `validate:templates`.
- Documentação em `docs/SUPABASE_TEMPLATE_VALIDATION.md`, incluindo revisão estática de schema (sem divergências encontradas).

### Não alterado

- Nenhum template foi alterado: a revisão estática não encontrou divergência de tabela/view/coluna.
- Nenhuma regra de negócio, comportamento do chat ou frontend foi modificado.
- Nenhuma query de escrita é emitida.

## 2026-07-02 — PR-06: Testes automatizados mínimos

### Adicionado

- Estrutura de testes em `test/` usando o runner nativo `node --test` (sem novas dependências).
- Testes do classificador de SQL Templates (`test/sql-templates.test.js`), incluindo regressão das 6 perguntas frequentes da tela.
- Testes de cache (`test/cache.test.js`): chave estável, hit, miss, expired e não-cacheamento de erro/TTL inválido.
- Testes de guardrails (`test/sql-guardrails.test.js`): SELECT/CTE/subquery permitidos; INSERT/UPDATE/DELETE, DROP/ALTER/TRUNCATE, CREATE/GRANT/REVOKE, múltiplas statements, comentários e schema não permitido bloqueados; LIMIT padrão aplicado/preservado.
- Script `npm test` (`node --test`).
- Documentação em `docs/TESTING.md`.

### Não alterado

- Nenhuma regra de negócio foi modificada.
- O frontend não foi alterado.
- Os testes não dependem de Supabase real nem de chaves reais.

## 2026-07-02 — PR-05: Guardrails para SQL livre remanescente

### Adicionado

- Módulo `src/hermes/sql-guardrails/index.js` com `validateSql`, que valida o SQL livre gerado pela IA (tool `query_database`) antes da execução.
- Permissão apenas para consultas de leitura (`SELECT`/`WITH`); bloqueio de `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE` e outros comandos de alto risco.
- Bloqueio de múltiplas statements, de comentários (`--`, `/* */`) e de schemas/tabelas fora da allowlist.
- Allowlist de schemas (`public`, `softcom_import`) e das views/tabelas documentadas do agente.
- `LIMIT` padrão aplicado quando a consulta não traz `LIMIT` (`SQL_GUARDRAIL_DEFAULT_LIMIT`, padrão 1000).
- Timeout específico para o SQL livre via `statement_timeout` dedicado (`SQL_GUARDRAIL_QUERY_TIMEOUT_MS`, padrão 15000 ms), resetado antes de devolver a conexão ao pool.
- Logs estruturados `sql_guardrail_pass` e `sql_guardrail_block` com motivo, `requestId` e duração.
- Documentação em `docs/SQL_GUARDRAILS.md`.

### Segurança

- Quando o SQL é bloqueado, ele não é executado e o modelo recebe uma mensagem amigável para repassar ao usuário; o fallback Claude continua funcionando com segurança.
- Guardrail é camada adicional (defense-in-depth) e não substitui usuário somente-leitura no Supabase.

### Não alterado

- Nenhuma regra de negócio foi modificada.
- O frontend não foi alterado.
- O fluxo de SQL Templates permanece inalterado (já seguro por construção).

## 2026-07-02 — PR-004: Auditoria e preparação Supabase para IA analítica

### Adicionado

- Auditoria estática do Supabase em `docs/SUPABASE_AUDIT.md`.
- Plano de performance em `docs/SUPABASE_PERFORMANCE.md`.
- Índices candidatos documentados em `docs/sql/SUPABASE_INDEX_CANDIDATES.sql`, sem migration executável nesta PR.
- Instruções para inventário real e `EXPLAIN ANALYZE` quando houver `DATABASE_URL` disponível.

### Não alterado

- Nenhuma regra de negócio foi alterada.
- API, frontend, Claude, cache e SQL Templates permanecem inalterados.
- Nenhum índice é aplicado automaticamente antes de validação real com `EXPLAIN ANALYZE`.

## 2026-07-02 — PR-03: Cache para SQL Templates

### Adicionado

- Estrutura de cache em memória para respostas de SQL Templates.
- `cache_key` estável por `templateName`, `templateVersion` e parâmetros.
- TTL por template conforme perfil: histórico, dado do dia ou relatório pesado.
- Logs estruturados para `cache_hit`, `cache_miss`, `cache_expired` e `cache_write`.
- Documentação em `docs/CACHE.md`.

### Segurança

- Erros não são cacheados.
- Perguntas fora dos templates continuam sem cache e seguem para o fallback Claude.
- SQL completo, respostas livres do Claude e resultados brutos do banco não são cacheados como metadados.

## 2026-07-02 — PR-02: SQL Templates para perguntas frequentes

### Adicionado

- Pasta `src/hermes/sql-templates/` com classificador simples por intenção e 6 SQL Templates parametrizados.
- Integração do `/api/chat` para usar template quando a pergunta casar claramente com uma pergunta frequente.
- Fallback preservado para Claude quando não houver match de template.
- Classificação mensal de faturamento exige mês e ano explícitos para evitar match em perguntas parecidas, mas ambíguas.
- Logs estruturados para `intent_detected`, `intent_fallback`, `sql_template_query_start`, `sql_template_query_finish` e `sql_template_query_error`.
- Documentação em `docs/SQL_TEMPLATES.md`.

### Não alterado

- Perguntas fora dos templates continuam usando o fluxo Claude atual.
- Não foi adicionado cache nesta PR.
- Não foi adicionado guardrail geral para SQL livre fora dos templates nesta PR.

## 2026-07-02 — PR-01: Confiabilidade e logs estruturados do `/api/chat`

### Adicionado

- Logs estruturados em JSON para o fluxo principal do chat:
  - `chat_request_received`
  - `claude_call_start`
  - `claude_call_finish`
  - `claude_call_error`
  - `database_query_start`
  - `database_query_finish`
  - `database_query_error`
  - `chat_response_ready`
  - `chat_client_closed`
  - `chat_late_error_after_timeout`
  - `chat_request_error`
  - `chat_request_finish`
- `requestId` único por chamada ao endpoint `/api/chat` para correlacionar logs.
- Medição de latência da chamada Claude, consultas SQL e tempo total da requisição.
- Registro de status final, quantidade aproximada de bytes enviados e tamanho aproximado da resposta.
- Timeout configurável para chamadas Claude via `CLAUDE_API_TIMEOUT_MS`.
- Timeout configurável da resposta HTTP/SSE via `CHAT_RESPONSE_TIMEOUT_MS`.
- Limite configurável de iterações de tool use via `MAX_TOOL_LOOPS`.
- Fallback seguro para variáveis numéricas inválidas ou não positivas.
- Tratamento explícito de timeout da resposta SSE com evento `error` seguido de `done`.
- Preservação do status `timeout` mesmo se a chamada upstream falhar depois que o SSE já foi encerrado com segurança.
- Mensagens amigáveis para erro e timeout enviadas ao usuário via SSE.
- Redação básica de dados sensíveis em logs, incluindo e-mail, CPF, CNPJ, telefone, chave Anthropic e URL de banco.

### Alterado

- O endpoint `/api/chat` agora diferencia erros de timeout, HTTP da Claude, JSON inválido, banco e erros inesperados nos logs.
- O fluxo de SSE mantém os eventos existentes (`querying`, `text`, `error`, `done`) e adiciona `requestId` nos eventos enviados.
- Erros da Claude não derrubam o servidor; o usuário recebe uma resposta amigável.

### Não alterado

- Nenhuma regra de negócio foi modificada.
- O prompt principal não foi alterado.
- A ferramenta `query_database` continua funcionando como antes.
- Não foram introduzidos SQL Templates, cache, autenticação ou guardrails nesta PR.
