'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const CONTEXT_ASSEMBLY_POLICY_VALIDATOR_VERSION = 'context_assembly_policy_validator_v1';
const ASSEMBLY_POLICY_FIELDS = Object.freeze([
  'assembly_policy_id', 'assembly_policy_version', 'allow_system_instruction_reference',
  'allow_agent_identity_reference', 'allow_agent_metadata_reference', 'allow_policy_reference',
  'allow_session_reference', 'allow_conversation_reference', 'allow_memory_reference', 'allow_task_reference',
  'allow_user_input_reference', 'allow_document_reference', 'allow_tool_result_reference', 'allow_workflow_reference',
  'allow_model_selection_reference', 'allow_audit_reference', 'allow_confidential', 'allow_cross_session',
  'allow_cross_agent', 'allow_untrusted_reference', 'require_policy_reference', 'require_session_reference',
  'require_task_reference', 'require_model_selection_reference', 'maximum_sources', 'maximum_sections',
  'deduplicate_sources', 'trim_optional_sources', 'fail_on_required_source_exclusion', 'simulation',
  'production_blocked', 'validator_version'
]);
const BOOLEAN_FIELDS = Object.freeze([
  'allow_system_instruction_reference', 'allow_agent_identity_reference', 'allow_agent_metadata_reference',
  'allow_policy_reference', 'allow_session_reference', 'allow_conversation_reference', 'allow_memory_reference',
  'allow_task_reference', 'allow_user_input_reference', 'allow_document_reference', 'allow_tool_result_reference',
  'allow_workflow_reference', 'allow_model_selection_reference', 'allow_audit_reference', 'allow_confidential',
  'allow_cross_session', 'allow_cross_agent', 'allow_untrusted_reference', 'require_policy_reference',
  'require_session_reference', 'require_task_reference', 'require_model_selection_reference',
  'deduplicate_sources', 'trim_optional_sources', 'fail_on_required_source_exclusion'
]);
const MAX_SOURCES = 500;
const MAX_SECTIONS = 100;

function validateContextAssemblyPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['assembly_policy_must_be_object'] };
  exactFields(policy, ASSEMBLY_POLICY_FIELDS, 'assembly_policy', errors);
  for (const field of ['assembly_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.assembly_policy_version) || policy.assembly_policy_version < 1) errors.push('assembly_policy_version_invalid');
  for (const field of BOOLEAN_FIELDS) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!Number.isInteger(policy.maximum_sources) || policy.maximum_sources < 1 || policy.maximum_sources > MAX_SOURCES) errors.push('maximum_sources_invalid');
  if (!Number.isInteger(policy.maximum_sections) || policy.maximum_sections < 1 || policy.maximum_sections > MAX_SECTIONS) errors.push('maximum_sections_invalid');
  if (policy.allow_cross_session !== false) errors.push('allow_cross_session_must_be_false');
  if (policy.allow_cross_agent !== false) errors.push('allow_cross_agent_must_be_false');
  if (policy.simulation !== true) errors.push('simulation_must_be_true');
  if (policy.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (policy.validator_version !== CONTEXT_ASSEMBLY_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  ASSEMBLY_POLICY_FIELDS,
  CONTEXT_ASSEMBLY_POLICY_VALIDATOR_VERSION,
  MAX_SECTIONS,
  MAX_SOURCES,
  validateContextAssemblyPolicy
};
