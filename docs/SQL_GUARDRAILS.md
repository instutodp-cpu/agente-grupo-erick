# SQL_GUARDRAILS.md

Documentação da PR-05: guardrails para SQL livre remanescente no fallback Claude.

## Objetivo

Reduzir risco de SQL perigoso enquanto o Hermes ainda permite que o Claude use a ferramenta `query_database` para perguntas fora dos SQL Templates.

Os SQL Templates continuam sendo o caminho preferencial para perguntas frequentes. Estes guardrails protegem apenas o fallback com SQL livre gerado por IA.

## Onde o SQL livre é recebido

O SQL livre chega no backend pelo tool use `query_database` dentro do endpoint `/api/chat`. Antes desta PR, o SQL recebido era enviado diretamente para `queryDatabase(sql)`. Agora ele passa por `validateFreeformSql` antes de qualquer execução.

## Arquivos

- `src/hermes/sql-guardrails.js`
  - valida SQL livre;
  - bloqueia comandos perigosos;
  - valida relações permitidas;
  - aplica `LIMIT` padrão;
  - limita `LIMIT` exagerado.
- `server.js`
  - chama os guardrails antes de executar `query_database`;
  - registra logs de pass/block;
  - usa timeout específico para SQL livre.

## Regras implementadas

### Permitido

- Apenas SQL iniciado por `SELECT`.
- Relações explicitamente permitidas em allowlist.
- Um único statement.
- Um `LIMIT` seguro ou `LIMIT` padrão aplicado automaticamente.

### Bloqueado

- `INSERT`
- `UPDATE`
- `DELETE`
- `DROP`
- `ALTER`
- `TRUNCATE`
- `CREATE`
- `GRANT`
- `REVOKE`
- múltiplas statements
- comentários `--`, `/*`, `*/`
- chamadas perigosas como `pg_sleep`, `dblink`, `pg_read_file`, `pg_ls_dir`, `lo_import`, `lo_export`, `pg_terminate_backend`, `set_config`, `current_setting`
- relações fora da allowlist

## Allowlist inicial

### `public`

- `public.vw_faturamento_mensal`
- `public.vw_itens_vendidos`
- `public.vw_contas_a_receber`
- `public.vw_inadimplencia_por_faixa`
- `public.vw_produtos_catalogo`

### `softcom_import`

- `softcom_import.cadastro_de_vendas`
- `softcom_import.vendas_efetuadas`
- `softcom_import.contas_a_receber`
- `softcom_import.compras_efetuadas`
- `softcom_import.cadastro_de_mercadorias`
- `softcom_import.cadastro_clientes`
- `softcom_import.bloquetes`
- `softcom_import.financeiro_movimentacoes`

## LIMIT padrão

Variáveis:

- `SQL_GUARDRAIL_DEFAULT_LIMIT` — padrão: `500`.
- `SQL_GUARDRAIL_MAX_LIMIT` — padrão: `1000`.

Comportamento:

- Se a query não tiver `LIMIT`, o Hermes adiciona `LIMIT 500`.
- Se a query tiver `LIMIT` maior que `1000`, o Hermes reduz para `LIMIT 1000`.

## Timeout específico

Variável:

- `SQL_QUERY_TIMEOUT_MS` — padrão: `45000` ms.

O timeout é aplicado apenas às consultas SQL livres aprovadas pelos guardrails. SQL Templates continuam usando o fluxo existente.

## Logs

### `sql_guardrail_pass`

Emitido quando o SQL livre passa nos guardrails.

Campos:

- `requestId`
- `toolCallCount`
- `durationMs`
- `sqlLength`
- `relations`
- `defaultLimitApplied`
- `timeoutMs`

### `sql_guardrail_block`

Emitido quando o SQL livre é bloqueado.

Campos:

- `requestId`
- `toolCallCount`
- `reason`
- `relation` quando aplicável
- `durationMs`
- `sqlLength`

O SQL completo não é logado.

## Resposta ao usuário quando bloquear

Quando uma consulta é bloqueada, o usuário recebe:

> Não consegui executar essa consulta com segurança. Posso tentar responder de outra forma ou pedir uma pergunta mais específica.

## Limitações conhecidas

- O parser é conservador e baseado em regras; pode bloquear SQL complexo que seja seguro.
- CTEs com `WITH` não são permitidas nesta primeira versão, porque a regra atual exige início com `SELECT`.
- Subqueries são permitidas somente se as relações encontradas por `FROM`/`JOIN` estiverem na allowlist.
- A allowlist deve ser revisada quando novos templates, views ou MCP tools forem adicionados.
