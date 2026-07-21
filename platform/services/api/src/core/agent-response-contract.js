'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  cloneFrozen,
  exactFields,
  stablePayload
} = require('./agent-identity-contract');

const AGENT_RESPONSE_CONTRACT_VALIDATOR_VERSION = 'agent_response_contract_validator_v1';
const AGENT_RESPONSE_FIELDS = Object.freeze([
  'response_id',
  'request_id',
  'agent_id',
  'tenant_id',
  'status',
  'decision',
  'decision_reason',
  'contract_fingerprint',
  'context_fingerprint',
  'capability_fingerprints',
  'lifecycle_state',
  'response_generated',
  'response_content_present',
  'response_content_generated',
  'llm_called',
  'tool_called',
  'memory_read',
  'memory_written',
  'network_used',
  'executed',
  'runtime_enabled',
  'simulation',
  'production_blocked',
  'rollout_percentage',
  'validator_version'
]);
const AGENT_RESPONSE_STATUSES = Object.freeze([
  'VALIDATED_SIMULATION',
  'REJECTED',
  'VALIDATION_FAILED',
  'TENANT_BLOCKED',
  'POLICY_BLOCKED',
  'CAPABILITY_BLOCKED',
  'LIFECYCLE_BLOCKED'
]);
const AGENT_RESPONSE_SAFE_FLAGS = Object.freeze({
  response_generated: true,
  response_content_present: false,
  response_content_generated: false,
  llm_called: false,
  tool_called: false,
  memory_read: false,
  memory_written: false,
  network_used: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});
const MAX_CAPABILITY_FINGERPRINTS = 100;

function isOrderedFingerprintList(list) {
  if (!Array.isArray(list) || list.length > MAX_CAPABILITY_FINGERPRINTS) return false;
  if (!list.every((item) => isNonEmptyString(item))) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateAgentResponse(response) {
  const errors = [];
  if (!isPlainObject(response)) return { valid: false, errors: ['agent_response_must_be_object'] };
  exactFields(response, AGENT_RESPONSE_FIELDS, 'agent_response', errors);
  for (const field of ['response_id', 'request_id', 'agent_id', 'tenant_id', 'status', 'decision', 'decision_reason', 'contract_fingerprint', 'context_fingerprint', 'lifecycle_state', 'validator_version']) {
    if (!isNonEmptyString(response[field])) errors.push(`${field}_invalid`);
  }
  if (!AGENT_RESPONSE_STATUSES.includes(response.status)) errors.push(`status_not_allowed::${response.status}`);
  if (!isOrderedFingerprintList(response.capability_fingerprints)) errors.push('capability_fingerprints_invalid');
  for (const [field, expected] of Object.entries(AGENT_RESPONSE_SAFE_FLAGS)) {
    if (response[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (response.validator_version !== AGENT_RESPONSE_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(response);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentResponse(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const response = {
    response_id: overrides.response_id || `agent_response_${overrides.request_id || 'missing'}`,
    request_id: overrides.request_id || 'request_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    status,
    decision: overrides.decision || status,
    decision_reason: overrides.decision_reason || 'fail_closed',
    contract_fingerprint: overrides.contract_fingerprint || 'contract_fingerprint_not_available',
    context_fingerprint: overrides.context_fingerprint || 'context_fingerprint_not_available',
    capability_fingerprints: Array.isArray(overrides.capability_fingerprints) ? [...overrides.capability_fingerprints].sort() : [],
    lifecycle_state: overrides.lifecycle_state || 'lifecycle_state_not_available',
    validator_version: AGENT_RESPONSE_CONTRACT_VALIDATOR_VERSION,
    ...AGENT_RESPONSE_SAFE_FLAGS
  };
  const validation = validateAgentResponse(response);
  if (!validation.valid) {
    return cloneFrozen({
      ...response,
      status: 'VALIDATION_FAILED',
      decision: 'VALIDATION_FAILED',
      decision_reason: validation.errors[0] || 'agent_response_invalid',
      capability_fingerprints: [],
      ...AGENT_RESPONSE_SAFE_FLAGS
    });
  }
  return cloneFrozen(response);
}

module.exports = {
  AGENT_RESPONSE_CONTRACT_VALIDATOR_VERSION,
  AGENT_RESPONSE_FIELDS,
  AGENT_RESPONSE_SAFE_FLAGS,
  AGENT_RESPONSE_STATUSES,
  MAX_CAPABILITY_FINGERPRINTS,
  buildAgentResponse,
  isOrderedFingerprintList,
  validateAgentResponse
};
