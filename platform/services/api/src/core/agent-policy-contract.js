'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  AGENT_SYSTEM_TENANT_ID,
  exactFields,
  findAgentCoreOperationalMaterial,
  stablePayload
} = require('./agent-identity-contract');
const { ACTOR_ROLES, validateAgentSimulationContext } = require('./agent-context-contract');
const { isOrderedUniqueRefList } = require('./agent-capability-contract');
const {
  validateActionScope,
  validateChannelScope,
  validateDataScope,
  validateResourceScope,
  validateRiskScope,
  validateSubjectScope
} = require('./agent-policy-scope');
const { validateBudgetPolicy } = require('./agent-policy-budget');
const { validateLimitPolicy } = require('./agent-policy-limits');

const AGENT_POLICY_CONTRACT_VALIDATOR_VERSION = 'agent_policy_contract_validator_v1';
const AGENT_POLICY_FIELDS = Object.freeze([
  'policy_id',
  'policy_slug',
  'policy_version',
  'tenant_id',
  'organization_id',
  'policy_type',
  'policy_status',
  'priority',
  'effect',
  'subject_scope',
  'resource_scope',
  'action_scope',
  'risk_scope',
  'data_scope',
  'channel_scope',
  'budget_policy',
  'limit_policy',
  'approval_policy',
  'rule_references',
  'dependency_references',
  'simulation_context',
  'created_at_logical',
  'validator_version'
]);
const APPROVAL_POLICY_FIELDS = Object.freeze(['approval_required', 'approval_type', 'required_roles', 'minimum_approvals', 'approval_granted', 'approval_applied', 'validator_version']);
const AGENT_POLICY_TYPES = Object.freeze([
  'TENANT_POLICY', 'ORGANIZATION_POLICY', 'AGENT_POLICY', 'CAPABILITY_POLICY', 'ACTOR_POLICY',
  'RISK_POLICY', 'DATA_POLICY', 'CHANNEL_POLICY', 'BUDGET_POLICY', 'LIMIT_POLICY', 'SYSTEM_POLICY'
]);
const AGENT_POLICY_STATUSES = Object.freeze(['DRAFT', 'VALIDATED_SIMULATION', 'SUSPENDED', 'ARCHIVED']);
const FORBIDDEN_AGENT_POLICY_STATUSES = Object.freeze(['ACTIVE', 'ENABLED', 'LIVE', 'PRODUCTION', 'EXECUTING']);
const AGENT_POLICY_EFFECTS = Object.freeze(['DENY', 'ALLOW_SIMULATION', 'REQUIRE_APPROVAL_SIMULATION']);
const APPROVAL_TYPES = Object.freeze(['NONE', 'MANAGER', 'SUPERVISOR', 'ADMIN', 'AUDITOR', 'DUAL_CONTROL']);
const MIN_PRIORITY = 0;
const MAX_PRIORITY = 1000;
const AGENT_POLICY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function validateApprovalPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['approval_policy_must_be_object'] };
  exactFields(policy, APPROVAL_POLICY_FIELDS, 'approval_policy', errors);
  if (typeof policy.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (!APPROVAL_TYPES.includes(policy.approval_type)) errors.push(`approval_type_not_allowed::${policy.approval_type}`);
  if (!Array.isArray(policy.required_roles) || !policy.required_roles.every((role) => ACTOR_ROLES.includes(role))) errors.push('required_roles_invalid');
  if (Array.isArray(policy.required_roles) && new Set(policy.required_roles).size !== policy.required_roles.length) errors.push('required_roles_duplicate');
  if (Array.isArray(policy.required_roles)) {
    const sorted = [...policy.required_roles].sort();
    if (!policy.required_roles.every((role, index) => role === sorted[index])) errors.push('required_roles_not_sorted');
  }
  if (!Number.isInteger(policy.minimum_approvals) || policy.minimum_approvals < 0) errors.push('minimum_approvals_invalid');
  if (policy.approval_granted !== false) errors.push('approval_granted_must_be_false');
  if (policy.approval_applied !== false) errors.push('approval_applied_must_be_false');
  if (policy.validator_version !== AGENT_POLICY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function isSystemPolicy(policy) {
  return policy.policy_type === 'SYSTEM_POLICY' && policy.tenant_id === AGENT_SYSTEM_TENANT_ID;
}

function validateAgentPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['agent_policy_must_be_object'] };
  exactFields(policy, AGENT_POLICY_FIELDS, 'agent_policy', errors);
  for (const field of ['policy_id', 'policy_slug', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.policy_version) || policy.policy_version < 1) errors.push('policy_version_invalid');
  if (isNonEmptyString(policy.policy_slug) && !AGENT_POLICY_SLUG_PATTERN.test(policy.policy_slug)) errors.push('policy_slug_not_normalized');
  if (!AGENT_POLICY_TYPES.includes(policy.policy_type)) errors.push(`policy_type_not_allowed::${policy.policy_type}`);
  if (!AGENT_POLICY_STATUSES.includes(policy.policy_status)) errors.push(`policy_status_not_allowed::${policy.policy_status}`);
  if (FORBIDDEN_AGENT_POLICY_STATUSES.includes(policy.policy_status)) errors.push(`policy_status_forbidden::${policy.policy_status}`);
  if (!Number.isInteger(policy.priority) || policy.priority < MIN_PRIORITY || policy.priority > MAX_PRIORITY) errors.push('priority_invalid');
  if (!AGENT_POLICY_EFFECTS.includes(policy.effect)) errors.push(`effect_not_allowed::${policy.effect}`);
  if (!(isNonEmptyString(policy.created_at_logical) || (Number.isInteger(policy.created_at_logical) && policy.created_at_logical >= 0))) {
    errors.push('created_at_logical_invalid');
  }
  if (!isOrderedUniqueRefList(policy.rule_references)) errors.push('rule_references_invalid');
  if (!isOrderedUniqueRefList(policy.dependency_references)) errors.push('dependency_references_invalid');

  errors.push(...validateSubjectScope(policy.subject_scope).errors.map((error) => `subject_scope_${error}`));
  errors.push(...validateResourceScope(policy.resource_scope).errors.map((error) => `resource_scope_${error}`));
  errors.push(...validateActionScope(policy.action_scope).errors.map((error) => `action_scope_${error}`));
  errors.push(...validateRiskScope(policy.risk_scope).errors.map((error) => `risk_scope_${error}`));
  errors.push(...validateDataScope(policy.data_scope).errors.map((error) => `data_scope_${error}`));
  errors.push(...validateChannelScope(policy.channel_scope).errors.map((error) => `channel_scope_${error}`));
  errors.push(...validateBudgetPolicy(policy.budget_policy).errors.map((error) => `budget_policy_${error}`));
  errors.push(...validateLimitPolicy(policy.limit_policy).errors.map((error) => `limit_policy_${error}`));
  errors.push(...validateApprovalPolicy(policy.approval_policy).errors.map((error) => `approval_policy_${error}`));
  errors.push(...validateAgentSimulationContext(policy.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (!isSystemPolicy(policy) && isNonEmptyString(policy.tenant_id) && isNonEmptyString(policy.organization_id)) {
    if (!policy.organization_id.startsWith(`${policy.tenant_id}:`)) errors.push('organization_id_not_compatible_with_tenant');
  }
  if (policy.validator_version !== AGENT_POLICY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_POLICY_CONTRACT_VALIDATOR_VERSION,
  AGENT_POLICY_EFFECTS,
  AGENT_POLICY_FIELDS,
  AGENT_POLICY_STATUSES,
  AGENT_POLICY_SLUG_PATTERN,
  AGENT_POLICY_TYPES,
  APPROVAL_POLICY_FIELDS,
  APPROVAL_TYPES,
  FORBIDDEN_AGENT_POLICY_STATUSES,
  MAX_PRIORITY,
  MIN_PRIORITY,
  isSystemPolicy,
  validateAgentPolicy,
  validateApprovalPolicy
};
