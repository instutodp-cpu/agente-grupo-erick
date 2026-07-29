'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeExecutionSimulationPolicy } = require('./runtime-execution-simulation-policy');
const { validateExecutionGatewayDecision } = require('./execution-gateway-decision');
const { validateExecutionGatewayResult } = require('./execution-gateway-result');
const { validateExecutionGatewayPackageReference } = require('./execution-gateway-package-reference');
const { validateExecutionPlanContract } = require('./execution-plan-contract');
const { validateExecutionPlanResult } = require('./execution-plan-result');
const { validateOrchestratorStageManifestReference } = require('./orchestrator-stage-manifest-reference');
const { validateExecutionPlanDependencyGraphReference } = require('./execution-plan-dependency-graph-reference');
const { validateExecutionReferenceBindingLedger } = require('./execution-reference-binding-ledger');
const { validateValidationLedger } = require('./validation-ledger');
const { validateAuthorizationProvenanceReference } = require('./execution-authorization-provenance-reference');
const { validateAuthorizationScopeReference } = require('./execution-authorization-scope-reference');
const { validateExecutionRegistrySnapshotReference } = require('./execution-registry-snapshot-reference');
const { validateRuntimeStageSimulationManifest } = require('./runtime-stage-simulation-manifest');
const { validateRuntimeDependencySimulationManifest } = require('./runtime-dependency-simulation-manifest');
const { validateRuntimeBudgetSimulationReference } = require('./runtime-budget-simulation-reference');
const { validateRuntimeStopSimulationReference } = require('./runtime-stop-simulation-reference');
const { validateRuntimeCompensationSimulationReference } = require('./runtime-compensation-simulation-reference');
const { validateRuntimeArtifactPlanReference } = require('./runtime-artifact-plan-reference');
const { validateRuntimeEventPlanReference } = require('./runtime-event-plan-reference');
const { validateExecutionPlanBudget } = require('./execution-plan-budget');

const RUNTIME_EXECUTION_SIMULATION_REQUEST_VALIDATOR_VERSION = 'runtime_execution_simulation_request_validator_v1';

const RUNTIME_EXECUTION_SIMULATION_REQUEST_FIELDS = Object.freeze([
  'runtime_request_id', 'runtime_request_version', 'runtime_policy', 'gateway_decision_reference',
  'gateway_result_reference', 'gateway_package_reference', 'execution_plan_reference',
  'execution_plan_result_reference', 'stage_manifest_reference', 'dependency_graph_reference',
  'binding_ledger_reference', 'validation_ledger_reference', 'authorization_provenance_reference',
  'authorization_scope_reference', 'registry_snapshot_reference', 'runtime_stage_manifest_reference',
  'runtime_dependency_manifest_reference', 'runtime_budget_reference', 'execution_budget_reference',
  'runtime_stop_references', 'runtime_compensation_references', 'runtime_artifact_plan_reference',
  'runtime_event_plan_reference', 'correlation_id', 'causation_id', 'trace_id', 'logical_sequence',
  'expected_runtime_registry_version', 'simulation_context', 'validator_version'
]);

// Every single-object nested reference this request carries, and the real validator each one is
// checked against -- never a parallel, weaker re-implementation of any of these contracts. The two
// list fields (runtime_stop_references/runtime_compensation_references) are validated separately
// below since they are arrays, not single objects.
const NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_policy', validateRuntimeExecutionSimulationPolicy],
  ['gateway_decision_reference', validateExecutionGatewayDecision],
  ['gateway_result_reference', validateExecutionGatewayResult],
  ['gateway_package_reference', validateExecutionGatewayPackageReference],
  ['execution_plan_reference', validateExecutionPlanContract],
  ['execution_plan_result_reference', validateExecutionPlanResult],
  ['stage_manifest_reference', validateOrchestratorStageManifestReference],
  ['dependency_graph_reference', validateExecutionPlanDependencyGraphReference],
  ['binding_ledger_reference', validateExecutionReferenceBindingLedger],
  ['validation_ledger_reference', validateValidationLedger],
  ['authorization_provenance_reference', validateAuthorizationProvenanceReference],
  ['authorization_scope_reference', validateAuthorizationScopeReference],
  ['registry_snapshot_reference', validateExecutionRegistrySnapshotReference],
  ['runtime_stage_manifest_reference', validateRuntimeStageSimulationManifest],
  ['runtime_dependency_manifest_reference', validateRuntimeDependencySimulationManifest],
  ['runtime_budget_reference', validateRuntimeBudgetSimulationReference],
  // pr103fix: the real ExecutionPlanBudget (PR #98) this Runtime Budget claims to summarize --
  // "Usar o contrato e validator oficial já existente do Execution Plan Budget. Não criar um
  // contrato paralelo." Cross-checked field-by-field, and used to recompute
  // stage_counts_within_limit honestly, in evaluateRuntimeExecutionSimulationRequest.
  ['execution_budget_reference', validateExecutionPlanBudget],
  ['runtime_artifact_plan_reference', validateRuntimeArtifactPlanReference],
  ['runtime_event_plan_reference', validateRuntimeEventPlanReference]
]);

const MAX_LIST_ITEMS = 200;

function validateRuntimeExecutionSimulationRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_execution_simulation_request_must_be_object'] };
  exactFields(request, RUNTIME_EXECUTION_SIMULATION_REQUEST_FIELDS, 'runtime_execution_simulation_request', errors);
  for (const field of ['runtime_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_request_version) || request.runtime_request_version < 1) errors.push('runtime_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_runtime_registry_version) || request.expected_runtime_registry_version < 1) {
    errors.push('expected_runtime_registry_version_invalid');
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

  if (request.validator_version !== RUNTIME_EXECUTION_SIMULATION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Never mutates or re-derives any nested reference -- every one of them must already be a fully
// built, self-valid object before being handed to this constructor. This request is a pure
// aggregation boundary; simulation_context and every reference travel through unchanged. No
// decisory data is ever read from `context` -- this constructor never even accepts one.
function buildRuntimeExecutionSimulationRequest(input = {}) {
  const request = {
    runtime_request_id: input.runtime_request_id,
    runtime_request_version: Number.isInteger(input.runtime_request_version) ? input.runtime_request_version : 1,
    runtime_policy: input.runtime_policy,
    gateway_decision_reference: input.gateway_decision_reference,
    gateway_result_reference: input.gateway_result_reference,
    gateway_package_reference: input.gateway_package_reference,
    execution_plan_reference: input.execution_plan_reference,
    execution_plan_result_reference: input.execution_plan_result_reference,
    stage_manifest_reference: input.stage_manifest_reference,
    dependency_graph_reference: input.dependency_graph_reference,
    binding_ledger_reference: input.binding_ledger_reference,
    validation_ledger_reference: input.validation_ledger_reference,
    authorization_provenance_reference: input.authorization_provenance_reference,
    authorization_scope_reference: input.authorization_scope_reference,
    registry_snapshot_reference: input.registry_snapshot_reference,
    runtime_stage_manifest_reference: input.runtime_stage_manifest_reference,
    runtime_dependency_manifest_reference: input.runtime_dependency_manifest_reference,
    runtime_budget_reference: input.runtime_budget_reference,
    execution_budget_reference: input.execution_budget_reference,
    runtime_stop_references: Array.isArray(input.runtime_stop_references) ? input.runtime_stop_references : [],
    runtime_compensation_references: Array.isArray(input.runtime_compensation_references) ? input.runtime_compensation_references : [],
    runtime_artifact_plan_reference: input.runtime_artifact_plan_reference,
    runtime_event_plan_reference: input.runtime_event_plan_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_runtime_registry_version: Number.isInteger(input.expected_runtime_registry_version) ? input.expected_runtime_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_EXECUTION_SIMULATION_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeExecutionSimulationRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_execution_simulation_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  MAX_LIST_ITEMS,
  NESTED_REFERENCE_VALIDATORS,
  RUNTIME_EXECUTION_SIMULATION_REQUEST_FIELDS,
  RUNTIME_EXECUTION_SIMULATION_REQUEST_VALIDATOR_VERSION,
  buildRuntimeExecutionSimulationRequest,
  validateRuntimeExecutionSimulationRequest
};
