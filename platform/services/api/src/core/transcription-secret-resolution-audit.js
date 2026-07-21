'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { cloneFrozen } = require('./transcription-secret-resolution-result');

const TRANSCRIPTION_SECRET_RESOLUTION_AUDIT_VERSION = 'transcription_secret_resolution_audit_v1';
const SECRET_RESOLUTION_AUDIT_FIELDS = Object.freeze([
  'audit_id',
  'resolution_request_id',
  'request_fingerprint',
  'secret_reference_fingerprint',
  'access_context_fingerprint',
  'provider_binding',
  'tenant_binding',
  'scope_binding',
  'policy_decision',
  'blockers',
  'logical_sequence',
  'versions',
  'simulation',
  'secret_material',
  'network',
  'provider_execution',
  'executed',
  'validator_version'
]);

function validateSecretResolutionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['secret_resolution_audit_must_be_object'] };
  const allowed = new Set(SECRET_RESOLUTION_AUDIT_FIELDS);
  for (const field of SECRET_RESOLUTION_AUDIT_FIELDS) if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`audit_missing_${field}`);
  for (const field of Object.keys(audit)) if (!allowed.has(field)) errors.push(`audit_unexpected_field::${field}`);
  for (const field of ['audit_id', 'resolution_request_id', 'request_fingerprint', 'secret_reference_fingerprint', 'access_context_fingerprint', 'policy_decision', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['provider_binding', 'tenant_binding', 'scope_binding', 'versions']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  for (const field of ['secret_material', 'network', 'provider_execution', 'executed']) {
    if (audit[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (audit.validator_version !== TRANSCRIPTION_SECRET_RESOLUTION_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSecretResolutionAudit(input = {}) {
  const request = input.request || {};
  const reference = request.secret_reference || {};
  const policy = input.policy || {};
  const blockers = uniqueSorted([...(input.blockers || []), ...(policy.blocking_reasons || [])]);
  let requestFingerprint = 'fingerprint_unavailable';
  let referenceFingerprint = 'fingerprint_unavailable';
  let accessFingerprint = 'fingerprint_unavailable';
  try { requestFingerprint = stablePayload(request); } catch (error) { requestFingerprint = `fingerprint_invalid::${error.message}`; }
  try { referenceFingerprint = stablePayload(reference); } catch (error) { referenceFingerprint = `fingerprint_invalid::${error.message}`; }
  try { accessFingerprint = stablePayload(request.access_context || {}); } catch (error) { accessFingerprint = `fingerprint_invalid::${error.message}`; }
  const audit = {
    audit_id: `secret_resolution_audit_${request.resolution_request_id || 'missing'}`,
    resolution_request_id: request.resolution_request_id || 'resolution_request_not_available',
    request_fingerprint: requestFingerprint,
    secret_reference_fingerprint: referenceFingerprint,
    access_context_fingerprint: accessFingerprint,
    provider_binding: {
      request_provider_slug: request.provider_slug || 'provider_not_available',
      reference_provider_slug: reference.provider_slug || 'provider_not_available'
    },
    tenant_binding: {
      request_tenant_id: request.tenant_id || 'tenant_not_available',
      reference_tenant_id: reference.tenant_id || 'tenant_not_available'
    },
    scope_binding: {
      requested_scope: request.requested_scope || 'scope_not_available',
      reference_scope: reference.scope || 'scope_not_available'
    },
    policy_decision: policy.status || 'ACCESS_VALIDATION_FAILED',
    blockers,
    logical_sequence: input.logical_sequence || 1,
    versions: {
      request_version: request.resolution_request_version || 0,
      reference_version: reference.secret_ref_version || 0,
      rotation_version: reference.rotation_version || 0,
      access_policy_version: request.access_context?.policy_version || 'policy_version_not_available'
    },
    simulation: true,
    secret_material: false,
    network: false,
    provider_execution: false,
    executed: false,
    validator_version: TRANSCRIPTION_SECRET_RESOLUTION_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  SECRET_RESOLUTION_AUDIT_FIELDS,
  TRANSCRIPTION_SECRET_RESOLUTION_AUDIT_VERSION,
  buildSecretResolutionAudit,
  validateSecretResolutionAudit
};
