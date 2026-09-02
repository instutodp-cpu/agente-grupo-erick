-- Hermes P14-PRE operational owner identity authority.
-- Identity registration only; ownership, lease and execution remain later layers.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.runtime_operational_owners (
  contract_name TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  operational_owner_type TEXT NOT NULL,
  owner_reference_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operational_owner_id TEXT PRIMARY KEY,
  owner_identity_fingerprint TEXT NOT NULL,
  owner_identity_digest TEXT NOT NULL,
  owner_identity_artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT runtime_operational_owners_identity_check
    CHECK (
      contract_name = 'RUNTIME_OPERATIONAL_OWNER_IDENTITY_AUTHORITY'
      AND contract_version = 'runtime_operational_owner_identity_authority_contract_v1'
      AND operational_owner_type = 'operational_owner'
      AND length(btrim(owner_reference_id)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(organization_id)) > 0
      AND length(btrim(project_id)) > 0
      AND length(btrim(operational_owner_id)) > 0
      AND length(btrim(owner_identity_fingerprint)) > 0
    ),
  CONSTRAINT runtime_operational_owners_digest_check
    CHECK (owner_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT runtime_operational_owners_artifact_object_check
    CHECK (jsonb_typeof(owner_identity_artifact) = 'object'),
  CONSTRAINT runtime_operational_owners_artifact_identity_check
    CHECK (
      owner_identity_artifact->>'operational_owner_id' = operational_owner_id
      AND owner_identity_artifact->>'operational_owner_type' = operational_owner_type
      AND owner_identity_artifact->>'owner_reference_id' = owner_reference_id
      AND owner_identity_artifact->>'tenant_id' = tenant_id
      AND owner_identity_artifact->>'organization_id' = organization_id
      AND owner_identity_artifact->>'project_id' = project_id
      AND owner_identity_artifact->>'owner_identity_digest' = owner_identity_digest
      AND (owner_identity_artifact->>'operational_owner_identity_registered')::boolean = TRUE
      AND (owner_identity_artifact->>'identity_establishes_ownership')::boolean = FALSE
      AND (owner_identity_artifact->>'identity_creates_lease')::boolean = FALSE
      AND (owner_identity_artifact->>'identity_creates_fencing')::boolean = FALSE
      AND (owner_identity_artifact->>'identity_reserves_capacity')::boolean = FALSE
      AND (owner_identity_artifact->>'identity_authorizes_execution')::boolean = FALSE
    ),
  CONSTRAINT runtime_operational_owners_identity_slot UNIQUE (operational_owner_type, owner_reference_id, tenant_id)
);

COMMIT;
