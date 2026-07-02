# OBSERVABILITY.md

Guia inicial de observabilidade do Hermes.

## Objetivo

A PR-01 adiciona observabilidade mínima ao endpoint `/api/chat` para investigar respostas complexas demorando, falhando ou não sendo entregues. O foco é confiabilidade operacional sem alterar a arquitetura principal.

## Eventos estruturados

Todos os eventos são escritos em JSON no `stdout`/`stderr`, para integração natural com logs do Railway.

### `chat_request_received`

Emitido quando o backend recebe uma chamada em `/api/chat`.

Campos principais:

- `requestId`
- `messageCount`
- `questionLength`
- `questionPreview`

Observação: `questionPreview` é truncado e passa por redação básica para evitar exposição acidental de dados sensíveis.

### `claude_call_start`

Emitido antes de chamar a API Claude.

Campos principais:

- `requestId`
- `loopNumber`
- `timeoutMs`

### `claude_call_finish`

Emitido quando a chamada Claude retorna com sucesso.

Campos principais:

- `requestId`
- `loopNumber`
- `durationMs`
- `stopReason`
- `contentBlocks`

### `claude_call_error`

Emitido quando a chamada Claude falha ou expira.

Campos principais:

- `requestId`
- `loopNumber`
- `durationMs`
- `errorType`
- `statusCode`

### `database_query_start`

Emitido antes de executar a ferramenta `query_database`.

Campos principais:

- `requestId`
- `toolCallCount`
- `description`
- `sqlLength`

Importante: o SQL completo não é logado nesta PR para reduzir risco de exposição de dados sensíveis.

### `database_query_finish`

Emitido quando a query termina com sucesso.

Campos principais:

- `requestId`
- `toolCallCount`
- `durationMs`
- `rowCount`

### `database_query_error`

Emitido quando a query falha.

Campos principais:

- `requestId`
- `toolCallCount`
- `durationMs`
- `errorType`

### `chat_response_ready`

Emitido quando a resposta final do assistente está pronta para envio.

Campos principais:

- `requestId`
- `responseTextLength`
- `approximateResponseBytes`

### `chat_client_closed`

Emitido quando a conexão é encerrada antes da resposta ser finalizada.

Campos principais:

- `requestId`
- `durationMs`
- `status`

### `chat_response_timeout`

Emitido quando a resposta SSE excede `CHAT_RESPONSE_TIMEOUT_MS` antes de finalizar. O servidor tenta enviar um evento `error` amigável seguido de `done` antes de encerrar a conexão.

Campos principais:

- `requestId`
- `status`
- `timeoutMs`
- `durationMs`

### `chat_late_error_after_timeout`

Emitido quando uma chamada upstream falha depois que o SSE já foi encerrado por timeout. Mantém o status final como `timeout` para não mascarar a causa percebida pelo usuário.

Campos principais:

- `requestId`
- `status`
- `durationMs`
- `errorType`

### `chat_request_error`

Emitido quando o fluxo do chat falha antes de concluir com sucesso.

Campos principais:

- `requestId`
- `status`
- `durationMs`
- `errorType`

### `chat_request_finish`

Emitido sempre ao final do fluxo.

Campos principais:

- `requestId`
- `status`
- `durationMs`
- `responseBytes`
- `toolCallCount`

## Variáveis de ambiente

### `CLAUDE_API_TIMEOUT_MS`

Timeout da chamada para a API Claude.

Padrão: `120000` ms. Valores inválidos, vazios ou não positivos voltam para esse padrão.

### `CHAT_RESPONSE_TIMEOUT_MS`

Timeout geral da resposta HTTP/SSE.

Padrão: `180000` ms. Valores inválidos, vazios ou não positivos voltam para esse padrão.

### `MAX_TOOL_LOOPS`

Número máximo de ciclos de tool use permitidos em uma requisição.

Padrão: `6`. Valores inválidos, vazios ou não positivos voltam para esse padrão.

## Segurança dos logs

A PR-01 evita logar:

- Chaves de API.
- Connection string do banco.
- SQL completo.
- Resultado completo de queries.
- Conteúdo completo da conversa.

A função de redação remove padrões comuns de:

- E-mail.
- CPF.
- CNPJ.
- Telefone.
- Chave Anthropic.
- URL de banco PostgreSQL.

## Como investigar lentidão

1. Localize o `requestId` em `chat_request_received`.
2. Compare `durationMs` de `claude_call_finish` e `database_query_finish`.
3. Veja `toolCallCount` em `chat_request_finish`.
4. Verifique `rowCount` para identificar respostas grandes do banco.
5. Verifique `status` final:
   - `success`
   - `timeout`
   - `claude_http_error`
   - `claude_invalid_json`
   - `MAX_TOOL_LOOPS_EXCEEDED`
   - outros códigos de erro.
