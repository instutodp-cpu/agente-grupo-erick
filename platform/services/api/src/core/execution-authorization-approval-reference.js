'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES } = require('./agent-context-contract');
const { APPROVAL_TYPES } = require('./orchestrator-plan-approval');

const EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_VALIDATOR_VERSION = 'execution_authorization_approval_reference_validator_v1';

const EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_FIELDS = Object.freeze([
  'approval_reference_id', 'approval_reference_version', 'planning_result_id', 'plan_id', 'tenant_id',
  'organization_id', 'project_id', 'session_reference_id', 'approval_required', 'approval_type', 'required_roles',
  'minimum_approvals', 'approval_decision_reference_ids', 'approval_count', 'approval_state', 'approval_validated',
  'approval_applied', 'approval_fingerprint', 'validator_version'
]);

const APPROVAL_STATES = Object.freeze(['NOT_REQUIRED', 'PENDING', 'APPROVED_SIMULATION', 'DENIED', 'EXPIRED_LOGICAL', 'CONFLICTED']);

// States a real approval decision produced upstream may declare and this reference merely
// carries -- never derivable purely from counting approval_decision_reference_ids.
const EXTERNALLY_VERDICTED_STATES = Object.freeze(['DENIED', 'EXPIRED_LOGICAL', 'CONFLICTED']);

const APPROVAL_READY_STATES = Object.freeze(['NOT_REQUIRED', 'APPROVED_SIMULATION']);

const APPROVAL_REFERENCE_SAFE_FLAGS = Object.freeze({
  approval_applied: false
});

const MAX_MINIMUM_APPROVALS = 10;
const MAX_LIST_ITEMS = 50;

function isOrderedUniqueRoleList(list) {
  if (!Array.isArray(list) || list.length > ACTOR_ROLES.length) return false;
  if (!list.every((item) => isNonEmptyString(item) && ACTOR_ROLES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateExecutionAuthorizationApprovalReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_authorization_approval_reference_must_be_object'] };
  exactFields(reference, EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_FIELDS, 'execution_authorization_approval_reference', errors);
  for (const field of ['approval_reference_id', 'planning_result_id', 'plan_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'approval_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.approval_reference_version) || reference.approval_reference_version < 1) errors.push('approval_reference_version_invalid');
  if (typeof reference.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (!APPROVAL_TYPES.includes(reference.approval_type)) errors.push(`approval_type_not_allowed::${reference.approval_type}`);
  if (!isOrderedUniqueRoleList(reference.required_roles)) errors.push('required_roles_invalid');
  if (!Number.isInteger(reference.minimum_approvals) || reference.minimum_approvals < 0 || reference.minimum_approvals > MAX_MINIMUM_APPROVALS) {
    errors.push('minimum_approvals_invalid');
  }
  if (!isOrderedUniqueStringList(reference.approval_decision_reference_ids)) errors.push('approval_decision_reference_ids_invalid');
  if (!Number.isInteger(reference.approval_count) || reference.approval_count < 0) errors.push('approval_count_invalid');
  if (Array.isArray(reference.approval_decision_reference_ids) && reference.approval_count !== reference.approval_decision_reference_ids.length) {
    errors.push('approval_count_inconsistent_with_approval_decision_reference_ids');
  }
  if (!APPROVAL_STATES.includes(reference.approval_state)) errors.push(`approval_state_not_allowed::${reference.approval_state}`);
  if (typeof reference.approval_validated !== 'boolean') errors.push('approval_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(APPROVAL_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (reference.approval_required === false && reference.approval_state !== 'NOT_REQUIRED') {
    errors.push('approval_state_must_be_not_required_when_not_required');
  }
  if (reference.approval_required === true && reference.approval_state === 'NOT_REQUIRED') {
    errors.push('approval_state_cannot_be_not_required_when_required');
  }
  if (APPROVAL_READY_STATES.includes(reference.approval_state) !== (reference.approval_validated === true)) {
    errors.push('approval_validated_inconsistent_with_approval_state');
  }

  if (reference.validator_version !== EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeApprovalReferenceFingerprint(reference) {
  const { approval_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function buildExecutionAuthorizationApprovalReference(input = {}) {
  const approvalDecisionReferenceIds = uniqueSorted(input.approval_decision_reference_ids || []);
  const requiredRoles = uniqueSorted(input.required_roles || []);
  const approvalRequired = input.approval_required === true;
  const minimumApprovals = Number.isInteger(input.minimum_approvals) ? input.minimum_approvals : 0;
  const approvalType = APPROVAL_TYPES.includes(input.approval_type) ? input.approval_type : 'NONE';

  let state;
  if (EXTERNALLY_VERDICTED_STATES.includes(input.approval_state)) {
    state = input.approval_state;
  } else if (!approvalRequired) {
    state = 'NOT_REQUIRED';
  } else if (approvalDecisionReferenceIds.length >= minimumApprovals && minimumApprovals > 0) {
    state = 'APPROVED_SIMULATION';
  } else {
    state = 'PENDING';
  }

  const reference = {
    approval_reference_id: input.approval_reference_id,
    approval_reference_version: Number.isInteger(input.approval_reference_version) ? input.approval_reference_version : 1,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    approval_required: approvalRequired,
    approval_type: approvalType,
    required_roles: requiredRoles,
    minimum_approvals: minimumApprovals,
    approval_decision_reference_ids: approvalDecisionReferenceIds,
    approval_count: approvalDecisionReferenceIds.length,
    approval_state: state,
    approval_validated: APPROVAL_READY_STATES.includes(state),
    approval_applied: false,
    validator_version: EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_VALIDATOR_VERSION
  };
  reference.approval_fingerprint = computeApprovalReferenceFingerprint({ ...reference, approval_fingerprint: undefined });

  const validation = validateExecutionAuthorizationApprovalReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_authorization_approval_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  APPROVAL_READY_STATES,
  APPROVAL_STATES,
  EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_FIELDS,
  EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_VALIDATOR_VERSION,
  EXTERNALLY_VERDICTED_STATES,
  MAX_LIST_ITEMS,
  MAX_MINIMUM_APPROVALS,
  buildExecutionAuthorizationApprovalReference,
  computeApprovalReferenceFingerprint,
  validateExecutionAuthorizationApprovalReference
};
