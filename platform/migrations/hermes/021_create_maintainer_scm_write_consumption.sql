-- Hermes maintainer SCM write durable consumption schema.
-- Structural migration only. It does not select a runtime adapter, resolve
-- credentials, perform provider network calls, or authorize a GitHub write.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.maintainer_scm_write_consumption (
  persistence_key TEXT PRIMARY KEY,
  intent_digest TEXT NOT NULL,
  authorization_reference TEXT NOT NULL,
  consumption_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT maintainer_scm_write_consumption_persistence_key_nonempty
    CHECK (length(btrim(persistence_key)) > 0),
  CONSTRAINT maintainer_scm_write_consumption_intent_digest_check
    CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_scm_write_consumption_authorization_reference_nonempty
    CHECK (length(btrim(authorization_reference)) > 0),
  CONSTRAINT maintainer_scm_write_consumption_consumption_reference_nonempty
    CHECK (length(btrim(consumption_reference)) > 0),
  CONSTRAINT maintainer_scm_write_consumption_key_binding
    CHECK (persistence_key = intent_digest || '::' || authorization_reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS maintainer_scm_write_consumption_authorization_reference_idx
  ON hermes.maintainer_scm_write_consumption (authorization_reference);

CREATE UNIQUE INDEX IF NOT EXISTS maintainer_scm_write_consumption_consumption_reference_idx
  ON hermes.maintainer_scm_write_consumption (consumption_reference);

COMMIT;
