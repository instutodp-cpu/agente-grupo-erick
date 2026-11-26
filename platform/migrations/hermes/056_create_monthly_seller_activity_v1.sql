-- Hermes business intelligence: monthly seller activity V1.
-- Structural/read-only migration. Seller ranking remains opt-in in runtime.
-- Apply only in an isolated, reviewed database environment.
BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes_history;
REVOKE ALL ON SCHEMA hermes_history FROM PUBLIC;

CREATE VIEW hermes_history.monthly_seller_activity_v1 AS
WITH raw AS (
  SELECT
    NULLIF(btrim(data_da_venda::text), '') AS date_text,
    NULLIF(btrim(lojaorigem::text), '') AS raw_store,
    NULLIF(btrim(vendedor::text), '') AS seller_code,
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
    seller_code,
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
    seller_code,
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
    AND seller_code ~ '^[0-9]+$'
    AND paid_amount IS NOT NULL
)
SELECT
  to_char(date_trunc('month', sale_day), 'YYYY-MM')::text AS month,
  raw_store::text AS raw_store,
  seller_code::text AS seller_code,
  ('Código ' || seller_code)::text AS seller_label,
  count(*)::bigint AS registered,
  count(*) FILTER (WHERE cancelled)::bigint AS cancelled,
  count(*) FILTER (WHERE NOT cancelled)::bigint AS noncancelled,
  coalesce(sum(paid_amount) FILTER (WHERE NOT cancelled), 0)::numeric(18,2)
    AS valor_pago_noncancelled_sum,
  max(to_char(sale_day, 'YYYY-MM-DD'))::text AS last_day
FROM valid
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW hermes_history.monthly_seller_activity_v1 IS
  'Hermes contract: month x raw_store x seller_code; seller_label is exactly Código + code; no names or cross-store identity inferred.';

REVOKE ALL ON hermes_history.monthly_seller_activity_v1 FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON hermes_history.monthly_seller_activity_v1 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON hermes_history.monthly_seller_activity_v1 FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_history_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA hermes_history TO hermes_history_reader';
    EXECUTE 'GRANT SELECT ON hermes_history.monthly_seller_activity_v1 TO hermes_history_reader';
  END IF;
END
$grants$;

-- Rollback (manual, reviewed, never part of the forward migration):
-- DROP VIEW IF EXISTS hermes_history.monthly_seller_activity_v1;

COMMIT;
