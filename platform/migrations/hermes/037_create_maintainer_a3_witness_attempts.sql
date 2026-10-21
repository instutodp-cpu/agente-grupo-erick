-- Exclusive irreversible reservation for independent witness attempt.
-- This is NOT a MissionRun dispatch, not a retry permit, not an execution grant.
-- An uncertain COMMIT must NOT trigger a second Docker create.
BEGIN;
CREATE TABLE IF NOT EXISTS hermes.maintainer_a3_witness_attempts (
 mission_run_id TEXT PRIMARY KEY REFERENCES
  hermes.maintainer_a3_process_observations(mission_run_id),
 mission_id TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL,
 official_outbox_id TEXT NOT NULL UNIQUE,
 contract_hash TEXT NOT NULL,
 revision_sha TEXT NOT NULL,
 docker_image_id TEXT NOT NULL,
 environment TEXT NOT NULL DEFAULT 'staging',
 reserved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT a3_independent_attempt_staging CHECK (environment='staging'),
 CONSTRAINT a3_independent_attempt_digests CHECK (
  contract_hash ~ '^sha256:[a-f0-9]{64}$'
  AND docker_image_id ~ '^sha256:[a-f0-9]{64}$'
  AND revision_sha ~ '^[a-f0-9]{40}$'),
 CONSTRAINT a3_independent_attempt_nonempty CHECK (
  length(btrim(mission_run_id))>0 AND length(btrim(mission_id))>0
  AND length(btrim(workspace_id))>0 AND length(btrim(official_outbox_id))>0)
);
ALTER TABLE hermes.maintainer_a3_witness_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes.maintainer_a3_witness_attempts FROM PUBLIC;
REVOKE USAGE ON SCHEMA hermes FROM PUBLIC;
DO $a3_issuer_policies$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON hermes.maintainer_a3_witness_attempts FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON hermes.maintainer_a3_witness_attempts FROM authenticated;
 END IF;
 -- Explicit role provisioning and independently supervised issuer custody
 -- are separate DBA actions. No credentials, owner grants or policies here.
END $a3_issuer_policies$;
COMMIT;
