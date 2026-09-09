'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { ACTOR_TYPES } = require('./agent-context-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { ROOT_CAPABILITIES } = require('./canonical-governance-root-bootstrap-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

// This module is deliberately a pure value contract. It records a bounded authority grant and
// its canonical evidence only. It does not read a root, consult a clock, persist a grant,
// evaluate authorization, resolve a grant chain, issue policy, or execute an operation.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_CONTRACT';
const CONTRACT_VERSION = 'hermes_canonical_governance_authority_grant_contract_v1';
const GRANT_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_V1';

const AUTHORITY_GRANT_FIELDS = Object.freeze([
  'contract_version', 'grant_domain', 'authority_grant_id', 'installation_id',
  'issuer_root_subject_id', 'issuer_root_generation', 'issuer_root_digest',
  'issuer_root_key_id', 'issuer_root_key_fingerprint', 'issuer_root_key_digest',
  'subject_type', 'subject_id', 'authority_scope', 'capabilities', 'restrictions',
  'issued_at', 'not_before', 'expires_at', 'grant_digest'
]);
const AUTHORITY_SCOPE_FIELDS = Object.freeze([
  'scope_type', 'installation_id', 'tenant_ids', 'organization_ids', 'project_ids',
  'cross_tenant', 'cross_organization', 'cross_project'
]);
const AUTHORITY_RESTRICTION_FIELDS = Object.freeze([
  'allow_further_delegation', 'allow_cross_tenant', 'allow_cross_organization', 'allow_cross_project'
]);

// #182 defines the only governance capability vocabulary. Delegation itself is intentionally
// not grantable: #182 has no delegated-authority class/chain model, so this contract cannot mint
// a grant that implicitly creates another issuer.
const AUTHORITY_GRANT_CAPABILITIES = Object.freeze(
  ROOT_CAPABILITIES.filter((capability) => capability !== 'GOVERNANCE_DELEGATE_AUTHORITY')
);
const GRANT_SUBJECT_TYPES = Object.freeze(['AGENT', ...ACTOR_TYPES]);
const AUTHORITY_SCOPE_TYPE = 'installation';
const MAX_SCOPE_ITEMS = 50;
const MAX_SCOPE_ITEM_LENGTH = 120;
const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE_SCOPE_TOKEN_PATTERN = /[*?[\]().^$+|\\{}]/;

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

function isCanonicalScopeList(value) {
  if (!Array.isArray(value) || value.length > MAX_SCOPE_ITEMS) return false;
  if (!value.every((item) => (
    isNonEmptyString(item)
    && item.length <= MAX_SCOPE_ITEM_LENGTH
    && !UNSAFE_SCOPE_TOKEN_PATTERN.test(item)
  ))) return false;
  const sorted = [...value].sort();
  return sorted.every((item, index) => item === value[index])
    && new Set(value).size === value.length;
}

function validateAuthorityScope(scope, installationId, errors = []) {
  if (!isPlainObject(scope)) {
    errors.push('authority_scope_must_be_object');
    return errors;
  }
  exactFields(scope, AUTHORITY_SCOPE_FIELDS, 'authority_scope', errors);
  if (scope.scope_type !== AUTHORITY_SCOPE_TYPE) errors.push('authority_scope_type_invalid');
  if (scope.installation_id !== installationId) errors.push('authority_scope_installation_mismatch');

  const selectorFields = ['tenant_ids', 'organization_ids', 'project_ids'];
  for (const field of selectorFields) {
    if (!isCanonicalScopeList(scope[field])) errors.push(`authority_scope_${field}_invalid`);
  }
  if (selectorFields.every((field) => Array.isArray(scope[field]) && scope[field].length === 0)) {
    errors.push('authority_scope_unbounded');
  }
  for (const field of ['cross_tenant', 'cross_organization', 'cross_project']) {
    if (scope[field] !== false) errors.push(`authority_scope_${field}_must_be_false`);
  }
  return errors;
}

function validateRestrictions(restrictions, errors = []) {
  if (!isPlainObject(restrictions)) {
    errors.push('authority_restrictions_must_be_object');
    return errors;
  }
  exactFields(restrictions, AUTHORITY_RESTRICTION_FIELDS, 'authority_restrictions', errors);
  for (const field of AUTHORITY_RESTRICTION_FIELDS) {
    if (restrictions[field] !== false) errors.push(`authority_restrictions_${field}_must_be_false`);
  }
  return errors;
}

function validateCapabilities(capabilities, errors = []) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    errors.push('authority_capabilities_empty');
    return errors;
  }
  if (!capabilities.every(isNonEmptyString)) errors.push('authority_capabilities_invalid');
  if (new Set(capabilities).size !== capabilities.length) errors.push('authority_capabilities_duplicate');
  const sorted = [...capabilities].sort();
  if (sorted.some((capability, index) => capability !== capabilities[index])) {
    errors.push('authority_capabilities_not_canonical');
  }
  for (const capability of capabilities) {
    if (!AUTHORITY_GRANT_CAPABILITIES.includes(capability)) {
      errors.push(`authority_capability_not_allowed::${capability}`);
    }
  }
  return errors;
}

function grantDigestMaterial(grant) {
  const { grant_digest: ignoredGrantDigest, ...material } = grant;
  return material;
}

function canonicalAuthorityGrantBytes(grant) {
  return Buffer.from(stablePayload(grantDigestMaterial(grant)), 'utf8');
}

function authorityGrantDigest(grant) {
  return computeCanonicalContentDigest(JSON.parse(canonicalAuthorityGrantBytes(grant).toString('utf8')));
}

function validateAuthorityGrant(grant) {
  const errors = [];
  if (!isPlainObject(grant)) return { valid: false, errors: ['authority_grant_must_be_object'] };

  exactFields(grant, AUTHORITY_GRANT_FIELDS, 'authority_grant', errors);
  if (grant.contract_version !== CONTRACT_VERSION) errors.push('authority_grant_contract_version_invalid');
  if (grant.grant_domain !== GRANT_DOMAIN) errors.push('authority_grant_domain_invalid');

  for (const field of [
    'authority_grant_id', 'installation_id', 'issuer_root_subject_id',
    'issuer_root_key_id', 'subject_id'
  ]) {
    if (!isIdentifier(grant[field])) errors.push(`authority_grant_${field}_invalid`);
  }
  if (grant.issuer_root_subject_id !== `governance-root::${grant.installation_id}`) {
    errors.push('authority_grant_issuer_root_subject_invalid');
  }
  if (!Number.isInteger(grant.issuer_root_generation) || grant.issuer_root_generation < 0) {
    errors.push('authority_grant_issuer_root_generation_invalid');
  }
  for (const field of [
    'issuer_root_digest', 'issuer_root_key_fingerprint', 'issuer_root_key_digest', 'grant_digest'
  ]) {
    if (!isDigest(grant[field])) errors.push(`authority_grant_${field}_invalid`);
  }

  if (!GRANT_SUBJECT_TYPES.includes(grant.subject_type)) {
    errors.push(`authority_grant_subject_type_not_allowed::${grant.subject_type}`);
  }
  if (grant.subject_id === grant.issuer_root_subject_id) errors.push('authority_grant_self_subject_forbidden');
  validateAuthorityScope(grant.authority_scope, grant.installation_id, errors);
  validateCapabilities(grant.capabilities, errors);
  validateRestrictions(grant.restrictions, errors);

  for (const field of ['issued_at', 'not_before', 'expires_at']) {
    if (!isCanonicalTimestamp(grant[field])) errors.push(`authority_grant_${field}_invalid`);
  }
  if (isCanonicalTimestamp(grant.issued_at) && isCanonicalTimestamp(grant.not_before)
    && Date.parse(grant.not_before) < Date.parse(grant.issued_at)) {
    errors.push('authority_grant_not_before_before_issued');
  }
  if (isCanonicalTimestamp(grant.not_before) && isCanonicalTimestamp(grant.expires_at)
    && Date.parse(grant.expires_at) <= Date.parse(grant.not_before)) {
    errors.push('authority_grant_expires_not_after_not_before');
  }

  try {
    if (grant.grant_digest !== authorityGrantDigest(grant)) errors.push('authority_grant_digest_mismatch');
  } catch (error) {
    errors.push(`authority_grant_canonical_serialization_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAuthorityGrant(input) {
  if (!isPlainObject(input)) throw new TypeError('authority_grant_input_must_be_object');
  const grant = {
    ...input,
    contract_version: CONTRACT_VERSION,
    grant_domain: GRANT_DOMAIN,
    grant_digest: 'pending'
  };
  grant.grant_digest = authorityGrantDigest(grant);
  const validation = validateAuthorityGrant(grant);
  if (!validation.valid) throw new TypeError(`authority_grant_invalid::${validation.errors.join(',')}`);
  return cloneFrozen(grant);
}

module.exports = {
  AUTHORITY_GRANT_CAPABILITIES,
  AUTHORITY_GRANT_FIELDS,
  AUTHORITY_RESTRICTION_FIELDS,
  AUTHORITY_SCOPE_FIELDS,
  AUTHORITY_SCOPE_TYPE,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  GRANT_DOMAIN,
  GRANT_SUBJECT_TYPES,
  canonicalAuthorityGrantBytes,
  authorityGrantDigest,
  buildAuthorityGrant,
  validateAuthorityGrant,
  validateAuthorityScope,
  validateRestrictions
};
