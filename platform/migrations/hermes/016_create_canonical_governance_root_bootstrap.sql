-- Hermes owner-controlled installation bootstrap and canonical governance root.
-- Bootstrap and root creation are committed by one domain transaction.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.installation_bootstrap_guard (
  guard_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT installation_bootstrap_guard_key_check
    CHECK (guard_key = 'canonical_governance_root')
);

INSERT INTO hermes.installation_bootstrap_guard (guard_key)
VALUES ('canonical_governance_root')
ON CONFLICT (guard_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS hermes.installations (
  installation_id TEXT PRIMARY KEY,
  installation_slot TEXT NOT NULL UNIQUE,
  installation_identity JSONB NOT NULL,
  installation_identity_digest TEXT NOT NULL UNIQUE,
  lifecycle_state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bootstrapped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,

  CONSTRAINT installations_slot_check
    CHECK (installation_slot = 'canonical'),
  CONSTRAINT installations_identity_object_check
    CHECK (jsonb_typeof(installation_identity) = 'object'),
  CONSTRAINT installations_identity_digest_check
    CHECK (installation_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT installations_state_check
    CHECK (lifecycle_state IN ('UNINITIALIZED', 'BOOTSTRAPPED', 'SUSPENDED', 'RECOVERY_REQUIRED', 'REVOKED')),
  CONSTRAINT installations_timestamp_check
    CHECK (bootstrapped_at IS NULL OR bootstrapped_at >= created_at),
  CONSTRAINT installations_revoked_timestamp_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS hermes.installation_bootstraps (
  bootstrap_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL UNIQUE
    REFERENCES hermes.installations (installation_id) ON DELETE RESTRICT,
  artifact_digest TEXT NOT NULL UNIQUE,
  provenance_digest TEXT NOT NULL,
  external_authorization_id TEXT NOT NULL UNIQUE,
  external_attestation_digest TEXT NOT NULL,
  bootstrap_artifact JSONB NOT NULL,
  external_authorization JSONB NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT installation_bootstraps_identity_check
    CHECK (
      length(btrim(bootstrap_id)) > 0
      AND length(btrim(installation_id)) > 0
      AND artifact_digest ~ '^sha256:[0-9a-f]{64}$'
      AND provenance_digest ~ '^sha256:[0-9a-f]{64}$'
      AND length(btrim(external_authorization_id)) > 0
      AND external_attestation_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT installation_bootstraps_artifact_object_check
    CHECK (jsonb_typeof(bootstrap_artifact) = 'object'),
  CONSTRAINT installation_bootstraps_authorization_object_check
    CHECK (jsonb_typeof(external_authorization) = 'object'),
  CONSTRAINT installation_bootstraps_receipt_object_check
    CHECK (jsonb_typeof(receipt) = 'object'),
  CONSTRAINT installation_bootstraps_timestamp_check
    CHECK (applied_at >= created_at),
  CONSTRAINT installation_bootstraps_artifact_binding_check
    CHECK (
      bootstrap_artifact->>'bootstrap_id' = bootstrap_id
      AND bootstrap_artifact->>'installation_id' = installation_id
      AND bootstrap_artifact->>'artifact_digest' = artifact_digest
      AND bootstrap_artifact->>'provenance_digest' = provenance_digest
    ),
  CONSTRAINT installation_bootstraps_authorization_binding_check
    CHECK (
      external_authorization->>'authorization_id' = external_authorization_id
      AND external_authorization->>'attestation_digest' = external_attestation_digest
      AND external_authorization->>'authorized_artifact_digest' = artifact_digest
    )
);

CREATE TABLE IF NOT EXISTS hermes.governance_root_subjects (
  root_subject_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL UNIQUE
    REFERENCES hermes.installations (installation_id) ON DELETE RESTRICT,
  root_subject_slot TEXT NOT NULL UNIQUE,
  root_scope JSONB NOT NULL,
  root_capabilities JSONB NOT NULL,
  delegation_policy JSONB NOT NULL,
  root_fingerprint TEXT NOT NULL,
  root_digest TEXT NOT NULL UNIQUE,
  active_generation INTEGER NOT NULL,
  lifecycle_state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,

  CONSTRAINT governance_root_subjects_slot_check
    CHECK (root_subject_slot = 'canonical'),
  CONSTRAINT governance_root_subjects_scope_object_check
    CHECK (jsonb_typeof(root_scope) = 'object'),
  CONSTRAINT governance_root_subjects_capabilities_array_check
    CHECK (jsonb_typeof(root_capabilities) = 'array'),
  CONSTRAINT governance_root_subjects_delegation_object_check
    CHECK (jsonb_typeof(delegation_policy) = 'object'),
  CONSTRAINT governance_root_subjects_identity_check
    CHECK (
      length(btrim(root_subject_id)) > 0
      AND root_fingerprint LIKE '{%'
      AND root_digest ~ '^sha256:[0-9a-f]{64}$'
      AND active_generation >= 0
    ),
  CONSTRAINT governance_root_subjects_state_check
    CHECK (lifecycle_state IN ('ACTIVE', 'RECOVERY_REQUIRED', 'REVOKED')),
  CONSTRAINT governance_root_subjects_revoked_timestamp_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS hermes.governance_root_keys (
  root_key_id TEXT PRIMARY KEY,
  root_subject_id TEXT NOT NULL
    REFERENCES hermes.governance_root_subjects (root_subject_id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL,
  algorithm TEXT NOT NULL,
  public_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL UNIQUE,
  key_digest TEXT NOT NULL UNIQUE,
  lifecycle_state TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT governance_root_keys_generation_check
    CHECK (generation >= 0),
  CONSTRAINT governance_root_keys_algorithm_check
    CHECK (algorithm = 'Ed25519'),
  CONSTRAINT governance_root_keys_public_material_check
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT governance_root_keys_fingerprint_check
    CHECK (key_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT governance_root_keys_digest_check
    CHECK (key_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT governance_root_keys_state_check
    CHECK (lifecycle_state IN ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
  CONSTRAINT governance_root_keys_revoked_timestamp_check
    CHECK (revoked_at IS NULL OR revoked_at >= valid_from),
  CONSTRAINT governance_root_keys_generation_unique
    UNIQUE (root_subject_id, generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS governance_root_keys_one_active_idx
  ON hermes.governance_root_keys (root_subject_id)
  WHERE lifecycle_state = 'ACTIVE';

CREATE INDEX IF NOT EXISTS installations_lifecycle_idx
  ON hermes.installations (lifecycle_state);

CREATE INDEX IF NOT EXISTS installation_bootstraps_installation_idx
  ON hermes.installation_bootstraps (installation_id);

CREATE INDEX IF NOT EXISTS governance_root_subjects_lifecycle_idx
  ON hermes.governance_root_subjects (lifecycle_state);

CREATE INDEX IF NOT EXISTS governance_root_keys_lifecycle_idx
  ON hermes.governance_root_keys (root_subject_id, lifecycle_state);

CREATE TABLE IF NOT EXISTS hermes.governance_audit_events (
  event_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL
    REFERENCES hermes.installations (installation_id) ON DELETE RESTRICT,
  bootstrap_id TEXT
    REFERENCES hermes.installation_bootstraps (bootstrap_id) ON DELETE RESTRICT,
  root_subject_id TEXT
    REFERENCES hermes.governance_root_subjects (root_subject_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  actor_key_id TEXT,
  before_digest TEXT,
  after_digest TEXT NOT NULL,
  event_digest TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT governance_audit_events_identity_check
    CHECK (
      length(btrim(event_id)) > 0
      AND length(btrim(installation_id)) > 0
      AND length(btrim(event_type)) > 0
      AND length(btrim(actor_subject)) > 0
      AND length(btrim(after_digest)) > 0
      AND event_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT governance_audit_events_type_check
    CHECK (event_type IN ('BOOTSTRAP_APPLIED', 'ROOT_ESTABLISHED', 'ROOT_KEY_ESTABLISHED', 'ROOT_ROTATED', 'ROOT_REVOKED', 'ROOT_RECOVERED')),
  CONSTRAINT governance_audit_events_before_digest_check
    CHECK (before_digest IS NULL OR before_digest ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS governance_audit_events_installation_idx
  ON hermes.governance_audit_events (installation_id, created_at);

CREATE INDEX IF NOT EXISTS governance_audit_events_root_idx
  ON hermes.governance_audit_events (root_subject_id, created_at);

CREATE OR REPLACE FUNCTION hermes.reject_governance_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'installations' AND (
    NEW.installation_id IS DISTINCT FROM OLD.installation_id
    OR NEW.installation_slot IS DISTINCT FROM OLD.installation_slot
    OR NEW.installation_identity IS DISTINCT FROM OLD.installation_identity
    OR NEW.installation_identity_digest IS DISTINCT FROM OLD.installation_identity_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'governance_installation_identity_immutable';
  END IF;
  IF TG_TABLE_NAME = 'installation_bootstraps' THEN
    RAISE EXCEPTION 'governance_bootstrap_append_only';
  END IF;
  IF TG_TABLE_NAME = 'governance_root_subjects' AND (
    NEW.root_subject_id IS DISTINCT FROM OLD.root_subject_id
    OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
    OR NEW.root_subject_slot IS DISTINCT FROM OLD.root_subject_slot
    OR NEW.root_scope IS DISTINCT FROM OLD.root_scope
    OR NEW.root_capabilities IS DISTINCT FROM OLD.root_capabilities
    OR NEW.delegation_policy IS DISTINCT FROM OLD.delegation_policy
    OR NEW.root_fingerprint IS DISTINCT FROM OLD.root_fingerprint
    OR NEW.root_digest IS DISTINCT FROM OLD.root_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'governance_root_subject_immutable';
  END IF;
  IF TG_TABLE_NAME = 'governance_root_keys' AND (
    NEW.root_key_id IS DISTINCT FROM OLD.root_key_id
    OR NEW.root_subject_id IS DISTINCT FROM OLD.root_subject_id
    OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
    OR NEW.public_key IS DISTINCT FROM OLD.public_key
    OR NEW.key_fingerprint IS DISTINCT FROM OLD.key_fingerprint
    OR NEW.key_digest IS DISTINCT FROM OLD.key_digest
    OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'governance_root_key_immutable';
  END IF;
  IF TG_TABLE_NAME = 'governance_audit_events' THEN
    RAISE EXCEPTION 'governance_audit_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS installations_immutable_trigger ON hermes.installations;
CREATE TRIGGER installations_immutable_trigger
  BEFORE UPDATE ON hermes.installations
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_immutable_update();

DROP TRIGGER IF EXISTS installation_bootstraps_append_only_trigger ON hermes.installation_bootstraps;
CREATE TRIGGER installation_bootstraps_append_only_trigger
  BEFORE UPDATE ON hermes.installation_bootstraps
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_immutable_update();

DROP TRIGGER IF EXISTS governance_root_subjects_immutable_trigger ON hermes.governance_root_subjects;
CREATE TRIGGER governance_root_subjects_immutable_trigger
  BEFORE UPDATE ON hermes.governance_root_subjects
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_immutable_update();

DROP TRIGGER IF EXISTS governance_root_keys_immutable_trigger ON hermes.governance_root_keys;
CREATE TRIGGER governance_root_keys_immutable_trigger
  BEFORE UPDATE ON hermes.governance_root_keys
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_immutable_update();

DROP TRIGGER IF EXISTS governance_audit_append_only_trigger ON hermes.governance_audit_events;
CREATE TRIGGER governance_audit_append_only_trigger
  BEFORE UPDATE ON hermes.governance_audit_events
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_immutable_update();

CREATE OR REPLACE FUNCTION hermes.reject_governance_audit_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'governance_audit_append_only';
END;
$$;

DROP TRIGGER IF EXISTS governance_audit_delete_trigger ON hermes.governance_audit_events;
CREATE TRIGGER governance_audit_delete_trigger
  BEFORE DELETE ON hermes.governance_audit_events
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_governance_audit_delete();

COMMIT;
