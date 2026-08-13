'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

const CONTRACT_VERSION = 'hermes-vps-shared-durable-coordination-boundary-v1';
const PERSISTENCE_INTERFACE_VERSION = 'hermes-vps-shared-durable-coordination-persistence-v1';
const REFERENCE_ADAPTER_CLAIM = 'REFERENCE_TEST_ONLY';
const COORDINATION_STATES = Object.freeze([
  'CONSISTENT',
  'PARTIALLY_PERSISTED',
  'REPLAY_REQUIRED',
  'RECONCILIATION_REQUIRED',
  'TERMINALLY_REJECTED',
  'UNKNOWN_UNSAFE'
]);
const RESULT_STATUSES = Object.freeze([
  'FIRST_COMMITTED',
  'SAME_RESULT_REPLAY',
  'CONFLICT',
  'STALE',
  'RECONCILIATION_REQUIRED',
  'PERSISTENCE_FAILURE',
  'UNKNOWN_UNSAFE',
  'INVALID'
]);
const REQUIRED_VERSION_FIELDS = Object.freeze(['authorization', 'lifecycle', 'attempt', 'admission']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return computeCanonicalContentDigest(value);
}

function safeResult(value) {
  return Object.freeze({
    ok: value.ok === true,
    status: value.status,
    state: value.state,
    coordination_key: value.coordination_key || null,
    record: value.record ? clone(value.record) : null,
    execution_allowed: false,
    production_effect: 'ZERO',
    reason: value.reason || null
  });
}

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  const expected = new Set(fields);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${prefix}_unknown_field::${key}`);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_field::${field}`);
}

function validDigest(value) {
  return isCanonicalContentDigest(value);
}

function validOwner(value) {
  return isPlainObject(value)
    && isNonEmptyString(value.executor_id)
    && isNonEmptyString(value.executor_type)
    && Object.keys(value).length === 2;
}

function validVersions(value) {
  return isPlainObject(value)
    && REQUIRED_VERSION_FIELDS.every((field) => Number.isInteger(value[field]) && value[field] >= 0)
    && Object.keys(value).length === REQUIRED_VERSION_FIELDS.length;
}

function activeAttemptKey(request) {
  return digest({
    authorization_id: request.authorization.authorization_id,
    scope_key: request.authorization.scope_key,
    plan_version: request.authorization.plan_version,
    plan_hash: request.authorization.plan_hash
  });
}

function admissionReplayKey(request) {
  return digest({
    authorization_id: request.authorization.authorization_id,
    lifecycle_reference_id: request.lifecycle.reference_id,
    attempt_id: request.attempt.attempt_id,
    owner_reference: request.attempt.owner_reference,
    handoff_fingerprint: request.admission.handoff_fingerprint,
    admission_id: request.admission.admission_id
  });
}

function coordinationFingerprintMaterial(request) {
  const copy = clone(request);
  delete copy.coordination_fingerprint;
  return copy;
}

function computeCoordinationFingerprint(request) {
  return digest(coordinationFingerprintMaterial(request));
}

function validateCoordinationRequest(request) {
  const errors = [];
  const topFields = [
    'contract_version', 'authorization', 'lifecycle', 'attempt', 'admission',
    'expected_versions', 'coordination_key', 'replay_key', 'correlation_id',
    'audit_reference', 'receipt_reference', 'coordination_fingerprint',
    'execution_allowed', 'production_effect'
  ];
  exactFields(request, topFields, 'coordination', errors);
  exactFields(request?.authorization, ['authorization_id', 'authorization_hash', 'scope_key', 'plan_version', 'plan_hash'], 'authorization', errors);
  exactFields(request?.lifecycle, ['authorization_id', 'reference_id', 'state', 'fingerprint'], 'lifecycle', errors);
  exactFields(request?.attempt, ['attempt_id', 'attempt_fingerprint', 'authorization_id', 'lifecycle_reference_id', 'state', 'owner_reference'], 'attempt', errors);
  exactFields(request?.admission, ['admission_id', 'admission_fingerprint', 'handoff_fingerprint', 'authorization_id', 'lifecycle_reference_id', 'attempt_id', 'owner_reference', 'state'], 'admission', errors);
  exactFields(request?.expected_versions, REQUIRED_VERSION_FIELDS, 'expected_versions', errors);

  if (request?.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!isNonEmptyString(request?.correlation_id)) errors.push('correlation_id_invalid');
  if (!isNonEmptyString(request?.authorization?.authorization_id)) errors.push('authorization_id_invalid');
  if (!validDigest(request?.authorization?.authorization_hash)) errors.push('authorization_hash_invalid');
  if (!validDigest(request?.authorization?.scope_key)) errors.push('scope_key_invalid');
  if (!isNonEmptyString(request?.authorization?.plan_version)) errors.push('plan_version_invalid');
  if (!validDigest(request?.authorization?.plan_hash)) errors.push('plan_hash_invalid');
  if (request?.lifecycle?.authorization_id !== request?.authorization?.authorization_id) errors.push('lifecycle_authorization_mismatch');
  if (request?.lifecycle?.state !== 'CONSUMED') errors.push('lifecycle_not_consumed');
  if (!isNonEmptyString(request?.lifecycle?.reference_id) || !validDigest(request?.lifecycle?.fingerprint)) errors.push('lifecycle_reference_invalid');
  if (request?.attempt?.authorization_id !== request?.authorization?.authorization_id) errors.push('attempt_authorization_mismatch');
  if (request?.attempt?.lifecycle_reference_id !== request?.lifecycle?.reference_id) errors.push('attempt_lifecycle_mismatch');
  if (request?.attempt?.state !== 'CLAIMED') errors.push('attempt_not_claimed');
  if (!isNonEmptyString(request?.attempt?.attempt_id) || !validDigest(request?.attempt?.attempt_fingerprint) || !validOwner(request?.attempt?.owner_reference)) errors.push('attempt_identity_invalid');
  if (request?.admission?.authorization_id !== request?.authorization?.authorization_id) errors.push('admission_authorization_mismatch');
  if (request?.admission?.lifecycle_reference_id !== request?.lifecycle?.reference_id) errors.push('admission_lifecycle_mismatch');
  if (request?.admission?.attempt_id !== request?.attempt?.attempt_id) errors.push('admission_attempt_mismatch');
  if (JSON.stringify(request?.admission?.owner_reference) !== JSON.stringify(request?.attempt?.owner_reference)) errors.push('admission_owner_mismatch');
  if (request?.admission?.state !== 'ADMITTED') errors.push('admission_not_admitted');
  if (!isNonEmptyString(request?.admission?.admission_id) || !validDigest(request?.admission?.admission_fingerprint) || !validDigest(request?.admission?.handoff_fingerprint) || !validOwner(request?.admission?.owner_reference)) errors.push('admission_identity_invalid');
  if (!validVersions(request?.expected_versions)) errors.push('expected_versions_invalid');
  if (request?.coordination_key !== activeAttemptKey(request)) errors.push('coordination_key_invalid');
  if (request?.replay_key !== admissionReplayKey(request)) errors.push('replay_key_invalid');
  if (!validDigest(request?.audit_reference) || request?.audit_reference !== digest({ event: 'ADMISSION_COORDINATION', coordination_key: request?.coordination_key, replay_key: request?.replay_key, correlation_id: request?.correlation_id })) errors.push('audit_reference_invalid');
  if (request?.receipt_reference !== request?.coordination_key) errors.push('receipt_reference_invalid');
  if (request?.execution_allowed !== false) errors.push('execution_must_remain_false');
  if (request?.production_effect !== 'ZERO') errors.push('production_effect_must_remain_zero');
  if (!validDigest(request?.coordination_fingerprint) || computeCoordinationFingerprint(request) !== request?.coordination_fingerprint) errors.push('coordination_fingerprint_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildHermesVpsCoordinationRequest(input = {}) {
  const request = {
    contract_version: CONTRACT_VERSION,
    authorization: clone(input.authorization),
    lifecycle: clone(input.lifecycle),
    attempt: clone(input.attempt),
    admission: clone(input.admission),
    expected_versions: clone(input.expected_versions || { authorization: 0, lifecycle: 0, attempt: 0, admission: 0 }),
    coordination_key: null,
    replay_key: null,
    correlation_id: input.correlation_id,
    audit_reference: null,
    receipt_reference: null,
    coordination_fingerprint: null,
    execution_allowed: false,
    production_effect: 'ZERO'
  };
  request.coordination_key = activeAttemptKey(request);
  request.replay_key = admissionReplayKey(request);
  request.audit_reference = digest({ event: 'ADMISSION_COORDINATION', coordination_key: request.coordination_key, replay_key: request.replay_key, correlation_id: request.correlation_id });
  request.receipt_reference = request.coordination_key;
  request.coordination_fingerprint = computeCoordinationFingerprint(request);
  return Object.freeze(request);
}

function createHermesVpsSharedDurableCoordinationPersistenceInterface({ atomicCoordinate } = {}) {
  if (typeof atomicCoordinate !== 'function') throw new Error('coordination_persistence_interface_incomplete');
  return Object.freeze({
    interface_version: PERSISTENCE_INTERFACE_VERSION,
    atomicCoordinate
  });
}

function coordinationRecord(request, state = 'CONSISTENT') {
  return {
    contract_version: CONTRACT_VERSION,
    state,
    coordination_key: request.coordination_key,
    replay_key: request.replay_key,
    coordination_fingerprint: request.coordination_fingerprint,
    authorization: clone(request.authorization),
    lifecycle: clone(request.lifecycle),
    attempt: clone(request.attempt),
    admission: clone(request.admission),
    expected_versions: clone(request.expected_versions),
    correlation_id: request.correlation_id,
    audit_reference: request.audit_reference,
    receipt_reference: request.receipt_reference,
    execution_allowed: false,
    production_effect: 'ZERO'
  };
}

function createDeterministicHermesVpsSharedDurableCoordinationTestStore({ snapshot } = {}) {
  const records = new Map();
  const activeAttempts = new Map();
  let failureMode = null;

  function restore(value) {
    if (!isPlainObject(value) || !Array.isArray(value.records)) return false;
    records.clear();
    activeAttempts.clear();
    for (const record of value.records) {
      if (!isPlainObject(record) || !isNonEmptyString(record.coordination_key)) return false;
      if (!['CONSISTENT', 'PARTIALLY_PERSISTED', 'RECONCILIATION_REQUIRED', 'TERMINALLY_REJECTED', 'UNKNOWN_UNSAFE'].includes(record.state)) return false;
      if (record.state === 'CONSISTENT' && (!isPlainObject(record.attempt) || !isNonEmptyString(record.attempt.attempt_id) || record.execution_allowed !== false || record.production_effect !== 'ZERO')) return false;
      records.set(record.coordination_key, clone(record));
      if (record.state === 'CONSISTENT') activeAttempts.set(record.coordination_key, record.attempt.attempt_id);
    }
    return true;
  }

  if (snapshot && !restore(snapshot)) throw new Error('coordination_snapshot_invalid');

  function atomicCoordinate(request) {
    const validation = validateCoordinationRequest(request);
    if (!validation.valid) return safeResult({ ok: false, status: 'INVALID', state: 'TERMINALLY_REJECTED', coordination_key: request?.coordination_key, reason: validation.errors.join(',') });
    if (failureMode === 'THROW') throw new Error('coordination_persistence_unavailable');
    if (failureMode === 'UNKNOWN_BEFORE_WRITE') return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'outcome_unknown_before_write' });
    const existing = records.get(request.coordination_key);
    if (existing) {
      if (existing.state === 'CONSISTENT' && existing.coordination_fingerprint === request.coordination_fingerprint) {
        if (failureMode === 'UNKNOWN_ON_REPLAY') return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'replay_outcome_unknown' });
        return safeResult({ ok: true, status: 'SAME_RESULT_REPLAY', state: 'CONSISTENT', coordination_key: request.coordination_key, record: existing });
      }
      if (existing.state === 'PARTIALLY_PERSISTED') return safeResult({ ok: false, status: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED', coordination_key: request.coordination_key, record: existing, reason: 'partial_record_requires_reconciliation' });
      return safeResult({ ok: false, status: 'CONFLICT', state: 'TERMINALLY_REJECTED', coordination_key: request.coordination_key, record: existing, reason: 'coordination_fingerprint_conflict' });
    }
    if (Object.values(request.expected_versions).some((version) => version > 0)) return safeResult({ ok: false, status: 'STALE', state: 'TERMINALLY_REJECTED', coordination_key: request.coordination_key, reason: 'stale_expected_version' });
    const activeOwner = activeAttempts.get(request.coordination_key);
    if (activeOwner && activeOwner !== request.attempt.attempt_id) return safeResult({ ok: false, status: 'CONFLICT', state: 'TERMINALLY_REJECTED', coordination_key: request.coordination_key, reason: 'active_attempt_conflict' });
    if (failureMode === 'PARTIAL_WRITE') {
      const partial = coordinationRecord(request, 'PARTIALLY_PERSISTED');
      records.set(request.coordination_key, partial);
      return safeResult({ ok: false, status: 'PERSISTENCE_FAILURE', state: 'PARTIALLY_PERSISTED', coordination_key: request.coordination_key, record: partial, reason: 'partial_write' });
    }
    const committed = coordinationRecord(request);
    records.set(request.coordination_key, committed);
    activeAttempts.set(request.coordination_key, request.attempt.attempt_id);
    if (failureMode === 'UNKNOWN_AFTER_COMMIT') return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'commit_acknowledgement_lost' });
    return safeResult({ ok: true, status: 'FIRST_COMMITTED', state: 'CONSISTENT', coordination_key: request.coordination_key, record: committed });
  }

  return {
    ...createHermesVpsSharedDurableCoordinationPersistenceInterface({ atomicCoordinate }),
    durability_claim: REFERENCE_ADAPTER_CLAIM,
    configureFailure: (mode) => { failureMode = mode || null; },
    inspect: (key) => records.has(key) ? clone(records.get(key)) : null,
    exportSnapshot: () => ({ records: [...records.values()].map(clone) }),
    restoreSnapshot: restore
  };
}

function validatePersistenceResult(raw, request) {
  if (!isPlainObject(raw) || typeof raw.ok !== 'boolean' || !RESULT_STATUSES.includes(raw.status) || !COORDINATION_STATES.includes(raw.state) || raw.execution_allowed !== false || raw.production_effect !== 'ZERO' || raw.coordination_key !== request.coordination_key) return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'malformed_persistence_result' });
  if (['FIRST_COMMITTED', 'SAME_RESULT_REPLAY'].includes(raw.status)) {
    if (raw.ok !== true || raw.state !== 'CONSISTENT' || !isPlainObject(raw.record) || raw.record.coordination_fingerprint !== request.coordination_fingerprint || raw.record.execution_allowed !== false || raw.record.production_effect !== 'ZERO') return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'contradictory_persistence_result' });
  }
  if (raw.ok && !['FIRST_COMMITTED', 'SAME_RESULT_REPLAY'].includes(raw.status)) return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'unexpected_success_status' });
  return safeResult(raw);
}

function coordinateHermesVpsExecutionState({ request, persistence } = {}) {
  const validation = validateCoordinationRequest(request);
  if (!validation.valid) return safeResult({ ok: false, status: 'INVALID', state: 'TERMINALLY_REJECTED', coordination_key: request?.coordination_key, reason: validation.errors.join(',') });
  if (!persistence || persistence.interface_version !== PERSISTENCE_INTERFACE_VERSION || typeof persistence.atomicCoordinate !== 'function') return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'atomic_coordination_persistence_required' });
  try {
    return validatePersistenceResult(persistence.atomicCoordinate(request), request);
  } catch {
    return safeResult({ ok: false, status: 'UNKNOWN_UNSAFE', state: 'UNKNOWN_UNSAFE', coordination_key: request.coordination_key, reason: 'persistence_exception' });
  }
}

module.exports = {
  CONTRACT_VERSION,
  COORDINATION_STATES,
  PERSISTENCE_INTERFACE_VERSION,
  REFERENCE_ADAPTER_CLAIM,
  RESULT_STATUSES,
  buildHermesVpsCoordinationRequest,
  computeCoordinationFingerprint,
  createDeterministicHermesVpsSharedDurableCoordinationTestStore,
  createHermesVpsSharedDurableCoordinationPersistenceInterface,
  coordinateHermesVpsExecutionState,
  validateCoordinationRequest
};
