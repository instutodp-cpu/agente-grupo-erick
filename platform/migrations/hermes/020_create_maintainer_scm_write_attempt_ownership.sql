-- Hermes maintainer SCM write durable attempt-ownership schema.
-- Structural migration only. It does not select a runtime adapter, resolve
-- credentials, perform provider network calls, or authorize a GitHub write.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.maintainer_scm_write_attempt_ownership (
  ownership_key TEXT PRIMARY KEY,
  persistence_key TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  authorization_reference TEXT,
  consumption_reference TEXT,
  attempt_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT maintainer_scm_write_attempt_ownership_key_nonempty
    CHECK (length(btrim(ownership_key)) > 0),
  CONSTRAINT maintainer_scm_write_attempt_ownership_persistence_key_nonempty
    CHECK (length(btrim(persistence_key)) > 0),
  CONSTRAINT maintainer_scm_write_attempt_ownership_key_binding
    CHECK (ownership_key = persistence_key || '::attempt-ownership'),
  CONSTRAINT maintainer_scm_write_attempt_ownership_intent_digest_check
    CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_scm_write_attempt_ownership_attempt_reference_nonempty
    CHECK (length(btrim(attempt_reference)) > 0),
  CONSTRAINT maintainer_scm_write_attempt_ownership_authorization_reference_check
    CHECK (authorization_reference IS NULL OR length(btrim(authorization_reference)) > 0),
  CONSTRAINT maintainer_scm_write_attempt_ownership_consumption_reference_check
    CHECK (consumption_reference IS NULL OR length(btrim(consumption_reference)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS maintainer_scm_write_attempt_ownership_persistence_key_idx
  ON hermes.maintainer_scm_write_attempt_ownership (persistence_key);

CREATE INDEX IF NOT EXISTS maintainer_scm_write_attempt_ownership_attempt_reference_idx
  ON hermes.maintainer_scm_write_attempt_ownership (attempt_reference);

COMMIT;
