'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeDispatchPolicy } = require('./runtime-dispatch-policy');
const { validateRuntimeWorkerAssignmentRequest } = require('./runtime-worker-assignment-request');
const { validateRuntimeWorkerAssignmentDecision } = require('./runtime-worker-assignment-decision');
const { validateRuntimeWorkerAssignmentResult } = require('./runtime-worker-assignment-result');
const { validateRuntimeWorkerAssignmentPackage } = require('./runtime-worker-assignment-package');
const { validateRuntimeSchedulerRequest } = require('./runtime-scheduler-request');
const { validateRuntimeSchedulerDecision } = require('./runtime-scheduler-decision');
const { validateRuntimeSchedulerResult } = require('./runtime-scheduler-result');
const { validateRuntimeSchedulerPackage } = require('./runtime-scheduler-package');
const { validateRuntimeExecutionPackage } = require('./runtime-execution-package');
const { validateRuntimeCapacitySnapshotReference } = require('./runtime-capacity-snapshot-reference');
const { validateRuntimeConcurrencyReference } = require('./runtime-concurrency-reference');
const { validateRuntimeBudgetSimulationReference } = require('./runtime-budget-simulation-reference');
const { validateRuntimeReadinessFreshnessReference } = require('./runtime-readiness-freshness-reference');
const { validateRuntimeReadinessReplayReference } = require('./runtime-readiness-replay-reference');
const { validateExecutionPlanIdempotency } = require('./execution-plan-idempotency');
const { validateExecutionRegistrySnapshotReference } = require('./execution-registry-snapshot-reference');
const { validateRuntimeWorkerReference } = require('./runtime-worker-reference');
const { validateRuntimeWorkerCapabilityReference } = require('./runtime-worker-capability-reference');
const { validateRuntimeWorkerCapacityReference } = require('./runtime-worker-capacity-reference');
const { validateRuntimeWorkerHealthReference } = require('./runtime-worker-health-reference');
const { validateRuntimeWorkerCompatibilityReference } = require('./runtime-worker-compatibility-reference');
const { validateRuntimeWorkerCandidateSetReference } = require('./runtime-worker-candidate-set-reference');
const { validateRuntimeWorkerStageAssignmentReference } = require('./runtime-worker-stage-assignment-reference');
const { validateRuntimeWorkerStagePolicyRequirementReference } = require('./runtime-worker-stage-policy-requirement-reference');
const { validateRuntimeSchedulerDependencyReference } = require('./runtime-scheduler-dependency-reference');
const { validateDestinationReference } = require('./transcription-network-permission-boundary');
const { validateSecretReference } = require('./transcription-secret-resolution-boundary');
const { validateRuntimeDispatchReplayReference } = require('./runtime-dispatch-replay-reference');

// pr107: aggregates every reference runtime-dispatch-boundary.js needs -- the already-
// WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION chain (Worker Assignment Request/Decision/Result/
// Package), the full Scheduler chain underneath it, the Runtime Execution Package, and every
// worker/compatibility/candidate-set/assignment/policy-requirement reference the Worker Assignment
// layer already produced -- reused verbatim, never re-derived independently. "Nenhuma decisão pode
// vir de context."
const RUNTIME_DISPATCH_REQUEST_VALIDATOR_VERSION = 'runtime_dispatch_request_validator_v1';

// pr107: `runtime_dispatch_replay_reference` genuinely belongs on the request (caller-supplied,
// cross-checked, never internally re-derived from a persisted history this simulation-only layer
// never keeps) -- the same "own Replay Reference lives on the request" shape every prior layer in
// this lineage already uses. "Se Dispatch Replay Reference causar circularidade, aplicar exclusão
// canônica apenas da própria replay reference" -- mirrors `omitReplayReference` already established
// in runtime-scheduler-boundary.js/runtime-worker-assignment-boundary.js: the request fingerprint
// omits only this one field, never trusts it unexcluded.
const RUNTIME_DISPATCH_REQUEST_FIELDS = Object.freeze([
  'runtime_dispatch_request_id', 'runtime_dispatch_request_version',
  'runtime_dispatch_policy',
  'runtime_worker_assignment_request_reference', 'runtime_worker_assignment_decision_reference',
  'runtime_worker_assignment_result_reference', 'runtime_worker_assignment_package_reference',
  'runtime_scheduler_request_reference', 'runtime_scheduler_decision_reference', 'runtime_scheduler_result_reference',
  'runtime_scheduler_package_reference',
  'runtime_execution_package_reference', 'runtime_capacity_snapshot_reference', 'runtime_concurrency_reference',
  'runtime_budget_reference', 'runtime_freshness_reference', 'runtime_replay_reference', 'idempotency_reference',
  'registry_snapshot_reference', 'runtime_dispatch_replay_reference',
  'runtime_worker_references', 'runtime_worker_capability_references', 'runtime_worker_capacity_references',
  'runtime_worker_health_references', 'runtime_worker_compatibility_references', 'runtime_worker_candidate_set_references',
  'runtime_worker_stage_assignment_references', 'runtime_worker_stage_policy_requirement_references',
  'network_permission_policy_references', 'secret_resolution_policy_references',
  // pr107fix FIX 2: the official RuntimeSchedulerDependencyReference objects (PR #105), reused
  // verbatim via their own validator -- required so the Dispatch Order boundary can prove
  // predecessor-before-target for every required dependency edge, instead of trusting the
  // Scheduler Result's own declared stage order.
  'runtime_scheduler_dependency_references',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_dispatch_registry_version',
  'simulation_context', 'validator_version'
]);

const SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_dispatch_policy', validateRuntimeDispatchPolicy],
  ['runtime_worker_assignment_request_reference', validateRuntimeWorkerAssignmentRequest],
  ['runtime_worker_assignment_decision_reference', validateRuntimeWorkerAssignmentDecision],
  ['runtime_worker_assignment_result_reference', validateRuntimeWorkerAssignmentResult],
  ['runtime_worker_assignment_package_reference', validateRuntimeWorkerAssignmentPackage],
  ['runtime_scheduler_request_reference', validateRuntimeSchedulerRequest],
  ['runtime_scheduler_decision_reference', validateRuntimeSchedulerDecision],
  ['runtime_scheduler_result_reference', validateRuntimeSchedulerResult],
  ['runtime_scheduler_package_reference', validateRuntimeSchedulerPackage],
  ['runtime_execution_package_reference', validateRuntimeExecutionPackage],
  ['runtime_capacity_snapshot_reference', validateRuntimeCapacitySnapshotReference],
  ['runtime_concurrency_reference', validateRuntimeConcurrencyReference],
  ['runtime_budget_reference', validateRuntimeBudgetSimulationReference],
  ['runtime_freshness_reference', validateRuntimeReadinessFreshnessReference],
  ['runtime_replay_reference', validateRuntimeReadinessReplayReference],
  ['idempotency_reference', validateExecutionPlanIdempotency],
  ['runtime_dispatch_replay_reference', validateRuntimeDispatchReplayReference]
]);

// registry_snapshot_reference is nullable -- "quando existentes" (pr106fix5's own shape, reused
// verbatim).
const NULLABLE_SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['registry_snapshot_reference', validateExecutionRegistrySnapshotReference]
]);

const LIST_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_worker_references', validateRuntimeWorkerReference],
  ['runtime_worker_capability_references', validateRuntimeWorkerCapabilityReference],
  ['runtime_worker_capacity_references', validateRuntimeWorkerCapacityReference],
  ['runtime_worker_health_references', validateRuntimeWorkerHealthReference],
  ['runtime_worker_compatibility_references', validateRuntimeWorkerCompatibilityReference],
  ['runtime_worker_candidate_set_references', validateRuntimeWorkerCandidateSetReference],
  ['runtime_worker_stage_assignment_references', validateRuntimeWorkerStageAssignmentReference],
  ['runtime_worker_stage_policy_requirement_references', validateRuntimeWorkerStagePolicyRequirementReference],
  ['network_permission_policy_references', validateDestinationReference],
  ['secret_resolution_policy_references', validateSecretReference],
  ['runtime_scheduler_dependency_references', validateRuntimeSchedulerDependencyReference]
]);

const MAX_LIST_ITEMS = 200;

// Mirrors runtime-scheduler-boundary.js's own omitReplayReference exactly, for this layer's own
// request field: `runtime_dispatch_replay_reference`.
function omitDispatchReplayReference(obj) {
  if (!isPlainObject(obj)) return obj;
  const { runtime_dispatch_replay_reference, ...rest } = obj;
  return rest;
}

function validateRuntimeDispatchRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_dispatch_request_must_be_object'] };
  exactFields(request, RUNTIME_DISPATCH_REQUEST_FIELDS, 'runtime_dispatch_request', errors);
  for (const field of ['runtime_dispatch_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_dispatch_request_version) || request.runtime_dispatch_request_version < 1) {
    errors.push('runtime_dispatch_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_dispatch_registry_version) || request.expected_dispatch_registry_version < 1) {
    errors.push('expected_dispatch_registry_version_invalid');
  }

  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  for (const [field, validator] of SINGLE_NESTED_REFERENCE_VALIDATORS) {
    const result = validator(request[field]);
    if (!result.valid) errors.push(`${field}_invalid::${result.errors.join('|')}`);
  }
  for (const [field, validator] of NULLABLE_SINGLE_NESTED_REFERENCE_VALIDATORS) {
    if (request[field] !== null) {
      const result = validator(request[field]);
      if (!result.valid) errors.push(`${field}_invalid::${result.errors.join('|')}`);
    }
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

  if (request.validator_version !== RUNTIME_DISPATCH_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchRequest(input = {}) {
  const request = {
    runtime_dispatch_request_id: input.runtime_dispatch_request_id,
    runtime_dispatch_request_version: Number.isInteger(input.runtime_dispatch_request_version) ? input.runtime_dispatch_request_version : 1,
    runtime_dispatch_policy: input.runtime_dispatch_policy,
    runtime_worker_assignment_request_reference: input.runtime_worker_assignment_request_reference,
    runtime_worker_assignment_decision_reference: input.runtime_worker_assignment_decision_reference,
    runtime_worker_assignment_result_reference: input.runtime_worker_assignment_result_reference,
    runtime_worker_assignment_package_reference: input.runtime_worker_assignment_package_reference,
    runtime_scheduler_request_reference: input.runtime_scheduler_request_reference,
    runtime_scheduler_decision_reference: input.runtime_scheduler_decision_reference,
    runtime_scheduler_result_reference: input.runtime_scheduler_result_reference,
    runtime_scheduler_package_reference: input.runtime_scheduler_package_reference,
    runtime_execution_package_reference: input.runtime_execution_package_reference,
    runtime_capacity_snapshot_reference: input.runtime_capacity_snapshot_reference,
    runtime_concurrency_reference: input.runtime_concurrency_reference,
    runtime_budget_reference: input.runtime_budget_reference,
    runtime_freshness_reference: input.runtime_freshness_reference,
    runtime_replay_reference: input.runtime_replay_reference,
    idempotency_reference: input.idempotency_reference,
    registry_snapshot_reference: input.registry_snapshot_reference === undefined ? null : input.registry_snapshot_reference,
    runtime_dispatch_replay_reference: input.runtime_dispatch_replay_reference,
    runtime_worker_references: Array.isArray(input.runtime_worker_references) ? input.runtime_worker_references : [],
    runtime_worker_capability_references: Array.isArray(input.runtime_worker_capability_references) ? input.runtime_worker_capability_references : [],
    runtime_worker_capacity_references: Array.isArray(input.runtime_worker_capacity_references) ? input.runtime_worker_capacity_references : [],
    runtime_worker_health_references: Array.isArray(input.runtime_worker_health_references) ? input.runtime_worker_health_references : [],
    runtime_worker_compatibility_references: Array.isArray(input.runtime_worker_compatibility_references) ? input.runtime_worker_compatibility_references : [],
    runtime_worker_candidate_set_references: Array.isArray(input.runtime_worker_candidate_set_references) ? input.runtime_worker_candidate_set_references : [],
    runtime_worker_stage_assignment_references: Array.isArray(input.runtime_worker_stage_assignment_references) ? input.runtime_worker_stage_assignment_references : [],
    runtime_worker_stage_policy_requirement_references: Array.isArray(input.runtime_worker_stage_policy_requirement_references) ? input.runtime_worker_stage_policy_requirement_references : [],
    network_permission_policy_references: Array.isArray(input.network_permission_policy_references) ? input.network_permission_policy_references : [],
    secret_resolution_policy_references: Array.isArray(input.secret_resolution_policy_references) ? input.secret_resolution_policy_references : [],
    runtime_scheduler_dependency_references: Array.isArray(input.runtime_scheduler_dependency_references) ? input.runtime_scheduler_dependency_references : [],
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_dispatch_registry_version: Number.isInteger(input.expected_dispatch_registry_version) ? input.expected_dispatch_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_DISPATCH_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeDispatchRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  LIST_NESTED_REFERENCE_VALIDATORS,
  MAX_LIST_ITEMS,
  NULLABLE_SINGLE_NESTED_REFERENCE_VALIDATORS,
  RUNTIME_DISPATCH_REQUEST_FIELDS,
  RUNTIME_DISPATCH_REQUEST_VALIDATOR_VERSION,
  SINGLE_NESTED_REFERENCE_VALIDATORS,
  buildRuntimeDispatchRequest,
  omitDispatchReplayReference,
  validateRuntimeDispatchRequest
};
