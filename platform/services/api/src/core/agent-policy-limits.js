'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const AGENT_POLICY_LIMITS_VALIDATOR_VERSION = 'agent_policy_limits_validator_v1';
const LIMIT_POLICY_FIELDS = Object.freeze([
  'limit_policy_id',
  'maximum_requests',
  'maximum_concurrency',
  'maximum_duration_ms',
  'maximum_payload_bytes',
  'maximum_context_references',
  'maximum_dependency_references',
  'maximum_policy_evaluations',
  'limit_enforced',
  'limit_consumed',
  'simulation',
  'production_blocked',
  'validator_version'
]);
const LIMIT_REQUEST_FIELDS = Object.freeze([
  'requested_requests',
  'requested_concurrency',
  'requested_duration_ms',
  'requested_payload_bytes',
  'requested_context_references',
  'requested_dependency_references',
  'requested_policy_evaluations',
  'validator_version'
]);
const LIMIT_DECISION_FIELDS = Object.freeze([
  'within_limits',
  'requests_within_limit',
  'concurrency_within_limit',
  'duration_within_limit',
  'payload_within_limit',
  'context_references_within_limit',
  'dependency_references_within_limit',
  'policy_evaluations_within_limit',
  'limit_consumed',
  'reason_codes',
  'validator_version'
]);
const MAX_REASONABLE_LIMIT = 1000000;

function isReasonableNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_REASONABLE_LIMIT;
}

function validateLimitPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['limit_policy_must_be_object'] };
  exactFields(policy, LIMIT_POLICY_FIELDS, 'limit_policy', errors);
  if (!isNonEmptyString(policy.limit_policy_id)) errors.push('limit_policy_id_invalid');
  for (const field of ['maximum_requests', 'maximum_concurrency', 'maximum_duration_ms', 'maximum_payload_bytes', 'maximum_context_references', 'maximum_dependency_references', 'maximum_policy_evaluations']) {
    if (!isReasonableNonNegativeInteger(policy[field])) errors.push(`${field}_invalid`);
  }
  if (policy.limit_enforced !== true) errors.push('limit_enforced_must_be_true');
  if (policy.limit_consumed !== false) errors.push('limit_consumed_must_be_false');
  if (policy.simulation !== true) errors.push('simulation_must_be_true');
  if (policy.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (policy.validator_version !== AGENT_POLICY_LIMITS_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateLimitRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['limit_request_must_be_object'] };
  exactFields(request, LIMIT_REQUEST_FIELDS, 'limit_request', errors);
  for (const field of ['requested_requests', 'requested_concurrency', 'requested_duration_ms', 'requested_payload_bytes', 'requested_context_references', 'requested_dependency_references', 'requested_policy_evaluations']) {
    if (!isReasonableNonNegativeInteger(request[field])) errors.push(`${field}_invalid`);
  }
  if (request.validator_version !== AGENT_POLICY_LIMITS_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateLimitDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['limit_decision_must_be_object'] };
  exactFields(decision, LIMIT_DECISION_FIELDS, 'limit_decision', errors);
  for (const field of ['within_limits', 'requests_within_limit', 'concurrency_within_limit', 'duration_within_limit', 'payload_within_limit', 'context_references_within_limit', 'dependency_references_within_limit', 'policy_evaluations_within_limit']) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!Array.isArray(decision.reason_codes) || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (decision.limit_consumed !== false) errors.push('limit_consumed_must_be_false');
  if (decision.validator_version !== AGENT_POLICY_LIMITS_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateLimits(policy, request) {
  const policyValidation = validateLimitPolicy(policy);
  const requestValidation = validateLimitRequest(request);
  if (!policyValidation.valid || !requestValidation.valid) {
    return cloneFrozen({
      within_limits: false,
      requests_within_limit: false,
      concurrency_within_limit: false,
      duration_within_limit: false,
      payload_within_limit: false,
      context_references_within_limit: false,
      dependency_references_within_limit: false,
      policy_evaluations_within_limit: false,
      limit_consumed: false,
      reason_codes: uniqueSorted(['limit_policy_or_request_invalid', ...policyValidation.errors, ...requestValidation.errors]),
      validator_version: AGENT_POLICY_LIMITS_VALIDATOR_VERSION
    });
  }
  const requestsWithin = request.requested_requests <= policy.maximum_requests;
  const concurrencyWithin = request.requested_concurrency <= policy.maximum_concurrency;
  const durationWithin = request.requested_duration_ms <= policy.maximum_duration_ms;
  const payloadWithin = request.requested_payload_bytes <= policy.maximum_payload_bytes;
  const contextReferencesWithin = request.requested_context_references <= policy.maximum_context_references;
  const dependencyReferencesWithin = request.requested_dependency_references <= policy.maximum_dependency_references;
  const policyEvaluationsWithin = request.requested_policy_evaluations <= policy.maximum_policy_evaluations;
  const reasonCodes = [];
  if (!requestsWithin) reasonCodes.push('limit_requests_exceeded');
  if (!concurrencyWithin) reasonCodes.push('limit_concurrency_exceeded');
  if (!durationWithin) reasonCodes.push('limit_duration_exceeded');
  if (!payloadWithin) reasonCodes.push('limit_payload_exceeded');
  if (!contextReferencesWithin) reasonCodes.push('limit_context_references_exceeded');
  if (!dependencyReferencesWithin) reasonCodes.push('limit_dependency_references_exceeded');
  if (!policyEvaluationsWithin) reasonCodes.push('limit_policy_evaluations_exceeded');
  const withinLimits = reasonCodes.length === 0;
  return cloneFrozen({
    within_limits: withinLimits,
    requests_within_limit: requestsWithin,
    concurrency_within_limit: concurrencyWithin,
    duration_within_limit: durationWithin,
    payload_within_limit: payloadWithin,
    context_references_within_limit: contextReferencesWithin,
    dependency_references_within_limit: dependencyReferencesWithin,
    policy_evaluations_within_limit: policyEvaluationsWithin,
    limit_consumed: false,
    reason_codes: uniqueSorted(reasonCodes),
    validator_version: AGENT_POLICY_LIMITS_VALIDATOR_VERSION
  });
}

module.exports = {
  AGENT_POLICY_LIMITS_VALIDATOR_VERSION,
  LIMIT_DECISION_FIELDS,
  LIMIT_POLICY_FIELDS,
  LIMIT_REQUEST_FIELDS,
  MAX_REASONABLE_LIMIT,
  evaluateLimits,
  validateLimitDecision,
  validateLimitPolicy,
  validateLimitRequest
};
