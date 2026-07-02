-- PR-004 — Candidate indexes for Hermes analytical AI workloads.
--
-- NOT A MIGRATION. Do not apply before running the inventory queries and
-- EXPLAIN ANALYZE documented in docs/SUPABASE_AUDIT.md.
--
-- Recommended production flow:
-- 1. Confirm each table and column exists.
-- 2. Run EXPLAIN (ANALYZE, BUFFERS) for the affected SQL Template.
-- 3. Apply only indexes that are justified by real plans.
-- 4. Prefer CREATE INDEX CONCURRENTLY in a low-traffic window.
--
-- Suggested session safety settings:
-- SET lock_timeout = '5s';
-- SET statement_timeout = '10min';

-- Faturamento por período e loja.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_cadastro_de_vendas_data_loja
--   ON softcom_import.cadastro_de_vendas (data_venda, loja);

-- Ranking de produtos por período.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_vendas_efetuadas_data_produto
--   ON softcom_import.vendas_efetuadas (data_venda, codigo_produto);

-- Ranking de vendedores por período.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_vendas_efetuadas_data_vendedor
--   ON softcom_import.vendas_efetuadas (data_venda, vendedor);

-- Filtros comuns de loja e item devolvido.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_vendas_efetuadas_loja_devolvido
--   ON softcom_import.vendas_efetuadas (loja, itemdevolvido);

-- Inadimplência por vencimento e loja.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_contas_a_receber_vencimento_loja
--   ON softcom_import.contas_a_receber (data_vencimento, loja);

-- Recebíveis por status e vencimento.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_contas_a_receber_status_vencimento
--   ON softcom_import.contas_a_receber (status_parcela, data_vencimento);

-- Consultas futuras por fornecedor.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_cadastro_de_mercadorias_fornecedor
--   ON softcom_import.cadastro_de_mercadorias (fornecedor);

-- Consultas futuras por categoria/subcategoria.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_cadastro_de_mercadorias_grupo_subgrupo
--   ON softcom_import.cadastro_de_mercadorias (grupo, subgrupo);
