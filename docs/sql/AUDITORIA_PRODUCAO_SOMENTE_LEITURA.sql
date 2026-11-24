-- Auditoria somente leitura do projeto Supabase de dados das lojas
-- (yxmdrrwqxwzsdgcgskrm: softcom_import, views public, hermes_history).
-- Blocos 1–8 rodam nele; o bloco 9 roda no projeto hermes-brain.
--
-- Como usar: Supabase Dashboard -> SQL Editor -> cole e rode bloco a bloco.
-- Tudo aqui é SELECT. Nenhuma linha altera dados, schema ou permissões.
-- A sessão é forçada para somente leitura logo abaixo. Se um bloco falhar
-- (ex.: pg_cron desligado no bloco 7), rode os demais separadamente.

SET default_transaction_read_only = on;

-- 1) Frescor dos dados: até quando existe venda registrada?
--    Esperado hoje (código): histórico termina em 2026-06-08.
SELECT 'vw_faturamento_mensal' AS fonte, max(mes)::text AS ultimo
  FROM public.vw_faturamento_mensal
UNION ALL
SELECT 'vw_itens_vendidos', max(data_venda)::text
  FROM public.vw_itens_vendidos
UNION ALL
SELECT 'vw_contas_a_receber (venda)', max(data_venda)::text
  FROM public.vw_contas_a_receber;

-- 2) Existe algum schema com dados Linx / pós-migração?
SELECT nspname AS schema
  FROM pg_namespace
 WHERE nspname !~ '^(pg_|information_schema)'
 ORDER BY 1;

-- 3) Tabelas sem RLS em schemas expostos ou sensíveis.
SELECT n.nspname AS schema, c.relname AS tabela,
       c.relrowsecurity AS rls_ligado, c.relforcerowsecurity AS rls_forcado
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p')
   AND n.nspname IN ('public', 'softcom_import', 'hermes_history', 'hermes_brain')
 ORDER BY rls_ligado, 1, 2;

-- 4) O que os papéis da API pública (anon/authenticated) conseguem ler?
--    Qualquer linha aqui com softcom_import ou cadastro_clientes é alerta.
SELECT grantee, table_schema, table_name, string_agg(privilege_type, ',') AS privilegios
  FROM information_schema.role_table_grants
 WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')
   AND table_schema IN ('public', 'softcom_import', 'hermes_history', 'hermes_brain')
 GROUP BY 1, 2, 3
 ORDER BY 2, 3, 1;

-- 5) Views que rodam com permissão do dono (ignoram RLS de quem consulta).
SELECT n.nspname AS schema, c.relname AS view,
       coalesce(c.reloptions::text, '') AS opcoes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'v'
   AND n.nspname IN ('public', 'hermes_history', 'hermes_brain')
   AND coalesce(c.reloptions::text, '') NOT LIKE '%security_invoker=true%'
 ORDER BY 1, 2;

-- 6) Papéis de login usados pelo Hermes e seus atributos.
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolconnlimit
  FROM pg_roles
 WHERE rolname LIKE 'hermes%' OR rolname IN ('postgres', 'authenticator')
 ORDER BY 1;

-- 7) Jobs agendados (há alguma sincronização automática rodando?).
--    Se der erro "relation cron.job does not exist", o pg_cron não está ativo.
SELECT jobid, jobname, schedule, active, left(command, 120) AS comando
  FROM cron.job
 ORDER BY jobid;

-- 8) Tamanho das maiores tabelas (para custo e plano do Supabase).
SELECT n.nspname AS schema, c.relname AS tabela,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho,
       c.reltuples::bigint AS linhas_estimadas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p', 'm')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
 ORDER BY pg_total_relation_size(c.oid) DESC
 LIMIT 20;

-- 9) Segundo cérebro. ATENÇÃO: o schema hermes_brain fica em OUTRO projeto,
--    "hermes-brain" (asceucchdnuoaqgdjbtg). Rode este bloco no SQL Editor
--    daquele projeto, não no de dados das lojas.
--    Quantos itens aprovados e quantos já expiraram?
SELECT status,
       count(*) AS itens,
       count(*) FILTER (WHERE expires_at <= now()) AS expirados,
       max(expires_at) AS expira_mais_tarde
  FROM hermes_brain.memory_items
 GROUP BY status
 ORDER BY 1;
