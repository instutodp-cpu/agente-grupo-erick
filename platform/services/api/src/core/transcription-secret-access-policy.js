'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { cloneFrozen, SECRET_RESOLUTION_SAFE_FLAGS } = require('./transcription-secret-resolution-result');

const TRANSCRIPTION_SECRET_ACCESS_POLICY_VERSION = 'transcription_secret_access_policy_v1';
const ACCESS_CONTEXT_FIELDS = Object.freeze([
  'actor_type',
  'actor_id',
  'actor_role',
  'tenant_id',
  'requested_by',
  'approval_state',
  'mfa_verified',
  'service_identity_verified',
  'policy_version'
]);
const ACTOR_TYPES = Object.freeze(['USER', 'SERVICE', 'SYSTEM']);
const ACTOR_ROLES = Object.freeze(['ADMIN', 'SYSTEM_SERVICE', 'SECURITY_REVIEWER']);
const APPROVAL_STATES = Object.freeze(['PENDING', 'DENIED', 'APPROVED_SIMULATION']);
const FORBIDDEN_APPROVAL_STATES = Object.freeze(['APPROVED_REAL', 'ACTIVE', 'EXECUTABLE', 'CONNECTED']);
const ACCESS_POLICY_STATUSES = Object.freeze([
  'ACCESS_SIMULATION_APPROVED',
  'ACCESS_DENIED',
  'ACCESS_POLICY_BLOCKED',
  'ACCESS_VALIDATION_FAILED'
]);
const ALLOWED_PURPOSES = Object.freeze([
  'simulate_secret_reference_validation',
  'validate_provider_secret_reference',
  'review_secret_boundary'
]);

function exactFields(value, fields, prefix, errors) {
  const allowed = new Set(fields);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
}

function validateAccessContext(accessContext) {
  const errors = [];
  if (!isPlainObject(accessContext)) return { valid: false, errors: ['access_context_must_be_object'] };
  exactFields(accessContext, ACCESS_CONTEXT_FIELDS, 'access_context', errors);
  for (const field of ['actor_id', 'tenant_id', 'requested_by', 'policy_version']) {
    if (!isNonEmptyString(accessContext[field])) errors.push(`${field}_invalid`);
  }
  if (!ACTOR_TYPES.includes(accessContext.actor_type)) errors.push(`actor_type_not_allowed::${accessContext.actor_type}`);
  if (!ACTOR_ROLES.includes(accessContext.actor_role)) errors.push(`actor_role_not_allowed::${accessContext.actor_role}`);
  if (!APPROVAL_STATES.includes(accessContext.approval_state)) errors.push(`approval_state_not_allowed::${accessContext.approval_state}`);
  if (FORBIDDEN_APPROVAL_STATES.includes(accessContext.approval_state)) errors.push(`approval_state_forbidden::${accessContext.approval_state}`);
  if (typeof accessContext.mfa_verified !== 'boolean') errors.push('mfa_verified_must_be_boolean');
  if (typeof accessContext.service_identity_verified !== 'boolean') errors.push('service_identity_verified_must_be_boolean');
  if (accessContext.policy_version !== TRANSCRIPTION_SECRET_ACCESS_POLICY_VERSION) errors.push('policy_version_invalid');
  try {
    stablePayload(accessContext);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateSecretAccessPolicy(request = {}, reference = {}) {
  const validation = validateAccessContext(request.access_context);
  const blockers = [...validation.errors];
  if (!isNonEmptyString(request.tenant_id) || request.tenant_id !== request.access_context?.tenant_id) blockers.push('access_tenant_mismatch');
  if (reference.tenant_id && request.tenant_id !== reference.tenant_id) blockers.push('reference_tenant_mismatch');
  if (reference.provider_slug && request.provider_slug !== reference.provider_slug) blockers.push('reference_provider_mismatch');
  if (reference.scope && request.requested_scope !== reference.scope) blockers.push('reference_scope_mismatch');
  if (!ALLOWED_PURPOSES.includes(request.requested_purpose)) blockers.push(`purpose_not_allowed::${request.requested_purpose}`);
  if (request.access_context?.approval_state === 'DENIED') blockers.push('approval_denied');
  if (request.access_context?.approval_state === 'PENDING') blockers.push('approval_pending');
  if (request.access_context?.approval_state !== 'APPROVED_SIMULATION') blockers.push('approval_not_simulated');
  if (request.access_context?.actor_role === 'ADMIN' && request.access_context?.mfa_verified !== true) blockers.push('mfa_required');
  if (request.access_context?.actor_type !== 'USER' && request.access_context?.service_identity_verified !== true) blockers.push('service_identity_required');

  const status = blockers.length === 0 ? 'ACCESS_SIMULATION_APPROVED' : (validation.valid ? 'ACCESS_DENIED' : 'ACCESS_VALIDATION_FAILED');
  return cloneFrozen({
    status,
    allowed: status === 'ACCESS_SIMULATION_APPROVED',
    decision_reason: status === 'ACCESS_SIMULATION_APPROVED' ? 'simulation_reference_access_approved' : uniqueSorted(blockers)[0],
    blocking_reasons: uniqueSorted(blockers),
    policy_version: TRANSCRIPTION_SECRET_ACCESS_POLICY_VERSION,
    tenant_id: request.tenant_id || 'tenant_not_available',
    provider_slug: request.provider_slug || 'provider_not_available',
    scope: request.requested_scope || 'scope_not_available',
    ...SECRET_RESOLUTION_SAFE_FLAGS
  });
}

module.exports = {
  ACCESS_CONTEXT_FIELDS,
  ACCESS_POLICY_STATUSES,
  ACTOR_ROLES,
  ACTOR_TYPES,
  ALLOWED_PURPOSES,
  APPROVAL_STATES,
  FORBIDDEN_APPROVAL_STATES,
  TRANSCRIPTION_SECRET_ACCESS_POLICY_VERSION,
  evaluateSecretAccessPolicy,
  validateAccessContext
};
