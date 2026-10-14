-- Durable staging-only inbox for bounded Maestro -> Hermes public-web missions.
-- Admission only: this table does not authorize execution or call any provider.
BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.public_web_operational_mission_inbox (
  inbox_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  mission_run_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  contract_hash TEXT NOT NULL,
  dispatch_token_digest TEXT NOT NULL,
  target_origin TEXT NOT NULL,
  target_path TEXT NOT NULL,
  mission_payload JSONB NOT NULL,
  trial_config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  received_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT public_web_operational_mission_inbox_identity_check CHECK (
    length(btrim(inbox_id)) > 0
    AND contract_version = 'public_web_operational_mission_inbox_v1'
    AND length(btrim(mission_id)) > 0
    AND length(btrim(mission_run_id)) > 0
    AND length(btrim(tenant_id)) > 0
    AND length(btrim(workspace_id)) > 0
    AND length(btrim(workspace_type)) > 0
    AND length(btrim(principal_id)) > 0
    AND length(btrim(idempotency_key)) > 0
    AND length(btrim(correlation_id)) > 0
    AND contract_hash ~ '^sha256:[0-9a-f]{64}$'
    AND dispatch_token_digest ~ '^sha256:[0-9a-f]{64}$'
    AND target_origin ~ '^https://'
    AND target_path ~ '^/'
  ),
  CONSTRAINT public_web_operational_mission_inbox_status_check CHECK (
    status IN ('accepted','preparing','awaiting_human_reauth','ready_for_tty','executing','succeeded','failed_safe','acknowledged')
  ),
  CONSTRAINT public_web_operational_mission_inbox_payload_check CHECK (
    jsonb_typeof(mission_payload) = 'object'
    AND mission_payload->>'dispatch_token' IS NULL
    AND mission_payload->>'mission_run_id' = mission_run_id
    AND mission_payload->>'contract_hash' = contract_hash
    AND octet_length(mission_payload::text) <= 65536
  ),
  CONSTRAINT public_web_operational_mission_inbox_trial_check CHECK (
    jsonb_typeof(trial_config) = 'object'
    AND trial_config->>'environment' = 'staging'
    AND trial_config->>'tenant_id' = tenant_id
    AND trial_config->>'workspace_type' = workspace_type
    AND (trial_config->>'maximum_requests')::integer = 1
    AND octet_length(trial_config::text) <= 32768
  )
);

CREATE INDEX IF NOT EXISTS public_web_operational_mission_inbox_tenant_status_idx
  ON hermes.public_web_operational_mission_inbox (tenant_id, workspace_id, status, received_at);

ALTER TABLE hermes.public_web_operational_mission_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes.public_web_operational_mission_inbox FROM PUBLIC, anon, authenticated;
REVOKE USAGE ON SCHEMA hermes FROM PUBLIC, anon, authenticated;

COMMIT;
