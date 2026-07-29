'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr104: "RuntimeConcurrencyReference descreve disponibilidade declarativa de slots. Nenhum slot é
// consumido nesta implementação." `requested_*` fields are declared verbatim by the caller (the
// boundary is responsible for deriving them honestly from the real Runtime Package -- see
// runtime-admission-boundary.js's own "Capacity Requirements" cross-check, never trusted as
// "valores requested fornecidos livremente pelo caller"); the `*_slots_available` booleans are
// accepted the same "caller declares, boundary recomputes and compares" way
// runtime-budget-simulation-reference.js's own stage_counts_within_limit already established.
const RUNTIME_CONCURRENCY_REFERENCE_VALIDATOR_VERSION = 'runtime_concurrency_reference_validator_v1';

const REQUESTED_FIELDS = Object.freeze([
  'requested_package_slots', 'requested_stage_slots', 'requested_parallel_stage_slots',
  'requested_model_stage_slots', 'requested_tool_stage_slots', 'requested_workflow_stage_slots'
]);

// [maximum field, current field] pairs for tenant/organization/agent-scoped package slot pools.
const SCOPE_SLOT_PAIRS = Object.freeze([
  ['maximum_tenant_package_slots', 'current_tenant_package_slots'],
  ['maximum_organization_package_slots', 'current_organization_package_slots'],
  ['maximum_agent_package_slots', 'current_agent_package_slots']
]);

const SCOPE_SLOT_FIELDS = Object.freeze(SCOPE_SLOT_PAIRS.flat());

const AVAILABILITY_FLAG_FIELDS = Object.freeze([
  'package_slots_available', 'stage_slots_available', 'parallel_slots_available', 'model_slots_available',
  'tool_slots_available', 'workflow_slots_available', 'tenant_slots_available', 'organization_slots_available',
  'agent_slots_available'
]);

const RUNTIME_CONCURRENCY_REFERENCE_FIELDS = Object.freeze([
  'runtime_concurrency_reference_id', 'runtime_concurrency_reference_version', 'runtime_capacity_snapshot_reference_id',
  'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id',
  ...REQUESTED_FIELDS,
  ...SCOPE_SLOT_FIELDS,
  ...AVAILABILITY_FLAG_FIELDS,
  'concurrency_validated', 'concurrency_applied',
  'concurrency_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_CONCURRENCY_REFERENCE_SAFE_FLAGS = Object.freeze({
  concurrency_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_SLOT_BOUND = 1000000000;

function computeRuntimeConcurrencyReferenceFingerprint(reference) {
  const { concurrency_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeConcurrencyReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_concurrency_reference_must_be_object'] };
  exactFields(reference, RUNTIME_CONCURRENCY_REFERENCE_FIELDS, 'runtime_concurrency_reference', errors);
  for (const field of [
    'runtime_concurrency_reference_id', 'runtime_capacity_snapshot_reference_id', 'runtime_execution_package_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'concurrency_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_concurrency_reference_version) || reference.runtime_concurrency_reference_version < 1) {
    errors.push('runtime_concurrency_reference_version_invalid');
  }
  for (const field of [...REQUESTED_FIELDS, ...SCOPE_SLOT_FIELDS]) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_SLOT_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [maxField, curField] of SCOPE_SLOT_PAIRS) {
    if (Number.isInteger(reference[maxField]) && Number.isInteger(reference[curField]) && reference[curField] > reference[maxField]) {
      errors.push(`${curField}_exceeds_${maxField}`);
    }
  }
  for (const field of AVAILABILITY_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.concurrency_validated !== 'boolean') errors.push('concurrency_validated_must_be_boolean');
  if (AVAILABILITY_FLAG_FIELDS.every((field) => typeof reference[field] === 'boolean')) {
    const expectedValidated = AVAILABILITY_FLAG_FIELDS.every((field) => reference[field] === true);
    if (reference.concurrency_validated !== expectedValidated) errors.push('concurrency_validated_inconsistent_with_availability_flags');
  }
  for (const [field, expected] of Object.entries(RUNTIME_CONCURRENCY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_CONCURRENCY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeConcurrencyReferenceFingerprint(reference) !== reference.concurrency_fingerprint) errors.push('concurrency_fingerprint_mismatch');
  } catch (error) {
    errors.push('concurrency_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeConcurrencyReference(input = {}) {
  const reference = {
    runtime_concurrency_reference_id: input.runtime_concurrency_reference_id,
    runtime_concurrency_reference_version: Number.isInteger(input.runtime_concurrency_reference_version) ? input.runtime_concurrency_reference_version : 1,
    runtime_capacity_snapshot_reference_id: input.runtime_capacity_snapshot_reference_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    concurrency_fingerprint: 'pending',
    ...RUNTIME_CONCURRENCY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_CONCURRENCY_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of [...REQUESTED_FIELDS, ...SCOPE_SLOT_FIELDS]) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  for (const field of AVAILABILITY_FLAG_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.concurrency_validated = AVAILABILITY_FLAG_FIELDS.every((field) => reference[field] === true);
  reference.concurrency_fingerprint = computeRuntimeConcurrencyReferenceFingerprint(reference);

  const validation = validateRuntimeConcurrencyReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_concurrency_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  AVAILABILITY_FLAG_FIELDS,
  MAX_SLOT_BOUND,
  REQUESTED_FIELDS,
  RUNTIME_CONCURRENCY_REFERENCE_FIELDS,
  RUNTIME_CONCURRENCY_REFERENCE_SAFE_FLAGS,
  RUNTIME_CONCURRENCY_REFERENCE_VALIDATOR_VERSION,
  SCOPE_SLOT_FIELDS,
  SCOPE_SLOT_PAIRS,
  buildRuntimeConcurrencyReference,
  computeRuntimeConcurrencyReferenceFingerprint,
  validateRuntimeConcurrencyReference
};
