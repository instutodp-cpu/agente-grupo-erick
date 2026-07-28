'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

// Declarative replay/idempotency protection for the Gateway itself -- never starts an attempt,
// never applies a replay, never creates an execution. Only records and cross-checks that this
// request's own attempt number is within budget and that no prior attempt already produced an
// accepted decision for the same package.
const EXECUTION_GATEWAY_REPLAY_REFERENCE_VALIDATOR_VERSION = 'execution_gateway_replay_reference_validator_v1';

const EXECUTION_GATEWAY_REPLAY_REFERENCE_FIELDS = Object.freeze([
  'gateway_replay_reference_id', 'gateway_replay_reference_version', 'execution_plan_id', 'execution_plan_fingerprint',
  'gateway_request_id', 'gateway_request_fingerprint', 'idempotency_reference_id', 'idempotency_fingerprint',
  'expected_gateway_attempt', 'maximum_gateway_attempts', 'prior_gateway_decision_ids',
  'prior_gateway_decision_fingerprints', 'duplicate_gateway_acceptance_blocked', 'replay_allowed', 'replay_validated',
  'replay_consumed', 'replay_fingerprint', 'simulation', 'production_blocked', 'validator_version'
]);

const EXECUTION_GATEWAY_REPLAY_REFERENCE_SAFE_FLAGS = Object.freeze({
  duplicate_gateway_acceptance_blocked: true,
  replay_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_PRIOR_DECISIONS = 100;

function isSanitizedOrderedList(list, maxItems) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeReplayFingerprint(reference) {
  // Digest, not raw stablePayload: this reference embeds execution_plan_fingerprint, which is
  // itself already a large canonical fingerprint copied from the plan (see PR100's identical fix
  // for BindingRecord.source_reference_fingerprint, and the same fix applied to the Gateway's own
  // requestFingerprint/gatewayPackageFingerprint/gateway_decision_fingerprint in the boundary).
  const { replay_fingerprint, ...rest } = reference;
  return computeCanonicalContentDigest(rest);
}

function validateExecutionGatewayReplayReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_gateway_replay_reference_must_be_object'] };
  exactFields(reference, EXECUTION_GATEWAY_REPLAY_REFERENCE_FIELDS, 'execution_gateway_replay_reference', errors);
  for (const field of [
    'gateway_replay_reference_id', 'execution_plan_id', 'execution_plan_fingerprint', 'gateway_request_id',
    'gateway_request_fingerprint', 'idempotency_reference_id', 'idempotency_fingerprint', 'replay_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.gateway_replay_reference_version) || reference.gateway_replay_reference_version < 1) {
    errors.push('gateway_replay_reference_version_invalid');
  }
  if (!Number.isInteger(reference.expected_gateway_attempt) || reference.expected_gateway_attempt < 0) {
    errors.push('expected_gateway_attempt_invalid');
  }
  if (!Number.isInteger(reference.maximum_gateway_attempts) || reference.maximum_gateway_attempts < 1) {
    errors.push('maximum_gateway_attempts_invalid');
  }
  if (
    Number.isInteger(reference.expected_gateway_attempt) && Number.isInteger(reference.maximum_gateway_attempts)
    && reference.expected_gateway_attempt > reference.maximum_gateway_attempts
  ) {
    errors.push('expected_gateway_attempt_exceeds_maximum');
  }
  if (!isSanitizedOrderedList(reference.prior_gateway_decision_ids, MAX_PRIOR_DECISIONS)) errors.push('prior_gateway_decision_ids_invalid');
  if (!Array.isArray(reference.prior_gateway_decision_fingerprints) || reference.prior_gateway_decision_fingerprints.length > MAX_PRIOR_DECISIONS
    || !reference.prior_gateway_decision_fingerprints.every(isNonEmptyString)) {
    errors.push('prior_gateway_decision_fingerprints_invalid');
  } else if (Array.isArray(reference.prior_gateway_decision_ids)
    && reference.prior_gateway_decision_ids.length !== reference.prior_gateway_decision_fingerprints.length) {
    errors.push('prior_gateway_decision_fingerprints_does_not_correspond_1to1');
  }

  const withinBudget = Number.isInteger(reference.expected_gateway_attempt) && Number.isInteger(reference.maximum_gateway_attempts)
    && reference.expected_gateway_attempt <= reference.maximum_gateway_attempts;
  if (typeof reference.replay_allowed !== 'boolean') errors.push('replay_allowed_must_be_boolean');
  if (reference.replay_allowed !== withinBudget) errors.push('replay_allowed_does_not_match_attempt_budget');
  if (typeof reference.replay_validated !== 'boolean') errors.push('replay_validated_must_be_boolean');
  if (reference.replay_validated !== withinBudget) errors.push('replay_validated_does_not_match_attempt_budget');

  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_REPLAY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== EXECUTION_GATEWAY_REPLAY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeReplayFingerprint(reference) !== reference.replay_fingerprint) errors.push('replay_fingerprint_mismatch');
  } catch (error) {
    errors.push('replay_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionGatewayReplayReference(input = {}) {
  const expectedAttempt = Number.isInteger(input.expected_gateway_attempt) ? input.expected_gateway_attempt : 0;
  const maximumAttempts = Number.isInteger(input.maximum_gateway_attempts) ? input.maximum_gateway_attempts : 1;
  const withinBudget = expectedAttempt <= maximumAttempts;
  // Sorted as (id, fingerprint) pairs, not independently -- sorting prior_gateway_decision_ids
  // alone while leaving prior_gateway_decision_fingerprints in caller order would silently break
  // the 1:1 correspondence between the two parallel arrays. A length mismatch is left as-is (raw,
  // unsorted) so the existing 1:1-correspondence validation below reports it, instead of this
  // constructor guessing at a pairing that was never well-formed.
  const rawPriorIds = Array.isArray(input.prior_gateway_decision_ids) ? input.prior_gateway_decision_ids : [];
  const rawPriorFingerprints = Array.isArray(input.prior_gateway_decision_fingerprints) ? input.prior_gateway_decision_fingerprints : [];
  const lengthsMatch = rawPriorIds.length === rawPriorFingerprints.length;
  const priorPairs = lengthsMatch
    ? rawPriorIds.map((id, index) => [id, rawPriorFingerprints[index]]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    : [];
  const priorIds = lengthsMatch ? priorPairs.map(([id]) => id) : [...rawPriorIds].sort();
  const priorFingerprints = lengthsMatch ? priorPairs.map(([, fingerprint]) => fingerprint) : [...rawPriorFingerprints];

  const reference = {
    gateway_replay_reference_id: input.gateway_replay_reference_id,
    gateway_replay_reference_version: Number.isInteger(input.gateway_replay_reference_version) ? input.gateway_replay_reference_version : 1,
    execution_plan_id: input.execution_plan_id,
    execution_plan_fingerprint: input.execution_plan_fingerprint,
    gateway_request_id: input.gateway_request_id,
    gateway_request_fingerprint: input.gateway_request_fingerprint,
    idempotency_reference_id: input.idempotency_reference_id,
    idempotency_fingerprint: input.idempotency_fingerprint,
    expected_gateway_attempt: expectedAttempt,
    maximum_gateway_attempts: maximumAttempts,
    prior_gateway_decision_ids: priorIds,
    prior_gateway_decision_fingerprints: priorFingerprints,
    replay_allowed: withinBudget,
    replay_validated: withinBudget,
    replay_fingerprint: 'pending',
    ...EXECUTION_GATEWAY_REPLAY_REFERENCE_SAFE_FLAGS,
    validator_version: EXECUTION_GATEWAY_REPLAY_REFERENCE_VALIDATOR_VERSION
  };
  reference.replay_fingerprint = computeReplayFingerprint(reference);

  const validation = validateExecutionGatewayReplayReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_gateway_replay_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  EXECUTION_GATEWAY_REPLAY_REFERENCE_FIELDS,
  EXECUTION_GATEWAY_REPLAY_REFERENCE_SAFE_FLAGS,
  EXECUTION_GATEWAY_REPLAY_REFERENCE_VALIDATOR_VERSION,
  MAX_PRIOR_DECISIONS,
  buildExecutionGatewayReplayReference,
  computeReplayFingerprint,
  isSanitizedOrderedList,
  validateExecutionGatewayReplayReference
};
