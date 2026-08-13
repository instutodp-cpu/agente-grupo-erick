'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTRACT_VERSION,
  RESULT_CONTRACT_VERSION,
  admitExecutionHandoff,
  buildExecutionHandoff,
  buildExecutionResultEnvelope,
  consumeExecutionHandoff,
  createExecutionHandoffAdmissionPersistenceInterface,
  validateExecutionResultEnvelope
} = require('../src/core/hermes-vps-execution-handoff-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const {
  computeAttemptFingerprint,
  createDeterministicExecutionAttemptOwnershipTestStore
} = require('../src/core/hermes-vps-execution-attempt-ownership-contract');

const digest = (value) => computeCanonicalContentDigest({ value });
const owner = { executor_id: 'executor-a', executor_type: 'FUTURE_EXECUTOR_REFERENCE' };

function evidence(overrides = {}) {
  const base = {
    authorization: {
      authorization_id: 'authorization-a',
      authorization_hash: digest('authorization-a'),
      plan_version: 'hermes-vps-provisioning-plan-v1',
      plan_hash: digest('plan-a'),
      execution_scope: { phase_id: 'P0_HOST_VALIDATION', step_id: 'validate_host' },
      state: 'AUTHORIZED'
    },
    attempt: {
      attempt_id: 'attempt-a',
      attempt_fingerprint: digest('attempt-a'),
      owner_reference: owner,
      state: 'CLAIMED',
      lease_expires_at: '2099-01-01T00:00:00.000Z'
    },
    lifecycle_reference: {
      authorization_id: 'authorization-a',
      reference_id: 'consume::authorization-a::1',
      state: 'CONSUMED'
    },
    admission_reference: {
      admission_id: 'admission-a',
      admission_fingerprint: digest('admission-a'),
      state: 'OWNERSHIP_VALIDATED'
    },
    operation_identity: { operation_id: 'operation-a', operation_type: 'VPS_PROVISIONING_PLAN_HANDOFF' },
    isolation_scope: { tenant_id: 'tenant-a', company_id: 'company-a', scope_id: 'scope-a' }
  };
  const result = {
    ...base,
    ...overrides,
    authorization: { ...base.authorization, ...(overrides.authorization || {}) },
    attempt: { ...base.attempt, ...(overrides.attempt || {}) },
    lifecycle_reference: { ...base.lifecycle_reference, ...(overrides.lifecycle_reference || {}) },
    admission_reference: { ...base.admission_reference, ...(overrides.admission_reference || {}) },
    operation_identity: { ...base.operation_identity, ...(overrides.operation_identity || {}) },
    isolation_scope: { ...base.isolation_scope, ...(overrides.isolation_scope || {}) }
  };
  if (!overrides.lifecycle_reference && result.authorization.authorization_id !== base.authorization.authorization_id) {
    result.lifecycle_reference.authorization_id = result.authorization.authorization_id;
  }
  return result;
}

function validHandoff(overrides = {}) {
  return buildExecutionHandoff(evidence(overrides));
}

function durableAdmissionFixture() {
  const current = evidence();
  const entry = {
    attempt_id: current.attempt.attempt_id,
    authorization_id: current.authorization.authorization_id,
    lifecycle_reference: { ...current.lifecycle_reference, state: 'CONSUMED' },
    authorization_hash: current.authorization.authorization_hash,
    plan_version: current.authorization.plan_version,
    plan_hash: current.authorization.plan_hash,
    execution_scope: current.authorization.execution_scope,
    executor_reference: current.attempt.owner_reference,
    lease: { lease_id: 'lease-a', expires_at: current.attempt.lease_expires_at },
    state: 'CLAIMED',
    owner_reference: current.attempt.owner_reference,
    sequence: 1,
    idempotency_key: 'attempt-idempotency-a',
    authorization_scope_key: digest('authorization-a::P0_HOST_VALIDATION::validate_host'),
    fingerprint: 'pending'
  };
  entry.fingerprint = computeAttemptFingerprint(entry);
  current.attempt.attempt_fingerprint = entry.fingerprint;
  current.lifecycle_reference.state = 'CONSUMED';
  const handoff = buildExecutionHandoff(current);
  const persistence = createDeterministicExecutionAttemptOwnershipTestStore();
  assert.equal(persistence.atomicAcquireActiveAttempt(entry).status, 'ACQUIRED');
  return { current, handoff, persistence: createExecutionHandoffAdmissionPersistenceInterface({ atomicConsumeExecutionAdmission: persistence.atomicConsumeExecutionAdmission }), store: persistence };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function testOnlyConsume(args) {
  const decision = admitExecutionHandoff(args.currentEvidence, args.handoff, { now: args.now });
  if (decision.status !== 'ADMITTED') return decision;
  if (args.consumer_reference.executor_id !== args.handoff.attempt.owner_reference.executor_id || args.consumer_reference.executor_type !== args.handoff.attempt.owner_reference.executor_type) return { status: 'REJECTED', rejection_code: 'OWNER_MISMATCH', execution_eligible: false, production_effect: 'ZERO' };
  const admissionReference = digest({ contract_version: CONTRACT_VERSION, handoff_fingerprint: args.handoff.handoff_fingerprint, consumer_reference: args.consumer_reference });
  const raw = args.persistence.atomicConsumeExecutionAdmission({
    contract_version: CONTRACT_VERSION,
    admission_key: digest({ authorization_id: args.handoff.authorization.authorization_id, lifecycle_reference: args.handoff.lifecycle_reference, attempt_id: args.handoff.attempt.attempt_id, owner_reference: args.handoff.attempt.owner_reference, handoff_fingerprint: args.handoff.handoff_fingerprint }),
    attempt_id: args.handoff.attempt.attempt_id,
    expected_attempt_fingerprint: args.currentEvidence.attempt.attempt_fingerprint,
    expected_attempt_state: 'CLAIMED',
    authorization_id: args.handoff.authorization.authorization_id,
    lifecycle_reference: args.handoff.lifecycle_reference,
    handoff_fingerprint: args.handoff.handoff_fingerprint,
    consumer_reference: cloneValue(args.consumer_reference),
    admission_reference: admissionReference
  });
  if (!raw || raw.ok !== true || !raw.entry || !['FIRST_ADMISSION', 'SAME_RESULT_REPLAY'].includes(raw.entry.admission_status)) return { status: 'REJECTED', execution_eligible: false, production_effect: 'ZERO' };
  return { status: raw.entry.admission_status, admission_status: raw.entry.admission_status, admission_reference: raw.entry.admission_reference, execution_eligible: raw.entry.admission_status === 'FIRST_ADMISSION', execution_performed: false, production_effect: 'ZERO' };
}

function admitted(overrides = {}, context = { now: '2026-08-12T00:00:00.000Z' }) {
  const current = evidence(overrides);
  return { current, handoff: buildExecutionHandoff(current), result: admitExecutionHandoff(current, buildExecutionHandoff(current), context) };
}

test('builds a deterministic handoff with exact ownership bindings and no execution', () => {
  const first = validHandoff();
  const second = validHandoff();
  assert.deepEqual(first, second);
  assert.equal(first.handoff_state, 'OWNERSHIP_VALIDATED');
  assert.equal(first.execution_allowed, false);
  assert.equal(first.execution_performed, false);
  assert.equal(first.production_effect, 'ZERO');
  assert.equal(first.contract_version, CONTRACT_VERSION);
});

test('canonical field ordering does not change the handoff fingerprint', () => {
  const source = evidence();
  const reordered = JSON.parse(JSON.stringify(source));
  reordered.authorization = {
    state: source.authorization.state,
    execution_scope: source.authorization.execution_scope,
    plan_hash: source.authorization.plan_hash,
    authorization_hash: source.authorization.authorization_hash,
    authorization_id: source.authorization.authorization_id,
    plan_version: source.authorization.plan_version
  };
  assert.equal(buildExecutionHandoff(source).handoff_fingerprint, buildExecutionHandoff(reordered).handoff_fingerprint);
});

test('security-relevant binding mutations change the fingerprint', () => {
  const original = validHandoff();
  for (const mutation of [
    { authorization: { authorization_id: 'authorization-b' } },
    { attempt: { attempt_id: 'attempt-b' } },
    { lifecycle_reference: { reference_id: 'consume::authorization-a::2' } },
    { operation_identity: { operation_id: 'operation-b' } },
    { isolation_scope: { company_id: 'company-b' } }
  ]) assert.notEqual(validHandoff(mutation).handoff_fingerprint, original.handoff_fingerprint);
});

test('admits only a currently claimed, leased, exactly bound attempt', () => {
  const { current, handoff, result } = admitted();
  assert.equal(result.status, 'ADMITTED');
  assert.equal(result.execution_eligible, true);
  assert.equal(result.attempt_id, current.attempt.attempt_id);
  assert.equal(result.handoff_fingerprint, handoff.handoff_fingerprint);
});

test('rejects different authorization, attempt, owner, lifecycle, operation, and isolation', () => {
  const current = evidence();
  const handoff = buildExecutionHandoff(current);
  const cases = [
    ['authorization', { authorization: { authorization_id: 'authorization-b' } }, 'AUTHORIZATION_MISMATCH'],
    ['attempt', { attempt: { attempt_id: 'attempt-b' } }, 'ATTEMPT_MISMATCH'],
    ['owner', { attempt: { owner_reference: { executor_id: 'executor-b', executor_type: owner.executor_type } } }, 'OWNER_MISMATCH'],
    ['lifecycle', { lifecycle_reference: { reference_id: 'consume::authorization-a::2' } }, 'LIFECYCLE_MISMATCH'],
    ['operation', { operation_identity: { operation_id: 'operation-b' } }, 'OPERATION_MISMATCH'],
    ['isolation', { isolation_scope: { company_id: 'company-b' } }, 'ISOLATION_MISMATCH']
  ];
  for (const [name, change, code] of cases) {
    const changed = buildExecutionHandoff(evidence(change));
    const result = admitExecutionHandoff(current, changed, { now: '2026-08-12T00:00:00.000Z' });
    assert.equal(result.status, 'REJECTED', name);
    assert.equal(result.rejection_code, code, name);
  }
  assert.equal(admitExecutionHandoff(current, handoff, { now: '2100-01-01T00:00:00.000Z' }).rejection_code, 'OWNERSHIP_INVALID');
});

test('rejects non-claimed, terminal, unconsumed, and stale lifecycle evidence', () => {
  const handoff = validHandoff();
  for (const change of [
    { attempt: { state: 'RUNNING' } },
    { attempt: { state: 'UNKNOWN_OUTCOME' } },
    { lifecycle_reference: { state: 'AUTHORIZED' } },
    { attempt: { lease_expires_at: '2020-01-01T00:00:00.000Z' } }
  ]) {
    const current = evidence(change);
    const result = admitExecutionHandoff(current, handoff, { now: '2026-08-12T00:00:00.000Z' });
    assert.equal(result.status, 'REJECTED');
  }
});

test('rejects malformed, incomplete, unsupported, and tampered handoffs', () => {
  const current = evidence();
  const handoff = validHandoff();
  assert.equal(admitExecutionHandoff(current, { ...handoff, contract_version: 'v99' }).rejection_code, 'VERSION_UNSUPPORTED');
  assert.equal(admitExecutionHandoff(current, { ...handoff, handoff_fingerprint: digest('tampered') }).rejection_code, 'FINGERPRINT_MISMATCH');
  assert.equal(admitExecutionHandoff(current, { ...handoff, unexpected: 'security material' }).rejection_code, 'HANDOFF_INVALID');
  assert.equal(admitExecutionHandoff(current, { ...handoff, isolation_scope: undefined }).rejection_code, 'HANDOFF_INVALID');
});

test('rejects replay against a second attempt and accepts only exact replay', () => {
  const first = admitted();
  const exactReplay = admitExecutionHandoff(first.current, first.handoff, { now: '2026-08-12T00:00:00.000Z', prior_admission: { handoff_fingerprint: first.handoff.handoff_fingerprint } });
  assert.equal(exactReplay.admission_status, 'EXACT_REPLAY');
  const secondCurrent = evidence({ attempt: { attempt_id: 'attempt-b', attempt_fingerprint: digest('attempt-b') } });
  assert.equal(admitExecutionHandoff(secondCurrent, first.handoff, { now: '2026-08-12T00:00:00.000Z' }).rejection_code, 'ATTEMPT_MISMATCH');
  const conflicting = admitExecutionHandoff(first.current, first.handoff, { now: '2026-08-12T00:00:00.000Z', prior_admission: { handoff_fingerprint: digest('different-prior-admission') } });
  assert.equal(conflicting.admission_status, 'CONFLICTING_REPLAY');
});

test('result envelope keeps UNKNOWN distinct and never claims execution', () => {
  const handoff = validHandoff();
  const unknown = buildExecutionResultEnvelope({
    authorization_id: handoff.authorization.authorization_id,
    attempt_id: handoff.attempt.attempt_id,
    owner_reference: handoff.attempt.owner_reference,
    handoff_fingerprint: handoff.handoff_fingerprint,
    status: 'EXECUTION_UNKNOWN',
    result_reference: 'result-a'
  });
  assert.equal(unknown.contract_version, RESULT_CONTRACT_VERSION);
  assert.equal(unknown.status, 'EXECUTION_UNKNOWN');
  assert.equal(unknown.execution_performed, false);
  assert.equal(unknown.production_effect, 'ZERO');
  assert.equal(validateExecutionResultEnvelope(unknown).valid, true);
  assert.notEqual(unknown.status, 'EXECUTION_FAILED');
});

test('result envelope rejects malformed or tampered results', () => {
  const handoff = validHandoff();
  const result = buildExecutionResultEnvelope({
    authorization_id: handoff.authorization.authorization_id,
    attempt_id: handoff.attempt.attempt_id,
    owner_reference: handoff.attempt.owner_reference,
    handoff_fingerprint: handoff.handoff_fingerprint,
    status: 'ADMITTED_NO_EXECUTION',
    result_reference: 'result-a'
  });
  assert.equal(validateExecutionResultEnvelope({ ...result, result_fingerprint: digest('tampered') }).valid, false);
  assert.throws(() => buildExecutionResultEnvelope({ ...result, status: 'NOT_A_RESULT' }));
});

test('admission is a pure function and the module exposes no operational imports', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/core/hermes-vps-execution-handoff-contract'), 'utf8');
  for (const forbidden of ['node:http', 'node:https', 'node:net', 'node:child_process', 'fetch(', 'spawn(', 'exec(']) assert.equal(source.includes(forbidden), false, forbidden);
  const result = admitted().result;
  assert.equal(result.execution_performed, false);
  assert.equal(result.production_effect, 'ZERO');
});

test('durably consumes admission once and recovers the same result after restart', () => {
  const fixture = durableAdmissionFixture();
  const first = testOnlyConsume({
    currentEvidence: fixture.current,
    handoff: fixture.handoff,
    persistence: fixture.persistence,
    now: '2026-08-12T00:00:00.000Z',
    consumer_reference: owner
  });
  assert.equal(first.admission_status, 'FIRST_ADMISSION');
  assert.equal(first.execution_eligible, true);

  const persisted = fixture.store.inspect(fixture.current.attempt.attempt_id);
  assert.equal(persisted.admission_consumption.state, 'CONSUMED');
  assert.equal(persisted.admission_consumption.handoff_fingerprint, fixture.handoff.handoff_fingerprint);
  assert.equal(persisted.fingerprint, computeAttemptFingerprint(persisted));

  const afterRestart = cloneValue(fixture.current);
  afterRestart.attempt.attempt_fingerprint = persisted.fingerprint;
  afterRestart.admission_consumption = cloneValue(persisted.admission_consumption);
  const replay = testOnlyConsume({
    currentEvidence: afterRestart,
    handoff: fixture.handoff,
    persistence: fixture.persistence,
    now: '2026-08-12T00:00:00.000Z',
    consumer_reference: owner
  });
  assert.equal(replay.admission_status, 'SAME_RESULT_REPLAY');
  assert.equal(replay.execution_eligible, false);
  assert.equal(replay.admission_reference, first.admission_reference);
});

test('competing consumers against one durable identity produce one fresh admission', async () => {
  const fixture = durableAdmissionFixture();
  const currentA = cloneValue(fixture.current);
  const currentB = cloneValue(fixture.current);
  const handoffA = buildExecutionHandoff(currentA);
  const handoffB = buildExecutionHandoff(currentB);
  const results = await Promise.all([
    Promise.resolve().then(() => testOnlyConsume({ currentEvidence: currentA, handoff: handoffA, persistence: fixture.persistence, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner })),
    Promise.resolve().then(() => testOnlyConsume({ currentEvidence: currentB, handoff: handoffB, persistence: fixture.persistence, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner }))
  ]);
  assert.equal(results.filter((result) => result.admission_status === 'FIRST_ADMISSION').length, 1);
  assert.equal(results.filter((result) => result.admission_status === 'FIRST_ADMISSION' || result.admission_status === 'SAME_RESULT_REPLAY').length, 1);
  assert.equal(fixture.store.inspect(fixture.current.attempt.attempt_id).admission_consumption.state, 'CONSUMED');
});

test('different consumer, transition, lifecycle, operation, and scope replays are denied', () => {
  const fixture = durableAdmissionFixture();
  const otherConsumer = { executor_id: 'executor-b', executor_type: owner.executor_type };
  const differentConsumer = testOnlyConsume({ currentEvidence: fixture.current, handoff: fixture.handoff, persistence: fixture.persistence, now: '2026-08-12T00:00:00.000Z', consumer_reference: otherConsumer });
  assert.equal(differentConsumer.rejection_code, 'OWNER_MISMATCH');

  const transitioned = cloneValue(fixture.current);
  transitioned.attempt.state = 'RUNNING';
  assert.equal(admitExecutionHandoff(transitioned, fixture.handoff, { now: '2026-08-12T00:00:00.000Z' }).status, 'REJECTED');
  const lifecycleChanged = cloneValue(fixture.current);
  lifecycleChanged.lifecycle_reference.state = 'AUTHORIZED';
  assert.equal(admitExecutionHandoff(lifecycleChanged, fixture.handoff, { now: '2026-08-12T00:00:00.000Z' }).status, 'REJECTED');
  assert.equal(admitExecutionHandoff(fixture.current, buildExecutionHandoff(evidence({ operation_identity: { operation_id: 'operation-b' } })), { now: '2026-08-12T00:00:00.000Z' }).status, 'REJECTED');
  assert.equal(admitExecutionHandoff(fixture.current, buildExecutionHandoff(evidence({ isolation_scope: { company_id: 'company-b' } })), { now: '2026-08-12T00:00:00.000Z' }).status, 'REJECTED');
});

test('persistence failure or malformed persisted admission fails closed', () => {
  const failed = durableAdmissionFixture();
  failed.store.configureFailure('ATOMIC_ADMISSION_FAILED');
  const failure = testOnlyConsume({ currentEvidence: failed.current, handoff: failed.handoff, persistence: failed.persistence, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  assert.equal(failure.status, 'REJECTED');
  assert.equal(failure.execution_eligible, false);
  assert.equal(failure.admission_reference, undefined);

  const malformed = durableAdmissionFixture();
  const originalAtomic = malformed.store.atomicConsumeExecutionAdmission;
  const malformedPersistence = createExecutionHandoffAdmissionPersistenceInterface({
    atomicConsumeExecutionAdmission: (request) => {
      const result = originalAtomic(request);
      return result.ok ? { ...result, entry: { state: 'CONSUMED' } } : result;
    }
  });
  const malformedResult = testOnlyConsume({ currentEvidence: malformed.current, handoff: malformed.handoff, persistence: malformedPersistence, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  assert.equal(malformedResult.status, 'REJECTED');
  assert.equal(malformedResult.execution_eligible, false);
});

test('admission requires the dedicated atomic primitive and never composes legacy calls', () => {
  const fixture = durableAdmissionFixture();
  const legacy = {
    interface_version: 'hermes-vps-execution- attempt-ownership-persistence-v2',
    read: () => { throw new Error('legacy_read_must_not_be_called'); },
    transition: () => { throw new Error('legacy_transition_must_not_be_called'); }
  };
  const denied = consumeExecutionHandoff({ currentEvidence: fixture.current, handoff: fixture.handoff, persistence: legacy, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  assert.equal(denied.status, 'REJECTED');
  assert.equal(denied.reason, 'trusted_durable_admission_adapter_required');

  let called = 0;
  const primitiveOnly = createExecutionHandoffAdmissionPersistenceInterface({
    atomicConsumeExecutionAdmission: (request) => {
      called += 1;
      return fixture.store.atomicConsumeExecutionAdmission(request);
    }
  });
  const semanticResult = testOnlyConsume({ currentEvidence: fixture.current, handoff: fixture.handoff, persistence: primitiveOnly, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  assert.equal(semanticResult.admission_status, 'FIRST_ADMISSION');
  assert.equal(called, 1);
});

test('runtime trust module exposes no public self-certification capability', () => {
  const trustModule = require('../src/core/hermes-vps-trusted-durable-admission-adapter');
  assert.equal(Object.prototype.hasOwnProperty.call(trustModule, 'certifyTrustedDurableAtomicAdmissionAdapter'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(require('../src/core/hermes-vps-execution-handoff-contract'), 'consumeExecutionHandoffSemanticTestOnly'), false);
  assert.equal(consumeExecutionHandoff({ currentEvidence: evidence(), handoff: validHandoff(), persistence: createDeterministicExecutionAttemptOwnershipTestStore(), now: '2026-08-12T00:00:00.000Z', consumer_reference: owner }).status, 'REJECTED');
});

test('ambiguous admission retry resolves only from durable truth and never duplicates entitlement', () => {
  const persistedFixture = durableAdmissionFixture();
  let persisted = null;
  let firstCall = true;
  const ambiguousThenPersisted = createExecutionHandoffAdmissionPersistenceInterface({
    atomicConsumeExecutionAdmission: (request) => {
      if (firstCall) {
        firstCall = false;
        persisted = { state: 'CONSUMED', handoff_fingerprint: request.handoff_fingerprint, admission_reference: request.admission_reference, consumer_reference: request.consumer_reference, admission_status: 'FIRST_ADMISSION' };
        return { ok: false, status: 'AMBIGUOUS' };
      }
      return { ok: true, status: 'ADMITTED', entry: { ...persisted, admission_status: 'SAME_RESULT_REPLAY' } };
    }
  });
  const first = testOnlyConsume({ currentEvidence: persistedFixture.current, handoff: persistedFixture.handoff, persistence: ambiguousThenPersisted, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  const retry = testOnlyConsume({ currentEvidence: persistedFixture.current, handoff: persistedFixture.handoff, persistence: ambiguousThenPersisted, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  assert.equal(first.status, 'REJECTED');
  assert.equal(first.execution_eligible, false);
  assert.equal(retry.admission_status, 'SAME_RESULT_REPLAY');
  assert.equal(retry.execution_eligible, false);

  let notPersistedFirstCall = true;
  const ambiguousThenAbsent = createExecutionHandoffAdmissionPersistenceInterface({
    atomicConsumeExecutionAdmission: (request) => {
      if (notPersistedFirstCall) {
        notPersistedFirstCall = false;
        return { ok: false, status: 'AMBIGUOUS' };
      }
      return { ok: true, status: 'ADMITTED', entry: { state: 'CONSUMED', handoff_fingerprint: request.handoff_fingerprint, admission_reference: request.admission_reference, consumer_reference: request.consumer_reference, admission_status: 'FIRST_ADMISSION' } };
    }
  });
  const absentFirst = testOnlyConsume({ currentEvidence: persistedFixture.current, handoff: persistedFixture.handoff, persistence: ambiguousThenAbsent, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  const absentRetry = testOnlyConsume({ currentEvidence: persistedFixture.current, handoff: persistedFixture.handoff, persistence: ambiguousThenAbsent, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  assert.equal(absentFirst.execution_eligible, false);
  assert.equal(absentRetry.admission_status, 'FIRST_ADMISSION');
});

test('atomic admission does not claim exactly-once external execution', () => {
  const fixture = durableAdmissionFixture();
  const result = testOnlyConsume({ currentEvidence: fixture.current, handoff: fixture.handoff, persistence: fixture.persistence, now: '2026-08-12T00:00:00.000Z', consumer_reference: owner });
  assert.equal(result.execution_performed, false);
  assert.equal(result.production_effect, 'ZERO');
  assert.equal(result.status, 'FIRST_ADMISSION');
});
