# SQL Guardrails — proteção do SQL livre gerado pela IA

## Contexto

O agente Hermes responde perguntas de gestão. Quando uma pergunta **não casa**
com um SQL Template (fluxo determinístico e parametrizado), o pedido cai no
**fallback Claude**, no qual o modelo pode gerar **SQL livre** e executá-lo via
a tool `query_database` (`server.js`, endpoint `/api/chat`).

Esse SQL livre é a única superfície em que texto gerado por IA chega ao banco.
Os guardrails desta PR adicionam uma camada de validação **defense-in-depth**
antes de qualquer execução, sem alterar regra de negócio nem o frontend.

## Onde atua

- Módulo: `src/hermes/sql-guardrails/index.js` (`validateSql`).
- Integração: no laço de tool use do `/api/chat`, o SQL do `query_database` é
  validado por `validateSql(sql)` **antes** de `queryDatabase(...)`.
- O caminho de **SQL Templates** não passa por aqui: ele já é seguro por
  construção (SQL fixo com parâmetros via bind).

## Regras aplicadas

Uma consulta só é executada se passar por **todas** as regras:

1. **Apenas leitura**: deve começar com `SELECT` ou `WITH` (CTE de leitura).
2. **Comandos perigosos bloqueados** (por palavra-chave, case-insensitive):
   `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`,
   `GRANT`, `REVOKE` — e, por coerência com "apenas leitura", também
   `MERGE`, `REPLACE`, `CALL`, `EXECUTE`, `EXEC`, `COPY`, `VACUUM`,
   `REINDEX`, `COMMENT`, `DO` e `INTO` (bloqueia `SELECT ... INTO`).
3. **Statement única**: um único `;` final é tolerado; qualquer outro `;`
   indica múltiplas statements e é bloqueado.
4. **Sem comentários**: presença de `--`, `/*` ou `*/` bloqueia a consulta
   (vetor comum de injeção/ocultação).
5. **Allowlist de schemas/relações**: toda relação após `FROM`/`JOIN` precisa
   estar autorizada. Referências qualificadas exigem schema permitido.
6. **LIMIT padrão**: se a consulta não tiver nenhum `LIMIT`, um
   `LIMIT <padrão>` é anexado automaticamente.

Quando uma regra falha, a consulta **não é executada** e o modelo recebe uma
**mensagem amigável** como resultado da tool, que ele repassa ao usuário. O
fluxo de fallback continua funcionando normalmente.

## Allowlist

Schemas permitidos: `public`, `softcom_import`.

Relações permitidas:

| Schema           | Relação                       |
| ---------------- | ----------------------------- |
| `public`         | `vw_faturamento_mensal`       |
| `public`         | `vw_itens_vendidos`           |
| `public`         | `vw_contas_a_receber`         |
| `public`         | `vw_inadimplencia_por_faixa`  |
| `public`         | `vw_produtos_catalogo`        |
| `softcom_import` | `cadastro_de_vendas`          |
| `softcom_import` | `vendas_efetuadas`            |
| `softcom_import` | `contas_a_receber`            |
| `softcom_import` | `compras_efetuadas`           |
| `softcom_import` | `cadastro_de_mercadorias`     |
| `softcom_import` | `cadastro_clientes`           |
| `softcom_import` | `bloquetes`                   |
| `softcom_import` | `financeiro_movimentacoes`    |

CTEs definidas na própria consulta (`WITH nome AS (...)`) são reconhecidas e não
são tratadas como tabelas externas. Subqueries (`FROM ( SELECT ... )`) têm seus
`FROM` internos validados individualmente.

## Timeout específico

O SQL livre é executado com um `statement_timeout` dedicado (menor que o
padrão global do pool), aplicado apenas para essa consulta e resetado antes de
devolver a conexão ao pool.

## Configuração (variáveis de ambiente)

| Variável                          | Padrão  | Descrição                                        |
| --------------------------------- | ------- | ------------------------------------------------ |
| `SQL_GUARDRAIL_DEFAULT_LIMIT`     | `1000`  | LIMIT aplicado quando a consulta não traz LIMIT. |
| `SQL_GUARDRAIL_QUERY_TIMEOUT_MS`  | `15000` | `statement_timeout` (ms) do SQL livre.           |

## Observabilidade

Cada validação gera um log estruturado, correlacionado por `requestId`:

- `sql_guardrail_pass` — `requestId`, `toolCallCount`, `appliedLimit`,
  `durationMs`.
- `sql_guardrail_block` — `requestId`, `toolCallCount`, `reason`, `detail`,
  `durationMs`, `sqlLength`.

Motivos possíveis de bloqueio (`reason`): `not_a_string`, `empty_sql`,
`comment_detected`, `multiple_statements`, `not_select`, `blocked_keyword`,
`disallowed_schema`, `disallowed_relation`.

## Limitações

- A validação é baseada em análise léxica/regex, não em um parser SQL completo.
  É uma camada de defesa adicional, não substitui permissões restritas no banco
  (usuário somente-leitura no Supabase continua sendo a defesa primária).
- Não altera o comportamento dos SQL Templates nem qualquer regra de negócio.
