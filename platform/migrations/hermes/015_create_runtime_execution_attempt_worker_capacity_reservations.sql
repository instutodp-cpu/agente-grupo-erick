-- Hermes P14C durable worker capacity reservation authority.
-- Capacity reservation is subordinate to P14A ownership and P14B lease/fencing;
-- execution remains a later authority.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.runtime_worker_capacity_resources (
  capacity_resource_id TEXT PRIMARY KEY,
  capacity_dimension TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  capacity_limit BIGINT NOT NULL,
  reserved_amount BIGINT NOT NULL DEFAULT 0,
  capacity_fingerprint TEXT NOT NULL,
  capacity_digest TEXT NOT NULL,
  capacity_artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT runtime_worker_capacity_resources_worker_fk
    FOREIGN KEY (worker_id) REFERENCES hermes.runtime_workers (worker_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_capacity_resources_dimension_check
    CHECK (capacity_dimension IN (
      'worker_stage_assignments', 'worker_parallel_assignments',
      'worker_model_assignments', 'worker_tool_assignments',
      'worker_workflow_assignments', 'worker_token_capacity',
      'worker_cost_capacity_minor_units'
    )),
  CONSTRAINT runtime_worker_capacity_resources_identity_check
    CHECK (
      length(btrim(capacity_resource_id)) > 0
      AND length(btrim(worker_id)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(capacity_fingerprint)) > 0
      AND length(btrim(capacity_digest)) > 0
    ),
  CONSTRAINT runtime_worker_capacity_resources_amount_check
    CHECK (capacity_limit >= 1 AND reserved_amount >= 0 AND reserved_amount <= capacity_limit),
  CONSTRAINT runtime_worker_capacity_resources_digest_check
    CHECK (capacity_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT runtime_worker_capacity_resources_artifact_object_check
    CHECK (jsonb_typeof(capacity_artifact) = 'object'),
  CONSTRAINT runtime_worker_capacity_resources_artifact_identity_check
    CHECK (
      capacity_artifact->>'capacity_resource_id' = capacity_resource_id
      AND capacity_artifact->>'worker_id' = worker_id
      AND (capacity_artifact->>'capacity_limit')::bigint = capacity_limit
      AND capacity_artifact->>'capacity_digest' = capacity_digest
    )
);

CREATE TABLE IF NOT EXISTS hermes.runtime_execution_attempt_worker_capacity_reservations (
  contract_name TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  reservation_id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  ownership_id TEXT NOT NULL,
  operational_owner_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  fencing_token BIGINT NOT NULL,
  capacity_resource_id TEXT NOT NULL,
  capacity_resource_digest TEXT NOT NULL,
  capacity_dimension TEXT NOT NULL,
  requested_amount BIGINT NOT NULL,
  reservation_ordinal BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reservation_state TEXT NOT NULL,
  reservation_fingerprint TEXT NOT NULL,
  reservation_digest TEXT NOT NULL,
  reservation_artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMPTZ,

  CONSTRAINT runtime_worker_capacity_reservations_lease_fk
    FOREIGN KEY (lease_id) REFERENCES hermes.runtime_execution_attempt_worker_leases (lease_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_capacity_reservations_owner_fk
    FOREIGN KEY (operational_owner_id) REFERENCES hermes.runtime_operational_owners (operational_owner_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_capacity_reservations_worker_fk
    FOREIGN KEY (worker_id) REFERENCES hermes.runtime_workers (worker_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_capacity_reservations_resource_fk
    FOREIGN KEY (capacity_resource_id) REFERENCES hermes.runtime_worker_capacity_resources (capacity_resource_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_capacity_reservations_identity_check
    CHECK (
      contract_name = 'RUNTIME_EXECUTION_ATTEMPT_WORKER_CAPACITY_RESERVATION_AUTHORITY'
      AND contract_version = 'runtime_execution_attempt_worker_capacity_reservation_authority_contract_v1'
      AND length(btrim(reservation_id)) > 0
      AND length(btrim(lease_id)) > 0
      AND length(btrim(ownership_id)) > 0
      AND length(btrim(operational_owner_id)) > 0
      AND length(btrim(worker_id)) > 0
      AND length(btrim(capacity_resource_id)) > 0
      AND length(btrim(capacity_resource_digest)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(reservation_fingerprint)) > 0
      AND length(btrim(reservation_digest)) > 0
    ),
  CONSTRAINT runtime_worker_capacity_reservations_amount_check
    CHECK (fencing_token >= 1 AND requested_amount >= 1 AND reservation_ordinal >= 1),
  CONSTRAINT runtime_worker_capacity_reservations_state_check
    CHECK (reservation_state IN ('ACTIVE', 'RELEASED', 'EXPIRED')),
  CONSTRAINT runtime_worker_capacity_reservations_digest_check
    CHECK (
      capacity_resource_digest ~ '^sha256:[0-9a-f]{64}$'
      AND reservation_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT runtime_worker_capacity_reservations_artifact_object_check
    CHECK (jsonb_typeof(reservation_artifact) = 'object'),
  CONSTRAINT runtime_worker_capacity_reservations_artifact_identity_check
    CHECK (
      reservation_artifact->>'reservation_id' = reservation_id
      AND reservation_artifact->>'lease_id' = lease_id
      AND reservation_artifact->>'operational_owner_id' = operational_owner_id
      AND reservation_artifact->>'worker_id' = worker_id
      AND (reservation_artifact->>'fencing_token')::bigint = fencing_token
      AND (reservation_artifact->>'requested_amount')::bigint = requested_amount
      AND (reservation_artifact->>'reservation_ordinal')::bigint = reservation_ordinal
      AND (reservation_artifact->>'capacity_reservation_created')::boolean = TRUE
      AND (reservation_artifact->>'capacity_reserved')::boolean = TRUE
      AND (reservation_artifact->>'reservation_granted')::boolean = TRUE
      AND (reservation_artifact->>'execution_authorized')::boolean = FALSE
      AND (reservation_artifact->>'production_blocked')::boolean = TRUE
    ),
  CONSTRAINT runtime_worker_capacity_reservations_slot_key
    UNIQUE (lease_id, capacity_resource_id, reservation_ordinal)
);

CREATE INDEX IF NOT EXISTS runtime_worker_capacity_resources_worker_idx
  ON hermes.runtime_worker_capacity_resources (worker_id, capacity_dimension);

CREATE INDEX IF NOT EXISTS runtime_worker_capacity_reservations_resource_idx
  ON hermes.runtime_execution_attempt_worker_capacity_reservations (capacity_resource_id, reservation_state);

COMMIT;
