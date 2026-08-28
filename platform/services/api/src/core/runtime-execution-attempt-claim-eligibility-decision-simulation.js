'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  CONTRACT_NAME: CLAIM_INTENT_CONTRACT_NAME,
  CONTRACT_VERSION: CLAIM_INTENT_CONTRACT_VERSION,
  validateClaimIntent
} = require('./runtime-execution-attempt-claim-intent-simulation');
const {
  validateRuntimeWorkerAssignmentDecision
} = require('./runtime-worker-assignment-decision');
const {
  validateRuntimeWorkerAssignmentPackage
} = require('./runtime-worker-assignment-package');
const {
  validateRuntimeWorkerHealthReference
} = require('./runtime-worker-health-reference');
const {
  validateRuntimeWorkerCapacityReference
} = require('./runtime-worker-capacity-reference');
const {
  EXPIRED_FLAG_FIELDS,
  computeFreshnessFingerprint,
  validateRuntimeReadinessFreshnessReference
} = require('./runtime-readiness-freshness-reference');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_ELIGIBILITY_DECISION_SIMULATION';
const CONTRACT_VERSION = 'runtime_execution_attempt_claim_eligibility_decision_simulation_contract_v1';
const VERSION = 1;
const ELIGIBLE_STATUS = 'EXECUTION_ATTEMPT_CLAIM_ELIGIBLE_SIMULATION';
const INELIGIBLE_STATUS = 'EXECUTION_ATTEMPT_CLAIM_INELIGIBLE_SIMULATION';
const STATE = 'EXECUTION_ATTEMPT_CLAIM_ELIGIBILITY_DECISION_REFERENCE_SIMULATION';
const ELIGIBLE_DECISION = 'DECLARE_CLAIM_ELIGIBLE_SIMULATION';
const INELIGIBLE_DECISION = 'DECLARE_CLAIM_INELIGIBLE_SIMULATION';
const VALIDATOR_VERSION = 'runtime_execution_attempt_claim_eligibility_decision_simulation_validator_v1';
const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const EVIDENCE_INPUT_FIELDS = Object.freeze([
  'runtime_execution_attempt_claim_intent',
  'runtime_worker_assignment_decision',
  'runtime_worker_assignment_package',
  'runtime_worker_health_reference',
  'runtime_worker_capacity_reference',
  'runtime_freshness_reference'
]);
const WORKER_ASSIGNMENT_ELIGIBLE_STATUS = 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION';
const WORKER_OPERATIONAL_SAFE_FLAGS = Object.freeze([
  'worker_assignment_applied', 'worker_reserved', 'worker_started', 'stage_dispatched',
  'stage_started', 'executed'
]);
const EVIDENCE_VALIDATION_FLAGS = Object.freeze([
  'worker_references_validated', 'health_validated', 'capacity_validated',
  'freshness_validated', 'candidate_sets_validated', 'assignments_validated',
  'non_execution_invariants_validated'
]);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

const SAFE_FLAGS = Object.freeze({
  attempt_created: true,
  attempt_persisted: true,
  attempt_admitted: true,
  claim_intent_required: true,
  claim_intent_created: true,
  claim_eligibility_decided: true,
  claim_eligible: true,
  worker_resource_eligibility_validated: true,
  health_evidence_validated: true,
  capacity_evidence_validated: true,
  freshness_evidence_validated: true,
  claim_issued: false,
  claim_artifact_created: false,
  worker_selected: false,
  worker_bound: false,
  worker_assignment_consumed: false,
  worker_ownership_established: false,
  executor_bound: false,
  executor_ownership_established: false,
  lease_created: false,
  lease_granted: false,
  fencing_token_created: false,
  fencing_token_issued: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  provider_call_allowed: false,
  provider_called: false,
  network_call_allowed: false,
  network_used: false,
  secrets_materialized: false,
  external_effect_allowed: false,
  external_effect_performed: false,
  capacity_reservation_included: false,
  quota_mutation_included: false,
  queue_mutation_included: false,
  simulation: true,
  production_blocked: true
});

const FIELDS = Object.freeze([
  'runtime_execution_attempt_claim_eligibility_decision_id',
  'runtime_execution_attempt_claim_eligibility_decision_version',
  'runtime_execution_attempt_claim_eligibility_decision_fingerprint',
  'runtime_execution_attempt_claim_eligibility_decision_digest',
  'contract_name', 'contract_version', 'version', 'status', 'state', 'decision',
  'predecessor_contract_name', 'predecessor_contract_version',
  'runtime_execution_attempt_claim_intent_reference',
  'runtime_execution_attempt_durable_record_reference',
  'runtime_worker_assignment_decision_id',
  'runtime_worker_assignment_package_reference',
  'runtime_worker_health_reference',
  'runtime_worker_capacity_reference',
  'runtime_freshness_reference',
  'attempt_state', 'attempt_revision', 'identity_scope', 'attempt_ordinal', 'reason_codes',
  ...Object.keys(SAFE_FLAGS), 'validator_version'
]);

function validateReference(value, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  exactFields(value, REFERENCE_FIELDS, prefix, errors);
  if (!isNonEmptyString(value.id)) errors.push(`${prefix}_id_invalid`);
  if (!Number.isInteger(value.version) || value.version < 1) errors.push(`${prefix}_version_invalid`);
  if (!isNonEmptyString(value.fingerprint)) errors.push(`${prefix}_fingerprint_invalid`);
  if (!isCanonicalContentDigest(value.digest)) errors.push(`${prefix}_digest_invalid`);
}

function validateReferenceFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_missing`);
    return;
  }
  exactFields(value, fields, prefix, errors);
  if (!isNonEmptyString(value.id)) errors.push(`${prefix}_id_invalid`);
  if (!Number.isInteger(value.version) || value.version < 1) errors.push(`${prefix}_version_invalid`);
  if (!isNonEmptyString(value.fingerprint)) errors.push(`${prefix}_fingerprint_invalid`);
  if (fields.includes('digest') && !isCanonicalContentDigest(value.digest)) errors.push(`${prefix}_digest_invalid`);
}

function validateIdentityScope(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('identity_scope_must_be_object');
    return;
  }
  exactFields(value, IDENTITY_SCOPE_FIELDS, 'identity_scope', errors);
  for (const field of IDENTITY_SCOPE_FIELDS) {
    if (!isNonEmptyString(value[field])) errors.push(`identity_scope_${field}_invalid`);
  }
}

function referenceFromIntent(intent, prefix) {
  const value = intent?.[prefix];
  if (!isPlainObject(value)) return { id: 'reference_not_available', version: 1, fingerprint: 'fingerprint_not_available', digest: ZERO_DIGEST };
  return {
    id: isNonEmptyString(value.id) ? value.id : 'reference_not_available',
    version: Number.isInteger(value.version) && value.version > 0 ? value.version : 1,
    fingerprint: isNonEmptyString(value.fingerprint) ? value.fingerprint : 'fingerprint_not_available',
    digest: isCanonicalContentDigest(value.digest) ? value.digest : ZERO_DIGEST
  };
}

function scopeFromIntent(intent) {
  const scope = intent?.identity_scope;
  return Object.fromEntries(IDENTITY_SCOPE_FIELDS.map((field) => [
    field,
    isPlainObject(scope) && isNonEmptyString(scope[field]) ? scope[field] : 'scope_not_available'
  ]));
}

function safeAttemptState(intent) {
  return isNonEmptyString(intent?.attempt_state) ? intent.attempt_state : 'UNKNOWN';
}

function safeAttemptRevision(intent) {
  return Number.isInteger(intent?.attempt_revision) && intent.attempt_revision >= 0 ? intent.attempt_revision : 0;
}

function safeAttemptOrdinal(intent) {
  return Number.isInteger(intent?.attempt_ordinal) && intent.attempt_ordinal >= 0 ? intent.attempt_ordinal : 0;
}

function mapValidationErrors(errors, claimIntentErrors = false) {
  const codes = new Set(claimIntentErrors && errors.length > 0 ? ['claim_intent_invalid'] : []);
  for (const error of errors) {
    const isClaimError = !error.startsWith('worker_') && !error.startsWith('freshness_') && !error.startsWith('eligibility_evidence_');
    if (error.startsWith('worker_assignment_decision_') || error.startsWith('worker_assignment_package_')
      || error.startsWith('worker_resource_') || error.startsWith('worker_evidence_')
      || error.startsWith('worker_eligibility_')) codes.add('worker_resource_eligibility_invalid');
    if (error.startsWith('worker_health_') || error.startsWith('health_')) codes.add('health_evidence_invalid');
    if (error.startsWith('worker_capacity_') || error.startsWith('capacity_')) codes.add('capacity_evidence_invalid');
    if (error.startsWith('freshness_') || error.startsWith('worker_freshness_')) codes.add('freshness_evidence_invalid');
    if (error.includes('not_eligible') && error.includes('health')) codes.add('worker_health_ineligible');
    if (error.includes('not_eligible') && error.includes('capacity')) codes.add('worker_capacity_ineligible');
    if (error.includes('not_eligible') && error.includes('freshness')) codes.add('freshness_ineligible');
    if (isClaimError && (error === 'claim_intent_invalid' || error.includes('claim_intent'))) codes.add('claim_intent_invalid');
    if (isClaimError && error.includes('attempt_state')) codes.add('attempt_state_not_admitted');
    if (isClaimError && error.includes('attempt_revision')) codes.add('attempt_revision_not_two');
    if (isClaimError && error.includes('identity_scope')) codes.add('identity_scope_invalid');
    if (isClaimError && (error.includes('attempt_reference') || error.includes('claim_intent_reference'))) codes.add('claim_intent_reference_invalid');
    if (isClaimError && (error.includes('fingerprint') || error.includes('digest'))) codes.add('predecessor_integrity_invalid');
    if (isClaimError && error.includes('id')) codes.add('claim_intent_identity_invalid');
    if (isClaimError && error.includes('ordinal')) codes.add('attempt_ordinal_invalid');
    if (isClaimError && (error.includes('contract') || error.includes('version'))) codes.add('claim_intent_contract_invalid');
  }
  return uniqueSorted([...codes]);
}

function evidenceReferenceFrom(value, fields, fallbackPrefix) {
  return fields.reduce((reference, field) => {
    if (field === 'id') reference.id = isNonEmptyString(value?.id) ? value.id : `${fallbackPrefix}_not_available`;
    if (field === 'version') reference.version = Number.isInteger(value?.version) && value.version > 0 ? value.version : VERSION;
    if (field === 'fingerprint') reference.fingerprint = isNonEmptyString(value?.fingerprint) ? value.fingerprint : `${fallbackPrefix}_fingerprint_not_available`;
    if (field === 'digest') reference.digest = isCanonicalContentDigest(value?.digest) ? value.digest : ZERO_DIGEST;
    return reference;
  }, {});
}

function assignmentPackageReferenceFrom(packageEvidence) {
  return evidenceReferenceFrom({
    id: packageEvidence?.runtime_worker_assignment_package_id,
    version: packageEvidence?.runtime_worker_assignment_package_version,
    fingerprint: packageEvidence?.worker_assignment_package_fingerprint,
    digest: packageEvidence?.worker_assignment_package_digest
  }, REFERENCE_FIELDS, 'worker_assignment_package');
}

function healthReferenceFrom(healthEvidence) {
  return evidenceReferenceFrom({
    id: healthEvidence?.worker_health_reference_id,
    version: healthEvidence?.worker_health_reference_version,
    fingerprint: healthEvidence?.health_fingerprint
  }, ['id', 'version', 'fingerprint'], 'worker_health');
}

function capacityReferenceFrom(capacityEvidence) {
  return evidenceReferenceFrom({
    id: capacityEvidence?.worker_capacity_reference_id,
    version: capacityEvidence?.worker_capacity_reference_version,
    fingerprint: capacityEvidence?.capacity_fingerprint,
    digest: capacityEvidence?.capacity_digest
  }, REFERENCE_FIELDS, 'worker_capacity');
}

function freshnessReferenceFrom(freshnessEvidence) {
  return evidenceReferenceFrom({
    id: freshnessEvidence?.runtime_readiness_freshness_reference_id,
    version: freshnessEvidence?.runtime_readiness_freshness_reference_version,
    fingerprint: freshnessEvidence?.freshness_fingerprint
  }, ['id', 'version', 'fingerprint'], 'freshness');
}

function identityMatches(value, identityScope) {
  return IDENTITY_SCOPE_FIELDS.every((field) => value?.[field] === identityScope?.[field]);
}

function addEvidenceErrors(input, errors) {
  const decision = input?.runtime_worker_assignment_decision;
  const assignmentPackage = input?.runtime_worker_assignment_package;
  const health = input?.runtime_worker_health_reference;
  const capacity = input?.runtime_worker_capacity_reference;
  const freshness = input?.runtime_freshness_reference;
  const identityScope = input?.runtime_execution_attempt_claim_intent?.identity_scope;
  let canonicalEvidenceValid = true;

  if (!isPlainObject(decision)) {
    errors.push('worker_assignment_decision_missing');
    canonicalEvidenceValid = false;
  }
  else {
    const validation = validateRuntimeWorkerAssignmentDecision(decision);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => `worker_assignment_decision_${error}`));
      canonicalEvidenceValid = false;
    }
  }
  if (!isPlainObject(assignmentPackage)) {
    errors.push('worker_assignment_package_missing');
    canonicalEvidenceValid = false;
  }
  else {
    const validation = validateRuntimeWorkerAssignmentPackage(assignmentPackage);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => `worker_assignment_package_${error}`));
      canonicalEvidenceValid = false;
    }
  }
  if (!isPlainObject(health)) {
    errors.push('worker_health_reference_missing');
    canonicalEvidenceValid = false;
  }
  else {
    const validation = validateRuntimeWorkerHealthReference(health);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => `worker_health_${error}`));
      canonicalEvidenceValid = false;
    }
  }
  if (!isPlainObject(capacity)) {
    errors.push('worker_capacity_reference_missing');
    canonicalEvidenceValid = false;
  }
  else {
    const validation = validateRuntimeWorkerCapacityReference(capacity);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => `worker_capacity_${error}`));
      canonicalEvidenceValid = false;
    }
  }
  if (!isPlainObject(freshness)) {
    errors.push('freshness_reference_missing');
    canonicalEvidenceValid = false;
  }
  else {
    const validation = validateRuntimeReadinessFreshnessReference(freshness);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => `freshness_${error}`));
      canonicalEvidenceValid = false;
    }
  }

  if (!canonicalEvidenceValid) return;

  if (decision.status !== WORKER_ASSIGNMENT_ELIGIBLE_STATUS || decision.worker_assignment_evaluated !== true
    || decision.worker_assignment_package_prepared_in_simulation !== true) {
    errors.push('worker_resource_eligibility_not_established');
  }
  for (const field of EVIDENCE_VALIDATION_FLAGS) {
    if (decision[field] !== true) errors.push(`worker_${field}_not_validated`);
  }
  for (const field of WORKER_OPERATIONAL_SAFE_FLAGS) {
    if (decision[field] !== false) errors.push(`worker_assignment_${field}_must_be_false`);
  }
  if (assignmentPackage.worker_assignment_status !== WORKER_ASSIGNMENT_ELIGIBLE_STATUS
    || assignmentPackage.worker_assignment_evaluated !== true
    || assignmentPackage.worker_assignment_package_prepared_in_simulation !== true
    || assignmentPackage.worker_count < 1
    || assignmentPackage.recommended_assignment_count < 1) {
    errors.push('worker_resource_eligibility_not_established');
  }
  for (const field of WORKER_OPERATIONAL_SAFE_FLAGS) {
    if (assignmentPackage[field] !== false) errors.push(`worker_assignment_package_${field}_must_be_false`);
  }
  if (decision.runtime_worker_assignment_package_id !== assignmentPackage.runtime_worker_assignment_package_id
    || decision.runtime_worker_assignment_package_fingerprint !== assignmentPackage.worker_assignment_package_fingerprint
    || decision.runtime_worker_assignment_package_digest !== assignmentPackage.worker_assignment_package_digest) {
    errors.push('worker_assignment_package_binding_mismatch');
  }
  if (!identityMatches(decision, identityScope) || !identityMatches(assignmentPackage, identityScope)) {
    errors.push('worker_eligibility_identity_scope_mismatch');
  }
  if (health.runtime_worker_reference_id !== capacity.runtime_worker_reference_id) {
    errors.push('worker_health_capacity_binding_mismatch');
  }
  if (!assignmentPackage.worker_reference_ids.includes(health.runtime_worker_reference_id)
    || !assignmentPackage.worker_health_fingerprints.includes(health.health_fingerprint)
    || !assignmentPackage.worker_capacity_fingerprints.includes(capacity.capacity_fingerprint)) {
    errors.push('worker_evidence_package_binding_mismatch');
  }
  if (assignmentPackage.freshness_fingerprint !== computeFreshnessFingerprint(freshness)) {
    errors.push('worker_freshness_package_binding_mismatch');
  }
  if (health.health_status !== 'HEALTHY_REFERENCE_SIMULATION' || health.health_validated !== true) {
    errors.push('worker_health_not_eligible');
  }
  if (capacity.capacity_available !== true || capacity.capacity_validated !== true) {
    errors.push('worker_capacity_not_eligible');
  }
  if (freshness.freshness_validated !== true || EXPIRED_FLAG_FIELDS.some((field) => freshness[field] !== false)) {
    errors.push('worker_freshness_not_eligible');
  }
  if (health.health_applied !== false || capacity.capacity_applied !== false || capacity.capacity_reserved !== false
    || capacity.slots_consumed !== false || freshness.freshness_applied !== false) {
    errors.push('eligibility_evidence_operational_flag_invalid');
  }
}

function validateInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return ['claim_eligibility_input_must_be_object'];
  exactFields(input, EVIDENCE_INPUT_FIELDS, 'claim_eligibility_input', errors);
  try {
    const validation = validateClaimIntent(input.runtime_execution_attempt_claim_intent);
    if (!validation.valid) errors.push(...mapValidationErrors(validation.errors, true));
  } catch {
    errors.push('claim_intent_integrity_invalid');
  }
  addEvidenceErrors(input, errors);
  return uniqueSorted(mapValidationErrors(errors));
}

function decisionMaterial(decision) {
  const {
    runtime_execution_attempt_claim_eligibility_decision_fingerprint,
    runtime_execution_attempt_claim_eligibility_decision_digest,
    ...material
  } = decision;
  return material;
}

function computeDecisionFingerprint(decision) {
  return stablePayload(decisionMaterial(decision));
}

function computeDecisionDigest(decision) {
  const { runtime_execution_attempt_claim_eligibility_decision_digest, ...material } = decision;
  return computeCanonicalContentDigest(material);
}

function computeDecisionId({ intentReference, attemptReference, assignmentDecisionId, assignmentPackageReference,
  healthReference, capacityReference, freshnessReference, attemptState, attemptRevision, identityScope,
  attemptOrdinal, eligible, inputErrors }) {
  const seed = computeCanonicalContentDigest({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    predecessor_contract_name: CLAIM_INTENT_CONTRACT_NAME,
    predecessor_contract_version: CLAIM_INTENT_CONTRACT_VERSION,
    runtime_execution_attempt_claim_intent_reference: intentReference,
    runtime_execution_attempt_durable_record_reference: attemptReference,
    runtime_worker_assignment_decision_id: assignmentDecisionId,
    runtime_worker_assignment_package_reference: assignmentPackageReference,
    runtime_worker_health_reference: healthReference,
    runtime_worker_capacity_reference: capacityReference,
    runtime_freshness_reference: freshnessReference,
    attempt_state: attemptState,
    attempt_revision: attemptRevision,
    identity_scope: identityScope,
    attempt_ordinal: attemptOrdinal,
    eligible,
    reason_codes: inputErrors
  });
  return `runtime-execution-attempt-claim-eligibility-decision-${seed.slice('sha256:'.length)}`;
}

function flagsFor(eligible) {
  return {
    ...SAFE_FLAGS,
    claim_eligible: eligible,
    attempt_created: eligible,
    attempt_persisted: eligible,
    attempt_admitted: eligible,
    claim_intent_created: eligible,
    worker_resource_eligibility_validated: eligible,
    health_evidence_validated: eligible,
    capacity_evidence_validated: eligible,
    freshness_evidence_validated: eligible
  };
}

function buildClaimEligibilityDecision(input = {}) {
  const validationErrors = validateInput(input);
  const eligible = validationErrors.length === 0;
  const intent = input?.runtime_execution_attempt_claim_intent;
  const assignmentDecision = input?.runtime_worker_assignment_decision;
  const assignmentPackage = input?.runtime_worker_assignment_package;
  const health = input?.runtime_worker_health_reference;
  const capacity = input?.runtime_worker_capacity_reference;
  const freshness = input?.runtime_freshness_reference;
  const intentReference = isPlainObject(intent) ? {
    id: isNonEmptyString(intent.runtime_execution_attempt_claim_intent_id) ? intent.runtime_execution_attempt_claim_intent_id : 'claim-intent-not-available',
    version: Number.isInteger(intent.runtime_execution_attempt_claim_intent_version) && intent.runtime_execution_attempt_claim_intent_version > 0 ? intent.runtime_execution_attempt_claim_intent_version : VERSION,
    fingerprint: isNonEmptyString(intent.runtime_execution_attempt_claim_intent_fingerprint) ? intent.runtime_execution_attempt_claim_intent_fingerprint : 'fingerprint_not_available',
    digest: isCanonicalContentDigest(intent.runtime_execution_attempt_claim_intent_digest) ? intent.runtime_execution_attempt_claim_intent_digest : ZERO_DIGEST
  } : referenceFromIntent(null, 'runtime_execution_attempt_claim_intent_reference');
  const attemptReference = referenceFromIntent(intent, 'runtime_execution_attempt_durable_record_reference');
  const identityScope = scopeFromIntent(intent);
  const attemptState = safeAttemptState(intent);
  const attemptRevision = safeAttemptRevision(intent);
  const attemptOrdinal = safeAttemptOrdinal(intent);
  const assignmentDecisionId = isNonEmptyString(assignmentDecision?.runtime_worker_assignment_decision_id)
    ? assignmentDecision.runtime_worker_assignment_decision_id : 'worker-assignment-decision-not-available';
  const assignmentPackageReference = assignmentPackageReferenceFrom(assignmentPackage);
  const healthReference = healthReferenceFrom(health);
  const capacityReference = capacityReferenceFrom(capacity);
  const freshnessReference = freshnessReferenceFrom(freshness);
  const reasonCodes = eligible
    ? ['claim_intent_eligible_for_future_acquisition']
    : mapValidationErrors(validationErrors);
  const decision = {
    runtime_execution_attempt_claim_eligibility_decision_id: computeDecisionId({
      intentReference, attemptReference, attemptState, attemptRevision, identityScope, attemptOrdinal,
      assignmentDecisionId, assignmentPackageReference, healthReference, capacityReference, freshnessReference,
      eligible, inputErrors: reasonCodes
    }),
    runtime_execution_attempt_claim_eligibility_decision_version: VERSION,
    runtime_execution_attempt_claim_eligibility_decision_fingerprint: 'pending',
    runtime_execution_attempt_claim_eligibility_decision_digest: 'pending',
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    version: VERSION,
    status: eligible ? ELIGIBLE_STATUS : INELIGIBLE_STATUS,
    state: STATE,
    decision: eligible ? ELIGIBLE_DECISION : INELIGIBLE_DECISION,
    predecessor_contract_name: CLAIM_INTENT_CONTRACT_NAME,
    predecessor_contract_version: CLAIM_INTENT_CONTRACT_VERSION,
    runtime_execution_attempt_claim_intent_reference: intentReference,
    runtime_execution_attempt_durable_record_reference: attemptReference,
    runtime_worker_assignment_decision_id: assignmentDecisionId,
    runtime_worker_assignment_package_reference: assignmentPackageReference,
    runtime_worker_health_reference: healthReference,
    runtime_worker_capacity_reference: capacityReference,
    runtime_freshness_reference: freshnessReference,
    attempt_state: attemptState,
    attempt_revision: attemptRevision,
    identity_scope: identityScope,
    attempt_ordinal: attemptOrdinal,
    reason_codes: reasonCodes,
    ...flagsFor(eligible),
    validator_version: VALIDATOR_VERSION
  };
  decision.runtime_execution_attempt_claim_eligibility_decision_fingerprint = computeDecisionFingerprint(decision);
  decision.runtime_execution_attempt_claim_eligibility_decision_digest = computeDecisionDigest(decision);
  const resultValidation = validateClaimEligibilityDecision(decision);
  if (!resultValidation.valid) {
    throw new Error(`runtime_execution_attempt_claim_eligibility_decision_construction_invalid::${JSON.stringify(resultValidation.errors)}`);
  }
  return cloneFrozen(decision);
}

function validateClaimEligibilityDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['decision_must_be_object'] };
  exactFields(decision, FIELDS, 'runtime_execution_attempt_claim_eligibility_decision', errors);
  if (decision.contract_name !== CONTRACT_NAME) errors.push('contract_name_invalid');
  if (decision.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (decision.version !== VERSION || decision.runtime_execution_attempt_claim_eligibility_decision_version !== VERSION) errors.push('version_invalid');
  if (![ELIGIBLE_STATUS, INELIGIBLE_STATUS].includes(decision.status)) errors.push('status_invalid');
  if (decision.state !== STATE) errors.push('state_invalid');
  if (decision.predecessor_contract_name !== CLAIM_INTENT_CONTRACT_NAME) errors.push('predecessor_contract_name_invalid');
  if (decision.predecessor_contract_version !== CLAIM_INTENT_CONTRACT_VERSION) errors.push('predecessor_contract_version_invalid');
  validateReference(decision.runtime_execution_attempt_claim_intent_reference, 'claim_intent_reference', errors);
  validateReference(decision.runtime_execution_attempt_durable_record_reference, 'attempt_reference', errors);
  if (!isNonEmptyString(decision.runtime_worker_assignment_decision_id)) errors.push('worker_assignment_decision_id_invalid');
  validateReference(decision.runtime_worker_assignment_package_reference, 'worker_assignment_package_reference', errors);
  validateReferenceFields(decision.runtime_worker_health_reference, ['id', 'version', 'fingerprint'], 'worker_health_reference', errors);
  validateReference(decision.runtime_worker_capacity_reference, 'worker_capacity_reference', errors);
  validateReferenceFields(decision.runtime_freshness_reference, ['id', 'version', 'fingerprint'], 'freshness_reference', errors);
  validateIdentityScope(decision.identity_scope, errors);
  if (!isNonEmptyString(decision.attempt_state)) errors.push('attempt_state_invalid');
  if (!Number.isInteger(decision.attempt_revision) || decision.attempt_revision < 0) errors.push('attempt_revision_invalid');
  if (!Number.isInteger(decision.attempt_ordinal) || decision.attempt_ordinal < 0) errors.push('attempt_ordinal_invalid');
  if (!Array.isArray(decision.reason_codes) || decision.reason_codes.length === 0 || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (Array.isArray(decision.reason_codes)) {
    try {
      if (stablePayload(decision.reason_codes) !== stablePayload(uniqueSorted(decision.reason_codes))) errors.push('reason_codes_not_canonical');
    } catch {
      errors.push('reason_codes_not_serializable');
    }
  }
  const eligible = decision.status === ELIGIBLE_STATUS;
  if (decision.decision !== (eligible ? ELIGIBLE_DECISION : INELIGIBLE_DECISION)) errors.push('decision_invalid');
  if (decision.claim_eligible !== eligible) errors.push('claim_eligible_does_not_match_status');
  if (eligible && (decision.attempt_state !== 'ADMITTED' || decision.attempt_revision !== 2)) errors.push('eligible_attempt_lifecycle_invalid');
  if (decision.worker_resource_eligibility_validated !== eligible) errors.push('worker_resource_eligibility_validated_does_not_match_status');
  if (decision.health_evidence_validated !== eligible) errors.push('health_evidence_validated_does_not_match_status');
  if (decision.capacity_evidence_validated !== eligible) errors.push('capacity_evidence_validated_does_not_match_status');
  if (decision.freshness_evidence_validated !== eligible) errors.push('freshness_evidence_validated_does_not_match_status');
  if (decision.validator_version !== VALIDATOR_VERSION) errors.push('validator_version_invalid');
  for (const [field, expected] of Object.entries(flagsFor(eligible))) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (!isNonEmptyString(decision.runtime_execution_attempt_claim_eligibility_decision_id)) errors.push('decision_id_invalid');
  if (!isNonEmptyString(decision.runtime_execution_attempt_claim_eligibility_decision_fingerprint)) errors.push('decision_fingerprint_invalid');
  if (!isCanonicalContentDigest(decision.runtime_execution_attempt_claim_eligibility_decision_digest)) errors.push('decision_digest_invalid');
  try {
    if (computeDecisionFingerprint(decision) !== decision.runtime_execution_attempt_claim_eligibility_decision_fingerprint) errors.push('decision_fingerprint_mismatch');
    if (computeDecisionDigest(decision) !== decision.runtime_execution_attempt_claim_eligibility_decision_digest) errors.push('decision_digest_mismatch');
    stablePayload(decision);
  } catch {
    errors.push('decision_integrity_invalid');
  }
  return { valid: uniqueSorted(errors).length === 0, errors: uniqueSorted(errors) };
}

function evaluateClaimEligibility(input = {}) {
  return buildClaimEligibilityDecision(input);
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  ELIGIBLE_DECISION,
  ELIGIBLE_STATUS,
  FIELDS,
  IDENTITY_SCOPE_FIELDS,
  INELIGIBLE_DECISION,
  INELIGIBLE_STATUS,
  SAFE_FLAGS,
  STATE,
  VALIDATOR_VERSION,
  VERSION,
  buildClaimEligibilityDecision,
  computeDecisionDigest,
  computeDecisionFingerprint,
  computeDecisionId,
  evaluateClaimEligibility,
  validateClaimEligibilityDecision,
  validateInput: (input) => {
    const errors = validateInput(input);
    return { valid: errors.length === 0, errors };
  }
};
