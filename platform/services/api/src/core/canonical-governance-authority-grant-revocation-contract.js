'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

// This module is deliberately a pure value contract. It records a canonical revocation
// declaration and its evidence only. It does not read or mutate a grant, consult a root,
// consult a clock, persist a revocation, resolve grant state, authorize, or execute anything.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_REVOCATION_CONTRACT';
const CONTRACT_VERSION = 'hermes_canonical_governance_authority_grant_revocation_contract_v1';
const REVOCATION_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_REVOCATION_V1';

const AUTHORITY_GRANT_REVOCATION_FIELDS = Object.freeze([
  'contract_version', 'revocation_domain', 'authority_grant_revocation_id', 'installation_id',
  'target_authority_grant_id', 'target_grant_digest',
  'issuer_root_subject_id', 'issuer_root_generation', 'issuer_root_digest',
  'issuer_root_key_id', 'issuer_root_key_fingerprint', 'issuer_root_key_digest',
  'reason_code', 'issued_at', 'effective_at', 'revocation_digest'
]);

// #182 is the source of the governance vocabulary. A revocation declaration has its own
// closed reason taxonomy because no prior Authority Grant revocation taxonomy exists in the
// repository. The list is intentionally small; it does not make a runtime revocation decision.
const REVOCATION_REASON_CODES = Object.freeze([
  'SECURITY',
  'COMPROMISED',
  'SUPERSEDED',
  'SUBJECT_DISABLED',
  'SCOPE_CHANGED',
  'ADMINISTRATIVE',
  'OTHER'
]);

const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isDigest(value) {
  return typeof value === 'string'
    && DIGEST_PATTERN.test(value)
    && isCanonicalContentDigest(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function revocationDigestMaterial(revocation) {
  const { revocation_digest: ignoredRevocationDigest, ...material } = revocation;
  return material;
}

function canonicalAuthorityGrantRevocationBytes(revocation) {
  return Buffer.from(stablePayload(revocationDigestMaterial(revocation)), 'utf8');
}

function authorityGrantRevocationDigest(revocation) {
  return computeCanonicalContentDigest(
    JSON.parse(canonicalAuthorityGrantRevocationBytes(revocation).toString('utf8'))
  );
}

function validateAuthorityGrantRevocation(revocation) {
  const errors = [];
  if (!isPlainObject(revocation)) {
    return { valid: false, errors: ['authority_grant_revocation_must_be_object'] };
  }

  exactFields(revocation, AUTHORITY_GRANT_REVOCATION_FIELDS, 'authority_grant_revocation', errors);
  if (revocation.contract_version !== CONTRACT_VERSION) errors.push('authority_grant_revocation_contract_version_invalid');
  if (revocation.revocation_domain !== REVOCATION_DOMAIN) errors.push('authority_grant_revocation_domain_invalid');

  for (const field of [
    'authority_grant_revocation_id', 'installation_id', 'target_authority_grant_id',
    'issuer_root_subject_id', 'issuer_root_key_id'
  ]) {
    if (!isIdentifier(revocation[field])) errors.push(`authority_grant_revocation_${field}_invalid`);
  }
  if (revocation.issuer_root_subject_id !== `governance-root::${revocation.installation_id}`) {
    errors.push('authority_grant_revocation_issuer_root_subject_invalid');
  }
  if (!Number.isInteger(revocation.issuer_root_generation) || revocation.issuer_root_generation < 0) {
    errors.push('authority_grant_revocation_issuer_root_generation_invalid');
  }
  for (const field of [
    'target_grant_digest', 'issuer_root_digest', 'issuer_root_key_fingerprint',
    'issuer_root_key_digest', 'revocation_digest'
  ]) {
    if (!isDigest(revocation[field])) errors.push(`authority_grant_revocation_${field}_invalid`);
  }

  if (!REVOCATION_REASON_CODES.includes(revocation.reason_code)) {
    errors.push(`authority_grant_revocation_reason_code_not_allowed::${revocation.reason_code}`);
  }

  for (const field of ['issued_at', 'effective_at']) {
    if (!isCanonicalTimestamp(revocation[field])) errors.push(`authority_grant_revocation_${field}_invalid`);
  }
  if (isCanonicalTimestamp(revocation.issued_at) && isCanonicalTimestamp(revocation.effective_at)
    && Date.parse(revocation.effective_at) < Date.parse(revocation.issued_at)) {
    errors.push('authority_grant_revocation_effective_at_before_issued_at');
  }

  try {
    if (revocation.revocation_digest !== authorityGrantRevocationDigest(revocation)) {
      errors.push('authority_grant_revocation_digest_mismatch');
    }
  } catch (error) {
    errors.push(`authority_grant_revocation_canonical_serialization_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAuthorityGrantRevocation(input) {
  if (!isPlainObject(input)) throw new TypeError('authority_grant_revocation_input_must_be_object');
  const revocation = {
    ...input,
    contract_version: CONTRACT_VERSION,
    revocation_domain: REVOCATION_DOMAIN,
    revocation_digest: 'pending'
  };
  revocation.revocation_digest = authorityGrantRevocationDigest(revocation);
  const validation = validateAuthorityGrantRevocation(revocation);
  if (!validation.valid) {
    throw new TypeError(`authority_grant_revocation_invalid::${validation.errors.join(',')}`);
  }
  return cloneFrozen(revocation);
}

module.exports = {
  AUTHORITY_GRANT_REVOCATION_FIELDS,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  REVOCATION_DOMAIN,
  REVOCATION_REASON_CODES,
  authorityGrantRevocationDigest,
  buildAuthorityGrantRevocation,
  canonicalAuthorityGrantRevocationBytes,
  validateAuthorityGrantRevocation
};
