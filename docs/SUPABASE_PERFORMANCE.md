# SUPABASE_PERFORMANCE.md

Plano de performance Supabase para o Hermes.

> PR-004 não altera API, frontend, Claude, cache ou SQL Templates. O objetivo é preparar e documentar o banco para alta performance analítica.

## 1. Princípios

1. Otimizar primeiro os caminhos determinísticos dos SQL Templates.
2. Preferir views/materialized views para agregações recorrentes.
3. Indexar colunas de filtro, período e agrupamento usadas por relatórios.
4. Evitar índices sem validação em tabelas muito grandes.
5. Usar `EXPLAIN (ANALYZE, BUFFERS)` antes e depois de mudanças críticas.
6. Criar mudanças via migrations versionadas.
7. Evitar `CREATE INDEX` bloqueante em horário comercial quando a tabela for grande.

## 2. Análise por SQL Template

### 2.1 `monthly_revenue_by_store`

Fonte: `public.vw_faturamento_mensal`.

- Custo esperado: baixo se a view já é agregada mensalmente.
- JOINs: 0.
- Risco de scan: médio se a view recalcula tabela bruta inteira.
- Índices úteis no bruto: `(data_venda, loja)` em `softcom_import.cadastro_de_vendas`.
- Cache atual: 24h.
- Materialized view: recomendada se `vw_faturamento_mensal` for view normal sobre vendas brutas.

Melhoria recomendada:

- Validar se `vw_faturamento_mensal` é view normal ou materialized view.
- Evitar cast recorrente `mes::date` se `mes` já puder ser armazenado como `date` na camada agregada.

### 2.2 `recoverable_delinquency_by_store`

Fonte: `public.vw_inadimplencia_por_faixa`.

- Custo esperado: médio.
- JOINs: 0 no template; desconhecido dentro da view.
- Risco de scan: alto se classificação é calculada dinamicamente sobre `contas_a_receber` inteira.
- Índices úteis no bruto: `(data_vencimento, loja)` e `(status_parcela, data_vencimento)`.
- Cache atual: 10min.
- Materialized view: recomendada para snapshot por faixa/classificação, atualizada em agenda.

Melhoria recomendada:

- Criar materialização de inadimplência por loja/faixa/classificação se `EXPLAIN` mostrar scan alto.

### 2.3 `revenue_year_comparison_by_store`

Fonte: `public.vw_faturamento_mensal`.

- Custo esperado: baixo a médio.
- JOINs: 0.
- Risco de scan: médio por uso de `EXTRACT(YEAR FROM mes::date)`.
- Índices úteis: agregação mensal materializada com índice em `(mes, loja)`.
- Cache atual: 7 dias.
- Materialized view: a mesma de faturamento mensal resolve.

Melhoria recomendada:

- No futuro, trocar filtro por intervalo de datas já usado no `WHERE` e evitar depender de expressão no `SELECT` para performance.

### 2.4 `top_products_last_six_months`

Fonte: `public.vw_itens_vendidos`.

- Custo esperado: alto em milhões de itens.
- JOINs: 0 no template; desconhecido dentro da view.
- Risco de scan: alto por filtro de 6 meses + `GROUP BY codigo_produto, produto` + ordenação por agregados.
- Índices úteis no bruto: `(data_venda, codigo_produto)`, `(loja, itemdevolvido)`.
- Cache atual: 1h.
- Materialized view: recomendada para ranking diário/mensal de produtos.

Melhoria recomendada:

- Criar materialized view agregada por mês, loja, produto, quantidade e valor.
- Para ranking global dos últimos 6 meses, consultar agregados mensais em vez de itens brutos.

### 2.5 `top_salespeople_by_year`

Fonte: `public.vw_itens_vendidos`.

- Custo esperado: alto.
- JOINs: 0 no template; desconhecido dentro da view.
- Risco de scan: alto por período anual, `COUNT(DISTINCT codigo_da_venda)` e agrupamento por loja/vendedor.
- Índices úteis no bruto: `(data_venda, vendedor)`, `(loja, itemdevolvido)`.
- Cache atual: 24h.
- Materialized view: recomendada para ranking mensal/anual de vendedores.

Melhoria recomendada:

- Materializar vendas por mês/loja/vendedor com quantidade de vendas, itens e faturamento.

### 2.6 `average_ticket_last_three_months`

Fonte: `public.vw_faturamento_mensal`.

- Custo esperado: baixo se mensal já agregado.
- JOINs: 0.
- Risco de scan: baixo a médio.
- Índices úteis: `(mes, loja)` na materialização mensal.
- Cache atual: 15min.
- Materialized view: a mesma de faturamento mensal resolve.

## 3. Índices candidatos

A PR-004 não inclui migration executável de índices, para evitar bloqueio acidental em tabelas grandes sem `EXPLAIN ANALYZE` real. Os candidatos ficam documentados em `docs/sql/SUPABASE_INDEX_CANDIDATES.sql` e devem ser aplicados somente após validar nomes, planos e impacto. Quando aplicados em produção, prefira `CREATE INDEX CONCURRENTLY` com `lock_timeout = '5s'` e `statement_timeout = '10min'`.

| Índice | Motivo |
|---|---|
| `idx_ai_cadastro_de_vendas_data_loja` | Acelerar faturamento por período e loja. |
| `idx_ai_vendas_efetuadas_data_produto` | Acelerar ranking de produtos por período. |
| `idx_ai_vendas_efetuadas_data_vendedor` | Acelerar ranking de vendedores por período. |
| `idx_ai_vendas_efetuadas_loja_devolvido` | Acelerar filtros por loja e item devolvido. |
| `idx_ai_contas_a_receber_vencimento_loja` | Acelerar inadimplência por vencimento e loja. |
| `idx_ai_contas_a_receber_status_vencimento` | Acelerar recebíveis por status e vencimento. |
| `idx_ai_cadastro_de_mercadorias_fornecedor` | Preparar consultas por fornecedor. |
| `idx_ai_cadastro_de_mercadorias_grupo_subgrupo` | Preparar consultas por categoria/subcategoria. |

## 4. Materialized views candidatas

### 4.1 `mv_ai_faturamento_mensal_loja`

Compensa se `vw_faturamento_mensal` for view dinâmica.

Grão sugerido:

- mês;
- loja;
- quantidade de vendas;
- faturamento bruto;
- desconto;
- faturamento líquido;
- ticket médio.

### 4.2 `mv_ai_produtos_vendidos_mensal`

Compensa para top produtos, curva ABC e relatórios de compras/estoque.

Grão sugerido:

- mês;
- loja;
- código do produto;
- produto;
- quantidade;
- valor total.

### 4.3 `mv_ai_vendedores_mensal`

Compensa para rankings e metas.

Grão sugerido:

- mês;
- loja;
- vendedor;
- vendas distintas;
- itens vendidos;
- faturamento.

### 4.4 `mv_ai_inadimplencia_loja_faixa`

Compensa se inadimplência atual calcular faixas dinamicamente.

Grão sugerido:

- data do snapshot;
- loja;
- faixa;
- classificação;
- quantidade de parcelas;
- valor em aberto;
- média de atraso.

### 4.5 `mv_ai_indicadores_diretoria_diario`

Compensa quando houver dashboard executivo recorrente.

Indicadores:

- faturamento D-1/M-1/YTD;
- ticket médio;
- inadimplência recuperável;
- ranking lojas;
- alertas de anomalia.

## 5. Estratégia de crescimento

### Curto prazo

- Validar nomes reais de colunas e índices existentes.
- Rodar `EXPLAIN ANALYZE` dos templates.
- Aplicar apenas índices comprovadamente necessários.
- Monitorar latência por `sql_template_query_finish`.

### Médio prazo

- Criar materialized views para rankings pesados.
- Agendar refresh fora do horário comercial.
- Usar `REFRESH MATERIALIZED VIEW CONCURRENTLY` quando houver índice único compatível.
- Comparar resultados com Metabase.

### Longo prazo

- Separar camada analítica de operacional.
- Considerar read replica ou warehouse se volume crescer muito.
- Usar catálogo semântico de métricas.
- Criar jobs incrementais para agregações.

## 6. Como validar posteriormente

1. Executar queries de inventário em `docs/SUPABASE_AUDIT.md`.
2. Confirmar nomes reais de colunas/tabelas.
3. Rodar `EXPLAIN (ANALYZE, BUFFERS)` para cada template.
4. Criar uma migration futura em staging somente para índices aprovados após `EXPLAIN`.
5. Repetir `EXPLAIN` e comparar:
   - tempo total;
   - buffers lidos;
   - scans sequenciais;
   - uso de índices;
   - custo estimado vs real.
6. Só então aplicar em produção, preferencialmente com `CREATE INDEX CONCURRENTLY` para tabelas grandes.
