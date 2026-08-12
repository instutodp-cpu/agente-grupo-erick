'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  invokePersistence
} = require('./hermes-vps-execution-attempt-ownership-contract');
const { isTrustedDurableAtomicAdmissionAdapter } = require('./hermes-vps-trusted-durable-admission-adapter');

const CONTRACT_VERSION = 'hermes-vps-execution-handoff-contract-v1';
const RESULT_CONTRACT_VERSION = 'hermes-vps-execution-result-envelope-v1';
const HANDOFF_PERSISTENCE_INTERFACE_VERSION = 'hermes-vps-execution-handoff-admission-persistence-v1';
const HANDOFF_STATES = Object.freeze(['OWNERSHIP_VALIDATED', 'ADMITTED', 'REJECTED', 'UNKNOWN_OUTCOME']);
const ADMISSION_STATUSES = Object.freeze(['ADMITTED', 'FIRST_ADMISSION', 'SAME_RESULT_REPLAY', 'EXACT_REPLAY', 'REJECTED', 'CONFLICTING_REPLAY', 'ADMISSION_CONFLICT']);
const REJECTION_CODES = Object.freeze([
  'HANDOFF_INVALID', 'VERSION_UNSUPPORTED', 'AUTHORIZATION_MISMATCH', 'PLAN_MISMATCH',
  'SCOPE_MISMATCH', 'ATTEMPT_MISMATCH', 'OWNER_MISMATCH', 'OWNERSHIP_INVALID',
  'LIFECYCLE_MISMATCH', 'LIFECYCLE_NOT_CONSUMED', 'LIFECYCLE_TERMINAL',
  'ADMISSION_MISMATCH', 'OPERATION_MISMATCH', 'ISOLATION_MISMATCH',
  'FINGERPRINT_MISMATCH', 'REPLAY_CONFLICT', 'RESULT_INVALID'
]);
const RESULT_STATUSES = Object.freeze(['ADMITTED_NO_EXECUTION', 'REJECTED_BEFORE_EXECUTION', 'EXECUTION_SUCCEEDED', 'EXECUTION_FAILED', 'EXECUTION_UNKNOWN']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function digest(value) {
  return computeCanonicalContentDigest(JSON.parse(stablePayload(value)));
}

function exactFields(value, fields) {
  if (!isPlainObject(value)) return false;
  const expected = new Set(fields);
  return Object.keys(value).every((key) => expected.has(key)) && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field) && value[field] !== undefined);
}

function validDigest(value) {
  return isCanonicalContentDigest(value);
}

function validScope(value) {
  return exactFields(value, ['phase_id', 'step_id']) && isNonEmptyString(value.phase_id) && isNonEmptyString(value.step_id);
}

function validOwner(value) {
  return exactFields(value, ['executor_id', 'executor_type']) && isNonEmptyString(value.executor_id) && isNonEmptyString(value.executor_type);
}

function validLifecycle(value) {
  return exactFields(value, ['authorization_id', 'reference_id', 'state'])
    && isNonEmptyString(value.authorization_id)
    && isNonEmptyString(value.reference_id)
    && value.state === 'CONSUMED';
}

function validIsolation(value) {
  return exactFields(value, ['tenant_id', 'company_id', 'scope_id'])
    && [value.tenant_id, value.company_id, value.scope_id].every(isNonEmptyString);
}

function validOperation(value) {
  return exactFields(value, ['operation_id', 'operation_type'])
    && isNonEmptyString(value.operation_id)
    && isNonEmptyString(value.operation_type);
}

function validAdmissionReference(value) {
  return exactFields(value, ['admission_id', 'admission_fingerprint', 'state'])
    && isNonEmptyString(value.admission_id)
    && validDigest(value.admission_fingerprint)
    && value.state === 'OWNERSHIP_VALIDATED';
}

function canonicalBindingMaterial(evidence) {
  return {
    contract_version: CONTRACT_VERSION,
    authorization: {
      authorization_id: evidence.authorization.authorization_id,
      authorization_hash: evidence.authorization.authorization_hash,
      plan_version: evidence.authorization.plan_version,
      plan_hash: evidence.authorization.plan_hash,
      execution_scope: evidence.authorization.execution_scope
    },
    attempt: {
      attempt_id: evidence.attempt.attempt_id,
      attempt_fingerprint: evidence.attempt.attempt_fingerprint,
      owner_reference: evidence.attempt.owner_reference,
      state: evidence.attempt.state
    },
    lifecycle_reference: evidence.lifecycle_reference,
    admission_reference: evidence.admission_reference,
    operation_identity: evidence.operation_identity,
    isolation_scope: evidence.isolation_scope
  };
}

function computeHandoffFingerprint(handoff) {
  const { handoff_fingerprint, ...material } = handoff;
  return digest(material);
}

function validateEvidence(evidence) {
  const errors = [];
  const evidenceFields = ['authorization', 'attempt', 'lifecycle_reference', 'admission_reference', 'operation_identity', 'isolation_scope'];
  if (!isPlainObject(evidence) || !Object.keys(evidence).every((field) => [...evidenceFields, 'admission_consumption'].includes(field)) || !evidenceFields.every((field) => Object.prototype.hasOwnProperty.call(evidence, field))) return { valid: false, errors: ['evidence_shape_invalid'] };
  const authorization = evidence.authorization;
  if (!exactFields(authorization, ['authorization_id', 'authorization_hash', 'plan_version', 'plan_hash', 'execution_scope', 'state'])) errors.push('authorization_shape_invalid');
  if (!isNonEmptyString(authorization.authorization_id) || !validDigest(authorization.authorization_hash) || !isNonEmptyString(authorization.plan_version) || !validDigest(authorization.plan_hash) || !validScope(authorization.execution_scope)) errors.push('authorization_binding_invalid');
  if (authorization.state !== 'AUTHORIZED') errors.push('authorization_state_invalid');
  const attempt = evidence.attempt;
  if (!exactFields(attempt, ['attempt_id', 'attempt_fingerprint', 'owner_reference', 'state', 'lease_expires_at'])) errors.push('attempt_shape_invalid');
  if (!isNonEmptyString(attempt.attempt_id) || !validDigest(attempt.attempt_fingerprint) || !validOwner(attempt.owner_reference) || attempt.state !== 'CLAIMED' || !isNonEmptyString(attempt.lease_expires_at) || !Number.isFinite(Date.parse(attempt.lease_expires_at))) errors.push('ownership_invalid');
  if (!validLifecycle(evidence.lifecycle_reference)) errors.push('lifecycle_reference_invalid');
  if (!validAdmissionReference(evidence.admission_reference)) errors.push('admission_reference_invalid');
  if (!validOperation(evidence.operation_identity)) errors.push('operation_identity_invalid');
  if (!validIsolation(evidence.isolation_scope)) errors.push('isolation_scope_invalid');
  if (evidence.admission_consumption !== undefined && !validAdmissionConsumption(evidence.admission_consumption)) errors.push('admission_consumption_invalid');
  if (evidence.lifecycle_reference.authorization_id !== authorization.authorization_id) errors.push('lifecycle_authorization_mismatch');
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function buildExecutionHandoff(evidence) {
  const validation = validateEvidence(evidence);
  if (!validation.valid) throw new Error(`handoff_evidence_invalid::${validation.errors.join(',')}`);
  const handoff = {
    contract_version: CONTRACT_VERSION,
    handoff_state: 'OWNERSHIP_VALIDATED',
    authorization: clone(evidence.authorization),
    attempt: clone(evidence.attempt),
    lifecycle_reference: clone(evidence.lifecycle_reference),
    admission_reference: clone(evidence.admission_reference),
    operation_identity: clone(evidence.operation_identity),
    isolation_scope: clone(evidence.isolation_scope),
    handoff_fingerprint: 'pending',
    execution_allowed: false,
    execution_performed: false,
    production_effect: 'ZERO'
  };
  handoff.handoff_fingerprint = computeHandoffFingerprint(handoff);
  return freeze(handoff);
}

function reject(code, details = {}) {
  return freeze({
    contract_version: CONTRACT_VERSION,
    status: 'REJECTED',
    admission_status: 'REJECTED',
    rejection_code: REJECTION_CODES.includes(code) ? code : 'HANDOFF_INVALID',
    execution_eligible: false,
    execution_performed: false,
    production_effect: 'ZERO',
    ...details
  });
}

function compareBinding(actual, expected) {
  return stablePayload(actual) === stablePayload(expected);
}

function admitExecutionHandoff(currentEvidence, handoff, context = {}) {
  const evidenceValidation = validateEvidence(currentEvidence);
  if (!evidenceValidation.valid) return reject('HANDOFF_INVALID', { errors: evidenceValidation.errors });
  if (!isPlainObject(handoff) || handoff.contract_version !== CONTRACT_VERSION) return reject(handoff?.contract_version ? 'VERSION_UNSUPPORTED' : 'HANDOFF_INVALID');
  if (!exactFields(handoff, ['contract_version', 'handoff_state', 'authorization', 'attempt', 'lifecycle_reference', 'admission_reference', 'operation_identity', 'isolation_scope', 'handoff_fingerprint', 'execution_allowed', 'execution_performed', 'production_effect'])) return reject('HANDOFF_INVALID');
  if (handoff.handoff_state !== 'OWNERSHIP_VALIDATED' || handoff.execution_allowed !== false || handoff.execution_performed !== false || handoff.production_effect !== 'ZERO') return reject('OWNERSHIP_INVALID');
  if (!validDigest(handoff.handoff_fingerprint) || computeHandoffFingerprint(handoff) !== handoff.handoff_fingerprint) return reject('FINGERPRINT_MISMATCH');
  const fields = [
    ['authorization', 'AUTHORIZATION_MISMATCH'],
    ['lifecycle_reference', 'LIFECYCLE_MISMATCH'],
    ['admission_reference', 'ADMISSION_MISMATCH'],
    ['operation_identity', 'OPERATION_MISMATCH'],
    ['isolation_scope', 'ISOLATION_MISMATCH']
  ];
  for (const [field, code] of fields) if (!compareBinding(handoff[field], currentEvidence[field])) return reject(code);
  const attemptCore = (attempt) => ({
    attempt_id: attempt.attempt_id,
    attempt_fingerprint: attempt.attempt_fingerprint,
    state: attempt.state,
    lease_expires_at: attempt.lease_expires_at
  });
  const exactAdmissionReplay = currentEvidence.admission_consumption?.handoff_fingerprint === handoff.handoff_fingerprint;
  if (currentEvidence.admission_consumption && !exactAdmissionReplay) return reject('REPLAY_CONFLICT');
  if (!exactAdmissionReplay && !compareBinding(attemptCore(handoff.attempt), attemptCore(currentEvidence.attempt))) return reject('ATTEMPT_MISMATCH');
  if (handoff.attempt.owner_reference.executor_id !== currentEvidence.attempt.owner_reference.executor_id || handoff.attempt.owner_reference.executor_type !== currentEvidence.attempt.owner_reference.executor_type) return reject('OWNER_MISMATCH');
  if (handoff.authorization.plan_version !== currentEvidence.authorization.plan_version || handoff.authorization.plan_hash !== currentEvidence.authorization.plan_hash) return reject('PLAN_MISMATCH');
  if (handoff.authorization.execution_scope.phase_id !== currentEvidence.authorization.execution_scope.phase_id || handoff.authorization.execution_scope.step_id !== currentEvidence.authorization.execution_scope.step_id) return reject('SCOPE_MISMATCH');
  if (currentEvidence.lifecycle_reference.state !== 'CONSUMED') return reject('LIFECYCLE_NOT_CONSUMED');
  if (currentEvidence.attempt.state !== 'CLAIMED') return reject('OWNERSHIP_INVALID');
  if (Date.parse(currentEvidence.attempt.lease_expires_at) <= Date.parse(context.now || '')) return reject('OWNERSHIP_INVALID', { reason: 'ownership_lease_expired' });
  if (context.prior_admission) {
    if (context.prior_admission.handoff_fingerprint === handoff.handoff_fingerprint) return freeze({ ...admitExecutionHandoff(currentEvidence, handoff), status: 'ADMITTED', admission_status: 'EXACT_REPLAY', replay: true });
    return reject('REPLAY_CONFLICT', { admission_status: 'CONFLICTING_REPLAY' });
  }
  if (exactAdmissionReplay) return freeze({
    contract_version: CONTRACT_VERSION,
    status: 'ADMITTED',
    admission_status: 'EXACT_REPLAY',
    execution_eligible: false,
    replay: true,
    execution_performed: false,
    production_effect: 'ZERO',
    handoff_fingerprint: handoff.handoff_fingerprint,
    authorization_id: handoff.authorization.authorization_id,
    attempt_id: handoff.attempt.attempt_id,
    owner_reference: clone(handoff.attempt.owner_reference)
  });
  return freeze({
    contract_version: CONTRACT_VERSION,
    status: 'ADMITTED',
    admission_status: 'ADMITTED',
    execution_eligible: true,
    execution_performed: false,
    production_effect: 'ZERO',
    handoff_fingerprint: handoff.handoff_fingerprint,
    authorization_id: handoff.authorization.authorization_id,
    attempt_id: handoff.attempt.attempt_id,
    owner_reference: clone(handoff.attempt.owner_reference)
  });
}

function admissionConsumptionReference(handoffFingerprint, consumerReference) {
  return digest({ contract_version: CONTRACT_VERSION, handoff_fingerprint: handoffFingerprint, consumer_reference: consumerReference });
}

function admissionResult(handoff, status, admissionReference, extra = {}) {
  return freeze({
    contract_version: CONTRACT_VERSION,
    status,
    admission_status: status,
    execution_eligible: status === 'FIRST_ADMISSION',
    execution_performed: false,
    production_effect: 'ZERO',
    handoff_fingerprint: handoff.handoff_fingerprint,
    admission_reference: admissionReference,
    authorization_id: handoff.authorization.authorization_id,
    attempt_id: handoff.attempt.attempt_id,
    owner_reference: clone(handoff.attempt.owner_reference),
    ...extra
  });
}

function createExecutionHandoffAdmissionPersistenceInterface({ atomicConsumeExecutionAdmission }) {
  if (typeof atomicConsumeExecutionAdmission !== 'function') throw new Error('handoff_admission_persistence_interface_incomplete');
  return Object.freeze({
    interface_version: HANDOFF_PERSISTENCE_INTERFACE_VERSION,
    atomicConsumeExecutionAdmission
  });
}

function validAtomicAdmissionRecord(value) {
  return exactFields(value, ['state', 'handoff_fingerprint', 'admission_reference', 'consumer_reference', 'admission_status'])
    && value.state === 'CONSUMED'
    && validDigest(value.handoff_fingerprint)
    && validDigest(value.admission_reference)
    && validOwner(value.consumer_reference)
    && ['FIRST_ADMISSION', 'SAME_RESULT_REPLAY'].includes(value.admission_status);
}

function validAdmissionConsumption(value) {
  return exactFields(value, ['state', 'handoff_fingerprint', 'admission_reference', 'consumer_reference'])
    && value.state === 'CONSUMED'
    && validDigest(value.handoff_fingerprint)
    && validDigest(value.admission_reference)
    && validOwner(value.consumer_reference);
}

function consumeExecutionHandoffInternal({ currentEvidence, handoff, persistence, now, consumer_reference }) {
  if (!persistence || persistence.interface_version !== HANDOFF_PERSISTENCE_INTERFACE_VERSION || typeof persistence.atomicConsumeExecutionAdmission !== 'function') return reject('HANDOFF_INVALID', { reason: 'atomic_admission_persistence_required' });
  const decision = admitExecutionHandoff(currentEvidence, handoff, { now });
  if (decision.status !== 'ADMITTED') return decision;
  if (!validOwner(consumer_reference) || !compareBinding(consumer_reference, handoff.attempt.owner_reference)) return reject('OWNER_MISMATCH');
  const admissionReference = admissionConsumptionReference(handoff.handoff_fingerprint, consumer_reference);
  const raw = invokePersistence('atomicConsumeExecutionAdmission', persistence.atomicConsumeExecutionAdmission, [{
    contract_version: CONTRACT_VERSION,
    admission_key: digest({ authorization_id: handoff.authorization.authorization_id, lifecycle_reference: handoff.lifecycle_reference, attempt_id: handoff.attempt.attempt_id, owner_reference: handoff.attempt.owner_reference, handoff_fingerprint: handoff.handoff_fingerprint }),
    attempt_id: handoff.attempt.attempt_id,
    expected_attempt_fingerprint: currentEvidence.attempt.attempt_fingerprint,
    expected_attempt_state: 'CLAIMED',
    authorization_id: handoff.authorization.authorization_id,
    lifecycle_reference: handoff.lifecycle_reference,
    handoff_fingerprint: handoff.handoff_fingerprint,
    consumer_reference: clone(consumer_reference),
    admission_reference: admissionReference
  }], { successStatus: 'ADMITTED', failureStatuses: ['ALREADY_ADMITTED', 'CONFLICT', 'STALE', 'PERSISTENCE_FAILED', 'AMBIGUOUS'] });
  if (!raw.ok || !validAtomicAdmissionRecord(raw.entry)) return reject(raw.status === 'ALREADY_ADMITTED' || raw.status === 'CONFLICT' ? 'REPLAY_CONFLICT' : 'OWNERSHIP_INVALID', { reason: 'atomic_admission_persistence_failed' });
  if (raw.entry.handoff_fingerprint !== handoff.handoff_fingerprint || raw.entry.consumer_reference.executor_id !== consumer_reference.executor_id || raw.entry.consumer_reference.executor_type !== consumer_reference.executor_type || raw.entry.admission_reference !== admissionReference) return reject('REPLAY_CONFLICT', { reason: 'atomic_admission_result_mismatch' });
  if (raw.entry.admission_status === 'SAME_RESULT_REPLAY') return admissionResult(handoff, 'SAME_RESULT_REPLAY', raw.entry.admission_reference, { replay: true });
  return admissionResult(handoff, 'FIRST_ADMISSION', raw.entry.admission_reference);
}

function consumeExecutionHandoff({ currentEvidence, handoff, persistence, now, consumer_reference }) {
  if (!isTrustedDurableAtomicAdmissionAdapter(persistence)) return reject('HANDOFF_INVALID', { reason: 'trusted_durable_admission_adapter_required' });
  return consumeExecutionHandoffInternal({ currentEvidence, handoff, persistence, now, consumer_reference });
}

function buildExecutionResultEnvelope(input) {
  if (!isPlainObject(input) || !RESULT_STATUSES.includes(input.status)) throw new Error('result_status_invalid');
  const required = ['authorization_id', 'attempt_id', 'owner_reference', 'handoff_fingerprint', 'status', 'result_reference'];
  if (!required.every((field) => Object.prototype.hasOwnProperty.call(input, field)) || !isNonEmptyString(input.authorization_id) || !isNonEmptyString(input.attempt_id) || !validOwner(input.owner_reference) || !validDigest(input.handoff_fingerprint) || !isNonEmptyString(input.result_reference)) throw new Error('result_binding_invalid');
  const result = {
    contract_version: RESULT_CONTRACT_VERSION,
    authorization_id: input.authorization_id,
    attempt_id: input.attempt_id,
    owner_reference: clone(input.owner_reference),
    handoff_fingerprint: input.handoff_fingerprint,
    status: input.status,
    result_reference: input.result_reference,
    execution_performed: false,
    production_effect: 'ZERO',
    result_fingerprint: 'pending'
  };
  const { result_fingerprint, ...material } = result;
  result.result_fingerprint = digest(material);
  return freeze(result);
}

function validateExecutionResultEnvelope(result) {
  if (!isPlainObject(result) || result.contract_version !== RESULT_CONTRACT_VERSION || !RESULT_STATUSES.includes(result.status)) return { valid: false, errors: ['result_shape_invalid'] };
  if (result.execution_performed !== false || result.production_effect !== 'ZERO' || !isNonEmptyString(result.authorization_id) || !isNonEmptyString(result.attempt_id) || !validOwner(result.owner_reference) || !validDigest(result.handoff_fingerprint) || !isNonEmptyString(result.result_reference) || !validDigest(result.result_fingerprint)) return { valid: false, errors: ['result_safety_or_binding_invalid'] };
  const { result_fingerprint, ...material } = result;
  return { valid: digest(material) === result_fingerprint, errors: digest(material) === result_fingerprint ? [] : ['result_fingerprint_invalid'] };
}

module.exports = {
  ADMISSION_STATUSES,
  CONTRACT_VERSION,
  HANDOFF_PERSISTENCE_INTERFACE_VERSION,
  HANDOFF_STATES,
  REJECTION_CODES,
  RESULT_CONTRACT_VERSION,
  RESULT_STATUSES,
  admitExecutionHandoff,
  buildExecutionHandoff,
  buildExecutionResultEnvelope,
  computeHandoffFingerprint,
  createExecutionHandoffAdmissionPersistenceInterface,
  consumeExecutionHandoff,
  validateExecutionHandoffEvidence: validateEvidence,
  validateExecutionResultEnvelope
};
