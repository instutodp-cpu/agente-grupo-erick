-- Hermes canonical governance authority grant revocation persistence.
-- This migration stores only immutable revocation evidence defined by PR #188. It does not
-- determine whether a root or grant is active, valid at runtime, authorized, or executable.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.governance_authority_grant_revocations (
  authority_grant_revocation_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  revocation_domain TEXT NOT NULL,
  installation_id TEXT NOT NULL,

  target_authority_grant_id TEXT NOT NULL,
  target_grant_digest TEXT NOT NULL,

  issuer_root_subject_id TEXT NOT NULL,
  issuer_root_generation INTEGER NOT NULL,
  issuer_root_digest TEXT NOT NULL,
  issuer_root_key_id TEXT NOT NULL,
  issuer_root_key_fingerprint TEXT NOT NULL,
  issuer_root_key_digest TEXT NOT NULL,

  reason_code TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,

  revocation_digest TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT governance_authority_grant_revocations_contract_version_check
    CHECK (contract_version = 'hermes_canonical_governance_authority_grant_revocation_contract_v1'),
  CONSTRAINT governance_authority_grant_revocations_domain_check
    CHECK (revocation_domain = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_REVOCATION_V1'),
  CONSTRAINT governance_authority_grant_revocations_identifier_check
    CHECK (
      authority_grant_revocation_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND installation_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND target_authority_grant_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND issuer_root_subject_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND issuer_root_key_id ~ '^[^[:space:][:cntrl:]]{1,255}$'
      AND issuer_root_subject_id = 'governance-root::' || installation_id
    ),
  CONSTRAINT governance_authority_grant_revocations_generation_check
    CHECK (issuer_root_generation >= 0),
  CONSTRAINT governance_authority_grant_revocations_digest_check
    CHECK (
      target_grant_digest ~ '^sha256:[0-9a-f]{64}$'
      AND issuer_root_digest ~ '^sha256:[0-9a-f]{64}$'
      AND issuer_root_key_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      AND issuer_root_key_digest ~ '^sha256:[0-9a-f]{64}$'
      AND revocation_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT governance_authority_grant_revocations_reason_code_check
    CHECK (reason_code IN (
      'SECURITY', 'COMPROMISED', 'SUPERSEDED', 'SUBJECT_DISABLED',
      'SCOPE_CHANGED', 'ADMINISTRATIVE', 'OTHER'
    )),
  CONSTRAINT governance_authority_grant_revocations_validity_window_check
    CHECK (effective_at >= issued_at)
);

CREATE INDEX IF NOT EXISTS governance_authority_grant_revocations_installation_target_idx
  ON hermes.governance_authority_grant_revocations (installation_id, target_authority_grant_id);

CREATE INDEX IF NOT EXISTS governance_authority_grant_revocations_root_binding_idx
  ON hermes.governance_authority_grant_revocations (
    issuer_root_subject_id, issuer_root_generation, issuer_root_digest,
    issuer_root_key_id, issuer_root_key_fingerprint, issuer_root_key_digest
  );

CREATE OR REPLACE FUNCTION hermes.reject_governance_authority_grant_revocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'governance_authority_grant_revocation_update_forbidden';
  END IF;
  RAISE EXCEPTION 'governance_authority_grant_revocation_delete_forbidden';
END;
$$;

DROP TRIGGER IF EXISTS governance_authority_grant_revocations_mutation_trigger
  ON hermes.governance_authority_grant_revocations;

CREATE TRIGGER governance_authority_grant_revocations_mutation_trigger
  BEFORE UPDATE OR DELETE ON hermes.governance_authority_grant_revocations
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_authority_grant_revocation_mutation();

COMMIT;
