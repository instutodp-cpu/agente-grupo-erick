'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields,
  isIso
} = require('./transcription-provider-contract');

const SECRET_KINDS = Object.freeze(['api_key_reference', 'service_account_reference']);
const SECRET_REFERENCE_STATUSES = Object.freeze(['draft', 'structurally_valid', 'unavailable', 'revoked', 'expired']);
const SECRET_ENVIRONMENTS = Object.freeze(['local_test', 'non_production']);

function nowMs(context = {}) {
  const value = typeof context.clock === 'function' ? context.clock() : context.now || new Date(0).toISOString();
  return Date.parse(value);
}

function validateTranscriptionProviderSecretReference(reference, context = {}) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['secret_reference_must_be_object'] };
  for (const field of ['secret_reference_id', 'provider_slug', 'secret_kind', 'secret_provider', 'secret_scope', 'environment', 'tenant_id', 'workspace_type', 'reference_version', 'reference_status', 'created_at', 'expires_at', 'rotation_required', 'rotation_interval_days', 'last_rotation_at', 'metadata_only', 'simulated', 'secret_resolved']) {
    if (!Object.prototype.hasOwnProperty.call(reference, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['secret_reference_id', 'provider_slug', 'secret_kind', 'secret_provider', 'secret_scope', 'environment', 'tenant_id', 'workspace_type', 'reference_status', 'created_at', 'expires_at', 'last_rotation_at']) {
    if (!isNonEmptyString(reference[field])) errors.push(`invalid_${field}`);
  }
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(reference.provider_slug)) errors.push(`provider_slug_not_allowed::${reference.provider_slug}`);
  if (!SECRET_KINDS.includes(reference.secret_kind)) errors.push(`secret_kind_not_allowed::${reference.secret_kind}`);
  if (!SECRET_REFERENCE_STATUSES.includes(reference.reference_status)) errors.push(`reference_status_not_allowed::${reference.reference_status}`);
  if (!SECRET_ENVIRONMENTS.includes(reference.environment)) errors.push('environment_not_allowed');
  if (reference.environment === 'production') errors.push('production_blocked');
  if (!Number.isInteger(reference.reference_version) || reference.reference_version < 1) errors.push('reference_version_invalid');
  if (!isIso(reference.created_at)) errors.push('created_at_invalid');
  if (!isIso(reference.expires_at)) errors.push('expires_at_invalid');
  if (isIso(reference.expires_at) && Date.parse(reference.expires_at) <= nowMs(context)) errors.push('secret_reference_expired');
  if (reference.rotation_required !== true) errors.push('rotation_required_must_be_true');
  if (!Number.isInteger(reference.rotation_interval_days) || reference.rotation_interval_days < 1 || reference.rotation_interval_days > 90) errors.push('rotation_interval_days_invalid');
  if (!isIso(reference.last_rotation_at)) errors.push('last_rotation_at_invalid');
  if (reference.metadata_only !== true) errors.push('metadata_only_must_be_true');
  if (reference.simulated !== true) errors.push('simulated_must_be_true');
  if (reference.secret_resolved !== false) errors.push('secret_resolved_must_be_false');
  errors.push(...findProviderBoundaryForbiddenFields(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeSecretReference(reference) {
  return Object.freeze(sanitizeTranscriptionData(deepClone(reference)));
}

module.exports = {
  SECRET_ENVIRONMENTS,
  SECRET_KINDS,
  SECRET_REFERENCE_STATUSES,
  normalizeSecretReference,
  validateTranscriptionProviderSecretReference
};
