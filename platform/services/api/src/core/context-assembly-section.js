'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const CONTEXT_ASSEMBLY_SECTION_VALIDATOR_VERSION = 'context_assembly_section_validator_v1';
const CONTEXT_ASSEMBLY_SECTION_FIELDS = Object.freeze([
  'section_id', 'section_version', 'section_type', 'source_reference_ids', 'source_count', 'priority', 'required',
  'estimated_tokens', 'allocated_tokens', 'included', 'trimmed', 'excluded', 'exclusion_reason_codes',
  'section_fingerprint', 'validator_version'
]);
const SECTION_TYPES = Object.freeze([
  'SYSTEM_SECTION', 'AGENT_SECTION', 'POLICY_SECTION', 'SESSION_SECTION', 'MEMORY_SECTION', 'TASK_SECTION',
  'USER_INPUT_SECTION', 'DOCUMENT_SECTION', 'TOOL_RESULT_SECTION', 'WORKFLOW_SECTION', 'MODEL_SELECTION_SECTION',
  'AUDIT_SECTION'
]);
const MAX_PRIORITY = 1000;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_SOURCE_REFERENCE_IDS = 500;
const MAX_REASON_CODES = 50;

function isOrderedUniqueStringList(list, maxItems) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateContextAssemblySection(section) {
  const errors = [];
  if (!isPlainObject(section)) return { valid: false, errors: ['section_must_be_object'] };
  exactFields(section, CONTEXT_ASSEMBLY_SECTION_FIELDS, 'section', errors);
  for (const field of ['section_id', 'section_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(section[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(section.section_version) || section.section_version < 1) errors.push('section_version_invalid');
  if (!SECTION_TYPES.includes(section.section_type)) errors.push(`section_type_not_allowed::${section.section_type}`);
  if (!isOrderedUniqueStringList(section.source_reference_ids, MAX_SOURCE_REFERENCE_IDS)) errors.push('source_reference_ids_invalid');
  if (!Number.isInteger(section.source_count) || section.source_count < 0) errors.push('source_count_invalid');
  if (Array.isArray(section.source_reference_ids) && Number.isInteger(section.source_count) && section.source_reference_ids.length !== section.source_count) {
    errors.push('source_count_mismatch');
  }
  if (!Number.isInteger(section.priority) || section.priority < 0 || section.priority > MAX_PRIORITY) errors.push('priority_invalid');
  if (typeof section.required !== 'boolean') errors.push('required_must_be_boolean');
  for (const field of ['estimated_tokens', 'allocated_tokens']) {
    if (!Number.isInteger(section[field]) || section[field] < 0 || section[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  for (const field of ['included', 'trimmed', 'excluded']) {
    if (typeof section[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof section.included === 'boolean' && typeof section.trimmed === 'boolean' && typeof section.excluded === 'boolean') {
    const trueCount = [section.included, section.trimmed, section.excluded].filter(Boolean).length;
    if (trueCount !== 1) errors.push('included_trimmed_excluded_must_be_mutually_exclusive');
  }
  if (!isOrderedUniqueStringList(section.exclusion_reason_codes, MAX_REASON_CODES)) errors.push('exclusion_reason_codes_invalid');
  if (section.excluded === true && Array.isArray(section.exclusion_reason_codes) && section.exclusion_reason_codes.length === 0) {
    errors.push('exclusion_reason_codes_required_when_excluded');
  }
  if (section.excluded === false && Array.isArray(section.exclusion_reason_codes) && section.exclusion_reason_codes.length > 0) {
    errors.push('exclusion_reason_codes_must_be_empty_when_not_excluded');
  }
  if (section.validator_version !== CONTEXT_ASSEMBLY_SECTION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(section);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(section));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CONTEXT_ASSEMBLY_SECTION_FIELDS,
  CONTEXT_ASSEMBLY_SECTION_VALIDATOR_VERSION,
  MAX_PRIORITY,
  MAX_REASON_CODES,
  MAX_SOURCE_REFERENCE_IDS,
  MAX_TOKENS_REFERENCE,
  SECTION_TYPES,
  isOrderedUniqueStringList,
  validateContextAssemblySection
};
