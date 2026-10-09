-- Harden the append-only public web canary audit table without exposing it to clients.
-- Existing privileged server-side inserts remain available; no client policies are added.
BEGIN;
ALTER TABLE hermes.public_web_canary_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes.public_web_canary_audit_events FROM PUBLIC, anon, authenticated;
REVOKE USAGE ON SCHEMA hermes FROM PUBLIC, anon, authenticated;
ALTER FUNCTION hermes.reject_public_web_canary_audit_mutation() SET search_path = pg_catalog;
COMMIT;
