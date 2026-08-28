'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  CLAIM_CONTRACT_VERSION,
  buildCanonicalClaimIdentity,
  canonicalIdentityFromPersistedRow,
  computeClaimDigest,
  computeClaimFingerprint,
  computeClaimId,
  validatePersistedClaimIdentity
} = require('./runtime-execution-attempt-durable-claim-contract');
const {
  CONTRACT_NAME: CLAIM_INTENT_CONTRACT_NAME,
  validateClaimIntent
} = require('./runtime-execution-attempt-claim-intent-simulation');
const {
  CONTRACT_NAME: ELIGIBILITY_CONTRACT_NAME,
  ELIGIBLE_STATUS,
  validateClaimEligibilityDecision
} = require('./runtime-execution-attempt-claim-eligibility-decision-simulation');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_DURABLE_CLAIM_ACQUISITION';
const CONTRACT_VERSION = 'runtime_execution_attempt_durable_claim_acquisition_contract_v1';
const VERSION = 1;
const CLAIM_ORDINAL = 1;
const CLAIM_STATE = 'ACTIVE';
const SUCCESS_OUTCOMES = Object.freeze(['CREATED', 'EXISTING_IDENTICAL', 'CONFLICT']);
const REJECTION_OUTCOMES = Object.freeze(['INELIGIBLE', 'INVALID', 'STALE', 'NOT_FOUND', 'TECHNICAL_FAILURE']);
const INPUT_FIELDS = Object.freeze([
  'runtime_execution_attempt_claim_intent',
  'runtime_execution_attempt_claim_eligibility_decision'
]);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);

function referenceFromIntent(intent) {
  return {
    id: intent.runtime_execution_attempt_claim_intent_id,
    version: intent.runtime_execution_attempt_claim_intent_version,
    fingerprint: intent.runtime_execution_attempt_claim_intent_fingerprint,
    digest: intent.runtime_execution_attempt_claim_intent_digest
  };
}

function referenceFromDecision(decision) {
  return {
    id: decision.runtime_execution_attempt_claim_eligibility_decision_id,
    version: decision.runtime_execution_attempt_claim_eligibility_decision_version,
    fingerprint: decision.runtime_execution_attempt_claim_eligibility_decision_fingerprint,
    digest: decision.runtime_execution_attempt_claim_eligibility_decision_digest
  };
}

function attemptReferenceFromIntent(intent) {
  return intent.runtime_execution_attempt_durable_record_reference;
}

function attemptReferenceFromDecision(decision) {
  return decision.runtime_execution_attempt_durable_record_reference;
}

function sameReference(left, right) {
  return ['id', 'version', 'fingerprint', 'digest'].every((field) => left?.[field] === right?.[field]);
}

function sameScope(left, right) {
  return IDENTITY_SCOPE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function validateInput(input = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, outcome: 'INVALID', errors: ['acquisition_input_must_be_object'] };
  }
  exactFields(input, INPUT_FIELDS, 'runtime_execution_attempt_durable_claim_acquisition_input', errors);
  const intent = input.runtime_execution_attempt_claim_intent;
  const decision = input.runtime_execution_attempt_claim_eligibility_decision;
  const intentValidation = validateClaimIntent(intent);
  const decisionValidation = validateClaimEligibilityDecision(decision);
  if (!intentValidation.valid) errors.push(...intentValidation.errors.map((error) => `claim_intent_${error}`));
  if (!decisionValidation.valid) errors.push(...decisionValidation.errors.map((error) => `claim_eligibility_${error}`));

  if (decision?.status === ELIGIBLE_STATUS && decision?.claim_eligible === true) {
    if (!sameReference(decision.runtime_execution_attempt_claim_intent_reference, referenceFromIntent(intent))) {
      errors.push('claim_intent_reference_mismatch');
    }
    if (!sameReference(attemptReferenceFromDecision(decision), attemptReferenceFromIntent(intent))) {
      errors.push('attempt_reference_mismatch');
    }
    if (!sameScope(decision.identity_scope, intent.identity_scope)) errors.push('identity_scope_mismatch');
    if (decision.attempt_ordinal !== intent.attempt_ordinal) errors.push('attempt_ordinal_mismatch');
    if (decision.attempt_state !== 'ADMITTED') errors.push('attempt_state_not_admitted');
    if (decision.attempt_revision !== 2) errors.push('attempt_revision_not_two');
  }

  const validIneligible = decision?.status !== undefined
    && decision.status !== ELIGIBLE_STATUS
    && decision?.claim_eligible === false
    && decisionValidation.valid
    && intentValidation.valid;
  if (validIneligible) errors.push('claim_not_eligible');

  const outcome = decision?.status !== undefined && decision.status !== ELIGIBLE_STATUS
    && decision?.claim_eligible === false && decisionValidation.valid && intentValidation.valid
    ? 'INELIGIBLE'
    : 'INVALID';
  return { valid: errors.length === 0, outcome: errors.length === 0 ? null : outcome, errors: [...new Set(errors)].sort() };
}

function buildCanonicalIdentity(input) {
  const intent = input.runtime_execution_attempt_claim_intent;
  const decision = input.runtime_execution_attempt_claim_eligibility_decision;
  return buildCanonicalClaimIdentity({
    claim_contract_version: CLAIM_CONTRACT_VERSION,
    claim_ordinal: CLAIM_ORDINAL,
    attempt_durable_record_id: decision.runtime_execution_attempt_durable_record_reference.id,
    attempt_state: decision.attempt_state,
    attempt_revision: decision.attempt_revision,
    ...Object.fromEntries(IDENTITY_SCOPE_FIELDS.map((field) => [field, decision.identity_scope[field]])),
    attempt_ordinal: decision.attempt_ordinal,
    claim_intent_contract_name: intent.contract_name,
    claim_intent_contract_version: intent.contract_version,
    claim_intent_reference_id: intent.runtime_execution_attempt_claim_intent_id,
    claim_intent_reference_version: intent.runtime_execution_attempt_claim_intent_version,
    claim_intent_reference_fingerprint: intent.runtime_execution_attempt_claim_intent_fingerprint,
    claim_intent_reference_digest: intent.runtime_execution_attempt_claim_intent_digest,
    claim_eligibility_contract_name: decision.contract_name,
    claim_eligibility_contract_version: decision.contract_version,
    claim_eligibility_decision_status: decision.status,
    claim_eligibility_decision_reference_id: decision.runtime_execution_attempt_claim_eligibility_decision_id,
    claim_eligibility_decision_reference_version: decision.runtime_execution_attempt_claim_eligibility_decision_version,
    claim_eligibility_decision_reference_fingerprint: decision.runtime_execution_attempt_claim_eligibility_decision_fingerprint,
    claim_eligibility_decision_reference_digest: decision.runtime_execution_attempt_claim_eligibility_decision_digest
  });
}

function authorityArtifact(identity, claimId, claimFingerprint, claimDigest) {
  return {
    claim_id: claimId,
    claim_contract_version: identity.claim_contract_version,
    claim_state: CLAIM_STATE,
    attempt_durable_record_id: identity.attempt_durable_record_id,
    attempt_state: identity.attempt_state,
    attempt_revision: identity.attempt_revision,
    claim_eligibility_decision_reference_id: identity.claim_eligibility_decision_reference_id,
    claim_eligibility_decision_reference_digest: identity.claim_eligibility_decision_reference_digest,
    claim_fingerprint: claimFingerprint,
    claim_digest: claimDigest,
    simulation: false,
    production_blocked: true,
    worker_bound: false,
    worker_ownership_established: false,
    lease_created: false,
    fencing_token_created: false,
    execution_authorized: false
  };
}

function buildAcquisitionPlan(input = {}) {
  const validation = validateInput(input);
  if (!validation.valid) {
    const error = new Error(`runtime_execution_attempt_durable_claim_acquisition_input_invalid::${JSON.stringify(validation.errors)}`);
    error.code = validation.outcome;
    error.validation_errors = validation.errors;
    throw error;
  }
  const identity = buildCanonicalIdentity(input);
  const claimFingerprint = computeClaimFingerprint(identity);
  const claimDigest = computeClaimDigest(identity);
  const claimId = computeClaimId(identity);
  const artifact = authorityArtifact(identity, claimId, claimFingerprint, claimDigest);
  const receipt = { ...artifact, receipt: true };
  return cloneFrozen({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    version: VERSION,
    identity,
    claim_id: claimId,
    claim_fingerprint: claimFingerprint,
    claim_digest: claimDigest,
    claim_state: CLAIM_STATE,
    claim_ordinal: CLAIM_ORDINAL,
    claim_artifact: artifact,
    claim_receipt: receipt
  });
}

function planToInsertRow(plan) {
  const { identity } = plan;
  return {
    claim_id: plan.claim_id,
    claim_ordinal: plan.claim_ordinal,
    attempt_durable_record_id: identity.attempt_durable_record_id,
    attempt_state: identity.attempt_state,
    attempt_revision: identity.attempt_revision,
    ...Object.fromEntries(IDENTITY_SCOPE_FIELDS.map((field) => [field, identity[field]])),
    attempt_ordinal: identity.attempt_ordinal,
    claim_intent_contract_name: identity.claim_intent_contract_name,
    claim_intent_contract_version: identity.claim_intent_contract_version,
    claim_intent_reference_id: identity.claim_intent_reference_id,
    claim_intent_reference_version: identity.claim_intent_reference_version,
    claim_intent_reference_fingerprint: identity.claim_intent_reference_fingerprint,
    claim_intent_reference_digest: identity.claim_intent_reference_digest,
    claim_eligibility_contract_name: identity.claim_eligibility_contract_name,
    claim_eligibility_contract_version: identity.claim_eligibility_contract_version,
    claim_eligibility_decision_status: identity.claim_eligibility_decision_status,
    claim_eligibility_decision_reference_id: identity.claim_eligibility_decision_reference_id,
    claim_eligibility_decision_reference_version: identity.claim_eligibility_decision_reference_version,
    claim_eligibility_decision_reference_fingerprint: identity.claim_eligibility_decision_reference_fingerprint,
    claim_eligibility_decision_reference_digest: identity.claim_eligibility_decision_reference_digest,
    claim_contract_version: identity.claim_contract_version,
    claim_state: plan.claim_state,
    claim_fingerprint: plan.claim_fingerprint,
    claim_digest: plan.claim_digest,
    claim_artifact: plan.claim_artifact,
    claim_receipt: plan.claim_receipt,
    schema_version: 1
  };
}

function requiredArtifactBinding(value, row) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.claim_id === row.claim_id
    && value.attempt_durable_record_id === row.attempt_durable_record_id
    && value.claim_state === row.claim_state
    && value.claim_eligibility_decision_reference_id === row.claim_eligibility_decision_reference_id
    && value.claim_eligibility_decision_reference_digest === row.claim_eligibility_decision_reference_digest
    && value.claim_fingerprint === row.claim_fingerprint
    && value.claim_digest === row.claim_digest;
}

function classifyPersistedClaim(row, plan) {
  try {
    if (!row || row.claim_state !== CLAIM_STATE || Number(row.claim_ordinal) !== CLAIM_ORDINAL) {
      return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_claim_lifecycle_invalid' };
    }
    const validation = validatePersistedClaimIdentity(row);
    if (!validation.valid) return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_claim_identity_invalid', validation_errors: validation.errors };
    if (!requiredArtifactBinding(row.claim_artifact, row) || !requiredArtifactBinding(row.claim_receipt, row)) {
      return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_claim_artifact_binding_invalid' };
    }
    const requestedIdentity = plan.identity;
    const persistedIdentity = canonicalIdentityFromPersistedRow(row);
    if (stablePayload(persistedIdentity) !== stablePayload(requestedIdentity)) {
      return { outcome: 'CONFLICT', reason_code: 'canonical_claim_conflict' };
    }
    return { outcome: 'EXISTING_IDENTICAL', reason_code: 'canonical_claim_replay' };
  } catch {
    return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_claim_identity_invalid' };
  }
}

module.exports = {
  CLAIM_ORDINAL,
  CLAIM_STATE,
  CLAIM_INTENT_CONTRACT_NAME,
  ELIGIBILITY_CONTRACT_NAME,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  REJECTION_OUTCOMES,
  SUCCESS_OUTCOMES,
  buildAcquisitionPlan,
  classifyPersistedClaim,
  planToInsertRow,
  validateInput,
  isCanonicalContentDigest
};
