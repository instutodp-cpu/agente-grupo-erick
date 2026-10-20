-- Durable observation of the EXISTING isolated test subprocess, NOT
-- independent A3 source issuance / simulation receipt / SCM authorization.
-- An official MissionRun must be verified before the first insert.
-- Reserve ONCE before any subprocess; ambiguous states remain locked.
BEGIN;
CREATE SCHEMA IF NOT EXISTS hermes;
CREATE TABLE IF NOT EXISTS hermes.maintainer_a3_process_observations (
 mission_run_id TEXT PRIMARY KEY,
 mission_id TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL,
 environment TEXT NOT NULL,
 operation TEXT NOT NULL,
 repository TEXT NOT NULL,
 contract_hash TEXT NOT NULL,
 revision_sha TEXT NOT NULL,
 docker_image_id TEXT NOT NULL,
 test_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'reserved',
 observation_digest TEXT,
 observation_evidence JSONB,
 failure_code TEXT,
 reserved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TIMESTAMPTZ,
 CONSTRAINT a3_process_observation_identity CHECK (
   length(btrim(mission_run_id))>0 AND length(btrim(mission_id))>0
   AND length(btrim(workspace_id))>0),
 CONSTRAINT a3_process_observation_staging CHECK (environment='staging'),
 CONSTRAINT a3_process_observation_repo CHECK (
   repository='instutodp-cpu/agente-grupo-erick'),
 CONSTRAINT a3_process_observation_op CHECK (
   operation IN ('update_file','create_pull_request')),
 CONSTRAINT a3_process_observation_hashes CHECK (
   contract_hash ~ '^sha256:[a-f0-9]{64}$'
   AND revision_sha ~ '^[a-f0-9]{40}$'
   AND docker_image_id ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT a3_process_observation_test CHECK (test_id='hermes_core_smoke'),
 CONSTRAINT a3_process_observation_state CHECK (
   state IN ('reserved','process_observed','failed_safe')),
 CONSTRAINT a3_process_observation_digest CHECK (
   observation_digest IS NULL OR observation_digest ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT a3_process_observation_evidence CHECK (
   (state='reserved' AND observation_digest IS NULL
    AND observation_evidence IS NULL AND failure_code IS NULL
    AND finished_at IS NULL)
   OR
   (state='process_observed' AND observation_digest IS NOT NULL
    AND jsonb_typeof(observation_evidence)='object'
    AND observation_evidence->>'observation_type'='isolated_test_process_only'
    AND observation_evidence->>'simulation_receipt_durable'='false'
    AND observation_evidence->>'independent_issuer_verified'='false'
    AND observation_evidence->>'execution_authorized'='false'
    AND observation_evidence->>'outbox_acknowledged'='false'
    AND observation_evidence->>'network_call_performed' IS NULL
    AND observation_evidence->>'scm_write_performed' IS NULL
    AND octet_length(observation_evidence::text)<=8192
    AND failure_code IS NULL AND finished_at IS NOT NULL)
   OR
   (state='failed_safe' AND observation_digest IS NULL
    AND observation_evidence IS NULL AND failure_code IS NOT NULL
    AND length(failure_code)<=128 AND finished_at IS NOT NULL))
);
ALTER TABLE hermes.maintainer_a3_process_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes.maintainer_a3_process_observations
 FROM PUBLIC, anon, authenticated;
REVOKE USAGE ON SCHEMA hermes FROM PUBLIC, anon, authenticated;
COMMIT;
