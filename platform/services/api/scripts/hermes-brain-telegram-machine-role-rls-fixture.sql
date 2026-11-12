-- Ephemeral sandbox ONLY; role cannot connect until independently activated.
\set ON_ERROR_STOP on
SET ROLE hermes_telegram_brain_reader;
DO $verify$
DECLARE n int; denied boolean:=false;
BEGIN
 SELECT count(*) INTO n FROM hermes_brain.memory_items;
 IF n<>4 THEN RAISE EXCEPTION 'BRAIN_MACHINE_SCOPE_INCORRECT %',n; END IF;
 IF (SELECT count(*) FROM hermes_brain.memory_items WHERE tenant_id<>'grupo_erick')<>0
 THEN RAISE EXCEPTION 'BRAIN_MACHINE_CROSS_TENANT_VISIBLE'; END IF;
 IF (SELECT count(*) FROM hermes_brain.automemory_admissions)<>4
 THEN RAISE EXCEPTION 'BRAIN_MACHINE_ATTESTATION_SCOPE_INCORRECT'; END IF;
 BEGIN
  PERFORM created_at FROM hermes_brain.memory_items LIMIT 1;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'BRAIN_MACHINE_UNGRANTED_COLUMN_LEAK'; END IF;
 denied:=false;
 BEGIN
  UPDATE hermes_brain.memory_items SET status='revoked' WHERE tenant_id='grupo_erick';
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'BRAIN_MACHINE_UPDATE_ALLOWED'; END IF;
END $verify$;
RESET ROLE;
UPDATE hermes_brain.sources SET status='revoked'
 WHERE tenant_id='grupo_erick' AND source_id='90000000-0000-4000-8000-000000000001';
SET ROLE hermes_telegram_brain_reader;
DO $verify$
BEGIN
 IF (SELECT count(*) FROM hermes_brain.memory_items)<>0
 THEN RAISE EXCEPTION 'REVOKED_SOURCE_STILL_VISIBLE'; END IF;
END $verify$;
RESET ROLE;
SELECT 'BRAIN_MACHINE_ROLE_SCOPED_AND_REVOCATION_OK' AS result;
