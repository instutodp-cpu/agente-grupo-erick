'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { PLAN_GENERATED_STATUSES: PLANNER_PLAN_GENERATED_STATUSES } = require('./orchestrator-planning-result');
const {
  validateExecutionPlanRequest, isAuthorizationDecisionReady
} = require('./execution-plan-request');
const {
  isOrchestratorDecisionReady, isEvidenceBundleReady
} = require('./execution-authorization-request');
const { computeTaskReferenceFingerprint } = require('./execution-authorization-task-reference');
const { STAGE_TYPES, buildExecutionPlanStage } = require('./execution-plan-stage');
const { buildExecutionPlanStageBinding } = require('./execution-plan-stage-binding');
const { analyzeExecutionPlanDependencies, buildExecutionPlanDependency } = require('./execution-plan-dependency');
const { DEPENDENCY_TYPES } = require('./orchestrator-plan-dependency');
const { EXECUTION_PLAN_STATUSES, buildExecutionPlanContract } = require('./execution-plan-contract');
const { buildExecutionPlanResult } = require('./execution-plan-result');
const { buildExecutionPlanAudit } = require('./execution-plan-audit');

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined || value === null ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

// PR #96's ReadinessEvidenceBundle bundle_status vocabulary only partially overlaps
// EXECUTION_PLAN_STATUSES; the rest translate to their closest semantic equivalent.
const EVIDENCE_BUNDLE_STATUS_TRANSLATION = Object.freeze({
  BUDGET_EVIDENCE_BLOCKED: 'BUDGET_BLOCKED',
  CONFLICT_EVIDENCE_BLOCKED: 'CONFLICT_BLOCKED'
});

function translateStatus(status, readyValue, translationMap) {
  if (status === readyValue) return null;
  if (EXECUTION_PLAN_STATUSES.includes(status)) return status;
  if (translationMap && translationMap[status]) return translationMap[status];
  return 'BLOCKED';
}

// Agent/project/session checks are null-tolerant: a reference whose own field is null is "not
// scoped" and is never checked against canonical -- the same pattern PR #95's own engine
// established for its minimal model/tool/workflow references. sessionField differs because the
// "full identity" references (decision/bundle/planning-result/plan/task) use
// session_reference_id, while the PR #94-shaped decision references (memory/context/model/
// tool/workflow) use session_id.
function checkBinding(reference, canonical, label, sessionField = 'session_reference_id') {
  if (!isPlainObject(reference)) return null;
  if (reference.tenant_id !== canonical.tenantId) return { status: 'TENANT_BLOCKED', reason: `${label}_tenant_mismatch` };
  if (reference.organization_id !== canonical.organizationId) return { status: 'ORGANIZATION_BLOCKED', reason: `${label}_organization_mismatch` };
  if (reference.agent_id !== null && reference.agent_id !== canonical.agentId) {
    return { status: 'VALIDATION_FAILED', reason: `${label}_agent_mismatch` };
  }
  if (reference.project_id !== null && canonical.projectId !== null && reference.project_id !== canonical.projectId) {
    return { status: 'PROJECT_BLOCKED', reason: `${label}_project_mismatch` };
  }
  if (reference[sessionField] !== null && canonical.sessionId !== null && reference[sessionField] !== canonical.sessionId) {
    return { status: 'SESSION_BLOCKED', reason: `${label}_session_mismatch` };
  }
  return null;
}

// Derives a uniform stage_type for every materialized stage from which plan-level references
// are actually present -- orchestration_plan_reference (PR #94/#95) carries only a flat
// ordered_stage_ids list, with no per-stage type breakdown, so this PR cannot recover a
// genuinely per-stage stage_type. See docs "Limitações".
function deriveStageType(modelRef, toolRefs, workflowRef, approvalStageIds, stageId) {
  if (Array.isArray(approvalStageIds) && approvalStageIds.includes(stageId)) return 'HUMAN_APPROVAL_STAGE';
  if (isPlainObject(modelRef) && modelRef.status === 'MODEL_SELECTED_SIMULATION') return 'MODEL_REFERENCE_STAGE';
  if (Array.isArray(toolRefs) && toolRefs.length > 0) return 'TOOL_REFERENCE_STAGE';
  if (isPlainObject(workflowRef) && workflowRef.status === 'WORKFLOW_REGISTERED_SIMULATION') return 'WORKFLOW_REFERENCE_STAGE';
  return 'DETERMINISTIC_STAGE';
}

// Derives side_effect_classification from data already present in the request as proper
// fingerprinted references (never a loose side-channel, per the lesson from PR #97's fix):
// task_reference's own external_side_effect_reference/irreversible_reference flags (always
// false while PR #97's own contract forces them so -- this path is correctly wired but
// unreachable today, see docs), and whether any compensation_references[] entry targets this
// stage and declares itself `required` (the caller's own declaration that the stage changes
// state) -- independent of whether that same entry's compensation_type is actually non-NONE,
// so a state-change stage with a NONE-typed compensation is still classified STATE_CHANGE_
// REFERENCE and can then correctly fail the separate "compensation covers it" check (step 23).
function deriveSideEffectClassification(taskRef, compensationReferences, stageId) {
  if (taskRef.external_side_effect_reference === true) return 'EXTERNAL_EFFECT_REFERENCE';
  if (taskRef.irreversible_reference === true) return 'IRREVERSIBLE_REFERENCE';
  const declaresStateChange = compensationReferences.some(
    (reference) => reference.execution_stage_id === stageId && (reference.required === true || reference.compensation_type !== 'NONE')
  );
  return declaresStateChange ? 'STATE_CHANGE_REFERENCE' : 'NONE';
}

function evaluateExecutionPlanRequest(request, context = {}) {
  // 1-2. request contract shape, including simulation_context as one of its own nested fields.
  const requestValidation = validateExecutionPlanRequest(request);
  if (!requestValidation.valid) {
    return buildOutcome(request, 'VALIDATION_FAILED', ['execution_plan_request_invalid'], context);
  }

  const authzRef = request.authorization_decision_reference;
  const decisionRef = request.orchestrator_decision_reference;
  const bundleRef = request.readiness_evidence_bundle_reference;
  const planningRef = request.planning_result_reference;
  const planRef = request.orchestration_plan_reference;
  const taskRef = request.task_reference;
  const memoryRef = request.memory_selection_reference;
  const contextRef = request.context_assembly_reference;
  const modelRef = request.model_selection_reference;
  const toolRefs = request.tool_decision_references;
  const workflowRef = request.workflow_decision_reference;
  const policy = request.execution_plan_policy_reference;
  const budget = request.execution_plan_budget;
  const idempotency = request.idempotency_policy_reference;
  const stopConditionRefs = request.stop_condition_references;
  const compensationRefs = request.compensation_references;
  const logicalSequence = request.logical_sequence;
  const executionPlanId = planRef.plan_id;

  // 3. autorização (PR #97).
  const authzTranslated = translateStatus(authzRef.status, 'AUTHORIZED_SIMULATION', null);
  if (authzTranslated) {
    return buildOutcome(request, authzTranslated === 'BLOCKED' ? 'AUTHORIZATION_BLOCKED' : authzTranslated, [`authorization_status::${authzRef.status}`], context);
  }
  if (!isAuthorizationDecisionReady(authzRef)) {
    return buildOutcome(request, 'VALIDATION_FAILED', ['authorization_decision_reference_inconsistent'], context);
  }

  // 4. decisão do Orchestrator (PR #95).
  const decisionTranslated = translateStatus(decisionRef.status, 'READY_SIMULATION', null);
  if (decisionTranslated) {
    return buildOutcome(request, decisionTranslated, [`orchestrator_decision_status::${decisionRef.status}`], context);
  }
  if (!isOrchestratorDecisionReady(decisionRef)) {
    return buildOutcome(request, 'VALIDATION_FAILED', ['orchestrator_decision_reference_inconsistent'], context);
  }

  // 5. evidence bundle (PR #96).
  const bundleTranslated = translateStatus(bundleRef.bundle_status, 'READY_EVIDENCE_SIMULATION', EVIDENCE_BUNDLE_STATUS_TRANSLATION);
  if (bundleTranslated) {
    return buildOutcome(request, bundleTranslated === 'BLOCKED' ? 'EVIDENCE_BLOCKED' : bundleTranslated, [`readiness_evidence_bundle_status::${bundleRef.bundle_status}`], context);
  }
  if (!isEvidenceBundleReady(bundleRef)) {
    return buildOutcome(request, 'VALIDATION_FAILED', ['readiness_evidence_bundle_reference_inconsistent'], context);
  }

  // 6. planning result (PR #94).
  if (!PLANNER_PLAN_GENERATED_STATUSES.includes(planningRef.status) || planningRef.plan_generated !== true || planningRef.policy_validated !== true) {
    return buildOutcome(request, 'BLOCKED', ['planning_result_not_ready'], context);
  }

  // 7-8. orchestration plan / task reference -- structural validity already confirmed in step
  // 1-2; consistency is checked below (bindings, plan/planning-result agreement, fingerprints).

  // 9-13. tenant / organização / projeto / sessão / agent, across every reference carrying them.
  const canonical = {
    tenantId: authzRef.tenant_id, organizationId: authzRef.organization_id, agentId: authzRef.agent_id,
    projectId: authzRef.project_id, sessionId: authzRef.session_reference_id
  };
  const bindingChecks = [
    ['orchestrator_decision_reference', decisionRef, 'session_reference_id'],
    ['readiness_evidence_bundle_reference', bundleRef, 'session_reference_id'],
    ['planning_result_reference', planningRef, 'session_reference_id'],
    ['orchestration_plan_reference', planRef, 'session_reference_id'],
    ['task_reference', taskRef, 'session_reference_id'],
    ['memory_selection_reference', memoryRef, 'session_id'],
    ['context_assembly_reference', contextRef, 'session_id'],
    ['model_selection_reference', modelRef, 'session_id'],
    ['workflow_decision_reference', workflowRef, 'session_id'],
    ...toolRefs.map((reference, index) => [`tool_decision_references[${index}]`, reference, 'session_id'])
  ];
  for (const [label, reference, sessionField] of bindingChecks) {
    const mismatch = checkBinding(reference, canonical, label, sessionField);
    if (mismatch) return buildOutcome(request, mismatch.status, [mismatch.reason], context);
  }

  // A hard decision=BLOCKED on any already-produced upstream reference (PR #94's own
  // memory/context/model/tool/workflow decisions) surfaces as this PR's own dedicated *_BLOCKED
  // status -- this PR never re-derives or re-selects any of them, only reads decision=BLOCKED.
  if (memoryRef.decision === 'BLOCKED') return buildOutcome(request, 'MEMORY_BLOCKED', ['memory_selection_reference_blocked'], context);
  if (contextRef.decision === 'BLOCKED') return buildOutcome(request, 'CONTEXT_BLOCKED', ['context_assembly_reference_blocked'], context);
  if (modelRef.decision === 'BLOCKED') return buildOutcome(request, 'MODEL_BLOCKED', ['model_selection_reference_blocked'], context);
  if (toolRefs.some((reference) => reference.decision === 'BLOCKED')) return buildOutcome(request, 'TOOL_BLOCKED', ['tool_decision_reference_blocked'], context);
  if (workflowRef.decision === 'BLOCKED') return buildOutcome(request, 'WORKFLOW_BLOCKED', ['workflow_decision_reference_blocked'], context);

  // 14. versão (side-channel, mirroring every prior PR's own registry-version check pattern).
  if (isNonEmptyString(context.currentRegistryVersion) && context.currentRegistryVersion !== request.expected_registry_version) {
    return buildOutcome(request, 'VERSION_BLOCKED', ['expected_registry_version_mismatch'], context);
  }

  // 15. fingerprints: plan_fingerprint agreement, plus task_reference tamper detection.
  if (planningRef.plan_fingerprint !== planRef.plan_fingerprint) {
    return buildOutcome(request, 'FINGERPRINT_BLOCKED', ['plan_fingerprint_mismatch_between_planning_result_and_plan_reference'], context);
  }
  if (computeTaskReferenceFingerprint(taskRef) !== taskRef.task_fingerprint) {
    return buildOutcome(request, 'FINGERPRINT_BLOCKED', ['task_reference_fingerprint_mismatch'], context);
  }
  if (planningRef.plan_id !== executionPlanId || taskRef.plan_id !== executionPlanId) {
    return buildOutcome(request, 'TASK_BLOCKED', ['task_reference_plan_id_mismatch'], context);
  }

  // 16. escopo autorizado -- this PR's request carries no standalone AuthorizationScope object
  // of its own (PR #97's AuthorizationScope never travels through ExecutionPlanRequest); the
  // tenant/organization/project/session/agent bindings already checked in steps 9-13 are what
  // this PR has available to represent "authorized scope." See docs "Limitações".

  // 17. orçamento.
  if (budget.budget_validated !== true) {
    return buildOutcome(request, 'BUDGET_BLOCKED', ['execution_plan_budget_not_validated'], context);
  }

  // 18. estágios.
  const stageIds = planRef.ordered_stage_ids;
  if (stageIds.length === 0) {
    return buildOutcome(request, 'BLOCKED', ['no_stages_declared'], context);
  }
  const stages = stageIds.map((stageId, index) => {
    const stageType = deriveStageType(modelRef, toolRefs, workflowRef, planningRef.approval_stage_ids, stageId);
    const sideEffect = deriveSideEffectClassification(taskRef, compensationRefs, stageId);
    return buildExecutionPlanStage({
      execution_stage_id: stageId, execution_plan_id: executionPlanId, source_orchestrator_stage_id: stageId,
      stage_sequence: index, stage_type: stageType, task_reference_id: taskRef.task_reference_id,
      agent_reference_id: canonical.agentId, memory_selection_reference_id: memoryRef.reference_id,
      context_assembly_reference_id: contextRef.reference_id,
      model_selection_reference_id: stageType === 'MODEL_REFERENCE_STAGE' ? modelRef.reference_id : null,
      tool_reference_ids: stageType === 'TOOL_REFERENCE_STAGE' ? toolRefs.map((r) => r.reference_id) : [],
      workflow_reference_id: stageType === 'WORKFLOW_REFERENCE_STAGE' ? workflowRef.reference_id : null,
      priority: index, parallelizable: false, optional: false,
      approval_required: stageType === 'HUMAN_APPROVAL_STAGE',
      side_effect_classification: sideEffect, risk_classification: taskRef.risk_classification,
      estimated_input_tokens: 0, estimated_output_tokens: 0, estimated_cost_minor_units: 0,
      maximum_attempts_reference: idempotency.maximum_execution_attempts, timeout_reference: null,
      stage_status: 'PREPARED_SIMULATION', logical_sequence: logicalSequence
    });
  });

  if (stages.some((stage) => stage.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE')) {
    return buildOutcome(request, 'BLOCKED', ['external_effect_not_allowed_in_this_pr'], context);
  }
  if (stages.some((stage) => stage.side_effect_classification === 'IRREVERSIBLE_REFERENCE')) {
    return buildOutcome(request, 'BLOCKED', ['irreversible_effect_not_allowed_in_this_pr'], context);
  }
  if (stages.some((stage) => stage.stage_type === 'MODEL_REFERENCE_STAGE') && policy.allow_model_stage !== true) {
    return buildOutcome(request, 'MODEL_BLOCKED', ['model_stage_not_allowed_by_policy'], context);
  }
  if (stages.every((stage) => stage.stage_type !== 'MODEL_REFERENCE_STAGE') && policy.allow_no_llm_stage !== true) {
    return buildOutcome(request, 'MODEL_BLOCKED', ['no_llm_stage_not_allowed_by_policy'], context);
  }
  if (stages.some((stage) => stage.stage_type === 'TOOL_REFERENCE_STAGE') && policy.allow_tool_stage !== true) {
    return buildOutcome(request, 'TOOL_BLOCKED', ['tool_stage_not_allowed_by_policy'], context);
  }
  if (stages.some((stage) => stage.stage_type === 'WORKFLOW_REFERENCE_STAGE') && policy.allow_workflow_stage !== true) {
    return buildOutcome(request, 'WORKFLOW_BLOCKED', ['workflow_stage_not_allowed_by_policy'], context);
  }

  // 19. bindings dos estágios: one binding per stage per reference type it actually uses, plus
  // an authorization/budget binding shared across the whole plan.
  const bindings = [];
  for (const stage of stages) {
    bindings.push(buildExecutionPlanStageBinding({
      binding_id: `${stage.execution_stage_id}-task-binding`, execution_plan_id: executionPlanId,
      execution_stage_id: stage.execution_stage_id, binding_type: 'TASK_BINDING', source_reference_id: taskRef.task_reference_id,
      source_reference_version: taskRef.task_reference_version, source_reference_fingerprint: taskRef.task_fingerprint,
      tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
      session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true, binding_validated: true
    }));
    bindings.push(buildExecutionPlanStageBinding({
      binding_id: `${stage.execution_stage_id}-agent-binding`, execution_plan_id: executionPlanId,
      execution_stage_id: stage.execution_stage_id, binding_type: 'AGENT_BINDING', source_reference_id: canonical.agentId,
      source_reference_version: 1, source_reference_fingerprint: safeFingerprint(canonical.agentId),
      tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
      session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true, binding_validated: true
    }));
    if (stage.stage_type === 'MODEL_REFERENCE_STAGE') {
      bindings.push(buildExecutionPlanStageBinding({
        binding_id: `${stage.execution_stage_id}-selection-binding`, execution_plan_id: executionPlanId,
        execution_stage_id: stage.execution_stage_id, binding_type: 'MODEL_BINDING', source_reference_id: modelRef.reference_id,
        source_reference_version: 1, source_reference_fingerprint: safeFingerprint(modelRef),
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
        binding_validated: modelRef.decision !== 'BLOCKED'
      }));
    }
    if (stage.stage_type === 'TOOL_REFERENCE_STAGE') {
      toolRefs.forEach((toolRef, toolIndex) => {
        bindings.push(buildExecutionPlanStageBinding({
          binding_id: `${stage.execution_stage_id}-tool-binding-${toolIndex}`, execution_plan_id: executionPlanId,
          execution_stage_id: stage.execution_stage_id, binding_type: 'TOOL_BINDING', source_reference_id: toolRef.reference_id,
          source_reference_version: 1, source_reference_fingerprint: safeFingerprint(toolRef),
          tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
          session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
          binding_validated: toolRef.decision !== 'BLOCKED'
        }));
      });
    }
    if (stage.stage_type === 'WORKFLOW_REFERENCE_STAGE') {
      bindings.push(buildExecutionPlanStageBinding({
        binding_id: `${stage.execution_stage_id}-workflow-binding`, execution_plan_id: executionPlanId,
        execution_stage_id: stage.execution_stage_id, binding_type: 'WORKFLOW_BINDING', source_reference_id: workflowRef.reference_id,
        source_reference_version: 1, source_reference_fingerprint: safeFingerprint(workflowRef),
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
        binding_validated: workflowRef.decision !== 'BLOCKED'
      }));
    }
  }
  bindings.push(buildExecutionPlanStageBinding({
    binding_id: `${executionPlanId}-authz-binding`, execution_plan_id: executionPlanId,
    execution_stage_id: stages[0].execution_stage_id, binding_type: 'AUTHORIZATION_BINDING',
    source_reference_id: authzRef.authorization_decision_id, source_reference_version: 1,
    source_reference_fingerprint: authzRef.authorization_decision_fingerprint, tenant_id: canonical.tenantId,
    organization_id: canonical.organizationId, project_id: canonical.projectId, session_reference_id: canonical.sessionId,
    agent_id: canonical.agentId, binding_required: true, binding_validated: true
  }));
  bindings.push(buildExecutionPlanStageBinding({
    binding_id: `${executionPlanId}-budget-binding`, execution_plan_id: executionPlanId,
    execution_stage_id: stages[0].execution_stage_id, binding_type: 'BUDGET_BINDING',
    source_reference_id: budget.execution_budget_id, source_reference_version: budget.execution_budget_version,
    source_reference_fingerprint: budget.budget_fingerprint, tenant_id: canonical.tenantId,
    organization_id: canonical.organizationId, project_id: canonical.projectId, session_reference_id: canonical.sessionId,
    agent_id: canonical.agentId, binding_required: true, binding_validated: budget.budget_validated === true
  }));

  if (policy.fail_on_binding_mismatch === true && bindings.some((binding) => binding.binding_validated !== true)) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['stage_binding_not_validated'], context);
  }
  // A selected reference id declared by the Planner (PR #94) that this request's own
  // model/tool/workflow references do not actually carry is a genuine binding mismatch, not a
  // *_BLOCKED status for the reference itself (which is otherwise structurally fine).
  if (
    planningRef.selected_model_reference_ids.length > 0 && stages.some((s) => s.stage_type === 'MODEL_REFERENCE_STAGE') &&
    !planningRef.selected_model_reference_ids.includes(modelRef.reference_id)
  ) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['selected_model_reference_id_not_bound'], context);
  }
  if (
    planningRef.selected_tool_reference_ids.length > 0 && stages.some((s) => s.stage_type === 'TOOL_REFERENCE_STAGE') &&
    planningRef.selected_tool_reference_ids.some((id) => !toolRefs.some((r) => r.reference_id === id))
  ) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['selected_tool_reference_id_not_bound'], context);
  }
  if (
    planningRef.selected_workflow_reference_ids.length > 0 && stages.some((s) => s.stage_type === 'WORKFLOW_REFERENCE_STAGE') &&
    !planningRef.selected_workflow_reference_ids.includes(workflowRef.reference_id)
  ) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['selected_workflow_reference_id_not_bound'], context);
  }

  // 20. dependências. orchestration_plan_reference only carries a flat dependency_ids list, no
  // edge shape, so a declarative dependencyRecords side-channel is required whenever
  // dependencies exist -- the same established pattern PR #95/#96 already use for this exact
  // structural gap (unlike risk classification, a graph shape does not fit a scalar reference
  // field, so this was not "fixed" the way PR #97's risk side-channel was).
  const dependencyRecords = Array.isArray(context.dependencyRecords) ? context.dependencyRecords : [];
  if (planRef.dependency_ids.length > 0 && dependencyRecords.length === 0) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_records_not_supplied'], context);
  }
  const analysis = analyzeExecutionPlanDependencies(dependencyRecords, stageIds);
  if (analysis.cycleDetected || analysis.selfDependencyDetected || analysis.missingReferenceDetected || analysis.duplicateDetected) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_graph_invalid'], context);
  }
  const parallelStageIds = new Set(dependencyRecords.filter((record) => record.dependency_type === 'PARALLEL_REFERENCE').flatMap((record) => [record.from_stage_id, record.to_stage_id]));
  if (parallelStageIds.size > 0 && policy.allow_parallel_stage !== true) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['parallel_stage_not_allowed_by_policy'], context);
  }
  const dependencies = dependencyRecords.map((record, index) => buildExecutionPlanDependency({
    dependency_id: `${executionPlanId}-dependency-${index}`, execution_plan_id: executionPlanId,
    from_stage_id: record.from_stage_id, to_stage_id: record.to_stage_id,
    dependency_type: DEPENDENCY_TYPES.includes(record.dependency_type) ? record.dependency_type : 'AFTER_SUCCESS_REFERENCE',
    required: record.required !== false, dependency_validated: true
  }));

  // 21. idempotência.
  if (policy.require_idempotency === true && idempotency.idempotency_validated !== true) {
    return buildOutcome(request, 'IDEMPOTENCY_BLOCKED', ['idempotency_not_validated'], context);
  }

  // 22. condições de parada.
  if (policy.require_stop_conditions === true && stopConditionRefs.length === 0) {
    return buildOutcome(request, 'STOP_CONDITION_BLOCKED', ['no_stop_conditions_declared'], context);
  }

  // 23. compensações declarativas: every STATE_CHANGE_REFERENCE stage needs at least one
  // non-NONE compensation reference targeting it.
  const stateChangeStages = stages.filter((stage) => stage.side_effect_classification === 'STATE_CHANGE_REFERENCE');
  for (const stage of stateChangeStages) {
    const covered = compensationRefs.some((reference) => reference.execution_stage_id === stage.execution_stage_id && reference.compensation_type !== 'NONE');
    if (!covered) {
      return buildOutcome(request, 'COMPENSATION_BLOCKED', ['state_change_stage_missing_compensation'], context);
    }
  }

  // approval: mirrors PR #95/#97's own WAITING_APPROVAL_SIMULATION-style pattern.
  if (planningRef.approval_stage_ids.length > 0) {
    return buildOutcome(request, 'WAITING_APPROVAL_REFERENCE', ['waiting_for_stage_approval_reference'], context, {
      stages, bindings, dependencies
    });
  }

  // 24-26. gerar execution plan, resultado, auditoria.
  return buildOutcome(request, 'EXECUTION_PLAN_PREPARED_SIMULATION', ['execution_plan_prepared_simulation_only'], context, {
    stages, bindings, dependencies
  });
}

function buildOutcome(request, status, reasonCodes, context, materialized) {
  const requestSafe = isPlainObject(request) ? request : {};
  const authzRef = isPlainObject(requestSafe.authorization_decision_reference) ? requestSafe.authorization_decision_reference : {};
  const decisionRef = isPlainObject(requestSafe.orchestrator_decision_reference) ? requestSafe.orchestrator_decision_reference : {};
  const bundleRef = isPlainObject(requestSafe.readiness_evidence_bundle_reference) ? requestSafe.readiness_evidence_bundle_reference : {};
  const planningRef = isPlainObject(requestSafe.planning_result_reference) ? requestSafe.planning_result_reference : {};
  const planRef = isPlainObject(requestSafe.orchestration_plan_reference) ? requestSafe.orchestration_plan_reference : {};
  const taskRef = isPlainObject(requestSafe.task_reference) ? requestSafe.task_reference : {};
  const memoryRef = isPlainObject(requestSafe.memory_selection_reference) ? requestSafe.memory_selection_reference : {};
  const contextRef = isPlainObject(requestSafe.context_assembly_reference) ? requestSafe.context_assembly_reference : {};
  const modelRef = isPlainObject(requestSafe.model_selection_reference) ? requestSafe.model_selection_reference : {};
  const toolRefs = Array.isArray(requestSafe.tool_decision_references) ? requestSafe.tool_decision_references : [];
  const workflowRef = isPlainObject(requestSafe.workflow_decision_reference) ? requestSafe.workflow_decision_reference : {};
  const budget = isPlainObject(requestSafe.execution_plan_budget) ? requestSafe.execution_plan_budget : {};
  const idempotency = isPlainObject(requestSafe.idempotency_policy_reference) ? requestSafe.idempotency_policy_reference : {};

  const logicalSequence = Number.isInteger(requestSafe.logical_sequence) ? requestSafe.logical_sequence : 0;
  const executionPlanId = planRef.plan_id || 'plan_not_available';
  const stages = materialized && Array.isArray(materialized.stages) ? materialized.stages : [];
  const bindings = materialized && Array.isArray(materialized.bindings) ? materialized.bindings : [];
  const dependencies = materialized && Array.isArray(materialized.dependencies) ? materialized.dependencies : [];
  const stopConditions = Array.isArray(requestSafe.stop_condition_references) ? requestSafe.stop_condition_references : [];
  const compensations = Array.isArray(requestSafe.compensation_references) ? requestSafe.compensation_references : [];

  const requestFingerprint = isPlainObject(request) ? safeFingerprint(request) : 'fingerprint_not_available';
  const executionPlanFingerprint = status === 'EXECUTION_PLAN_PREPARED_SIMULATION'
    ? safeFingerprint({ executionPlanId, stages: stages.map((s) => s.execution_stage_id) })
    : 'fingerprint_not_available';

  const plan = buildExecutionPlanContract({
    execution_plan_id: executionPlanId,
    execution_plan_status: status,
    authorization_decision_id: authzRef.authorization_decision_id || 'authorization_decision_not_available',
    orchestrator_decision_id: decisionRef.decision_result_id || 'orchestrator_decision_not_available',
    planning_result_id: planningRef.planning_result_id || 'planning_result_not_available',
    orchestration_plan_id: planRef.plan_id || 'orchestration_plan_not_available',
    task_reference_id: taskRef.task_reference_id || 'task_reference_not_available',
    agent_id: authzRef.agent_id || 'agent_not_available',
    tenant_id: authzRef.tenant_id || 'tenant_not_available',
    organization_id: authzRef.organization_id || 'organization_not_available',
    project_id: authzRef.project_id || 'project_not_available',
    session_reference_id: authzRef.session_reference_id || 'session_not_available',
    ordered_stage_ids: stages.map((s) => s.execution_stage_id),
    dependency_ids: dependencies.map((d) => d.dependency_id),
    stage_binding_ids: bindings.map((b) => b.binding_id),
    stop_condition_ids: stopConditions.map((c) => c.stop_condition_id),
    compensation_reference_ids: compensations.map((c) => c.compensation_reference_id),
    memory_selection_reference_id: memoryRef.reference_id || 'memory_selection_not_available',
    context_assembly_reference_id: contextRef.reference_id || 'context_assembly_not_available',
    model_selection_reference_id: modelRef.reference_id || null,
    tool_reference_ids: toolRefs.map((r) => r.reference_id),
    workflow_reference_id: workflowRef.reference_id || null,
    budget_reference_id: budget.execution_budget_id || 'execution_budget_not_available',
    idempotency_reference_id: idempotency.idempotency_reference_id || 'idempotency_reference_not_available',
    execution_scope_reference_id: executionPlanId,
    authorization_fingerprint: authzRef.authorization_decision_fingerprint || 'fingerprint_not_available',
    orchestrator_decision_fingerprint: decisionRef.decision_fingerprint || 'fingerprint_not_available',
    readiness_bundle_fingerprint: bundleRef.bundle_fingerprint || 'fingerprint_not_available',
    planning_result_fingerprint: planningRef.planning_result_fingerprint || 'fingerprint_not_available',
    orchestration_plan_fingerprint: planRef.plan_fingerprint || 'fingerprint_not_available',
    task_fingerprint: taskRef.task_fingerprint || 'fingerprint_not_available',
    memory_fingerprint: safeFingerprint(memoryRef),
    context_fingerprint: safeFingerprint(contextRef),
    model_fingerprint: isPlainObject(requestSafe.model_selection_reference) ? safeFingerprint(modelRef) : null,
    tool_fingerprints: toolRefs.map((r) => safeFingerprint(r)),
    workflow_fingerprint: isPlainObject(requestSafe.workflow_decision_reference) ? safeFingerprint(workflowRef) : null,
    budget_fingerprint: budget.budget_fingerprint || 'fingerprint_not_available',
    idempotency_fingerprint: idempotency.idempotency_fingerprint || 'fingerprint_not_available',
    plan_fingerprint: executionPlanFingerprint,
    logical_sequence: logicalSequence
  });

  const estimatedTotalTokens = stages.reduce((sum, s) => sum + s.estimated_total_tokens, 0);
  const estimatedTotalCost = stages.reduce((sum, s) => sum + s.estimated_cost_minor_units, 0);

  const result = buildExecutionPlanResult({
    result_id: `${requestSafe.execution_plan_request_id || 'execution_plan_request_not_available'}-result`,
    execution_plan_request_id: requestSafe.execution_plan_request_id,
    execution_plan_id: executionPlanId,
    authorization_decision_id: authzRef.authorization_decision_id,
    planning_result_id: planningRef.planning_result_id,
    orchestration_plan_id: planRef.plan_id,
    task_reference_id: taskRef.task_reference_id,
    agent_id: authzRef.agent_id,
    tenant_id: authzRef.tenant_id,
    organization_id: authzRef.organization_id,
    project_id: authzRef.project_id,
    session_reference_id: authzRef.session_reference_id,
    status,
    stage_ids: stages.map((s) => s.execution_stage_id),
    dependency_ids: dependencies.map((d) => d.dependency_id),
    binding_ids: bindings.map((b) => b.binding_id),
    stop_condition_ids: stopConditions.map((c) => c.stop_condition_id),
    compensation_reference_ids: compensations.map((c) => c.compensation_reference_id),
    request_fingerprint: requestFingerprint,
    authorization_fingerprint: authzRef.authorization_decision_fingerprint,
    evidence_bundle_fingerprint: bundleRef.bundle_fingerprint,
    planning_result_fingerprint: planningRef.planning_result_fingerprint,
    orchestration_plan_fingerprint: planRef.plan_fingerprint,
    task_fingerprint: taskRef.task_fingerprint,
    execution_plan_fingerprint: executionPlanFingerprint,
    registry_version: requestSafe.expected_registry_version,
    stage_count: stages.length,
    dependency_count: dependencies.length,
    binding_count: bindings.length,
    stop_condition_count: stopConditions.length,
    compensation_count: compensations.length,
    estimated_total_tokens: estimatedTotalTokens,
    estimated_total_cost_minor_units: estimatedTotalCost,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    request_validated: status !== 'VALIDATION_FAILED',
    authorization_validated: true,
    evidence_validated: true,
    bindings_validated: true,
    budget_validated: true,
    dependencies_validated: true,
    idempotency_validated: true,
    stop_conditions_validated: true,
    compensations_validated: true
  });

  const audit = buildExecutionPlanAudit({
    result, plan, stages, stopConditions, compensations, reasonCodes, logicalSequence
  });

  return { plan, result, audit };
}

module.exports = {
  evaluateExecutionPlanRequest
};
