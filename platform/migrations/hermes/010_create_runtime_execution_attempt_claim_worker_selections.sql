-- Hermes P13B durable claim-stage worker selection authority.
-- Selection is immutable authority only; binding, ownership, capacity, lease and execution remain later layers.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.runtime_execution_attempt_claim_worker_selections (
  contract_name TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  selection_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  attempt_durable_record_id TEXT NOT NULL,
  claim_digest TEXT NOT NULL,
  runtime_stage_reference_id TEXT NOT NULL,
  runtime_stage_reference_version INTEGER NOT NULL,
  stage_fingerprint TEXT NOT NULL,
  stage_digest TEXT NOT NULL,
  attempt_ordinal BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  selection_ordinal BIGINT NOT NULL,
  selected_worker_id TEXT NOT NULL,
  selected_worker_digest TEXT NOT NULL,
  candidate_worker_ids JSONB NOT NULL,
  candidate_set JSONB NOT NULL,
  candidate_set_digest TEXT NOT NULL,
  selection_policy TEXT NOT NULL,
  selection_policy_version INTEGER NOT NULL,
  selection_fingerprint TEXT NOT NULL,
  selection_digest TEXT NOT NULL,
  stage_reference JSONB NOT NULL,
  selection_artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT runtime_worker_selections_claim_fk
    FOREIGN KEY (claim_id) REFERENCES hermes.execution_attempt_claims (claim_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_selections_worker_fk
    FOREIGN KEY (selected_worker_id) REFERENCES hermes.runtime_workers (worker_id) ON DELETE RESTRICT,
  CONSTRAINT runtime_worker_selections_identity_check
    CHECK (
      contract_name = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_SELECTION_AUTHORITY'
      AND contract_version = 'runtime_execution_attempt_claim_worker_selection_authority_contract_v1'
      AND length(btrim(contract_name)) > 0
      AND length(btrim(contract_version)) > 0
      AND length(btrim(selection_id)) > 0
      AND length(btrim(claim_id)) > 0
      AND length(btrim(attempt_durable_record_id)) > 0
      AND length(btrim(claim_digest)) > 0
      AND length(btrim(runtime_stage_reference_id)) > 0
      AND length(btrim(stage_fingerprint)) > 0
      AND length(btrim(stage_digest)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(selected_worker_id)) > 0
      AND length(btrim(selected_worker_digest)) > 0
      AND length(btrim(candidate_set_digest)) > 0
      AND length(btrim(selection_policy)) > 0
      AND length(btrim(selection_fingerprint)) > 0
      AND length(btrim(selection_digest)) > 0
    ),
  CONSTRAINT runtime_worker_selections_ordinal_check CHECK (selection_ordinal >= 1),
  CONSTRAINT runtime_worker_selections_attempt_ordinal_check CHECK (attempt_ordinal >= 1),
  CONSTRAINT runtime_worker_selections_stage_version_check CHECK (runtime_stage_reference_version >= 1),
  CONSTRAINT runtime_worker_selections_policy_check
    CHECK (selection_policy = 'STATIC_CANONICAL_WORKER_ID_LEXICAL' AND selection_policy_version = 1),
  CONSTRAINT runtime_worker_selections_digest_check
    CHECK (
      claim_digest ~ '^sha256:[0-9a-f]{64}$'
      AND stage_digest ~ '^sha256:[0-9a-f]{64}$'
      AND selected_worker_digest ~ '^sha256:[0-9a-f]{64}$'
      AND candidate_set_digest ~ '^sha256:[0-9a-f]{64}$'
      AND selection_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT runtime_worker_selections_candidate_ids_array_check CHECK (jsonb_typeof(candidate_worker_ids) = 'array'),
  CONSTRAINT runtime_worker_selections_candidate_set_array_check CHECK (jsonb_typeof(candidate_set) = 'array'),
  CONSTRAINT runtime_worker_selections_stage_object_check CHECK (jsonb_typeof(stage_reference) = 'object'),
  CONSTRAINT runtime_worker_selections_artifact_object_check CHECK (jsonb_typeof(selection_artifact) = 'object'),
  CONSTRAINT runtime_worker_selections_slot_key UNIQUE (claim_id, runtime_stage_reference_id, selection_ordinal),
  CONSTRAINT runtime_worker_selections_artifact_binding_check
    CHECK (
      selection_artifact->>'selection_id' = selection_id
      AND selection_artifact->>'claim_id' = claim_id
      AND selection_artifact->>'attempt_durable_record_id' = attempt_durable_record_id
      AND selection_artifact->>'runtime_stage_reference_id' = runtime_stage_reference_id
      AND selection_artifact->>'selected_worker_id' = selected_worker_id
      AND selection_artifact->>'selection_digest' = selection_digest
    )
);

CREATE INDEX IF NOT EXISTS runtime_worker_selections_claim_idx
  ON hermes.runtime_execution_attempt_claim_worker_selections (claim_id);

CREATE INDEX IF NOT EXISTS runtime_worker_selections_worker_idx
  ON hermes.runtime_execution_attempt_claim_worker_selections (selected_worker_id);

COMMIT;
