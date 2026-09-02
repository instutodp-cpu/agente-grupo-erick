-- Hermes P14B durable worker lease, liveness and fencing coordination.
-- Lease state is subordinate to P14A ownership; execution remains a later layer.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.runtime_execution_attempt_worker_leases (
  contract_name TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  lease_id TEXT PRIMARY KEY,
  ownership_id TEXT NOT NULL,
  ownership_digest TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  operational_owner_id TEXT NOT NULL,
  selected_worker_id TEXT NOT NULL,
  selected_worker_digest TEXT NOT NULL,
  owner_identity_digest TEXT NOT NULL,
  lease_ordinal BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  fencing_token BIGINT NOT NULL,
  lease_state TEXT NOT NULL,
  lease_fingerprint TEXT NOT NULL,
  lease_digest TEXT NOT NULL,
  lease_artifact JSONB NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  last_renewed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT runtime_worker_leases_ownership_fk
    FOREIGN KEY (ownership_id) REFERENCES hermes.runtime_execution_attempt_worker_ownerships (ownership_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_leases_owner_fk
    FOREIGN KEY (operational_owner_id) REFERENCES hermes.runtime_operational_owners (operational_owner_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_leases_worker_fk
    FOREIGN KEY (selected_worker_id) REFERENCES hermes.runtime_workers (worker_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_leases_identity_check
    CHECK (
      contract_name = 'RUNTIME_EXECUTION_ATTEMPT_WORKER_LEASE_FENCING_AUTHORITY'
      AND contract_version = 'runtime_execution_attempt_worker_lease_fencing_authority_contract_v1'
      AND length(btrim(lease_id)) > 0
      AND length(btrim(ownership_id)) > 0
      AND length(btrim(ownership_digest)) > 0
      AND length(btrim(binding_id)) > 0
      AND length(btrim(operational_owner_id)) > 0
      AND length(btrim(selected_worker_id)) > 0
      AND length(btrim(selected_worker_digest)) > 0
      AND length(btrim(owner_identity_digest)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(lease_fingerprint)) > 0
      AND length(btrim(lease_digest)) > 0
    ),
  CONSTRAINT runtime_worker_leases_ordinal_check CHECK (lease_ordinal >= 1),
  CONSTRAINT runtime_worker_leases_fencing_check CHECK (fencing_token >= 1),
  CONSTRAINT runtime_worker_leases_state_check CHECK (lease_state IN ('ACTIVE', 'EXPIRED', 'RELEASED')),
  CONSTRAINT runtime_worker_leases_digest_check
    CHECK (
      ownership_digest ~ '^sha256:[0-9a-f]{64}$'
      AND selected_worker_digest ~ '^sha256:[0-9a-f]{64}$'
      AND owner_identity_digest ~ '^sha256:[0-9a-f]{64}$'
      AND lease_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT runtime_worker_leases_artifact_object_check
    CHECK (jsonb_typeof(lease_artifact) = 'object'),
  CONSTRAINT runtime_worker_leases_artifact_identity_check
    CHECK (
      lease_artifact->>'lease_id' = lease_id
      AND lease_artifact->>'ownership_id' = ownership_id
      AND lease_artifact->>'operational_owner_id' = operational_owner_id
      AND lease_artifact->>'selected_worker_id' = selected_worker_id
      AND (lease_artifact->>'lease_ordinal')::bigint = lease_ordinal
      AND (lease_artifact->>'fencing_token')::bigint = fencing_token
      AND (lease_artifact->>'lease_created')::boolean = TRUE
      AND (lease_artifact->>'lease_granted')::boolean = TRUE
      AND (lease_artifact->>'liveness_established')::boolean = TRUE
      AND (lease_artifact->>'fencing_token_created')::boolean = TRUE
      AND (lease_artifact->>'fencing_token_issued')::boolean = TRUE
      AND (lease_artifact->>'execution_authorized')::boolean = FALSE
      AND (lease_artifact->>'production_blocked')::boolean = TRUE
    ),
  CONSTRAINT runtime_worker_leases_slot_key UNIQUE (ownership_id, lease_ordinal)
);

CREATE INDEX IF NOT EXISTS runtime_worker_leases_owner_idx
  ON hermes.runtime_execution_attempt_worker_leases (operational_owner_id);

CREATE INDEX IF NOT EXISTS runtime_worker_leases_expiry_idx
  ON hermes.runtime_execution_attempt_worker_leases (lease_state, lease_expires_at);

COMMIT;
