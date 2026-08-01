'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeWorkerAssignmentPolicy } = require('./runtime-worker-assignment-policy');
const { validateRuntimeSchedulerRequest } = require('./runtime-scheduler-request');
const { validateRuntimeSchedulerDecision } = require('./runtime-scheduler-decision');
const { validateRuntimeSchedulerResult } = require('./runtime-scheduler-result');
const { validateRuntimeSchedulerPackage } = require('./runtime-scheduler-package');
const { validateRuntimeExecutionPackage } = require('./runtime-execution-package');
const { validateRuntimeStageSimulationManifest } = require('./runtime-stage-simulation-manifest');
const { validateRuntimeCapacitySnapshotReference } = require('./runtime-capacity-snapshot-reference');
const { validateRuntimeConcurrencyReference } = require('./runtime-concurrency-reference');
const { validateRuntimeReadinessFreshnessReference } = require('./runtime-readiness-freshness-reference');
const { validateRuntimeReadinessReplayReference } = require('./runtime-readiness-replay-reference');
const { validateExecutionPlanIdempotency } = require('./execution-plan-idempotency');
const { validateRuntimeWorkerReference } = require('./runtime-worker-reference');
const { validateRuntimeWorkerCapabilityReference } = require('./runtime-worker-capability-reference');
const { validateRuntimeWorkerCapacityReference } = require('./runtime-worker-capacity-reference');
const { validateRuntimeWorkerHealthReference } = require('./runtime-worker-health-reference');
const { validateRuntimeWorkerNetworkPolicyReference } = require('./runtime-worker-network-policy-reference');
const { validateRuntimeWorkerSecretPolicyReference } = require('./runtime-worker-secret-policy-reference');
// pr106fix2: the official, pre-existing Network Permission Boundary / Secret Resolution Boundary
// declarative policy contracts (PR #75/#76) -- reused verbatim, never duplicated.
const { validateDestinationReference } = require('./transcription-network-permission-boundary');
const { validateSecretReference } = require('./transcription-secret-resolution-boundary');
const { validateRuntimeWorkerStagePolicyRequirementReference } = require('./runtime-worker-stage-policy-requirement-reference');
// pr106fix4: the genuine upstream official contracts a Stage Policy Requirement's provenance must
// bind to -- reused verbatim via their own real validators, never a second self-declared source.
const { validateModelSelectionDecision } = require('./model-selection-decision');
const { validateToolContract } = require('./tool-contract');
const { validateWorkflowContract } = require('./workflow-contract');
// pr106fix5: the genuine, already-established Registry Snapshot contract a RESOLVED Stage Policy
// Requirement's `source_registry_snapshot_reference_id` must bind to -- reused verbatim, never a
// second self-declared snapshot.
const { validateExecutionRegistrySnapshotReference } = require('./execution-registry-snapshot-reference');

// pr106: aggregates every reference runtime-worker-assignment-boundary.js needs -- the already-
// SCHEDULER_PACKAGE_PREPARED_SIMULATION chain (Scheduler Request/Decision/Result/Package), the real
// Runtime Execution Package and Stage Manifest it schedules over, the same Capacity/Concurrency/
// Freshness/Replay/Idempotency references PR #104/#105 already established (reused verbatim, never
// re-invented), and the pool of synthetic Worker References (plus their own Capability/Capacity/
// Health sub-references) this evaluation considers. "Nenhuma decisão pode vir de context".
const RUNTIME_WORKER_ASSIGNMENT_REQUEST_VALIDATOR_VERSION = 'runtime_worker_assignment_request_validator_v1';

const RUNTIME_WORKER_ASSIGNMENT_REQUEST_FIELDS = Object.freeze([
  'runtime_worker_assignment_request_id', 'runtime_worker_assignment_request_version',
  'runtime_worker_assignment_policy',
  'runtime_scheduler_request_reference', 'runtime_scheduler_decision_reference', 'runtime_scheduler_result_reference',
  'runtime_scheduler_package_reference',
  'runtime_execution_package_reference', 'runtime_stage_manifest_reference',
  'runtime_capacity_snapshot_reference', 'runtime_concurrency_reference', 'runtime_freshness_reference',
  'runtime_replay_reference', 'idempotency_reference',
  'runtime_worker_references', 'runtime_worker_capability_references', 'runtime_worker_capacity_references',
  'runtime_worker_health_references', 'runtime_worker_network_policy_references', 'runtime_worker_secret_policy_references',
  'network_permission_policy_references', 'secret_resolution_policy_references',
  'stage_policy_requirement_references',
  'model_selection_decision_references', 'tool_contract_references', 'workflow_contract_references',
  'registry_snapshot_reference',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_worker_assignment_registry_version',
  'simulation_context', 'validator_version'
]);

const SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_worker_assignment_policy', validateRuntimeWorkerAssignmentPolicy],
  ['runtime_scheduler_request_reference', validateRuntimeSchedulerRequest],
  ['runtime_scheduler_decision_reference', validateRuntimeSchedulerDecision],
  ['runtime_scheduler_result_reference', validateRuntimeSchedulerResult],
  ['runtime_scheduler_package_reference', validateRuntimeSchedulerPackage],
  ['runtime_execution_package_reference', validateRuntimeExecutionPackage],
  ['runtime_stage_manifest_reference', validateRuntimeStageSimulationManifest],
  ['runtime_capacity_snapshot_reference', validateRuntimeCapacitySnapshotReference],
  ['runtime_concurrency_reference', validateRuntimeConcurrencyReference],
  ['runtime_freshness_reference', validateRuntimeReadinessFreshnessReference],
  ['runtime_replay_reference', validateRuntimeReadinessReplayReference],
  ['idempotency_reference', validateExecutionPlanIdempotency]
]);

// pr106fix5: "quando existentes" -- the only nullable single nested reference this request carries.
// `null` is a legitimate declaration (no genuine Registry Snapshot is available yet); when present it
// must still pass its own real validator, never a free-form object.
const NULLABLE_SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['registry_snapshot_reference', validateExecutionRegistrySnapshotReference]
]);

const LIST_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_worker_references', validateRuntimeWorkerReference],
  ['runtime_worker_capability_references', validateRuntimeWorkerCapabilityReference],
  ['runtime_worker_capacity_references', validateRuntimeWorkerCapacityReference],
  ['runtime_worker_health_references', validateRuntimeWorkerHealthReference],
  ['runtime_worker_network_policy_references', validateRuntimeWorkerNetworkPolicyReference],
  ['runtime_worker_secret_policy_references', validateRuntimeWorkerSecretPolicyReference],
  ['network_permission_policy_references', validateDestinationReference],
  ['secret_resolution_policy_references', validateSecretReference],
  ['stage_policy_requirement_references', validateRuntimeWorkerStagePolicyRequirementReference],
  ['model_selection_decision_references', validateModelSelectionDecision],
  ['tool_contract_references', validateToolContract],
  ['workflow_contract_references', validateWorkflowContract]
]);

const MAX_LIST_ITEMS = 200;

function validateRuntimeWorkerAssignmentRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_worker_assignment_request_must_be_object'] };
  exactFields(request, RUNTIME_WORKER_ASSIGNMENT_REQUEST_FIELDS, 'runtime_worker_assignment_request', errors);
  for (const field of ['runtime_worker_assignment_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_worker_assignment_request_version) || request.runtime_worker_assignment_request_version < 1) {
    errors.push('runtime_worker_assignment_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_worker_assignment_registry_version) || request.expected_worker_assignment_registry_version < 1) {
    errors.push('expected_worker_assignment_registry_version_invalid');
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

  if (request.validator_version !== RUNTIME_WORKER_ASSIGNMENT_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerAssignmentRequest(input = {}) {
  const request = {
    runtime_worker_assignment_request_id: input.runtime_worker_assignment_request_id,
    runtime_worker_assignment_request_version: Number.isInteger(input.runtime_worker_assignment_request_version) ? input.runtime_worker_assignment_request_version : 1,
    runtime_worker_assignment_policy: input.runtime_worker_assignment_policy,
    runtime_scheduler_request_reference: input.runtime_scheduler_request_reference,
    runtime_scheduler_decision_reference: input.runtime_scheduler_decision_reference,
    runtime_scheduler_result_reference: input.runtime_scheduler_result_reference,
    runtime_scheduler_package_reference: input.runtime_scheduler_package_reference,
    runtime_execution_package_reference: input.runtime_execution_package_reference,
    runtime_stage_manifest_reference: input.runtime_stage_manifest_reference,
    runtime_capacity_snapshot_reference: input.runtime_capacity_snapshot_reference,
    runtime_concurrency_reference: input.runtime_concurrency_reference,
    runtime_freshness_reference: input.runtime_freshness_reference,
    runtime_replay_reference: input.runtime_replay_reference,
    idempotency_reference: input.idempotency_reference,
    runtime_worker_references: Array.isArray(input.runtime_worker_references) ? input.runtime_worker_references : [],
    runtime_worker_capability_references: Array.isArray(input.runtime_worker_capability_references) ? input.runtime_worker_capability_references : [],
    runtime_worker_capacity_references: Array.isArray(input.runtime_worker_capacity_references) ? input.runtime_worker_capacity_references : [],
    runtime_worker_health_references: Array.isArray(input.runtime_worker_health_references) ? input.runtime_worker_health_references : [],
    runtime_worker_network_policy_references: Array.isArray(input.runtime_worker_network_policy_references) ? input.runtime_worker_network_policy_references : [],
    runtime_worker_secret_policy_references: Array.isArray(input.runtime_worker_secret_policy_references) ? input.runtime_worker_secret_policy_references : [],
    network_permission_policy_references: Array.isArray(input.network_permission_policy_references) ? input.network_permission_policy_references : [],
    secret_resolution_policy_references: Array.isArray(input.secret_resolution_policy_references) ? input.secret_resolution_policy_references : [],
    stage_policy_requirement_references: Array.isArray(input.stage_policy_requirement_references) ? input.stage_policy_requirement_references : [],
    model_selection_decision_references: Array.isArray(input.model_selection_decision_references) ? input.model_selection_decision_references : [],
    tool_contract_references: Array.isArray(input.tool_contract_references) ? input.tool_contract_references : [],
    workflow_contract_references: Array.isArray(input.workflow_contract_references) ? input.workflow_contract_references : [],
    registry_snapshot_reference: input.registry_snapshot_reference === undefined ? null : input.registry_snapshot_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_worker_assignment_registry_version: Number.isInteger(input.expected_worker_assignment_registry_version) ? input.expected_worker_assignment_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_WORKER_ASSIGNMENT_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeWorkerAssignmentRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_worker_assignment_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  LIST_NESTED_REFERENCE_VALIDATORS,
  MAX_LIST_ITEMS,
  NULLABLE_SINGLE_NESTED_REFERENCE_VALIDATORS,
  RUNTIME_WORKER_ASSIGNMENT_REQUEST_FIELDS,
  RUNTIME_WORKER_ASSIGNMENT_REQUEST_VALIDATOR_VERSION,
  SINGLE_NESTED_REFERENCE_VALIDATORS,
  buildRuntimeWorkerAssignmentRequest,
  validateRuntimeWorkerAssignmentRequest
};
