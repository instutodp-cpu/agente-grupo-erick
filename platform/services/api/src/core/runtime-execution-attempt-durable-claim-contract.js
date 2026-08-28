'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

const CLAIM_CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_DURABLE_CLAIM';
const CLAIM_CONTRACT_VERSION = 'runtime_execution_attempt_durable_claim_v1';
const CLAIM_ID_PREFIX = 'runtime-execution-attempt-durable-claim-';
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const CANONICAL_FIELDS = Object.freeze([
  'claim_contract_version', 'claim_ordinal', 'attempt_durable_record_id', 'attempt_state', 'attempt_revision',
  ...IDENTITY_SCOPE_FIELDS, 'attempt_ordinal',
  'claim_intent_contract_name', 'claim_intent_contract_version', 'claim_intent_reference_id',
  'claim_intent_reference_version', 'claim_intent_reference_fingerprint', 'claim_intent_reference_digest',
  'claim_eligibility_contract_name', 'claim_eligibility_contract_version', 'claim_eligibility_decision_status',
  'claim_eligibility_decision_reference_id', 'claim_eligibility_decision_reference_version',
  'claim_eligibility_decision_reference_fingerprint', 'claim_eligibility_decision_reference_digest'
]);

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name}_must_be_object`);
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${name}_invalid`);
}

function requireReference(value, name) {
  requireObject(value, name);
  exactFields(value, REFERENCE_FIELDS, name, []);
  requireNonEmptyString(value.id, `${name}_id`);
  if (!Number.isInteger(value.version) || value.version < 1) throw new TypeError(`${name}_version_invalid`);
  requireNonEmptyString(value.fingerprint, `${name}_fingerprint`);
  if (!isCanonicalContentDigest(value.digest)) throw new TypeError(`${name}_digest_invalid`);
}

function buildCanonicalClaimIdentity(input = {}) {
  requireObject(input, 'claim_identity');
  const allowed = [...CANONICAL_FIELDS];
  const fieldErrors = [];
  exactFields(input, allowed, 'claim_identity', fieldErrors);
  if (fieldErrors.length > 0) throw new TypeError(fieldErrors[0]);
  requireNonEmptyString(input.claim_contract_version, 'claim_contract_version');
  if (!Number.isInteger(input.claim_ordinal) || input.claim_ordinal < 1) throw new TypeError('claim_ordinal_invalid');
  requireNonEmptyString(input.attempt_durable_record_id, 'attempt_durable_record_id');
  if (input.attempt_state !== 'ADMITTED') throw new TypeError('attempt_state_invalid');
  if (input.attempt_revision !== 2) throw new TypeError('attempt_revision_invalid');
  for (const field of IDENTITY_SCOPE_FIELDS) requireNonEmptyString(input[field], field);
  if (!Number.isInteger(input.attempt_ordinal) || input.attempt_ordinal < 1) throw new TypeError('attempt_ordinal_invalid');
  requireNonEmptyString(input.claim_intent_contract_name, 'claim_intent_contract_name');
  requireNonEmptyString(input.claim_intent_contract_version, 'claim_intent_contract_version');
  requireNonEmptyString(input.claim_eligibility_contract_name, 'claim_eligibility_contract_name');
  requireNonEmptyString(input.claim_eligibility_contract_version, 'claim_eligibility_contract_version');
  requireNonEmptyString(input.claim_eligibility_decision_status, 'claim_eligibility_decision_status');
  requireReference({
    id: input.claim_intent_reference_id,
    version: input.claim_intent_reference_version,
    fingerprint: input.claim_intent_reference_fingerprint,
    digest: input.claim_intent_reference_digest
  }, 'claim_intent_reference');
  requireReference({
    id: input.claim_eligibility_decision_reference_id,
    version: input.claim_eligibility_decision_reference_version,
    fingerprint: input.claim_eligibility_decision_reference_fingerprint,
    digest: input.claim_eligibility_decision_reference_digest
  }, 'claim_eligibility_decision_reference');
  return cloneFrozen(Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, input[field]])));
}

function canonicalIdentityFromPersistedRow(row) {
  requireObject(row, 'persisted_claim');
  return buildCanonicalClaimIdentity(Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, row[field]])));
}

function computeClaimFingerprint(identity) {
  return stablePayload(buildCanonicalClaimIdentity(identity));
}

function computeClaimDigest(identity) {
  return computeCanonicalContentDigest(buildCanonicalClaimIdentity(identity));
}

function computeClaimId(identity) {
  const digest = computeClaimDigest(identity);
  return `${CLAIM_ID_PREFIX}${digest.slice('sha256:'.length)}`;
}

function validatePersistedClaimIdentity(row) {
  try {
    const identity = canonicalIdentityFromPersistedRow(row);
    const errors = [];
    if (row.claim_fingerprint !== computeClaimFingerprint(identity)) errors.push('claim_fingerprint_mismatch');
    if (row.claim_digest !== computeClaimDigest(identity)) errors.push('claim_digest_mismatch');
    if (row.claim_id !== computeClaimId(identity)) errors.push('claim_id_mismatch');
    return { valid: errors.length === 0, errors, identity };
  } catch (error) {
    return { valid: false, errors: [error.message], identity: null };
  }
}

module.exports = {
  CALCULATED_IDENTITY_FIELDS: CANONICAL_FIELDS,
  CLAIM_CONTRACT_NAME,
  CLAIM_CONTRACT_VERSION,
  CLAIM_ID_PREFIX,
  IDENTITY_SCOPE_FIELDS,
  buildCanonicalClaimIdentity,
  canonicalIdentityFromPersistedRow,
  computeClaimDigest,
  computeClaimFingerprint,
  computeClaimId,
  validatePersistedClaimIdentity
};
