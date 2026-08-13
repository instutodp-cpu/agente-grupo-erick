'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/001_create_authorization_lifecycle.sql');
const DOCUMENTATION_PATH = path.resolve(__dirname, '../../../docs/HERMES_VPS_POSTGRES_DURABLE_PERSISTENCE_INFRASTRUCTURE_V1.md');

const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const documentation = fs.readFileSync(DOCUMENTATION_PATH, 'utf8');

function count(pattern) {
  return (migration.match(pattern) || []).length;
}

test('PR-B migration is versioned, transactional, and namespaced', () => {
  assert.match(MIGRATION_PATH, /platform[\\/]migrations[\\/]hermes[\\/]001_create_authorization_lifecycle\.sql$/);
  assert.match(migration, /(?:^|\n)BEGIN;\s+/);
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS hermes;/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.authorization_lifecycle/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.equal(count(/CREATE TABLE\b/gi), 1);
});

test('PR-B migration contains the PR #133 lifecycle columns and constraints', () => {
  for (const column of [
    'authorization_id TEXT PRIMARY KEY',
    'authorization_payload JSONB NOT NULL',
    'authorization_hash TEXT NOT NULL',
    'provisioning_plan_version TEXT NOT NULL',
    'provisioning_plan_hash TEXT NOT NULL',
    'execution_scope JSONB NOT NULL',
    'state TEXT NOT NULL',
    'sequence BIGINT NOT NULL DEFAULT 0',
    'revision BIGINT NOT NULL DEFAULT 0',
    'consumption_reference JSONB',
    'revocation_reference JSONB',
    'fingerprint TEXT NOT NULL',
    'receipt_reference TEXT',
    'receipt_hash TEXT',
    'created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP'
  ]) assert.match(migration, new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const constraint of [
    'authorization_lifecycle_payload_identity_check',
    'authorization_lifecycle_payload_hash_check',
    'authorization_lifecycle_state_check',
    'authorization_lifecycle_transition_reference_check',
    'authorization_lifecycle_receipt_pair_check'
  ]) assert.match(migration, new RegExp(`CONSTRAINT\\s+${constraint}`));
});

test('PR-B migration defines deterministic lookup indexes and no unapproved ownership dimensions', () => {
  assert.match(migration, /authorization_lifecycle_state_idx/);
  assert.match(migration, /authorization_lifecycle_fingerprint_idx/);
  assert.doesNotMatch(migration, /tenant_id|workspace_id|company_id|mission_id|run_id/);
  assert.doesNotMatch(migration, /coordination|lease|fencing|executor|provider|ssh|worker/i);
});

test('PR-B remains infrastructure-only and contains no credentials or runtime wiring', () => {
  assert.match(documentation, /PRODUCTION_ADAPTER_IMPLEMENTED: NO/);
  assert.match(documentation, /PRODUCTION_CUTOVER_PERFORMED: NO/);
  assert.match(documentation, /PRODUCTION_WRITES_PERFORMED: NO/);
  assert.match(documentation, /RLS_IMPLEMENTED: NO/);
  assert.doesNotMatch(migration, /postgres(?:ql)?:\/\/|SERVICE_ROLE|password\s*=|secret\s*=/i);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*(coordination|lease|attempt|admission)/is);
});
