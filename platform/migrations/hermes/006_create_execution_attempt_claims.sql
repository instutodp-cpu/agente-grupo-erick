-- Hermes P12A durable execution-attempt claim schema enablement.
-- Structural migration only. Claim acquisition remains a later boundary.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.execution_attempt_claims (
  claim_id TEXT PRIMARY KEY,
  claim_ordinal BIGINT NOT NULL,
  attempt_durable_record_id TEXT NOT NULL,
  attempt_state TEXT NOT NULL,
  attempt_revision BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  attempt_ordinal BIGINT NOT NULL,
  claim_intent_contract_name TEXT NOT NULL,
  claim_intent_contract_version TEXT NOT NULL,
  claim_intent_reference_id TEXT NOT NULL,
  claim_intent_reference_version INTEGER NOT NULL,
  claim_intent_reference_fingerprint TEXT NOT NULL,
  claim_intent_reference_digest TEXT NOT NULL,
  claim_eligibility_contract_name TEXT NOT NULL,
  claim_eligibility_contract_version TEXT NOT NULL,
  claim_eligibility_decision_status TEXT NOT NULL,
  claim_eligibility_decision_reference_id TEXT NOT NULL,
  claim_eligibility_decision_reference_version INTEGER NOT NULL,
  claim_eligibility_decision_reference_fingerprint TEXT NOT NULL,
  claim_eligibility_decision_reference_digest TEXT NOT NULL,
  claim_contract_version TEXT NOT NULL,
  claim_state TEXT NOT NULL,
  claim_fingerprint TEXT NOT NULL,
  claim_digest TEXT NOT NULL,
  claim_artifact JSONB NOT NULL,
  claim_receipt JSONB NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT execution_attempt_claims_claim_id_nonempty
    CHECK (length(btrim(claim_id)) > 0),
  CONSTRAINT execution_attempt_claims_claim_ordinal_check
    CHECK (claim_ordinal >= 1),
  CONSTRAINT execution_attempt_claims_attempt_reference_fk
    FOREIGN KEY (attempt_durable_record_id)
    REFERENCES hermes.execution_attempts (attempt_durable_record_id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_attempt_claims_attempt_lifecycle_check
    CHECK (attempt_state = 'ADMITTED' AND attempt_revision = 2),
  CONSTRAINT execution_attempt_claims_identity_fields_nonempty
    CHECK (
      length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(attempt_durable_record_id)) > 0
      AND length(btrim(claim_intent_reference_id)) > 0
      AND length(btrim(claim_intent_reference_fingerprint)) > 0
      AND length(btrim(claim_intent_reference_digest)) > 0
      AND length(btrim(claim_eligibility_decision_reference_id)) > 0
      AND length(btrim(claim_eligibility_decision_reference_fingerprint)) > 0
      AND length(btrim(claim_eligibility_decision_reference_digest)) > 0
      AND length(btrim(claim_fingerprint)) > 0
      AND length(btrim(claim_digest)) > 0
    ),
  CONSTRAINT execution_attempt_claims_attempt_ordinal_check
    CHECK (attempt_ordinal >= 1),
  CONSTRAINT execution_attempt_claims_intent_contract_check
    CHECK (
      claim_intent_contract_name = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_INTENT_SIMULATION'
      AND claim_intent_contract_version = 'runtime_execution_attempt_claim_intent_simulation_contract_v1'
    ),
  CONSTRAINT execution_attempt_claims_eligibility_contract_check
    CHECK (
      claim_eligibility_contract_name = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_ELIGIBILITY_DECISION_SIMULATION'
      AND claim_eligibility_contract_version = 'runtime_execution_attempt_claim_eligibility_decision_simulation_contract_v1'
      AND claim_eligibility_decision_status = 'EXECUTION_ATTEMPT_CLAIM_ELIGIBLE_SIMULATION'
    ),
  CONSTRAINT execution_attempt_claims_reference_version_check
    CHECK (claim_intent_reference_version >= 1 AND claim_eligibility_decision_reference_version >= 1),
  CONSTRAINT execution_attempt_claims_contract_check
    CHECK (claim_contract_version = 'runtime_execution_attempt_durable_claim_v1'),
  CONSTRAINT execution_attempt_claims_state_check
    CHECK (claim_state = 'ACTIVE'),
  CONSTRAINT execution_attempt_claims_artifact_object_check
    CHECK (jsonb_typeof(claim_artifact) = 'object'),
  CONSTRAINT execution_attempt_claims_artifact_binding_check
    CHECK (
      claim_artifact->>'claim_id' = claim_id
      AND claim_artifact->>'attempt_durable_record_id' = attempt_durable_record_id
      AND claim_artifact->>'claim_state' = claim_state
      AND claim_artifact->>'claim_eligibility_decision_reference_id' = claim_eligibility_decision_reference_id
      AND claim_artifact->>'claim_eligibility_decision_reference_digest' = claim_eligibility_decision_reference_digest
    ),
  CONSTRAINT execution_attempt_claims_receipt_object_check
    CHECK (jsonb_typeof(claim_receipt) = 'object'),
  CONSTRAINT execution_attempt_claims_receipt_binding_check
    CHECK (
      claim_receipt->>'claim_id' = claim_id
      AND claim_receipt->>'attempt_durable_record_id' = attempt_durable_record_id
      AND claim_receipt->>'claim_state' = claim_state
    ),
  CONSTRAINT execution_attempt_claims_schema_version_check
    CHECK (schema_version = 1),
  CONSTRAINT execution_attempt_claims_attempt_ordinal_key
    UNIQUE (attempt_durable_record_id, claim_ordinal),
  CONSTRAINT execution_attempt_claims_identity_key
    UNIQUE (attempt_durable_record_id, claim_fingerprint, claim_digest)
);

CREATE UNIQUE INDEX IF NOT EXISTS execution_attempt_claims_active_attempt_key
  ON hermes.execution_attempt_claims (attempt_durable_record_id)
  WHERE claim_state = 'ACTIVE';

CREATE INDEX IF NOT EXISTS execution_attempt_claims_eligibility_reference_idx
  ON hermes.execution_attempt_claims (
    claim_eligibility_decision_reference_id,
    claim_eligibility_decision_reference_digest
  );

COMMIT;
