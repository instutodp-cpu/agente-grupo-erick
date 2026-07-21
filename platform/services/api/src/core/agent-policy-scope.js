'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  exactFields,
  findAgentCoreOperationalMaterial,
  stablePayload
} = require('./agent-identity-contract');
const { AGENT_TYPES } = require('./agent-identity-contract');
const { AGENT_RISK_CLASSIFICATIONS, AGENT_DATA_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { ACTOR_TYPES, ACTOR_ROLES, AGENT_CHANNELS } = require('./agent-context-contract');

const AGENT_POLICY_SCOPE_VALIDATOR_VERSION = 'agent_policy_scope_validator_v1';
const SUBJECT_SCOPE_FIELDS = Object.freeze(['tenant_ids', 'organization_ids', 'agent_ids', 'agent_types', 'actor_types', 'actor_roles', 'validator_version']);
const RESOURCE_SCOPE_FIELDS = Object.freeze(['resource_types', 'resource_ids', 'resource_classifications', 'resource_domains', 'validator_version']);
const ACTION_SCOPE_FIELDS = Object.freeze(['actions', 'validator_version']);
const RISK_SCOPE_FIELDS = Object.freeze(['allowed_risk_classifications', 'maximum_risk_classification', 'requires_approval_above', 'validator_version']);
const DATA_SCOPE_FIELDS = Object.freeze(['allowed_data_classifications', 'maximum_data_classification', 'restricted_fields_present', 'personal_data_present', 'sensitive_data_present', 'secret_material_present', 'validator_version']);
const CHANNEL_SCOPE_FIELDS = Object.freeze(['allowed_channels', 'denied_channels', 'validator_version']);

const RESOURCE_TYPES = Object.freeze([
  'AGENT', 'CAPABILITY', 'CONTEXT', 'SESSION_REFERENCE', 'CONVERSATION_REFERENCE',
  'DOCUMENT_REFERENCE', 'DATA_REFERENCE', 'TOOL_REFERENCE', 'MEMORY_REFERENCE',
  'WORKFLOW_REFERENCE', 'MODEL_REFERENCE', 'BUDGET_REFERENCE'
]);
const ACTIONS = Object.freeze([
  'VALIDATE', 'READ_REFERENCE', 'LIST_REFERENCE', 'ANALYZE_REFERENCE', 'SUMMARIZE_REFERENCE',
  'CLASSIFY_REFERENCE', 'ROUTE_REFERENCE', 'PLAN_REFERENCE', 'GENERATE_DOCUMENT_REFERENCE',
  'REQUEST_TOOL_REFERENCE', 'REQUEST_MEMORY_REFERENCE', 'REQUEST_WORKFLOW_REFERENCE', 'REQUEST_MODEL_REFERENCE'
]);
const FORBIDDEN_ACTIONS = Object.freeze(['EXECUTE', 'RUN', 'ACTIVATE', 'CALL', 'INVOKE', 'WRITE_REAL', 'DELETE_REAL', 'TRANSFER', 'SEND_REAL', 'CHARGE', 'DEPLOY']);
const RISK_ORDER = Object.freeze({ LOW: 0, MODERATE: 1, HIGH: 2, RESTRICTED: 3 });
const DATA_ORDER = Object.freeze({ PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 });
const MAX_SCOPE_ITEMS = 50;
const MAX_SCOPE_ITEM_LENGTH = 120;
const UNSAFE_SCOPE_TOKEN_PATTERN = /[*?[\]().^$+|\\{}]/;

function exactList(list) {
  return {
    valid: Array.isArray(list) && list.length <= MAX_SCOPE_ITEMS &&
      list.every((item) => isNonEmptyString(item) && item.length <= MAX_SCOPE_ITEM_LENGTH && !UNSAFE_SCOPE_TOKEN_PATTERN.test(item) && item !== '*') &&
      new Set(list).size === list.length &&
      list.every((item, index) => item === [...list].sort()[index])
  };
}

function isNormalizedScopeList(list) {
  return exactList(list).valid;
}

function isNormalizedEnumScopeList(list, allowedValues) {
  return isNormalizedScopeList(list) && list.every((item) => allowedValues.includes(item));
}

function validateSubjectScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['subject_scope_must_be_object'] };
  exactFields(scope, SUBJECT_SCOPE_FIELDS, 'subject_scope', errors);
  if (!isNormalizedScopeList(scope.tenant_ids)) errors.push('tenant_ids_invalid');
  if (!isNormalizedScopeList(scope.organization_ids)) errors.push('organization_ids_invalid');
  if (!isNormalizedScopeList(scope.agent_ids)) errors.push('agent_ids_invalid');
  if (!isNormalizedEnumScopeList(scope.agent_types, AGENT_TYPES)) errors.push('agent_types_invalid');
  if (!isNormalizedEnumScopeList(scope.actor_types, ACTOR_TYPES)) errors.push('actor_types_invalid');
  if (!isNormalizedEnumScopeList(scope.actor_roles, ACTOR_ROLES)) errors.push('actor_roles_invalid');
  if (scope.validator_version !== AGENT_POLICY_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(scope);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(scope));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateResourceScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['resource_scope_must_be_object'] };
  exactFields(scope, RESOURCE_SCOPE_FIELDS, 'resource_scope', errors);
  if (!isNormalizedEnumScopeList(scope.resource_types, RESOURCE_TYPES)) errors.push('resource_types_invalid');
  if (!isNormalizedScopeList(scope.resource_ids)) errors.push('resource_ids_invalid');
  if (!isNormalizedEnumScopeList(scope.resource_classifications, AGENT_DATA_CLASSIFICATIONS)) errors.push('resource_classifications_invalid');
  if (!isNormalizedScopeList(scope.resource_domains)) errors.push('resource_domains_invalid');
  if (scope.validator_version !== AGENT_POLICY_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(scope);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(scope));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateActionScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['action_scope_must_be_object'] };
  exactFields(scope, ACTION_SCOPE_FIELDS, 'action_scope', errors);
  if (!isNormalizedEnumScopeList(scope.actions, ACTIONS)) errors.push('actions_invalid');
  if (Array.isArray(scope.actions) && scope.actions.some((action) => FORBIDDEN_ACTIONS.includes(action))) errors.push('actions_forbidden');
  if (scope.validator_version !== AGENT_POLICY_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateRiskScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['risk_scope_must_be_object'] };
  exactFields(scope, RISK_SCOPE_FIELDS, 'risk_scope', errors);
  if (!isNormalizedEnumScopeList(scope.allowed_risk_classifications, AGENT_RISK_CLASSIFICATIONS)) errors.push('allowed_risk_classifications_invalid');
  if (!AGENT_RISK_CLASSIFICATIONS.includes(scope.maximum_risk_classification)) errors.push(`maximum_risk_classification_not_allowed::${scope.maximum_risk_classification}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(scope.requires_approval_above)) errors.push(`requires_approval_above_not_allowed::${scope.requires_approval_above}`);
  if (scope.maximum_risk_classification === 'RESTRICTED') errors.push('maximum_risk_classification_restricted_forbidden');
  if (Array.isArray(scope.allowed_risk_classifications) && scope.allowed_risk_classifications.includes('RESTRICTED')) errors.push('allowed_risk_classifications_restricted_forbidden');
  if (scope.validator_version !== AGENT_POLICY_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateDataScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['data_scope_must_be_object'] };
  exactFields(scope, DATA_SCOPE_FIELDS, 'data_scope', errors);
  if (!isNormalizedEnumScopeList(scope.allowed_data_classifications, AGENT_DATA_CLASSIFICATIONS)) errors.push('allowed_data_classifications_invalid');
  if (!AGENT_DATA_CLASSIFICATIONS.includes(scope.maximum_data_classification)) errors.push(`maximum_data_classification_not_allowed::${scope.maximum_data_classification}`);
  for (const field of ['restricted_fields_present', 'personal_data_present', 'sensitive_data_present', 'secret_material_present']) {
    if (scope[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (scope.validator_version !== AGENT_POLICY_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateChannelScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['channel_scope_must_be_object'] };
  exactFields(scope, CHANNEL_SCOPE_FIELDS, 'channel_scope', errors);
  if (!isNormalizedEnumScopeList(scope.allowed_channels, AGENT_CHANNELS)) errors.push('allowed_channels_invalid');
  if (!isNormalizedEnumScopeList(scope.denied_channels, AGENT_CHANNELS)) errors.push('denied_channels_invalid');
  if (
    Array.isArray(scope.allowed_channels) && Array.isArray(scope.denied_channels) &&
    scope.allowed_channels.some((channel) => scope.denied_channels.includes(channel))
  ) errors.push('allowed_denied_channels_overlap');
  if (scope.validator_version !== AGENT_POLICY_SCOPE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function matchesSubjectScope(scope, request) {
  if (!isPlainObject(scope) || !isPlainObject(request)) return false;
  return (
    Array.isArray(scope.tenant_ids) && scope.tenant_ids.includes(request.tenant_id) &&
    Array.isArray(scope.organization_ids) && scope.organization_ids.includes(request.organization_id) &&
    Array.isArray(scope.agent_ids) && scope.agent_ids.includes(request.agent_id) &&
    Array.isArray(scope.agent_types) && scope.agent_types.includes(request.agent_type) &&
    Array.isArray(scope.actor_types) && scope.actor_types.includes(request.actor_type) &&
    Array.isArray(scope.actor_roles) && scope.actor_roles.includes(request.actor_role)
  );
}

function matchesResourceScope(scope, resource) {
  if (!isPlainObject(scope) || !isPlainObject(resource)) return false;
  const idConstrained = Array.isArray(scope.resource_ids) && scope.resource_ids.length > 0;
  const domainConstrained = Array.isArray(scope.resource_domains) && scope.resource_domains.length > 0;
  return (
    Array.isArray(scope.resource_types) && scope.resource_types.includes(resource.resource_type) &&
    Array.isArray(scope.resource_classifications) && scope.resource_classifications.includes(resource.resource_classification) &&
    (!idConstrained || scope.resource_ids.includes(resource.resource_id)) &&
    (!domainConstrained || scope.resource_domains.includes(resource.resource_domain))
  );
}

function matchesActionScope(scope, action) {
  return isPlainObject(scope) && Array.isArray(scope.actions) && scope.actions.includes(action);
}

function evaluateRiskScope(scope, riskClassification) {
  if (!isPlainObject(scope) || !AGENT_RISK_CLASSIFICATIONS.includes(riskClassification)) {
    return { matches: false, approvalRequired: true };
  }
  const withinAllowed = Array.isArray(scope.allowed_risk_classifications) && scope.allowed_risk_classifications.includes(riskClassification);
  const withinMaximum = RISK_ORDER[riskClassification] <= RISK_ORDER[scope.maximum_risk_classification];
  const approvalRequired = RISK_ORDER[riskClassification] >= RISK_ORDER[scope.requires_approval_above];
  return { matches: withinAllowed && withinMaximum, approvalRequired };
}

function evaluateDataScope(scope, dataClassification) {
  if (!isPlainObject(scope) || !AGENT_DATA_CLASSIFICATIONS.includes(dataClassification)) {
    return { matches: false };
  }
  const withinAllowed = Array.isArray(scope.allowed_data_classifications) && scope.allowed_data_classifications.includes(dataClassification);
  const withinMaximum = DATA_ORDER[dataClassification] <= DATA_ORDER[scope.maximum_data_classification];
  return { matches: withinAllowed && withinMaximum };
}

function matchesChannelScope(scope, channel) {
  if (!isPlainObject(scope) || !isNonEmptyString(channel)) return false;
  if (Array.isArray(scope.denied_channels) && scope.denied_channels.includes(channel)) return false;
  return Array.isArray(scope.allowed_channels) && scope.allowed_channels.includes(channel);
}

module.exports = {
  ACTIONS,
  AGENT_POLICY_SCOPE_VALIDATOR_VERSION,
  ACTION_SCOPE_FIELDS,
  CHANNEL_SCOPE_FIELDS,
  DATA_ORDER,
  DATA_SCOPE_FIELDS,
  FORBIDDEN_ACTIONS,
  RESOURCE_SCOPE_FIELDS,
  RESOURCE_TYPES,
  RISK_ORDER,
  RISK_SCOPE_FIELDS,
  SUBJECT_SCOPE_FIELDS,
  evaluateDataScope,
  evaluateRiskScope,
  isNormalizedScopeList,
  matchesActionScope,
  matchesChannelScope,
  matchesResourceScope,
  matchesSubjectScope,
  validateActionScope,
  validateChannelScope,
  validateDataScope,
  validateResourceScope,
  validateRiskScope,
  validateSubjectScope
};
