'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { MEMORY_TYPES } = require('./agent-memory-item-contract');

const AGENT_MEMORY_RETRIEVAL_REFERENCE_VALIDATOR_VERSION = 'agent_memory_retrieval_reference_validator_v1';
const AGENT_MEMORY_RETRIEVAL_REFERENCE_FIELDS = Object.freeze([
  'retrieval_reference_id', 'memory_contract_id', 'tenant_id', 'organization_id', 'agent_id', 'session_reference_id',
  'requested_memory_types', 'query_reference_id', 'query_present', 'query_loaded', 'retrieval_requested',
  'retrieval_executed', 'results_loaded', 'result_count_reference', 'ranking_requested', 'ranking_executed',
  'similarity_requested', 'similarity_executed', 'retrieval_fingerprint', 'validator_version'
]);
const AGENT_MEMORY_RETRIEVAL_REFERENCE_SAFE_FLAGS = Object.freeze({
  query_present: false,
  query_loaded: false,
  retrieval_requested: true,
  retrieval_executed: false,
  results_loaded: false,
  result_count_reference: 0,
  ranking_executed: false,
  similarity_executed: false
});
const MAX_REQUESTED_MEMORY_TYPES = 6;

function isNormalizedMemoryTypeList(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_REQUESTED_MEMORY_TYPES) return false;
  if (!list.every((type) => MEMORY_TYPES.includes(type))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateRetrievalReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['retrieval_reference_must_be_object'] };
  exactFields(reference, AGENT_MEMORY_RETRIEVAL_REFERENCE_FIELDS, 'retrieval_reference', errors);
  for (const field of ['retrieval_reference_id', 'memory_contract_id', 'tenant_id', 'organization_id', 'agent_id', 'session_reference_id', 'query_reference_id', 'retrieval_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!isNormalizedMemoryTypeList(reference.requested_memory_types)) errors.push('requested_memory_types_invalid');
  for (const field of ['ranking_requested', 'similarity_requested']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(AGENT_MEMORY_RETRIEVAL_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== AGENT_MEMORY_RETRIEVAL_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_MEMORY_RETRIEVAL_REFERENCE_FIELDS,
  AGENT_MEMORY_RETRIEVAL_REFERENCE_SAFE_FLAGS,
  AGENT_MEMORY_RETRIEVAL_REFERENCE_VALIDATOR_VERSION,
  MAX_REQUESTED_MEMORY_TYPES,
  isNormalizedMemoryTypeList,
  validateRetrievalReference
};
