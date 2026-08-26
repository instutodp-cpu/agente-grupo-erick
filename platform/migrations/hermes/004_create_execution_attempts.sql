-- Hermes P7 durable execution-attempt persistence.
-- Structural migration only. Admission remains a later boundary.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.execution_attempts (
  attempt_durable_record_id TEXT PRIMARY KEY,
  durable_job_reference_id TEXT NOT NULL,
  materialization_reference_id TEXT NOT NULL,
  materialization_reference_fingerprint TEXT NOT NULL,
  materialization_reference_digest TEXT NOT NULL,
  attempt_intent_reference_id TEXT NOT NULL,
  attempt_intent_reference_fingerprint TEXT NOT NULL,
  attempt_intent_reference_digest TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  logical_job_identity_digest TEXT NOT NULL,
  admission_reference_id TEXT NOT NULL,
  attempt_ordinal BIGINT NOT NULL,
  state TEXT NOT NULL,
  revision BIGINT NOT NULL,
  contract_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  durable_record_fingerprint TEXT NOT NULL,
  durable_record_digest TEXT NOT NULL,
  durable_record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT execution_attempts_id_nonempty
    CHECK (length(btrim(attempt_durable_record_id)) > 0),
  CONSTRAINT execution_attempts_identity_fields_nonempty
    CHECK (
      length(btrim(durable_job_reference_id)) > 0
      AND length(btrim(materialization_reference_id)) > 0
      AND length(btrim(materialization_reference_fingerprint)) > 0
      AND length(btrim(materialization_reference_digest)) > 0
      AND length(btrim(attempt_intent_reference_id)) > 0
      AND length(btrim(attempt_intent_reference_fingerprint)) > 0
      AND length(btrim(attempt_intent_reference_digest)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(logical_job_identity_digest)) > 0
      AND length(btrim(admission_reference_id)) > 0
      AND length(btrim(durable_record_fingerprint)) > 0
      AND length(btrim(durable_record_digest)) > 0
    ),
  CONSTRAINT execution_attempts_state_check
    CHECK (state = 'PREPARED'),
  CONSTRAINT execution_attempts_revision_check
    CHECK (revision = 1),
  CONSTRAINT execution_attempts_contract_version_check
    CHECK (contract_version = 'runtime_execution_attempt_durable_record_contract_v1'),
  CONSTRAINT execution_attempts_schema_version_check
    CHECK (schema_version = 1),
  CONSTRAINT execution_attempts_record_object_check
    CHECK (jsonb_typeof(durable_record) = 'object'),
  CONSTRAINT execution_attempts_record_state_check
    CHECK (durable_record->>'status' = 'EXECUTION_ATTEMPT_DURABLE_RECORD_PREPARED_SIMULATION'),
  CONSTRAINT execution_attempts_record_admission_check
    CHECK (durable_record->>'attempt_admitted' = 'false'),
  CONSTRAINT execution_attempts_id_binding_check
    CHECK (durable_record->>'runtime_execution_attempt_durable_record_id' = attempt_durable_record_id),
  CONSTRAINT execution_attempts_job_binding_check
    CHECK (durable_record->'durable_job_reference'->>'id' = durable_job_reference_id),
  CONSTRAINT execution_attempts_materialization_binding_check
    CHECK (durable_record->'runtime_execution_attempt_materialization_reference'->>'id' = materialization_reference_id),
  CONSTRAINT execution_attempts_intent_binding_check
    CHECK (durable_record->'runtime_execution_attempt_intent_reference'->>'id' = attempt_intent_reference_id),
  CONSTRAINT execution_attempts_scope_binding_check
    CHECK (
      durable_record->'identity_scope'->>'tenant_id' = tenant_id
      AND durable_record->'identity_scope'->>'organization_id' = organization_id
      AND durable_record->'identity_scope'->>'project_id' = project_id
      AND durable_record->'identity_scope'->>'session_reference_id' = session_reference_id
      AND durable_record->'identity_scope'->>'agent_id' = agent_id
      AND durable_record->'identity_scope'->>'actor_id' = actor_id
    ),
  CONSTRAINT execution_attempts_logical_identity_binding_check
    CHECK (durable_record->>'logical_job_identity_digest' = logical_job_identity_digest),
  CONSTRAINT execution_attempts_admission_binding_check
    CHECK (durable_record->'admission_reference'->>'id' = admission_reference_id),
  CONSTRAINT execution_attempts_ordinal_binding_check
    CHECK ((durable_record->>'attempt_ordinal')::BIGINT = attempt_ordinal),
  CONSTRAINT execution_attempts_fingerprint_binding_check
    CHECK (durable_record->>'runtime_execution_attempt_durable_record_fingerprint' = durable_record_fingerprint),
  CONSTRAINT execution_attempts_digest_binding_check
    CHECK (durable_record->>'runtime_execution_attempt_durable_record_digest' = durable_record_digest),
  CONSTRAINT execution_attempts_job_ordinal_key
    UNIQUE (durable_job_reference_id, attempt_ordinal)
);

COMMIT;
