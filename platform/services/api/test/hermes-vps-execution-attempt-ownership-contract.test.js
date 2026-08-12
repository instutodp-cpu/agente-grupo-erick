'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const { buildHermesVpsExecutionAuthorization } = require('../src/core/hermes-vps-execution-authorization-contract');
const {
  ATTEMPT_STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  createDeterministicExecutionAttemptOwnershipTestStore,
  createHermesVpsExecutionAttemptOwnershipRegistry
} = require('../src/core/hermes-vps-execution-attempt-ownership-contract');

const provenance = { repository: 'instutodp-cpu/agente-grupo-erick', branch: 'hermes/vps-execution-attempt-ownership-v1', commit_sha: 'fa186029bee593e502fd754caf542ad542184fdf' };
const bootstrap = buildHermesVpsBootstrapContract({ provenance });
const plan = buildHermesVpsProvisioningPlan({ bootstrap_contract: bootstrap });
const authorization = buildHermesVpsExecutionAuthorization({
  provisioning_plan: plan,
  authorization_id: 'authorization-A',
  issued_at: '2026-08-12T10:00:00.000Z',
  expires_at: '2026-08-12T10:05:00.000Z',
  issued_by: { authority_id: 'owner-1', authority_type: 'human_owner' },
  target_id: 'approved-staging-host-reference',
  phase_ids: ['P0_HOST_VALIDATION'],
  step_ids: ['validate_host'],
  provenance
});

const scope = { phase_id: 'P0_HOST_VALIDATION', step_id: 'validate_host' };
const executor = { executor_id: 'executor-A', executor_type: 'synthetic_executor' };
const now = '2026-08-12T10:01:00.000Z';

function request(overrides = {}) {
  return {
    attempt_id: 'attempt-A',
    authorization,
    authorization_lifecycle: { state: 'CONSUMED', authorization_id: authorization.authorization_id, reference_id: 'consume-A' },
    execution_scope: scope,
    executor_reference: executor,
    lease: { lease_id: 'lease-A', expires_at: '2026-08-12T10:03:00.000Z' },
    idempotency_key: 'attempt-idempotency-A',
    now,
    ...overrides
  };
}

function setup(overrides = {}) {
  const store = createDeterministicExecutionAttemptOwnershipTestStore();
  const registry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: store });
  const registered = registry.registerAttempt(request(overrides));
  assert.equal(registered.status, 'CLAIMABLE');
  return { store, registry };
}

function claim(registry, overrides = {}) {
  return registry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now, ...overrides });
}

function malformedPersistence(operation, value) {
  const store = createDeterministicExecutionAttemptOwnershipTestStore();
  return { ...store, [operation]: () => value };
}

function throwingPersistence(operation) {
  const store = createDeterministicExecutionAttemptOwnershipTestStore();
  return { ...store, [operation]: () => { throw new Error('adapter_failure'); } };
}

test('state machine is explicit and terminal states have no outgoing transitions', () => {
  assert.deepEqual(ATTEMPT_STATES, ['CLAIMABLE', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN_OUTCOME', 'ABORTED', 'EXPIRED']);
  for (const state of TERMINAL_STATES) assert.deepEqual(TRANSITIONS[state], []);
});

test('valid authorization owns a claimable attempt', () => {
  const { store } = setup();
  assert.equal(store.inspect('attempt-A').state, 'CLAIMABLE');
  assert.equal(store.inspect('attempt-A').authorization_id, 'authorization-A');
});

test('exactly one executor claims an attempt', () => {
  const { registry } = setup();
  assert.equal(claim(registry).status, 'CLAIMED');
  assert.equal(claim(registry, { executor_reference: { executor_id: 'executor-B', executor_type: 'synthetic_executor' } }).status, 'ALREADY_CLAIMED');
});

test('competing claims have one logical winner', () => {
  const { registry } = setup();
  const outcomes = [claim(registry), claim(registry, { executor_reference: { executor_id: 'executor-B', executor_type: 'synthetic_executor' } })];
  assert.equal(outcomes.filter((value) => value.ok).length, 1);
});

test('duplicate registration is replay-safe and payload changes conflict', () => {
  const { registry } = setup();
  assert.equal(registry.registerAttempt(request()).status, 'REPLAY_ACCEPTED');
  assert.equal(registry.registerAttempt(request({ idempotency_key: 'different' })).status, 'CONFLICT');
});

test('authorization, plan, scope and executor mismatches deny', () => {
  const { registry } = setup();
  assert.equal(registry.registerAttempt(request({ authorization_lifecycle: { ...request().authorization_lifecycle, authorization_id: 'authorization-B' } })).status, 'DENY');
  assert.equal(claim(registry, { executor_reference: { executor_id: 'executor-B', executor_type: 'synthetic_executor' } }).status, 'DENY');
  assert.equal(registry.registerAttempt(request({ execution_scope: { phase_id: 'P1_BASE_OS_PREPARATION', step_id: 'validate_host' } })).status, 'DENY');
});

test('expired authorization and expired lease deny', () => {
  const expiredAuth = { ...authorization, expires_at: '2026-08-12T10:00:30.000Z' };
  assert.equal(createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: createDeterministicExecutionAttemptOwnershipTestStore() }).registerAttempt(request({ authorization: expiredAuth })).status, 'DENY');
  const { registry } = setup();
  assert.equal(claim(registry, { lease_expires_at: '2026-08-12T10:00:30.000Z' }).status, 'DENY');
});

test('claim then running then unknown outcome is terminal and cannot retry', () => {
  const { registry } = setup();
  assert.equal(claim(registry).status, 'CLAIMED');
  assert.equal(registry.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'RUNNING' }).status, 'RUNNING');
  assert.equal(registry.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'UNKNOWN_OUTCOME', reason: 'provider_result_lost' }).status, 'UNKNOWN_OUTCOME');
  assert.equal(claim(registry).status, 'UNKNOWN_OUTCOME');
});

test('success requires explicit future-executor confirmation', () => {
  const { registry } = setup();
  claim(registry);
  assert.equal(registry.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'RUNNING' }).status, 'RUNNING');
  assert.equal(registry.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'SUCCEEDED' }).status, 'DENY');
  assert.equal(registry.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'SUCCEEDED', provider_outcome: 'CONFIRMED_BY_FUTURE_EXECUTOR' }).status, 'SUCCEEDED');
});

test('stale claimed lease is explicitly expired and cannot be reclaimed', () => {
  const { registry } = setup();
  claim(registry);
  assert.equal(registry.recoverStaleAttempt('attempt-A', { now: '2026-08-12T10:04:00.000Z' }).status, 'EXPIRED');
  assert.equal(claim(registry).status, 'ALREADY_CLAIMED');
});

test('stale running lease becomes unknown outcome and cannot be retried', () => {
  const { registry } = setup();
  claim(registry);
  registry.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'RUNNING' });
  assert.equal(registry.recoverStaleAttempt('attempt-A', { now: '2026-08-12T10:04:00.000Z' }).status, 'UNKNOWN_OUTCOME');
  assert.equal(claim(registry).status, 'UNKNOWN_OUTCOME');
});

test('authorization lifecycle must be consumed and bound by ID', () => {
  const store = createDeterministicExecutionAttemptOwnershipTestStore();
  const registry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: store });
  assert.equal(registry.registerAttempt(request({ authorization_lifecycle: { state: 'REGISTERED', authorization_id: 'authorization-A', reference_id: 'register-A' } })).status, 'DENY');
  assert.equal(registry.registerAttempt(request({ authorization_lifecycle: { state: 'CONSUMED', authorization_id: 'authorization-B', reference_id: 'consume-B' } })).status, 'DENY');
});

test('revoked lifecycle and unknown persisted states deny forward progress', () => {
  const revoked = createDeterministicExecutionAttemptOwnershipTestStore();
  const registry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: revoked });
  assert.equal(registry.registerAttempt(request({ authorization_lifecycle: { state: 'REVOKED', authorization_id: 'authorization-A', reference_id: 'revoke-A' } })).status, 'DENY');
  const unknown = malformedPersistence('read', { ok: true, status: 'READ', entry: { state: 'UNKNOWN' } });
  const unknownRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: unknown });
  assert.equal(unknownRegistry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'DENY');
});

test('persistence failures deny without success receipts', () => {
  const store = createDeterministicExecutionAttemptOwnershipTestStore();
  store.configureFailure('READ_FAILED');
  const registry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: store });
  const outcome = registry.registerAttempt(request());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.receipt, undefined);
});

test('adapter exceptions fail closed for insert, read, claim, transition and recovery', () => {
  const insertRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: throwingPersistence('insert') });
  assert.doesNotThrow(() => assert.equal(insertRegistry.registerAttempt(request()).status, 'PERSISTENCE_FAILURE'));
  const readRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: throwingPersistence('read') });
  assert.equal(readRegistry.registerAttempt(request()).status, 'PERSISTENCE_FAILURE');
  const claimBase = createDeterministicExecutionAttemptOwnershipTestStore();
  const claimSetup = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: claimBase });
  assert.equal(claimSetup.registerAttempt(request()).status, 'CLAIMABLE');
  const claimPersistence = { ...claimBase, compareAndClaim: () => { throw new Error('adapter_failure'); } };
  const claimRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: claimPersistence });
  assert.equal(claimRegistry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'PERSISTENCE_FAILURE');
  const transitionBase = createDeterministicExecutionAttemptOwnershipTestStore();
  const transitionSetup = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: transitionBase });
  assert.equal(transitionSetup.registerAttempt(request()).status, 'CLAIMABLE');
  const transitionPersistence = { ...transitionBase, transition: () => { throw new Error('adapter_failure'); } };
  const transitionRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: transitionPersistence });
  assert.equal(transitionRegistry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'CLAIMED');
  assert.equal(transitionRegistry.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'RUNNING' }).status, 'PERSISTENCE_FAILURE');
  const recoveryBase = createDeterministicExecutionAttemptOwnershipTestStore();
  const recoverySetup = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: recoveryBase });
  assert.equal(recoverySetup.registerAttempt(request()).status, 'CLAIMABLE');
  const recoveryPersistence = { ...recoveryBase, recover: () => { throw new Error('adapter_failure'); } };
  const recoveryRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: recoveryPersistence });
  assert.equal(recoveryRegistry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'CLAIMED');
  assert.equal(recoveryRegistry.recoverStaleAttempt('attempt-A', { now: '2026-08-12T10:04:00.000Z' }).status, 'PERSISTENCE_FAILURE');
});

test('malformed adapter returns fail closed without false success', () => {
  const malformed = { ok: true, status: 'UNKNOWN', entry: {} };
  assert.equal(createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: malformedPersistence('read', malformed) }).registerAttempt(request()).status, 'PERSISTENCE_FAILURE');
  assert.equal(createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: malformedPersistence('insert', malformed) }).registerAttempt(request()).status, 'PERSISTENCE_FAILURE');

  const claimBase = createDeterministicExecutionAttemptOwnershipTestStore();
  const claimSetup = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: claimBase });
  claimSetup.registerAttempt(request());
  const claimRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: { ...claimBase, compareAndClaim: () => malformed } });
  assert.equal(claimRegistry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'PERSISTENCE_FAILURE');

  const transitionBase = createDeterministicExecutionAttemptOwnershipTestStore();
  const transitionSetup = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: transitionBase });
  transitionSetup.registerAttempt(request());
  const transitionRegistry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: transitionBase });
  assert.equal(transitionRegistry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'CLAIMED');
  const malformedTransition = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: { ...transitionBase, transition: () => malformed } });
  assert.equal(malformedTransition.transitionAttempt('attempt-A', { executor_reference: executor, next_state: 'RUNNING' }).status, 'PERSISTENCE_FAILURE');

  const recoveryBase = createDeterministicExecutionAttemptOwnershipTestStore();
  const recoverySetup = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: recoveryBase });
  recoverySetup.registerAttempt(request());
  recoverySetup.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now });
  const malformedRecovery = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: { ...recoveryBase, recover: () => malformed } });
  assert.equal(malformedRecovery.recoverStaleAttempt('attempt-A', { now: '2026-08-12T10:04:00.000Z' }).status, 'PERSISTENCE_FAILURE');
});

test('malformed persisted attempt denies instead of authorizing', () => {
  const persistence = malformedPersistence('read', { ok: true, status: 'READ', entry: { attempt_id: 'attempt-A', state: 'CLAIMABLE' } });
  const registry = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence });
  assert.equal(registry.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'DENY');
});

test('ownership survives a new registry instance using the same adapter', () => {
  const store = createDeterministicExecutionAttemptOwnershipTestStore();
  const first = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: store });
  assert.equal(first.registerAttempt(request()).status, 'CLAIMABLE');
  assert.equal(first.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-A', lease_expires_at: '2026-08-12T10:03:00.000Z', now }).status, 'CLAIMED');
  const recovered = createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan: plan, persistence: store });
  assert.equal(recovered.claimAttempt('attempt-A', { executor_reference: executor, lease_id: 'lease-B', lease_expires_at: '2026-08-12T10:04:00.000Z', now }).status, 'ALREADY_CLAIMED');
});

test('receipts are deterministic, lifecycle-only, and mutation-sensitive', () => {
  const first = setup().registry.registerAttempt(request());
  const second = setup().registry.registerAttempt(request());
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(first.receipt.execution_observed, false);
  assert.equal(first.receipt.production_effect, 'ZERO');
  assert.notEqual(first.receipt.fingerprint, setup({ attempt_id: 'attempt-B' }).registry.registerAttempt(request({ attempt_id: 'attempt-B' })).receipt.fingerprint);
});

test('no operation in the contract exposes an operational capability', () => {
  const { registry } = setup();
  assert.equal(registry.production_execution_implemented, false);
  assert.equal(registry.logical_atomicity, true);
  assert.equal(typeof registry.claimAttempt, 'function');
  assert.equal(typeof registry.transitionAttempt, 'function');
});
