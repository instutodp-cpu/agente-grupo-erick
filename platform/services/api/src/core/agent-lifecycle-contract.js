'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  cloneFrozen,
  exactFields,
  findAgentCoreOperationalMaterial,
  stablePayload
} = require('./agent-identity-contract');

const AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION = 'agent_lifecycle_contract_validator_v1';
const AGENT_LIFECYCLE_FIELDS = Object.freeze([
  'lifecycle_id',
  'agent_id',
  'tenant_id',
  'current_state',
  'previous_state',
  'requested_transition',
  'transition_allowed',
  'transition_applied',
  'transition_reason',
  'lifecycle_version',
  'validator_version'
]);
const LIFECYCLE_REQUEST_FIELDS = Object.freeze([
  'lifecycle_id',
  'agent_id',
  'tenant_id',
  'current_state',
  'requested_transition',
  'lifecycle_version',
  'validator_version'
]);
const AGENT_LIFECYCLE_STATES = Object.freeze(['DRAFT', 'VALIDATED', 'REGISTERED_SIMULATION', 'SUSPENDED', 'ARCHIVED']);
const ALLOWED_LIFECYCLE_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['VALIDATED', 'ARCHIVED']),
  VALIDATED: Object.freeze(['REGISTERED_SIMULATION', 'ARCHIVED']),
  REGISTERED_SIMULATION: Object.freeze(['SUSPENDED', 'ARCHIVED']),
  SUSPENDED: Object.freeze(['REGISTERED_SIMULATION', 'ARCHIVED']),
  ARCHIVED: Object.freeze([])
});
const AGENT_LIFECYCLE_SAFE_FLAGS = Object.freeze({
  transition_applied: false,
  runtime_enabled: false,
  executed: false,
  production_blocked: true,
  simulation: true
});

function validateAgentLifecycle(record) {
  const errors = [];
  if (!isPlainObject(record)) {
    return { valid: false, errors: ['agent_lifecycle_must_be_object'], ...AGENT_LIFECYCLE_SAFE_FLAGS };
  }
  exactFields(record, AGENT_LIFECYCLE_FIELDS, 'agent_lifecycle', errors);
  for (const field of ['lifecycle_id', 'agent_id', 'tenant_id', 'transition_reason', 'validator_version']) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(record.lifecycle_version) || record.lifecycle_version < 1) errors.push('lifecycle_version_invalid');
  if (!AGENT_LIFECYCLE_STATES.includes(record.current_state)) errors.push(`current_state_not_allowed::${record.current_state}`);
  if (!AGENT_LIFECYCLE_STATES.includes(record.previous_state)) errors.push(`previous_state_not_allowed::${record.previous_state}`);
  if (!AGENT_LIFECYCLE_STATES.includes(record.requested_transition)) errors.push(`requested_transition_not_allowed::${record.requested_transition}`);
  if (typeof record.transition_allowed !== 'boolean') errors.push('transition_allowed_must_be_boolean');
  if (record.transition_applied !== false) errors.push('transition_applied_must_be_false');
  if (record.validator_version !== AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (
    AGENT_LIFECYCLE_STATES.includes(record.current_state) &&
    AGENT_LIFECYCLE_STATES.includes(record.requested_transition) &&
    typeof record.transition_allowed === 'boolean'
  ) {
    const permitted = (ALLOWED_LIFECYCLE_TRANSITIONS[record.current_state] || []).includes(record.requested_transition);
    if (record.transition_allowed !== permitted) errors.push('transition_allowed_inconsistent_with_state_machine');
  }
  try {
    stablePayload(record);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(record));
  return { valid: errors.length === 0, errors: uniqueSorted(errors), ...AGENT_LIFECYCLE_SAFE_FLAGS };
}

function validateLifecycleTransitionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['lifecycle_request_must_be_object'] };
  exactFields(request, LIFECYCLE_REQUEST_FIELDS, 'lifecycle_request', errors);
  for (const field of ['lifecycle_id', 'agent_id', 'tenant_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.lifecycle_version) || request.lifecycle_version < 1) errors.push('lifecycle_version_invalid');
  if (!AGENT_LIFECYCLE_STATES.includes(request.current_state)) errors.push(`current_state_not_allowed::${request.current_state}`);
  if (!AGENT_LIFECYCLE_STATES.includes(request.requested_transition)) errors.push(`requested_transition_not_allowed::${request.requested_transition}`);
  if (request.validator_version !== AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateAgentLifecycleTransition(request = {}) {
  const validation = validateLifecycleTransitionRequest(request);
  const permitted = validation.valid
    ? (ALLOWED_LIFECYCLE_TRANSITIONS[request.current_state] || []).includes(request.requested_transition)
    : false;
  const reason = !validation.valid
    ? (validation.errors[0] || 'lifecycle_request_invalid')
    : (permitted ? 'lifecycle_transition_reviewed_simulation_only' : 'lifecycle_transition_not_allowed_from_state');
  const record = {
    lifecycle_id: isNonEmptyString(request.lifecycle_id) ? request.lifecycle_id : 'lifecycle_not_available',
    agent_id: isNonEmptyString(request.agent_id) ? request.agent_id : 'agent_not_available',
    tenant_id: isNonEmptyString(request.tenant_id) ? request.tenant_id : 'tenant_not_available',
    current_state: AGENT_LIFECYCLE_STATES.includes(request.current_state) ? request.current_state : 'DRAFT',
    previous_state: AGENT_LIFECYCLE_STATES.includes(request.current_state) ? request.current_state : 'DRAFT',
    requested_transition: AGENT_LIFECYCLE_STATES.includes(request.requested_transition) ? request.requested_transition : 'DRAFT',
    transition_allowed: permitted,
    transition_applied: false,
    transition_reason: reason,
    lifecycle_version: Number.isInteger(request.lifecycle_version) ? request.lifecycle_version : 0,
    validator_version: AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION
  };
  const recordValidation = validateAgentLifecycle(record);
  const finalRecord = recordValidation.valid ? record : {
    ...record,
    transition_allowed: false,
    transition_reason: recordValidation.errors[0] || 'lifecycle_record_invalid'
  };
  return cloneFrozen({
    record: finalRecord,
    request_valid: validation.valid,
    errors: uniqueSorted([...(validation.errors || []), ...(recordValidation.valid ? [] : recordValidation.errors)]),
    ...AGENT_LIFECYCLE_SAFE_FLAGS
  });
}

module.exports = {
  AGENT_LIFECYCLE_CONTRACT_VALIDATOR_VERSION,
  AGENT_LIFECYCLE_FIELDS,
  AGENT_LIFECYCLE_SAFE_FLAGS,
  AGENT_LIFECYCLE_STATES,
  ALLOWED_LIFECYCLE_TRANSITIONS,
  LIFECYCLE_REQUEST_FIELDS,
  evaluateAgentLifecycleTransition,
  validateAgentLifecycle,
  validateLifecycleTransitionRequest
};
