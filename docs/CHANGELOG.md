# CHANGELOG.md



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
