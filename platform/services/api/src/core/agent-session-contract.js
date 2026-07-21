'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS, AGENT_RISK_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { ACTOR_ROLES, ACTOR_TYPES, AGENT_CHANNELS, validateAgentSimulationContext } = require('./agent-context-contract');
const {
  validateConversationReference,
  validateSessionPolicyReference
} = require('./agent-session-reference');
const { validateAgentSessionExpiration } = require('./agent-session-expiration');

const AGENT_SESSION_CONTRACT_VALIDATOR_VERSION = 'agent_session_contract_validator_v1';
const AGENT_SESSION_FIELDS = Object.freeze([
  'session_id', 'session_version', 'session_fingerprint', 'agent_id', 'agent_version', 'tenant_id',
  'organization_id', 'actor_id', 'actor_type', 'actor_role', 'channel', 'session_type', 'session_status',
  'session_scope', 'conversation_reference', 'policy_reference', 'creation_sequence',
  'last_transition_sequence', 'expiration_policy', 'simulation_context', 'metadata', 'validator_version'
]);
const SESSION_SCOPE_FIELDS = Object.freeze([
  'allowed_agent_ids', 'allowed_actor_ids', 'allowed_actor_roles', 'allowed_channels', 'allowed_session_types',
  'tenant_id', 'organization_id', 'cross_tenant_allowed', 'cross_organization_allowed', 'validator_version'
]);
const SESSION_METADATA_FIELDS = Object.freeze([
  'locale', 'timezone', 'correlation_id', 'causation_id', 'trace_id', 'client_reference', 'device_reference',
  'purpose_code', 'data_classification', 'risk_classification', 'metadata_version', 'validator_version'
]);
const SESSION_TYPES = Object.freeze([
  'INTERACTIVE_REFERENCE', 'TASK_REFERENCE', 'WORKFLOW_REFERENCE', 'ANALYTICS_REFERENCE',
  'AUDIT_REFERENCE', 'TRAINING_REFERENCE', 'SYSTEM_REFERENCE'
]);
const SESSION_STATUSES = Object.freeze(['DRAFT', 'VALIDATED', 'OPEN_SIMULATION', 'SUSPENDED', 'EXPIRED_LOGICAL', 'CLOSED_SIMULATION', 'ARCHIVED']);
const FORBIDDEN_SESSION_STATUSES = Object.freeze(['ACTIVE', 'RUNNING', 'EXECUTING', 'LIVE', 'CONNECTED', 'STREAMING', 'PRODUCTION']);
const PURPOSE_CODE_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const TIMEZONE_PATTERN = /^(UTC|[A-Za-z]+(?:_[A-Za-z]+)*(?:\/[A-Za-z]+(?:_[A-Za-z]+)*)+)$/;
const MAX_SCOPE_ITEMS = 50;
const MAX_SCOPE_ITEM_LENGTH = 120;
const UNSAFE_SCOPE_TOKEN_PATTERN = /[*?[\]().^$+|\\{}]/;

function isNormalizedScopeList(list, allowedValues) {
  if (!Array.isArray(list) || list.length > MAX_SCOPE_ITEMS) return false;
  if (!list.every((item) => isNonEmptyString(item) && item.length <= MAX_SCOPE_ITEM_LENGTH && !UNSAFE_SCOPE_TOKEN_PATTERN.test(item) && item !== '*')) return false;
  if (allowedValues && !list.every((item) => allowedValues.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateSessionScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return { valid: false, errors: ['session_scope_must_be_object'] };
  exactFields(scope, SESSION_SCOPE_FIELDS, 'session_scope', errors);
  for (const field of ['tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(scope[field])) errors.push(`${field}_invalid`);
  }
  if (!isNormalizedScopeList(scope.allowed_agent_ids)) errors.push('allowed_agent_ids_invalid');
  if (!isNormalizedScopeList(scope.allowed_actor_ids)) errors.push('allowed_actor_ids_invalid');
  if (!isNormalizedScopeList(scope.allowed_actor_roles, ACTOR_ROLES)) errors.push('allowed_actor_roles_invalid');
  if (!isNormalizedScopeList(scope.allowed_channels, AGENT_CHANNELS)) errors.push('allowed_channels_invalid');
  if (!isNormalizedScopeList(scope.allowed_session_types, SESSION_TYPES)) errors.push('allowed_session_types_invalid');
  if (scope.cross_tenant_allowed !== false) errors.push('cross_tenant_allowed_must_be_false');
  if (scope.cross_organization_allowed !== false) errors.push('cross_organization_allowed_must_be_false');
  if (scope.validator_version !== AGENT_SESSION_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(scope);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(scope));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function matchesSessionScope(scope, candidate) {
  if (!isPlainObject(scope) || !isPlainObject(candidate)) return false;
  return (
    Array.isArray(scope.allowed_agent_ids) && scope.allowed_agent_ids.includes(candidate.agent_id) &&
    Array.isArray(scope.allowed_actor_ids) && scope.allowed_actor_ids.includes(candidate.actor_id) &&
    Array.isArray(scope.allowed_actor_roles) && scope.allowed_actor_roles.includes(candidate.actor_role) &&
    Array.isArray(scope.allowed_channels) && scope.allowed_channels.includes(candidate.channel) &&
    Array.isArray(scope.allowed_session_types) && scope.allowed_session_types.includes(candidate.session_type) &&
    scope.tenant_id === candidate.tenant_id &&
    scope.organization_id === candidate.organization_id
  );
}

function validateSessionMetadata(metadata) {
  const errors = [];
  if (!isPlainObject(metadata)) return { valid: false, errors: ['session_metadata_must_be_object'] };
  exactFields(metadata, SESSION_METADATA_FIELDS, 'session_metadata', errors);
  for (const field of ['correlation_id', 'causation_id', 'trace_id', 'client_reference', 'device_reference', 'purpose_code']) {
    if (!isNonEmptyString(metadata[field])) errors.push(`${field}_invalid`);
  }
  if (isNonEmptyString(metadata.locale) && !LOCALE_PATTERN.test(metadata.locale)) errors.push('locale_invalid');
  if (isNonEmptyString(metadata.timezone) && !TIMEZONE_PATTERN.test(metadata.timezone)) errors.push('timezone_invalid');
  if (isNonEmptyString(metadata.purpose_code) && (!PURPOSE_CODE_PATTERN.test(metadata.purpose_code) || metadata.purpose_code.length > 60)) errors.push('purpose_code_not_normalized');
  if (!AGENT_DATA_CLASSIFICATIONS.includes(metadata.data_classification)) errors.push(`data_classification_not_allowed::${metadata.data_classification}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(metadata.risk_classification)) errors.push(`risk_classification_not_allowed::${metadata.risk_classification}`);
  if (!Number.isInteger(metadata.metadata_version) || metadata.metadata_version < 1) errors.push('metadata_version_invalid');
  if (metadata.validator_version !== AGENT_SESSION_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(metadata);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(metadata));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentSessionContract(session) {
  const errors = [];
  if (!isPlainObject(session)) return { valid: false, errors: ['agent_session_must_be_object'] };
  exactFields(session, AGENT_SESSION_FIELDS, 'agent_session', errors);
  for (const field of ['session_id', 'session_fingerprint', 'agent_id', 'tenant_id', 'organization_id', 'actor_id', 'validator_version']) {
    if (!isNonEmptyString(session[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(session.session_version) || session.session_version < 1) errors.push('session_version_invalid');
  if (!Number.isInteger(session.agent_version) || session.agent_version < 1) errors.push('agent_version_invalid');
  if (!Number.isInteger(session.creation_sequence) || session.creation_sequence < 0) errors.push('creation_sequence_invalid');
  if (!Number.isInteger(session.last_transition_sequence) || session.last_transition_sequence < 0) errors.push('last_transition_sequence_invalid');
  if (
    Number.isInteger(session.creation_sequence) && Number.isInteger(session.last_transition_sequence) &&
    session.last_transition_sequence < session.creation_sequence
  ) {
    errors.push('last_transition_sequence_before_creation_sequence');
  }
  if (!ACTOR_TYPES.includes(session.actor_type)) errors.push(`actor_type_not_allowed::${session.actor_type}`);
  if (!ACTOR_ROLES.includes(session.actor_role)) errors.push(`actor_role_not_allowed::${session.actor_role}`);
  if (!AGENT_CHANNELS.includes(session.channel)) errors.push(`channel_not_allowed::${session.channel}`);
  if (!SESSION_TYPES.includes(session.session_type)) errors.push(`session_type_not_allowed::${session.session_type}`);
  if (!SESSION_STATUSES.includes(session.session_status)) errors.push(`session_status_not_allowed::${session.session_status}`);
  if (FORBIDDEN_SESSION_STATUSES.includes(session.session_status)) errors.push(`session_status_forbidden::${session.session_status}`);
  if (isNonEmptyString(session.tenant_id) && isNonEmptyString(session.organization_id) && !session.organization_id.startsWith(`${session.tenant_id}:`)) {
    errors.push('organization_id_not_compatible_with_tenant');
  }

  errors.push(...validateSessionScope(session.session_scope).errors.map((error) => `session_scope_${error}`));
  errors.push(...validateConversationReference(session.conversation_reference).errors.map((error) => `conversation_reference_${error}`));
  errors.push(...validateSessionPolicyReference(session.policy_reference).errors.map((error) => `policy_reference_${error}`));
  errors.push(...validateAgentSessionExpiration(session.expiration_policy).errors.map((error) => `expiration_policy_${error}`));
  errors.push(...validateAgentSimulationContext(session.simulation_context).errors.map((error) => `simulation_context_${error}`));
  errors.push(...validateSessionMetadata(session.metadata).errors.map((error) => `metadata_${error}`));

  if (isPlainObject(session.session_scope) && session.session_scope.tenant_id && session.tenant_id !== session.session_scope.tenant_id) {
    errors.push('scope_tenant_mismatch');
  }
  if (session.metadata && session.metadata.risk_classification === 'RESTRICTED' && session.session_status === 'OPEN_SIMULATION') {
    errors.push('restricted_risk_blocks_open_simulation');
  }
  if (session.validator_version !== AGENT_SESSION_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(session);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(session));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_SESSION_CONTRACT_VALIDATOR_VERSION,
  AGENT_SESSION_FIELDS,
  FORBIDDEN_SESSION_STATUSES,
  SESSION_METADATA_FIELDS,
  SESSION_SCOPE_FIELDS,
  SESSION_STATUSES,
  SESSION_TYPES,
  isNormalizedScopeList,
  matchesSessionScope,
  validateAgentSessionContract,
  validateSessionMetadata,
  validateSessionScope
};
