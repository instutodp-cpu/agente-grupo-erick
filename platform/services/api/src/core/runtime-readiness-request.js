'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeReadinessPolicy } = require('./runtime-readiness-policy');
const { validateRuntimeExecutionPackage } = require('./runtime-execution-package');
const { validateRuntimeExecutionSimulationDecision } = require('./runtime-execution-simulation-decision');
const { validateRuntimeExecutionSimulationResult } = require('./runtime-execution-simulation-result');
const { validateExecutionGatewayDecision } = require('./execution-gateway-decision');
const { validateExecutionGatewayResult } = require('./execution-gateway-result');
const { validateExecutionGatewayPackageReference } = require('./execution-gateway-package-reference');
const { validateExecutionPlanContract } = require('./execution-plan-contract');
const { validateExecutionPlanResult } = require('./execution-plan-result');
const { validateAuthorizationProvenanceReference } = require('./execution-authorization-provenance-reference');
const { validateAuthorizationScopeReference } = require('./execution-authorization-scope-reference');
const { validateExecutionRegistrySnapshotReference } = require('./execution-registry-snapshot-reference');
const { validateArchitectureGateEvidenceReference } = require('./architecture-gate-evidence-reference');
const { validateOrchestratorStageManifestReference } = require('./orchestrator-stage-manifest-reference');
const { validateExecutionPlanDependencyGraphReference } = require('./execution-plan-dependency-graph-reference');
const { validateExecutionReferenceBindingLedger } = require('./execution-reference-binding-ledger');
const { validateValidationLedger } = require('./validation-ledger');
const { validateExecutionPlanBudget } = require('./execution-plan-budget');
const { validateExecutionPlanIdempotency } = require('./execution-plan-idempotency');
const { validateRuntimeStageSimulationManifest } = require('./runtime-stage-simulation-manifest');
const { validateRuntimeDependencySimulationManifest } = require('./runtime-dependency-simulation-manifest');
const { validateRuntimeBudgetSimulationReference } = require('./runtime-budget-simulation-reference');
const { validateRuntimeStopSimulationReference } = require('./runtime-stop-simulation-reference');
const { validateRuntimeCompensationSimulationReference } = require('./runtime-compensation-simulation-reference');
const { validateRuntimeArtifactPlanReference } = require('./runtime-artifact-plan-reference');
const { validateRuntimeEventPlanReference } = require('./runtime-event-plan-reference');
const { validateRuntimeCapacitySnapshotReference } = require('./runtime-capacity-snapshot-reference');
const { validateRuntimeConcurrencyReference } = require('./runtime-concurrency-reference');
const { validateRuntimeReadinessFreshnessReference } = require('./runtime-readiness-freshness-reference');
const { validateRuntimeReadinessReplayReference } = require('./runtime-readiness-replay-reference');

// pr104: aggregates every reference Phase A (Readiness) of runtime-admission-boundary.js needs --
// the already-prepared PR #103 outputs (runtime_execution_package_reference/
// runtime_execution_simulation_decision_reference/runtime_execution_simulation_result_reference),
// every reference those outputs were themselves built from (so the boundary can independently
// recompute the package digest rather than trust the declared one), plus the 4 new PR #104
// references (capacity, concurrency, freshness, replay). Each nested reference is checked against
// its own real, already-existing validator -- never a parallel reimplementation. `context` is never
// read for any decision; this constructor never even accepts one.
const RUNTIME_READINESS_REQUEST_VALIDATOR_VERSION = 'runtime_readiness_request_validator_v1';

const RUNTIME_READINESS_REQUEST_FIELDS = Object.freeze([
  'runtime_readiness_request_id', 'runtime_readiness_request_version', 'runtime_readiness_policy',
  'runtime_execution_package_reference', 'runtime_execution_simulation_decision_reference',
  'runtime_execution_simulation_result_reference',
  'gateway_decision_reference', 'gateway_result_reference', 'gateway_package_reference',
  'execution_plan_reference', 'execution_plan_result_reference',
  'authorization_provenance_reference', 'authorization_scope_reference', 'registry_snapshot_reference',
  'architecture_gate_evidence_reference',
  'stage_manifest_reference', 'dependency_graph_reference', 'binding_ledger_reference', 'validation_ledger_reference',
  'execution_budget_reference', 'idempotency_reference',
  'runtime_stage_manifest_reference', 'runtime_dependency_manifest_reference', 'runtime_budget_reference',
  'runtime_stop_references', 'runtime_compensation_references', 'runtime_artifact_plan_reference',
  'runtime_event_plan_reference',
  'runtime_capacity_snapshot_reference', 'runtime_concurrency_reference', 'runtime_readiness_freshness_reference',
  'runtime_readiness_replay_reference',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_readiness_registry_version',
  'simulation_context', 'validator_version'
]);

const NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_readiness_policy', validateRuntimeReadinessPolicy],
  ['runtime_execution_package_reference', validateRuntimeExecutionPackage],
  ['runtime_execution_simulation_decision_reference', validateRuntimeExecutionSimulationDecision],
  ['runtime_execution_simulation_result_reference', validateRuntimeExecutionSimulationResult],
  ['gateway_decision_reference', validateExecutionGatewayDecision],
  ['gateway_result_reference', validateExecutionGatewayResult],
  ['gateway_package_reference', validateExecutionGatewayPackageReference],
  ['execution_plan_reference', validateExecutionPlanContract],
  ['execution_plan_result_reference', validateExecutionPlanResult],
  ['authorization_provenance_reference', validateAuthorizationProvenanceReference],
  ['authorization_scope_reference', validateAuthorizationScopeReference],
  ['registry_snapshot_reference', validateExecutionRegistrySnapshotReference],
  ['architecture_gate_evidence_reference', validateArchitectureGateEvidenceReference],
  ['stage_manifest_reference', validateOrchestratorStageManifestReference],
  ['dependency_graph_reference', validateExecutionPlanDependencyGraphReference],
  ['binding_ledger_reference', validateExecutionReferenceBindingLedger],
  ['validation_ledger_reference', validateValidationLedger],
  ['execution_budget_reference', validateExecutionPlanBudget],
  // pr104fix2 FIX #2: the real, official ExecutionPlanIdempotencyReference (PR #98) -- reused
  // verbatim, never a parallel contract -- that the Replay Reference's idempotency_reference_id/
  // idempotency_fingerprint fields must genuinely bind to (see runtime-admission-boundary.js's own
  // replay cross-check), rather than trusting the Replay Reference's own claim in isolation.
  ['idempotency_reference', validateExecutionPlanIdempotency],
  ['runtime_stage_manifest_reference', validateRuntimeStageSimulationManifest],
  ['runtime_dependency_manifest_reference', validateRuntimeDependencySimulationManifest],
  ['runtime_budget_reference', validateRuntimeBudgetSimulationReference],
  ['runtime_artifact_plan_reference', validateRuntimeArtifactPlanReference],
  ['runtime_event_plan_reference', validateRuntimeEventPlanReference],
  ['runtime_capacity_snapshot_reference', validateRuntimeCapacitySnapshotReference],
  ['runtime_concurrency_reference', validateRuntimeConcurrencyReference],
  ['runtime_readiness_freshness_reference', validateRuntimeReadinessFreshnessReference],
  ['runtime_readiness_replay_reference', validateRuntimeReadinessReplayReference]
]);

const MAX_LIST_ITEMS = 200;

function validateRuntimeReadinessRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_readiness_request_must_be_object'] };
  exactFields(request, RUNTIME_READINESS_REQUEST_FIELDS, 'runtime_readiness_request', errors);
  for (const field of ['runtime_readiness_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_readiness_request_version) || request.runtime_readiness_request_version < 1) {
    errors.push('runtime_readiness_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_readiness_registry_version) || request.expected_readiness_registry_version < 1) {
    errors.push('expected_readiness_registry_version_invalid');
  }

  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  for (const [field, validator] of NESTED_REFERENCE_VALIDATORS) {
    const result = validator(request[field]);
    if (!result.valid) errors.push(`${field}_invalid::${result.errors.join('|')}`);
  }

  if (!Array.isArray(request.runtime_stop_references) || request.runtime_stop_references.length > MAX_LIST_ITEMS) {
    errors.push('runtime_stop_references_invalid');
  } else {
    request.runtime_stop_references.forEach((reference, index) => {
      const result = validateRuntimeStopSimulationReference(reference);
      if (!result.valid) errors.push(`runtime_stop_references[${index}]_invalid::${result.errors.join('|')}`);
    });
  }
  if (!Array.isArray(request.runtime_compensation_references) || request.runtime_compensation_references.length > MAX_LIST_ITEMS) {
    errors.push('runtime_compensation_references_invalid');
  } else {
    request.runtime_compensation_references.forEach((reference, index) => {
      const result = validateRuntimeCompensationSimulationReference(reference);
      if (!result.valid) errors.push(`runtime_compensation_references[${index}]_invalid::${result.errors.join('|')}`);
    });
  }

  if (request.validator_version !== RUNTIME_READINESS_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Never mutates or re-derives any nested reference -- every one of them must already be a fully
// built, self-valid object before being handed to this constructor. Pure aggregation boundary; no
// decisory data is ever read from `context`.
function buildRuntimeReadinessRequest(input = {}) {
  const request = {
    runtime_readiness_request_id: input.runtime_readiness_request_id,
    runtime_readiness_request_version: Number.isInteger(input.runtime_readiness_request_version) ? input.runtime_readiness_request_version : 1,
    runtime_readiness_policy: input.runtime_readiness_policy,
    runtime_execution_package_reference: input.runtime_execution_package_reference,
    runtime_execution_simulation_decision_reference: input.runtime_execution_simulation_decision_reference,
    runtime_execution_simulation_result_reference: input.runtime_execution_simulation_result_reference,
    gateway_decision_reference: input.gateway_decision_reference,
    gateway_result_reference: input.gateway_result_reference,
    gateway_package_reference: input.gateway_package_reference,
    execution_plan_reference: input.execution_plan_reference,
    execution_plan_result_reference: input.execution_plan_result_reference,
    authorization_provenance_reference: input.authorization_provenance_reference,
    authorization_scope_reference: input.authorization_scope_reference,
    registry_snapshot_reference: input.registry_snapshot_reference,
    architecture_gate_evidence_reference: input.architecture_gate_evidence_reference,
    stage_manifest_reference: input.stage_manifest_reference,
    dependency_graph_reference: input.dependency_graph_reference,
    binding_ledger_reference: input.binding_ledger_reference,
    validation_ledger_reference: input.validation_ledger_reference,
    execution_budget_reference: input.execution_budget_reference,
    idempotency_reference: input.idempotency_reference,
    runtime_stage_manifest_reference: input.runtime_stage_manifest_reference,
    runtime_dependency_manifest_reference: input.runtime_dependency_manifest_reference,
    runtime_budget_reference: input.runtime_budget_reference,
    runtime_stop_references: Array.isArray(input.runtime_stop_references) ? input.runtime_stop_references : [],
    runtime_compensation_references: Array.isArray(input.runtime_compensation_references) ? input.runtime_compensation_references : [],
    runtime_artifact_plan_reference: input.runtime_artifact_plan_reference,
    runtime_event_plan_reference: input.runtime_event_plan_reference,
    runtime_capacity_snapshot_reference: input.runtime_capacity_snapshot_reference,
    runtime_concurrency_reference: input.runtime_concurrency_reference,
    runtime_readiness_freshness_reference: input.runtime_readiness_freshness_reference,
    runtime_readiness_replay_reference: input.runtime_readiness_replay_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_readiness_registry_version: Number.isInteger(input.expected_readiness_registry_version) ? input.expected_readiness_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_READINESS_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeReadinessRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_readiness_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  MAX_LIST_ITEMS,
  NESTED_REFERENCE_VALIDATORS,
  RUNTIME_READINESS_REQUEST_FIELDS,
  RUNTIME_READINESS_REQUEST_VALIDATOR_VERSION,
  buildRuntimeReadinessRequest,
  validateRuntimeReadinessRequest
};
