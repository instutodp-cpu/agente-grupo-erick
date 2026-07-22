'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS, AGENT_RISK_CLASSIFICATIONS } = require('./agent-metadata-contract');

const CONTEXT_ASSEMBLY_SOURCE_REFERENCE_VALIDATOR_VERSION = 'context_assembly_source_reference_validator_v1';
const SOURCE_REFERENCE_FIELDS = Object.freeze([
  'source_reference_id', 'source_reference_version', 'source_type', 'source_origin', 'tenant_id', 'organization_id',
  'agent_id', 'session_reference_id', 'memory_reference_id', 'content_reference_id', 'content_present',
  'content_loaded', 'content_included', 'classification', 'risk_classification', 'priority', 'estimated_tokens',
  'maximum_tokens', 'required', 'shareable', 'trusted_reference', 'source_fingerprint', 'validator_version'
]);
const SOURCE_TYPES = Object.freeze([
  'SYSTEM_INSTRUCTION_REFERENCE', 'AGENT_IDENTITY_REFERENCE', 'AGENT_METADATA_REFERENCE', 'POLICY_REFERENCE',
  'SESSION_REFERENCE', 'CONVERSATION_REFERENCE', 'MEMORY_REFERENCE', 'TASK_REFERENCE', 'USER_INPUT_REFERENCE',
  'DOCUMENT_REFERENCE', 'TOOL_RESULT_REFERENCE', 'WORKFLOW_REFERENCE', 'MODEL_SELECTION_REFERENCE', 'AUDIT_REFERENCE'
]);
const SOURCE_ORIGINS = Object.freeze([
  'SYSTEM_REFERENCE', 'TENANT_REFERENCE', 'ORGANIZATION_REFERENCE', 'AGENT_REFERENCE', 'SESSION_REFERENCE',
  'MEMORY_REFERENCE', 'USER_REFERENCE', 'TOOL_REFERENCE', 'WORKFLOW_REFERENCE'
]);
const MAX_PRIORITY = 1000;
const MAX_TOKENS_REFERENCE = 100000000;

function validateContextAssemblySourceReference(source) {
  const errors = [];
  if (!isPlainObject(source)) return { valid: false, errors: ['source_reference_must_be_object'] };
  exactFields(source, SOURCE_REFERENCE_FIELDS, 'source_reference', errors);
  for (const field of [
    'source_reference_id', 'tenant_id', 'organization_id', 'agent_id', 'session_reference_id', 'memory_reference_id',
    'content_reference_id', 'source_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(source[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(source.source_reference_version) || source.source_reference_version < 1) errors.push('source_reference_version_invalid');
  if (!SOURCE_TYPES.includes(source.source_type)) errors.push(`source_type_not_allowed::${source.source_type}`);
  if (!SOURCE_ORIGINS.includes(source.source_origin)) errors.push(`source_origin_not_allowed::${source.source_origin}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(source.classification)) errors.push(`classification_not_allowed::${source.classification}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(source.risk_classification)) errors.push(`risk_classification_not_allowed::${source.risk_classification}`);
  if (!Number.isInteger(source.priority) || source.priority < 0 || source.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['estimated_tokens', 'maximum_tokens']) {
    if (!Number.isInteger(source[field]) || source[field] < 0 || source[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(source.estimated_tokens) && Number.isInteger(source.maximum_tokens) &&
    source.estimated_tokens > source.maximum_tokens
  ) {
    errors.push('estimated_tokens_exceeds_maximum_tokens');
  }
  for (const field of ['required', 'shareable', 'trusted_reference']) {
    if (typeof source[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (source.content_present !== false) errors.push('content_present_must_be_false');
  if (source.content_loaded !== false) errors.push('content_loaded_must_be_false');
  if (source.content_included !== false) errors.push('content_included_must_be_false');
  if (source.validator_version !== CONTEXT_ASSEMBLY_SOURCE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (
    isNonEmptyString(source.tenant_id) && isNonEmptyString(source.organization_id) &&
    !source.organization_id.startsWith(`${source.tenant_id}:`)
  ) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  try {
    stablePayload(source);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(source));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CONTEXT_ASSEMBLY_SOURCE_REFERENCE_VALIDATOR_VERSION,
  MAX_PRIORITY,
  MAX_TOKENS_REFERENCE,
  SOURCE_ORIGINS,
  SOURCE_REFERENCE_FIELDS,
  SOURCE_TYPES,
  validateContextAssemblySourceReference
};
