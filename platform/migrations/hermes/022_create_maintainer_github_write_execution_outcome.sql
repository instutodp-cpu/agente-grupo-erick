-- Hermes maintainer GitHub write execution outcome durable schema.
-- Structural migration only. It does not select a runtime adapter, resolve
-- credentials, perform provider network calls, or authorize a GitHub write.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.maintainer_github_write_execution_outcome (
  outcome_key TEXT PRIMARY KEY,
  outcome_digest TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  attempt_reference TEXT NOT NULL,
  admission_reference TEXT NOT NULL,
  repository TEXT NOT NULL,
  operation TEXT NOT NULL,
  ref TEXT NOT NULL,
  sha TEXT NOT NULL,
  provider_status INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT maintainer_github_write_execution_outcome_key_binding
    CHECK (outcome_key = outcome_digest || '::execution-outcome'),
  CONSTRAINT maintainer_github_write_execution_outcome_digest_check
    CHECK (outcome_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_github_write_execution_outcome_intent_digest_check
    CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_github_write_execution_outcome_attempt_reference_nonempty
    CHECK (length(btrim(attempt_reference)) > 0),
  CONSTRAINT maintainer_github_write_execution_outcome_admission_reference_nonempty
    CHECK (length(btrim(admission_reference)) > 0),
  CONSTRAINT maintainer_github_write_execution_outcome_repository_fixed
    CHECK (repository = 'instutodp-cpu/agente-grupo-erick'),
  CONSTRAINT maintainer_github_write_execution_outcome_operation_fixed
    CHECK (operation = 'create_branch'),
  CONSTRAINT maintainer_github_write_execution_outcome_ref_check
    CHECK (ref ~ '^refs/heads/hermes/[a-z0-9][a-z0-9._/-]{0,79}$' AND position('..' in ref) = 0),
  CONSTRAINT maintainer_github_write_execution_outcome_sha_check
    CHECK (sha ~ '^[a-f0-9]{40}$'),
  CONSTRAINT maintainer_github_write_execution_outcome_provider_status_fixed
    CHECK (provider_status = 201)
);

CREATE UNIQUE INDEX IF NOT EXISTS maintainer_github_write_execution_outcome_digest_idx
  ON hermes.maintainer_github_write_execution_outcome (outcome_digest);

CREATE INDEX IF NOT EXISTS maintainer_github_write_execution_outcome_attempt_reference_idx
  ON hermes.maintainer_github_write_execution_outcome (attempt_reference);

CREATE INDEX IF NOT EXISTS maintainer_github_write_execution_outcome_admission_reference_idx
  ON hermes.maintainer_github_write_execution_outcome (admission_reference);

COMMIT;
