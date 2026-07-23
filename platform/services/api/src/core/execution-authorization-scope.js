'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES } = require('./agent-context-contract');
const { TASK_TYPES } = require('./orchestrator-task-definition');

const EXECUTION_AUTHORIZATION_SCOPE_VALIDATOR_VERSION = 'execution_authorization_scope_validator_v1';

const EXECUTION_AUTHORIZATION_SCOPE_FIELDS = Object.freeze([
  'scope_id', 'scope_version', 'tenant_id', 'organization_id', 'allowed_agent_ids', 'allowed_project_ids',
  'allowed_session_reference_ids', 'allowed_plan_ids', 'allowed_actor_ids', 'allowed_actor_roles',
  'allowed_task_types', 'allowed_risk_classifications', 'allowed_tool_reference_ids',
  'allowed_workflow_reference_ids', 'maximum_authorized_cost_minor_units', 'maximum_authorized_tokens',
  'cross_tenant_allowed', 'cross_organization_allowed', 'cross_project_allowed', 'cross_session_allowed',
  'scope_fingerprint', 'validator_version'
]);

// RISK_CLASSIFICATIONS deliberately does not reuse agent-metadata-contract.js's
// AGENT_RISK_CLASSIFICATIONS (['LOW','MODERATE','HIGH','RESTRICTED']) -- this PR's spec
// requires a 5th tier, CRITICAL, that the existing enum does not carry.
const RISK_CLASSIFICATIONS = Object.freeze(['LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'RESTRICTED']);

const FREE_STRING_LIST_FIELDS = Object.freeze([
  'allowed_agent_ids', 'allowed_project_ids', 'allowed_session_reference_ids', 'allowed_plan_ids',
  'allowed_actor_ids', 'allowed_tool_reference_ids', 'allowed_workflow_reference_ids'
]);

const CROSS_BOUNDARY_SAFE_FLAGS = Object.freeze({
  cross_tenant_allowed: false,
  cross_organization_allowed: false,
  cross_project_allowed: false,
  cross_session_allowed: false
});

const MAX_LIST_ITEMS = 500;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;
// No '*', '?', regex metacharacters, or path/glob separators -- scope entries are exact ids only.
const WILDCARD_FREE_PATTERN = /^[A-Za-z0-9_:.-]+$/;

function isWildcardFreeStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every((item) => isNonEmptyString(item) && WILDCARD_FREE_PATTERN.test(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueEnumList(list, allowed, maxItems) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every((item) => allowed.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateExecutionAuthorizationScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['execution_authorization_scope_must_be_object'] };
  exactFields(scope, EXECUTION_AUTHORIZATION_SCOPE_FIELDS, 'execution_authorization_scope', errors);
  for (const field of ['scope_id', 'tenant_id', 'organization_id', 'scope_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(scope[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(scope.scope_version) || scope.scope_version < 1) errors.push('scope_version_invalid');
  for (const field of FREE_STRING_LIST_FIELDS) {
    if (!isWildcardFreeStringList(scope[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueEnumList(scope.allowed_actor_roles, ACTOR_ROLES, ACTOR_ROLES.length)) errors.push('allowed_actor_roles_invalid');
  if (!isOrderedUniqueEnumList(scope.allowed_task_types, TASK_TYPES, TASK_TYPES.length)) errors.push('allowed_task_types_invalid');
  if (!isOrderedUniqueEnumList(scope.allowed_risk_classifications, RISK_CLASSIFICATIONS, RISK_CLASSIFICATIONS.length)) errors.push('allowed_risk_classifications_invalid');
  if (!Number.isInteger(scope.maximum_authorized_cost_minor_units) || scope.maximum_authorized_cost_minor_units < 0 || scope.maximum_authorized_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('maximum_authorized_cost_minor_units_invalid');
  }
  if (!Number.isInteger(scope.maximum_authorized_tokens) || scope.maximum_authorized_tokens < 0 || scope.maximum_authorized_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('maximum_authorized_tokens_invalid');
  }
  for (const [field, expected] of Object.entries(CROSS_BOUNDARY_SAFE_FLAGS)) {
    if (scope[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (scope.validator_version !== EXECUTION_AUTHORIZATION_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(scope);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(scope));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeScopeFingerprint(scope) {
  const { scope_fingerprint, ...rest } = scope;
  return stablePayload(rest);
}

function buildExecutionAuthorizationScope(input = {}) {
  const scope = {
    scope_id: input.scope_id,
    scope_version: Number.isInteger(input.scope_version) ? input.scope_version : 1,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    allowed_agent_ids: uniqueSorted(input.allowed_agent_ids || []),
    allowed_project_ids: uniqueSorted(input.allowed_project_ids || []),
    allowed_session_reference_ids: uniqueSorted(input.allowed_session_reference_ids || []),
    allowed_plan_ids: uniqueSorted(input.allowed_plan_ids || []),
    allowed_actor_ids: uniqueSorted(input.allowed_actor_ids || []),
    allowed_actor_roles: uniqueSorted(input.allowed_actor_roles || []),
    allowed_task_types: uniqueSorted(input.allowed_task_types || []),
    allowed_risk_classifications: uniqueSorted(input.allowed_risk_classifications || []),
    allowed_tool_reference_ids: uniqueSorted(input.allowed_tool_reference_ids || []),
    allowed_workflow_reference_ids: uniqueSorted(input.allowed_workflow_reference_ids || []),
    maximum_authorized_cost_minor_units: Number.isInteger(input.maximum_authorized_cost_minor_units) ? input.maximum_authorized_cost_minor_units : 0,
    maximum_authorized_tokens: Number.isInteger(input.maximum_authorized_tokens) ? input.maximum_authorized_tokens : 0,
    cross_tenant_allowed: false,
    cross_organization_allowed: false,
    cross_project_allowed: false,
    cross_session_allowed: false,
    validator_version: EXECUTION_AUTHORIZATION_SCOPE_VALIDATOR_VERSION
  };
  scope.scope_fingerprint = computeScopeFingerprint({ ...scope, scope_fingerprint: undefined });

  const validation = validateExecutionAuthorizationScope(scope);
  if (!validation.valid) {
    throw new Error(`execution_authorization_scope_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(scope);
}

module.exports = {
  CROSS_BOUNDARY_SAFE_FLAGS,
  EXECUTION_AUTHORIZATION_SCOPE_FIELDS,
  EXECUTION_AUTHORIZATION_SCOPE_VALIDATOR_VERSION,
  FREE_STRING_LIST_FIELDS,
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_TOKENS_REFERENCE,
  RISK_CLASSIFICATIONS,
  WILDCARD_FREE_PATTERN,
  buildExecutionAuthorizationScope,
  computeScopeFingerprint,
  isOrderedUniqueEnumList,
  isWildcardFreeStringList,
  validateExecutionAuthorizationScope
};
