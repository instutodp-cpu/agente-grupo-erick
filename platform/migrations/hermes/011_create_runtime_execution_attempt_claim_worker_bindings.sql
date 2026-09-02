-- Hermes P13C durable claim-to-worker binding authority.
-- Binding records canonical provenance only; ownership, lease and execution remain later layers.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.runtime_execution_attempt_claim_worker_bindings (
  contract_name TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  binding_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  claim_digest TEXT NOT NULL,
  attempt_durable_record_id TEXT NOT NULL,
  runtime_stage_reference_id TEXT NOT NULL,
  runtime_stage_reference_version INTEGER NOT NULL,
  selection_id TEXT NOT NULL,
  selection_digest TEXT NOT NULL,
  selected_worker_id TEXT NOT NULL,
  selected_worker_digest TEXT NOT NULL,
  binding_ordinal BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  binding_fingerprint TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  binding_artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT runtime_worker_bindings_claim_fk
    FOREIGN KEY (claim_id) REFERENCES hermes.execution_attempt_claims (claim_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_bindings_selection_fk
    FOREIGN KEY (selection_id) REFERENCES hermes.runtime_execution_attempt_claim_worker_selections (selection_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_bindings_worker_fk
    FOREIGN KEY (selected_worker_id) REFERENCES hermes.runtime_workers (worker_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_bindings_identity_check
    CHECK (
      contract_name = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_BINDING_AUTHORITY'
      AND contract_version = 'runtime_execution_attempt_claim_worker_binding_authority_contract_v1'
      AND length(btrim(contract_name)) > 0
      AND length(btrim(contract_version)) > 0
      AND length(btrim(binding_id)) > 0
      AND length(btrim(claim_id)) > 0
      AND length(btrim(claim_digest)) > 0
      AND length(btrim(attempt_durable_record_id)) > 0
      AND length(btrim(runtime_stage_reference_id)) > 0
      AND length(btrim(selection_id)) > 0
      AND length(btrim(selection_digest)) > 0
      AND length(btrim(selected_worker_id)) > 0
      AND length(btrim(selected_worker_digest)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(binding_fingerprint)) > 0
      AND length(btrim(binding_digest)) > 0
    ),
  CONSTRAINT runtime_worker_bindings_ordinal_check CHECK (binding_ordinal >= 1),
  CONSTRAINT runtime_worker_bindings_stage_version_check CHECK (runtime_stage_reference_version >= 1),
  CONSTRAINT runtime_worker_bindings_digest_check
    CHECK (
      claim_digest ~ '^sha256:[0-9a-f]{64}$'
      AND selection_digest ~ '^sha256:[0-9a-f]{64}$'
      AND selected_worker_digest ~ '^sha256:[0-9a-f]{64}$'
      AND binding_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT runtime_worker_bindings_artifact_object_check CHECK (jsonb_typeof(binding_artifact) = 'object'),
  CONSTRAINT runtime_worker_bindings_slot_key UNIQUE (claim_id, runtime_stage_reference_id, binding_ordinal),
  CONSTRAINT runtime_worker_bindings_artifact_binding_check
    CHECK (
      binding_artifact->>'binding_id' = binding_id
      AND binding_artifact->>'claim_id' = claim_id
      AND binding_artifact->>'selection_id' = selection_id
      AND binding_artifact->>'runtime_stage_reference_id' = runtime_stage_reference_id
      AND binding_artifact->>'selected_worker_id' = selected_worker_id
      AND binding_artifact->>'binding_digest' = binding_digest
      AND (binding_artifact->>'worker_bound')::boolean = TRUE
    )
);

CREATE INDEX IF NOT EXISTS runtime_worker_bindings_claim_idx
  ON hermes.runtime_execution_attempt_claim_worker_bindings (claim_id);

CREATE INDEX IF NOT EXISTS runtime_worker_bindings_worker_idx
  ON hermes.runtime_execution_attempt_claim_worker_bindings (selected_worker_id);

COMMIT;
