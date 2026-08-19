'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  cloneFrozen,
  exactFields,
  stablePayload
} = require('./agent-identity-contract');
const {
  computeCanonicalContentDigest,
  isCanonicalContentDigest
} = require('./canonical-content-digest');
const {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION,
  validateRuntimeExecutionJobIntent
} = require('./runtime-execution-job-intent');

const RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME = 'RUNTIME_EXECUTION_JOB_MATERIALIZED_SIMULATION';
const RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION = 'runtime_execution_job_materialized_simulation_contract_v1';
const RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION = 'runtime_execution_job_materialization_validator_v1';
const RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION = 1;
const RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS = 'RUNTIME_EXECUTION_JOB_MATERIALIZED_SIMULATION';

const IDENTITY_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);

const JOB_REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const INTENT_REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const DISPATCH_REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const IDEMPOTENCY_REFERENCE_FIELDS = Object.freeze([
  'fingerprint', 'validated', 'consumed', 'duplicate_execution_blocked'
]);
const PROVENANCE_REFERENCE_FIELDS = Object.freeze([
  'upstream_reference_ids',
  'upstream_fingerprints',
  'dispatch_provenance_digest',
  'authorization_reference_ids',
  'authorization_reference_fingerprints'
]);

const SAFE_FLAGS = Object.freeze({
  execution_authorized: false,
  external_effect_allowed: false,
  provider_call_allowed: false,
  network_call_allowed: false,
  secrets_materialized: false,
  attempt_created: false,
  execution_performed: false,
  durable_job_persisted: false,
  output_persisted: false,
  simulation: true,
  production_blocked: true
});

const RUNTIME_EXECUTION_JOB_MATERIALIZATION_FIELDS = Object.freeze([
  'runtime_execution_job_materialization_id',
  'runtime_execution_job_materialization_version',
  'runtime_execution_job_materialization_fingerprint',
  'runtime_execution_job_materialization_digest',
  'contract_name',
  'contract_version',
  'status',
  'input_contract_name',
  'input_contract_version',
  'input_validator_version',
  'input_status',
  'input_state',
  'input_external_effect_authorization_state',
  'runtime_execution_job_intent_reference',
  'job_reference',
  'dispatch_package_reference',
  'provenance_reference',
  'identity_scope',
  'idempotency_reference',
  'execution_job_state',
  'external_effect_authorization_state',
  ...Object.keys(SAFE_FLAGS),
  'validator_version'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isSortedStringList(value) {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) return false;
  if (new Set(value).size !== value.length) return false;
  const sorted = [...value].sort();
  return value.every((item, index) => item === sorted[index]);
}

function validateReference(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_invalid`);
    return;
  }
  exactFields(value, fields, prefix, errors);
  if (!isNonEmptyString(value.id)) errors.push(`${prefix}_id_invalid`);
  if (!Number.isInteger(value.version) || value.version < 1) errors.push(`${prefix}_version_invalid`);
  if (!isNonEmptyString(value.fingerprint)) errors.push(`${prefix}_fingerprint_invalid`);
  if (!isCanonicalContentDigest(value.digest)) errors.push(`${prefix}_digest_invalid`);
}

function validateStringMap(value, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_invalid`);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!isNonEmptyString(key) || !isNonEmptyString(item)) errors.push(`${prefix}_entry_invalid`);
  }
}

function validateProvenanceReference(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('provenance_reference_invalid');
    return;
  }
  exactFields(value, PROVENANCE_REFERENCE_FIELDS, 'provenance_reference', errors);
  validateStringMap(value.upstream_reference_ids, 'provenance_reference_upstream_reference_ids', errors);
  validateStringMap(value.upstream_fingerprints, 'provenance_reference_upstream_fingerprints', errors);
  if (!isCanonicalContentDigest(value.dispatch_provenance_digest)) errors.push('provenance_reference_dispatch_provenance_digest_invalid');
  if (!isSortedStringList(value.authorization_reference_ids)) errors.push('provenance_reference_authorization_reference_ids_invalid');
  if (!isSortedStringList(value.authorization_reference_fingerprints)) errors.push('provenance_reference_authorization_reference_fingerprints_invalid');
  if (Array.isArray(value.authorization_reference_ids)
    && Array.isArray(value.authorization_reference_fingerprints)
    && value.authorization_reference_ids.length !== value.authorization_reference_fingerprints.length) {
    errors.push('provenance_reference_authorization_cardinality_mismatch');
  }
}

function validateIdentityScope(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('identity_scope_invalid');
    return;
  }
  exactFields(value, IDENTITY_FIELDS, 'identity_scope', errors);
  for (const field of IDENTITY_FIELDS) if (!isNonEmptyString(value[field])) errors.push(`identity_scope_${field}_invalid`);
}

function validateIdempotencyReference(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('idempotency_reference_invalid');
    return;
  }
  exactFields(value, IDEMPOTENCY_REFERENCE_FIELDS, 'idempotency_reference', errors);
  if (!isNonEmptyString(value.fingerprint)) errors.push('idempotency_reference_fingerprint_invalid');
  if (value.validated !== true) errors.push('idempotency_reference_must_be_validated');
  if (value.consumed !== false) errors.push('idempotency_reference_must_be_unconsumed');
  if (value.duplicate_execution_blocked !== true) errors.push('idempotency_reference_duplicate_execution_must_be_blocked');
}

function omitIntegrityFields(value) {
  const {
    runtime_execution_job_materialization_fingerprint,
    runtime_execution_job_materialization_digest,
    ...material
  } = value;
  return material;
}

function computeRuntimeExecutionJobMaterializationFingerprint(materialization) {
  return stablePayload(omitIntegrityFields(materialization));
}

function computeRuntimeExecutionJobMaterializationDigest(materialization) {
  const { runtime_execution_job_materialization_digest, ...material } = materialization;
  return computeCanonicalContentDigest(material);
}

function buildProvenanceReference(intent) {
  return {
    upstream_reference_ids: clone(intent.upstream_reference_ids),
    upstream_fingerprints: clone(intent.upstream_fingerprints),
    dispatch_provenance_digest: computeCanonicalContentDigest(intent.dispatch_provenance),
    authorization_reference_ids: [...intent.dispatch_provenance.authorization_reference_ids],
    authorization_reference_fingerprints: [...intent.dispatch_provenance.authorization_reference_fingerprints]
  };
}

function buildJobIdentity(intent, provenanceReference) {
  return {
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    runtime_execution_job_intent_reference: {
      id: intent.runtime_execution_job_intent_id,
      version: intent.runtime_execution_job_intent_version,
      fingerprint: intent.runtime_execution_job_intent_fingerprint,
      digest: intent.runtime_execution_job_intent_digest
    },
    dispatch_package_reference: clone(intent.dispatch_package_reference),
    identity_scope: clone(intent.identity_scope),
    idempotency_fingerprint: intent.idempotency_reference.fingerprint,
    dispatch_provenance_digest: provenanceReference.dispatch_provenance_digest
  };
}

function buildJobReference(intent, provenanceReference) {
  const identity = buildJobIdentity(intent, provenanceReference);
  const fingerprint = stablePayload(identity);
  const digest = computeCanonicalContentDigest(identity);
  return {
    id: `runtime-execution-job-${digest.slice('sha256:'.length)}`,
    version: 1,
    fingerprint,
    digest
  };
}

function buildMaterialization(intent) {
  const provenanceReference = buildProvenanceReference(intent);
  const jobReference = buildJobReference(intent, provenanceReference);
  const materializationSeed = computeCanonicalContentDigest({
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    intent_id: intent.runtime_execution_job_intent_id,
    intent_fingerprint: intent.runtime_execution_job_intent_fingerprint,
    job_reference: jobReference
  });

  return {
    runtime_execution_job_materialization_id: `runtime-execution-job-materialization-${materializationSeed.slice('sha256:'.length)}`,
    runtime_execution_job_materialization_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
    runtime_execution_job_materialization_fingerprint: 'pending',
    runtime_execution_job_materialization_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
    input_contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
    input_contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    input_validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION,
    input_status: RUNTIME_EXECUTION_JOB_INTENT_STATUS,
    input_state: intent.execution_job_state,
    input_external_effect_authorization_state: intent.external_effect_authorization_state,
    runtime_execution_job_intent_reference: {
      id: intent.runtime_execution_job_intent_id,
      version: intent.runtime_execution_job_intent_version,
      fingerprint: intent.runtime_execution_job_intent_fingerprint,
      digest: intent.runtime_execution_job_intent_digest
    },
    job_reference: jobReference,
    dispatch_package_reference: clone(intent.dispatch_package_reference),
    provenance_reference: provenanceReference,
    identity_scope: clone(intent.identity_scope),
    idempotency_reference: clone(intent.idempotency_reference),
    execution_job_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION
  };
}

function buildOutputJobIdentity(materialization) {
  return {
    contract_name: materialization.contract_name,
    contract_version: materialization.contract_version,
    runtime_execution_job_intent_reference: materialization.runtime_execution_job_intent_reference,
    dispatch_package_reference: materialization.dispatch_package_reference,
    identity_scope: materialization.identity_scope,
    idempotency_fingerprint: materialization.idempotency_reference.fingerprint,
    dispatch_provenance_digest: materialization.provenance_reference.dispatch_provenance_digest
  };
}

function validateRuntimeExecutionJobMaterialization(materialization) {
  const errors = [];
  if (!isPlainObject(materialization)) return { valid: false, errors: ['runtime_execution_job_materialization_must_be_object'] };
  exactFields(materialization, RUNTIME_EXECUTION_JOB_MATERIALIZATION_FIELDS, 'runtime_execution_job_materialization', errors);

  for (const field of [
    'runtime_execution_job_materialization_id', 'runtime_execution_job_materialization_fingerprint',
    'runtime_execution_job_materialization_digest', 'contract_name', 'contract_version',
    'input_contract_name', 'input_contract_version', 'input_validator_version', 'input_status',
    'input_state', 'input_external_effect_authorization_state', 'status', 'execution_job_state',
    'external_effect_authorization_state', 'validator_version'
  ]) if (!isNonEmptyString(materialization[field])) errors.push(`${field}_invalid`);

  if (materialization.runtime_execution_job_materialization_version !== RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION) errors.push('materialization_version_invalid');
  if (materialization.contract_name !== RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (materialization.contract_version !== RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (materialization.status !== RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS) errors.push('status_invalid');
  if (materialization.input_contract_name !== RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME) errors.push('input_contract_name_invalid');
  if (materialization.input_contract_version !== RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION) errors.push('input_contract_version_invalid');
  if (materialization.input_validator_version !== RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION) errors.push('input_validator_version_invalid');
  if (materialization.input_status !== RUNTIME_EXECUTION_JOB_INTENT_STATUS) errors.push('input_status_invalid');
  if (materialization.input_state !== RUNTIME_EXECUTION_JOB_INTENT_STATE) errors.push('input_state_invalid');
  if (materialization.input_external_effect_authorization_state !== EXTERNAL_EFFECT_AUTHORIZATION_STATE) errors.push('input_authorization_state_invalid');
  if (materialization.execution_job_state !== RUNTIME_EXECUTION_JOB_INTENT_STATE) errors.push('execution_job_state_invalid');
  if (materialization.external_effect_authorization_state !== EXTERNAL_EFFECT_AUTHORIZATION_STATE) errors.push('authorization_state_invalid');
  if (materialization.validator_version !== RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION) errors.push('validator_version_invalid');

  validateReference(materialization.runtime_execution_job_intent_reference, INTENT_REFERENCE_FIELDS, 'runtime_execution_job_intent_reference', errors);
  validateReference(materialization.job_reference, JOB_REFERENCE_FIELDS, 'job_reference', errors);
  validateReference(materialization.dispatch_package_reference, DISPATCH_REFERENCE_FIELDS, 'dispatch_package_reference', errors);
  validateProvenanceReference(materialization.provenance_reference, errors);
  validateIdentityScope(materialization.identity_scope, errors);
  validateIdempotencyReference(materialization.idempotency_reference, errors);

  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (materialization[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (isPlainObject(materialization.runtime_execution_job_intent_reference)
    && materialization.runtime_execution_job_intent_reference.version !== 1) errors.push('intent_reference_version_invalid');

  try {
    const jobIdentity = buildOutputJobIdentity(materialization);
    const expectedJobFingerprint = stablePayload(jobIdentity);
    const expectedJobDigest = computeCanonicalContentDigest(jobIdentity);
    if (materialization.job_reference?.fingerprint !== expectedJobFingerprint) errors.push('job_reference_fingerprint_mismatch');
    if (materialization.job_reference?.digest !== expectedJobDigest) errors.push('job_reference_digest_mismatch');
    if (materialization.job_reference?.id !== `runtime-execution-job-${expectedJobDigest.slice('sha256:'.length)}`) errors.push('job_reference_id_mismatch');
  } catch (error) {
    errors.push(`job_reference_integrity_invalid::${error.message}`);
  }

  try {
    if (computeRuntimeExecutionJobMaterializationFingerprint(materialization) !== materialization.runtime_execution_job_materialization_fingerprint) errors.push('materialization_fingerprint_mismatch');
  } catch (error) {
    errors.push(`materialization_fingerprint_invalid::${error.message}`);
  }
  try {
    if (computeRuntimeExecutionJobMaterializationDigest(materialization) !== materialization.runtime_execution_job_materialization_digest) errors.push('materialization_digest_mismatch');
  } catch (error) {
    errors.push(`materialization_digest_invalid::${error.message}`);
  }
  try {
    stablePayload(materialization);
  } catch (error) {
    errors.push(`materialization_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeExecutionJobMaterialization(intent) {
  const inputValidation = validateRuntimeExecutionJobIntent(intent);
  if (!inputValidation.valid) {
    throw new Error(`runtime_execution_job_materialization_input_invalid::${JSON.stringify(inputValidation.errors)}`);
  }

  const materialization = buildMaterialization(intent);
  materialization.runtime_execution_job_materialization_fingerprint = computeRuntimeExecutionJobMaterializationFingerprint(materialization);
  materialization.runtime_execution_job_materialization_digest = computeRuntimeExecutionJobMaterializationDigest(materialization);
  const validation = validateRuntimeExecutionJobMaterialization(materialization);
  if (!validation.valid) {
    throw new Error(`runtime_execution_job_materialization_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(materialization);
}

module.exports = {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_FIELDS,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
  SAFE_FLAGS,
  buildRuntimeExecutionJobMaterialization,
  computeRuntimeExecutionJobMaterializationDigest,
  computeRuntimeExecutionJobMaterializationFingerprint,
  validateRuntimeExecutionJobMaterialization
};
