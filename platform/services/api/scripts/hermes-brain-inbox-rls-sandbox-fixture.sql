-- Synthetic auth role + member rows are supplied by previous RLS fixture.
\set ON_ERROR_STOP on
DO $assert$
BEGIN
 IF has_table_privilege('anon','hermes_brain.inbox_candidates','SELECT')
 OR has_table_privilege('anon','hermes_brain.inbox_candidates','INSERT')
 OR has_table_privilege('authenticated','hermes_brain.inbox_candidates','UPDATE')
 OR has_table_privilege('authenticated','hermes_brain.inbox_candidates','DELETE')
 THEN RAISE EXCEPTION 'INBOX_PRIVILEGE_FAILURE'; END IF;
END $assert$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
INSERT INTO hermes_brain.inbox_candidates
 (tenant_id,actor_user_id,source_type,source_ref,title,body,domain,classification)
 VALUES ('client::alpha','11111111-1111-4111-8111-111111111111',
 'user_note','note-001','Pendencia local','Lembrar de verificar projeto','projetos','internal');
DO $assert$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM hermes_brain.inbox_candidates;
 IF n<>1 THEN RAISE EXCEPTION 'INBOX_A_NOT_ONE_%',n; END IF;
 SELECT count(*) INTO n FROM hermes_brain.memory_items WHERE tenant_id='client::alpha';
 IF n<>1 THEN RAISE EXCEPTION 'INBOX_AUTO_APPROVED_MEMORY_%',n; END IF;
END $assert$;
-- Assertion: RLS must reject foreign client.
DO $reject$
BEGIN
 BEGIN
  INSERT INTO hermes_brain.inbox_candidates
  (tenant_id,actor_user_id,source_type,source_ref,title,body,domain,classification)
  VALUES('client::beta','11111111-1111-4111-8111-111111111111',
  'user_note','wrong-client','X','X','projetos','internal');
  RAISE EXCEPTION 'FOREIGN_TENANT_WAS_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO hermes_brain.inbox_candidates
  (tenant_id,actor_user_id,source_type,source_ref,title,body,domain,classification)
  VALUES('client::alpha','22222222-2222-4222-8222-222222222222',
  'user_note','wrong-owner','X','X','projetos','internal');
  RAISE EXCEPTION 'FORGED_OWNER_WAS_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO hermes_brain.inbox_candidates
  (tenant_id,actor_user_id,source_type,source_ref,title,body,domain,classification)
  VALUES('client::alpha','11111111-1111-4111-8111-111111111111',
  'user_note','forged-domain','X','X','segredos','internal');
  RAISE EXCEPTION 'UNAUTHORIZED_DOMAIN_WAS_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO hermes_brain.inbox_candidates
  (tenant_id,actor_user_id,source_type,source_ref,title,body,domain,classification,company_id)
  VALUES('client::alpha','11111111-1111-4111-8111-111111111111',
  'user_note','other-company','X','X','projetos','internal','companyZ');
  RAISE EXCEPTION 'UNAUTHORIZED_COMPANY_WAS_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO hermes_brain.inbox_candidates
  (tenant_id,actor_user_id,source_type,source_ref,title,body,domain,classification,status)
  VALUES('client::alpha','11111111-1111-4111-8111-111111111111',
  'user_note','autoapproved','X','X','projetos','internal','promoted');
  RAISE EXCEPTION 'AUTO_APPROVAL_WAS_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $reject$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $assert$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM hermes_brain.inbox_candidates;
 IF n<>0 THEN RAISE EXCEPTION 'CLIENT_B_READ_A_INBOX_%',n; END IF;
END $assert$;
RESET ROLE;
SELECT 'BRAIN_INBOX_MEMBER_WRITE_PENDING_CROSS_TENANT_REJECTION_OK' AS result;
