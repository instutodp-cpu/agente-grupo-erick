'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  AGENT_SLUG_PATTERN,
  exactFields,
  findAgentCoreOperationalMaterial,
  stablePayload
} = require('./agent-identity-contract');

const AGENT_CAPABILITY_CONTRACT_VALIDATOR_VERSION = 'agent_capability_contract_validator_v1';
const AGENT_CAPABILITY_FIELDS = Object.freeze([
  'capability_id',
  'capability_version',
  'agent_id',
  'tenant_id',
  'capability_type',
  'capability_slug',
  'description',
  'input_contract_ref',
  'output_contract_ref',
  'policy_refs',
  'dependency_refs',
  'declared',
  'enabled',
  'execution_allowed',
  'network_required',
  'tools_required',
  'memory_required',
  'llm_required',
  'simulation',
  'production_blocked',
  'rollout_percentage',
  'validator_version'
]);
const AGENT_CAPABILITY_TYPES = Object.freeze([
  'INFORMATION_RETRIEVAL',
  'ANALYSIS',
  'SUMMARIZATION',
  'CLASSIFICATION',
  'ROUTING',
  'AUDIT',
  'TRAINING',
  'PLANNING',
  'VALIDATION',
  'DOCUMENT_GENERATION_REFERENCE',
  'NOTIFICATION_REFERENCE',
  'TOOL_USE_REFERENCE',
  'MEMORY_USE_REFERENCE',
  'WORKFLOW_REFERENCE'
]);
const AGENT_CAPABILITY_SAFE_FLAGS = Object.freeze({
  declared: true,
  enabled: false,
  execution_allowed: false,
  network_required: false,
  tools_required: false,
  memory_required: false,
  llm_required: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});
const MAX_REF_ITEMS = 20;
const MAX_REF_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

function isOrderedUniqueRefList(list) {
  if (!Array.isArray(list) || list.length > MAX_REF_ITEMS) return false;
  if (!list.every((item) => isNonEmptyString(item) && item.length <= MAX_REF_LENGTH)) return false;
  const unique = new Set(list);
  if (unique.size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateAgentCapability(capability) {
  const errors = [];
  if (!isPlainObject(capability)) return { valid: false, errors: ['agent_capability_must_be_object'] };
  exactFields(capability, AGENT_CAPABILITY_FIELDS, 'agent_capability', errors);
  for (const field of ['capability_id', 'agent_id', 'tenant_id', 'capability_slug', 'description', 'input_contract_ref', 'output_contract_ref', 'validator_version']) {
    if (!isNonEmptyString(capability[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(capability.capability_version) || capability.capability_version < 1) errors.push('capability_version_invalid');
  if (!AGENT_CAPABILITY_TYPES.includes(capability.capability_type)) errors.push(`capability_type_not_allowed::${capability.capability_type}`);
  if (isNonEmptyString(capability.capability_slug) && !AGENT_SLUG_PATTERN.test(capability.capability_slug)) errors.push('capability_slug_not_normalized');
  if (isNonEmptyString(capability.description) && capability.description.length > MAX_DESCRIPTION_LENGTH) errors.push('description_too_long');
  if (!isOrderedUniqueRefList(capability.policy_refs)) errors.push('policy_refs_invalid');
  if (!isOrderedUniqueRefList(capability.dependency_refs)) errors.push('dependency_refs_invalid');
  for (const [field, expected] of Object.entries(AGENT_CAPABILITY_SAFE_FLAGS)) {
    if (capability[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (capability.validator_version !== AGENT_CAPABILITY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(capability);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(capability));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_CAPABILITY_CONTRACT_VALIDATOR_VERSION,
  AGENT_CAPABILITY_FIELDS,
  AGENT_CAPABILITY_SAFE_FLAGS,
  AGENT_CAPABILITY_TYPES,
  MAX_REF_ITEMS,
  isOrderedUniqueRefList,
  validateAgentCapability
};
