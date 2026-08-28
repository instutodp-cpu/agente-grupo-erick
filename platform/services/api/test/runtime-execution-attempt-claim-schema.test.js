'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/006_create_execution_attempt_claims.sql');
const P7_MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/004_create_execution_attempts.sql');
const P9A_MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/005_enable_execution_attempt_admission_lifecycle.sql');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const p7Migration = fs.readFileSync(P7_MIGRATION_PATH, 'utf8');
const p9aMigration = fs.readFileSync(P9A_MIGRATION_PATH, 'utf8');

function count(pattern) {
  return (migration.match(pattern) || []).length;
}

test('P12A migration is versioned, transactional, namespaced and creates one isolated table', () => {
  assert.match(MIGRATION_PATH, /platform[\\/]migrations[\\/]hermes[\\/]006_create_execution_attempt_claims\.sql$/);
  assert.match(migration, /(?:^|\n)BEGIN;\s+/);
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS hermes;/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.execution_attempt_claims/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.equal(count(/CREATE TABLE\b/gi), 1);
  assert.doesNotMatch(migration, /DROP TABLE|DROP SCHEMA|ALTER TABLE/i);
});

test('P12A stores the canonical attempt, P10, P11, identity and immutable proof fields', () => {
  for (const column of [
    'claim_id TEXT PRIMARY KEY',
    'claim_ordinal BIGINT NOT NULL',
    'attempt_durable_record_id TEXT NOT NULL',
    'attempt_state TEXT NOT NULL',
    'attempt_revision BIGINT NOT NULL',
    'tenant_id TEXT NOT NULL',
    'organization_id TEXT NOT NULL',
    'project_id TEXT NOT NULL',
    'session_reference_id TEXT NOT NULL',
    'agent_id TEXT NOT NULL',
    'actor_id TEXT NOT NULL',
    'attempt_ordinal BIGINT NOT NULL',
    'claim_intent_reference_id TEXT NOT NULL',
    'claim_intent_reference_version INTEGER NOT NULL',
    'claim_intent_reference_fingerprint TEXT NOT NULL',
    'claim_intent_reference_digest TEXT NOT NULL',
    'claim_eligibility_decision_reference_id TEXT NOT NULL',
    'claim_eligibility_decision_reference_version INTEGER NOT NULL',
    'claim_eligibility_decision_reference_fingerprint TEXT NOT NULL',
    'claim_eligibility_decision_reference_digest TEXT NOT NULL',
    'claim_state TEXT NOT NULL',
    'claim_fingerprint TEXT NOT NULL',
    'claim_digest TEXT NOT NULL',
    'claim_artifact JSONB NOT NULL',
    'claim_receipt JSONB NOT NULL',
    'created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP'
  ]) assert.match(migration, new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('P12A enforces canonical ADMITTED/2 predecessor and non-cascading attempt reference', () => {
  assert.match(migration, /execution_attempt_claims_attempt_reference_fk/);
  assert.match(migration, /REFERENCES hermes\.execution_attempts \(attempt_durable_record_id\)/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /attempt_state = 'ADMITTED' AND attempt_revision = 2/);
  assert.match(migration, /claim_eligibility_decision_status = 'EXECUTION_ATTEMPT_CLAIM_ELIGIBLE_SIMULATION'/);
  assert.match(migration, /claim_state = 'ACTIVE'/);
});

test('P12A provides deterministic identity uniqueness and active-claim concurrency protection', () => {
  assert.match(migration, /execution_attempt_claims_attempt_ordinal_key[\s\S]*UNIQUE \(attempt_durable_record_id, claim_ordinal\)/);
  assert.match(migration, /execution_attempt_claims_identity_key[\s\S]*UNIQUE \(attempt_durable_record_id, claim_fingerprint, claim_digest\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS execution_attempt_claims_active_attempt_key/);
  assert.match(migration, /WHERE claim_state = 'ACTIVE'/);
  assert.match(migration, /execution_attempt_claims_eligibility_reference_idx/);
});

test('P12A contains no worker, lease, fencing, executor, execution, capacity, quota or queue authority fields', () => {
  for (const forbiddenColumn of [
    'worker_id', 'worker_reference', 'worker_owner', 'executor_id', 'executor_reference',
    'lease_id', 'lease_expires', 'fencing_token', 'execution_authorized', 'execution_started',
    'execution_performed', 'capacity_reserved', 'quota_mutated', 'queue_mutated'
  ]) assert.doesNotMatch(migration, new RegExp(`\\b${forbiddenColumn}\\b`, 'i'), forbiddenColumn);
});

test('P12A leaves the P7/P9A execution_attempts schema and lifecycle model untouched', () => {
  assert.match(p7Migration, /CREATE TABLE IF NOT EXISTS hermes\.execution_attempts/);
  assert.match(p7Migration, /state = 'PREPARED'/);
  assert.match(p7Migration, /revision = 1/);
  assert.match(p9aMigration, /state = 'PREPARED' AND revision = 1/);
  assert.match(p9aMigration, /state = 'ADMITTED' AND revision = 2/);
  assert.doesNotMatch(migration, /ALTER TABLE hermes\.execution_attempts/i);
  assert.doesNotMatch(migration, /state = 'CLAIMED'|revision = 3/i);
});

test('P12A schema has no runtime adapter, claim issuance operation or credentials', () => {
  assert.doesNotMatch(migration, /INSERT INTO|UPDATE\s+hermes|SELECT\s+.*FOR UPDATE|CREATE FUNCTION|CREATE TRIGGER/i);
  assert.doesNotMatch(migration, /postgres(?:ql)?:\/\/|DATABASE_URL|SERVICE_ROLE|password\s*=|secret\s*=/i);
  assert.doesNotMatch(migration, /worker_selected|worker_bound|ownership_established|lease_granted|fencing_token_issued/i);
});
