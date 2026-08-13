'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const {
  CONTRACT_VERSION,
  PERSISTENCE_INTERFACE_VERSION,
  REFERENCE_ADAPTER_CLAIM,
  buildHermesVpsCoordinationRequest,
  createDeterministicHermesVpsSharedDurableCoordinationTestStore,
  createHermesVpsSharedDurableCoordinationPersistenceInterface,
  coordinateHermesVpsExecutionState,
  validateCoordinationRequest
} = require('../src/core/hermes-vps-shared-durable-coordination-boundary');

const digest = (value) => computeCanonicalContentDigest(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

function baseInput() {
  return {
    authorization: {
      authorization_id: 'authorization-1',
      authorization_hash: digest({ authorization_id: 'authorization-1', version: 1 }),
      scope_key: digest({ tenant_id: 'tenant-a', company_id: 'company-a', scope: 'staging-host-1' }),
      plan_version: 'hermes-vps-provisioning-plan-v1',
      plan_hash: digest({ plan: 'staging-host-1', version: 1 })
    },
    lifecycle: {
      authorization_id: 'authorization-1',
      reference_id: 'consume::authorization-1::1',
      state: 'CONSUMED',
      fingerprint: digest({ lifecycle: 'consume::authorization-1::1' })
    },
    attempt: {
      attempt_id: 'attempt-1',
      attempt_fingerprint: digest({ attempt: 'attempt-1' }),
      authorization_id: 'authorization-1',
      lifecycle_reference_id: 'consume::authorization-1::1',
      state: 'CLAIMED',
      owner_reference: { executor_id: 'owner-1', executor_type: 'test-owner' }
    },
    admission: {
      admission_id: 'admission-1',
      admission_fingerprint: digest({ admission: 'admission-1' }),
      handoff_fingerprint: digest({ handoff: 'handoff-1' }),
      authorization_id: 'authorization-1',
      lifecycle_reference_id: 'consume::authorization-1::1',
      attempt_id: 'attempt-1',
      owner_reference: { executor_id: 'owner-1', executor_type: 'test-owner' },
      state: 'ADMITTED'
    },
    correlation_id: 'correlation-1'
  };
}

function request(overrides = {}) {
  const input = baseInput();
  for (const name of ['authorization', 'lifecycle', 'attempt', 'admission']) {
    if (overrides[name]) input[name] = { ...input[name], ...overrides[name] };
  }
  if (overrides.correlation_id) input.correlation_id = overrides.correlation_id;
  if (overrides.expected_versions) input.expected_versions = { ...overrides.expected_versions };
  return buildHermesVpsCoordinationRequest(input);
}

function store(options) {
  return createDeterministicHermesVpsSharedDurableCoordinationTestStore(options);
}

test('builds a valid canonical coordination request', () => {
  const value = request();
  assert.equal(validateCoordinationRequest(value).valid, true);
  assert.equal(value.contract_version, CONTRACT_VERSION);
  assert.equal(value.execution_allowed, false);
  assert.equal(value.production_effect, 'ZERO');
});

test('commits one canonical coordination record', () => {
  const value = request();
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'FIRST_COMMITTED');
  assert.equal(result.state, 'CONSISTENT');
  assert.equal(result.record.authorization.authorization_id, value.authorization.authorization_id);
  assert.equal(result.record.attempt.attempt_id, value.attempt.attempt_id);
  assert.equal(result.record.admission.admission_id, value.admission.admission_id);
  assert.equal(result.record.audit_reference, value.audit_reference);
});

test('exact retry returns the same result without a second entitlement', () => {
  const value = request();
  const persistence = store();
  const first = coordinateHermesVpsExecutionState({ request: value, persistence });
  const replay = coordinateHermesVpsExecutionState({ request: value, persistence });
  assert.equal(first.status, 'FIRST_COMMITTED');
  assert.equal(replay.status, 'SAME_RESULT_REPLAY');
  assert.deepEqual(replay.record, first.record);
});

test('different attempts for one authorization and scope cannot both become active', () => {
  const persistence = store();
  const first = coordinateHermesVpsExecutionState({ request: request(), persistence });
  const second = coordinateHermesVpsExecutionState({
    request: request({
      attempt: { attempt_id: 'attempt-2', attempt_fingerprint: digest({ attempt: 'attempt-2' }) },
      admission: { attempt_id: 'attempt-2', admission_id: 'admission-2', admission_fingerprint: digest({ admission: 'admission-2' }), handoff_fingerprint: digest({ handoff: 'handoff-2' }) }
    }),
    persistence
  });
  assert.equal(first.status, 'FIRST_COMMITTED');
  assert.equal(second.status, 'CONFLICT');
});

test('competing synchronous claims have exactly one first commit', async () => {
  const persistence = store();
  const requests = [request(), request({
    attempt: { attempt_id: 'attempt-2', attempt_fingerprint: digest({ attempt: 'attempt-2' }) },
    admission: { attempt_id: 'attempt-2', admission_id: 'admission-2', admission_fingerprint: digest({ admission: 'admission-2' }), handoff_fingerprint: digest({ handoff: 'handoff-2' }) }
  })];
  const results = await Promise.all(requests.map((value) => Promise.resolve(coordinateHermesVpsExecutionState({ request: value, persistence }))));
  assert.equal(results.filter((value) => value.status === 'FIRST_COMMITTED').length, 1);
  assert.equal(results.filter((value) => value.status === 'CONFLICT').length, 1);
});

test('partial persistence never becomes executable and requires reconciliation', () => {
  const value = request();
  const persistence = store();
  persistence.configureFailure('PARTIAL_WRITE');
  const failed = coordinateHermesVpsExecutionState({ request: value, persistence });
  persistence.configureFailure(null);
  const retry = coordinateHermesVpsExecutionState({ request: value, persistence });
  assert.equal(failed.status, 'PERSISTENCE_FAILURE');
  assert.equal(failed.state, 'PARTIALLY_PERSISTED');
  assert.equal(failed.execution_allowed, false);
  assert.equal(retry.status, 'RECONCILIATION_REQUIRED');
  assert.equal(retry.execution_allowed, false);
});

test('commit followed by lost acknowledgement resolves as exact replay after restart', () => {
  const value = request();
  const firstStore = store();
  firstStore.configureFailure('UNKNOWN_AFTER_COMMIT');
  const unknown = coordinateHermesVpsExecutionState({ request: value, persistence: firstStore });
  const restartedStore = store({ snapshot: firstStore.exportSnapshot() });
  const replay = coordinateHermesVpsExecutionState({ request: value, persistence: restartedStore });
  assert.equal(unknown.status, 'UNKNOWN_UNSAFE');
  assert.equal(replay.status, 'SAME_RESULT_REPLAY');
});

test('lost acknowledgement before persistence can retry once and then replay', () => {
  const value = request();
  const firstStore = store();
  firstStore.configureFailure('UNKNOWN_BEFORE_WRITE');
  const unknown = coordinateHermesVpsExecutionState({ request: value, persistence: firstStore });
  const restartedStore = store({ snapshot: firstStore.exportSnapshot() });
  const first = coordinateHermesVpsExecutionState({ request: value, persistence: restartedStore });
  const replay = coordinateHermesVpsExecutionState({ request: value, persistence: restartedStore });
  assert.equal(unknown.status, 'UNKNOWN_UNSAFE');
  assert.equal(first.status, 'FIRST_COMMITTED');
  assert.equal(replay.status, 'SAME_RESULT_REPLAY');
});

test('stale expected versions are rejected', () => {
  const result = coordinateHermesVpsExecutionState({ request: request({ expected_versions: { authorization: 1, lifecycle: 0, attempt: 0, admission: 0 } }), persistence: store() });
  assert.equal(result.status, 'STALE');
  assert.equal(result.execution_allowed, false);
});

test('owner mismatch is rejected', () => {
  const value = request({ admission: { owner_reference: { executor_id: 'owner-2', executor_type: 'test-owner' } } });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.status, 'INVALID');
  assert.match(result.reason, /admission_owner_mismatch/);
});

test('attempt mismatch is rejected', () => {
  const value = request({ admission: { attempt_id: 'attempt-2' } });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.status, 'INVALID');
  assert.match(result.reason, /admission_attempt_mismatch/);
});

test('authorization mismatch is rejected', () => {
  const value = request({ lifecycle: { authorization_id: 'authorization-2' } });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.status, 'INVALID');
  assert.match(result.reason, /lifecycle_authorization_mismatch/);
});

test('lifecycle disagreement fails closed', () => {
  const value = request({ lifecycle: { state: 'REGISTERED' } });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.status, 'INVALID');
  assert.match(result.reason, /lifecycle_not_consumed/);
});

test('admission disagreement fails closed', () => {
  const value = request({ admission: { state: 'REJECTED' } });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.status, 'INVALID');
  assert.match(result.reason, /admission_not_admitted/);
});

test('missing audit reference fails closed', () => {
  const value = clone(request());
  value.audit_reference = digest({ wrong: true });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.status, 'INVALID');
  assert.match(result.reason, /audit_reference_invalid/);
});

test('malformed persisted state requires reconciliation', () => {
  const value = request();
  const persistence = store({ snapshot: { records: [{ coordination_key: value.coordination_key, state: 'PARTIALLY_PERSISTED' }] } });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence });
  assert.equal(result.status, 'RECONCILIATION_REQUIRED');
  assert.equal(result.execution_allowed, false);
});

test('malformed consistent snapshot is rejected before coordination starts', () => {
  const value = request();
  assert.throws(() => store({ snapshot: { records: [{ coordination_key: value.coordination_key, state: 'CONSISTENT' }] } }), /coordination_snapshot_invalid/);
});

test('unknown persistence results fail closed', () => {
  const value = request();
  const persistence = createHermesVpsSharedDurableCoordinationPersistenceInterface({
    atomicCoordinate: () => ({ ok: true, status: 'FIRST_COMMITTED' })
  });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence });
  assert.equal(result.status, 'UNKNOWN_UNSAFE');
  assert.equal(result.execution_allowed, false);
});

test('persistence exceptions fail closed', () => {
  const value = request();
  const persistence = createHermesVpsSharedDurableCoordinationPersistenceInterface({
    atomicCoordinate: () => { throw new Error('unavailable'); }
  });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence });
  assert.equal(result.status, 'UNKNOWN_UNSAFE');
  assert.equal(result.execution_allowed, false);
});

test('contradictory success results fail closed', () => {
  const value = request();
  const persistence = createHermesVpsSharedDurableCoordinationPersistenceInterface({
    atomicCoordinate: () => ({
      ok: true,
      status: 'FIRST_COMMITTED',
      state: 'CONSISTENT',
      coordination_key: value.coordination_key,
      record: { coordination_fingerprint: digest({ other: true }), execution_allowed: true, production_effect: 'ZERO' },
      execution_allowed: false,
      production_effect: 'ZERO'
    })
  });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence });
  assert.equal(result.status, 'UNKNOWN_UNSAFE');
  assert.equal(result.execution_allowed, false);
});

test('canonical identities remain unchanged in the persisted record', () => {
  const value = request();
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.record.authorization.authorization_id, 'authorization-1');
  assert.equal(result.record.lifecycle.reference_id, 'consume::authorization-1::1');
  assert.equal(result.record.attempt.attempt_id, 'attempt-1');
  assert.equal(result.record.admission.admission_id, 'admission-1');
  assert.equal(result.record.correlation_id, 'correlation-1');
});

test('the trusted admission evidence remains a prerequisite', () => {
  const value = request({ admission: { state: 'NOT_ADMITTED' } });
  const result = coordinateHermesVpsExecutionState({ request: value, persistence: store() });
  assert.equal(result.ok, false);
  assert.equal(result.execution_allowed, false);
});

test('the reference adapter is explicitly test-only and has no execution grant', () => {
  const persistence = store();
  const result = coordinateHermesVpsExecutionState({ request: request(), persistence });
  assert.equal(persistence.durability_claim, REFERENCE_ADAPTER_CLAIM);
  assert.equal(persistence.interface_version, PERSISTENCE_INTERFACE_VERSION);
  assert.equal(result.execution_allowed, false);
  assert.equal(result.production_effect, 'ZERO');
});

test('equivalent requests are deterministic and changed security material changes identity', () => {
  const first = request();
  const second = request();
  const changed = request({ admission: { handoff_fingerprint: digest({ handoff: 'changed' }) } });
  assert.equal(first.coordination_fingerprint, second.coordination_fingerprint);
  assert.notEqual(first.replay_key, changed.replay_key);
  assert.notEqual(first.coordination_fingerprint, changed.coordination_fingerprint);
});

test('all coordination results remain non-executing', () => {
  const result = coordinateHermesVpsExecutionState({ request: request(), persistence: store() });
  assert.equal(result.execution_allowed, false);
  assert.equal(result.production_effect, 'ZERO');
  assert.equal(result.record.execution_allowed, false);
  assert.equal(result.record.production_effect, 'ZERO');
});
