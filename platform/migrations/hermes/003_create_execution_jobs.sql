-- Hermes P3B PostgreSQL durable execution job admission.
-- Structural migration only. It is never auto-applied by the runtime.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.execution_jobs (
  job_reference_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_reference_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  logical_identity_digest TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  record_fingerprint TEXT NOT NULL,
  record_digest TEXT NOT NULL,
  admission_reference_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  state TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  durable_record JSONB NOT NULL,

  CONSTRAINT execution_jobs_job_reference_id_nonempty
    CHECK (length(btrim(job_reference_id)) > 0),
  CONSTRAINT execution_jobs_identity_fields_nonempty
    CHECK (
      length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(session_reference_id)) > 0
      AND length(btrim(agent_id)) > 0
      AND length(btrim(actor_id)) > 0
      AND length(btrim(logical_identity_digest)) > 0
      AND length(btrim(idempotency_fingerprint)) > 0
      AND length(btrim(record_fingerprint)) > 0
      AND length(btrim(record_digest)) > 0
      AND length(btrim(admission_reference_id)) > 0
    ),
  CONSTRAINT execution_jobs_state_check
    CHECK (state = 'ADMITTED'),
  CONSTRAINT execution_jobs_revision_check
    CHECK (revision = 1),
  CONSTRAINT execution_jobs_contract_version_check
    CHECK (contract_version = 'runtime_execution_job_durable_contract_v1'),
  CONSTRAINT execution_jobs_schema_version_check
    CHECK (schema_version = 3),
  CONSTRAINT execution_jobs_durable_record_object_check
    CHECK (jsonb_typeof(durable_record) = 'object'),
  CONSTRAINT execution_jobs_job_reference_binding_check
    CHECK (durable_record->'job_reference'->>'id' = job_reference_id),
  CONSTRAINT execution_jobs_scope_binding_check
    CHECK (
      durable_record->'identity_scope'->>'tenant_id' = tenant_id
      AND durable_record->'identity_scope'->>'organization_id' = organization_id
      AND durable_record->'identity_scope'->>'project_id' = project_id
      AND durable_record->'identity_scope'->>'session_reference_id' = session_reference_id
      AND durable_record->'identity_scope'->>'agent_id' = agent_id
      AND durable_record->'identity_scope'->>'actor_id' = actor_id
    ),
  CONSTRAINT execution_jobs_logical_identity_binding_check
    CHECK (durable_record->'logical_job_identity'->>'digest' = logical_identity_digest),
  CONSTRAINT execution_jobs_idempotency_binding_check
    CHECK (durable_record->'idempotency_reference'->>'fingerprint' = idempotency_fingerprint),
  CONSTRAINT execution_jobs_record_fingerprint_binding_check
    CHECK (durable_record->>'runtime_execution_job_durable_fingerprint' = record_fingerprint),
  CONSTRAINT execution_jobs_record_digest_binding_check
    CHECK (durable_record->>'runtime_execution_job_durable_digest' = record_digest),
  CONSTRAINT execution_jobs_admission_reference_binding_check
    CHECK (durable_record->'admission_reference'->>'id' = admission_reference_id),
  CONSTRAINT execution_jobs_logical_identity_key
    UNIQUE (tenant_id, organization_id, project_id, session_reference_id, agent_id, actor_id, logical_identity_digest),
  CONSTRAINT execution_jobs_idempotency_key
    UNIQUE (tenant_id, organization_id, project_id, session_reference_id, agent_id, actor_id, idempotency_fingerprint)
);

COMMIT;
