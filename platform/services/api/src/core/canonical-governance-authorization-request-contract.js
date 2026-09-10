'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const {
  AUTHORITY_GRANT_CAPABILITIES,
  AUTHORITY_SCOPE_FIELDS,
  AUTHORITY_SCOPE_TYPE,
  GRANT_SUBJECT_TYPES,
  validateAuthorityScope
} = require('./canonical-governance-authority-grant-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

// This is a pure request value contract. It describes what a subject asks to do within an
// installation. It does not authenticate the source command, resolve a grant, evaluate an
// authorization decision, issue policy, approve budget, or execute anything.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_AUTHORIZATION_REQUEST_CONTRACT';
const CONTRACT_VERSION = 'hermes_canonical_governance_authorization_request_contract_v1';
const AUTHORIZATION_REQUEST_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_AUTHORIZATION_REQUEST_V1';

const AUTHORIZATION_REQUEST_FIELDS = Object.freeze([
  'contract_version',
  'authorization_request_domain',
  'authorization_request_id',
  'installation_id',
  'subject_type',
  'subject_id',
  'requested_capability',
  'requested_scope',
  'source_command_id',
  'source_command_digest',
  'authorization_request_digest'
]);
const SOURCE_COMMAND_FIELDS = Object.freeze(['source_command_id', 'source_command_digest']);
const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function authorizationRequestDigestMaterial(request) {
  const { authorization_request_digest: ignoredDigest, ...material } = request;
  return material;
}

function canonicalAuthorizationRequestBytes(request) {
  return Buffer.from(stablePayload(authorizationRequestDigestMaterial(request)), 'utf8');
}

function authorizationRequestDigest(request) {
  return computeCanonicalContentDigest(
    JSON.parse(canonicalAuthorizationRequestBytes(request).toString('utf8'))
  );
}

function validateRequestedScope(scope, installationId, errors = []) {
  // The request deliberately delegates scope validation to #186 so that authorization cannot
  // acquire a second selector dialect or an implicit wildcard/global meaning.
  return validateAuthorityScope(scope, installationId, errors);
}

function validateSourceCommandBinding(request, errors = []) {
  const hasCommandId = request.source_command_id !== null;
  const hasCommandDigest = request.source_command_digest !== null;
  if (hasCommandId !== hasCommandDigest) {
    errors.push('authorization_request_source_command_binding_incomplete');
    return errors;
  }
  if (hasCommandId && !isIdentifier(request.source_command_id)) {
    errors.push('authorization_request_source_command_id_invalid');
  }
  if (hasCommandDigest && !isCanonicalContentDigest(request.source_command_digest)) {
    errors.push('authorization_request_source_command_digest_invalid');
  }
  return errors;
}

function validateAuthorizationRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) {
    return { valid: false, errors: ['authorization_request_must_be_object'] };
  }

  exactFields(request, AUTHORIZATION_REQUEST_FIELDS, 'authorization_request', errors);
  if (request.contract_version !== CONTRACT_VERSION) {
    errors.push('authorization_request_contract_version_invalid');
  }
  if (request.authorization_request_domain !== AUTHORIZATION_REQUEST_DOMAIN) {
    errors.push('authorization_request_domain_invalid');
  }

  for (const field of ['authorization_request_id', 'installation_id', 'subject_id']) {
    if (!isIdentifier(request[field])) errors.push(`authorization_request_${field}_invalid`);
  }
  if (!GRANT_SUBJECT_TYPES.includes(request.subject_type)) {
    errors.push(`authorization_request_subject_type_not_allowed::${request.subject_type}`);
  }
  if (!AUTHORITY_GRANT_CAPABILITIES.includes(request.requested_capability)) {
    errors.push(`authorization_request_capability_not_allowed::${request.requested_capability}`);
  }
  validateRequestedScope(request.requested_scope, request.installation_id, errors);
  validateSourceCommandBinding(request, errors);

  if (!isCanonicalContentDigest(request.authorization_request_digest)) {
    errors.push('authorization_request_digest_invalid');
  }
  try {
    if (request.authorization_request_digest !== authorizationRequestDigest(request)) {
      errors.push('authorization_request_digest_mismatch');
    }
  } catch (error) {
    errors.push(`authorization_request_canonical_serialization_invalid::${error.message}`);
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAuthorizationRequest(input) {
  if (!isPlainObject(input)) throw new TypeError('authorization_request_input_must_be_object');
  const request = {
    ...input,
    contract_version: CONTRACT_VERSION,
    authorization_request_domain: AUTHORIZATION_REQUEST_DOMAIN,
    authorization_request_digest: 'pending'
  };
  request.authorization_request_digest = authorizationRequestDigest(request);
  const validation = validateAuthorizationRequest(request);
  if (!validation.valid) {
    throw new TypeError(`authorization_request_invalid::${validation.errors.join(',')}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  AUTHORIZATION_REQUEST_DOMAIN,
  AUTHORIZATION_REQUEST_FIELDS,
  AUTHORITY_GRANT_CAPABILITIES,
  AUTHORITY_SCOPE_FIELDS,
  AUTHORITY_SCOPE_TYPE,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  GRANT_SUBJECT_TYPES,
  SOURCE_COMMAND_FIELDS,
  authorizationRequestDigest,
  authorizationRequestDigestMaterial,
  buildAuthorizationRequest,
  canonicalAuthorizationRequestBytes,
  validateAuthorizationRequest,
  validateRequestedScope,
  validateSourceCommandBinding
};
