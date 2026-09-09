-- Hermes canonical governance authority grant persistence.
-- This migration stores only the immutable evidence defined by PR #186. It does not
-- establish root activity, grant validity at runtime, authorization, or execution authority.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE OR REPLACE FUNCTION hermes.authority_grant_capabilities_valid(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'array' THEN FALSE
    ELSE jsonb_array_length(value) BETWEEN 1 AND 3
      AND value <@ '["GOVERNANCE_AUDIT_READ", "GOVERNANCE_REVOKE_AUTHORITY", "GOVERNANCE_ROTATE_ROOT_KEY"]'::jsonb
      AND (
        SELECT count(*) FROM jsonb_array_elements_text(value)
      ) = (
        SELECT count(DISTINCT item) FROM jsonb_array_elements_text(value) AS elements(item)
      )
  END;
$$;

CREATE OR REPLACE FUNCTION hermes.authority_grant_object_keys_exact(value JSONB, expected TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  actual_count INTEGER := 0;
  key_name TEXT;
BEGIN
  IF jsonb_typeof(value) <> 'object' THEN RETURN FALSE; END IF;
  FOR key_name IN SELECT jsonb_object_keys(value) LOOP
    actual_count := actual_count + 1;
    IF NOT key_name = ANY(expected) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN actual_count = cardinality(expected);
END;
$$;

CREATE TABLE IF NOT EXISTS hermes.governance_authority_grants (
  authority_grant_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  grant_domain TEXT NOT NULL,
  installation_id TEXT NOT NULL,

  issuer_root_subject_id TEXT NOT NULL,
  issuer_root_generation INTEGER NOT NULL,
  issuer_root_digest TEXT NOT NULL,
  issuer_root_key_id TEXT NOT NULL,
  issuer_root_key_fingerprint TEXT NOT NULL,
  issuer_root_key_digest TEXT NOT NULL,

  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,

  authority_scope JSONB NOT NULL,
  capabilities JSONB NOT NULL,
  restrictions JSONB NOT NULL,

  issued_at TIMESTAMPTZ NOT NULL,
  not_before TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,

  grant_digest TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT governance_authority_grants_contract_version_check
    CHECK (contract_version = 'hermes_canonical_governance_authority_grant_contract_v1'),
  CONSTRAINT governance_authority_grants_domain_check
    CHECK (grant_domain = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_V1'),
  CONSTRAINT governance_authority_grants_identifier_check
    CHECK (
      authority_grant_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND installation_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND issuer_root_subject_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND issuer_root_key_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND subject_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND issuer_root_subject_id = 'governance-root::' || installation_id
      AND subject_id <> issuer_root_subject_id
    ),
  CONSTRAINT governance_authority_grants_generation_check
    CHECK (issuer_root_generation >= 0),
  CONSTRAINT governance_authority_grants_digest_check
    CHECK (
      issuer_root_digest ~ '^sha256:[0-9a-f]{64}$'
      AND issuer_root_key_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      AND issuer_root_key_digest ~ '^sha256:[0-9a-f]{64}$'
      AND grant_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT governance_authority_grants_subject_type_check
    CHECK (subject_type IN ('AGENT', 'USER', 'SERVICE', 'SYSTEM')),
  CONSTRAINT governance_authority_grants_scope_object_check
    CHECK (
      jsonb_typeof(authority_scope) = 'object'
      AND hermes.authority_grant_object_keys_exact(authority_scope, ARRAY[
        'scope_type', 'installation_id', 'tenant_ids', 'organization_ids',
        'project_ids', 'cross_tenant', 'cross_organization', 'cross_project'
      ])
      AND authority_scope->>'scope_type' = 'installation'
      AND authority_scope->>'installation_id' = installation_id
      AND jsonb_typeof(authority_scope->'tenant_ids') = 'array'
      AND jsonb_typeof(authority_scope->'organization_ids') = 'array'
      AND jsonb_typeof(authority_scope->'project_ids') = 'array'
      AND authority_scope->>'cross_tenant' = 'false'
      AND authority_scope->>'cross_organization' = 'false'
      AND authority_scope->>'cross_project' = 'false'
      AND (
        jsonb_array_length(authority_scope->'tenant_ids') > 0
        OR jsonb_array_length(authority_scope->'organization_ids') > 0
        OR jsonb_array_length(authority_scope->'project_ids') > 0
      )
  ),
  CONSTRAINT governance_authority_grants_capabilities_check
    CHECK (hermes.authority_grant_capabilities_valid(capabilities)),
  CONSTRAINT governance_authority_grants_restrictions_check
    CHECK (
      jsonb_typeof(restrictions) = 'object'
      AND hermes.authority_grant_object_keys_exact(restrictions, ARRAY[
        'allow_further_delegation', 'allow_cross_tenant',
        'allow_cross_organization', 'allow_cross_project'
      ])
      AND restrictions->>'allow_further_delegation' = 'false'
      AND restrictions->>'allow_cross_tenant' = 'false'
      AND restrictions->>'allow_cross_organization' = 'false'
      AND restrictions->>'allow_cross_project' = 'false'
    ),
  CONSTRAINT governance_authority_grants_validity_window_check
    CHECK (not_before >= issued_at AND expires_at > not_before)
);

CREATE INDEX IF NOT EXISTS governance_authority_grants_installation_subject_idx
  ON hermes.governance_authority_grants (installation_id, subject_id);

CREATE INDEX IF NOT EXISTS governance_authority_grants_root_binding_idx
  ON hermes.governance_authority_grants (
    issuer_root_subject_id, issuer_root_generation, issuer_root_digest,
    issuer_root_key_id, issuer_root_key_fingerprint, issuer_root_key_digest
  );

CREATE OR REPLACE FUNCTION hermes.reject_governance_authority_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'governance_authority_grant_update_forbidden';
  END IF;
  RAISE EXCEPTION 'governance_authority_grant_delete_forbidden';
END;
$$;

DROP TRIGGER IF EXISTS governance_authority_grants_mutation_trigger
  ON hermes.governance_authority_grants;

CREATE TRIGGER governance_authority_grants_mutation_trigger
  BEFORE UPDATE OR DELETE ON hermes.governance_authority_grants
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_authority_grant_mutation();

COMMIT;
