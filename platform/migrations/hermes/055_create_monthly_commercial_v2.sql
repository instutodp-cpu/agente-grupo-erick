-- Hermes business intelligence: auditable monthly commercial aggregate V2.
-- Structural/read-only migration. It does not replace the existing V1 view.
-- Apply only in an isolated, reviewed database environment.
BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes_history;
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_history_reader') THEN
    CREATE ROLE hermes_history_reader NOLOGIN NOINHERIT;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'hermes_history_reader'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
        OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'hermes_history_reader com atributos inesperados';
  END IF;
END
$role$;
REVOKE ALL ON SCHEMA hermes_history FROM PUBLIC;

CREATE VIEW hermes_history.monthly_commercial_v2 AS
WITH raw AS (
  SELECT
    NULLIF(btrim(data_da_venda::text), '') AS date_text,
    NULLIF(btrim(lojaorigem::text), '') AS raw_store,
    lower(NULLIF(btrim(cancelado::text), '')) AS cancelled_text,
    NULLIF(btrim(valor_pago::text), '') AS paid_text
  FROM softcom_import.cadastro_de_vendas
),
normalized AS (
  SELECT
    CASE
      WHEN date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T].*)?$'
        THEN replace(left(date_text, 10), '-', '')
      WHEN date_text ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}([ T].*)?$'
        THEN substr(date_text, 7, 4) || substr(date_text, 4, 2) || substr(date_text, 1, 2)
      ELSE NULL
    END AS ymd,
    raw_store,
    cancelled_text,
    CASE
      WHEN paid_text IS NULL THEN 0::numeric
      WHEN paid_text ~ '^-?[0-9]+([.,][0-9]{1,2})?$'
        THEN replace(paid_text, ',', '.')::numeric
      ELSE NULL
    END AS paid_amount
  FROM raw
),
parts AS (
  SELECT
    ymd,
    NULLIF(substr(ymd, 1, 4), '')::int AS year_number,
    NULLIF(substr(ymd, 5, 2), '')::int AS month_number,
    NULLIF(substr(ymd, 7, 2), '')::int AS day_number,
    raw_store,
    cancelled_text,
    paid_amount
  FROM normalized
),
parsed AS (
  SELECT
    CASE
      WHEN ymd IS NULL THEN NULL::date
      WHEN year_number NOT BETWEEN 2000 AND extract(year FROM current_date)::int THEN NULL::date
      WHEN month_number NOT BETWEEN 1 AND 12 THEN NULL::date
      WHEN day_number NOT BETWEEN 1 AND extract(day FROM (
        make_date(year_number, month_number, 1) + interval '1 month' - interval '1 day'
      ))::int THEN NULL::date
      WHEN make_date(year_number, month_number, day_number) > current_date THEN NULL::date
      ELSE make_date(year_number, month_number, day_number)
    END AS sale_day,
    raw_store,
    cancelled_text,
    paid_amount
  FROM parts
),
valid AS (
  SELECT
    sale_day,
    raw_store,
    coalesce(cancelled_text IN ('true', '1', 'sim', 's'), false) AS cancelled,
    paid_amount
  FROM parsed
  WHERE sale_day IS NOT NULL
    AND raw_store IN (
      'CALCADOS',
      'SIRINHAEM',
      'MAGAZINE',
      'SPORTS-(DESATIVADO)',
      'ERICK SPORTS',
      'VARIEDADES'
    )
)
SELECT
  to_char(date_trunc('month', sale_day), 'YYYY-MM')::text AS month,
  raw_store::text AS raw_store,
  count(*)::bigint AS registered,
  count(*) FILTER (WHERE cancelled)::bigint AS cancelled,
  count(*) FILTER (WHERE NOT cancelled)::bigint AS noncancelled,
  coalesce(sum(paid_amount) FILTER (WHERE NOT cancelled), 0)::numeric(18,2)
    AS valor_pago_noncancelled_sum,
  max(to_char(sale_day, 'YYYY-MM-DD'))::text AS last_day
FROM valid
GROUP BY 1, 2;

COMMENT ON VIEW hermes_history.monthly_commercial_v2 IS
  'Hermes contract: month x raw_store; valid real dates only; valor_pago from noncancelled records; six raw store codes; no invented months.';

REVOKE ALL ON hermes_history.monthly_commercial_v2 FROM PUBLIC;
REVOKE ALL ON SCHEMA softcom_import FROM hermes_history_reader;
REVOKE ALL ON TABLE softcom_import.cadastro_de_vendas FROM hermes_history_reader;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON hermes_history.monthly_commercial_v2 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON hermes_history.monthly_commercial_v2 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_history_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA hermes_history TO hermes_history_reader';
    EXECUTE 'GRANT SELECT ON hermes_history.monthly_commercial_v2 TO hermes_history_reader';
  END IF;
END
$grants$;

-- Rollback (manual, reviewed, never part of the forward migration):
-- 1. Remove the V2 source variables and restart Hermes.
-- 2. Drop only this new view:
--    DROP VIEW IF EXISTS hermes_history.monthly_commercial_v2;

COMMIT;
