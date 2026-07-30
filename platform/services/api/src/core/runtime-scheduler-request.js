'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeSchedulerPolicy } = require('./runtime-scheduler-policy');
const { validateRuntimeAdmissionRequest } = require('./runtime-admission-request');
const { validateRuntimeAdmissionDecision } = require('./runtime-admission-decision');
const { validateRuntimeAdmissionResult } = require('./runtime-admission-result');
const { validateRuntimeReadinessDecision } = require('./runtime-readiness-decision');
const { validateRuntimeExecutionPackage } = require('./runtime-execution-package');
const { validateRuntimeStageSimulationManifest } = require('./runtime-stage-simulation-manifest');
const { validateRuntimeDependencySimulationManifest } = require('./runtime-dependency-simulation-manifest');
const { validateRuntimeBudgetSimulationReference } = require('./runtime-budget-simulation-reference');
const { validateRuntimeCapacitySnapshotReference } = require('./runtime-capacity-snapshot-reference');
const { validateRuntimeConcurrencyReference } = require('./runtime-concurrency-reference');
const { validateRuntimeReadinessFreshnessReference } = require('./runtime-readiness-freshness-reference');
const { validateRuntimeReadinessReplayReference } = require('./runtime-readiness-replay-reference');
const { validateExecutionPlanIdempotency } = require('./execution-plan-idempotency');
const { validateRuntimeStopSimulationReference } = require('./runtime-stop-simulation-reference');
const { validateRuntimeCompensationSimulationReference } = require('./runtime-compensation-simulation-reference');
const { validateRuntimeArtifactPlanReference } = require('./runtime-artifact-plan-reference');
const { validateRuntimeEventPlanReference } = require('./runtime-event-plan-reference');

// pr105: aggregates every reference runtime-scheduler-boundary.js needs -- the already-admitted
// chain this scheduler request follows from (Admission Request/Decision/Result, Readiness Decision,
// Runtime Execution Package), the real Stage/Dependency manifests it schedules over, the same
// Runtime Budget/Capacity/Concurrency/Freshness/Replay/Idempotency references PR #104 already
// established (freshness and replay reused verbatim, never re-invented -- see
// runtime-readiness-freshness-reference.js/runtime-readiness-replay-reference.js; idempotency is
// the real, official ExecutionPlanIdempotencyReference from PR #98, reused verbatim, never a
// parallel contract). "Nenhum dado decisório pode vir de context" -- `simulation_context` is
// structurally validated but never read by the boundary for any decision.
const RUNTIME_SCHEDULER_REQUEST_VALIDATOR_VERSION = 'runtime_scheduler_request_validator_v1';

const RUNTIME_SCHEDULER_REQUEST_FIELDS = Object.freeze([
  'runtime_scheduler_request_id', 'runtime_scheduler_request_version',
  'runtime_scheduler_policy',
  'runtime_admission_request_reference', 'runtime_admission_decision_reference', 'runtime_admission_result_reference',
  'runtime_readiness_decision_reference',
  'runtime_execution_package_reference', 'runtime_stage_manifest_reference', 'runtime_dependency_manifest_reference',
  'runtime_budget_reference',
  'runtime_capacity_snapshot_reference', 'runtime_concurrency_reference', 'runtime_freshness_reference',
  'runtime_replay_reference', 'idempotency_reference',
  'runtime_stop_references', 'runtime_compensation_references', 'runtime_artifact_plan_reference',
  'runtime_event_plan_reference',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_scheduler_registry_version',
  'simulation_context', 'validator_version'
]);

const SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_scheduler_policy', validateRuntimeSchedulerPolicy],
  ['runtime_admission_request_reference', validateRuntimeAdmissionRequest],
  ['runtime_admission_decision_reference', validateRuntimeAdmissionDecision],
  ['runtime_admission_result_reference', validateRuntimeAdmissionResult],
  ['runtime_readiness_decision_reference', validateRuntimeReadinessDecision],
  ['runtime_execution_package_reference', validateRuntimeExecutionPackage],
  ['runtime_stage_manifest_reference', validateRuntimeStageSimulationManifest],
  ['runtime_dependency_manifest_reference', validateRuntimeDependencySimulationManifest],
  ['runtime_budget_reference', validateRuntimeBudgetSimulationReference],
  ['runtime_capacity_snapshot_reference', validateRuntimeCapacitySnapshotReference],
  ['runtime_concurrency_reference', validateRuntimeConcurrencyReference],
  ['runtime_freshness_reference', validateRuntimeReadinessFreshnessReference],
  ['runtime_replay_reference', validateRuntimeReadinessReplayReference],
  ['idempotency_reference', validateExecutionPlanIdempotency],
  ['runtime_artifact_plan_reference', validateRuntimeArtifactPlanReference],
  ['runtime_event_plan_reference', validateRuntimeEventPlanReference]
]);

const LIST_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_stop_references', validateRuntimeStopSimulationReference],
  ['runtime_compensation_references', validateRuntimeCompensationSimulationReference]
]);

const MAX_LIST_ITEMS = 200;

function validateRuntimeSchedulerRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_scheduler_request_must_be_object'] };
  exactFields(request, RUNTIME_SCHEDULER_REQUEST_FIELDS, 'runtime_scheduler_request', errors);
  for (const field of ['runtime_scheduler_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_scheduler_request_version) || request.runtime_scheduler_request_version < 1) {
    errors.push('runtime_scheduler_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_scheduler_registry_version) || request.expected_scheduler_registry_version < 1) {
    errors.push('expected_scheduler_registry_version_invalid');
  }

  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  for (const [field, validator] of SINGLE_NESTED_REFERENCE_VALIDATORS) {
    const result = validator(request[field]);
    if (!result.valid) errors.push(`${field}_invalid::${result.errors.join('|')}`);
  }
  for (const [field, validator] of LIST_NESTED_REFERENCE_VALIDATORS) {
    if (!Array.isArray(request[field]) || request[field].length > MAX_LIST_ITEMS) {
      errors.push(`${field}_invalid`);
    } else {
      request[field].forEach((reference, index) => {
        const result = validator(reference);
        if (!result.valid) errors.push(`${field}[${index}]_invalid::${result.errors.join('|')}`);
      });
    }
  }

  if (request.validator_version !== RUNTIME_SCHEDULER_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerRequest(input = {}) {
  const request = {
    runtime_scheduler_request_id: input.runtime_scheduler_request_id,
    runtime_scheduler_request_version: Number.isInteger(input.runtime_scheduler_request_version) ? input.runtime_scheduler_request_version : 1,
    runtime_scheduler_policy: input.runtime_scheduler_policy,
    runtime_admission_request_reference: input.runtime_admission_request_reference,
    runtime_admission_decision_reference: input.runtime_admission_decision_reference,
    runtime_admission_result_reference: input.runtime_admission_result_reference,
    runtime_readiness_decision_reference: input.runtime_readiness_decision_reference,
    runtime_execution_package_reference: input.runtime_execution_package_reference,
    runtime_stage_manifest_reference: input.runtime_stage_manifest_reference,
    runtime_dependency_manifest_reference: input.runtime_dependency_manifest_reference,
    runtime_budget_reference: input.runtime_budget_reference,
    runtime_capacity_snapshot_reference: input.runtime_capacity_snapshot_reference,
    runtime_concurrency_reference: input.runtime_concurrency_reference,
    runtime_freshness_reference: input.runtime_freshness_reference,
    runtime_replay_reference: input.runtime_replay_reference,
    idempotency_reference: input.idempotency_reference,
    runtime_stop_references: Array.isArray(input.runtime_stop_references) ? input.runtime_stop_references : [],
    runtime_compensation_references: Array.isArray(input.runtime_compensation_references) ? input.runtime_compensation_references : [],
    runtime_artifact_plan_reference: input.runtime_artifact_plan_reference,
    runtime_event_plan_reference: input.runtime_event_plan_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_scheduler_registry_version: Number.isInteger(input.expected_scheduler_registry_version) ? input.expected_scheduler_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_SCHEDULER_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeSchedulerRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  LIST_NESTED_REFERENCE_VALIDATORS,
  MAX_LIST_ITEMS,
  RUNTIME_SCHEDULER_REQUEST_FIELDS,
  RUNTIME_SCHEDULER_REQUEST_VALIDATOR_VERSION,
  SINGLE_NESTED_REFERENCE_VALIDATORS,
  buildRuntimeSchedulerRequest,
  validateRuntimeSchedulerRequest
};
