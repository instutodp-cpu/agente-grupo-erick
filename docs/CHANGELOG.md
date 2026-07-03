# CHANGELOG.md



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
