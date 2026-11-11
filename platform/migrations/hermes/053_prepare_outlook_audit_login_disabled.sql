-- 053: Prepare a dedicated corporate Outlook audit login WITHOUT activating it.
-- Applied only after the Grupo Erick owner UUID was verified against one
-- active hermes_brain.memberships record and auth.users; no mailbox access.
-- Password NULL + NOLOGIN: cannot authenticate, even if someone knows its name.
-- Never grant this principal to public, anon, authenticated or service_role.
DO $outlook_login$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hermes_outlook_audit_login') THEN
    RAISE EXCEPTION 'outlook_audit_login_already_exists_review_required';
  END IF;
  CREATE ROLE hermes_outlook_audit_login
    NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION CONNECTION LIMIT 2 PASSWORD NULL;
END
$outlook_login$;
GRANT hermes_outlook_audit_writer TO hermes_outlook_audit_login
  WITH INHERIT FALSE, SET TRUE;
ALTER ROLE hermes_outlook_audit_login SET statement_timeout = '15s';
ALTER ROLE hermes_outlook_audit_login SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE hermes_outlook_audit_login SET search_path = pg_catalog;
