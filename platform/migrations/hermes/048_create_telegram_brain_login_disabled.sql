-- Hermes Brain, staging: isolated machine login identity.
-- No password, no LOGIN, no database connectivity is enabled here.
-- Human-controlled provisioning in a separate step may set LOGIN with 0600 VPS secret.
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles
  WHERE rolname='hermes_telegram_brain_reader'
    AND rolcanlogin=false AND rolbypassrls=false AND rolsuper=false
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='hermes_brain' AND tablename='memory_items'
   AND policyname='brain_telegram_read_approved_memory'
 ) THEN
  RAISE EXCEPTION 'brain_telegram_scoped_reader_required';
 END IF;
END $guard$;
CREATE ROLE hermes_telegram_brain_login
 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT hermes_telegram_brain_reader TO hermes_telegram_brain_login
 WITH INHERIT FALSE, SET TRUE;
REVOKE ALL ON SCHEMA hermes_brain FROM hermes_telegram_brain_login;
DO $check$
BEGIN
 IF (SELECT rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper OR rolcreaterole
     FROM pg_catalog.pg_roles WHERE rolname='hermes_telegram_brain_login')
 OR NOT EXISTS (
   SELECT 1
   FROM pg_catalog.pg_auth_members mm
   JOIN pg_catalog.pg_roles member ON member.oid=mm.member
   JOIN pg_catalog.pg_roles assigned ON assigned.oid=mm.roleid
   WHERE member.rolname='hermes_telegram_brain_login'
     AND assigned.rolname='hermes_telegram_brain_reader'
     AND mm.inherit_option=false AND mm.set_option=true
 )
 OR pg_catalog.has_table_privilege('hermes_telegram_brain_login',
    'hermes_brain.memory_items','SELECT')
 OR pg_catalog.has_table_privilege('hermes_telegram_brain_login',
    'hermes_brain.memory_items','INSERT')
 THEN
  RAISE EXCEPTION 'brain_telegram_login_not_staged_safely';
 END IF;
END $check$;
COMMIT;
