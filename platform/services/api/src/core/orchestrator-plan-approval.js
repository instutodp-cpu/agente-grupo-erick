'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES } = require('./agent-context-contract');

const ORCHESTRATOR_PLAN_APPROVAL_VALIDATOR_VERSION = 'orchestrator_plan_approval_validator_v1';

const ORCHESTRATOR_PLAN_APPROVAL_FIELDS = Object.freeze([
  'approval_context_id', 'approval_required', 'approval_type', 'required_roles', 'minimum_approvals',
  'approval_reference_ids', 'approval_granted', 'approval_applied', 'validator_version'
]);

const APPROVAL_TYPES = Object.freeze(['NONE', 'USER', 'MANAGER', 'SUPERVISOR', 'ADMIN', 'AUDITOR', 'DUAL_CONTROL']);

const ORCHESTRATOR_PLAN_APPROVAL_SAFE_FLAGS = Object.freeze({
  approval_granted: false,
  approval_applied: false
});

const MAX_REQUIRED_ROLES = ACTOR_ROLES.length;
const MAX_MINIMUM_APPROVALS = 10;
const MAX_LIST_ITEMS = 50;

function isOrderedUniqueRoleList(list) {
  if (!Array.isArray(list) || list.length > MAX_REQUIRED_ROLES) return false;
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

function validateOrchestratorPlanApproval(approval) {
  const errors = [];
  if (!isPlainObject(approval)) return { valid: false, errors: ['approval_context_must_be_object'] };
  exactFields(approval, ORCHESTRATOR_PLAN_APPROVAL_FIELDS, 'approval_context', errors);
  if (!isNonEmptyString(approval.approval_context_id)) errors.push('approval_context_id_invalid');
  if (typeof approval.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (!APPROVAL_TYPES.includes(approval.approval_type)) errors.push(`approval_type_not_allowed::${approval.approval_type}`);
  if (!isOrderedUniqueRoleList(approval.required_roles)) errors.push('required_roles_invalid');
  if (!Number.isInteger(approval.minimum_approvals) || approval.minimum_approvals < 0 || approval.minimum_approvals > MAX_MINIMUM_APPROVALS) {
    errors.push('minimum_approvals_invalid');
  }
  if (!isOrderedUniqueStringList(approval.approval_reference_ids)) errors.push('approval_reference_ids_invalid');
  for (const [field, expected] of Object.entries(ORCHESTRATOR_PLAN_APPROVAL_SAFE_FLAGS)) {
    if (approval[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (approval.approval_type === 'NONE' && approval.approval_required !== false) errors.push('approval_required_must_be_false_when_type_none');
  if (approval.approval_required === true && approval.approval_type === 'NONE') errors.push('approval_type_must_not_be_none_when_required');
  if (approval.validator_version !== ORCHESTRATOR_PLAN_APPROVAL_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(approval);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(approval));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  APPROVAL_TYPES,
  MAX_MINIMUM_APPROVALS,
  ORCHESTRATOR_PLAN_APPROVAL_FIELDS,
  ORCHESTRATOR_PLAN_APPROVAL_SAFE_FLAGS,
  ORCHESTRATOR_PLAN_APPROVAL_VALIDATOR_VERSION,
  validateOrchestratorPlanApproval
};
