'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const migration=fs.readFileSync(path.resolve(__dirname,
 '../../../migrations/hermes/034_create_maintainer_a3_source_authorization_claims.sql'),'utf8');

test('A3 source-claim schema is one transactional, staging-only global uniqueness boundary',()=>{
 assert.match(migration,/\bBEGIN;[\s\S]*\bCOMMIT;\s*$/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS hermes\.maintainer_a3_source_authorization_claims/);
 assert.match(migration,/single_use_authorization_id TEXT PRIMARY KEY/);
 assert.match(migration,/CONSTRAINT maintainer_a3_source_staging_only[\s\S]*?environment = 'staging'/);
 assert.match(migration,/CONSTRAINT maintainer_a3_source_repository_scope[\s\S]*?instutodp-cpu\/agente-grupo-erick/);
 assert.match(migration,/CONSTRAINT maintainer_a3_source_operation_scope[\s\S]*?update_file'[\s\S]*?create_pull_request'/);
 for(const name of ['approval_reference','source_record_digest','simulation_receipt_digest'])
  assert.match(migration,new RegExp('CREATE UNIQUE INDEX IF NOT EXISTS maintainer_a3_source_[^\\n]*_uidx\\s+ON hermes\\.maintainer_a3_source_authorization_claims \\('+name+'\\)'));
});

test('A3 source-claim ledger binds official mission, human approval and signed simulation digests without execution',()=>{
 for(const field of ['workspace_id','mission_id','mission_run_id','approval_reference','authorization_reference',
  'target_digest','intent_digest','simulation_receipt_digest','staging_gate_fingerprint','source_record_digest'])
  assert.match(migration,new RegExp('\\b'+field+' TEXT NOT NULL\\b'));
 for(const name of ['target_digest','intent_digest','simulation_receipt_digest','staging_gate_fingerprint','source_record_digest'])
  assert.match(migration,new RegExp('CONSTRAINT maintainer_a3_source_'+name+'_valid'));
 assert.doesNotMatch(migration,/\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b|\bDO\s+\$\$\b/i);
 assert.doesNotMatch(migration,/\bexecution_authorized\b|\bwrite_performed\b|\bprovider_called\b|\bproduction_allowed\b|\bsecret\s*=|\btoken\s*=|api\.github\.com|postgres(?:ql)?:\/\//i);
 assert.doesNotMatch(migration,/CREATE TABLE IF NOT EXISTS hermes\.maintainer_scm_write_consumption/);
});
