'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ITEM_TYPES, SCOPE_TYPES, isOrderedUniqueStringList } = require('./memory-selection-item-reference');

const MEMORY_SELECTION_POLICY_VALIDATOR_VERSION = 'memory_selection_policy_validator_v1';

const MEMORY_SELECTION_POLICY_FIELDS = Object.freeze([
  'policy_id', 'policy_version', 'required_item_types', 'required_preference_types', 'required_scope_types',
  'preserve_explicit_preferences', 'preserve_project_state', 'preserve_continuity', 'preserve_pending_tasks',
  'preserve_applicable_decisions', 'allow_relevant_omission', 'allow_optional_omission', 'allow_required_omission',
  'fail_on_high_risk_omission', 'fail_on_critical_risk_omission', 'fail_on_conflict', 'exclude_superseded',
  'deduplicate_by_fingerprint', 'prefer_hierarchical_summaries', 'maximum_references', 'maximum_relevant_references',
  'maximum_optional_references', 'simulation', 'production_blocked', 'validator_version'
]);

const MEMORY_SELECTION_POLICY_SAFE_FLAGS = Object.freeze({
  preserve_explicit_preferences: true,
  preserve_project_state: true,
  preserve_continuity: true,
  preserve_pending_tasks: true,
  preserve_applicable_decisions: true,
  allow_required_omission: false,
  fail_on_high_risk_omission: true,
  fail_on_critical_risk_omission: true,
  fail_on_conflict: true,
  exclude_superseded: true,
  deduplicate_by_fingerprint: true,
  prefer_hierarchical_summaries: true,
  simulation: true,
  production_blocked: true
});

const MAX_REFERENCE_BOUND = 10000;

function validateSelectionPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['selection_policy_must_be_object'] };
  exactFields(policy, MEMORY_SELECTION_POLICY_FIELDS, 'selection_policy', errors);
  for (const field of ['policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.policy_version) || policy.policy_version < 1) errors.push('policy_version_invalid');
  if (!isOrderedUniqueStringList(policy.required_item_types) || !policy.required_item_types.every((type) => ITEM_TYPES.includes(type))) {
    errors.push('required_item_types_invalid');
  }
  if (!isOrderedUniqueStringList(policy.required_preference_types) || !policy.required_preference_types.every((type) => ITEM_TYPES.includes(type))) {
    errors.push('required_preference_types_invalid');
  }
  if (!isOrderedUniqueStringList(policy.required_scope_types) || !policy.required_scope_types.every((type) => SCOPE_TYPES.includes(type))) {
    errors.push('required_scope_types_invalid');
  }
  for (const field of ['allow_relevant_omission', 'allow_optional_omission']) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(MEMORY_SELECTION_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  for (const field of ['maximum_references', 'maximum_relevant_references', 'maximum_optional_references']) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_REFERENCE_BOUND) errors.push(`${field}_invalid`);
  }
  if (policy.validator_version !== MEMORY_SELECTION_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_REFERENCE_BOUND,
  MEMORY_SELECTION_POLICY_FIELDS,
  MEMORY_SELECTION_POLICY_SAFE_FLAGS,
  MEMORY_SELECTION_POLICY_VALIDATOR_VERSION,
  validateSelectionPolicy
};
