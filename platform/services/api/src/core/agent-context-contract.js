'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  exactFields,
  findAgentCoreOperationalMaterial,
  stablePayload
} = require('./agent-identity-contract');
const { LOCALE_PATTERN } = require('./agent-metadata-contract');

const AGENT_CONTEXT_CONTRACT_VALIDATOR_VERSION = 'agent_context_contract_validator_v1';
const AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION = 'agent_actor_context_validator_v1';
const AGENT_REQUEST_CONTEXT_VALIDATOR_VERSION = 'agent_request_context_validator_v1';
const AGENT_SIMULATION_CONTEXT_VALIDATOR_VERSION = 'agent_simulation_context_validator_v1';

const AGENT_CONTEXT_FIELDS = Object.freeze([
  'context_id',
  'context_version',
  'agent_id',
  'tenant_id',
  'organization_id',
  'session_reference',
  'conversation_reference',
  'actor_context',
  'request_context',
  'locale',
  'timezone',
  'channel',
  'correlation_id',
  'causation_id',
  'trace_id',
  'simulation_context',
  'metadata',
  'validator_version'
]);
const SESSION_REFERENCE_FIELDS = Object.freeze(['session_ref_id', 'session_ref_version', 'session_present', 'session_loaded', 'session_mutated']);
const CONVERSATION_REFERENCE_FIELDS = Object.freeze(['conversation_ref_id', 'conversation_ref_version', 'conversation_present', 'history_loaded', 'history_mutated']);
const ACTOR_CONTEXT_FIELDS = Object.freeze(['actor_type', 'actor_id', 'actor_role', 'tenant_id', 'organization_id', 'authorization_state', 'validator_version']);
const REQUEST_CONTEXT_FIELDS = Object.freeze(['request_id', 'request_type', 'request_intent', 'input_reference_id', 'input_present', 'input_loaded', 'input_processed', 'validator_version']);
const SIMULATION_CONTEXT_FIELDS = Object.freeze([
  'simulation',
  'production_blocked',
  'runtime_enabled',
  'execution_enabled',
  'network_enabled',
  'tools_enabled',
  'memory_enabled',
  'llm_enabled',
  'rollout_percentage',
  'validator_version'
]);
const AGENT_CONTEXT_SIMULATION_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  runtime_enabled: false,
  execution_enabled: false,
  network_enabled: false,
  tools_enabled: false,
  memory_enabled: false,
  llm_enabled: false,
  rollout_percentage: 0
});
const ACTOR_TYPES = Object.freeze(['USER', 'SERVICE', 'SYSTEM']);
const ACTOR_ROLES = Object.freeze(['ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR', 'COLLABORATOR', 'SYSTEM_SERVICE', 'AUDITOR']);
const AUTHORIZATION_STATES = Object.freeze(['UNVERIFIED', 'DENIED', 'APPROVED_SIMULATION']);
const FORBIDDEN_AUTHORIZATION_STATES = Object.freeze(['APPROVED_REAL']);
const AGENT_CHANNELS = Object.freeze(['WEB', 'MOBILE', 'WHATSAPP', 'API', 'INTERNAL', 'BATCH_REFERENCE']);
const TIMEZONE_PATTERN = /^(UTC|[A-Za-z]+(?:_[A-Za-z]+)*(?:\/[A-Za-z]+(?:_[A-Za-z]+)*)+)$/;

function validateSessionReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['session_reference_must_be_object'] };
  exactFields(reference, SESSION_REFERENCE_FIELDS, 'session_reference', errors);
  if (!isNonEmptyString(reference.session_ref_id)) errors.push('session_ref_id_invalid');
  if (!Number.isInteger(reference.session_ref_version) || reference.session_ref_version < 1) errors.push('session_ref_version_invalid');
  if (typeof reference.session_present !== 'boolean') errors.push('session_present_must_be_boolean');
  if (reference.session_loaded !== false) errors.push('session_loaded_must_be_false');
  if (reference.session_mutated !== false) errors.push('session_mutated_must_be_false');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateConversationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['conversation_reference_must_be_object'] };
  exactFields(reference, CONVERSATION_REFERENCE_FIELDS, 'conversation_reference', errors);
  if (!isNonEmptyString(reference.conversation_ref_id)) errors.push('conversation_ref_id_invalid');
  if (!Number.isInteger(reference.conversation_ref_version) || reference.conversation_ref_version < 1) errors.push('conversation_ref_version_invalid');
  if (typeof reference.conversation_present !== 'boolean') errors.push('conversation_present_must_be_boolean');
  if (reference.history_loaded !== false) errors.push('history_loaded_must_be_false');
  if (reference.history_mutated !== false) errors.push('history_mutated_must_be_false');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateActorContext(actor) {
  const errors = [];
  if (!isPlainObject(actor)) return { valid: false, errors: ['actor_context_must_be_object'] };
  exactFields(actor, ACTOR_CONTEXT_FIELDS, 'actor_context', errors);
  for (const field of ['actor_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(actor[field])) errors.push(`${field}_invalid`);
  }
  if (!ACTOR_TYPES.includes(actor.actor_type)) errors.push(`actor_type_not_allowed::${actor.actor_type}`);
  if (!ACTOR_ROLES.includes(actor.actor_role)) errors.push(`actor_role_not_allowed::${actor.actor_role}`);
  if (!AUTHORIZATION_STATES.includes(actor.authorization_state)) errors.push(`authorization_state_not_allowed::${actor.authorization_state}`);
  if (FORBIDDEN_AUTHORIZATION_STATES.includes(actor.authorization_state)) errors.push(`authorization_state_forbidden::${actor.authorization_state}`);
  if (actor.validator_version !== AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(actor));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateRequestContext(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['request_context_must_be_object'] };
  exactFields(request, REQUEST_CONTEXT_FIELDS, 'request_context', errors);
  for (const field of ['request_id', 'request_type', 'request_intent', 'input_reference_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (typeof request.input_present !== 'boolean') errors.push('input_present_must_be_boolean');
  if (request.input_loaded !== false) errors.push('input_loaded_must_be_false');
  if (request.input_processed !== false) errors.push('input_processed_must_be_false');
  if (request.validator_version !== AGENT_REQUEST_CONTEXT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentSimulationContext(simulation) {
  const errors = [];
  if (!isPlainObject(simulation)) return { valid: false, errors: ['simulation_context_must_be_object'] };
  exactFields(simulation, SIMULATION_CONTEXT_FIELDS, 'simulation_context', errors);
  for (const [field, expected] of Object.entries(AGENT_CONTEXT_SIMULATION_SAFE_FLAGS)) {
    if (simulation[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (simulation.validator_version !== AGENT_SIMULATION_CONTEXT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentContext(context) {
  const errors = [];
  if (!isPlainObject(context)) return { valid: false, errors: ['agent_context_must_be_object'] };
  exactFields(context, AGENT_CONTEXT_FIELDS, 'agent_context', errors);
  for (const field of ['context_id', 'agent_id', 'tenant_id', 'organization_id', 'locale', 'timezone', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(context[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(context.context_version) || context.context_version < 1) errors.push('context_version_invalid');
  if (isNonEmptyString(context.locale) && !LOCALE_PATTERN.test(context.locale)) errors.push('locale_invalid');
  if (isNonEmptyString(context.timezone) && !TIMEZONE_PATTERN.test(context.timezone)) errors.push('timezone_invalid');
  if (!AGENT_CHANNELS.includes(context.channel)) errors.push(`channel_not_allowed::${context.channel}`);
  if (!isPlainObject(context.metadata)) errors.push('metadata_must_be_object');
  const session = validateSessionReference(context.session_reference);
  errors.push(...session.errors.map((error) => `session_reference_${error}`));
  const conversation = validateConversationReference(context.conversation_reference);
  errors.push(...conversation.errors.map((error) => `conversation_reference_${error}`));
  const actor = validateActorContext(context.actor_context);
  errors.push(...actor.errors);
  const request = validateRequestContext(context.request_context);
  errors.push(...request.errors);
  const simulation = validateAgentSimulationContext(context.simulation_context);
  errors.push(...simulation.errors);
  if (isPlainObject(context.actor_context) && context.actor_context.tenant_id && context.tenant_id !== context.actor_context.tenant_id) {
    errors.push('actor_tenant_mismatch');
  }
  if (isPlainObject(context.actor_context) && context.actor_context.organization_id && context.organization_id !== context.actor_context.organization_id) {
    errors.push('actor_organization_mismatch');
  }
  if (context.validator_version !== AGENT_CONTEXT_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(context);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  if (isPlainObject(context.metadata)) errors.push(...findAgentCoreOperationalMaterial(context.metadata));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  ACTOR_CONTEXT_FIELDS,
  ACTOR_ROLES,
  ACTOR_TYPES,
  AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION,
  AGENT_CHANNELS,
  AGENT_CONTEXT_CONTRACT_VALIDATOR_VERSION,
  AGENT_CONTEXT_FIELDS,
  AGENT_CONTEXT_SIMULATION_SAFE_FLAGS,
  AGENT_REQUEST_CONTEXT_VALIDATOR_VERSION,
  AGENT_SIMULATION_CONTEXT_VALIDATOR_VERSION,
  AUTHORIZATION_STATES,
  CONVERSATION_REFERENCE_FIELDS,
  FORBIDDEN_AUTHORIZATION_STATES,
  REQUEST_CONTEXT_FIELDS,
  SESSION_REFERENCE_FIELDS,
  SIMULATION_CONTEXT_FIELDS,
  validateActorContext,
  validateAgentContext,
  validateAgentSimulationContext,
  validateConversationReference,
  validateRequestContext,
  validateSessionReference
};
