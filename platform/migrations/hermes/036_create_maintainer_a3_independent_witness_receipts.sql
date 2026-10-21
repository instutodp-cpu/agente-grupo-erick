-- Independent-supervisor receipt ledger, staging ONLY.
-- This table MUST be written by an independently controlled issuer principal
-- after contemporaneous supervision of one isolated process. Hermes may read
-- but MUST NOT issue, fabricate or backfill receipts into this table.
-- No state changes for the official Maestro run/outbox or SCM authority.
BEGIN;
CREATE SCHEMA IF NOT EXISTS hermes;
CREATE TABLE IF NOT EXISTS hermes.maintainer_a3_independent_witness_receipts (
 mission_run_id TEXT PRIMARY KEY REFERENCES
  hermes.maintainer_a3_process_observations(mission_run_id),
 mission_id TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL,
 official_outbox_id TEXT NOT NULL UNIQUE,
 issuer_id TEXT NOT NULL,
 process_observation_digest TEXT NOT NULL UNIQUE,
 receipt_digest TEXT NOT NULL UNIQUE,
 receipt_envelope JSONB NOT NULL,
 witnessed_started_at TIMESTAMPTZ NOT NULL,
 witnessed_finished_at TIMESTAMPTZ NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL,
 committed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT a3_witness_nonempty_ids CHECK (
  length(btrim(mission_run_id))>0 AND length(btrim(mission_id))>0
  AND length(btrim(workspace_id))>0 AND length(btrim(issuer_id))>0
  AND length(btrim(official_outbox_id))>0),
 CONSTRAINT a3_witness_digests CHECK (
  process_observation_digest ~ '^sha256:[a-f0-9]{64}$'
  AND receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT a3_witness_envelope CHECK (
  jsonb_typeof(receipt_envelope)='object'
  AND octet_length(receipt_envelope::text)<=16384),
 CONSTRAINT a3_witness_times CHECK (
  witnessed_started_at<=witnessed_finished_at
  AND witnessed_finished_at<=issued_at
  AND issued_at<=committed_at+INTERVAL '30 seconds'
  AND committed_at<=issued_at+INTERVAL '30 seconds'
  AND witnessed_finished_at-witnessed_started_at<=INTERVAL '120 seconds')
);
ALTER TABLE hermes.maintainer_a3_independent_witness_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes.maintainer_a3_independent_witness_receipts FROM PUBLIC;
REVOKE USAGE ON SCHEMA hermes FROM PUBLIC;
DO $portable_acl$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON TABLE hermes.maintainer_a3_independent_witness_receipts FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON TABLE hermes.maintainer_a3_independent_witness_receipts FROM authenticated;
 END IF;
END $portable_acl$;
COMMIT;
