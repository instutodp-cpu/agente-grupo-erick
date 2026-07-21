'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { cloneFrozen, NETWORK_PERMISSION_SAFE_FLAGS } = require('./transcription-network-permission-result');

const TRANSCRIPTION_NETWORK_ACCESS_POLICY_VERSION = 'transcription_network_access_policy_v1';
const POLICY_CONTEXT_FIELDS = Object.freeze([
  'actor_type',
  'actor_id',
  'actor_role',
  'tenant_id',
  'approval_state',
  'change_ticket_id',
  'security_review_state',
  'privacy_review_state',
  'data_processing_review_state',
  'policy_version'
]);
const ACTOR_TYPES = Object.freeze(['USER', 'SERVICE', 'SYSTEM']);
const ACTOR_ROLES = Object.freeze(['ADMIN', 'SYSTEM_SERVICE', 'SECURITY_REVIEWER', 'NETWORK_REVIEWER']);
const REVIEW_STATES = Object.freeze(['PENDING', 'DENIED', 'APPROVED_SIMULATION']);
const FORBIDDEN_REVIEW_STATES = Object.freeze(['APPROVED_REAL', 'PRODUCTION_APPROVED', 'ACTIVE', 'EXECUTABLE', 'CONNECTED']);
const NETWORK_POLICY_STATUSES = Object.freeze([
  'NETWORK_SIMULATION_REVIEWED',
  'NETWORK_DENIED',
  'NETWORK_POLICY_BLOCKED',
  'NETWORK_VALIDATION_FAILED',
  'DESTINATION_BLOCKED',
  'SECRET_CONTEXT_BLOCKED',
  'PROVIDER_BINDING_BLOCKED',
  'TRANSPORT_BINDING_BLOCKED'
]);
const ALLOWED_NETWORK_PURPOSES = Object.freeze([
  'simulate_network_permission_review',
  'validate_provider_network_boundary',
  'review_transport_destination'
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
  for (const field of ['approval_state', 'security_review_state', 'privacy_review_state', 'data_processing_review_state']) {
    if (!REVIEW_STATES.includes(context[field])) errors.push(`${field}_not_allowed::${context[field]}`);
    if (FORBIDDEN_REVIEW_STATES.includes(context[field])) errors.push(`${field}_forbidden::${context[field]}`);
  }
  if (context.policy_version !== TRANSCRIPTION_NETWORK_ACCESS_POLICY_VERSION) errors.push('policy_version_invalid');
  try {
    stablePayload(context);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateNetworkAccessPolicy(request = {}, destination = {}) {
  const validation = validatePolicyContext(request.policy_context);
  const blockers = [...validation.errors];
  if (request.tenant_id !== request.policy_context?.tenant_id) blockers.push('policy_tenant_mismatch');
  if (request.provider_slug !== destination.provider_slug) blockers.push('provider_mismatch');
  if (request.transport_id !== destination.transport_id) blockers.push('transport_mismatch');
  if (request.protocol !== destination.protocol) blockers.push('protocol_mismatch');
  if (request.requested_scope !== destination.scope) blockers.push('scope_mismatch');
  if (!ALLOWED_NETWORK_PURPOSES.includes(request.requested_purpose)) blockers.push(`purpose_not_allowed::${request.requested_purpose}`);
  for (const field of ['approval_state', 'security_review_state', 'privacy_review_state', 'data_processing_review_state']) {
    if (request.policy_context?.[field] === 'DENIED') blockers.push(`${field}_denied`);
    if (request.policy_context?.[field] === 'PENDING') blockers.push(`${field}_pending`);
    if (request.policy_context?.[field] !== 'APPROVED_SIMULATION') blockers.push(`${field}_not_simulated`);
  }
  const status = blockers.length === 0 ? 'NETWORK_SIMULATION_REVIEWED' : (validation.valid ? 'NETWORK_DENIED' : 'NETWORK_VALIDATION_FAILED');
  return cloneFrozen({
    status,
    allowed: false,
    reviewed: status === 'NETWORK_SIMULATION_REVIEWED',
    decision_reason: status === 'NETWORK_SIMULATION_REVIEWED' ? 'network_reviewed_simulation_only' : uniqueSorted(blockers)[0],
    blocking_reasons: uniqueSorted(blockers),
    policy_version: TRANSCRIPTION_NETWORK_ACCESS_POLICY_VERSION,
    tenant_id: request.tenant_id || 'tenant_not_available',
    provider_slug: request.provider_slug || 'provider_not_available',
    transport_id: request.transport_id || 'transport_not_available',
    operation: request.operation || 'operation_not_available',
    protocol: request.protocol || 'protocol_not_available',
    ...NETWORK_PERMISSION_SAFE_FLAGS
  });
}

module.exports = {
  ACTOR_ROLES,
  ACTOR_TYPES,
  ALLOWED_NETWORK_PURPOSES,
  FORBIDDEN_REVIEW_STATES,
  NETWORK_POLICY_STATUSES,
  POLICY_CONTEXT_FIELDS,
  REVIEW_STATES,
  TRANSCRIPTION_NETWORK_ACCESS_POLICY_VERSION,
  evaluateNetworkAccessPolicy,
  validatePolicyContext
};
