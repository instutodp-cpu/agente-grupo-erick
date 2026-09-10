'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const {
  authenticateCanonicalGovernanceRootCommand,
  AUTHENTICATION_STATUS
} = require('./canonical-governance-root-command-authentication');
const { validateCommandEnvelope } = require('./canonical-governance-root-cryptographic-command-contract');
const { validateAuthorizationRequest } = require('./canonical-governance-authorization-request-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

// This is a pure provenance boundary. It proves that the official #184 verifier authenticated
// the exact #183 command which is source-bound to the exact #191 request. It does not decide
// authorization, resolve a grant, issue policy, approve budget, or execute a command.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_AUTHENTICATION_EVIDENCE_BINDING_CONTRACT';
const CONTRACT_VERSION = 'hermes_canonical_governance_authentication_evidence_binding_v1';
const AUTHENTICATION_EVIDENCE_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_AUTHENTICATION_EVIDENCE_BINDING_V1';
const AUTHENTICATION_EVIDENCE_STATUS = 'AUTHENTICATION_EVIDENCE_BOUND';

const AUTHENTICATION_EVIDENCE_BINDING_INPUT_FIELDS = Object.freeze([
  'command',
  'authentication',
  'authorization_request',
  'public_key'
]);
const AUTHENTICATION_RESULT_FIELDS = Object.freeze([
  'authenticated',
  'status',
  'reason_code',
  'command_digest',
  'replay_identity'
]);
const AUTHENTICATION_EVIDENCE_BINDING_FIELDS = Object.freeze([
  'contract_version',
  'authentication_evidence_domain',
  'authentication_evidence_id',
  'status',
  'installation_id',
  'command_id',
  'command_digest',
  'replay_identity',
  'authorization_request_id',
  'authorization_request_digest',
  'authentication_result_digest',
  'authentication_evidence_digest'
]);
const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isDigest(value) {
  return isCanonicalContentDigest(value);
}

function authenticationEvidenceDigestMaterial(binding) {
  const { authentication_evidence_digest: ignoredDigest, ...material } = binding;
  return material;
}

function canonicalAuthenticationEvidenceBytes(binding) {
  return Buffer.from(stablePayload(authenticationEvidenceDigestMaterial(binding)), 'utf8');
}

function authenticationEvidenceDigest(binding) {
  return computeCanonicalContentDigest(
    JSON.parse(canonicalAuthenticationEvidenceBytes(binding).toString('utf8'))
  );
}

function authenticationResultDigest(authentication) {
  return computeCanonicalContentDigest(authentication);
}

function authenticationEvidenceId(material) {
  const digest = computeCanonicalContentDigest({
    installation_id: material.installation_id,
    command_id: material.command_id,
    command_digest: material.command_digest,
    replay_identity: material.replay_identity,
    authorization_request_id: material.authorization_request_id,
    authorization_request_digest: material.authorization_request_digest,
    authentication_result_digest: material.authentication_result_digest
  });
  return `authentication-evidence:${digest.slice('sha256:'.length)}`;
}

function validateAuthenticationResultShape(authentication, errors = []) {
  if (!isPlainObject(authentication)) {
    errors.push('authentication_result_must_be_object');
    return errors;
  }
  exactFields(authentication, AUTHENTICATION_RESULT_FIELDS, 'authentication_result', errors);
  if (authentication.authenticated !== true) errors.push('authentication_result_not_authenticated');
  if (authentication.status !== AUTHENTICATION_STATUS.AUTHENTICATED) {
    errors.push('authentication_result_not_successful');
  }
  if (authentication.reason_code !== null) errors.push('authentication_result_reason_code_invalid');
  if (!isDigest(authentication.command_digest)) errors.push('authentication_result_command_digest_invalid');
  if (!isDigest(authentication.replay_identity)) errors.push('authentication_result_replay_identity_invalid');
  return errors;
}

function validateAuthenticationEvidenceBindingInput(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ['authentication_evidence_binding_input_must_be_object'] };
  }
  exactFields(input, AUTHENTICATION_EVIDENCE_BINDING_INPUT_FIELDS, 'authentication_evidence_binding_input', errors);

  const commandValidation = validateCommandEnvelope(input.command);
  if (!commandValidation.valid) {
    errors.push(...commandValidation.errors.map((error) => `command_invalid::${error}`));
  }
  const requestValidation = validateAuthorizationRequest(input.authorization_request);
  if (!requestValidation.valid) {
    errors.push(...requestValidation.errors.map((error) => `authorization_request_invalid::${error}`));
  }
  validateAuthenticationResultShape(input.authentication, errors);

  let expectedAuthentication;
  try {
    expectedAuthentication = authenticateCanonicalGovernanceRootCommand({
      envelope: input.command,
      public_key: input.public_key
    });
    if (stablePayload(input.authentication) !== stablePayload(expectedAuthentication)) {
      errors.push('authentication_result_not_bound_to_command');
    }
  } catch {
    errors.push('authentication_result_verification_failed');
  }

  if (isPlainObject(input.authentication)
    && input.authentication.status !== AUTHENTICATION_STATUS.AUTHENTICATED) {
    errors.push('authentication_result_not_successful');
  }
  if (isPlainObject(input.command) && isPlainObject(input.authorization_request)) {
    if (input.command.installation_id !== input.authorization_request.installation_id) {
      errors.push('installation_binding_mismatch');
    }
    if (input.authorization_request.source_command_id === null
      || input.authorization_request.source_command_digest === null) {
      errors.push('authorization_request_source_command_binding_required');
    } else {
      if (input.authorization_request.source_command_id !== input.command.command_id) {
        errors.push('authorization_request_source_command_id_mismatch');
      }
      if (input.authorization_request.source_command_digest !== input.command.command_digest) {
        errors.push('authorization_request_source_command_digest_mismatch');
      }
    }
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAuthenticationEvidenceBinding(input) {
  const inputValidation = validateAuthenticationEvidenceBindingInput(input);
  if (!inputValidation.valid) {
    throw new TypeError(`authentication_evidence_binding_invalid::${inputValidation.errors.join(',')}`);
  }

  const material = {
    contract_version: CONTRACT_VERSION,
    authentication_evidence_domain: AUTHENTICATION_EVIDENCE_DOMAIN,
    status: AUTHENTICATION_EVIDENCE_STATUS,
    installation_id: input.command.installation_id,
    command_id: input.command.command_id,
    command_digest: input.command.command_digest,
    replay_identity: input.authentication.replay_identity,
    authorization_request_id: input.authorization_request.authorization_request_id,
    authorization_request_digest: input.authorization_request.authorization_request_digest,
    authentication_result_digest: authenticationResultDigest(input.authentication)
  };
  const binding = {
    contract_version: material.contract_version,
    authentication_evidence_domain: material.authentication_evidence_domain,
    authentication_evidence_id: authenticationEvidenceId(material),
    status: material.status,
    installation_id: material.installation_id,
    command_id: material.command_id,
    command_digest: material.command_digest,
    replay_identity: material.replay_identity,
    authorization_request_id: material.authorization_request_id,
    authorization_request_digest: material.authorization_request_digest,
    authentication_result_digest: material.authentication_result_digest,
    authentication_evidence_digest: 'pending'
  };
  binding.authentication_evidence_digest = authenticationEvidenceDigest(binding);
  const validation = validateAuthenticationEvidenceBinding(binding);
  if (!validation.valid) {
    throw new TypeError(`authentication_evidence_binding_invalid::${validation.errors.join(',')}`);
  }
  return cloneFrozen(binding);
}

function validateAuthenticationEvidenceBinding(binding, input = null) {
  const errors = [];
  if (!isPlainObject(binding)) {
    return { valid: false, errors: ['authentication_evidence_binding_must_be_object'] };
  }
  exactFields(binding, AUTHENTICATION_EVIDENCE_BINDING_FIELDS, 'authentication_evidence_binding', errors);
  if (binding.contract_version !== CONTRACT_VERSION) errors.push('authentication_evidence_binding_contract_version_invalid');
  if (binding.authentication_evidence_domain !== AUTHENTICATION_EVIDENCE_DOMAIN) {
    errors.push('authentication_evidence_binding_domain_invalid');
  }
  if (binding.status !== AUTHENTICATION_EVIDENCE_STATUS) errors.push('authentication_evidence_binding_status_invalid');
  for (const field of ['authentication_evidence_id', 'installation_id', 'command_id', 'authorization_request_id']) {
    if (!isIdentifier(binding[field])) errors.push(`authentication_evidence_binding_${field}_invalid`);
  }
  for (const field of [
    'command_digest',
    'replay_identity',
    'authorization_request_digest',
    'authentication_result_digest',
    'authentication_evidence_digest'
  ]) {
    if (!isDigest(binding[field])) errors.push(`authentication_evidence_binding_${field}_invalid`);
  }
  try {
    if (binding.authentication_evidence_id !== authenticationEvidenceId(binding)) {
      errors.push('authentication_evidence_binding_id_mismatch');
    }
    if (binding.authentication_evidence_digest !== authenticationEvidenceDigest(binding)) {
      errors.push('authentication_evidence_binding_digest_mismatch');
    }
  } catch (error) {
    errors.push(`authentication_evidence_binding_canonical_serialization_invalid::${error.message}`);
  }

  if (input !== null) {
    const inputValidation = validateAuthenticationEvidenceBindingInput(input);
    if (!inputValidation.valid) {
      errors.push(...inputValidation.errors);
    } else {
      const expected = buildAuthenticationEvidenceBinding(input);
      if (stablePayload(binding) !== stablePayload(expected)) {
        errors.push('authentication_evidence_binding_not_bound_to_inputs');
      }
    }
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AUTHENTICATION_EVIDENCE_BINDING_FIELDS,
  AUTHENTICATION_EVIDENCE_BINDING_INPUT_FIELDS,
  AUTHENTICATION_EVIDENCE_DOMAIN,
  AUTHENTICATION_EVIDENCE_STATUS,
  AUTHENTICATION_RESULT_FIELDS,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  authenticationEvidenceDigest,
  authenticationEvidenceDigestMaterial,
  authenticationEvidenceId,
  authenticationResultDigest,
  buildAuthenticationEvidenceBinding,
  canonicalAuthenticationEvidenceBytes,
  validateAuthenticationEvidenceBinding,
  validateAuthenticationEvidenceBindingInput,
  validateAuthenticationResultShape
};
