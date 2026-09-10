'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const {
  validateAuthorizationRequest
} = require('./canonical-governance-authorization-request-contract');
const {
  validateAuthenticationEvidenceBinding,
  validateAuthenticationEvidenceBindingInput
} = require('./canonical-governance-authentication-evidence-binding');
const {
  RESOLUTION_STATUS,
  resolveCanonicalGovernanceAuthorityGrant,
  validateResolutionRequest
} = require('./canonical-governance-authority-grant-resolution');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

// This is the governance authorization boundary only. It consumes the official request,
// authentication binding, and grant resolution evidence; it never executes, dispatches,
// approves, budgets, issues policy, or writes to persistence.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_AUTHORIZATION_DECISION_CONTRACT';
const CONTRACT_VERSION = 'hermes_canonical_governance_authorization_decision_v1';
const AUTHORIZATION_DECISION_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_AUTHORIZATION_DECISION_V1';

const AUTHORIZATION_DECISION_INPUT_FIELDS = Object.freeze([
  'authorization_request',
  'authentication_evidence',
  'authentication_evidence_input',
  'grant_resolution',
  'grant_resolution_input'
]);
const AUTHORIZATION_DECISION_FIELDS = Object.freeze([
  'contract_version',
  'authorization_decision_domain',
  'authorization_decision_id',
  'installation_id',
  'authorization_request_id',
  'authorization_request_digest',
  'authentication_evidence_id',
  'authentication_evidence_digest',
  'authority_grant_id',
  'grant_digest',
  'grant_resolution_status',
  'evaluation_time',
  'decision',
  'reason_code',
  'authorization_decision_digest'
]);
const AUTHORIZATION_DECISIONS = Object.freeze(['AUTHORIZED', 'DENIED', 'REJECTED']);
const AUTHORIZATION_REASON_CODES = Object.freeze([
  'within_validity_window_and_all_bindings_match',
  'grant_not_active',
  'subject_mismatch',
  'capability_mismatch',
  'scope_mismatch',
  'installation_mismatch',
  'request_invalid',
  'authentication_evidence_invalid',
  'grant_resolution_invalid',
  'evidence_mismatch'
]);
const AUTHORIZATION_DECISION_STATUS = Object.freeze({ AUTHORIZED: 'AUTHORIZED', DENIED: 'DENIED', REJECTED: 'REJECTED' });
const DECISION_FOR_REASON = Object.freeze({
  within_validity_window_and_all_bindings_match: AUTHORIZATION_DECISION_STATUS.AUTHORIZED,
  grant_not_active: AUTHORIZATION_DECISION_STATUS.DENIED,
  subject_mismatch: AUTHORIZATION_DECISION_STATUS.DENIED,
  capability_mismatch: AUTHORIZATION_DECISION_STATUS.DENIED,
  scope_mismatch: AUTHORIZATION_DECISION_STATUS.DENIED,
  installation_mismatch: AUTHORIZATION_DECISION_STATUS.DENIED,
  request_invalid: AUTHORIZATION_DECISION_STATUS.REJECTED,
  authentication_evidence_invalid: AUTHORIZATION_DECISION_STATUS.REJECTED,
  grant_resolution_invalid: AUTHORIZATION_DECISION_STATUS.REJECTED,
  evidence_mismatch: AUTHORIZATION_DECISION_STATUS.REJECTED
});
const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isDigest(value) {
  return isCanonicalContentDigest(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function nullableIdentifier(value) {
  return isIdentifier(value) ? value : null;
}

function nullableDigest(value) {
  return isDigest(value) ? value : null;
}

function decisionIdentityMaterial(decision) {
  const {
    authorization_decision_id: ignoredId,
    authorization_decision_digest: ignoredDigest,
    ...material
  } = decision;
  return material;
}

function authorizationDecisionDigestMaterial(decision) {
  const { authorization_decision_digest: ignoredDigest, ...material } = decision;
  return material;
}

function canonicalAuthorizationDecisionBytes(decision) {
  return Buffer.from(stablePayload(authorizationDecisionDigestMaterial(decision)), 'utf8');
}

function authorizationDecisionDigest(decision) {
  return computeCanonicalContentDigest(
    JSON.parse(canonicalAuthorizationDecisionBytes(decision).toString('utf8'))
  );
}

function authorizationDecisionId(decision) {
  const digest = computeCanonicalContentDigest(decisionIdentityMaterial(decision));
  return `authorization-decision:${digest.slice('sha256:'.length)}`;
}

function validateResolutionResultShape(result, errors = []) {
  if (!isPlainObject(result)) {
    errors.push('grant_resolution_must_be_object');
    return errors;
  }
  const fields = [
    'contract_name', 'contract_version', 'resolution_domain', 'status', 'reason_code',
    'validation_errors', 'installation_id', 'authority_grant_id', 'evaluation_time',
    'grant_digest', 'resolved_grant', 'revocation_count', 'effective_revocation_count',
    'revocation_digests', 'effective_revocation_digests'
  ];
  exactFields(result, fields, 'grant_resolution', errors);
  if (result.contract_name !== 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_RESOLUTION') errors.push('grant_resolution_contract_name_invalid');
  if (result.contract_version !== 'hermes_canonical_governance_authority_grant_resolution_v1') errors.push('grant_resolution_contract_version_invalid');
  if (result.resolution_domain !== 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_RESOLUTION_V1') errors.push('grant_resolution_domain_invalid');
  if (!Object.values(RESOLUTION_STATUS).includes(result.status)) errors.push('grant_resolution_status_invalid');
  if (result.reason_code !== null && typeof result.reason_code !== 'string') errors.push('grant_resolution_reason_code_invalid');
  if (!Array.isArray(result.validation_errors) || !result.validation_errors.every((value) => typeof value === 'string')) errors.push('grant_resolution_validation_errors_invalid');
  for (const field of ['installation_id', 'authority_grant_id']) {
    if (!isIdentifier(result[field])) errors.push(`grant_resolution_${field}_invalid`);
  }
  if (!isCanonicalTimestamp(result.evaluation_time)) errors.push('grant_resolution_evaluation_time_invalid');
  if (result.grant_digest !== null && !isDigest(result.grant_digest)) errors.push('grant_resolution_grant_digest_invalid');
  if (result.resolved_grant !== null && !isPlainObject(result.resolved_grant)) errors.push('grant_resolution_resolved_grant_invalid');
  for (const field of ['revocation_count', 'effective_revocation_count']) {
    if (!Number.isInteger(result[field]) || result[field] < 0) errors.push(`grant_resolution_${field}_invalid`);
  }
  for (const field of ['revocation_digests', 'effective_revocation_digests']) {
    if (!Array.isArray(result[field]) || !result[field].every(isDigest)) errors.push(`grant_resolution_${field}_invalid`);
  }
  return errors;
}

function validateAuthorizationDecisionInput(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ['authorization_decision_input_must_be_object'] };
  }
  exactFields(input, AUTHORIZATION_DECISION_INPUT_FIELDS, 'authorization_decision_input', errors);

  const requestValidation = validateAuthorizationRequest(input.authorization_request);
  if (!requestValidation.valid) errors.push(...requestValidation.errors.map((error) => `authorization_request_invalid::${error}`));

  const authenticationInputValidation = validateAuthenticationEvidenceBindingInput(input.authentication_evidence_input);
  if (!authenticationInputValidation.valid) {
    errors.push(...authenticationInputValidation.errors.map((error) => `authentication_evidence_invalid::${error}`));
  }
  const authenticationValidation = validateAuthenticationEvidenceBinding(
    input.authentication_evidence,
    input.authentication_evidence_input
  );
  if (!authenticationValidation.valid) {
    errors.push(...authenticationValidation.errors.map((error) => `authentication_evidence_invalid::${error}`));
  }

  const resolutionInputValidation = validateResolutionRequest(input.grant_resolution_input);
  if (!resolutionInputValidation.valid) {
    errors.push(...resolutionInputValidation.errors.map((error) => `grant_resolution_invalid::${error}`));
  }
  validateResolutionResultShape(input.grant_resolution, errors);
  if (resolutionInputValidation.valid && validateResolutionResultShape(input.grant_resolution, []).length === 0) {
    const expectedResolution = resolveCanonicalGovernanceAuthorityGrant(input.grant_resolution_input);
    try {
      if (stablePayload(input.grant_resolution) !== stablePayload(expectedResolution)) {
        errors.push('grant_resolution_invalid::grant_resolution_not_bound_to_inputs');
      }
    } catch {
      errors.push('grant_resolution_invalid::grant_resolution_not_serializable');
    }
  }

  if (requestValidation.valid && authenticationValidation.valid) {
    if (input.authentication_evidence.authorization_request_id !== input.authorization_request.authorization_request_id
      || input.authentication_evidence.authorization_request_digest !== input.authorization_request.authorization_request_digest) {
      errors.push('evidence_mismatch::authorization_request_identity_mismatch');
    }
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildDecisionResult(fields) {
  const decision = {
    contract_version: CONTRACT_VERSION,
    authorization_decision_domain: AUTHORIZATION_DECISION_DOMAIN,
    ...fields,
    authorization_decision_digest: 'pending'
  };
  decision.authorization_decision_id = authorizationDecisionId(decision);
  decision.authorization_decision_digest = authorizationDecisionDigest(decision);
  return cloneFrozen(decision);
}

function evaluateCanonicalGovernanceAuthorizationDecision(input) {
  const inputValidation = validateAuthorizationDecisionInput(input);
  if (!inputValidation.valid) {
    return buildDecisionResult({
      installation_id: null,
      authorization_request_id: null,
      authorization_request_digest: null,
      authentication_evidence_id: null,
      authentication_evidence_digest: null,
      authority_grant_id: null,
      grant_digest: null,
      grant_resolution_status: null,
      evaluation_time: null,
      decision: AUTHORIZATION_DECISION_STATUS.REJECTED,
      reason_code: 'evidence_mismatch'
    });
  }

  const request = input.authorization_request;
  const evidence = input.authentication_evidence;
  const resolution = input.grant_resolution;
  const grant = resolution.resolved_grant;
  const installationIds = [
    request.installation_id,
    evidence.installation_id,
    input.authentication_evidence_input.command.installation_id,
    input.authentication_evidence_input.authorization_request.installation_id,
    resolution.installation_id,
    input.grant_resolution_input.installation_id,
    grant && grant.installation_id
  ].filter((installationId) => installationId !== null && installationId !== undefined);
  const shared = {
    installation_id: request.installation_id,
    authorization_request_id: request.authorization_request_id,
    authorization_request_digest: request.authorization_request_digest,
    authentication_evidence_id: evidence.authentication_evidence_id,
    authentication_evidence_digest: evidence.authentication_evidence_digest,
    authority_grant_id: resolution.authority_grant_id,
    grant_digest: resolution.grant_digest,
    grant_resolution_status: resolution.status,
    evaluation_time: resolution.evaluation_time
  };

  let decision = AUTHORIZATION_DECISION_STATUS.AUTHORIZED;
  let reasonCode = 'within_validity_window_and_all_bindings_match';
  if (new Set(installationIds).size !== 1) {
    decision = AUTHORIZATION_DECISION_STATUS.DENIED;
    reasonCode = 'installation_mismatch';
  } else if (resolution.status === RESOLUTION_STATUS.REJECTED) {
    decision = AUTHORIZATION_DECISION_STATUS.REJECTED;
    reasonCode = 'grant_resolution_invalid';
  } else if (resolution.status !== RESOLUTION_STATUS.ACTIVE) {
    decision = AUTHORIZATION_DECISION_STATUS.DENIED;
    reasonCode = 'grant_not_active';
  } else if (request.subject_type !== grant.subject_type || request.subject_id !== grant.subject_id) {
    decision = AUTHORIZATION_DECISION_STATUS.DENIED;
    reasonCode = 'subject_mismatch';
  } else if (!grant.capabilities.includes(request.requested_capability)) {
    decision = AUTHORIZATION_DECISION_STATUS.DENIED;
    reasonCode = 'capability_mismatch';
  } else if (stablePayload(request.requested_scope) !== stablePayload(grant.authority_scope)) {
    decision = AUTHORIZATION_DECISION_STATUS.DENIED;
    reasonCode = 'scope_mismatch';
  }
  return buildDecisionResult({ ...shared, decision, reason_code: reasonCode });
}

function validateAuthorizationDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['authorization_decision_must_be_object'] };
  exactFields(decision, AUTHORIZATION_DECISION_FIELDS, 'authorization_decision', errors);
  if (decision.contract_version !== CONTRACT_VERSION) errors.push('authorization_decision_contract_version_invalid');
  if (decision.authorization_decision_domain !== AUTHORIZATION_DECISION_DOMAIN) errors.push('authorization_decision_domain_invalid');
  if (!AUTHORIZATION_DECISIONS.includes(decision.decision)) errors.push('authorization_decision_invalid');
  if (!AUTHORIZATION_REASON_CODES.includes(decision.reason_code)) errors.push('authorization_decision_reason_code_invalid');
  if (!isIdentifier(decision.authorization_decision_id)) errors.push('authorization_decision_id_invalid');
  if (decision.installation_id !== null && !isIdentifier(decision.installation_id)) errors.push('authorization_decision_installation_id_invalid');
  for (const field of ['authorization_request_id', 'authentication_evidence_id', 'authority_grant_id']) {
    if (decision[field] !== null && !isIdentifier(decision[field])) errors.push(`authorization_decision_${field}_invalid`);
  }
  for (const field of ['authorization_request_digest', 'authentication_evidence_digest', 'grant_digest']) {
    if (decision[field] !== null && !isDigest(decision[field])) errors.push(`authorization_decision_${field}_invalid`);
  }
  if (decision.grant_resolution_status !== null && !Object.values(RESOLUTION_STATUS).includes(decision.grant_resolution_status)) {
    errors.push('authorization_decision_grant_resolution_status_invalid');
  }
  if (decision.evaluation_time !== null && !isCanonicalTimestamp(decision.evaluation_time)) errors.push('authorization_decision_evaluation_time_invalid');
  if (DECISION_FOR_REASON[decision.reason_code] !== decision.decision) {
    errors.push('authorization_decision_outcome_reason_mismatch');
  }
  try {
    if (decision.authorization_decision_id !== authorizationDecisionId(decision)) errors.push('authorization_decision_id_mismatch');
    if (decision.authorization_decision_digest !== authorizationDecisionDigest(decision)) errors.push('authorization_decision_digest_mismatch');
  } catch (error) {
    errors.push(`authorization_decision_canonical_serialization_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AUTHORIZATION_DECISION_DOMAIN,
  AUTHORIZATION_DECISION_FIELDS,
  AUTHORIZATION_DECISION_INPUT_FIELDS,
  AUTHORIZATION_DECISIONS,
  AUTHORIZATION_DECISION_STATUS,
  AUTHORIZATION_REASON_CODES,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  authorizationDecisionDigest,
  authorizationDecisionDigestMaterial,
  authorizationDecisionId,
  buildDecisionResult,
  canonicalAuthorizationDecisionBytes,
  evaluateCanonicalGovernanceAuthorizationDecision,
  validateAuthorizationDecision,
  validateAuthorizationDecisionInput,
  validateResolutionResultShape
};
