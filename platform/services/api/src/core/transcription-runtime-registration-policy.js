'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { cloneFrozen, RUNTIME_REGISTRATION_SAFE_FLAGS } = require('./transcription-runtime-registration-result');

const TRANSCRIPTION_RUNTIME_REGISTRATION_POLICY_VERSION = 'transcription_runtime_registration_policy_v1';
const POLICY_CONTEXT_FIELDS = Object.freeze([
  'actor_type',
  'actor_id',
  'actor_role',
  'tenant_id',
  'approval_state',
  'change_ticket_id',
  'security_review_state',
  'architecture_review_state',
  'runtime_review_state',
  'policy_version'
]);
const ACTOR_TYPES = Object.freeze(['USER', 'SERVICE', 'SYSTEM']);
const ACTOR_ROLES = Object.freeze(['ADMIN', 'SYSTEM_SERVICE', 'SECURITY_REVIEWER', 'ARCHITECTURE_REVIEWER', 'RUNTIME_REVIEWER']);
const REVIEW_STATES = Object.freeze(['PENDING', 'DENIED', 'APPROVED_SIMULATION']);
const FORBIDDEN_REVIEW_STATES = Object.freeze(['APPROVED_REAL', 'PRODUCTION_APPROVED', 'ACTIVE', 'EXECUTABLE', 'REGISTERED', 'INITIALIZED', 'ACTIVATED']);
const RUNTIME_REGISTRATION_POLICY_STATUSES = Object.freeze([
  'REGISTRATION_SIMULATION_REVIEWED',
  'REGISTRATION_DENIED',
  'REGISTRATION_POLICY_BLOCKED',
  'REGISTRATION_VALIDATION_FAILED',
  'COMPONENT_GRAPH_BLOCKED',
  'TENANT_BLOCKED',
  'ENVIRONMENT_BLOCKED'
]);
const ALLOWED_REGISTRATION_PURPOSES = Object.freeze([
  'simulate_runtime_registration_review',
  'validate_component_dependency_graph',
  'review_runtime_registration_plan'
]);

function exactFields(value, fields, prefix, errors) {
  const allowed = new Set(fields);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
}

function validatePolicyContext(context) {
  const errors = [];
  if (!isPlainObject(context)) return { valid: false, errors: ['policy_context_must_be_object'] };
  exactFields(context, POLICY_CONTEXT_FIELDS, 'policy_context', errors);
  for (const field of ['actor_id', 'tenant_id', 'change_ticket_id', 'policy_version']) {
    if (!isNonEmptyString(context[field])) errors.push(`${field}_invalid`);
  }
  if (!ACTOR_TYPES.includes(context.actor_type)) errors.push(`actor_type_not_allowed::${context.actor_type}`);
  if (!ACTOR_ROLES.includes(context.actor_role)) errors.push(`actor_role_not_allowed::${context.actor_role}`);
  for (const field of ['approval_state', 'security_review_state', 'architecture_review_state', 'runtime_review_state']) {
    if (!REVIEW_STATES.includes(context[field])) errors.push(`${field}_not_allowed::${context[field]}`);
    if (FORBIDDEN_REVIEW_STATES.includes(context[field])) errors.push(`${field}_forbidden::${context[field]}`);
  }
  if (context.policy_version !== TRANSCRIPTION_RUNTIME_REGISTRATION_POLICY_VERSION) errors.push('policy_version_invalid');
  try {
    stablePayload(context);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateRuntimeRegistrationPolicy(request = {}, descriptor = {}) {
  const validation = validatePolicyContext(request.policy_context);
  const blockers = [...validation.errors];
  if (request.tenant_id !== request.policy_context?.tenant_id) blockers.push('policy_tenant_mismatch');
  if (request.tenant_id !== descriptor.tenant_id) blockers.push('tenant_mismatch');
  if (request.environment !== descriptor.environment) blockers.push('environment_mismatch');
  if (!ALLOWED_REGISTRATION_PURPOSES.includes(request.requested_purpose)) blockers.push(`purpose_not_allowed::${request.requested_purpose}`);
  for (const field of ['approval_state', 'security_review_state', 'architecture_review_state', 'runtime_review_state']) {
    if (request.policy_context?.[field] === 'DENIED') blockers.push(`${field}_denied`);
    if (request.policy_context?.[field] === 'PENDING') blockers.push(`${field}_pending`);
    if (request.policy_context?.[field] !== 'APPROVED_SIMULATION') blockers.push(`${field}_not_simulated`);
  }
  const status = blockers.length === 0 ? 'REGISTRATION_SIMULATION_REVIEWED' : (validation.valid ? 'REGISTRATION_DENIED' : 'REGISTRATION_VALIDATION_FAILED');
  return cloneFrozen({
    status,
    allowed: false,
    reviewed: status === 'REGISTRATION_SIMULATION_REVIEWED',
    decision_reason: status === 'REGISTRATION_SIMULATION_REVIEWED' ? 'registration_reviewed_simulation_only' : uniqueSorted(blockers)[0],
    blocking_reasons: uniqueSorted(blockers),
    policy_version: TRANSCRIPTION_RUNTIME_REGISTRATION_POLICY_VERSION,
    tenant_id: request.tenant_id || 'tenant_not_available',
    environment: request.environment || 'environment_not_available',
    component_type: descriptor.component_type || 'component_type_not_available',
    ...RUNTIME_REGISTRATION_SAFE_FLAGS
  });
}

module.exports = {
  ACTOR_ROLES,
  ACTOR_TYPES,
  ALLOWED_REGISTRATION_PURPOSES,
  FORBIDDEN_REVIEW_STATES,
  POLICY_CONTEXT_FIELDS,
  REVIEW_STATES,
  RUNTIME_REGISTRATION_POLICY_STATUSES,
  TRANSCRIPTION_RUNTIME_REGISTRATION_POLICY_VERSION,
  evaluateRuntimeRegistrationPolicy,
  validatePolicyContext
};
