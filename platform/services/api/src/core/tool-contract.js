'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const TOOL_CONTRACT_VALIDATOR_VERSION = 'tool_contract_validator_v1';
const TOOL_FIELDS = Object.freeze([
  'tool_id', 'tool_version', 'tenant_id', 'organization_id', 'category', 'display_name', 'description',
  'tool_status', 'simulation', 'production_blocked', 'validator_version'
]);
const TOOL_CATEGORIES = Object.freeze([
  'LOCAL_REFERENCE', 'HTTP_REFERENCE', 'DATABASE_REFERENCE', 'MCP_REFERENCE', 'LLM_REFERENCE',
  'FILESYSTEM_REFERENCE', 'MESSAGE_REFERENCE', 'EMAIL_REFERENCE', 'CALENDAR_REFERENCE', 'SEARCH_REFERENCE',
  'CUSTOM_REFERENCE'
]);
const TOOL_STATUSES = Object.freeze(['DRAFT', 'VALIDATED_SIMULATION', 'DEPRECATED_REFERENCE', 'ARCHIVED']);
const FORBIDDEN_TOOL_STATUSES = Object.freeze(['ACTIVE', 'CONNECTED', 'ENABLED', 'LIVE', 'PRODUCTION', 'AUTHENTICATED']);

function validateToolContract(tool) {
  const errors = [];
  if (!isPlainObject(tool)) return { valid: false, errors: ['tool_must_be_object'] };
  exactFields(tool, TOOL_FIELDS, 'tool', errors);
  for (const field of ['tool_id', 'tenant_id', 'organization_id', 'display_name', 'description', 'validator_version']) {
    if (!isNonEmptyString(tool[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(tool.tool_version) || tool.tool_version < 1) errors.push('tool_version_invalid');
  if (!TOOL_CATEGORIES.includes(tool.category)) errors.push(`category_not_allowed::${tool.category}`);
  if (!TOOL_STATUSES.includes(tool.tool_status)) errors.push(`tool_status_not_allowed::${tool.tool_status}`);
  if (FORBIDDEN_TOOL_STATUSES.includes(tool.tool_status)) errors.push(`tool_status_forbidden::${tool.tool_status}`);
  if (tool.simulation !== true) errors.push('simulation_must_be_true');
  if (tool.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (
    isNonEmptyString(tool.tenant_id) && isNonEmptyString(tool.organization_id) &&
    !tool.organization_id.startsWith(`${tool.tenant_id}:`)
  ) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (tool.validator_version !== TOOL_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(tool);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(tool));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  FORBIDDEN_TOOL_STATUSES,
  TOOL_CATEGORIES,
  TOOL_CONTRACT_VALIDATOR_VERSION,
  TOOL_FIELDS,
  TOOL_STATUSES,
  validateToolContract
};
