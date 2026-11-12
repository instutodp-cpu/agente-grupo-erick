-- Synthetic PostgreSQL fixture for disabled login / explicit role switch.
\set ON_ERROR_STOP on
SET ROLE hermes_telegram_brain_login;
DO $verify$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM count(*) FROM hermes_brain.memory_items;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN
  RAISE EXCEPTION 'LOGIN_IDENTITY_INHERITED_PRIVATE_MEMORY_PERMISSIONS';
 END IF;
END $verify$;
BEGIN READ ONLY;
SET LOCAL ROLE hermes_telegram_brain_reader;
DO $verify$
BEGIN
 IF current_user<>'hermes_telegram_brain_reader'
 OR (SELECT count(*) FROM hermes_brain.memory_items)<>4 THEN
  RAISE EXCEPTION 'EXPLICIT_READER_SWITCH_OR_SCOPE_FAILED';
 END IF;
END $verify$;
COMMIT;
RESET ROLE;
SELECT 'BRAIN_DISABLED_LOGIN_EXPLICIT_ROLE_SWITCH_OK' AS result;
