# SUPABASE_AUDIT.md

Auditoria da camada Supabase para a PR-004 — preparação do banco para IA analítica.

> Data: 02/07/2026.
> Status: auditoria estática no repositório. Este ambiente não possui `DATABASE_URL` configurado, então não foi possível consultar o Supabase real nem executar `EXPLAIN ANALYZE` contra produção/staging.

## 1. Escopo solicitado

A auditoria deve cobrir, quando executada em ambiente com credenciais:

- schemas;
- tabelas;
- views;
- materialized views;
- foreign keys;
- índices;
- constraints;
- funções;
- policies/RLS;
- triggers;
- comparação com SQL Templates existentes;
- gargalos de performance e candidatos a índices/materialized views.

## 2. Acesso ao banco neste ambiente

Resultado local:

- `DATABASE_URL`: ausente.
- `psql`: não disponível no PATH deste ambiente.
- Conclusão: não é seguro afirmar que índices/views existem no Supabase real sem executar os comandos de inventário abaixo no ambiente com credenciais.

## 3. Inventário conhecido pelo repositório

### 3.1 Schemas conhecidos

- `public` — contém views analíticas usadas pelo Hermes.
- `softcom_import` — contém tabelas brutas importadas do ERP legado.

### 3.2 Views conhecidas em `public`

As views aparecem no prompt operacional e na documentação de SQL Templates:

| View | Uso atual |
|---|---|
| `public.vw_faturamento_mensal` | Faturamento mensal, comparativo anual, ticket médio. |
| `public.vw_itens_vendidos` | Produtos mais vendidos, ranking de vendedores. |
| `public.vw_contas_a_receber` | Disponível, ainda não usada diretamente por template. |
| `public.vw_inadimplencia_por_faixa` | Inadimplência recuperável por loja. |
| `public.vw_produtos_catalogo` | Disponível, ainda não usada diretamente por template. |

### 3.3 Tabelas brutas conhecidas em `softcom_import`

| Tabela | Volume informado | Uso esperado |
|---|---:|---|
| `cadastro_de_vendas` | 439.724 vendas | Base de faturamento. |
| `vendas_efetuadas` | 704.666 itens | Itens, produtos, vendedores. |
| `contas_a_receber` | 709.290 parcelas | Inadimplência e recebíveis. |
| `compras_efetuadas` | 223.159 compras | Compras/fornecedores/CMV histórico. |
| `cadastro_de_mercadorias` | 74.502 produtos | Catálogo, fornecedor, grupo/subgrupo. |
| `cadastro_clientes` | 5.208 clientes | Dados de clientes com PII mascarada. |
| `bloquetes` | 588.303 registros | Cobrança/bloquetos. |
| `financeiro_movimentacoes` | 27.846 registros | Movimentações financeiras. |

## 4. Comparação com SQL Templates atuais

| Template | Fonte atual | Status estático | Risco |
|---|---|---|---|
| `monthly_revenue_by_store` | `public.vw_faturamento_mensal` | Nome presente na documentação. | Depende de cast `mes::date`; se `mes` já for `date`, ok; se for texto irregular, pode falhar/lentificar. |
| `recoverable_delinquency_by_store` | `public.vw_inadimplencia_por_faixa` | Nome presente na documentação. | Agrega view inteira por classificação; se view não materializada pode varrer recebíveis. |
| `revenue_year_comparison_by_store` | `public.vw_faturamento_mensal` | Nome presente na documentação. | Usa `EXTRACT(YEAR FROM mes::date)`, que pode impedir uso eficiente de índice simples em `mes`. |
| `top_products_last_six_months` | `public.vw_itens_vendidos` | Nome presente na documentação. | Pode ficar pesado com milhões de itens por `GROUP BY produto`. |
| `top_salespeople_by_year` | `public.vw_itens_vendidos` | Nome presente na documentação. | `COUNT(DISTINCT codigo_da_venda)` + agrupamento por vendedor pode ser caro. |
| `average_ticket_last_three_months` | `public.vw_faturamento_mensal` | Nome presente na documentação. | Baixo risco se view mensal já estiver agregada. |

### 4.1 Templates que usam tabelas/views inexistentes

Não foi possível confirmar contra Supabase real neste ambiente. Estaticamente, todos usam views documentadas no projeto.

### 4.2 Nomes potencialmente incorretos

Riscos a validar no Supabase real:

- `mes` em `vw_faturamento_mensal` precisa aceitar `mes::date`.
- `itemdevolvido` em `vw_itens_vendidos` precisa existir e aceitar `itemdevolvido::text`.
- `status_parcela` existe em `vw_contas_a_receber`, mas o template atual de inadimplência usa `vw_inadimplencia_por_faixa`.
- Colunas brutas dos índices candidatos podem ter nomes diferentes; por isso os índices ficaram apenas documentados e não são aplicados nesta PR.

### 4.3 JOINs desnecessários

Nenhum template atual faz `JOIN`. Isso é positivo para latência e previsibilidade.

### 4.4 Consultas com risco de lentidão em milhões de registros

Maior risco:

1. `top_products_last_six_months` — agrupamento por `codigo_produto, produto` em itens vendidos.
2. `top_salespeople_by_year` — `COUNT(DISTINCT codigo_da_venda)` e agrupamento por `loja, vendedor`.
3. `recoverable_delinquency_by_store` — depende do custo interno da view de inadimplência.
4. `revenue_year_comparison_by_store` — `EXTRACT(YEAR FROM mes::date)` pode reduzir uso de índice.

## 5. Queries de inventário para executar no Supabase

Execute em ambiente seguro com usuário read-only/admin apropriado.

### 5.1 Schemas

```sql
SELECT schema_name
FROM information_schema.schemata
ORDER BY schema_name;
```

### 5.2 Tabelas e views

```sql
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_type, table_name;
```

### 5.3 Materialized views

```sql
SELECT schemaname, matviewname, definition
FROM pg_matviews
ORDER BY schemaname, matviewname;
```

### 5.4 Colunas

```sql
SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema IN ('public', 'softcom_import')
ORDER BY table_schema, table_name, ordinal_position;
```

### 5.5 Índices

```sql
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname IN ('public', 'softcom_import')
ORDER BY schemaname, tablename, indexname;
```

### 5.6 Foreign keys

```sql
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema IN ('public', 'softcom_import')
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name;
```

### 5.7 Constraints

```sql
SELECT constraint_schema, table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE constraint_schema IN ('public', 'softcom_import')
ORDER BY constraint_schema, table_name, constraint_name;
```

### 5.8 Funções

```sql
SELECT n.nspname AS schema, p.proname AS function_name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'softcom_import')
ORDER BY n.nspname, p.proname;
```

### 5.9 Policies/RLS

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'softcom_import')
ORDER BY schemaname, tablename, policyname;
```

### 5.10 Triggers

```sql
SELECT event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema IN ('public', 'softcom_import')
ORDER BY event_object_schema, event_object_table, trigger_name;
```

## 6. Decisão da revisão pré-merge

A revisão pré-merge identificou risco de bloquear tabelas grandes caso uma migration de índices fosse aplicada sem `EXPLAIN ANALYZE` real. Por isso, a PR-004 mantém auditoria e documentação, mas não entrega migration executável de índices. Os candidatos estão em `docs/sql/SUPABASE_INDEX_CANDIDATES.sql` como referência para aplicação futura validada.

## 7. EXPLAIN ANALYZE a executar posteriormente

Substitua os parâmetros conforme necessário.

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT loja, SUM(qtd_vendas)::int, SUM(faturamento_liquido)::numeric
FROM public.vw_faturamento_mensal
WHERE mes::date >= '2026-06-01'::date
  AND mes::date < ('2026-06-01'::date + interval '1 month')
  AND loja NOT LIKE '%DESATIVADO%'
GROUP BY loja
ORDER BY SUM(faturamento_liquido) DESC;
```

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT codigo_produto, produto, SUM(quantidade)::numeric, SUM(valor_total)::numeric
FROM public.vw_itens_vendidos
WHERE data_venda::date >= (CURRENT_DATE - interval '6 months')::date
  AND data_venda::date <= CURRENT_DATE
  AND loja NOT LIKE '%DESATIVADO%'
  AND (itemdevolvido IS NULL OR itemdevolvido::text <> 'True')
GROUP BY codigo_produto, produto
ORDER BY SUM(quantidade) DESC, SUM(valor_total) DESC
LIMIT 10;
```

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT loja, vendedor, COUNT(DISTINCT codigo_da_venda), SUM(quantidade)::numeric, SUM(valor_total)::numeric
FROM public.vw_itens_vendidos
WHERE data_venda::date >= '2025-01-01'::date
  AND data_venda::date < '2026-01-01'::date
  AND loja NOT LIKE '%DESATIVADO%'
  AND vendedor IS NOT NULL
  AND vendedor <> ''
  AND (itemdevolvido IS NULL OR itemdevolvido::text <> 'True')
GROUP BY loja, vendedor
ORDER BY SUM(valor_total) DESC
LIMIT 15;
```
