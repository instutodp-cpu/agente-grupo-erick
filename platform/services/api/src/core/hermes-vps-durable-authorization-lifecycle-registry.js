'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  computeLifecycleFingerprint,
  createHermesVpsAuthorizationLifecycleRegistry
} = require('./hermes-vps-authorization-lifecycle-registry');
const {
  validateHermesVpsExecutionAuthorizationContract
} = require('./hermes-vps-execution-authorization-contract');
const { validateHermesVpsProvisioningPlan } = require('./hermes-vps-provisioning-plan');

const DURABLE_REGISTRY_VERSION = 'hermes-vps-durable-authorization-lifecycle-registry-v1';
const PERSISTENCE_INTERFACE_VERSION = 'hermes-vps-authorization-lifecycle-persistence-v1';
const PERSISTENCE_FAILURES = Object.freeze(['READ_FAILED', 'WRITE_FAILED', 'ATOMICITY_FAILED', 'RECOVERY_FAILED']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function result(value) {
  return Object.freeze(clone(value));
}

function digest(value) {
  return computeCanonicalContentDigest(JSON.parse(stablePayload(value)));
}

function receipt(entry, event, referenceId) {
  const material = {
    contract_version: DURABLE_REGISTRY_VERSION,
    event,
    authorization_id: entry.authorization_id,
    authorization_hash: entry.authorization.authorization_hash,
    provisioning_plan_version: entry.authorization.provisioning_plan_reference.plan_version,
    provisioning_plan_hash: entry.authorization.provisioning_plan_hash,
    execution_scope: entry.authorization.execution_scope,
    lifecycle_state: entry.state,
    reference_id: referenceId,
    sequence: entry.sequence
  };
  return {
    contract_version: DURABLE_REGISTRY_VERSION,
    event,
    authorization_id: entry.authorization_id,
    lifecycle_state: entry.state,
    sequence: entry.sequence,
    fingerprint: computeLifecycleFingerprint(entry),
    receipt_hash: digest(material),
    execution_performed: false,
    production_effect: 'ZERO'
  };
}

function validPlan(plan) {
  return Boolean(plan && validateHermesVpsProvisioningPlan(plan).valid && isCanonicalContentDigest(plan.plan_hash));
}

function validateAuthorization(authorization, plan) {
  try {
    return validateHermesVpsExecutionAuthorizationContract(authorization, plan);
  } catch {
    return { valid: false, errors: ['authorization_malformed'] };
  }
}

function validateEntry(entry, plan) {
  if (!isPlainObject(entry) || !isNonEmptyString(entry.authorization_id) || !isPlainObject(entry.authorization)) return false;
  if (entry.authorization.authorization_id !== entry.authorization_id) return false;
  if (!['REGISTERED', 'CONSUMED', 'REVOKED'].includes(entry.state)) return false;
  if (!Number.isInteger(entry.sequence) || entry.sequence < 0) return false;
  if (!validateAuthorization(entry.authorization, plan).valid) return false;
  if (entry.state === 'CONSUMED' && (!isPlainObject(entry.consumption_reference) || entry.consumption_reference.authorization_id !== entry.authorization_id)) return false;
  if (entry.state !== 'CONSUMED' && entry.consumption_reference !== null) return false;
  if (entry.state === 'REVOKED' && (!isPlainObject(entry.revocation_reference) || entry.revocation_reference.authorization_id !== entry.authorization_id)) return false;
  if (entry.state !== 'REVOKED' && entry.revocation_reference !== null) return false;
  return entry.fingerprint === computeLifecycleFingerprint(entry);
}

function createAuthorizationLifecyclePersistenceInterface({ read, insert, compareAndConsume, revoke }) {
  if (![read, insert, compareAndConsume, revoke].every((method) => typeof method === 'function')) throw new Error('persistence_interface_incomplete');
  return Object.freeze({
    interface_version: PERSISTENCE_INTERFACE_VERSION,
    read,
    insert,
    compareAndConsume,
    revoke
  });
}

function createDeterministicDurableLifecycleTestStore() {
  const records = new Map();
  const failures = new Set();
  let loseResponseAfterCommit = false;

  function failIfConfigured(operation) {
    if (!failures.has(operation)) return null;
    return result({ ok: false, status: PERSISTENCE_FAILURES.includes(operation) ? operation : 'WRITE_FAILED', error: `${operation.toLowerCase()}_simulated` });
  }

  const store = createAuthorizationLifecyclePersistenceInterface({
    read: (authorizationId) => {
      const failure = failIfConfigured('READ_FAILED');
      if (failure) return failure;
      const entry = records.get(authorizationId);
      return result({ ok: true, status: 'READ', entry: entry ? clone(entry) : null });
    },
    insert: (entry) => {
      const failure = failIfConfigured('WRITE_FAILED');
      if (failure) return failure;
      if (records.has(entry.authorization_id)) return result({ ok: false, status: 'CONFLICT', error: 'authorization_id_already_exists' });
      records.set(entry.authorization_id, clone(entry));
      return result({ ok: true, status: 'INSERTED', entry: clone(entry) });
    },
    compareAndConsume: (authorizationId, expectedFingerprint, consumedEntry) => {
      const failure = failIfConfigured('ATOMICITY_FAILED');
      if (failure) return failure;
      const current = records.get(authorizationId);
      if (!current) return result({ ok: false, status: 'NOT_AUTHORIZED' });
      if (current.fingerprint !== expectedFingerprint) return result({ ok: false, status: 'CONFLICT', entry: clone(current) });
      records.set(authorizationId, clone(consumedEntry));
      const committed = result({ ok: true, status: 'CONSUMED', entry: clone(consumedEntry) });
      if (loseResponseAfterCommit) {
        loseResponseAfterCommit = false;
        return result({ ok: false, status: 'WRITE_FAILED', error: 'response_lost_after_commit' });
      }
      return committed;
    },
    revoke: (authorizationId, expectedFingerprint, revokedEntry) => {
      const failure = failIfConfigured('WRITE_FAILED');
      if (failure) return failure;
      const current = records.get(authorizationId);
      if (!current || current.fingerprint !== expectedFingerprint) return result({ ok: false, status: 'CONFLICT', entry: current ? clone(current) : null });
      records.set(authorizationId, clone(revokedEntry));
      return result({ ok: true, status: 'REVOKED', entry: clone(revokedEntry) });
    }
  });

  return Object.freeze({
    ...store,
    configureFailure: (failure, enabled = true) => { if (enabled) failures.add(failure); else failures.delete(failure); },
    configureLostResponseAfterCommit: (enabled = true) => { loseResponseAfterCommit = enabled; },
    inspect: (authorizationId) => records.has(authorizationId) ? clone(records.get(authorizationId)) : null
  });
}

function createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan, persistence }) {
  if (!validPlan(provisioning_plan)) throw new Error('provisioning_plan_invalid');
  if (!persistence || persistence.interface_version !== PERSISTENCE_INTERFACE_VERSION) throw new Error('persistence_interface_invalid');

  function registerAuthorization(authorization) {
    if (!isPlainObject(authorization) || !isNonEmptyString(authorization.authorization_id) || !validateAuthorization(authorization, provisioning_plan).valid) return result({ ok: false, status: 'INVALID', reason: 'authorization_invalid' });
    const initial = {
      authorization_id: authorization.authorization_id,
      authorization: clone(authorization),
      state: 'REGISTERED',
      consumption_reference: null,
      revocation_reference: null,
      sequence: 0,
      fingerprint: 'pending'
    };
    initial.fingerprint = computeLifecycleFingerprint(initial);
    const existing = persistence.read(initial.authorization_id);
    if (!existing.ok) return result({ ok: false, status: existing.status, reason: 'persistence_read_failed' });
    if (existing.entry) return existing.entry.fingerprint === initial.fingerprint ? result({ ok: true, status: 'REPLAY_ACCEPTED', receipt: receipt(existing.entry, 'REGISTER', null) }) : result({ ok: false, status: 'CONFLICT', reason: 'authorization_id_reuse_or_payload_mismatch' });
    const inserted = persistence.insert(initial);
    if (!inserted.ok) return result({ ok: false, status: inserted.status, reason: 'persistence_write_failed' });
    return result({ ok: true, status: 'REGISTERED', authorization_id: initial.authorization_id, receipt: receipt(initial, 'REGISTER', null) });
  }

  function consumeAuthorization(authorizationId, context = {}) {
    const read = persistence.read(authorizationId);
    if (!read.ok) return result({ ok: false, status: read.status, reason: 'persistence_read_failed' });
    if (!read.entry) return result({ ok: false, status: 'NOT_AUTHORIZED', reason: 'authorization_missing' });
    const current = read.entry;
    if (!validateEntry(current, provisioning_plan)) return result({ ok: false, status: 'INVALID', reason: 'persisted_entry_invalid' });
    if (current.state === 'CONSUMED') return result({ ok: false, status: 'ALREADY_CONSUMED', receipt: receipt(current, 'REPLAY_BLOCKED', current.consumption_reference.reference_id) });
    if (current.state === 'REVOKED') return result({ ok: false, status: 'REVOKED', reason: 'authorization_revoked' });
    const logical = createHermesVpsAuthorizationLifecycleRegistry({ provisioning_plan });
    const registration = logical.registerAuthorization(current.authorization);
    if (!registration.ok) return result({ ok: false, status: 'INVALID', reason: 'authorization_invalid' });
    const evaluated = logical.consumeAuthorization(authorizationId, context);
    if (!evaluated.ok) return evaluated;
    const consumed = {
      ...current,
      state: 'CONSUMED',
      sequence: current.sequence + 1,
      consumption_reference: { authorization_id: authorizationId, reference_id: context.reference_id || `consume::${authorizationId}::${current.sequence + 1}` },
      fingerprint: 'pending'
    };
    consumed.fingerprint = computeLifecycleFingerprint(consumed);
    const written = persistence.compareAndConsume(authorizationId, current.fingerprint, consumed);
    if (!written.ok) {
      if (written.status === 'CONFLICT' && written.entry?.state === 'CONSUMED') return result({ ok: false, status: 'ALREADY_CONSUMED', reason: 'concurrent_consume_lost' });
      return result({ ok: false, status: written.status, reason: 'persistence_atomic_consume_failed' });
    }
    return result({ ok: true, status: 'AUTHORIZED', authorization_id: authorizationId, receipt: receipt(consumed, 'CONSUME', consumed.consumption_reference.reference_id) });
  }

  function revokeAuthorization(authorizationId, referenceId) {
    const read = persistence.read(authorizationId);
    if (!read.ok) return result({ ok: false, status: read.status, reason: 'persistence_read_failed' });
    if (!read.entry) return result({ ok: false, status: 'NOT_AUTHORIZED' });
    const current = read.entry;
    if (!validateEntry(current, provisioning_plan)) return result({ ok: false, status: 'INVALID', reason: 'persisted_entry_invalid' });
    if (current.state === 'CONSUMED') return result({ ok: false, status: 'ALREADY_CONSUMED' });
    if (current.state === 'REVOKED') return result({ ok: false, status: 'REVOKED' });
    if (!isNonEmptyString(referenceId)) return result({ ok: false, status: 'INVALID', reason: 'revocation_reference_required' });
    const revoked = { ...current, state: 'REVOKED', sequence: current.sequence + 1, revocation_reference: { authorization_id: authorizationId, reference_id: referenceId }, fingerprint: 'pending' };
    revoked.fingerprint = computeLifecycleFingerprint(revoked);
    const written = persistence.revoke(authorizationId, current.fingerprint, revoked);
    if (!written.ok) return result({ ok: false, status: written.status, reason: 'persistence_write_failed' });
    return result({ ok: true, status: 'REVOKED', authorization_id: authorizationId, receipt: receipt(revoked, 'REVOKE', referenceId) });
  }

  return Object.freeze({
    registry_version: DURABLE_REGISTRY_VERSION,
    persistence_interface_version: PERSISTENCE_INTERFACE_VERSION,
    logical_atomicity: true,
    durable_semantics_contract: true,
    production_persistence_implemented: false,
    registerAuthorization,
    consumeAuthorization,
    revokeAuthorization
  });
}

module.exports = {
  DURABLE_REGISTRY_VERSION,
  PERSISTENCE_FAILURES,
  PERSISTENCE_INTERFACE_VERSION,
  createAuthorizationLifecyclePersistenceInterface,
  createDeterministicDurableLifecycleTestStore,
  createHermesVpsDurableAuthorizationLifecycleRegistry
};
