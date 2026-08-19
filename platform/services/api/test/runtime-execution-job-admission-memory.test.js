'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildGoldenDispatchBundle } = require('./helpers/runtime-dispatch-simulation-test-data');
const { evaluateRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-boundary');
const { evaluateRuntimeExecutionJobIntent } = require('../src/core/runtime-execution-job-intent');
const {
  computeRuntimeExecutionJobMaterializationDigest,
  computeRuntimeExecutionJobMaterializationFingerprint,
  buildRuntimeExecutionJobMaterialization
} = require('../src/core/runtime-execution-job-materialization');
const { cloneFrozen, stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { createRuntimeExecutionJobAdmissionMemory } = require('../src/core/runtime-execution-job-admission-memory');

const golden = buildGoldenDispatchBundle();
const dispatchPackage = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {}).package;
const BASE_INTENT = evaluateRuntimeExecutionJobIntent(dispatchPackage).intent;
const BASE_MATERIALIZATION = buildRuntimeExecutionJobMaterialization(BASE_INTENT);
const MATERIALIZATION_CACHE = new Map();

function materialize() {
  return BASE_MATERIALIZATION;
}

function changedScope(field, value) {
  const cacheKey = `${field}:${value}`;
  if (MATERIALIZATION_CACHE.has(cacheKey)) return MATERIALIZATION_CACHE.get(cacheKey);
  const materialization = JSON.parse(JSON.stringify(BASE_MATERIALIZATION));
  materialization.identity_scope[field] = value;
  const jobIdentity = {
    contract_name: materialization.contract_name,
    contract_version: materialization.contract_version,
    runtime_execution_job_intent_reference: materialization.runtime_execution_job_intent_reference,
    dispatch_package_reference: materialization.dispatch_package_reference,
    identity_scope: materialization.identity_scope,
    idempotency_fingerprint: materialization.idempotency_reference.fingerprint,
    dispatch_provenance_digest: materialization.provenance_reference.dispatch_provenance_digest
  };
  const jobFingerprint = stablePayload(jobIdentity);
  const jobDigest = computeCanonicalContentDigest(jobIdentity);
  materialization.job_reference = {
    id: `runtime-execution-job-${jobDigest.slice('sha256:'.length)}`,
    version: 1,
    fingerprint: jobFingerprint,
    digest: jobDigest
  };
  materialization.runtime_execution_job_materialization_fingerprint = computeRuntimeExecutionJobMaterializationFingerprint(materialization);
  materialization.runtime_execution_job_materialization_digest = computeRuntimeExecutionJobMaterializationDigest(materialization);
  const result = cloneFrozen(materialization);
  MATERIALIZATION_CACHE.set(cacheKey, result);
  return result;
}

function changedMaterializationReference(value) {
  const materialization = JSON.parse(JSON.stringify(BASE_MATERIALIZATION));
  materialization.runtime_execution_job_materialization_id = `runtime-execution-job-materialization-${value}`;
  materialization.runtime_execution_job_materialization_fingerprint = computeRuntimeExecutionJobMaterializationFingerprint(materialization);
  materialization.runtime_execution_job_materialization_digest = computeRuntimeExecutionJobMaterializationDigest(materialization);
  return cloneFrozen(materialization);
}

function tampered(value, changes) {
  return { ...value, ...changes };
}

test('first valid P2 materialization is CREATED and exposes only the P3A record', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const result = adapter.admit(materialize());
  const record = adapter.inspect(result.logical_job_identity.digest);
  assert.equal(result.outcome, 'CREATED');
  assert.equal(result.revision, 1);
  assert.equal(record.state, 'ADMITTED');
  assert.equal(record.durable_job_persisted, false);
  assert.equal(adapter.size(), 1);
  assert.equal(adapter.reference_adapter_only, true);
  assert.equal(adapter.real_db_durability, false);
  assert.equal(adapter.migration_applied, false);
  assert.equal(adapter.database_atomicity_proven, false);
});

test('identical replay returns EXISTING_IDENTICAL, same references and unchanged revision', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const first = adapter.admit(materialize());
  const replay = adapter.admit(materialize());
  assert.equal(first.outcome, 'CREATED');
  assert.equal(replay.outcome, 'EXISTING_IDENTICAL');
  assert.equal(replay.job_reference.id, first.job_reference.id);
  assert.equal(replay.job_digest, first.job_digest);
  assert.equal(replay.revision, 1);
  assert.equal(adapter.inspect(replay.logical_job_identity.digest).revision, 1);
  assert.equal(adapter.size(), 1);
});

test('divergent canonical semantics with the same idempotency identity is CONFLICT and never overwrites', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const first = adapter.admit(materialize());
  const divergent = adapter.admit(changedMaterializationReference('p3a-divergent'));
  assert.equal(first.outcome, 'CREATED');
  assert.equal(divergent.outcome, 'CONFLICT');
  assert.equal(divergent.reason_code, 'canonical_semantics_conflict');
  assert.equal(divergent.job_reference.id, first.job_reference.id);
  assert.equal(adapter.size(), 1);
});

for (const [field, value] of [
  ['tenant_id', 'tenant-p3a-other'],
  ['organization_id', 'organization-p3a-other'],
  ['project_id', 'project-p3a-other'],
  ['agent_id', 'agent-p3a-other'],
  ['session_reference_id', 'session-p3a-other'],
  ['actor_id', 'actor-p3a-other']
]) {
  test(`scope mismatch ${field} is rejected as a fail-closed conflict`, () => {
    const adapter = createRuntimeExecutionJobAdmissionMemory();
    const first = adapter.admit(materialize());
    const conflict = adapter.admit(changedScope(field, value));
    assert.equal(first.outcome, 'CREATED');
    assert.equal(conflict.outcome, 'CONFLICT');
    assert.equal(conflict.reason_code, 'identity_scope_conflict');
    assert.equal(adapter.size(), 1);
  });
}

test('invalid P2 contract, version and status are REJECTED before admission', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  for (const mutation of [
    { input_contract_name: 'UNKNOWN' },
    { input_contract_version: 'unknown' },
    { status: 'UNKNOWN' }
  ]) {
    assert.equal(adapter.admit(tampered(materialize(), mutation)).outcome, 'REJECTED');
  }
  assert.equal(adapter.size(), 0);
});

test('fingerprint, digest, job reference, provenance and idempotency mutations are REJECTED', () => {
  const base = materialize();
  const mutations = [
    { runtime_execution_job_materialization_fingerprint: 'tampered' },
    { runtime_execution_job_materialization_digest: `sha256:${'0'.repeat(64)}` },
    { job_reference: { ...base.job_reference, id: 'tampered-job' } },
    { provenance_reference: { ...base.provenance_reference, dispatch_provenance_digest: `sha256:${'0'.repeat(64)}` } },
    { idempotency_reference: { ...base.idempotency_reference, fingerprint: 'tampered-idempotency' } }
  ];
  for (const mutation of mutations) {
    const adapter = createRuntimeExecutionJobAdmissionMemory();
    assert.equal(adapter.admit(tampered(base, mutation)).outcome, 'REJECTED');
    assert.equal(adapter.size(), 0);
  }
});

test('unknown fields fail closed', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  assert.equal(adapter.admit({ ...materialize(), unknown_field: true }).outcome, 'REJECTED');
});

test('multiple identical calls have exactly one CREATED and one logical record', async () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const results = await Promise.all(Array.from({ length: 12 }, () => adapter.admit(materialize())));
  assert.equal(results.filter((result) => result.outcome === 'CREATED').length, 1);
  assert.equal(results.filter((result) => result.outcome === 'EXISTING_IDENTICAL').length, 11);
  assert.equal(adapter.size(), 1);
});

test('multiple divergent calls have one accepted identity and conflicts for the divergent semantics', async () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const results = await Promise.all([
    adapter.admit(materialize()),
    adapter.admit(changedScope('project_id', 'project-p3a-concurrent-divergent')),
    adapter.admit(changedScope('project_id', 'project-p3a-concurrent-divergent'))
  ]);
  assert.equal(results.filter((result) => result.outcome === 'CREATED').length, 1);
  assert.equal(results.filter((result) => result.outcome === 'CONFLICT').length, 2);
  assert.equal(adapter.size(), 1);
});

test('audit receipt is deterministic, scoped and sanitized', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const result = adapter.admit(materialize());
  const receipt = result.admission_receipt;
  const record = adapter.inspect(result.logical_job_identity.digest);
  assert.equal(receipt.event, 'EXECUTION_JOB_ADMISSION');
  assert.equal(receipt.outcome, 'ADMITTED');
  assert.equal(receipt.revision, 1);
  assert.equal(receipt.identity_scope.tenant_id, record.identity_scope.tenant_id);
  assert.equal(receipt.idempotency_fingerprint, record.idempotency_reference.fingerprint);
  assert.equal('payload' in receipt, false);
  assert.equal('secret' in receipt, false);
  assert.equal('credentials' in receipt, false);
  assert.equal('provider_request' in receipt, false);
});

test('P3A cannot create attempts, ownership, execution or effects', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const result = adapter.admit(materialize());
  const record = adapter.inspect(result.logical_job_identity.digest);
  assert.equal(record.attempt_created, false);
  assert.equal(record.execution_authorized, false);
  assert.equal(record.execution_performed, false);
  assert.equal(record.external_effect_allowed, false);
  assert.equal(record.provider_call_allowed, false);
  assert.equal(record.network_call_allowed, false);
  assert.equal(record.secrets_materialized, false);
  assert.equal(record.production_blocked, true);
  assert.equal('attempt_id' in record, false);
  assert.equal('lease' in record, false);
  assert.equal('worker' in record, false);
  assert.equal('executor' in record, false);
});

test('returned record and result are mutation-safe', () => {
  const adapter = createRuntimeExecutionJobAdmissionMemory();
  const result = adapter.admit(materialize());
  assert.equal(Object.isFrozen(result), true);
  const record = adapter.inspect(result.logical_job_identity.digest);
  assert.equal(Object.isFrozen(record), true);
  assert.throws(() => { record.state = 'RUNNING'; }, TypeError);
  assert.equal(adapter.inspect(result.logical_job_identity.digest).state, 'ADMITTED');
});

test('memory adapter source contains no forbidden backend, effect or async boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'runtime-execution-job-admission-memory.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:fs|http|https|net|tls|pg|child_process|worker_threads)['"]\)/);
  assert.doesNotMatch(source, /\b(?:fetch|axios|writeFile|createWriteStream|createConnection|spawn|execFile)\s*\(/);
  assert.doesNotMatch(source, /\b(?:async|await|yield)\b/);
});
