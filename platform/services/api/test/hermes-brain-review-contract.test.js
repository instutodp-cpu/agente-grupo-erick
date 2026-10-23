'use strict';
// Review contract tests: no approval through a user token or browser.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const migration=fs.readFileSync(path.join(__dirname,'../../../migrations/hermes/042_create_second_brain_private_review.sql'),'utf8');
test('private review is privileged invoker only',()=>{
 assert.match(migration,/CREATE OR REPLACE FUNCTION hermes_brain\.review_proposal/);
 assert.match(migration,/current_user <> 'postgres'/);
 assert.match(migration,/SECURITY INVOKER/);
 assert.doesNotMatch(migration,/SECURITY DEFINER/i);
 assert.match(migration,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.doesNotMatch(migration,/GRANT EXECUTE ON FUNCTION hermes_brain\.review_proposal/i);
});
test('review requires explicit decision, human reference and exact payload',()=>{
 assert.match(migration,/p_decision NOT IN \('approve','reject'\)/);
 assert.match(migration,/p_approval_reference !~ '\^HUMAN-/);
 assert.match(migration,/v_actual_body_sha256 <> p_expected_body_sha256/);
 assert.match(migration,/FOR UPDATE/);
 assert.match(migration,/v_p\.status <> 'pending'/);
 assert.match(migration,/review_already_recorded/);
});
test('only owner-only internal scoped active memberships can promote',()=>{
 assert.match(migration,/t\.status='active'/);
 assert.match(migration,/m\.status='active'/);
 assert.match(migration,/v_p\.actor_user_id/);
 assert.match(migration,/v_p\.classification <> 'internal'/);
 assert.match(migration,/v_p\.company_id IS NOT NULL/);
 assert.match(migration,/v_p\.store_id IS NOT NULL/);
 assert.match(migration,/v_p\.source_type <> 'user_note'/);
 assert.match(migration,/owner_only/);
});
test('review stays auditable, reject does not create a memory, expiry is bounded',()=>{
 assert.match(migration,/CREATE TABLE hermes_brain\.review_events/);
 assert.match(migration,/PRIMARY KEY \(tenant_id, proposal_id\)/);
 assert.match(migration,/IF p_decision = 'approve' THEN/);
 assert.match(migration,/INTERVAL '30 days'/);
 assert.match(migration,/INSERT INTO hermes_brain\.review_events/);
 assert.match(migration,/THEN 'promoted' ELSE 'rejected'/);
 assert.match(migration,/status='approved'/);
});
