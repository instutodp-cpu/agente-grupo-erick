'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeExecutionSimulationRequest
// bundle on top of PR #102's own golden ExecutionGatewayRequest bundle -- every runtime_* nested
// reference materialized 1:1 from the Gateway's already-accepted stage manifest / dependency graph
// / binding ledger, exactly the way execution-plan-engine.js itself derives per-stage
// side_effect_classification/risk_classification from task_reference + compensation_references.
const { buildGoldenBundle, evaluateExecutionGatewayRequest } = require('./execution-gateway-test-data');
const { buildRuntimeExecutionSimulationPolicy } = require('../../src/core/runtime-execution-simulation-policy');
const { buildRuntimeExecutionSimulationRequest } = require('../../src/core/runtime-execution-simulation-request');
const { buildRuntimeStageSimulationReference } = require('../../src/core/runtime-stage-simulation-reference');
const { buildRuntimeStageSimulationManifest } = require('../../src/core/runtime-stage-simulation-manifest');
const { buildRuntimeDependencySimulationReference } = require('../../src/core/runtime-dependency-simulation-reference');
const { buildRuntimeDependencySimulationManifest } = require('../../src/core/runtime-dependency-simulation-manifest');
const { buildRuntimeBudgetSimulationReference } = require('../../src/core/runtime-budget-simulation-reference');
const { buildRuntimeStopSimulationReference } = require('../../src/core/runtime-stop-simulation-reference');
const { buildRuntimeCompensationSimulationReference } = require('../../src/core/runtime-compensation-simulation-reference');
const { buildRuntimeArtifactPlanReference } = require('../../src/core/runtime-artifact-plan-reference');
const { buildRuntimeEventPlanReference } = require('../../src/core/runtime-event-plan-reference');
const { evaluateRuntimeExecutionSimulationRequest } = require('../../src/core/runtime-execution-package');

const planFixture = require('../fixtures/hermes-execution-plan-contracts.json');

// Mirrors execution-plan-engine.js's own private deriveSideEffectClassification exactly (not
// exported by that module) -- the only source of a per-stage side_effect_classification is the
// plan REQUEST's own task_reference + compensation_references, never exposed downstream of the
// engine's output, so this test helper re-derives it the same way the engine itself would have.
function deriveSideEffectClassification(taskRef, compensationReferences, stageId) {
  if (taskRef.external_side_effect_reference === true) return 'EXTERNAL_EFFECT_REFERENCE';
  if (taskRef.irreversible_reference === true) return 'IRREVERSIBLE_REFERENCE';
  const declaresStateChange = compensationReferences.some(
    (reference) => reference.execution_stage_id === stageId && (reference.required === true || reference.compensation_type !== 'NONE')
  );
  return declaresStateChange ? 'STATE_CHANGE_REFERENCE' : 'NONE';
}

function buildGoldenRuntimeBundle(scenarioKey = 'prepared-no-llm-plan') {
  const gwGolden = buildGoldenBundle(scenarioKey);
  const gwOutcome = evaluateExecutionGatewayRequest(gwGolden.gatewayRequest, {});
  if (gwOutcome.decision.status !== 'GATEWAY_ACCEPTED_SIMULATION') {
    throw new Error(`golden gateway bundle for ${scenarioKey} did not reach GATEWAY_ACCEPTED_SIMULATION: ${gwOutcome.decision.status}`);
  }
  const gatewayDecision = gwOutcome.decision;
  const gatewayResult = gwOutcome.result;

  const planRequest = planFixture.scenarios[scenarioKey].request;
  const taskRef = planRequest.task_reference || {};
  const sourceStopConditions = planRequest.stop_condition_references || [];
  const sourceCompensationReferences = planRequest.compensation_references || [];
  const executionPlanBudget = planRequest.execution_plan_budget;

  const plan = gwGolden.plan;
  const result = gwGolden.result;
  const stageManifestRef = gwGolden.stageManifestReference;
  const dependencyGraphRef = gwGolden.dependencyGraphReference;
  const bindingLedger = gwGolden.bindingLedger;
  const validationLedger = gwGolden.validationLedger;
  const provenanceRef = gwGolden.provenanceReference;
  const scopeRef = gwGolden.scopeReference;
  const snapshotRef = gwGolden.snapshotReference;
  const gatewayPackageRef = gwGolden.packageReference;

  // 'rt-request' rather than '-runtime-request' -- AGENT_CORE_FORBIDDEN_VALUE_PATTERN's \bruntime\b
  // matches a hyphen-bounded "runtime" token even though it never matches the underscore-joined
  // form (see the identical 'eval-found' -> 'eval_found_in_module' fix in PR #102's own fixtures).
  const runtimeRequestId = `${plan.execution_plan_id}-rt-request`;
  const runtimeExecutionPackageId = `${runtimeRequestId}-package`;

  const stageIdByOrchestratorId = new Map(stageManifestRef.stage_records.map((record, index) => [record.stage_id, `${runtimeRequestId}-stage-${index}`]));

  const runtimeStopRefs = sourceStopConditions.map((condition, index) => buildRuntimeStopSimulationReference({
    runtime_stop_reference_id: `${runtimeRequestId}-stop-${index}`,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    runtime_stage_reference_id: stageIdByOrchestratorId.get(condition.execution_stage_id),
    source_stop_condition_id: condition.stop_condition_id,
    condition_type: condition.condition_type,
    condition_priority: condition.condition_priority,
    blocking: condition.blocking,
    terminal: condition.terminal,
    evaluation_reference_id: condition.evaluation_reference_id,
    stop_validated: true
  }));

  const runtimeCompensationRefs = sourceCompensationReferences.map((reference, index) => buildRuntimeCompensationSimulationReference({
    runtime_compensation_reference_id: `${runtimeRequestId}-compensation-${index}`,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    runtime_stage_reference_id: stageIdByOrchestratorId.get(reference.execution_stage_id),
    source_compensation_reference_id: reference.compensation_reference_id,
    compensation_type: reference.compensation_type,
    required: reference.required,
    trigger_reference_types: reference.trigger_reference_types,
    human_review_required: reference.human_review_required,
    compensation_validated: true
  }));

  const runtimeStageReferences = stageManifestRef.stage_records.map((record, index) => {
    const runtimeStageId = `${runtimeRequestId}-stage-${index}`;
    const stopIds = runtimeStopRefs.filter((s) => s.runtime_stage_reference_id === runtimeStageId).map((s) => s.runtime_stop_reference_id);
    const compensationIds = runtimeCompensationRefs.filter((c) => c.runtime_stage_reference_id === runtimeStageId).map((c) => c.runtime_compensation_reference_id);
    const bindingIds = (bindingLedger.binding_records || []).filter((b) => b.execution_stage_id === record.stage_id).map((b) => b.binding_record_id);
    return buildRuntimeStageSimulationReference({
      runtime_stage_reference_id: runtimeStageId,
      runtime_request_id: runtimeRequestId,
      runtime_execution_package_id: runtimeExecutionPackageId,
      execution_plan_id: plan.execution_plan_id,
      source_execution_stage_id: record.stage_id,
      source_orchestrator_stage_id: record.stage_id,
      stage_sequence: record.stage_sequence,
      stage_type: record.stage_type,
      task_reference_id: record.task_reference_id,
      agent_reference_id: record.agent_reference_id,
      memory_selection_reference_id: record.memory_selection_reference_id,
      context_assembly_reference_id: record.context_assembly_reference_id,
      model_selection_reference_id: record.model_selection_reference_id,
      tool_reference_ids: record.tool_reference_ids,
      workflow_reference_id: record.workflow_reference_id,
      dependency_reference_ids: record.dependency_reference_ids,
      binding_reference_ids: bindingIds,
      stop_reference_ids: stopIds,
      compensation_reference_ids: compensationIds,
      required_capabilities: record.required_capabilities,
      required_modalities: record.required_modalities,
      priority: record.priority,
      parallelizable: record.parallelizable,
      optional: record.optional,
      approval_required: record.approval_required,
      side_effect_classification: deriveSideEffectClassification(taskRef, sourceCompensationReferences, record.stage_id),
      risk_classification: taskRef.risk_classification,
      estimated_input_tokens: record.estimated_input_tokens,
      estimated_output_tokens: record.estimated_output_tokens,
      estimated_total_tokens: record.estimated_total_tokens,
      estimated_cost_minor_units: record.estimated_cost_minor_units,
      stage_state: 'RUNTIME_STAGE_PREPARED_SIMULATION'
    });
  });

  const runtimeStageManifest = buildRuntimeStageSimulationManifest({
    runtime_stage_manifest_id: `${runtimeRequestId}-stage-manifest`,
    runtime_request_id: runtimeRequestId,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    stage_manifest_reference_id: stageManifestRef.stage_manifest_reference_id,
    stage_manifest_fingerprint: stageManifestRef.manifest_fingerprint,
    runtime_stage_references: runtimeStageReferences
  });

  const runtimeDependencyReferences = dependencyGraphRef.dependency_records.map((record, index) => buildRuntimeDependencySimulationReference({
    runtime_dependency_reference_id: `${runtimeRequestId}-dependency-${index}`,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    source_dependency_id: record.dependency_id,
    from_runtime_stage_id: stageIdByOrchestratorId.get(record.from_stage_id),
    to_runtime_stage_id: stageIdByOrchestratorId.get(record.to_stage_id),
    dependency_type: record.dependency_type,
    required: record.required,
    dependency_validated: true
  }));

  const runtimeDependencyManifest = buildRuntimeDependencySimulationManifest({
    runtime_dependency_manifest_id: `${runtimeRequestId}-dependency-manifest`,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    dependency_graph_reference_id: dependencyGraphRef.dependency_graph_reference_id,
    dependency_graph_fingerprint: dependencyGraphRef.graph_fingerprint,
    runtime_dependency_references: runtimeDependencyReferences
  }, { knownStageIds: new Set(runtimeStageReferences.map((s) => s.runtime_stage_reference_id)) });

  const stageCountsWithinLimit = runtimeStageManifest.model_stage_count <= executionPlanBudget.maximum_model_stages
    && runtimeStageManifest.tool_stage_count <= executionPlanBudget.maximum_tool_stages
    && runtimeStageManifest.workflow_stage_count <= executionPlanBudget.maximum_workflow_stages
    && runtimeStageManifest.parallel_stage_count <= executionPlanBudget.maximum_parallel_stages;

  const runtimeBudgetReference = buildRuntimeBudgetSimulationReference({
    runtime_budget_reference_id: `${runtimeRequestId}-budget`,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    execution_budget_id: executionPlanBudget.execution_budget_id,
    budget_authorization_id: executionPlanBudget.budget_authorization_id,
    maximum_total_tokens: executionPlanBudget.maximum_total_tokens,
    estimated_total_tokens: runtimeStageManifest.estimated_total_tokens,
    maximum_input_tokens: executionPlanBudget.maximum_input_tokens,
    estimated_input_tokens: runtimeStageManifest.estimated_input_tokens,
    maximum_output_tokens: executionPlanBudget.maximum_output_tokens,
    estimated_output_tokens: runtimeStageManifest.estimated_output_tokens,
    maximum_total_cost_minor_units: executionPlanBudget.maximum_total_cost_minor_units,
    estimated_total_cost_minor_units: runtimeStageManifest.estimated_total_cost_minor_units,
    reserved_memory_tokens: executionPlanBudget.reserved_memory_tokens,
    reserved_context_tokens: executionPlanBudget.reserved_context_tokens,
    reserved_output_tokens: executionPlanBudget.reserved_output_tokens,
    model_stage_count: runtimeStageManifest.model_stage_count,
    tool_stage_count: runtimeStageManifest.tool_stage_count,
    workflow_stage_count: runtimeStageManifest.workflow_stage_count,
    parallel_stage_count: runtimeStageManifest.parallel_stage_count,
    stage_counts_within_limit: stageCountsWithinLimit
  });

  const runtimeArtifactPlan = buildRuntimeArtifactPlanReference({
    runtime_artifact_plan_reference_id: `${runtimeRequestId}-artifact-plan`,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    planned_artifact_ids: [`${runtimeRequestId}-audit-artifact`],
    planned_artifact_types: ['AUDIT_ARTIFACT_REFERENCE'],
    artifact_plan_validated: true
  });

  const runtimeEventPlan = buildRuntimeEventPlanReference({
    runtime_event_plan_reference_id: `${runtimeRequestId}-event-plan`,
    runtime_execution_package_id: runtimeExecutionPackageId,
    execution_plan_id: plan.execution_plan_id,
    planned_event_ids: [`${runtimeRequestId}-package-prepared-event`],
    planned_event_types: ['RUNTIME_PACKAGE_PREPARED_REFERENCE'],
    event_plan_validated: true
  });

  const runtimePolicy = buildRuntimeExecutionSimulationPolicy({ runtime_policy_id: `${runtimeRequestId}-policy` });

  const runtimeRequest = buildRuntimeExecutionSimulationRequest({
    runtime_request_id: runtimeRequestId,
    runtime_policy: runtimePolicy,
    gateway_decision_reference: gatewayDecision,
    gateway_result_reference: gatewayResult,
    gateway_package_reference: gatewayPackageRef,
    execution_plan_reference: plan,
    execution_plan_result_reference: result,
    stage_manifest_reference: stageManifestRef,
    dependency_graph_reference: dependencyGraphRef,
    binding_ledger_reference: bindingLedger,
    validation_ledger_reference: validationLedger,
    authorization_provenance_reference: provenanceRef,
    authorization_scope_reference: scopeRef,
    registry_snapshot_reference: snapshotRef,
    runtime_stage_manifest_reference: runtimeStageManifest,
    runtime_dependency_manifest_reference: runtimeDependencyManifest,
    runtime_budget_reference: runtimeBudgetReference,
    runtime_stop_references: runtimeStopRefs,
    runtime_compensation_references: runtimeCompensationRefs,
    runtime_artifact_plan_reference: runtimeArtifactPlan,
    runtime_event_plan_reference: runtimeEventPlan,
    correlation_id: 'corr-1',
    causation_id: 'cause-1',
    trace_id: 'trace-1',
    logical_sequence: 0,
    expected_runtime_registry_version: 1,
    simulation_context: gwGolden.gatewayRequest.simulation_context
  });

  return {
    ...gwGolden,
    gatewayDecision,
    gatewayResult,
    runtimeRequestId,
    runtimeExecutionPackageId,
    stageIdByOrchestratorId,
    runtimeStageReferences,
    runtimeStageManifest,
    runtimeDependencyReferences,
    runtimeDependencyManifest,
    runtimeBudgetReference,
    runtimeStopRefs,
    runtimeCompensationRefs,
    runtimeArtifactPlan,
    runtimeEventPlan,
    runtimePolicy,
    runtimeRequest
  };
}

module.exports = {
  buildGoldenRuntimeBundle,
  deriveSideEffectClassification,
  evaluateRuntimeExecutionSimulationRequest
};
