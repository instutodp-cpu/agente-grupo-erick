'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS, AGENT_RISK_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRequestSessionReference } = require('./agent-session-reference');
const { MEMORY_TYPES, RETENTION_CLASSES, FORBIDDEN_RETENTION_CLASSES } = require('./agent-memory-item-contract');
const { validateMemoryScope } = require('./agent-memory-scope');
const { validateMemoryPolicyReference } = require('./agent-memory-policy-reference');

const AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION = 'agent_memory_contract_validator_v1';
const AGENT_MEMORY_CONTRACT_FIELDS = Object.freeze([
  'memory_contract_id', 'memory_contract_version', 'agent_id', 'agent_version', 'tenant_id', 'organization_id',
  'session_reference', 'memory_types', 'memory_scope', 'policy_reference', 'retention_policy', 'classification',
  'risk_classification', 'retrieval_policy', 'simulation_context', 'contract_status', 'validator_version'
]);
const RETENTION_POLICY_FIELDS = Object.freeze(['retention_policy_id', 'retention_class', 'maximum_retention_sequences', 'retention_enforced', 'simulation', 'production_blocked', 'validator_version']);
const RETRIEVAL_POLICY_FIELDS = Object.freeze(['retrieval_policy_id', 'retrieval_allowed', 'ranking_allowed', 'similarity_allowed', 'simulation', 'production_blocked', 'validator_version']);
const AGENT_MEMORY_CONTRACT_STATUSES = Object.freeze([
  'VALIDATED_SIMULATION', 'INVALID', 'POLICY_BLOCKED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED',
  'CLASSIFICATION_BLOCKED', 'RETENTION_BLOCKED', 'VERSION_BLOCKED'
]);
const FORBIDDEN_AGENT_MEMORY_CONTRACT_STATUSES = Object.freeze(['ACTIVE', 'ENABLED', 'CONNECTED', 'PERSISTED', 'INDEXED', 'EXECUTABLE']);
const RETRIEVAL_POLICY_SAFE_FLAGS = Object.freeze({ retrieval_allowed: false, ranking_allowed: false, similarity_allowed: false });
const MAX_MEMORY_TYPES = MEMORY_TYPES.length;
const MAX_RETENTION_SEQUENCES = 1000000;

function isNormalizedMemoryTypesList(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MEMORY_TYPES) return false;
  if (!list.every((type) => MEMORY_TYPES.includes(type))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateRetentionPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['retention_policy_must_be_object'] };
  exactFields(policy, RETENTION_POLICY_FIELDS, 'retention_policy', errors);
  if (!isNonEmptyString(policy.retention_policy_id)) errors.push('retention_policy_id_invalid');
  if (!RETENTION_CLASSES.includes(policy.retention_class)) errors.push(`retention_class_not_allowed::${policy.retention_class}`);
  if (FORBIDDEN_RETENTION_CLASSES.includes(policy.retention_class)) errors.push(`retention_class_forbidden::${policy.retention_class}`);
  if (!Number.isInteger(policy.maximum_retention_sequences) || policy.maximum_retention_sequences < 0 || policy.maximum_retention_sequences > MAX_RETENTION_SEQUENCES) {
    errors.push('maximum_retention_sequences_invalid');
  }
  if (policy.retention_enforced !== true) errors.push('retention_enforced_must_be_true');
  if (policy.simulation !== true) errors.push('simulation_must_be_true');
  if (policy.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (policy.validator_version !== AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateRetrievalPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['retrieval_policy_must_be_object'] };
  exactFields(policy, RETRIEVAL_POLICY_FIELDS, 'retrieval_policy', errors);
  if (!isNonEmptyString(policy.retrieval_policy_id)) errors.push('retrieval_policy_id_invalid');
  for (const [field, expected] of Object.entries(RETRIEVAL_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.simulation !== true) errors.push('simulation_must_be_true');
  if (policy.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (policy.validator_version !== AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentMemoryContract(memory) {
  const errors = [];
  if (!isPlainObject(memory)) return { valid: false, errors: ['agent_memory_contract_must_be_object'] };
  exactFields(memory, AGENT_MEMORY_CONTRACT_FIELDS, 'agent_memory_contract', errors);
  for (const field of ['memory_contract_id', 'agent_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(memory[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(memory.memory_contract_version) || memory.memory_contract_version < 1) errors.push('memory_contract_version_invalid');
  if (!Number.isInteger(memory.agent_version) || memory.agent_version < 1) errors.push('agent_version_invalid');
  if (!isNormalizedMemoryTypesList(memory.memory_types)) errors.push('memory_types_invalid');
  if (!AGENT_DATA_CLASSIFICATIONS.includes(memory.classification)) errors.push(`classification_not_allowed::${memory.classification}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(memory.risk_classification)) errors.push(`risk_classification_not_allowed::${memory.risk_classification}`);
  if (!AGENT_MEMORY_CONTRACT_STATUSES.includes(memory.contract_status)) errors.push(`contract_status_not_allowed::${memory.contract_status}`);
  if (FORBIDDEN_AGENT_MEMORY_CONTRACT_STATUSES.includes(memory.contract_status)) errors.push(`contract_status_forbidden::${memory.contract_status}`);
  if (isNonEmptyString(memory.tenant_id) && isNonEmptyString(memory.organization_id) && !memory.organization_id.startsWith(`${memory.tenant_id}:`)) {
    errors.push('organization_id_not_compatible_with_tenant');
  }

  errors.push(...validateRequestSessionReference(memory.session_reference).errors.map((error) => `session_reference_${error}`));
  errors.push(...validateMemoryScope(memory.memory_scope).errors.map((error) => `memory_scope_${error}`));
  errors.push(...validateMemoryPolicyReference(memory.policy_reference).errors.map((error) => `policy_reference_${error}`));
  errors.push(...validateRetentionPolicy(memory.retention_policy).errors.map((error) => `retention_policy_${error}`));
  errors.push(...validateRetrievalPolicy(memory.retrieval_policy).errors.map((error) => `retrieval_policy_${error}`));
  errors.push(...validateAgentSimulationContext(memory.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (isPlainObject(memory.memory_scope) && memory.memory_scope.tenant_id && memory.tenant_id !== memory.memory_scope.tenant_id) {
    errors.push('scope_tenant_mismatch');
  }
  if (memory.classification === 'RESTRICTED') errors.push('classification_restricted_always_blocked');
  if (memory.validator_version !== AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(memory);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(memory));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_MEMORY_CONTRACT_FIELDS,
  AGENT_MEMORY_CONTRACT_STATUSES,
  AGENT_MEMORY_CONTRACT_VALIDATOR_VERSION,
  FORBIDDEN_AGENT_MEMORY_CONTRACT_STATUSES,
  MAX_RETENTION_SEQUENCES,
  RETENTION_POLICY_FIELDS,
  RETRIEVAL_POLICY_FIELDS,
  isNormalizedMemoryTypesList,
  validateAgentMemoryContract,
  validateRetentionPolicy,
  validateRetrievalPolicy
};
