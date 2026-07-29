'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeAdmissionPolicy } = require('./runtime-admission-policy');
const { validateRuntimeReadinessRequest } = require('./runtime-readiness-request');
const { validateRuntimeReadinessDecision } = require('./runtime-readiness-decision');
const { validateRuntimeExecutionPackage } = require('./runtime-execution-package');
const { validateRuntimeCapacitySnapshotReference } = require('./runtime-capacity-snapshot-reference');
const { validateRuntimeConcurrencyReference } = require('./runtime-concurrency-reference');
const { validateRuntimeReadinessFreshnessReference } = require('./runtime-readiness-freshness-reference');
const { validateRuntimeReadinessReplayReference } = require('./runtime-readiness-replay-reference');

// pr104: aggregates every reference Phase B (Admission) needs -- the Readiness Request/Decision
// this admission attempt follows from, the same Runtime Execution Package reference, and the
// (re-supplied, to be independently revalidated -- "revalidar Capacity Snapshot... Concurrency...
// Freshness... Replay") capacity/concurrency/freshness/replay references. `context` is never read
// for any decision.
const RUNTIME_ADMISSION_REQUEST_VALIDATOR_VERSION = 'runtime_admission_request_validator_v1';

const RUNTIME_ADMISSION_REQUEST_FIELDS = Object.freeze([
  'runtime_admission_request_id', 'runtime_admission_request_version',
  'runtime_admission_policy', 'runtime_readiness_request_reference', 'runtime_readiness_decision_reference',
  'runtime_execution_package_reference', 'runtime_capacity_snapshot_reference', 'runtime_concurrency_reference',
  'runtime_readiness_freshness_reference', 'runtime_readiness_replay_reference',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_admission_registry_version',
  'simulation_context', 'validator_version'
]);

const NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_admission_policy', validateRuntimeAdmissionPolicy],
  ['runtime_readiness_request_reference', validateRuntimeReadinessRequest],
  ['runtime_readiness_decision_reference', validateRuntimeReadinessDecision],
  ['runtime_execution_package_reference', validateRuntimeExecutionPackage],
  ['runtime_capacity_snapshot_reference', validateRuntimeCapacitySnapshotReference],
  ['runtime_concurrency_reference', validateRuntimeConcurrencyReference],
  ['runtime_readiness_freshness_reference', validateRuntimeReadinessFreshnessReference],
  ['runtime_readiness_replay_reference', validateRuntimeReadinessReplayReference]
]);

function validateRuntimeAdmissionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_admission_request_must_be_object'] };
  exactFields(request, RUNTIME_ADMISSION_REQUEST_FIELDS, 'runtime_admission_request', errors);
  for (const field of ['runtime_admission_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_admission_request_version) || request.runtime_admission_request_version < 1) {
    errors.push('runtime_admission_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_admission_registry_version) || request.expected_admission_registry_version < 1) {
    errors.push('expected_admission_registry_version_invalid');
  }

  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  for (const [field, validator] of NESTED_REFERENCE_VALIDATORS) {
    const result = validator(request[field]);
    if (!result.valid) errors.push(`${field}_invalid::${result.errors.join('|')}`);
  }

  if (request.validator_version !== RUNTIME_ADMISSION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeAdmissionRequest(input = {}) {
  const request = {
    runtime_admission_request_id: input.runtime_admission_request_id,
    runtime_admission_request_version: Number.isInteger(input.runtime_admission_request_version) ? input.runtime_admission_request_version : 1,
    runtime_admission_policy: input.runtime_admission_policy,
    runtime_readiness_request_reference: input.runtime_readiness_request_reference,
    runtime_readiness_decision_reference: input.runtime_readiness_decision_reference,
    runtime_execution_package_reference: input.runtime_execution_package_reference,
    runtime_capacity_snapshot_reference: input.runtime_capacity_snapshot_reference,
    runtime_concurrency_reference: input.runtime_concurrency_reference,
    runtime_readiness_freshness_reference: input.runtime_readiness_freshness_reference,
    runtime_readiness_replay_reference: input.runtime_readiness_replay_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_admission_registry_version: Number.isInteger(input.expected_admission_registry_version) ? input.expected_admission_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_ADMISSION_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeAdmissionRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_admission_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  NESTED_REFERENCE_VALIDATORS,
  RUNTIME_ADMISSION_REQUEST_FIELDS,
  RUNTIME_ADMISSION_REQUEST_VALIDATOR_VERSION,
  buildRuntimeAdmissionRequest,
  validateRuntimeAdmissionRequest
};
