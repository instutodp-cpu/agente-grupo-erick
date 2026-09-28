'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test');
const MIGRATION_PATH=path.resolve(__dirname,'../../../migrations/hermes/023_create_maintainer_github_write_finalization.sql');
const migration=fs.readFileSync(MIGRATION_PATH,'utf8');

test('finalization migration is transactional, namespaced, and structural only',()=>{
 assert.match(migration,/(?:^|\n)BEGIN;\s+/);
 assert.match(migration,/CREATE SCHEMA IF NOT EXISTS hermes;/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS hermes\.maintainer_github_write_finalization/);
 assert.match(migration,/COMMIT;\s*$/);
 assert.doesNotMatch(migration,/postgres(?:ql)?:\/\/|SERVICE_ROLE|password\s*=|secret\s*=|api\.github\.com/i);
});

test('schema enforces exact durable finalization identity and fixed provider scope',()=>{
 for(const column of ['finalization_key TEXT PRIMARY KEY','finalization_digest TEXT NOT NULL','outcome_digest TEXT NOT NULL','intent_digest TEXT NOT NULL','attempt_reference TEXT NOT NULL','admission_reference TEXT NOT NULL','repository TEXT NOT NULL','operation TEXT NOT NULL','ref TEXT NOT NULL','sha TEXT NOT NULL','provider_status INTEGER NOT NULL']) assert.ok(migration.includes(column));
 assert.ok(migration.includes("finalization_key = finalization_digest || '::write-finalization'"));
 assert.ok(migration.includes("finalization_digest ~ '^sha256:[a-f0-9]{64}$'"));
 assert.ok(migration.includes("outcome_digest ~ '^sha256:[a-f0-9]{64}$'"));
 assert.ok(migration.includes("intent_digest ~ '^sha256:[a-f0-9]{64}$'"));
 assert.ok(migration.includes("repository = 'instutodp-cpu/agente-grupo-erick'"));
 assert.ok(migration.includes("operation = 'create_branch'"));
 assert.ok(migration.includes("provider_status = 201"));
 assert.match(migration,/UNIQUE INDEX IF NOT EXISTS maintainer_github_write_finalization_digest_idx/);
});

test('schema remains finalization persistence only',()=>{
 assert.doesNotMatch(migration,/credential_material|authorization_header|access_token|refresh_token|force_push|delete_branch|merge_pull_request/i);
});
