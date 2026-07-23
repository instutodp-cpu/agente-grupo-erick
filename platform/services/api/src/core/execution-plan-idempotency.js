'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_PLAN_IDEMPOTENCY_VALIDATOR_VERSION = 'execution_plan_idempotency_validator_v1';

const EXECUTION_PLAN_IDEMPOTENCY_FIELDS = Object.freeze([
  'idempotency_reference_id', 'idempotency_reference_version', 'execution_plan_id', 'authorization_decision_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'idempotency_key_reference',
  'request_fingerprint', 'plan_fingerprint', 'expected_execution_attempt', 'maximum_execution_attempts',
  'replay_allowed', 'duplicate_execution_blocked', 'idempotency_validated', 'idempotency_consumed',
  'idempotency_fingerprint', 'validator_version'
]);

const EXECUTION_PLAN_IDEMPOTENCY_SAFE_FLAGS = Object.freeze({
  duplicate_execution_blocked: true,
  idempotency_consumed: false
});

const MAX_EXECUTION_ATTEMPT = 1000;
// A synthetic, normalized identifier only -- never an operational key or secret. Letters,
// digits, hyphen, underscore, and colon (for namespacing) only.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_:-]+$/;

function validateExecutionPlanIdempotency(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_plan_idempotency_must_be_object'] };
  exactFields(reference, EXECUTION_PLAN_IDEMPOTENCY_FIELDS, 'execution_plan_idempotency', errors);
  for (const field of [
    'idempotency_reference_id', 'execution_plan_id', 'authorization_decision_id', 'tenant_id', 'organization_id',
    'project_id', 'session_reference_id', 'request_fingerprint', 'plan_fingerprint', 'idempotency_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!isNonEmptyString(reference.idempotency_key_reference) || !IDEMPOTENCY_KEY_PATTERN.test(reference.idempotency_key_reference)) {
    errors.push('idempotency_key_reference_invalid');
  }
  if (!Number.isInteger(reference.idempotency_reference_version) || reference.idempotency_reference_version < 1) errors.push('idempotency_reference_version_invalid');
  if (!Number.isInteger(reference.expected_execution_attempt) || reference.expected_execution_attempt < 0 || reference.expected_execution_attempt > MAX_EXECUTION_ATTEMPT) {
    errors.push('expected_execution_attempt_invalid');
  }
  if (!Number.isInteger(reference.maximum_execution_attempts) || reference.maximum_execution_attempts < 1 || reference.maximum_execution_attempts > MAX_EXECUTION_ATTEMPT) {
    errors.push('maximum_execution_attempts_invalid');
  }
  if (
    Number.isInteger(reference.expected_execution_attempt) && Number.isInteger(reference.maximum_execution_attempts) &&
    reference.expected_execution_attempt > reference.maximum_execution_attempts
  ) {
    errors.push('expected_execution_attempt_exceeds_maximum');
  }
  for (const field of ['replay_allowed', 'idempotency_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_IDEMPOTENCY_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== EXECUTION_PLAN_IDEMPOTENCY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeIdempotencyFingerprint(reference) {
  const { idempotency_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function buildExecutionPlanIdempotency(input = {}) {
  const reference = {
    idempotency_reference_id: input.idempotency_reference_id,
    idempotency_reference_version: Number.isInteger(input.idempotency_reference_version) ? input.idempotency_reference_version : 1,
    execution_plan_id: input.execution_plan_id,
    authorization_decision_id: input.authorization_decision_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    idempotency_key_reference: input.idempotency_key_reference,
    request_fingerprint: input.request_fingerprint,
    plan_fingerprint: input.plan_fingerprint,
    expected_execution_attempt: Number.isInteger(input.expected_execution_attempt) ? input.expected_execution_attempt : 0,
    maximum_execution_attempts: Number.isInteger(input.maximum_execution_attempts) ? input.maximum_execution_attempts : 1,
    replay_allowed: input.replay_allowed === true,
    duplicate_execution_blocked: true,
    idempotency_validated: input.idempotency_validated === true,
    idempotency_consumed: false,
    validator_version: EXECUTION_PLAN_IDEMPOTENCY_VALIDATOR_VERSION
  };
  reference.idempotency_fingerprint = computeIdempotencyFingerprint({ ...reference, idempotency_fingerprint: undefined });

  const validation = validateExecutionPlanIdempotency(reference);
  if (!validation.valid) {
    throw new Error(`execution_plan_idempotency_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  EXECUTION_PLAN_IDEMPOTENCY_FIELDS,
  EXECUTION_PLAN_IDEMPOTENCY_SAFE_FLAGS,
  EXECUTION_PLAN_IDEMPOTENCY_VALIDATOR_VERSION,
  IDEMPOTENCY_KEY_PATTERN,
  MAX_EXECUTION_ATTEMPT,
  buildExecutionPlanIdempotency,
  computeIdempotencyFingerprint,
  validateExecutionPlanIdempotency
};
