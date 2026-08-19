'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  DERIVED_FINGERPRINT_LIST_FIELDS,
  DERIVED_ID_LIST_FIELDS,
  IDENTITY_FIELDS,
  ORDERED_LIST_FIELDS,
  RUNTIME_DISPATCH_PACKAGE_VALIDATOR_VERSION,
  UPSTREAM_FINGERPRINT_FIELDS,
  UPSTREAM_ID_FIELDS,
  validateRuntimeDispatchPackage
} = require('./runtime-dispatch-package');

// P1 only forms a deterministic, non-executable intent from the official immutable Dispatch
// Package. It deliberately does not create a job, queue item, attempt, lease, executor, provider
// authorization, persistence record, or external effect.
const RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME = 'RUNTIME_TO_EXECUTION_JOB_INTENT';
const RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION = 'runtime_execution_job_intent_contract_v1';
const RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION = 'runtime_execution_job_intent_validator_v1';
const RUNTIME_EXECUTION_JOB_INTENT_VERSION = 1;
const RUNTIME_EXECUTION_JOB_INTENT_STATUS = 'RUNTIME_EXECUTION_JOB_INTENT_ADMITTED_SIMULATION';
const RUNTIME_EXECUTION_JOB_INTENT_BLOCKED_STATUS = 'RUNTIME_EXECUTION_JOB_INTENT_BLOCKED';
const RUNTIME_EXECUTION_JOB_STATE = 'WAITING_EXTERNAL_EFFECT_AUTHORIZATION';
const EXTERNAL_EFFECT_AUTHORIZATION_STATE = 'NOT_AUTHORIZED';

const PROVENANCE_REFERENCE_FIELDS = Object.freeze([
  'runtime_dispatch_request_id',
  'runtime_worker_assignment_request_id', 'runtime_worker_assignment_decision_id',
  'runtime_worker_assignment_result_id', 'runtime_worker_assignment_package_id',
  'runtime_scheduler_request_id', 'runtime_scheduler_decision_id',
  'runtime_scheduler_result_id', 'runtime_scheduler_package_id',
  'runtime_execution_package_id', 'dispatch_order_reference_id',
  'runtime_dispatch_replay_reference_id'
]);

const PROVENANCE_FINGERPRINT_FIELDS = Object.freeze([
  'worker_assignment_package_fingerprint', 'worker_assignment_package_digest',
  'scheduler_package_fingerprint', 'scheduler_package_digest',
  'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
  'capacity_snapshot_fingerprint', 'concurrency_fingerprint', 'runtime_budget_fingerprint',
  'freshness_fingerprint', 'idempotency_fingerprint', 'registry_snapshot_fingerprint',
  'dispatch_order_fingerprint', 'dispatch_replay_fingerprint'
]);

const DISPATCH_PROVENANCE_LIST_FIELDS = Object.freeze([
  ...DERIVED_ID_LIST_FIELDS,
  ...ORDERED_LIST_FIELDS,
  ...DERIVED_FINGERPRINT_LIST_FIELDS
]);

const PROVENANCE_PAIRS = Object.freeze([
  ['dispatch_stage_reference_ids', 'dispatch_stage_fingerprints'],
  ['dispatch_worker_binding_reference_ids', 'dispatch_worker_binding_fingerprints'],
  ['dispatch_dependency_gate_reference_ids', 'dispatch_dependency_gate_fingerprints'],
  ['dispatch_approval_gate_reference_ids', 'dispatch_approval_gate_fingerprints'],
  ['dispatch_capacity_reference_ids', 'dispatch_capacity_fingerprints'],
  ['dispatch_budget_reference_ids', 'dispatch_budget_fingerprints'],
  ['dispatch_payload_reference_ids', 'dispatch_payload_fingerprints'],
  ['dispatch_intent_reference_ids', 'dispatch_intent_fingerprints']
]);

const RUNTIME_EXECUTION_JOB_INTENT_FIELDS = Object.freeze([
  'runtime_execution_job_intent_id', 'runtime_execution_job_intent_version',
  'runtime_execution_job_intent_fingerprint', 'runtime_execution_job_intent_digest',
  'input_contract_name', 'input_contract_version', 'input_validator_version', 'input_status',
  'execution_job_state', 'external_effect_authorization_state',
  'dispatch_package_reference', 'upstream_reference_ids', 'upstream_fingerprints',
  'dispatch_provenance', 'identity_scope', 'idempotency_reference',
  'job_intent_formed', 'job_created', 'execution_authorized', 'execution_started',
  'external_effect_authorized', 'provider_call_allowed', 'network_effect_allowed',
  'production_effect_allowed', 'provider_called', 'network_used', 'secret_resolved',
  'executed', 'simulation', 'production_blocked', 'validator_version'
]);

const SAFE_FLAGS = Object.freeze({
  job_intent_formed: true,
  job_created: false,
  execution_authorized: false,
  execution_started: false,
  external_effect_authorized: false,
  provider_call_allowed: false,
  network_effect_allowed: false,
  production_effect_allowed: false,
  provider_called: false,
  network_used: false,
  secret_resolved: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactStringList(value) {
  return Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
}

function sortedStringList(value) {
  return exactStringList(value) && value.every((item, index) => item === [...value].sort()[index]);
}

function objectFromFields(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

function sameSet(left, right) {
  if (!exactStringList(left) || !exactStringList(right) || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function validateProvenanceCollections(pkg, errors) {
  for (const field of DERIVED_ID_LIST_FIELDS) {
    if (!sortedStringList(pkg[field])) errors.push(`${field}_provenance_invalid`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!exactStringList(pkg[field])) errors.push(`${field}_provenance_invalid`);
  }
  for (const field of DERIVED_FINGERPRINT_LIST_FIELDS) {
    if (!sortedStringList(pkg[field])) errors.push(`${field}_provenance_invalid`);
  }
  for (const [idField, fingerprintField] of PROVENANCE_PAIRS) {
    if (pkg[idField].length !== pkg[fingerprintField].length) {
      errors.push(`${idField}_fingerprint_cardinality_mismatch`);
    }
  }
  if (!sameSet(pkg.ordered_dispatch_stage_reference_ids, pkg.dispatch_stage_reference_ids)) {
    errors.push('ordered_dispatch_stage_provenance_mismatch');
  }
  if (!sameSet(pkg.ordered_dispatch_intent_reference_ids, pkg.dispatch_intent_reference_ids)) {
    errors.push('ordered_dispatch_intent_provenance_mismatch');
  }
}

function validateDispatchPackageInput(dispatchPackage) {
  const errors = [];
  const validation = validateRuntimeDispatchPackage(dispatchPackage);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `dispatch_package::${error}`));
  if (!isPlainObject(dispatchPackage)) return { valid: false, errors: uniqueSorted(errors) };

  if (dispatchPackage.dispatch_status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION') {
    errors.push('dispatch_status_must_be_prepared_simulation');
  }
  if (dispatchPackage.dispatch_package_prepared_in_simulation !== true) {
    errors.push('dispatch_package_prepared_in_simulation_required');
  }
  if (dispatchPackage.dispatch_evaluated !== true) errors.push('dispatch_evaluation_required');
  if (dispatchPackage.simulation !== true) errors.push('simulation_required');
  if (dispatchPackage.production_blocked !== true) errors.push('production_blocked_required');
  if (dispatchPackage.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (dispatchPackage.validator_version !== RUNTIME_DISPATCH_PACKAGE_VALIDATOR_VERSION) {
    errors.push('dispatch_package_validator_version_unknown');
  }
  for (const field of [...UPSTREAM_ID_FIELDS, ...IDENTITY_FIELDS, ...UPSTREAM_FINGERPRINT_FIELDS]) {
    if (!isNonEmptyString(dispatchPackage[field])) errors.push(`${field}_provenance_missing`);
  }
  if (!isNonEmptyString(dispatchPackage.idempotency_fingerprint)) errors.push('idempotency_reference_missing');
  validateProvenanceCollections(dispatchPackage, errors);
  errors.push(...findAgentCoreOperationalMaterial(dispatchPackage));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildMaterial(dispatchPackage) {
  const source = {
    contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    intent_version: RUNTIME_EXECUTION_JOB_INTENT_VERSION,
    input_contract_name: 'RUNTIME_DISPATCH_PACKAGE',
    input_contract_version: dispatchPackage.runtime_dispatch_package_version,
    input_validator_version: dispatchPackage.validator_version,
    input_status: dispatchPackage.dispatch_status,
    execution_job_state: RUNTIME_EXECUTION_JOB_STATE,
    external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    dispatch_package_reference: {
      id: dispatchPackage.runtime_dispatch_package_id,
      version: dispatchPackage.runtime_dispatch_package_version,
      fingerprint: dispatchPackage.dispatch_package_fingerprint,
      digest: dispatchPackage.dispatch_package_digest
    },
    upstream_reference_ids: objectFromFields(dispatchPackage, PROVENANCE_REFERENCE_FIELDS),
    upstream_fingerprints: objectFromFields(dispatchPackage, PROVENANCE_FINGERPRINT_FIELDS),
    dispatch_provenance: {
      reference_ids: objectFromFields(dispatchPackage, DERIVED_ID_LIST_FIELDS),
      ordered_reference_ids: objectFromFields(dispatchPackage, ORDERED_LIST_FIELDS),
      fingerprints: objectFromFields(dispatchPackage, DERIVED_FINGERPRINT_LIST_FIELDS),
      authorization_reference_ids: [...dispatchPackage.dispatch_approval_gate_reference_ids],
      authorization_reference_fingerprints: [...dispatchPackage.dispatch_approval_gate_fingerprints]
    },
    identity_scope: objectFromFields(dispatchPackage, IDENTITY_FIELDS),
    idempotency_reference: {
      fingerprint: dispatchPackage.idempotency_fingerprint,
      validated: true,
      consumed: false,
      duplicate_execution_blocked: true
    },
    ...SAFE_FLAGS
  };
  return source;
}

function omitIntegrityFields(value) {
  const { runtime_execution_job_intent_fingerprint, runtime_execution_job_intent_digest, ...material } = value;
  return material;
}

function computeRuntimeExecutionJobIntentFingerprint(intent) {
  return stablePayload(omitIntegrityFields(intent));
}

function computeRuntimeExecutionJobIntentDigest(intent) {
  const { runtime_execution_job_intent_digest, ...material } = intent;
  return computeCanonicalContentDigest(material);
}

function buildRuntimeExecutionJobIntent(dispatchPackage) {
  const inputValidation = validateDispatchPackageInput(dispatchPackage);
  if (!inputValidation.valid) {
    throw new Error(`runtime_execution_job_intent_input_invalid::${JSON.stringify(inputValidation.errors)}`);
  }

  const material = buildMaterial(dispatchPackage);
  const intentSeed = computeCanonicalContentDigest({
    contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    dispatch_package_id: dispatchPackage.runtime_dispatch_package_id,
    dispatch_package_fingerprint: dispatchPackage.dispatch_package_fingerprint,
    dispatch_package_digest: dispatchPackage.dispatch_package_digest,
    idempotency_fingerprint: dispatchPackage.idempotency_fingerprint
  });
  const intent = {
    runtime_execution_job_intent_id: `runtime-execution-job-intent-${intentSeed.slice('sha256:'.length)}`,
    runtime_execution_job_intent_version: RUNTIME_EXECUTION_JOB_INTENT_VERSION,
    runtime_execution_job_intent_fingerprint: 'pending',
    runtime_execution_job_intent_digest: 'pending',
    input_contract_name: material.input_contract_name,
    input_contract_version: material.input_contract_version,
    input_validator_version: material.input_validator_version,
    input_status: material.input_status,
    execution_job_state: material.execution_job_state,
    external_effect_authorization_state: material.external_effect_authorization_state,
    dispatch_package_reference: material.dispatch_package_reference,
    upstream_reference_ids: material.upstream_reference_ids,
    upstream_fingerprints: material.upstream_fingerprints,
    dispatch_provenance: material.dispatch_provenance,
    identity_scope: material.identity_scope,
    idempotency_reference: material.idempotency_reference,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
  };
  intent.runtime_execution_job_intent_fingerprint = computeRuntimeExecutionJobIntentFingerprint(intent);
  intent.runtime_execution_job_intent_digest = computeRuntimeExecutionJobIntentDigest(intent);
  const validation = validateRuntimeExecutionJobIntent(intent);
  if (!validation.valid) throw new Error(`runtime_execution_job_intent_construction_invalid::${JSON.stringify(validation.errors)}`);
  return cloneFrozen(intent);
}

function validateNestedIntentShape(intent, errors) {
  const referenceIds = intent.upstream_reference_ids;
  const fingerprints = intent.upstream_fingerprints;
  const dispatch = intent.dispatch_provenance;
  const scope = intent.identity_scope;
  const idempotency = intent.idempotency_reference;
  if (!isPlainObject(intent.dispatch_package_reference)
    || !isNonEmptyString(intent.dispatch_package_reference.id)
    || !Number.isInteger(intent.dispatch_package_reference.version)
    || !isNonEmptyString(intent.dispatch_package_reference.fingerprint)
    || !isCanonicalContentDigest(intent.dispatch_package_reference.digest)) errors.push('dispatch_package_reference_invalid');
  if (!isPlainObject(referenceIds)) errors.push('upstream_reference_ids_invalid');
  else for (const field of PROVENANCE_REFERENCE_FIELDS) if (!isNonEmptyString(referenceIds[field])) errors.push(`${field}_invalid`);
  if (!isPlainObject(fingerprints)) errors.push('upstream_fingerprints_invalid');
  else for (const field of PROVENANCE_FINGERPRINT_FIELDS) if (!isNonEmptyString(fingerprints[field])) errors.push(`${field}_invalid`);
  if (!isPlainObject(dispatch)) errors.push('dispatch_provenance_invalid');
  else {
    for (const field of DERIVED_ID_LIST_FIELDS) if (!sortedStringList(dispatch.reference_ids?.[field])) errors.push(`dispatch_provenance_${field}_invalid`);
    for (const field of ORDERED_LIST_FIELDS) if (!exactStringList(dispatch.ordered_reference_ids?.[field])) errors.push(`dispatch_provenance_${field}_invalid`);
    for (const field of DERIVED_FINGERPRINT_LIST_FIELDS) if (!sortedStringList(dispatch.fingerprints?.[field])) errors.push(`dispatch_provenance_${field}_invalid`);
    if (!sortedStringList(dispatch.authorization_reference_ids) || !sortedStringList(dispatch.authorization_reference_fingerprints)) errors.push('authorization_provenance_invalid');
    if (dispatch.authorization_reference_ids.length !== dispatch.authorization_reference_fingerprints.length) errors.push('authorization_provenance_cardinality_mismatch');
  }
  if (!isPlainObject(scope)) errors.push('identity_scope_invalid');
  else for (const field of IDENTITY_FIELDS) if (!isNonEmptyString(scope[field])) errors.push(`identity_scope_${field}_invalid`);
  if (!isPlainObject(idempotency)
    || !isNonEmptyString(idempotency.fingerprint)
    || idempotency.validated !== true
    || idempotency.consumed !== false
    || idempotency.duplicate_execution_blocked !== true) errors.push('idempotency_reference_invalid');
}

function validateRuntimeExecutionJobIntent(intent) {
  const errors = [];
  if (!isPlainObject(intent)) return { valid: false, errors: ['runtime_execution_job_intent_must_be_object'] };
  exactFields(intent, RUNTIME_EXECUTION_JOB_INTENT_FIELDS, 'runtime_execution_job_intent', errors);
  for (const field of [
    'runtime_execution_job_intent_id', 'runtime_execution_job_intent_fingerprint',
    'runtime_execution_job_intent_digest', 'input_contract_name', 'input_validator_version',
    'input_status', 'execution_job_state', 'external_effect_authorization_state', 'validator_version'
  ]) if (!isNonEmptyString(intent[field])) errors.push(`${field}_invalid`);
  if (intent.runtime_execution_job_intent_version !== RUNTIME_EXECUTION_JOB_INTENT_VERSION) errors.push('intent_version_invalid');
  if (intent.input_contract_name !== 'RUNTIME_DISPATCH_PACKAGE') errors.push('input_contract_name_invalid');
  if (!Number.isInteger(intent.input_contract_version) || intent.input_contract_version < 1) errors.push('input_contract_version_invalid');
  if (intent.input_status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION') errors.push('input_status_invalid');
  if (intent.execution_job_state !== RUNTIME_EXECUTION_JOB_STATE) errors.push('execution_job_state_invalid');
  if (intent.external_effect_authorization_state !== EXTERNAL_EFFECT_AUTHORIZATION_STATE) errors.push('external_effect_authorization_state_invalid');
  validateNestedIntentShape(intent, errors);
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) if (intent[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  if (intent.input_validator_version !== RUNTIME_DISPATCH_PACKAGE_VALIDATOR_VERSION) errors.push('input_validator_version_invalid');
  if (intent.validator_version !== RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    if (computeRuntimeExecutionJobIntentFingerprint(intent) !== intent.runtime_execution_job_intent_fingerprint) errors.push('intent_fingerprint_mismatch');
  } catch (error) {
    errors.push(`intent_fingerprint_invalid::${error.message}`);
  }
  try {
    if (computeRuntimeExecutionJobIntentDigest(intent) !== intent.runtime_execution_job_intent_digest) errors.push('intent_digest_mismatch');
  } catch (error) {
    errors.push(`intent_digest_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function blockedResult(errors) {
  return cloneFrozen({
    contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_JOB_INTENT_BLOCKED_STATUS,
    execution_job_state: 'BLOCKED',
    external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    blockers: uniqueSorted(errors),
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
  });
}

function evaluateRuntimeExecutionJobIntent(dispatchPackage) {
  const validation = validateDispatchPackageInput(dispatchPackage);
  if (!validation.valid) return blockedResult(validation.errors);
  try {
    return cloneFrozen({
      contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
      contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
      status: RUNTIME_EXECUTION_JOB_INTENT_STATUS,
      execution_job_state: RUNTIME_EXECUTION_JOB_STATE,
      external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
      blockers: [],
      intent: buildRuntimeExecutionJobIntent(dispatchPackage),
      ...SAFE_FLAGS,
      validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
    });
  } catch (error) {
    return blockedResult([`intent_construction_failed::${error.message}`]);
  }
}

function compareRuntimeExecutionJobIntentReplay(existingIntent, candidateIntent) {
  const existingValidation = validateRuntimeExecutionJobIntent(existingIntent);
  const candidateValidation = validateRuntimeExecutionJobIntent(candidateIntent);
  if (!existingValidation.valid || !candidateValidation.valid) {
    return { status: 'REPLAY_BLOCKED', errors: uniqueSorted([...existingValidation.errors, ...candidateValidation.errors]) };
  }
  if (existingIntent.runtime_execution_job_intent_id !== candidateIntent.runtime_execution_job_intent_id) return { status: 'NOT_SAME_INTENT' };
  if (existingIntent.runtime_execution_job_intent_fingerprint === candidateIntent.runtime_execution_job_intent_fingerprint) return { status: 'REPLAY_ACCEPTED' };
  if (existingIntent.idempotency_reference.fingerprint === candidateIntent.idempotency_reference.fingerprint) return { status: 'IDEMPOTENCY_CONFLICT' };
  return { status: 'FINGERPRINT_CONFLICT' };
}

module.exports = {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_BLOCKED_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_FIELDS,
  RUNTIME_EXECUTION_JOB_INTENT_STATE: RUNTIME_EXECUTION_JOB_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_VERSION,
  buildRuntimeExecutionJobIntent,
  compareRuntimeExecutionJobIntentReplay,
  computeRuntimeExecutionJobIntentDigest,
  computeRuntimeExecutionJobIntentFingerprint,
  evaluateRuntimeExecutionJobIntent,
  validateRuntimeExecutionJobIntent,
  validateRuntimeExecutionJobIntentInput: validateDispatchPackageInput
};
