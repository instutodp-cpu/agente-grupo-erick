'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { SESSION_STATUSES } = require('./agent-session-contract');

const AGENT_SESSION_TRANSITION_VALIDATOR_VERSION = 'agent_session_transition_validator_v1';
const AGENT_SESSION_TRANSITION_FIELDS = Object.freeze([
  'transition_id', 'session_id', 'tenant_id', 'organization_id', 'from_status', 'to_status', 'transition_type',
  'transition_allowed', 'transition_applied', 'requires_policy', 'requires_approval', 'reason_codes',
  'logical_sequence', 'transition_version', 'validator_version'
]);
const TRANSITION_TYPES = Object.freeze(['CREATE', 'VALIDATE', 'OPEN_SIMULATION', 'SUSPEND', 'RESUME_SIMULATION', 'EXPIRE_LOGICAL', 'CLOSE_SIMULATION', 'ARCHIVE']);
const ALLOWED_TRANSITION_TABLE = Object.freeze([
  Object.freeze({ from: 'DRAFT', type: 'VALIDATE', to: 'VALIDATED' }),
  Object.freeze({ from: 'VALIDATED', type: 'OPEN_SIMULATION', to: 'OPEN_SIMULATION' }),
  Object.freeze({ from: 'OPEN_SIMULATION', type: 'SUSPEND', to: 'SUSPENDED' }),
  Object.freeze({ from: 'SUSPENDED', type: 'RESUME_SIMULATION', to: 'OPEN_SIMULATION' }),
  Object.freeze({ from: 'DRAFT', type: 'ARCHIVE', to: 'ARCHIVED' }),
  Object.freeze({ from: 'VALIDATED', type: 'ARCHIVE', to: 'ARCHIVED' }),
  Object.freeze({ from: 'OPEN_SIMULATION', type: 'CLOSE_SIMULATION', to: 'CLOSED_SIMULATION' }),
  Object.freeze({ from: 'SUSPENDED', type: 'CLOSE_SIMULATION', to: 'CLOSED_SIMULATION' }),
  Object.freeze({ from: 'OPEN_SIMULATION', type: 'EXPIRE_LOGICAL', to: 'EXPIRED_LOGICAL' }),
  Object.freeze({ from: 'SUSPENDED', type: 'EXPIRE_LOGICAL', to: 'EXPIRED_LOGICAL' }),
  Object.freeze({ from: 'EXPIRED_LOGICAL', type: 'ARCHIVE', to: 'ARCHIVED' }),
  Object.freeze({ from: 'CLOSED_SIMULATION', type: 'ARCHIVE', to: 'ARCHIVED' })
]);

function resolveTargetStatus(fromStatus, transitionType) {
  if (transitionType === 'CREATE') return fromStatus === 'DRAFT' ? 'DRAFT' : null;
  const entry = ALLOWED_TRANSITION_TABLE.find((row) => row.from === fromStatus && row.type === transitionType);
  return entry ? entry.to : null;
}

function isTransitionAllowed(fromStatus, transitionType, toStatus) {
  const resolved = resolveTargetStatus(fromStatus, transitionType);
  return resolved !== null && resolved === toStatus;
}

function validateAgentSessionTransition(transition) {
  const errors = [];
  if (!isPlainObject(transition)) return { valid: false, errors: ['agent_session_transition_must_be_object'] };
  exactFields(transition, AGENT_SESSION_TRANSITION_FIELDS, 'agent_session_transition', errors);
  for (const field of ['transition_id', 'session_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(transition[field])) errors.push(`${field}_invalid`);
  }
  if (!SESSION_STATUSES.includes(transition.from_status)) errors.push(`from_status_not_allowed::${transition.from_status}`);
  if (!SESSION_STATUSES.includes(transition.to_status)) errors.push(`to_status_not_allowed::${transition.to_status}`);
  if (!TRANSITION_TYPES.includes(transition.transition_type)) errors.push(`transition_type_not_allowed::${transition.transition_type}`);
  if (typeof transition.transition_allowed !== 'boolean') errors.push('transition_allowed_must_be_boolean');
  if (transition.transition_applied !== false) errors.push('transition_applied_must_be_false');
  if (typeof transition.requires_policy !== 'boolean') errors.push('requires_policy_must_be_boolean');
  if (typeof transition.requires_approval !== 'boolean') errors.push('requires_approval_must_be_boolean');
  if (!Array.isArray(transition.reason_codes) || !transition.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(transition.logical_sequence) || transition.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(transition.transition_version) || transition.transition_version < 1) errors.push('transition_version_invalid');
  if (
    SESSION_STATUSES.includes(transition.from_status) && SESSION_STATUSES.includes(transition.to_status) &&
    TRANSITION_TYPES.includes(transition.transition_type) && typeof transition.transition_allowed === 'boolean'
  ) {
    const permitted = isTransitionAllowed(transition.from_status, transition.transition_type, transition.to_status);
    if (transition.transition_allowed !== permitted) errors.push('transition_allowed_inconsistent_with_table');
  }
  if (transition.validator_version !== AGENT_SESSION_TRANSITION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(transition);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(transition));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateAgentSessionTransition(input = {}) {
  const fromStatus = SESSION_STATUSES.includes(input.from_status) ? input.from_status : 'DRAFT';
  const toStatus = SESSION_STATUSES.includes(input.to_status) ? input.to_status : 'DRAFT';
  const transitionType = TRANSITION_TYPES.includes(input.transition_type) ? input.transition_type : 'CREATE';
  const permitted = isTransitionAllowed(fromStatus, transitionType, toStatus);
  const requiresPolicy = toStatus === 'OPEN_SIMULATION';
  const requiresApproval = input.approval_required_hint === true;
  const reasonCodes = [];
  if (!permitted) reasonCodes.push('transition_not_allowed_from_state');
  else reasonCodes.push('transition_reviewed_simulation_only');

  const record = {
    transition_id: isNonEmptyString(input.transition_id) ? input.transition_id : 'transition_not_available',
    session_id: isNonEmptyString(input.session_id) ? input.session_id : 'session_not_available',
    tenant_id: isNonEmptyString(input.tenant_id) ? input.tenant_id : 'tenant_not_available',
    organization_id: isNonEmptyString(input.organization_id) ? input.organization_id : 'organization_not_available',
    from_status: fromStatus,
    to_status: toStatus,
    transition_type: transitionType,
    transition_allowed: permitted,
    transition_applied: false,
    requires_policy: requiresPolicy,
    requires_approval: requiresApproval,
    reason_codes: uniqueSorted(reasonCodes),
    logical_sequence: Number.isInteger(input.logical_sequence) && input.logical_sequence >= 0 ? input.logical_sequence : 0,
    transition_version: Number.isInteger(input.transition_version) && input.transition_version >= 1 ? input.transition_version : 1,
    validator_version: AGENT_SESSION_TRANSITION_VALIDATOR_VERSION
  };
  const validation = validateAgentSessionTransition(record);
  if (!validation.valid) {
    return cloneFrozen({
      ...record,
      transition_allowed: false,
      transition_applied: false,
      reason_codes: uniqueSorted([...record.reason_codes, ...validation.errors])
    });
  }
  return cloneFrozen(record);
}

module.exports = {
  AGENT_SESSION_TRANSITION_FIELDS,
  AGENT_SESSION_TRANSITION_VALIDATOR_VERSION,
  ALLOWED_TRANSITION_TABLE,
  TRANSITION_TYPES,
  evaluateAgentSessionTransition,
  isTransitionAllowed,
  resolveTargetStatus,
  validateAgentSessionTransition
};
