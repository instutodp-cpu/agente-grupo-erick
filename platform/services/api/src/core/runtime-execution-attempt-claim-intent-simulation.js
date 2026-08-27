'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  CONTRACT_NAME: P9_ADMISSION_CONTRACT_NAME,
  CONTRACT_VERSION: P9_ADMISSION_CONTRACT_VERSION,
  validateAdmissionResult
} = require('./runtime-execution-attempt-durable-admission');
const {
  validateRuntimeExecutionAttemptDurableRecord
} = require('./runtime-execution-attempt-durable-record');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_INTENT_SIMULATION';
const CONTRACT_VERSION = 'runtime_execution_attempt_claim_intent_simulation_contract_v1';
const VERSION = 1;
const STATUS = 'EXECUTION_ATTEMPT_CLAIM_INTENT_SIMULATION';
const STATE = 'EXECUTION_ATTEMPT_CLAIM_INTENT_REFERENCE_SIMULATION';
const DECISION = 'DECLARE_CLAIM_INTENT_SIMULATION';
const VALIDATOR_VERSION = 'runtime_execution_attempt_claim_intent_simulation_validator_v1';
const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);

const SAFE_FLAGS = Object.freeze({
  attempt_created: true,
  attempt_persisted: true,
  attempt_admitted: true,
  claim_intent_created: true,
  claim_eligibility_decided: false,
  claim_eligible: false,
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
  lease_renewed: false,
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
  'runtime_execution_attempt_claim_intent_id',
  'runtime_execution_attempt_claim_intent_version',
  'runtime_execution_attempt_claim_intent_fingerprint',
  'runtime_execution_attempt_claim_intent_digest',
  'contract_name', 'contract_version', 'version', 'status', 'state', 'decision',
  'predecessor_contract_name', 'predecessor_contract_version',
  'p9_durable_admission_reference',
  'runtime_execution_attempt_durable_record_reference',
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

function recordReference(record) {
  return {
    id: record.runtime_execution_attempt_durable_record_id,
    version: record.runtime_execution_attempt_durable_record_version,
    fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
    digest: record.runtime_execution_attempt_durable_record_digest
  };
}

function admissionReference(admission) {
  return {
    id: admission.runtime_execution_attempt_durable_admission_id,
    version: admission.version,
    fingerprint: admission.fingerprint,
    digest: admission.digest
  };
}

function sameReference(left, right) {
  return REFERENCE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function intentMaterial(intent) {
  const {
    runtime_execution_attempt_claim_intent_fingerprint,
    runtime_execution_attempt_claim_intent_digest,
    ...material
  } = intent;
  return material;
}

function computeClaimIntentFingerprint(intent) {
  return stablePayload(intentMaterial(intent));
}

function computeClaimIntentDigest(intent) {
  const { runtime_execution_attempt_claim_intent_digest, ...material } = intent;
  return computeCanonicalContentDigest(material);
}

function computeClaimIntentId({ attemptReference, admissionReferenceValue, identityScope, attemptOrdinal }) {
  const seed = computeCanonicalContentDigest({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    intent: DECISION,
    runtime_execution_attempt_durable_record_reference: attemptReference,
    p9_durable_admission_reference: admissionReferenceValue,
    attempt_state: 'ADMITTED',
    attempt_revision: 2,
    identity_scope: identityScope,
    attempt_ordinal: attemptOrdinal
  });
  return `runtime-execution-attempt-claim-intent-${seed.slice('sha256:'.length)}`;
}

function validateInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return ['runtime_execution_attempt_claim_intent_input_must_be_object'];
  exactFields(input, ['p7_durable_record', 'p9_durable_admission'], 'runtime_execution_attempt_claim_intent_input', errors);

  const record = input.p7_durable_record;
  const admission = input.p9_durable_admission;
  const recordValidation = validateRuntimeExecutionAttemptDurableRecord(record);
  if (!recordValidation.valid) errors.push(...recordValidation.errors.map((error) => `p7_${error}`));
  const admissionValidation = validateAdmissionResult(admission);
  if (!admissionValidation.valid) errors.push(...admissionValidation.errors.map((error) => `p9_${error}`));

  if (isPlainObject(record) && isPlainObject(admission)) {
    if (!['ADMITTED', 'ALREADY_ADMITTED'].includes(admission.outcome)) errors.push('p9_admission_not_positive');
    if (admission.expected_previous_state !== 'PREPARED' || admission.expected_previous_revision !== 1) errors.push('p9_previous_lifecycle_invalid');
    if (admission.final_state !== 'ADMITTED' || admission.final_revision !== 2) errors.push('p9_final_lifecycle_invalid');
    if (admission.attempt_admitted !== true) errors.push('p9_attempt_not_admitted');
    if (admission.simulation !== false || admission.production_blocked !== true) errors.push('p9_safety_mode_invalid');
    if (!sameReference(admission.runtime_execution_attempt_durable_record_reference, recordReference(record))) {
      errors.push('p9_attempt_reference_mismatch');
    }
    if (!isNonEmptyString(admission.runtime_execution_attempt_durable_admission_id)) errors.push('p9_admission_id_invalid');
  }
  return uniqueSorted(errors);
}

function buildClaimIntent(input = {}) {
  const errors = validateInput(input);
  if (errors.length > 0) {
    throw new Error(`runtime_execution_attempt_claim_intent_input_invalid::${JSON.stringify(errors)}`);
  }
  const record = input.p7_durable_record;
  const admission = input.p9_durable_admission;
  const attemptReference = recordReference(record);
  const p9Reference = admissionReference(admission);
  const intent = {
    runtime_execution_attempt_claim_intent_id: computeClaimIntentId({
      attemptReference,
      admissionReferenceValue: p9Reference,
      identityScope: record.identity_scope,
      attemptOrdinal: record.attempt_ordinal
    }),
    runtime_execution_attempt_claim_intent_version: VERSION,
    runtime_execution_attempt_claim_intent_fingerprint: 'pending',
    runtime_execution_attempt_claim_intent_digest: 'pending',
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    version: VERSION,
    status: STATUS,
    state: STATE,
    decision: DECISION,
    predecessor_contract_name: P9_ADMISSION_CONTRACT_NAME,
    predecessor_contract_version: P9_ADMISSION_CONTRACT_VERSION,
    p9_durable_admission_reference: p9Reference,
    runtime_execution_attempt_durable_record_reference: attemptReference,
    attempt_state: admission.final_state,
    attempt_revision: admission.final_revision,
    identity_scope: cloneFrozen(record.identity_scope),
    attempt_ordinal: record.attempt_ordinal,
    reason_codes: ['claim_intent_declared_in_simulation_only'],
    ...SAFE_FLAGS,
    validator_version: VALIDATOR_VERSION
  };
  intent.runtime_execution_attempt_claim_intent_fingerprint = computeClaimIntentFingerprint(intent);
  intent.runtime_execution_attempt_claim_intent_digest = computeClaimIntentDigest(intent);
  const validation = validateClaimIntent(intent);
  if (!validation.valid) {
    throw new Error(`runtime_execution_attempt_claim_intent_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(intent);
}

function validateClaimIntent(intent) {
  const errors = [];
  if (!isPlainObject(intent)) return { valid: false, errors: ['claim_intent_must_be_object'] };
  exactFields(intent, FIELDS, 'runtime_execution_attempt_claim_intent', errors);
  if (intent.contract_name !== CONTRACT_NAME) errors.push('contract_name_invalid');
  if (intent.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (intent.version !== VERSION || intent.runtime_execution_attempt_claim_intent_version !== VERSION) errors.push('version_invalid');
  if (intent.status !== STATUS) errors.push('status_invalid');
  if (intent.state !== STATE) errors.push('state_invalid');
  if (intent.decision !== DECISION) errors.push('decision_invalid');
  if (intent.predecessor_contract_name !== P9_ADMISSION_CONTRACT_NAME) errors.push('predecessor_contract_name_invalid');
  if (intent.predecessor_contract_version !== P9_ADMISSION_CONTRACT_VERSION) errors.push('predecessor_contract_version_invalid');
  validateReference(intent.p9_durable_admission_reference, 'p9_durable_admission_reference', errors);
  validateReference(intent.runtime_execution_attempt_durable_record_reference, 'attempt_reference', errors);
  validateIdentityScope(intent.identity_scope, errors);
  if (intent.attempt_state !== 'ADMITTED') errors.push('attempt_state_invalid');
  if (intent.attempt_revision !== 2) errors.push('attempt_revision_invalid');
  if (!Number.isInteger(intent.attempt_ordinal) || intent.attempt_ordinal < 1) errors.push('attempt_ordinal_invalid');
  if (!Array.isArray(intent.reason_codes) || intent.reason_codes.length === 0 || !intent.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (Array.isArray(intent.reason_codes) && stablePayload(intent.reason_codes) !== stablePayload(uniqueSorted(intent.reason_codes))) errors.push('reason_codes_not_canonical');
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (intent[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (!isNonEmptyString(intent.runtime_execution_attempt_claim_intent_id)) errors.push('claim_intent_id_invalid');
  if (!isNonEmptyString(intent.runtime_execution_attempt_claim_intent_fingerprint)) errors.push('claim_intent_fingerprint_invalid');
  if (!isCanonicalContentDigest(intent.runtime_execution_attempt_claim_intent_digest)) errors.push('claim_intent_digest_invalid');
  try {
    const expectedId = computeClaimIntentId({
      attemptReference: intent.runtime_execution_attempt_durable_record_reference,
      admissionReferenceValue: intent.p9_durable_admission_reference,
      identityScope: intent.identity_scope,
      attemptOrdinal: intent.attempt_ordinal
    });
    if (intent.runtime_execution_attempt_claim_intent_id !== expectedId) errors.push('claim_intent_id_mismatch');
    if (computeClaimIntentFingerprint(intent) !== intent.runtime_execution_attempt_claim_intent_fingerprint) errors.push('claim_intent_fingerprint_mismatch');
    if (computeClaimIntentDigest(intent) !== intent.runtime_execution_attempt_claim_intent_digest) errors.push('claim_intent_digest_mismatch');
  } catch {
    errors.push('claim_intent_integrity_invalid');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  DECISION,
  FIELDS,
  SAFE_FLAGS,
  STATE,
  STATUS,
  VALIDATOR_VERSION,
  VERSION,
  buildClaimIntent,
  computeClaimIntentDigest,
  computeClaimIntentFingerprint,
  computeClaimIntentId,
  validateClaimIntent,
  validateInput: (input) => {
    const errors = validateInput(input);
    return { valid: errors.length === 0, errors };
  }
};
