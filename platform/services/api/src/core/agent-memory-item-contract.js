'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS, AGENT_RISK_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');

const AGENT_MEMORY_ITEM_VALIDATOR_VERSION = 'agent_memory_item_contract_validator_v1';
const AGENT_MEMORY_ITEM_FIELDS = Object.freeze([
  'memory_item_id', 'memory_item_version', 'memory_type', 'agent_id', 'tenant_id', 'organization_id',
  'session_reference_id', 'subject_reference_id', 'source_reference_id', 'content_reference_id',
  'content_present', 'content_loaded', 'content_stored', 'content_indexed', 'classification',
  'risk_classification', 'retention_class', 'importance_level', 'confidence_reference', 'created_sequence',
  'last_updated_sequence', 'memory_fingerprint', 'simulation_context', 'validator_version'
]);
const MEMORY_TYPES = Object.freeze([
  'WORKING_MEMORY_REFERENCE', 'EPISODIC_MEMORY_REFERENCE', 'SEMANTIC_MEMORY_REFERENCE',
  'PROCEDURAL_MEMORY_REFERENCE', 'PROFILE_MEMORY_REFERENCE', 'AUDIT_MEMORY_REFERENCE'
]);
const RETENTION_CLASSES = Object.freeze([
  'EPHEMERAL_REFERENCE', 'SESSION_REFERENCE', 'SHORT_TERM_REFERENCE', 'LONG_TERM_REFERENCE', 'PERMANENT_REFERENCE_BLOCKED'
]);
const FORBIDDEN_RETENTION_CLASSES = Object.freeze(['PERMANENT_REFERENCE_BLOCKED']);
const IMPORTANCE_LEVELS = Object.freeze(['LOW', 'NORMAL', 'HIGH', 'CRITICAL_REFERENCE']);
const AGENT_MEMORY_ITEM_SAFE_FLAGS = Object.freeze({
  content_present: false,
  content_loaded: false,
  content_stored: false,
  content_indexed: false
});
const MAX_CONFIDENCE_REFERENCE = 100;

function validateAgentMemoryItemContract(item) {
  const errors = [];
  if (!isPlainObject(item)) return { valid: false, errors: ['agent_memory_item_must_be_object'] };
  exactFields(item, AGENT_MEMORY_ITEM_FIELDS, 'agent_memory_item', errors);
  for (const field of ['memory_item_id', 'agent_id', 'tenant_id', 'organization_id', 'session_reference_id', 'subject_reference_id', 'source_reference_id', 'content_reference_id', 'memory_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(item[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(item.memory_item_version) || item.memory_item_version < 1) errors.push('memory_item_version_invalid');
  if (!MEMORY_TYPES.includes(item.memory_type)) errors.push(`memory_type_not_allowed::${item.memory_type}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(item.classification)) errors.push(`classification_not_allowed::${item.classification}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(item.risk_classification)) errors.push(`risk_classification_not_allowed::${item.risk_classification}`);
  if (!RETENTION_CLASSES.includes(item.retention_class)) errors.push(`retention_class_not_allowed::${item.retention_class}`);
  if (FORBIDDEN_RETENTION_CLASSES.includes(item.retention_class)) errors.push(`retention_class_forbidden::${item.retention_class}`);
  if (!IMPORTANCE_LEVELS.includes(item.importance_level)) errors.push(`importance_level_not_allowed::${item.importance_level}`);
  if (!Number.isInteger(item.confidence_reference) || item.confidence_reference < 0 || item.confidence_reference > MAX_CONFIDENCE_REFERENCE) {
    errors.push('confidence_reference_invalid');
  }
  if (!Number.isInteger(item.created_sequence) || item.created_sequence < 0) errors.push('created_sequence_invalid');
  if (!Number.isInteger(item.last_updated_sequence) || item.last_updated_sequence < 0) errors.push('last_updated_sequence_invalid');
  if (
    Number.isInteger(item.created_sequence) && Number.isInteger(item.last_updated_sequence) &&
    item.last_updated_sequence < item.created_sequence
  ) {
    errors.push('last_updated_sequence_before_created_sequence');
  }
  for (const [field, expected] of Object.entries(AGENT_MEMORY_ITEM_SAFE_FLAGS)) {
    if (item[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  errors.push(...validateAgentSimulationContext(item.simulation_context).errors.map((error) => `simulation_context_${error}`));
  if (item.validator_version !== AGENT_MEMORY_ITEM_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(item);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(item));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_MEMORY_ITEM_FIELDS,
  AGENT_MEMORY_ITEM_SAFE_FLAGS,
  AGENT_MEMORY_ITEM_VALIDATOR_VERSION,
  FORBIDDEN_RETENTION_CLASSES,
  IMPORTANCE_LEVELS,
  MAX_CONFIDENCE_REFERENCE,
  MEMORY_TYPES,
  RETENTION_CLASSES,
  validateAgentMemoryItemContract
};
