'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeQueueAdmissionPolicy } = require('./runtime-queue-admission-policy');
const { validateRuntimeDispatchRequest } = require('./runtime-dispatch-request');
const { validateRuntimeDispatchDecision } = require('./runtime-dispatch-decision');
const { validateRuntimeDispatchResult } = require('./runtime-dispatch-result');
const { validateRuntimeDispatchPackage } = require('./runtime-dispatch-package');
const { validateRuntimeDispatchStageReference } = require('./runtime-dispatch-stage-reference');
const { validateRuntimeDispatchWorkerBindingReference } = require('./runtime-dispatch-worker-binding-reference');
const { validateRuntimeDispatchDependencyGateReference } = require('./runtime-dispatch-dependency-gate-reference');
const { validateRuntimeDispatchApprovalGateReference } = require('./runtime-dispatch-approval-gate-reference');
const { validateRuntimeDispatchCapacityReference } = require('./runtime-dispatch-capacity-reference');
const { validateRuntimeDispatchBudgetReference } = require('./runtime-dispatch-budget-reference');
const { validateRuntimeDispatchPayloadReference } = require('./runtime-dispatch-payload-reference');
const { validateRuntimeDispatchIntentReference } = require('./runtime-dispatch-intent-reference');
const { validateRuntimeDispatchOrderReference } = require('./runtime-dispatch-order-reference');
const { validateRuntimeDispatchReplayReference } = require('./runtime-dispatch-replay-reference');
const { validateRuntimeQueueClassReference } = require('./runtime-queue-class-reference');
const { validateRuntimeQueueCapacitySnapshotReference } = require('./runtime-queue-capacity-snapshot-reference');
const { validateRuntimeQueueQuotaReference } = require('./runtime-queue-quota-reference');
const { validateRuntimeQueuePartitionReference } = require('./runtime-queue-partition-reference');
const { validateRuntimeCapacitySnapshotReference } = require('./runtime-capacity-snapshot-reference');
const { validateRuntimeConcurrencyReference } = require('./runtime-concurrency-reference');
const { validateRuntimeBudgetSimulationReference } = require('./runtime-budget-simulation-reference');
const { validateRuntimeReadinessFreshnessReference } = require('./runtime-readiness-freshness-reference');
const { validateExecutionPlanIdempotency } = require('./execution-plan-idempotency');
const { validateExecutionRegistrySnapshotReference } = require('./execution-registry-snapshot-reference');
const { validateDestinationReference } = require('./transcription-network-permission-boundary');
const { validateSecretReference } = require('./transcription-secret-resolution-boundary');
const { validateRuntimeWorkerStagePolicyRequirementReference } = require('./runtime-worker-stage-policy-requirement-reference');
const { validateRuntimeSchedulerDependencyReference } = require('./runtime-scheduler-dependency-reference');
const { validateRuntimeQueueAdmissionReplayReference } = require('./runtime-queue-admission-replay-reference');
// pr108fix FIX 1: the genuine official Model Selection Decision objects a RESOLVED MODEL Stage
// Policy Requirement's `source_reference_id`/`source_reference_fingerprint` must bind to -- the
// Dispatch layer never re-carries these forward (it only proves the Stage Policy Requirement
// fingerprint is unchanged), but Queue Class compatibility genuinely needs the real
// `selected_model_id`/`selected_provider_id`, which no fingerprint alone can recover.
const { validateModelSelectionDecision } = require('./model-selection-decision');

// pr108: aggregates every reference runtime-queue-admission-boundary.js needs -- the already-
// DISPATCH_PACKAGE_PREPARED_SIMULATION chain (Dispatch Request/Decision/Result/Package plus every
// per-stage reference the Dispatch layer produced), the declarative Queue Class/Capacity/Quota/
// Partition catalogs, and the same Capacity/Concurrency/Budget/Freshness/Idempotency/Registry
// Snapshot/official-policy/Stage-Policy-Requirement/Scheduler-Dependency references already
// established one layer below -- reused verbatim, never re-derived independently. "Nenhuma decisão
// pode vir de context."
const RUNTIME_QUEUE_ADMISSION_REQUEST_VALIDATOR_VERSION = 'runtime_queue_admission_request_validator_v1';

const RUNTIME_QUEUE_ADMISSION_REQUEST_FIELDS = Object.freeze([
  'runtime_queue_admission_request_id', 'runtime_queue_admission_request_version',
  'runtime_queue_admission_policy',
  'runtime_dispatch_request_reference', 'runtime_dispatch_decision_reference', 'runtime_dispatch_result_reference',
  'runtime_dispatch_package_reference',
  'runtime_dispatch_stage_references', 'runtime_dispatch_worker_binding_references',
  'runtime_dispatch_dependency_gate_references', 'runtime_dispatch_approval_gate_references',
  'runtime_dispatch_capacity_references', 'runtime_dispatch_budget_references', 'runtime_dispatch_payload_references',
  'runtime_dispatch_intent_references', 'runtime_dispatch_order_reference', 'runtime_dispatch_replay_reference',
  'runtime_queue_class_references', 'runtime_queue_capacity_snapshot_references', 'runtime_queue_quota_references',
  'runtime_queue_partition_references',
  'runtime_capacity_snapshot_reference', 'runtime_concurrency_reference', 'runtime_budget_reference',
  'runtime_freshness_reference', 'idempotency_reference', 'registry_snapshot_reference',
  'network_permission_policy_references', 'secret_resolution_policy_references',
  'runtime_worker_stage_policy_requirement_references', 'runtime_scheduler_dependency_references',
  'official_model_selection_decision_references',
  'runtime_queue_admission_replay_reference',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_queue_admission_registry_version',
  'simulation_context', 'validator_version'
]);

const SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_queue_admission_policy', validateRuntimeQueueAdmissionPolicy],
  ['runtime_dispatch_request_reference', validateRuntimeDispatchRequest],
  ['runtime_dispatch_decision_reference', validateRuntimeDispatchDecision],
  ['runtime_dispatch_result_reference', validateRuntimeDispatchResult],
  ['runtime_dispatch_package_reference', validateRuntimeDispatchPackage],
  ['runtime_dispatch_order_reference', validateRuntimeDispatchOrderReference],
  ['runtime_dispatch_replay_reference', validateRuntimeDispatchReplayReference],
  ['runtime_capacity_snapshot_reference', validateRuntimeCapacitySnapshotReference],
  ['runtime_concurrency_reference', validateRuntimeConcurrencyReference],
  ['runtime_budget_reference', validateRuntimeBudgetSimulationReference],
  ['runtime_freshness_reference', validateRuntimeReadinessFreshnessReference],
  ['idempotency_reference', validateExecutionPlanIdempotency],
  ['runtime_queue_admission_replay_reference', validateRuntimeQueueAdmissionReplayReference]
]);

// registry_snapshot_reference is nullable -- "quando existentes" (reused verbatim from PR #106fix5/
// PR #107).
const NULLABLE_SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['registry_snapshot_reference', validateExecutionRegistrySnapshotReference]
]);

const LIST_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_dispatch_stage_references', validateRuntimeDispatchStageReference],
  ['runtime_dispatch_worker_binding_references', validateRuntimeDispatchWorkerBindingReference],
  ['runtime_dispatch_dependency_gate_references', validateRuntimeDispatchDependencyGateReference],
  ['runtime_dispatch_approval_gate_references', validateRuntimeDispatchApprovalGateReference],
  ['runtime_dispatch_capacity_references', validateRuntimeDispatchCapacityReference],
  ['runtime_dispatch_budget_references', validateRuntimeDispatchBudgetReference],
  ['runtime_dispatch_payload_references', validateRuntimeDispatchPayloadReference],
  ['runtime_dispatch_intent_references', validateRuntimeDispatchIntentReference],
  ['runtime_queue_class_references', validateRuntimeQueueClassReference],
  ['runtime_queue_capacity_snapshot_references', validateRuntimeQueueCapacitySnapshotReference],
  ['runtime_queue_quota_references', validateRuntimeQueueQuotaReference],
  ['runtime_queue_partition_references', validateRuntimeQueuePartitionReference],
  ['network_permission_policy_references', validateDestinationReference],
  ['secret_resolution_policy_references', validateSecretReference],
  ['runtime_worker_stage_policy_requirement_references', validateRuntimeWorkerStagePolicyRequirementReference],
  ['runtime_scheduler_dependency_references', validateRuntimeSchedulerDependencyReference],
  ['official_model_selection_decision_references', validateModelSelectionDecision]
]);

const MAX_LIST_ITEMS = 200;

// Mirrors runtime-dispatch-request.js's own omitDispatchReplayReference exactly, for this layer's
// own request field: `runtime_queue_admission_replay_reference`. "Se Queue Admission Replay
// Reference causar circularidade, aplicar exclusão canônica apenas da própria replay reference."
function omitQueueAdmissionReplayReference(obj) {
  if (!isPlainObject(obj)) return obj;
  const { runtime_queue_admission_replay_reference, ...rest } = obj;
  return rest;
}

function validateRuntimeQueueAdmissionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_queue_admission_request_must_be_object'] };
  exactFields(request, RUNTIME_QUEUE_ADMISSION_REQUEST_FIELDS, 'runtime_queue_admission_request', errors);
  for (const field of ['runtime_queue_admission_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_queue_admission_request_version) || request.runtime_queue_admission_request_version < 1) {
    errors.push('runtime_queue_admission_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_queue_admission_registry_version) || request.expected_queue_admission_registry_version < 1) {
    errors.push('expected_queue_admission_registry_version_invalid');
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

  if (request.validator_version !== RUNTIME_QUEUE_ADMISSION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionRequest(input = {}) {
  const request = {
    runtime_queue_admission_request_id: input.runtime_queue_admission_request_id,
    runtime_queue_admission_request_version: Number.isInteger(input.runtime_queue_admission_request_version) ? input.runtime_queue_admission_request_version : 1,
    runtime_queue_admission_policy: input.runtime_queue_admission_policy,
    runtime_dispatch_request_reference: input.runtime_dispatch_request_reference,
    runtime_dispatch_decision_reference: input.runtime_dispatch_decision_reference,
    runtime_dispatch_result_reference: input.runtime_dispatch_result_reference,
    runtime_dispatch_package_reference: input.runtime_dispatch_package_reference,
    runtime_dispatch_stage_references: Array.isArray(input.runtime_dispatch_stage_references) ? input.runtime_dispatch_stage_references : [],
    runtime_dispatch_worker_binding_references: Array.isArray(input.runtime_dispatch_worker_binding_references) ? input.runtime_dispatch_worker_binding_references : [],
    runtime_dispatch_dependency_gate_references: Array.isArray(input.runtime_dispatch_dependency_gate_references) ? input.runtime_dispatch_dependency_gate_references : [],
    runtime_dispatch_approval_gate_references: Array.isArray(input.runtime_dispatch_approval_gate_references) ? input.runtime_dispatch_approval_gate_references : [],
    runtime_dispatch_capacity_references: Array.isArray(input.runtime_dispatch_capacity_references) ? input.runtime_dispatch_capacity_references : [],
    runtime_dispatch_budget_references: Array.isArray(input.runtime_dispatch_budget_references) ? input.runtime_dispatch_budget_references : [],
    runtime_dispatch_payload_references: Array.isArray(input.runtime_dispatch_payload_references) ? input.runtime_dispatch_payload_references : [],
    runtime_dispatch_intent_references: Array.isArray(input.runtime_dispatch_intent_references) ? input.runtime_dispatch_intent_references : [],
    runtime_dispatch_order_reference: input.runtime_dispatch_order_reference,
    runtime_dispatch_replay_reference: input.runtime_dispatch_replay_reference,
    runtime_queue_class_references: Array.isArray(input.runtime_queue_class_references) ? input.runtime_queue_class_references : [],
    runtime_queue_capacity_snapshot_references: Array.isArray(input.runtime_queue_capacity_snapshot_references) ? input.runtime_queue_capacity_snapshot_references : [],
    runtime_queue_quota_references: Array.isArray(input.runtime_queue_quota_references) ? input.runtime_queue_quota_references : [],
    runtime_queue_partition_references: Array.isArray(input.runtime_queue_partition_references) ? input.runtime_queue_partition_references : [],
    runtime_capacity_snapshot_reference: input.runtime_capacity_snapshot_reference,
    runtime_concurrency_reference: input.runtime_concurrency_reference,
    runtime_budget_reference: input.runtime_budget_reference,
    runtime_freshness_reference: input.runtime_freshness_reference,
    idempotency_reference: input.idempotency_reference,
    registry_snapshot_reference: input.registry_snapshot_reference === undefined ? null : input.registry_snapshot_reference,
    network_permission_policy_references: Array.isArray(input.network_permission_policy_references) ? input.network_permission_policy_references : [],
    secret_resolution_policy_references: Array.isArray(input.secret_resolution_policy_references) ? input.secret_resolution_policy_references : [],
    runtime_worker_stage_policy_requirement_references: Array.isArray(input.runtime_worker_stage_policy_requirement_references) ? input.runtime_worker_stage_policy_requirement_references : [],
    runtime_scheduler_dependency_references: Array.isArray(input.runtime_scheduler_dependency_references) ? input.runtime_scheduler_dependency_references : [],
    official_model_selection_decision_references: Array.isArray(input.official_model_selection_decision_references) ? input.official_model_selection_decision_references : [],
    runtime_queue_admission_replay_reference: input.runtime_queue_admission_replay_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_queue_admission_registry_version: Number.isInteger(input.expected_queue_admission_registry_version) ? input.expected_queue_admission_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_QUEUE_ADMISSION_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeQueueAdmissionRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_queue_admission_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  LIST_NESTED_REFERENCE_VALIDATORS,
  MAX_LIST_ITEMS,
  NULLABLE_SINGLE_NESTED_REFERENCE_VALIDATORS,
  RUNTIME_QUEUE_ADMISSION_REQUEST_FIELDS,
  RUNTIME_QUEUE_ADMISSION_REQUEST_VALIDATOR_VERSION,
  SINGLE_NESTED_REFERENCE_VALIDATORS,
  buildRuntimeQueueAdmissionRequest,
  omitQueueAdmissionReplayReference,
  validateRuntimeQueueAdmissionRequest
};
