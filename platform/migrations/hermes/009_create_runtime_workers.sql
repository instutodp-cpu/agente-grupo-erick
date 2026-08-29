-- Hermes P13A durable worker registry authority.
-- Registry identity/lifecycle only; selection, binding, ownership and execution remain later layers.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.runtime_workers (
  worker_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  worker_type TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  worker_capability_reference_id TEXT NOT NULL,
  worker_compatibility_reference_ids JSONB NOT NULL,
  supported_stage_types JSONB NOT NULL,
  supported_modalities JSONB NOT NULL,
  supported_model_provider_ids JSONB NOT NULL,
  supported_model_ids JSONB NOT NULL,
  supported_tool_ids JSONB NOT NULL,
  supported_workflow_ids JSONB NOT NULL,
  canonical_fingerprint TEXT NOT NULL,
  canonical_digest TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  validator_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT runtime_workers_identity_nonempty
    CHECK (
      length(btrim(worker_id)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(worker_capability_reference_id)) > 0
    ),
  CONSTRAINT runtime_workers_type_check
    CHECK (worker_type IN ('LOCAL_REFERENCE', 'REMOTE_REFERENCE', 'SHARED_REFERENCE', 'DEDICATED_REFERENCE')),
  CONSTRAINT runtime_workers_lifecycle_check
    CHECK (lifecycle_state IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT runtime_workers_compatibility_array_check
    CHECK (jsonb_typeof(worker_compatibility_reference_ids) = 'array'),
  CONSTRAINT runtime_workers_stage_array_check
    CHECK (jsonb_typeof(supported_stage_types) = 'array'),
  CONSTRAINT runtime_workers_modality_array_check
    CHECK (jsonb_typeof(supported_modalities) = 'array'),
  CONSTRAINT runtime_workers_provider_array_check
    CHECK (jsonb_typeof(supported_model_provider_ids) = 'array'),
  CONSTRAINT runtime_workers_model_array_check
    CHECK (jsonb_typeof(supported_model_ids) = 'array'),
  CONSTRAINT runtime_workers_tool_array_check
    CHECK (jsonb_typeof(supported_tool_ids) = 'array'),
  CONSTRAINT runtime_workers_workflow_array_check
    CHECK (jsonb_typeof(supported_workflow_ids) = 'array'),
  CONSTRAINT runtime_workers_identity_digest_check
    CHECK (canonical_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT runtime_workers_identity_fingerprint_check
    CHECK (length(btrim(canonical_fingerprint)) > 0),
  CONSTRAINT runtime_workers_schema_version_check
    CHECK (schema_version = 1),
  CONSTRAINT runtime_workers_validator_version_check
    CHECK (validator_version = 'runtime_worker_registry_authority_validator_v1')
);

CREATE INDEX IF NOT EXISTS runtime_workers_scope_lifecycle_idx
  ON hermes.runtime_workers (tenant_id, organization_id, project_id, lifecycle_state);

CREATE INDEX IF NOT EXISTS runtime_workers_canonical_digest_idx
  ON hermes.runtime_workers (canonical_digest);

COMMIT;
