'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  buildWorkerRegistration,
  computeCanonicalDigest,
  computeCanonicalFingerprint,
  sameCanonicalWorker,
  validateLifecycleTransition,
  validateWorkerRegistration
} = require('../src/core/runtime-worker-registry-contract');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/009_create_runtime_workers.sql');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

function input(overrides = {}) {
  return {
    worker_id: 'worker-authority-1',
    tenant_id: 'tenant-1',
    organization_id: 'organization-1',
    project_id: 'project-1',
    worker_type: 'DEDICATED_REFERENCE',
    lifecycle_state: 'ACTIVE',
    worker_capability_reference_id: 'capability-1',
    worker_compatibility_reference_ids: ['compatibility-1'],
    supported_stage_types: ['MODEL'],
    supported_modalities: ['TEXT'],
    supported_model_provider_ids: ['prov1'],
    supported_model_ids: ['mdl1'],
    supported_tool_ids: [],
    supported_workflow_ids: [],
    ...overrides
  };
}

test('P13A contract defines durable worker identity without simulation or execution authority', () => {
  const worker = buildWorkerRegistration(input());
  assert.equal(CONTRACT_NAME, 'RUNTIME_WORKER_REGISTRY_AUTHORITY');
  assert.equal(CONTRACT_VERSION, 'runtime_worker_registry_authority_contract_v1');
  assert.equal(worker.lifecycle_state, 'ACTIVE');
  assert.equal(validateWorkerRegistration(worker).valid, true);
  assert.equal('simulation' in worker, false);
  assert.equal('worker_selected' in worker, false);
  assert.equal('claim_id' in worker, false);
  assert.equal('lease_id' in worker, false);
});

test('canonical worker identity is deterministic and excludes lifecycle state', () => {
  const active = buildWorkerRegistration(input({ lifecycle_state: 'ACTIVE' }));
  const disabled = buildWorkerRegistration(input({ lifecycle_state: 'DISABLED' }));
  assert.equal(computeCanonicalFingerprint(active), computeCanonicalFingerprint(disabled));
  assert.equal(computeCanonicalDigest(active), computeCanonicalDigest(disabled));
  assert.equal(sameCanonicalWorker(active, disabled), true);
  assert.equal(validateWorkerRegistration({ ...active, canonical_digest: 'sha256:' + '0'.repeat(64) }).valid, false);
});

test('authority-relevant identity changes are not identical', () => {
  const worker = buildWorkerRegistration(input());
  const changed = buildWorkerRegistration(input({ worker_type: 'REMOTE_REFERENCE' }));
  assert.notEqual(worker.canonical_digest, changed.canonical_digest);
  assert.equal(sameCanonicalWorker(worker, changed), false);
});

test('field ordering noise is canonicalized while unsupported fields are rejected', () => {
  const worker = buildWorkerRegistration(input({
    worker_compatibility_reference_ids: ['compatibility-2', 'compatibility-1']
  }));
  const reordered = buildWorkerRegistration(input({ worker_compatibility_reference_ids: ['compatibility-1', 'compatibility-2'] }));
  assert.equal(worker.canonical_digest, reordered.canonical_digest);
  assert.equal(validateWorkerRegistration({ ...worker, arbitrary_caller_field: true }).valid, false);
});

test('lifecycle has only explicit ACTIVE/DISABLED transitions', () => {
  assert.equal(validateLifecycleTransition('ACTIVE', 'DISABLED'), true);
  assert.equal(validateLifecycleTransition('DISABLED', 'ACTIVE'), true);
  assert.equal(validateLifecycleTransition('ACTIVE', 'RETIRED'), false);
  assert.equal(validateLifecycleTransition('ACTIVE', 'ACTIVE'), false);
});

test('P13A migration is isolated, transactional and contains no downstream authority', () => {
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.runtime_workers/);
  assert.match(migration, /PRIMARY KEY/);
  assert.match(migration, /validator_version TEXT NOT NULL/);
  assert.match(migration, /runtime_workers_validator_version_check/);
  assert.match(migration, /runtime_workers_scope_lifecycle_idx/);
  assert.match(migration, /runtime_workers_canonical_digest_idx/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.doesNotMatch(migration, /worker_selection|claim_worker|lease_id|fencing_token|execution_authorized|capacity_reserved|queue_mutated/i);
  assert.doesNotMatch(migration, /DROP TABLE|DROP SCHEMA|DELETE FROM|TRUNCATE/i);
});
