-- Hermes business intelligence: auditable monthly commercial aggregate V2.
-- Structural/read-only migration. It does not replace the existing V1 view.
-- Apply only in an isolated, reviewed database environment.
BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes_history;
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_history_reader') THEN
    CREATE ROLE hermes_history_reader NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  ALTER ROLE hermes_history_reader
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;
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
parsed AS (
  SELECT
    CASE
      WHEN date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T].*)?$'
       AND to_char(to_date(left(date_text, 10), 'YYYY-MM-DD'), 'YYYY-MM-DD') = left(date_text, 10)
        THEN to_date(left(date_text, 10), 'YYYY-MM-DD')
      WHEN date_text ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}([ T].*)?$'
       AND to_char(to_date(left(date_text, 10), 'DD/MM/YYYY'), 'DD/MM/YYYY') = left(date_text, 10)
        THEN to_date(left(date_text, 10), 'DD/MM/YYYY')
      ELSE NULL
    END AS sale_day,
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
valid AS (
  SELECT
    sale_day,
    raw_store,
    cancelled_text IN ('true', '1', 'sim', 's') AS cancelled,
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
    AND paid_amount IS NOT NULL
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
-- DROP VIEW IF EXISTS hermes_history.monthly_commercial_v2;

COMMIT;
