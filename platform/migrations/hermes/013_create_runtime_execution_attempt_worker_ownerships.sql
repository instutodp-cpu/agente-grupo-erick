-- Hermes P14A durable worker ownership authority.
-- Ownership records the canonical owner of a binding; lease, liveness and execution remain later layers.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.runtime_execution_attempt_worker_ownerships (
  contract_name TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  ownership_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  selection_id TEXT NOT NULL,
  selected_worker_id TEXT NOT NULL,
  selected_worker_digest TEXT NOT NULL,
  operational_owner_id TEXT NOT NULL,
  operational_owner_type TEXT NOT NULL,
  owner_identity_fingerprint TEXT NOT NULL,
  owner_identity_digest TEXT NOT NULL,
  ownership_ordinal BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  ownership_fingerprint TEXT NOT NULL,
  ownership_digest TEXT NOT NULL,
  ownership_artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT runtime_worker_ownerships_binding_fk
    FOREIGN KEY (binding_id) REFERENCES hermes.runtime_execution_attempt_claim_worker_bindings (binding_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_ownerships_owner_fk
    FOREIGN KEY (operational_owner_id) REFERENCES hermes.runtime_operational_owners (operational_owner_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_ownerships_worker_fk
    FOREIGN KEY (selected_worker_id) REFERENCES hermes.runtime_workers (worker_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_ownerships_identity_check
    CHECK (
      contract_name = 'RUNTIME_EXECUTION_ATTEMPT_WORKER_OWNERSHIP_AUTHORITY'
      AND contract_version = 'runtime_execution_attempt_worker_ownership_authority_contract_v1'
      AND length(btrim(ownership_id)) > 0
      AND length(btrim(binding_id)) > 0
      AND length(btrim(binding_digest)) > 0
      AND length(btrim(claim_id)) > 0
      AND length(btrim(selection_id)) > 0
      AND length(btrim(selected_worker_id)) > 0
      AND length(btrim(selected_worker_digest)) > 0
      AND length(btrim(operational_owner_id)) > 0
      AND operational_owner_type = 'operational_owner'
      AND length(btrim(owner_identity_fingerprint)) > 0
      AND length(btrim(owner_identity_digest)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(ownership_fingerprint)) > 0
      AND length(btrim(ownership_digest)) > 0
    ),
  CONSTRAINT runtime_worker_ownerships_ordinal_check CHECK (ownership_ordinal >= 1),
  CONSTRAINT runtime_worker_ownerships_digest_check
    CHECK (
      binding_digest ~ '^sha256:[0-9a-f]{64}$'
      AND selected_worker_digest ~ '^sha256:[0-9a-f]{64}$'
      AND owner_identity_digest ~ '^sha256:[0-9a-f]{64}$'
      AND ownership_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT runtime_worker_ownerships_artifact_object_check
    CHECK (jsonb_typeof(ownership_artifact) = 'object'),
  CONSTRAINT runtime_worker_ownerships_artifact_identity_check
    CHECK (
      ownership_artifact->>'ownership_id' = ownership_id
      AND ownership_artifact->>'binding_id' = binding_id
      AND ownership_artifact->>'operational_owner_id' = operational_owner_id
      AND ownership_artifact->>'selected_worker_id' = selected_worker_id
      AND (ownership_artifact->>'ownership_ordinal')::bigint = ownership_ordinal
      AND ownership_artifact->>'ownership_digest' = ownership_digest
      AND (ownership_artifact->>'worker_ownership_established')::boolean = TRUE
      AND (ownership_artifact->>'executor_ownership_established')::boolean = FALSE
      AND (ownership_artifact->>'lease_created')::boolean = FALSE
      AND (ownership_artifact->>'liveness_established')::boolean = FALSE
      AND (ownership_artifact->>'fencing_token_created')::boolean = FALSE
      AND (ownership_artifact->>'capacity_reserved')::boolean = FALSE
      AND (ownership_artifact->>'execution_authorized')::boolean = FALSE
      AND (ownership_artifact->>'production_blocked')::boolean = TRUE
    ),
  CONSTRAINT runtime_worker_ownerships_slot_key UNIQUE (binding_id, ownership_ordinal)
);

CREATE INDEX IF NOT EXISTS runtime_worker_ownerships_owner_idx
  ON hermes.runtime_execution_attempt_worker_ownerships (operational_owner_id);

COMMIT;
