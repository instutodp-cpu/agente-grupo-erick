'use strict';

const { exactFields, stablePayload, cloneFrozen } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
  validateRuntimeExecutionAttemptDurableRecord
} = require('./runtime-execution-attempt-durable-record');
const {
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_NAME,
  validateRuntimeExecutionAttemptAdmissionDecision
} = require('./runtime-execution-attempt-admission-decision-simulation');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_DURABLE_ADMISSION';
const CONTRACT_VERSION = 'runtime_execution_attempt_durable_admission_v1';
const STATUS = 'EXECUTION_ATTEMPT_DURABLE_ADMISSION';
const VERSION = 1;
const OUTCOMES = Object.freeze([
  'ADMITTED', 'ALREADY_ADMITTED', 'CONFLICT', 'STALE', 'INVALID', 'NOT_FOUND'
]);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const FLAGS = Object.freeze({
  attempt_created: true,
  attempt_persisted: true,
  attempt_admitted: true,
  claim_issued: false,
  lease_granted: false,
  fencing_token_issued: false,
  worker_ownership_established: false,
  executor_ownership_established: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  provider_call_allowed: false,
  provider_called: false,
  network_call_allowed: false,
  network_used: false,
  secrets_materialized: false,
  external_effect_allowed: false,
  external_effect_performed: false
});
const RESULT_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'version', 'status', 'outcome',
  'runtime_execution_attempt_durable_admission_id',
  'runtime_execution_attempt_durable_record_reference',
  'p8_admission_decision_reference',
  'expected_previous_state', 'expected_previous_revision',
  'final_state', 'final_revision', 'transition_applied', 'reason_code',
  ...Object.keys(FLAGS), 'simulation', 'production_blocked', 'fingerprint', 'digest'
]);

function referenceForRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    id: record.runtime_execution_attempt_durable_record_id,
    version: record.runtime_execution_attempt_durable_record_version,
    fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
    digest: record.runtime_execution_attempt_durable_record_digest
  };
}

function referenceForDecision(decision) {
  if (!decision || typeof decision !== 'object') return null;
  return {
    id: decision.runtime_execution_attempt_admission_decision_id,
    version: decision.runtime_execution_attempt_admission_decision_version,
    fingerprint: decision.runtime_execution_attempt_admission_decision_fingerprint,
    digest: decision.runtime_execution_attempt_admission_decision_digest
  };
}

function computeAdmissionId(record, decision) {
  if (!record || !decision) return null;
  const digest = computeCanonicalContentDigest({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    attempt: referenceForRecord(record),
    decision: referenceForDecision(decision)
  });
  return `runtime-execution-attempt-durable-admission-${digest.slice('sha256:'.length)}`;
}

function sameScope(left, right) {
  return IDENTITY_SCOPE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return ['runtime_execution_attempt_durable_admission_input_must_be_object'];
  }
  exactFields(input, ['p7_durable_record', 'p8_admission_decision'], 'runtime_execution_attempt_durable_admission_input', errors);
  const recordValidation = validateRuntimeExecutionAttemptDurableRecord(input.p7_durable_record);
  if (!recordValidation.valid) errors.push(...recordValidation.errors.map((error) => `p7_${error}`));
  const decisionValidation = validateRuntimeExecutionAttemptAdmissionDecision(input.p8_admission_decision);
  if (!decisionValidation.valid) errors.push(...decisionValidation.errors.map((error) => `p8_${error}`));

  const record = input.p7_durable_record;
  const decision = input.p8_admission_decision;
  if (record && decision && typeof record === 'object' && typeof decision === 'object') {
    const reference = decision.runtime_execution_attempt_durable_record_reference;
    if (reference?.id !== record.runtime_execution_attempt_durable_record_id) errors.push('attempt_identity_mismatch');
    if (reference?.version !== record.runtime_execution_attempt_durable_record_version) errors.push('attempt_version_mismatch');
    if (reference?.fingerprint !== record.runtime_execution_attempt_durable_record_fingerprint) errors.push('attempt_fingerprint_mismatch');
    if (reference?.digest !== record.runtime_execution_attempt_durable_record_digest) errors.push('attempt_digest_mismatch');
    if (decision.p7_state !== 'PREPARED') errors.push('p8_predecessor_state_invalid');
    if (decision.p7_revision !== 1) errors.push('p8_predecessor_revision_invalid');
    if (!sameScope(decision.identity_scope, record.identity_scope)) errors.push('identity_scope_mismatch');
    if (decision.attempt_ordinal !== record.attempt_ordinal) errors.push('attempt_ordinal_mismatch');
    if (decision.contract_name !== RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_NAME) errors.push('p8_contract_invalid');
    if (decision.decision !== 'ADMIT_ATTEMPT_SIMULATION') errors.push('p8_decision_not_positive');
    if (decision.attempt_admitted_in_simulation !== true) errors.push('p8_decision_not_admissible');
    if (stablePayload(decision.identity_scope) !== stablePayload(record.identity_scope)) errors.push('identity_scope_canonical_mismatch');
  }
  return [...new Set(errors)].sort();
}

function resultMaterial({ outcome, record, decision, finalState, finalRevision, transitionApplied, reasonCode }) {
  const admitted = outcome === 'ADMITTED' || outcome === 'ALREADY_ADMITTED';
  return {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    version: VERSION,
    status: STATUS,
    outcome,
    runtime_execution_attempt_durable_admission_id: computeAdmissionId(record, decision),
    runtime_execution_attempt_durable_record_reference: referenceForRecord(record),
    p8_admission_decision_reference: referenceForDecision(decision),
    expected_previous_state: 'PREPARED',
    expected_previous_revision: 1,
    final_state: finalState ?? null,
    final_revision: finalRevision ?? null,
    transition_applied: transitionApplied === true,
    reason_code: reasonCode,
    ...Object.fromEntries(Object.entries(FLAGS).map(([field, value]) => [field, admitted ? value : false])),
    simulation: false,
    production_blocked: true
  };
}

function buildAdmissionResult(input) {
  const material = resultMaterial(input);
  return cloneFrozen({
    ...material,
    fingerprint: stablePayload(material),
    digest: computeCanonicalContentDigest(material)
  });
}

function validateAdmissionResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { valid: false, errors: ['result_must_be_object'] };
  exactFields(result, RESULT_FIELDS, 'runtime_execution_attempt_durable_admission_result', errors);
  if (result.contract_name !== CONTRACT_NAME) errors.push('contract_name_invalid');
  if (result.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (result.version !== VERSION) errors.push('version_invalid');
  if (result.status !== STATUS) errors.push('status_invalid');
  if (!OUTCOMES.includes(result.outcome)) errors.push('outcome_invalid');
  if (result.expected_previous_state !== 'PREPARED' || result.expected_previous_revision !== 1) errors.push('expected_previous_lifecycle_invalid');
  if (result.outcome === 'ADMITTED' && (result.final_state !== 'ADMITTED' || result.final_revision !== 2 || result.transition_applied !== true)) errors.push('admitted_result_invalid');
  if (result.outcome === 'ALREADY_ADMITTED' && (result.final_state !== 'ADMITTED' || result.final_revision !== 2 || result.transition_applied !== false)) errors.push('already_admitted_result_invalid');
  if (!isCanonicalContentDigest(result.digest) || typeof result.fingerprint !== 'string' || result.fingerprint.length === 0) errors.push('integrity_fields_invalid');
  for (const [field, expected] of Object.entries(FLAGS)) {
    const required = result.outcome === 'ADMITTED' || result.outcome === 'ALREADY_ADMITTED' ? expected : false;
    if (result[field] !== required) errors.push(`${field}_invalid`);
  }
  if (result.simulation !== false || result.production_blocked !== true) errors.push('safety_mode_invalid');
  try {
    const { fingerprint, digest, ...material } = result;
    if (stablePayload(material) !== fingerprint) errors.push('fingerprint_mismatch');
    if (computeCanonicalContentDigest(material) !== digest) errors.push('digest_mismatch');
  } catch {
    errors.push('integrity_invalid');
  }
  return { valid: [...new Set(errors)].sort().length === 0, errors: [...new Set(errors)].sort() };
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FLAGS,
  IDENTITY_SCOPE_FIELDS,
  OUTCOMES,
  RESULT_FIELDS,
  STATUS,
  VERSION,
  buildAdmissionResult,
  computeAdmissionId,
  validateAdmissionInput: (input) => {
    const errors = validateInput(input);
    return { valid: errors.length === 0, errors };
  },
  validateAdmissionResult
};
