-- A3 staging-only SOURCE authorization binding: durable global exclusivity.
-- This is NOT an SCM write consumption, issuer, simulation receipt producer,
-- human approval, or authorization to run a provider operation.
-- Insert ONLY after independent issuer/official run/zero-effect receipt/
-- scoped post-run human-approval verification; absent wiring stays fail closed.
-- Never use the legacy maintainer_scm_write_consumption ledger here.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.maintainer_a3_source_authorization_claims (
  single_use_authorization_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  mission_run_id TEXT NOT NULL,
  approval_reference TEXT NOT NULL,
  authorization_reference TEXT NOT NULL,
  operation TEXT NOT NULL,
  repository TEXT NOT NULL,
  environment TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  simulation_receipt_digest TEXT NOT NULL,
  staging_gate_fingerprint TEXT NOT NULL,
  source_record_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT maintainer_a3_source_id_nonempty
    CHECK (length(btrim(single_use_authorization_id)) > 0),
  CONSTRAINT maintainer_a3_source_ids_nonempty
    CHECK (length(btrim(workspace_id)) > 0 AND length(btrim(mission_id)) > 0
      AND length(btrim(mission_run_id)) > 0 AND length(btrim(approval_reference)) > 0
      AND length(btrim(authorization_reference)) > 0),
  CONSTRAINT maintainer_a3_source_staging_only
    CHECK (environment = 'staging'),
  CONSTRAINT maintainer_a3_source_repository_scope
    CHECK (repository = 'instutodp-cpu/agente-grupo-erick'),
  CONSTRAINT maintainer_a3_source_operation_scope
    CHECK (operation IN ('update_file', 'create_pull_request')),
  CONSTRAINT maintainer_a3_source_target_digest_valid
    CHECK (target_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_a3_source_intent_digest_valid
    CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_a3_source_simulation_receipt_digest_valid
    CHECK (simulation_receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_a3_source_staging_gate_fingerprint_valid
    CHECK (staging_gate_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT maintainer_a3_source_record_digest_valid
    CHECK (source_record_digest ~ '^sha256:[a-f0-9]{64}$')
);

-- One authorization ID, one official human approval, one signed source
-- record and one zero-effect simulation receipt across ALL workspaces.
-- PostgreSQL UNIQUE constraints, not preflight SELECT checks, arbitrate races.
CREATE UNIQUE INDEX IF NOT EXISTS maintainer_a3_source_approval_reference_uidx
  ON hermes.maintainer_a3_source_authorization_claims (approval_reference);
CREATE UNIQUE INDEX IF NOT EXISTS maintainer_a3_source_record_digest_uidx
  ON hermes.maintainer_a3_source_authorization_claims (source_record_digest);
CREATE UNIQUE INDEX IF NOT EXISTS maintainer_a3_source_simulation_receipt_digest_uidx
  ON hermes.maintainer_a3_source_authorization_claims (simulation_receipt_digest);

COMMIT;
