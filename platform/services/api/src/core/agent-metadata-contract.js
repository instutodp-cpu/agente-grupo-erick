'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  exactFields,
  findAgentCoreOperationalMaterial,
  stablePayload
} = require('./agent-identity-contract');

const AGENT_METADATA_CONTRACT_VALIDATOR_VERSION = 'agent_metadata_contract_validator_v1';
const AGENT_METADATA_FIELDS = Object.freeze([
  'metadata_id',
  'agent_id',
  'tenant_id',
  'category',
  'tags',
  'business_domain',
  'supported_locales',
  'declared_purpose',
  'risk_classification',
  'data_classification',
  'compliance_labels',
  'metadata_version',
  'validator_version'
]);
const AGENT_CATEGORIES = Object.freeze([
  'GENERAL',
  'FINANCE',
  'RETAIL',
  'PHARMACY',
  'ENGINEERING',
  'HUMAN_RESOURCES',
  'TRAINING',
  'LOGISTICS',
  'LOTTERY',
  'MARKETING',
  'AUDIT',
  'SYSTEM'
]);
const AGENT_RISK_CLASSIFICATIONS = Object.freeze(['LOW', 'MODERATE', 'HIGH', 'RESTRICTED']);
const AGENT_DATA_CLASSIFICATIONS = Object.freeze(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
const MAX_LIST_ITEMS = 20;
const MAX_ITEM_LENGTH = 80;
const MAX_DECLARED_PURPOSE_LENGTH = 500;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const LABEL_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isNormalizedStringList(list, pattern) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_LIST_ITEMS) return false;
  if (!list.every((item) => isNonEmptyString(item) && item.length <= MAX_ITEM_LENGTH)) return false;
  if (pattern && !list.every((item) => pattern.test(item))) return false;
  const unique = new Set(list);
  if (unique.size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateAgentMetadata(metadata) {
  const errors = [];
  if (!isPlainObject(metadata)) return { valid: false, errors: ['agent_metadata_must_be_object'] };
  exactFields(metadata, AGENT_METADATA_FIELDS, 'agent_metadata', errors);
  for (const field of ['metadata_id', 'agent_id', 'tenant_id', 'business_domain', 'declared_purpose', 'validator_version']) {
    if (!isNonEmptyString(metadata[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(metadata.metadata_version) || metadata.metadata_version < 1) errors.push('metadata_version_invalid');
  if (!AGENT_CATEGORIES.includes(metadata.category)) errors.push(`category_not_allowed::${metadata.category}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(metadata.risk_classification)) errors.push(`risk_classification_not_allowed::${metadata.risk_classification}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(metadata.data_classification)) errors.push(`data_classification_not_allowed::${metadata.data_classification}`);
  if (isNonEmptyString(metadata.declared_purpose) && metadata.declared_purpose.length > MAX_DECLARED_PURPOSE_LENGTH) errors.push('declared_purpose_too_long');
  if (!isNormalizedStringList(metadata.tags, LABEL_PATTERN)) errors.push('tags_invalid');
  if (!isNormalizedStringList(metadata.supported_locales, LOCALE_PATTERN)) errors.push('supported_locales_invalid');
  if (!isNormalizedStringList(metadata.compliance_labels, LABEL_PATTERN)) errors.push('compliance_labels_invalid');
  if (metadata.validator_version !== AGENT_METADATA_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(metadata);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(metadata));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_CATEGORIES,
  AGENT_DATA_CLASSIFICATIONS,
  AGENT_METADATA_CONTRACT_VALIDATOR_VERSION,
  AGENT_METADATA_FIELDS,
  AGENT_RISK_CLASSIFICATIONS,
  LABEL_PATTERN,
  LOCALE_PATTERN,
  MAX_LIST_ITEMS,
  validateAgentMetadata
};
