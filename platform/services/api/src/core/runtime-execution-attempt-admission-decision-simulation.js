'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  validateRuntimeAdmissionPolicy
} = require('./runtime-admission-policy');
const {
  validateRuntimeReadinessDecision
} = require('./runtime-readiness-decision');
const {
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION,
  validateRuntimeExecutionAttemptDurableRecord
} = require('./runtime-execution-attempt-durable-record');

const RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_NAME =
  'RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_SIMULATION';
const RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_VERSION =
  'runtime_execution_attempt_admission_decision_simulation_contract_v1';
const RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VALIDATOR_VERSION =
  'runtime_execution_attempt_admission_decision_simulation_validator_v1';
const RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VERSION = 1;
const RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATUS =
  'EXECUTION_ATTEMPT_ADMISSION_DECISION_SIMULATION';
const RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATE =
  'EXECUTION_ATTEMPT_ADMISSION_REFERENCE_SIMULATION';

const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const DECISION = 'ADMIT_ATTEMPT_SIMULATION';
const P7_FACT_FIELDS = Object.freeze([
  'attempt_durable_record_id', 'durable_record_fingerprint', 'durable_record_digest',
  'state', 'revision', 'attempt_created', 'attempt_persisted', 'attempt_admitted'
]);
const SAFE_FLAGS = Object.freeze({
  attempt_admission_decided_in_simulation: true,
  attempt_created: true,
  attempt_persisted: true,
  attempt_admitted: false,
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
  external_effect_performed: false,
  simulation: true,
  production_blocked: true
});

const RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_FIELDS = Object.freeze([
  'runtime_execution_attempt_admission_decision_id',
  'runtime_execution_attempt_admission_decision_version',
  'runtime_execution_attempt_admission_decision_fingerprint',
  'runtime_execution_attempt_admission_decision_digest',
  'contract_name',
  'contract_version',
  'status',
  'state',
  'predecessor_contract_name',
  'predecessor_contract_version',
  'predecessor_validator_version',
  'runtime_execution_attempt_durable_record_reference',
  'p7_state',
  'p7_revision',
  'runtime_readiness_decision_reference',
  'runtime_admission_policy_reference',
  'identity_scope',
  'attempt_ordinal',
  'decision',
  'reason_codes',
  'attempt_admitted_in_simulation',
  ...Object.keys(SAFE_FLAGS),
  'validator_version'
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

function decisionMaterial(decision) {
  const {
    runtime_execution_attempt_admission_decision_fingerprint,
    runtime_execution_attempt_admission_decision_digest,
    ...material
  } = decision;
  return material;
}

function computeRuntimeExecutionAttemptAdmissionDecisionFingerprint(decision) {
  return stablePayload(decisionMaterial(decision));
}

function computeRuntimeExecutionAttemptAdmissionDecisionDigest(decision) {
  const { runtime_execution_attempt_admission_decision_digest, ...material } = decision;
  return computeCanonicalContentDigest(material);
}

function referenceFor(value, id, version = 1) {
  return {
    id,
    version,
    fingerprint: stablePayload(value),
    digest: computeCanonicalContentDigest(value)
  };
}

function computeRuntimeExecutionAttemptAdmissionDecisionIdentitySeed({
  attemptReference,
  p7State,
  p7Revision,
  readinessReference,
  policyReference,
  identityScope,
  attemptOrdinal
}) {
  return computeCanonicalContentDigest({
    contract_name: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_VERSION,
    runtime_execution_attempt_durable_record_reference: attemptReference,
    p7_state: p7State,
    p7_revision: p7Revision,
    runtime_readiness_decision_reference: readinessReference,
    runtime_admission_policy_reference: policyReference,
    identity_scope: identityScope,
    attempt_ordinal: attemptOrdinal,
    decision: DECISION
  });
}

function computeRuntimeExecutionAttemptAdmissionDecisionId(input) {
  const seed = computeRuntimeExecutionAttemptAdmissionDecisionIdentitySeed(input);
  return `runtime-execution-attempt-admission-decision-${seed.slice('sha256:'.length)}`;
}

function validateP7Facts(value, record, errors) {
  if (!isPlainObject(value)) {
    errors.push('p7_persistence_facts_must_be_object');
    return;
  }
  exactFields(value, P7_FACT_FIELDS, 'p7_persistence_facts', errors);
  if (value.attempt_durable_record_id !== record?.runtime_execution_attempt_durable_record_id) {
    errors.push('p7_attempt_id_mismatch');
  }
  if (value.durable_record_fingerprint !== record?.runtime_execution_attempt_durable_record_fingerprint) {
    errors.push('p7_record_fingerprint_mismatch');
  }
  if (value.durable_record_digest !== record?.runtime_execution_attempt_durable_record_digest) {
    errors.push('p7_record_digest_mismatch');
  }
  if (value.state !== 'PREPARED') errors.push('p7_state_invalid');
  if (value.revision !== 1) errors.push('p7_revision_invalid');
  if (value.attempt_created !== true) errors.push('p7_attempt_created_invalid');
  if (value.attempt_persisted !== true) errors.push('p7_attempt_persisted_invalid');
  if (value.attempt_admitted !== false) errors.push('p7_attempt_admitted_invalid');
  if (!isNonEmptyString(value.durable_record_fingerprint)) errors.push('p7_record_fingerprint_invalid');
  if (!isCanonicalContentDigest(value.durable_record_digest)) errors.push('p7_record_digest_invalid');
}

function sameScope(left, right) {
  return IDENTITY_SCOPE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function validateInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return ['runtime_execution_attempt_admission_input_must_be_object'];
  exactFields(input, [
    'p7_durable_record', 'p7_persistence_facts', 'runtime_readiness_decision', 'runtime_admission_policy'
  ], 'runtime_execution_attempt_admission_input', errors);

  const record = input.p7_durable_record;
  const recordValidation = validateRuntimeExecutionAttemptDurableRecord(record);
  if (!recordValidation.valid) errors.push(...recordValidation.errors.map((error) => `p7_record_${error}`));
  validateP7Facts(input.p7_persistence_facts, record, errors);
  const readinessValidation = validateRuntimeReadinessDecision(input.runtime_readiness_decision);
  if (!readinessValidation.valid) errors.push(...readinessValidation.errors.map((error) => `readiness_${error}`));
  const policyValidation = validateRuntimeAdmissionPolicy(input.runtime_admission_policy);
  if (!policyValidation.valid) errors.push(...policyValidation.errors.map((error) => `policy_${error}`));

  if (isPlainObject(record) && isPlainObject(input.p7_persistence_facts)) {
    if (record.status !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS) errors.push('p7_record_status_invalid');
    if (record.contract_name !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME) errors.push('p7_record_contract_invalid');
    if (record.contract_version !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION) errors.push('p7_record_contract_version_invalid');
    if (record.validator_version !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION) errors.push('p7_record_validator_version_invalid');
  }
  if (isPlainObject(input.runtime_readiness_decision)) {
    if (input.runtime_readiness_decision.status !== 'RUNTIME_READY_SIMULATION') errors.push('readiness_not_ready');
    if (input.runtime_readiness_decision.runtime_ready_in_simulation !== true) errors.push('readiness_not_simulated_ready');
    if (input.runtime_readiness_decision.capacity_validated !== true) errors.push('readiness_capacity_not_validated');
    if (input.runtime_readiness_decision.concurrency_validated !== true) errors.push('readiness_concurrency_not_validated');
  }
  if (isPlainObject(input.runtime_admission_policy)) {
    if (input.runtime_admission_policy.allow_runtime_admission_simulation !== true) errors.push('policy_simulation_admission_not_allowed');
    if (input.runtime_admission_policy.require_runtime_ready_simulation !== true) errors.push('policy_readiness_not_required');
    if (input.runtime_admission_policy.fail_closed !== true) errors.push('policy_fail_closed_required');
  }
  if (isPlainObject(record) && isPlainObject(input.runtime_readiness_decision)
    && !sameScope(record.identity_scope, input.runtime_readiness_decision)) {
    errors.push('readiness_identity_scope_mismatch');
  }
  if (isPlainObject(record) && isPlainObject(input.runtime_admission_policy)
    && !isNonEmptyString(input.runtime_admission_policy.runtime_admission_policy_id)) {
    errors.push('policy_reference_id_invalid');
  }
  return uniqueSorted(errors);
}

function buildRuntimeExecutionAttemptAdmissionDecision(input = {}) {
  const errors = validateInput(input);
  if (errors.length > 0) {
    throw new Error(`runtime_execution_attempt_admission_decision_input_invalid::${JSON.stringify(errors)}`);
  }
  const record = input.p7_durable_record;
  const facts = input.p7_persistence_facts;
  const readiness = input.runtime_readiness_decision;
  const policy = input.runtime_admission_policy;
  const attemptReference = {
    id: record.runtime_execution_attempt_durable_record_id,
    version: record.runtime_execution_attempt_durable_record_version,
    fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
    digest: record.runtime_execution_attempt_durable_record_digest
  };
  const readinessReference = referenceFor(readiness, readiness.runtime_readiness_decision_id);
  const policyReference = referenceFor(policy, policy.runtime_admission_policy_id, policy.runtime_admission_policy_version);
  const decision = {
    runtime_execution_attempt_admission_decision_id: computeRuntimeExecutionAttemptAdmissionDecisionId({
      attemptReference,
      p7State: facts.state,
      p7Revision: facts.revision,
      readinessReference,
      policyReference,
      identityScope: record.identity_scope,
      attemptOrdinal: record.attempt_ordinal
    }),
    runtime_execution_attempt_admission_decision_version: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VERSION,
    runtime_execution_attempt_admission_decision_fingerprint: 'pending',
    runtime_execution_attempt_admission_decision_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATUS,
    state: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATE,
    predecessor_contract_name: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
    predecessor_contract_version: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
    predecessor_validator_version: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION,
    runtime_execution_attempt_durable_record_reference: attemptReference,
    p7_state: facts.state,
    p7_revision: facts.revision,
    runtime_readiness_decision_reference: readinessReference,
    runtime_admission_policy_reference: policyReference,
    identity_scope: cloneFrozen(record.identity_scope),
    attempt_ordinal: record.attempt_ordinal,
    decision: DECISION,
    reason_codes: ['attempt_would_be_admissible_in_simulation_only'],
    attempt_admitted_in_simulation: true,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VALIDATOR_VERSION
  };
  decision.runtime_execution_attempt_admission_decision_fingerprint =
    computeRuntimeExecutionAttemptAdmissionDecisionFingerprint(decision);
  decision.runtime_execution_attempt_admission_decision_digest =
    computeRuntimeExecutionAttemptAdmissionDecisionDigest(decision);
  const validation = validateRuntimeExecutionAttemptAdmissionDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_execution_attempt_admission_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

function validateRuntimeExecutionAttemptAdmissionDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['decision_must_be_object'] };
  exactFields(decision, RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_FIELDS, 'runtime_execution_attempt_admission_decision', errors);
  if (decision.contract_name !== RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (decision.contract_version !== RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (decision.runtime_execution_attempt_admission_decision_version !== RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VERSION) errors.push('decision_version_invalid');
  if (decision.status !== RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATUS) errors.push('status_invalid');
  if (decision.state !== RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATE) errors.push('state_invalid');
  if (decision.predecessor_contract_name !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME) errors.push('predecessor_contract_name_invalid');
  if (decision.predecessor_contract_version !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION) errors.push('predecessor_contract_version_invalid');
  if (decision.predecessor_validator_version !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION) errors.push('predecessor_validator_version_invalid');
  validateReference(decision.runtime_execution_attempt_durable_record_reference, 'attempt_reference', errors);
  validateReference(decision.runtime_readiness_decision_reference, 'readiness_reference', errors);
  validateReference(decision.runtime_admission_policy_reference, 'policy_reference', errors);
  validateIdentityScope(decision.identity_scope, errors);
  if (decision.p7_state !== 'PREPARED') errors.push('p7_state_invalid');
  if (decision.p7_revision !== 1) errors.push('p7_revision_invalid');
  if (!Number.isInteger(decision.attempt_ordinal) || decision.attempt_ordinal < 1) errors.push('attempt_ordinal_invalid');
  if (decision.decision !== DECISION) errors.push('decision_invalid');
  if (!Array.isArray(decision.reason_codes) || decision.reason_codes.length === 0 || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (decision.attempt_admitted_in_simulation !== true) errors.push('attempt_admitted_in_simulation_invalid');
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.validator_version !== RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (!isNonEmptyString(decision.runtime_execution_attempt_admission_decision_id)) errors.push('decision_id_invalid');
  if (!isNonEmptyString(decision.runtime_execution_attempt_admission_decision_fingerprint)) errors.push('decision_fingerprint_invalid');
  if (!isCanonicalContentDigest(decision.runtime_execution_attempt_admission_decision_digest)) errors.push('decision_digest_invalid');
  try {
    const expectedId = computeRuntimeExecutionAttemptAdmissionDecisionId({
      attemptReference: decision.runtime_execution_attempt_durable_record_reference,
      p7State: decision.p7_state,
      p7Revision: decision.p7_revision,
      readinessReference: decision.runtime_readiness_decision_reference,
      policyReference: decision.runtime_admission_policy_reference,
      identityScope: decision.identity_scope,
      attemptOrdinal: decision.attempt_ordinal
    });
    if (decision.runtime_execution_attempt_admission_decision_id !== expectedId) errors.push('decision_id_mismatch');
    if (computeRuntimeExecutionAttemptAdmissionDecisionFingerprint(decision) !== decision.runtime_execution_attempt_admission_decision_fingerprint) errors.push('decision_fingerprint_mismatch');
    if (computeRuntimeExecutionAttemptAdmissionDecisionDigest(decision) !== decision.runtime_execution_attempt_admission_decision_digest) errors.push('decision_digest_mismatch');
    stablePayload(decision);
  } catch {
    errors.push('decision_integrity_invalid');
  }
  return { valid: uniqueSorted(errors).length === 0, errors: uniqueSorted(errors) };
}

function compareRuntimeExecutionAttemptAdmissionDecisionReplay(existingDecision, candidateDecision) {
  const existingValidation = validateRuntimeExecutionAttemptAdmissionDecision(existingDecision);
  const candidateValidation = validateRuntimeExecutionAttemptAdmissionDecision(candidateDecision);
  if (!existingValidation.valid || !candidateValidation.valid) return { status: 'CONFLICT' };
  if (existingDecision.runtime_execution_attempt_admission_decision_id !== candidateDecision.runtime_execution_attempt_admission_decision_id) {
    return { status: 'NOT_SAME_DECISION' };
  }
  if (existingDecision.runtime_execution_attempt_admission_decision_fingerprint === candidateDecision.runtime_execution_attempt_admission_decision_fingerprint
    && existingDecision.runtime_execution_attempt_admission_decision_digest === candidateDecision.runtime_execution_attempt_admission_decision_digest) {
    return { status: 'IDENTICAL_REPLAY' };
  }
  return { status: 'CONFLICT' };
}

module.exports = {
  DECISION,
  IDENTITY_SCOPE_FIELDS,
  P7_FACT_FIELDS,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_FIELDS,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATE,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_VERSION,
  SAFE_FLAGS,
  buildRuntimeExecutionAttemptAdmissionDecision,
  compareRuntimeExecutionAttemptAdmissionDecisionReplay,
  computeRuntimeExecutionAttemptAdmissionDecisionDigest,
  computeRuntimeExecutionAttemptAdmissionDecisionFingerprint,
  computeRuntimeExecutionAttemptAdmissionDecisionId,
  computeRuntimeExecutionAttemptAdmissionDecisionIdentitySeed,
  validateRuntimeExecutionAttemptAdmissionDecision
};
