'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test');
const MIGRATION_PATH=path.resolve(__dirname,'../../../migrations/hermes/020_create_maintainer_scm_write_attempt_ownership.sql');
const migration=fs.readFileSync(MIGRATION_PATH,'utf8');

test('ownership migration is transactional, namespaced, and structural only',()=>{
 assert.match(migration,/(?:^|\n)BEGIN;\s+/);
 assert.match(migration,/CREATE SCHEMA IF NOT EXISTS hermes;/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS hermes\.maintainer_scm_write_attempt_ownership/);
 assert.match(migration,/COMMIT;\s*$/);
 assert.doesNotMatch(migration,/postgres(?:ql)?:\/\/|SERVICE_ROLE|password\s*=|secret\s*=|api\.github\.com/i);
});
test('schema enforces the exact ownership identity consumed by the Postgres primitive',()=>{
 for(const column of ['ownership_key TEXT PRIMARY KEY','persistence_key TEXT NOT NULL','intent_digest TEXT NOT NULL','attempt_reference TEXT NOT NULL']) assert.ok(migration.includes(column));
 assert.ok(migration.includes("ownership_key = persistence_key || '::attempt-ownership'"));
 assert.ok(migration.includes("intent_digest ~ '^sha256:[a-f0-9]{64}$'"));
 assert.match(migration,/UNIQUE INDEX IF NOT EXISTS maintainer_scm_write_attempt_ownership_persistence_key_idx/);
});
test('schema does not introduce execution, credential, or provider state',()=>{
 assert.doesNotMatch(migration,/execution_authorized|credential_material|authorization_header|network_call|write_performed|provider_status|branch_name|base_sha/i);
});
