'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  validateHermesVpsExecutionAuthorizationContract
} = require('./hermes-vps-execution-authorization-contract');
const { validateHermesVpsProvisioningPlan } = require('./hermes-vps-provisioning-plan');

const CONTRACT_VERSION = 'hermes-vps-execution-attempt-ownership-contract-v1';
const PERSISTENCE_INTERFACE_VERSION = 'hermes-vps-execution-attempt-ownership-persistence-v1';
const ATTEMPT_STATES = Object.freeze([
  'CLAIMABLE', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED',
  'UNKNOWN_OUTCOME', 'ABORTED', 'EXPIRED'
]);
const TERMINAL_STATES = Object.freeze(['SUCCEEDED', 'FAILED', 'UNKNOWN_OUTCOME', 'ABORTED', 'EXPIRED']);
const PERSISTENCE_FAILURE = 'PERSISTENCE_FAILURE';
const FAILURE_STATUSES = Object.freeze(['READ_FAILED', 'CLAIM_FAILED', 'TRANSITION_FAILED', 'RECOVERY_FAILED']);
const TRANSITIONS = Object.freeze({
  CLAIMABLE: ['CLAIMED'],
  CLAIMED: ['RUNNING', 'UNKNOWN_OUTCOME', 'ABORTED', 'EXPIRED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'UNKNOWN_OUTCOME', 'ABORTED', 'EXPIRED'],
  SUCCEEDED: [],
  FAILED: [],
  UNKNOWN_OUTCOME: [],
  ABORTED: [],
  EXPIRED: []
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function result(value) {
  return Object.freeze(clone(value));
}

function digest(value) {
  return computeCanonicalContentDigest(JSON.parse(stablePayload(value)));
}

function validIso(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function canonicalAttemptMaterial(entry) {
  return {
    contract_version: CONTRACT_VERSION,
    attempt_id: entry.attempt_id,
    authorization_id: entry.authorization_id,
    authorization_hash: entry.authorization_hash,
    plan_version: entry.plan_version,
    plan_hash: entry.plan_hash,
    execution_scope: {
      phase_id: entry.execution_scope.phase_id,
      step_id: entry.execution_scope.step_id
    },
    executor_reference: entry.executor_reference,
    lease: {
      lease_id: entry.lease.lease_id,
      expires_at: entry.lease.expires_at
    },
    state: entry.state,
    owner_reference: entry.owner_reference,
    sequence: entry.sequence,
    idempotency_key: entry.idempotency_key
  };
}

function computeAttemptFingerprint(entry) {
  return digest(canonicalAttemptMaterial(entry));
}

function canonicalReceipt(entry, event, reason = null) {
  const material = {
    contract_version: CONTRACT_VERSION,
    event,
    attempt_id: entry.attempt_id,
    authorization_id: entry.authorization_id,
    attempt_fingerprint: entry.fingerprint,
    state: entry.state,
    sequence: entry.sequence,
    reason
  };
  return {
    contract_version: CONTRACT_VERSION,
    event,
    attempt_id: entry.attempt_id,
    authorization_id: entry.authorization_id,
    state: entry.state,
    sequence: entry.sequence,
    fingerprint: digest(material),
    execution_observed: false,
    production_effect: 'ZERO'
  };
}

function containRejectedThenable(value) {
  try {
    Promise.resolve(value).catch(() => {});
  } catch {
    // A malformed thenable is denied; any rejection is intentionally contained.
  }
}

function persistenceFailure(operation, reason) {
  return result({ ok: false, status: PERSISTENCE_FAILURE, reason: `${operation}_${reason}` });
}

function invokePersistence(operation, method, args, shape) {
  let raw;
  try {
    raw = method(...args);
  } catch {
    return persistenceFailure(operation, 'exception');
  }
  let then;
  try {
    then = raw !== null && (typeof raw === 'object' || typeof raw === 'function') ? raw.then : undefined;
  } catch {
    return persistenceFailure(operation, 'malformed_result');
  }
  if (typeof then === 'function') {
    containRejectedThenable(raw);
    return persistenceFailure(operation, 'async_result_not_supported');
  }
  if (!isPlainObject(raw) || typeof raw.ok !== 'boolean' || !isNonEmptyString(raw.status)) {
    return persistenceFailure(operation, 'malformed_result');
  }
  if (raw.ok) {
    const entryValid = shape.allowsNullEntry ? (raw.entry === null || isPlainObject(raw.entry)) : isPlainObject(raw.entry);
    if (raw.status !== shape.successStatus || !entryValid) return persistenceFailure(operation, 'contradictory_result');
    return raw;
  }
  if (!shape.failureStatuses.includes(raw.status) || (raw.entry !== undefined && raw.entry !== null && !isPlainObject(raw.entry))) {
    return persistenceFailure(operation, 'contradictory_result');
  }
  return raw;
}

function validateExecutionScope(scope, plan, authorization) {
  if (!isPlainObject(scope) || !isNonEmptyString(scope.phase_id) || !isNonEmptyString(scope.step_id)) return false;
  const step = plan.ordered_steps.find((candidate) => candidate.id === scope.step_id);
  return Boolean(step && step.phase === scope.phase_id && authorization.execution_scope.phase_ids.includes(scope.phase_id) && authorization.execution_scope.step_ids.includes(scope.step_id));
}

function validateAuthorizationBinding(request, plan, now) {
  if (!isPlainObject(request) || !isPlainObject(request.authorization) || !isPlainObject(request.authorization_lifecycle)) return false;
  const authorization = request.authorization;
  const lifecycle = request.authorization_lifecycle;
  if (!validateHermesVpsExecutionAuthorizationContract(authorization, plan).valid) return false;
  if (lifecycle.state !== 'CONSUMED' || lifecycle.authorization_id !== authorization.authorization_id || !isNonEmptyString(lifecycle.reference_id)) return false;
  if (!validIso(now) || Date.parse(authorization.expires_at) <= Date.parse(now)) return false;
  if (authorization.revocation.state === 'REVOKED') return false;
  if (!validateExecutionScope(request.execution_scope, plan, authorization)) return false;
  return true;
}

function validateExecutorReference(value) {
  return isPlainObject(value) && isNonEmptyString(value.executor_id) && isNonEmptyString(value.executor_type);
}

function validateAttemptEntry(entry, plan) {
  if (!isPlainObject(entry) || !isNonEmptyString(entry.attempt_id) || !isNonEmptyString(entry.authorization_id)) return false;
  if (!isCanonicalContentDigest(entry.authorization_hash) || !isCanonicalContentDigest(entry.plan_hash) || entry.plan_version !== plan.plan_version) return false;
  if (!isPlainObject(entry.execution_scope) || !validateExecutionScope(entry.execution_scope, plan, { execution_scope: { phase_ids: [entry.execution_scope.phase_id], step_ids: [entry.execution_scope.step_id] } })) return false;
  if (!validateExecutorReference(entry.executor_reference)) return false;
  if (!isPlainObject(entry.lease) || !isNonEmptyString(entry.lease.lease_id) || !validIso(entry.lease.expires_at)) return false;
  if (!ATTEMPT_STATES.includes(entry.state) || !Number.isInteger(entry.sequence) || entry.sequence < 0) return false;
  if (entry.owner_reference !== null && !validateExecutorReference(entry.owner_reference)) return false;
  if (!isNonEmptyString(entry.idempotency_key) || !isCanonicalContentDigest(entry.fingerprint)) return false;
  return entry.fingerprint === computeAttemptFingerprint(entry);
}

function createExecutionAttemptOwnershipPersistenceInterface({ read, insert, compareAndClaim, transition, recover }) {
  if (![read, insert, compareAndClaim, transition, recover].every((method) => typeof method === 'function')) throw new Error('persistence_interface_incomplete');
  return Object.freeze({ interface_version: PERSISTENCE_INTERFACE_VERSION, read, insert, compareAndClaim, transition, recover });
}

function createDeterministicExecutionAttemptOwnershipTestStore() {
  const records = new Map();
  const failures = new Set();

  function failure(operation) {
    return failures.has(operation) ? result({ ok: false, status: operation }) : null;
  }

  const store = createExecutionAttemptOwnershipPersistenceInterface({
    read: (attemptId) => {
      const failed = failure('READ_FAILED');
      if (failed) return failed;
      return result({ ok: true, status: 'READ', entry: records.has(attemptId) ? clone(records.get(attemptId)) : null });
    },
    insert: (entry) => {
      const failed = failure('INSERT_FAILED');
      if (failed) return failed;
      if (records.has(entry.attempt_id)) return result({ ok: false, status: 'CONFLICT', entry: clone(records.get(entry.attempt_id)) });
      records.set(entry.attempt_id, clone(entry));
      return result({ ok: true, status: 'INSERTED', entry: clone(entry) });
    },
    compareAndClaim: (attemptId, expectedFingerprint, claimedEntry) => {
      const failed = failure('CLAIM_FAILED');
      if (failed) return failed;
      const current = records.get(attemptId);
      if (!current || current.fingerprint !== expectedFingerprint || current.state !== 'CLAIMABLE') return result({ ok: false, status: 'CONFLICT', entry: current ? clone(current) : null });
      records.set(attemptId, clone(claimedEntry));
      return result({ ok: true, status: 'CLAIMED', entry: clone(claimedEntry) });
    },
    transition: (attemptId, expectedFingerprint, nextEntry) => {
      const failed = failure('TRANSITION_FAILED');
      if (failed) return failed;
      const current = records.get(attemptId);
      if (!current || current.fingerprint !== expectedFingerprint) return result({ ok: false, status: 'CONFLICT', entry: current ? clone(current) : null });
      records.set(attemptId, clone(nextEntry));
      return result({ ok: true, status: 'TRANSITIONED', entry: clone(nextEntry) });
    },
    recover: (attemptId, expectedFingerprint, nextEntry) => {
      const failed = failure('RECOVERY_FAILED');
      if (failed) return failed;
      const current = records.get(attemptId);
      if (!current || current.fingerprint !== expectedFingerprint) return result({ ok: false, status: 'CONFLICT', entry: current ? clone(current) : null });
      records.set(attemptId, clone(nextEntry));
      return result({ ok: true, status: 'RECOVERED', entry: clone(nextEntry) });
    }
  });

  return Object.freeze({
    ...store,
    configureFailure: (operation, enabled = true) => { if (enabled) failures.add(operation); else failures.delete(operation); },
    inspect: (attemptId) => records.has(attemptId) ? clone(records.get(attemptId)) : null
  });
}

function createHermesVpsExecutionAttemptOwnershipRegistry({ provisioning_plan, persistence }) {
  if (!isPlainObject(provisioning_plan) || !validateHermesVpsProvisioningPlan(provisioning_plan).valid) throw new Error('provisioning_plan_invalid');
  if (!persistence || persistence.interface_version !== PERSISTENCE_INTERFACE_VERSION) throw new Error('persistence_interface_invalid');

  function registerAttempt(request) {
    if (!validateAuthorizationBinding(request, provisioning_plan, request?.now)) return result({ ok: false, status: 'DENY', reason: 'authorization_binding_invalid' });
    if (!isNonEmptyString(request.attempt_id) || !validateExecutorReference(request.executor_reference) || !isNonEmptyString(request.idempotency_key) || !isPlainObject(request.lease) || !isNonEmptyString(request.lease.lease_id) || !validIso(request.lease.expires_at)) return result({ ok: false, status: 'DENY', reason: 'attempt_identity_invalid' });
    if (Date.parse(request.lease.expires_at) <= Date.parse(request.now)) return result({ ok: false, status: 'DENY', reason: 'lease_already_expired' });
    const entry = {
      attempt_id: request.attempt_id,
      authorization_id: request.authorization.authorization_id,
      authorization_hash: request.authorization.authorization_hash,
      plan_version: provisioning_plan.plan_version,
      plan_hash: provisioning_plan.plan_hash,
      execution_scope: clone(request.execution_scope),
      executor_reference: clone(request.executor_reference),
      lease: clone(request.lease),
      state: 'CLAIMABLE',
      owner_reference: null,
      sequence: 0,
      idempotency_key: request.idempotency_key,
      fingerprint: 'pending'
    };
    entry.fingerprint = computeAttemptFingerprint(entry);
    const existing = invokePersistence('read', persistence.read, [entry.attempt_id], { successStatus: 'READ', failureStatuses: ['READ_FAILED'], allowsNullEntry: true });
    if (!existing.ok) return result({ ok: false, status: existing.status, reason: 'persistence_read_failed' });
    if (existing.entry) return existing.entry.fingerprint === entry.fingerprint ? result({ ok: true, status: 'REPLAY_ACCEPTED', receipt: canonicalReceipt(existing.entry, 'ATTEMPT_REGISTERED') }) : result({ ok: false, status: 'CONFLICT', reason: 'attempt_id_reuse_or_payload_mismatch' });
    const inserted = invokePersistence('insert', persistence.insert, [entry], { successStatus: 'INSERTED', failureStatuses: ['INSERT_FAILED', 'CONFLICT'] });
    if (!inserted.ok) return result({ ok: false, status: inserted.status, reason: 'persistence_insert_failed' });
    return result({ ok: true, status: 'CLAIMABLE', attempt_id: entry.attempt_id, receipt: canonicalReceipt(entry, 'ATTEMPT_REGISTERED') });
  }

  function claimAttempt(attemptId, request) {
    const read = invokePersistence('read', persistence.read, [attemptId], { successStatus: 'READ', failureStatuses: ['READ_FAILED'], allowsNullEntry: true });
    if (!read.ok) return result({ ok: false, status: read.status, reason: 'persistence_read_failed' });
    if (!read.entry || !validateAttemptEntry(read.entry, provisioning_plan)) return result({ ok: false, status: 'DENY', reason: 'attempt_missing_or_malformed' });
    const current = read.entry;
    if (current.state !== 'CLAIMABLE') return result({ ok: false, status: current.state === 'UNKNOWN_OUTCOME' ? 'UNKNOWN_OUTCOME' : 'ALREADY_CLAIMED', reason: 'attempt_not_claimable' });
    if (!validateExecutorReference(request?.executor_reference) || request.executor_reference.executor_id !== current.executor_reference.executor_id || request.executor_reference.executor_type !== current.executor_reference.executor_type) return result({ ok: false, status: 'DENY', reason: 'executor_mismatch' });
    if (!isNonEmptyString(request.lease_id) || !validIso(request.lease_expires_at) || !validIso(request.now) || Date.parse(request.lease_expires_at) <= Date.parse(request.now)) return result({ ok: false, status: 'DENY', reason: 'lease_invalid' });
    const claimed = { ...current, state: 'CLAIMED', owner_reference: clone(request.executor_reference), lease: { lease_id: request.lease_id, expires_at: request.lease_expires_at }, sequence: current.sequence + 1, fingerprint: 'pending' };
    claimed.fingerprint = computeAttemptFingerprint(claimed);
    const written = invokePersistence('compareAndClaim', persistence.compareAndClaim, [attemptId, current.fingerprint, claimed], { successStatus: 'CLAIMED', failureStatuses: ['CLAIM_FAILED', 'CONFLICT'] });
    if (!written.ok) return result({ ok: false, status: written.status === 'CONFLICT' ? 'ALREADY_CLAIMED' : written.status, reason: 'persistence_claim_failed' });
    return result({ ok: true, status: 'CLAIMED', attempt_id: attemptId, receipt: canonicalReceipt(claimed, 'ATTEMPT_CLAIMED') });
  }

  function transitionAttempt(attemptId, request) {
    const read = invokePersistence('read', persistence.read, [attemptId], { successStatus: 'READ', failureStatuses: ['READ_FAILED'], allowsNullEntry: true });
    if (!read.ok) return result({ ok: false, status: read.status, reason: 'persistence_read_failed' });
    if (!read.entry || !validateAttemptEntry(read.entry, provisioning_plan)) return result({ ok: false, status: 'DENY', reason: 'attempt_missing_or_malformed' });
    const current = read.entry;
    if (!validateExecutorReference(request?.executor_reference) || current.owner_reference?.executor_id !== request.executor_reference.executor_id || current.owner_reference?.executor_type !== request.executor_reference.executor_type) return result({ ok: false, status: 'DENY', reason: 'executor_mismatch' });
    if (!ATTEMPT_STATES.includes(request?.next_state) || !TRANSITIONS[current.state].includes(request.next_state)) return result({ ok: false, status: 'DENY', reason: 'transition_invalid' });
    if (request.next_state === 'SUCCEEDED' && request.provider_outcome !== 'CONFIRMED_BY_FUTURE_EXECUTOR') return result({ ok: false, status: 'DENY', reason: 'success_requires_future_executor_confirmation' });
    const next = { ...current, state: request.next_state, sequence: current.sequence + 1, fingerprint: 'pending' };
    next.fingerprint = computeAttemptFingerprint(next);
    const written = invokePersistence('transition', persistence.transition, [attemptId, current.fingerprint, next], { successStatus: 'TRANSITIONED', failureStatuses: ['TRANSITION_FAILED', 'CONFLICT'] });
    if (!written.ok) return result({ ok: false, status: written.status, reason: 'persistence_transition_failed' });
    return result({ ok: true, status: request.next_state, attempt_id: attemptId, receipt: canonicalReceipt(next, 'ATTEMPT_STATE_RECORDED', request.reason || null) });
  }

  function recoverStaleAttempt(attemptId, request) {
    const read = invokePersistence('read', persistence.read, [attemptId], { successStatus: 'READ', failureStatuses: ['READ_FAILED'], allowsNullEntry: true });
    if (!read.ok) return result({ ok: false, status: read.status, reason: 'persistence_read_failed' });
    if (!read.entry || !validateAttemptEntry(read.entry, provisioning_plan)) return result({ ok: false, status: 'DENY', reason: 'attempt_missing_or_malformed' });
    const current = read.entry;
    if (!validIso(request?.now) || Date.parse(current.lease.expires_at) > Date.parse(request.now)) return result({ ok: false, status: 'DENY', reason: 'lease_not_stale' });
    if (!['CLAIMED', 'RUNNING'].includes(current.state)) return result({ ok: false, status: 'DENY', reason: 'attempt_not_recoverable' });
    const nextState = current.state === 'RUNNING' ? 'UNKNOWN_OUTCOME' : 'EXPIRED';
    const recovered = { ...current, state: nextState, sequence: current.sequence + 1, fingerprint: 'pending' };
    recovered.fingerprint = computeAttemptFingerprint(recovered);
    const written = invokePersistence('recover', persistence.recover, [attemptId, current.fingerprint, recovered], { successStatus: 'RECOVERED', failureStatuses: ['RECOVERY_FAILED', 'CONFLICT'] });
    if (!written.ok) return result({ ok: false, status: written.status, reason: 'persistence_recovery_failed' });
    return result({ ok: true, status: nextState, attempt_id: attemptId, receipt: canonicalReceipt(recovered, 'ATTEMPT_RECOVERED', 'stale_lease') });
  }

  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    persistence_interface_version: PERSISTENCE_INTERFACE_VERSION,
    logical_atomicity: true,
    production_execution_implemented: false,
    registerAttempt,
    claimAttempt,
    transitionAttempt,
    recoverStaleAttempt
  });
}

module.exports = {
  ATTEMPT_STATES,
  CONTRACT_VERSION,
  FAILURE_STATUSES,
  PERSISTENCE_INTERFACE_VERSION,
  TERMINAL_STATES,
  TRANSITIONS,
  computeAttemptFingerprint,
  createDeterministicExecutionAttemptOwnershipTestStore,
  createExecutionAttemptOwnershipPersistenceInterface,
  createHermesVpsExecutionAttemptOwnershipRegistry
};
