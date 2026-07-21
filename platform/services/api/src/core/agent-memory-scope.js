'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES } = require('./agent-context-contract');
const { AGENT_DATA_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { MEMORY_TYPES } = require('./agent-memory-item-contract');

const AGENT_MEMORY_SCOPE_VALIDATOR_VERSION = 'agent_memory_scope_validator_v1';
const AGENT_MEMORY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'allowed_agent_ids', 'allowed_session_reference_ids', 'allowed_actor_roles',
  'allowed_memory_types', 'allowed_classifications', 'cross_tenant_allowed', 'cross_organization_allowed',
  'shared_between_agents', 'shared_between_sessions', 'validator_version'
]);
const MAX_SCOPE_ITEMS = 50;
const MAX_SCOPE_ITEM_LENGTH = 120;
const UNSAFE_SCOPE_TOKEN_PATTERN = /[*?[\]().^$+|\\{}]/;

function isNormalizedScopeList(list, allowedValues) {
  if (!Array.isArray(list) || list.length > MAX_SCOPE_ITEMS) return false;
  if (!list.every((item) => isNonEmptyString(item) && item.length <= MAX_SCOPE_ITEM_LENGTH && !UNSAFE_SCOPE_TOKEN_PATTERN.test(item) && item !== '*')) return false;
  if (allowedValues && !list.every((item) => allowedValues.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateMemoryScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['memory_scope_must_be_object'] };
  exactFields(scope, AGENT_MEMORY_SCOPE_FIELDS, 'memory_scope', errors);
  for (const field of ['tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(scope[field])) errors.push(`${field}_invalid`);
  }
  if (!isNormalizedScopeList(scope.allowed_agent_ids)) errors.push('allowed_agent_ids_invalid');
  if (!isNormalizedScopeList(scope.allowed_session_reference_ids)) errors.push('allowed_session_reference_ids_invalid');
  if (!isNormalizedScopeList(scope.allowed_actor_roles, ACTOR_ROLES)) errors.push('allowed_actor_roles_invalid');
  if (!isNormalizedScopeList(scope.allowed_memory_types, MEMORY_TYPES)) errors.push('allowed_memory_types_invalid');
  if (!isNormalizedScopeList(scope.allowed_classifications, AGENT_DATA_CLASSIFICATIONS)) errors.push('allowed_classifications_invalid');
  if (scope.cross_tenant_allowed !== false) errors.push('cross_tenant_allowed_must_be_false');
  if (scope.cross_organization_allowed !== false) errors.push('cross_organization_allowed_must_be_false');
  if (typeof scope.shared_between_agents !== 'boolean') errors.push('shared_between_agents_must_be_boolean');
  if (typeof scope.shared_between_sessions !== 'boolean') errors.push('shared_between_sessions_must_be_boolean');
  if (scope.validator_version !== AGENT_MEMORY_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(scope);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(scope));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function matchesMemoryScope(scope, candidate) {
  if (!isPlainObject(scope) || !isPlainObject(candidate)) return false;
  return (
    scope.tenant_id === candidate.tenant_id &&
    scope.organization_id === candidate.organization_id &&
    Array.isArray(scope.allowed_agent_ids) && scope.allowed_agent_ids.includes(candidate.agent_id) &&
    Array.isArray(scope.allowed_session_reference_ids) && scope.allowed_session_reference_ids.includes(candidate.session_reference_id) &&
    Array.isArray(scope.allowed_actor_roles) && scope.allowed_actor_roles.includes(candidate.actor_role) &&
    Array.isArray(scope.allowed_memory_types) && candidate.memory_types.every((type) => scope.allowed_memory_types.includes(type)) &&
    Array.isArray(scope.allowed_classifications) && scope.allowed_classifications.includes(candidate.classification)
  );
}

module.exports = {
  AGENT_MEMORY_SCOPE_FIELDS,
  AGENT_MEMORY_SCOPE_VALIDATOR_VERSION,
  MAX_SCOPE_ITEMS,
  isNormalizedScopeList,
  matchesMemoryScope,
  validateMemoryScope
};
