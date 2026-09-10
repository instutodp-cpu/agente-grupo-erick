'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const {
  authorityGrantDigest,
  validateAuthorityGrant
} = require('./canonical-governance-authority-grant-contract');
const { validateAuthorityGrantRevocation } = require('./canonical-governance-authority-grant-revocation-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');

// Pure resolution only. This module consumes already persisted evidence and an explicit
// evaluation instant. It does not read a clock, consult PostgreSQL, resolve root lifecycle,
// authorize an operation, issue policy, or execute anything.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_RESOLUTION';
const CONTRACT_VERSION = 'hermes_canonical_governance_authority_grant_resolution_v1';
const RESOLUTION_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_RESOLUTION_V1';

const RESOLUTION_INPUT_FIELDS = Object.freeze([
  'installation_id', 'authority_grant_id', 'expected_grant_digest', 'evaluation_time',
  'grant', 'revocations'
]);
const RESOLUTION_LOOKUP_FIELDS = Object.freeze([
  'installation_id', 'authority_grant_id', 'expected_grant_digest', 'evaluation_time'
]);
const REQUIRED_RESOLUTION_INPUT_FIELDS = Object.freeze([
  'installation_id', 'authority_grant_id', 'evaluation_time', 'grant', 'revocations'
]);
const RESOLUTION_RESULT_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'resolution_domain', 'status', 'reason_code',
  'validation_errors', 'installation_id', 'authority_grant_id', 'evaluation_time',
  'grant_digest', 'resolved_grant', 'revocation_count', 'effective_revocation_count',
  'revocation_digests', 'effective_revocation_digests'
]);
const RESOLUTION_STATUS = Object.freeze({
  ACTIVE: 'RESOLVED_ACTIVE',
  NOT_YET_ACTIVE: 'RESOLVED_NOT_YET_ACTIVE',
  EXPIRED: 'RESOLVED_EXPIRED',
  REVOKED: 'RESOLVED_REVOKED',
  NOT_FOUND: 'NOT_FOUND',
  REJECTED: 'REJECTED'
});
const RESOLUTION_REASON_CODES = Object.freeze([
  'within_validity_window',
  'not_before_not_reached',
  'grant_expired',
  'effective_revocation',
  'grant_not_found',
  'invalid_resolution_input',
  'grant_evidence_invalid',
  'grant_installation_mismatch',
  'grant_id_mismatch',
  'grant_digest_mismatch',
  'revocation_evidence_invalid',
  'revocation_evidence_ambiguous',
  'revocation_installation_mismatch',
  'revocation_target_digest_mismatch',
  'database_read_failed',
  'state_ambiguous'
]);

const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function hasOnlyKnownFields(value, fields) {
  return isPlainObject(value) && Object.keys(value).every((field) => fields.includes(field));
}

function baseResult(request = {}, status = RESOLUTION_STATUS.REJECTED, reasonCode = null, validationErrors = []) {
  return {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    resolution_domain: RESOLUTION_DOMAIN,
    status,
    reason_code: reasonCode,
    validation_errors: uniqueSorted(validationErrors),
    installation_id: isIdentifier(request.installation_id) ? request.installation_id : null,
    authority_grant_id: isIdentifier(request.authority_grant_id) ? request.authority_grant_id : null,
    evaluation_time: isCanonicalTimestamp(request.evaluation_time) ? request.evaluation_time : null,
    grant_digest: null,
    resolved_grant: null,
    revocation_count: 0,
    effective_revocation_count: 0,
    revocation_digests: [],
    effective_revocation_digests: []
  };
}

function rejectedResolution(request, reasonCode, validationErrors = []) {
  return cloneFrozen(baseResult(request, RESOLUTION_STATUS.REJECTED, reasonCode, validationErrors));
}

function validateResolutionLookupRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['resolution_input_must_be_object'] };

  for (const field of ['installation_id', 'authority_grant_id', 'evaluation_time']) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`resolution_input_missing_${field}`);
  }
  if (!hasOnlyKnownFields(request, RESOLUTION_LOOKUP_FIELDS)) {
    for (const field of Object.keys(request)) {
      if (!RESOLUTION_LOOKUP_FIELDS.includes(field)) errors.push(`resolution_input_unknown_field::${field}`);
    }
  }
  if (!isIdentifier(request.installation_id)) errors.push('resolution_installation_id_invalid');
  if (!isIdentifier(request.authority_grant_id)) errors.push('resolution_authority_grant_id_invalid');
  if (!isCanonicalTimestamp(request.evaluation_time)) errors.push('resolution_evaluation_time_invalid');
  if (Object.prototype.hasOwnProperty.call(request, 'expected_grant_digest')
    && !isCanonicalContentDigest(request.expected_grant_digest)) {
    errors.push('resolution_expected_grant_digest_invalid');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateResolutionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['resolution_input_must_be_object'] };

  for (const field of REQUIRED_RESOLUTION_INPUT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`resolution_input_missing_${field}`);
  }
  if (!hasOnlyKnownFields(request, RESOLUTION_INPUT_FIELDS)) {
    for (const field of Object.keys(request)) {
      if (!RESOLUTION_INPUT_FIELDS.includes(field)) errors.push(`resolution_input_unknown_field::${field}`);
    }
  }
  const lookupValidation = validateResolutionLookupRequest(request);
  errors.push(...lookupValidation.errors.filter((error) => !error.startsWith('resolution_input_unknown_field::')));
  if (request.grant !== null && !isPlainObject(request.grant)) errors.push('resolution_grant_must_be_object_or_null');
  if (!Array.isArray(request.revocations)) errors.push('resolution_revocations_must_be_array');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function notFoundResolution(request) {
  return cloneFrozen(baseResult(request, RESOLUTION_STATUS.NOT_FOUND, 'grant_not_found'));
}

function rejectGrant(request, reasonCode, errors) {
  return rejectedResolution(request, reasonCode, errors);
}

function resolveCanonicalGovernanceAuthorityGrant(request = {}) {
  const inputValidation = validateResolutionRequest(request);
  if (!inputValidation.valid) return rejectGrant(request, 'invalid_resolution_input', inputValidation.errors);
  if (request.grant === null) {
    if (request.revocations.length > 0) {
      return rejectGrant(request, 'state_ambiguous', ['revocations_without_grant']);
    }
    return notFoundResolution(request);
  }

  const grantValidation = validateAuthorityGrant(request.grant);
  if (!grantValidation.valid) return rejectGrant(request, 'grant_evidence_invalid', grantValidation.errors);
  if (request.grant.installation_id !== request.installation_id) {
    return rejectGrant(request, 'grant_installation_mismatch', ['grant_installation_mismatch']);
  }
  if (request.grant.authority_grant_id !== request.authority_grant_id) {
    return rejectGrant(request, 'grant_id_mismatch', ['grant_id_mismatch']);
  }
  if (Object.prototype.hasOwnProperty.call(request, 'expected_grant_digest')
    && request.grant.grant_digest !== request.expected_grant_digest) {
    return rejectGrant(request, 'grant_digest_mismatch', ['expected_grant_digest_mismatch']);
  }
  if (authorityGrantDigest(request.grant) !== request.grant.grant_digest) {
    return rejectGrant(request, 'grant_digest_mismatch', ['grant_digest_mismatch']);
  }

  const matchedRevocations = [];
  const seenRevocationIds = new Set();
  const seenRevocationDigests = new Set();
  for (const revocation of request.revocations) {
    const revocationValidation = validateAuthorityGrantRevocation(revocation);
    if (!revocationValidation.valid) {
      return rejectGrant(request, 'revocation_evidence_invalid', revocationValidation.errors);
    }
    if (revocation.installation_id !== request.installation_id) {
      return rejectGrant(request, 'revocation_installation_mismatch', ['revocation_installation_mismatch']);
    }
    if (seenRevocationIds.has(revocation.authority_grant_revocation_id)
      || seenRevocationDigests.has(revocation.revocation_digest)) {
      return rejectGrant(request, 'revocation_evidence_ambiguous', ['duplicate_revocation_identity']);
    }
    seenRevocationIds.add(revocation.authority_grant_revocation_id);
    seenRevocationDigests.add(revocation.revocation_digest);

    if (revocation.target_authority_grant_id !== request.authority_grant_id) continue;
    if (revocation.target_grant_digest !== request.grant.grant_digest) {
      return rejectGrant(request, 'revocation_target_digest_mismatch', ['revocation_target_digest_mismatch']);
    }
    matchedRevocations.push(revocation);
  }

  const orderedRevocations = matchedRevocations
    .slice()
    .sort((left, right) => left.revocation_digest.localeCompare(right.revocation_digest));
  const evaluationMs = Date.parse(request.evaluation_time);
  const effectiveRevocations = orderedRevocations.filter((revocation) => (
    Date.parse(revocation.effective_at) <= evaluationMs
  ));
  const common = baseResult(request);
  common.grant_digest = request.grant.grant_digest;
  common.resolved_grant = request.grant;
  common.revocation_count = orderedRevocations.length;
  common.effective_revocation_count = effectiveRevocations.length;
  common.revocation_digests = orderedRevocations.map((revocation) => revocation.revocation_digest);
  common.effective_revocation_digests = effectiveRevocations.map((revocation) => revocation.revocation_digest);

  let status = RESOLUTION_STATUS.ACTIVE;
  let reasonCode = 'within_validity_window';
  if (effectiveRevocations.length > 0) {
    status = RESOLUTION_STATUS.REVOKED;
    reasonCode = 'effective_revocation';
  } else if (evaluationMs < Date.parse(request.grant.not_before)) {
    status = RESOLUTION_STATUS.NOT_YET_ACTIVE;
    reasonCode = 'not_before_not_reached';
  } else if (evaluationMs > Date.parse(request.grant.expires_at)) {
    status = RESOLUTION_STATUS.EXPIRED;
    reasonCode = 'grant_expired';
  }
  common.status = status;
  common.reason_code = reasonCode;
  return cloneFrozen(common);
}

function canonicalAuthorityGrantResolutionBytes(result) {
  return Buffer.from(stablePayload(result), 'utf8');
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  RESOLUTION_DOMAIN,
  RESOLUTION_INPUT_FIELDS,
  RESOLUTION_LOOKUP_FIELDS,
  RESOLUTION_REASON_CODES,
  RESOLUTION_RESULT_FIELDS,
  RESOLUTION_STATUS,
  canonicalAuthorityGrantResolutionBytes,
  notFoundResolution,
  rejectedResolution,
  resolveAuthorityGrant: resolveCanonicalGovernanceAuthorityGrant,
  resolveCanonicalGovernanceAuthorityGrant,
  validateResolutionLookupRequest,
  validateResolutionRequest
};
