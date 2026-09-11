-- Hermes Public Web canary durable audit trail v1.
-- Append-only evidence only. This migration does not enable the canary,
-- configure a target, provide an authentication value, or call an external provider.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.public_web_canary_audit_events (
  event_id TEXT PRIMARY KEY,
  event_digest TEXT NOT NULL UNIQUE,
  contract_version TEXT NOT NULL,
  canary_session_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_type TEXT NOT NULL,
  user_id TEXT,
  operator_id TEXT NOT NULL,
  approved_by TEXT,
  event_name TEXT NOT NULL,
  event_sequence BIGINT NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL,
  event_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT public_web_canary_audit_identity_check
    CHECK (
      length(btrim(event_id)) > 0
      AND event_digest ~ '^sha256:[0-9a-f]{64}$'
      AND length(btrim(contract_version)) > 0
      AND length(btrim(canary_session_id)) > 0
      AND length(btrim(trace_id)) > 0
      AND length(btrim(request_id)) > 0
      AND length(btrim(change_id)) > 0
      AND length(btrim(tenant_id)) > 0
      AND length(btrim(workspace_type)) > 0
      AND length(btrim(operator_id)) > 0
    ),
  CONSTRAINT public_web_canary_audit_contract_check
    CHECK (contract_version = 'public_web_canary_durable_audit_v1'),
  CONSTRAINT public_web_canary_audit_event_name_check
    CHECK (event_name IN (
      'public_web_canary_requested',
      'public_web_canary_validation_passed',
      'public_web_canary_validation_blocked',
      'public_web_canary_approved',
      'public_web_canary_activated',
      'public_web_canary_request_started',
      'public_web_canary_request_succeeded',
      'public_web_canary_request_failed_safe',
      'public_web_canary_completed',
      'public_web_canary_expired',
      'public_web_canary_cancelled',
      'public_web_canary_kill_switch_terminated',
      'public_web_canary_trial_cleanup'
    )),
  CONSTRAINT public_web_canary_audit_sequence_check
    CHECK (event_sequence >= 0),
  CONSTRAINT public_web_canary_audit_payload_check
    CHECK (
      jsonb_typeof(event_payload) = 'object'
      AND event_payload->>'event_id' IS NULL
      AND octet_length(event_payload::text) <= 16384
      AND event_payload->>'canary_session_id' = canary_session_id
      AND event_payload->>'tenant_id' = tenant_id
      AND event_payload->>'workspace_type' = workspace_type
      AND event_payload->>'operator_id' = operator_id
      AND event_payload->>'event_name' = event_name
    )
);

CREATE INDEX IF NOT EXISTS public_web_canary_audit_session_idx
  ON hermes.public_web_canary_audit_events (canary_session_id, occurred_at, event_sequence, event_id);

CREATE INDEX IF NOT EXISTS public_web_canary_audit_tenant_idx
  ON hermes.public_web_canary_audit_events (tenant_id, workspace_type, occurred_at);

CREATE OR REPLACE FUNCTION hermes.reject_public_web_canary_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'public_web_canary_audit_append_only';
END;
$$;

DROP TRIGGER IF EXISTS public_web_canary_audit_update_trigger ON hermes.public_web_canary_audit_events;
CREATE TRIGGER public_web_canary_audit_update_trigger
  BEFORE UPDATE ON hermes.public_web_canary_audit_events
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_public_web_canary_audit_mutation();

DROP TRIGGER IF EXISTS public_web_canary_audit_delete_trigger ON hermes.public_web_canary_audit_events;
CREATE TRIGGER public_web_canary_audit_delete_trigger
  BEFORE DELETE ON hermes.public_web_canary_audit_events
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_public_web_canary_audit_mutation();

COMMIT;
