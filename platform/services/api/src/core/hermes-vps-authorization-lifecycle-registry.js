'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  evaluateHermesVpsExecutionAuthorization,
  validateHermesVpsExecutionAuthorizationContract
} = require('./hermes-vps-execution-authorization-contract');
const { validateHermesVpsProvisioningPlan } = require('./hermes-vps-provisioning-plan');

const REGISTRY_VERSION = 'hermes-vps-authorization-lifecycle-registry-v1';
const REGISTRY_MODE = 'IN_MEMORY_CONTRACT_ONLY';
const LIFECYCLE_STATES = Object.freeze(['REGISTERED', 'CONSUMED', 'REVOKED']);
const RESULT_STATUSES = Object.freeze([
  'REGISTERED', 'REPLAY_ACCEPTED', 'AUTHORIZED', 'ALREADY_CONSUMED', 'REVOKED',
  'EXPIRED', 'PLAN_MISMATCH', 'SCOPE_MISMATCH', 'NOT_AUTHORIZED', 'INVALID', 'CONFLICT'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeResult(value) {
  return Object.freeze(clone(value));
}

function canonicalDigest(value) {
  return computeCanonicalContentDigest(JSON.parse(stablePayload(value)));
}

function lifecycleMaterial(entry) {
  return {
    registry_version: REGISTRY_VERSION,
    authorization_id: entry.authorization_id,
    authorization_hash: entry.authorization.authorization_hash,
    provisioning_plan_version: entry.authorization.provisioning_plan_reference.plan_version,
    provisioning_plan_hash: entry.authorization.provisioning_plan_hash,
    execution_scope: entry.authorization.execution_scope,
    state: entry.state,
    consumption_reference: entry.consumption_reference,
    revocation_reference: entry.revocation_reference,
    sequence: entry.sequence
  };
}

function computeLifecycleFingerprint(entry) {
  return canonicalDigest(lifecycleMaterial(entry));
}

function receipt(entry, event, referenceId) {
  const material = {
    registry_version: REGISTRY_VERSION,
    event,
    authorization_id: entry.authorization_id,
    authorization_hash: entry.authorization.authorization_hash,
    provisioning_plan_hash: entry.authorization.provisioning_plan_hash,
    execution_scope: entry.authorization.execution_scope,
    state: entry.state,
    reference_id: referenceId,
    sequence: entry.sequence
  };
  return {
    contract_version: REGISTRY_VERSION,
    event,
    authorization_id: entry.authorization_id,
    state: entry.state,
    sequence: entry.sequence,
    fingerprint: computeLifecycleFingerprint(entry),
    receipt_hash: canonicalDigest(material),
    production_effect: 'ZERO'
  };
}

function forbiddenSecretMaterial(value, path = 'value') {
  if (Array.isArray(value)) return value.some((item, index) => forbiddenSecretMaterial(item, `${path}[${index}]`));
  if (!isPlainObject(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (/password|token|api[_-]?key|private[_-]?key|cookie|authorization[_-]?header/i.test(key)) return true;
    if (forbiddenSecretMaterial(child, `${path}.${key}`)) return true;
  }
  return false;
}

function validatePlan(plan) {
  if (!plan || !validateHermesVpsProvisioningPlan(plan).valid) return false;
  return isNonEmptyString(plan.plan_version) && isCanonicalContentDigest(plan.plan_hash);
}

function validateAuthorization(authorization, provisioningPlan) {
  try {
    return validateHermesVpsExecutionAuthorizationContract(authorization, provisioningPlan);
  } catch {
    return { valid: false, errors: ['authorization_malformed'] };
  }
}

function validateEntry(entry, provisioningPlan) {
  if (!isPlainObject(entry) || !isNonEmptyString(entry.authorization_id) || !LIFECYCLE_STATES.includes(entry.state)) return false;
  if (!Number.isInteger(entry.sequence) || entry.sequence < 0) return false;
  if (!isPlainObject(entry.authorization) || entry.authorization.authorization_id !== entry.authorization_id) return false;
  if (forbiddenSecretMaterial(entry)) return false;
  const validation = validateAuthorization(entry.authorization, provisioningPlan);
  if (!validation.valid) return false;
  if (entry.state === 'CONSUMED' && !isPlainObject(entry.consumption_reference)) return false;
  if (entry.state !== 'CONSUMED' && entry.consumption_reference !== null) return false;
  if (entry.state === 'REVOKED' && !isPlainObject(entry.revocation_reference)) return false;
  if (entry.state !== 'REVOKED' && entry.revocation_reference !== null) return false;
  for (const reference of [entry.consumption_reference, entry.revocation_reference]) {
    if (reference && (reference.authorization_id !== entry.authorization_id || !isNonEmptyString(reference.reference_id))) return false;
  }
  return entry.fingerprint === computeLifecycleFingerprint(entry);
}

function createHermesVpsAuthorizationLifecycleRegistry({ provisioning_plan } = {}) {
  const entries = new Map();
  if (!validatePlan(provisioning_plan)) throw new Error('provisioning_plan_invalid');

  function registerAuthorization(authorization) {
    if (!isPlainObject(authorization) || !isNonEmptyString(authorization.authorization_id)) return safeResult({ ok: false, status: 'INVALID', reason: 'authorization_id_required' });
    if (forbiddenSecretMaterial(authorization)) return safeResult({ ok: false, status: 'INVALID', reason: 'secret_material_forbidden' });
    if (!validateAuthorization(authorization, provisioning_plan).valid) return safeResult({ ok: false, status: 'INVALID', reason: 'authorization_invalid' });
    const id = authorization.authorization_id;
    const existing = entries.get(id);
    if (existing) {
      if (existing.authorization.authorization_hash === authorization.authorization_hash && stablePayload(existing.authorization) === stablePayload(authorization)) {
        return safeResult({ ok: true, status: 'REPLAY_ACCEPTED', authorization_id: id, fingerprint: existing.fingerprint });
      }
      return safeResult({ ok: false, status: 'CONFLICT', reason: 'authorization_id_reuse_or_payload_mismatch' });
    }
    const entry = {
      authorization_id: id,
      authorization: clone(authorization),
      state: 'REGISTERED',
      consumption_reference: null,
      revocation_reference: null,
      sequence: 0,
      fingerprint: 'pending'
    };
    entry.fingerprint = computeLifecycleFingerprint(entry);
    entries.set(id, entry);
    return safeResult({ ok: true, status: 'REGISTERED', authorization_id: id, fingerprint: entry.fingerprint, receipt: receipt(entry, 'REGISTER', null) });
  }

  function consumeAuthorization(authorizationId, context = {}) {
    const entry = entries.get(authorizationId);
    if (!entry) return safeResult({ ok: false, status: 'NOT_AUTHORIZED', reason: 'authorization_missing' });
    if (entry.state === 'CONSUMED') return safeResult({ ok: false, status: 'ALREADY_CONSUMED', reason: 'single_use_already_consumed', receipt: receipt(entry, 'REPLAY_BLOCKED', entry.consumption_reference.reference_id) });
    if (entry.state === 'REVOKED') return safeResult({ ok: false, status: 'REVOKED', reason: 'authorization_revoked' });
    if (context.authorization_id !== undefined && context.authorization_id !== authorizationId) return safeResult({ ok: false, status: 'INVALID', reason: 'authorization_id_mismatch' });
    if (!isPlainObject(context.execution_scope)) return safeResult({ ok: false, status: 'INVALID', reason: 'execution_scope_required' });
    if (!isNonEmptyString(context.execution_scope.phase_id) || !isNonEmptyString(context.execution_scope.step_id)) return safeResult({ ok: false, status: 'SCOPE_MISMATCH', reason: 'execution_scope_invalid' });
    if (context.provisioning_plan_hash !== undefined && context.provisioning_plan_hash !== provisioning_plan.plan_hash) return safeResult({ ok: false, status: 'PLAN_MISMATCH', reason: 'provisioning_plan_hash_mismatch' });
    const result = evaluateHermesVpsExecutionAuthorization(entry.authorization, {
      provisioning_plan,
      execution_scope: context.execution_scope,
      now: context.now
    });
    if (result.status === 'PLAN_MISMATCH' && result.reason === 'execution_scope_mismatch') return safeResult({ ok: false, status: 'SCOPE_MISMATCH', reason: result.reason });
    if (result.status !== 'AUTHORIZED') return safeResult({ ok: false, status: result.status, reason: result.reason });
    const referenceId = context.reference_id || `consume::${authorizationId}::${entry.sequence + 1}`;
    entry.state = 'CONSUMED';
    entry.sequence += 1;
    entry.consumption_reference = { authorization_id: authorizationId, reference_id: referenceId };
    entry.fingerprint = computeLifecycleFingerprint(entry);
    return safeResult({ ok: true, status: 'AUTHORIZED', authorization_id: authorizationId, receipt: receipt(entry, 'CONSUME', referenceId) });
  }

  function revokeAuthorization(authorizationId, referenceId = `revoke::${authorizationId}::1`) {
    const entry = entries.get(authorizationId);
    if (!entry) return safeResult({ ok: false, status: 'NOT_AUTHORIZED', reason: 'authorization_missing' });
    if (entry.state === 'CONSUMED') return safeResult({ ok: false, status: 'ALREADY_CONSUMED', reason: 'consumed_authorization_cannot_be_revoked' });
    if (entry.state === 'REVOKED') return safeResult({ ok: false, status: 'REVOKED', reason: 'authorization_already_revoked' });
    if (!isNonEmptyString(referenceId)) return safeResult({ ok: false, status: 'INVALID', reason: 'revocation_reference_required' });
    entry.state = 'REVOKED';
    entry.sequence += 1;
    entry.revocation_reference = { authorization_id: authorizationId, reference_id: referenceId };
    entry.fingerprint = computeLifecycleFingerprint(entry);
    return safeResult({ ok: true, status: 'REVOKED', authorization_id: authorizationId, receipt: receipt(entry, 'REVOKE', referenceId) });
  }

  function getAuthorizationState(authorizationId) {
    const entry = entries.get(authorizationId);
    return entry ? safeResult({ authorization_id: entry.authorization_id, state: entry.state, fingerprint: entry.fingerprint }) : null;
  }

  function exportLogicalSnapshot() {
    const snapshot = { registry_version: REGISTRY_VERSION, mode: REGISTRY_MODE, entries: [...entries.values()].sort((a, b) => a.authorization_id.localeCompare(b.authorization_id)) };
    return safeResult({ ...snapshot, snapshot_hash: canonicalDigest(snapshot) });
  }

  function restoreLogicalSnapshot(snapshot) {
    if (!isPlainObject(snapshot) || snapshot.registry_version !== REGISTRY_VERSION || snapshot.mode !== REGISTRY_MODE || !Array.isArray(snapshot.entries) || !isCanonicalContentDigest(snapshot.snapshot_hash)) return safeResult({ ok: false, status: 'INVALID', reason: 'snapshot_invalid' });
    const material = { registry_version: snapshot.registry_version, mode: snapshot.mode, entries: snapshot.entries };
    if (snapshot.snapshot_hash !== canonicalDigest(material)) return safeResult({ ok: false, status: 'INVALID', reason: 'snapshot_hash_invalid' });
    const candidate = new Map();
    for (const entry of snapshot.entries) {
      if (candidate.has(entry?.authorization_id) || !validateEntry(entry, provisioning_plan)) return safeResult({ ok: false, status: 'INVALID', reason: 'snapshot_entry_invalid_or_ambiguous' });
      candidate.set(entry.authorization_id, clone(entry));
    }
    entries.clear();
    for (const [id, entry] of candidate) entries.set(id, entry);
    return safeResult({ ok: true, status: 'RESTORED_IN_MEMORY_SNAPSHOT', entries: entries.size });
  }

  return Object.freeze({
    registry_version: REGISTRY_VERSION,
    mode: REGISTRY_MODE,
    logical_atomicity: true,
    durable_distributed_atomicity: false,
    registerAuthorization,
    consumeAuthorization,
    revokeAuthorization,
    getAuthorizationState,
    exportLogicalSnapshot,
    restoreLogicalSnapshot
  });
}

module.exports = {
  LIFECYCLE_STATES,
  REGISTRY_MODE,
  REGISTRY_VERSION,
  RESULT_STATUSES,
  computeLifecycleFingerprint,
  createHermesVpsAuthorizationLifecycleRegistry
};
