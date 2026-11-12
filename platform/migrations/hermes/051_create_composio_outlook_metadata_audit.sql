-- Grupo Erick shared Outlook metadata-only canary: durable quota and audit.
-- Applied to hermes-brain on 2026-11-11 with restrictive schema/table/function grants.
-- This repo file is the reviewable canonical DDL; no live provider calls.
BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;
REVOKE ALL ON SCHEMA hermes FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS hermes.composio_outlook_metadata_audit (
  event_id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'grupo_erick'
    CHECK (tenant_id = 'grupo_erick'),
  scope_type TEXT NOT NULL DEFAULT 'group_shared'
    CHECK (scope_type = 'group_shared'),
  user_id TEXT NOT NULL CHECK (length(btrim(user_id)) BETWEEN 1 AND 128),
  event_type TEXT NOT NULL CHECK (event_type IN ('attempt','result')),
  outcome TEXT CHECK (outcome IN ('SUCCEEDED','FAILED')),
  sampled_messages INTEGER CHECK (sampled_messages BETWEEN 0 AND 10),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (trace_id, event_type),
  CONSTRAINT composio_outlook_metadata_event_consistency CHECK (
    (event_type = 'attempt' AND outcome IS NULL AND sampled_messages IS NULL)
    OR (event_type = 'result' AND
        ((outcome = 'FAILED' AND sampled_messages IS NULL)
         OR (outcome = 'SUCCEEDED' AND sampled_messages IS NOT NULL)))
  )
);

CREATE INDEX IF NOT EXISTS composio_outlook_metadata_budget_idx
  ON hermes.composio_outlook_metadata_audit
    (tenant_id, scope_type, event_type, occurred_at DESC);

ALTER TABLE hermes.composio_outlook_metadata_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes.composio_outlook_metadata_audit
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hermes.reject_composio_outlook_metadata_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'composio_outlook_metadata_audit_append_only';
END;
$$;
REVOKE ALL ON FUNCTION hermes.reject_composio_outlook_metadata_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS composio_outlook_metadata_update_trigger
  ON hermes.composio_outlook_metadata_audit;
CREATE TRIGGER composio_outlook_metadata_update_trigger
  BEFORE UPDATE ON hermes.composio_outlook_metadata_audit
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_composio_outlook_metadata_mutation();

DROP TRIGGER IF EXISTS composio_outlook_metadata_delete_trigger
  ON hermes.composio_outlook_metadata_audit;
CREATE TRIGGER composio_outlook_metadata_delete_trigger
  BEFORE DELETE ON hermes.composio_outlook_metadata_audit
  FOR EACH ROW EXECUTE FUNCTION hermes.reject_composio_outlook_metadata_mutation();

COMMIT;
