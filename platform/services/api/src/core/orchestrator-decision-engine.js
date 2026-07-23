'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { validateOrchestratorDecisionRequest } = require('./orchestrator-decision-request');
const { PLAN_GENERATED_STATUSES: PLANNER_PLAN_GENERATED_STATUSES } = require('./orchestrator-planning-result');
const { hasDependencyCycle } = require('./orchestrator-plan-dependency');
const { buildOrchestratorBlocker } = require('./orchestrator-blocker');
const { buildOrchestratorReadiness } = require('./orchestrator-readiness');
const { RESULT_STATUSES, buildOrchestratorDecisionResult } = require('./orchestrator-decision-result');
const { buildOrchestratorDecisionAudit } = require('./orchestrator-decision-audit');

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

// PR #94's PlanningResult and PR #95's DecisionResult intentionally share most *_BLOCKED
// status names (see docs) so a Planner-level block can be passed through 1:1 without the
// Decision Engine re-deriving anything -- it only translates the one name that differs.
function translatePlannerBlockedStatus(plannerStatus) {
  if (plannerStatus === 'MODEL_SELECTION_BLOCKED') return 'MODEL_BLOCKED';
  if (RESULT_STATUSES.includes(plannerStatus)) return plannerStatus;
  return 'VALIDATION_FAILED';
}

let blockerSequence = 0;
function nextBlockerId(requestId) {
  blockerSequence += 1;
  return `${requestId}-blocker-${blockerSequence}`;
}

function makeBlocker(requestId, logicalSequence, config) {
  return buildOrchestratorBlocker({
    blocker_id: nextBlockerId(requestId),
    blocker_type: config.blockerType,
    source_reference_type: config.sourceReferenceType,
    source_reference_id: config.sourceReferenceId,
    severity: config.severity || 'HIGH',
    blocking: true,
    resolvable: config.resolvable === true,
    resolution_type: config.resolutionType,
    reason_code: config.reasonCode,
    logical_sequence: logicalSequence
  });
}

function buildBlockedOutcome(request, status, blockerConfig) {
  const requestSafe = isPlainObject(request) ? request : {};
  const planningRef = isPlainObject(requestSafe.planning_result_reference) ? requestSafe.planning_result_reference : {};
  const planRef = isPlainObject(requestSafe.orchestration_plan_reference) ? requestSafe.orchestration_plan_reference : {};
  const requestId = requestSafe.decision_request_id || 'decision_request_not_available';
  const logicalSequence = Number.isInteger(requestSafe.logical_sequence) ? requestSafe.logical_sequence : 0;

  const blockers = blockerConfig ? [makeBlocker(requestId, logicalSequence, blockerConfig)] : [];
  const readiness = buildOrchestratorReadiness({
    readiness_id: `${requestId}-readiness`,
    planning_result_id: planningRef.planning_result_id || 'planning_result_not_available',
    plan_id: planRef.plan_id || planningRef.plan_id || 'plan_not_available',
    blocking_count: blockers.length,
    critical_count: blockers.filter((b) => b.severity === 'CRITICAL').length,
    warning_count: 0,
    readiness_reason_codes: blockers.map((b) => b.reason_code)
  });

  const result = buildOrchestratorDecisionResult({
    result_id: `${requestId}-result`,
    decision_request_id: requestId,
    planning_result_id: planningRef.planning_result_id || 'planning_result_not_available',
    plan_id: planRef.plan_id || planningRef.plan_id || 'plan_not_available',
    agent_id: planningRef.agent_id,
    tenant_id: planningRef.tenant_id,
    organization_id: planningRef.organization_id,
    project_id: planningRef.project_id,
    session_reference_id: planningRef.session_reference_id,
    status,
    readiness_id: readiness.readiness_id,
    blocker_ids: blockers.map((b) => b.blocker_id),
    request_fingerprint: isPlainObject(request) ? safeFingerprint(request) : undefined,
    planning_result_fingerprint: planningRef.planning_result_fingerprint,
    plan_fingerprint: planRef.plan_fingerprint || planningRef.plan_fingerprint,
    policy_fingerprint: isPlainObject(requestSafe.decision_policy) ? safeFingerprint(requestSafe.decision_policy) : undefined,
    memory_fingerprint: isPlainObject(requestSafe.memory_selection_decision_reference) ? safeFingerprint(requestSafe.memory_selection_decision_reference) : undefined,
    context_fingerprint: isPlainObject(requestSafe.context_assembly_result_reference) ? safeFingerprint(requestSafe.context_assembly_result_reference) : undefined,
    model_selection_fingerprint: isPlainObject(requestSafe.model_selection_decision_reference) ? safeFingerprint(requestSafe.model_selection_decision_reference) : undefined,
    tool_fingerprints: Array.isArray(requestSafe.tool_decision_references) ? requestSafe.tool_decision_references.map((r) => safeFingerprint(r)) : [],
    workflow_fingerprint: isPlainObject(requestSafe.workflow_decision_reference) ? safeFingerprint(requestSafe.workflow_decision_reference) : undefined,
    decision_fingerprint: safeFingerprint({ status, blockers: blockers.map((b) => b.blocker_id) }),
    registry_version: requestSafe.expected_registry_version,
    blocking_count: readiness.blocking_count,
    critical_count: readiness.critical_count,
    readiness_score: readiness.readiness_score
  });

  const audit = buildOrchestratorDecisionAudit({
    result, blockerFingerprints: blockers.map((b) => safeFingerprint(b)), readinessFingerprint: safeFingerprint(readiness),
    logicalSequence, reasonCodes: blockers.map((b) => b.reason_code)
  });

  return { result, blockers, readiness, audit };
}

function checkReferenceBinding(reference, canonical, label) {
  if (!isPlainObject(reference)) return null;
  if (reference.tenant_id !== null && reference.tenant_id !== canonical.tenantId) return { status: 'TENANT_BLOCKED', reason: `${label}_tenant_mismatch` };
  if (reference.organization_id !== null && reference.organization_id !== canonical.organizationId) return { status: 'ORGANIZATION_BLOCKED', reason: `${label}_organization_mismatch` };
  if (reference.agent_id !== null && reference.agent_id !== canonical.agentId) return { status: 'VALIDATION_FAILED', reason: `${label}_agent_mismatch` };
  if (reference.project_id !== null && canonical.projectId !== null && reference.project_id !== canonical.projectId) return { status: 'PROJECT_BLOCKED', reason: `${label}_project_mismatch` };
  if (reference.session_id !== null && canonical.sessionId !== null && reference.session_id !== canonical.sessionId) return { status: 'SESSION_BLOCKED', reason: `${label}_session_mismatch` };
  return null;
}

// A domain reference (memory/context/model/tool/workflow) is treated uniformly:
//   decision === 'BLOCKED'            -> hard, unresolvable block
//   decision !== 'BLOCKED' but the
//     reference's own blockers list
//     is non-empty, or a domain-
//     specific readiness flag fails   -> resolvable "waiting" outcome
//   otherwise                         -> the domain is ready
function evaluateReferenceDomain(reference, extraNotReadyCondition) {
  if (!isPlainObject(reference)) return 'blocked';
  if (reference.decision === 'BLOCKED') return 'blocked';
  if (Array.isArray(reference.blockers) && reference.blockers.length > 0) return 'waiting';
  if (extraNotReadyCondition) return 'waiting';
  return 'ready';
}

function evaluateOrchestratorDecisionRequest(request, context = {}) {
  const requestValidation = validateOrchestratorDecisionRequest(request);
  if (!requestValidation.valid) {
    return buildBlockedOutcome(request, 'VALIDATION_FAILED', {
      blockerType: 'VALIDATION_BLOCKER', sourceReferenceType: 'decision_request', sourceReferenceId: 'decision_request',
      severity: 'CRITICAL', resolvable: false, resolutionType: 'NONE', reasonCode: 'decision_request_invalid'
    });
  }

  const planningRef = request.planning_result_reference;
  const planRef = request.orchestration_plan_reference;
  const policy = request.decision_policy;
  const memoryRef = request.memory_selection_decision_reference;
  const contextRef = request.context_assembly_result_reference;
  const modelRef = request.model_selection_decision_reference;
  const workflowRef = request.workflow_decision_reference;
  const logicalSequence = request.logical_sequence;

  function blocked(status, blockerType, sourceType, sourceId, reasonCode, options = {}) {
    return buildBlockedOutcome(request, status, {
      blockerType, sourceReferenceType: sourceType, sourceReferenceId: sourceId, reasonCode,
      severity: options.severity || 'HIGH', resolvable: options.resolvable === true, resolutionType: options.resolutionType || 'NONE'
    });
  }

  // 4-8. tenant/organization/agent/project/session bindings.
  const canonical = {
    tenantId: planningRef.tenant_id, organizationId: planningRef.organization_id, agentId: planningRef.agent_id,
    projectId: planningRef.project_id, sessionId: planningRef.session_reference_id
  };
  // orchestration_plan_reference is checked separately below (its field is
  // session_reference_id, not session_id like every PR #94-style minimal reference).
  const bindingChecks = [
    ['memory_selection_decision_reference', memoryRef],
    ['context_assembly_result_reference', contextRef], ['model_selection_decision_reference', modelRef],
    ['workflow_decision_reference', workflowRef],
    ...request.tool_decision_references.map((reference, index) => [`tool_decision_references[${index}]`, reference])
  ];
  for (const [label, reference] of bindingChecks) {
    const mismatch = checkReferenceBinding(reference, canonical, label);
    if (mismatch) return blocked(mismatch.status, `${mismatch.status.replace('_BLOCKED', '')}_BLOCKER`, label, reference.reference_id || label, mismatch.reason);
  }
  if (planRef.tenant_id !== canonical.tenantId) return blocked('TENANT_BLOCKED', 'TENANT_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'plan_reference_tenant_mismatch');
  if (planRef.organization_id !== canonical.organizationId) return blocked('ORGANIZATION_BLOCKED', 'ORGANIZATION_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'plan_reference_organization_mismatch');
  if (planRef.agent_id !== canonical.agentId) return blocked('VALIDATION_FAILED', 'AGENT_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'plan_reference_agent_mismatch');
  if (planRef.project_id !== canonical.projectId) return blocked('PROJECT_BLOCKED', 'PROJECT_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'plan_reference_project_mismatch');
  if (planRef.session_reference_id !== canonical.sessionId) return blocked('SESSION_BLOCKED', 'SESSION_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'plan_reference_session_mismatch');

  // 9. versão e fingerprints.
  if (planningRef.plan_id !== planRef.plan_id || planningRef.plan_fingerprint !== planRef.plan_fingerprint) {
    return blocked('FINGERPRINT_BLOCKED', 'FINGERPRINT_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'plan_fingerprint_mismatch_between_planning_result_and_plan_reference');
  }
  if (isNonEmptyString(context.currentRegistryVersion) && context.currentRegistryVersion !== request.expected_registry_version) {
    return blocked('VERSION_BLOCKED', 'VERSION_BLOCKER', 'decision_request', request.decision_request_id, 'expected_registry_version_mismatch');
  }

  // 10. status do Planner.
  if (!PLANNER_PLAN_GENERATED_STATUSES.includes(planningRef.status)) {
    const translated = translatePlannerBlockedStatus(planningRef.status);
    return blocked(translated, 'UNKNOWN_STATUS_BLOCKER', 'planning_result_reference', planningRef.planning_result_id, `planner_status_not_ready::${planningRef.status}`);
  }

  // 11-14. memória, preferências, estado do projeto, continuidade.
  const memoryFlags = memoryRef.operational_flags;
  if (memoryRef.decision === 'BLOCKED') {
    return blocked('MEMORY_BLOCKED', 'MEMORY_BLOCKER', 'memory_selection_decision_reference', memoryRef.reference_id, 'memory_selection_decision_reference_blocked');
  }
  if (planningRef.memory_preserved !== true || memoryFlags.required_memory_preserved !== true || memoryFlags.pending_tasks_preserved !== true || memoryFlags.applicable_decisions_preserved !== true) {
    return blocked('WAITING_MEMORY_REFERENCE', 'MEMORY_BLOCKER', 'memory_selection_decision_reference', memoryRef.reference_id, 'required_memory_not_preserved', { resolvable: true, resolutionType: 'RESELECT_MEMORY' });
  }
  if (memoryFlags.preferences_preserved !== true) {
    return blocked('WAITING_MEMORY_REFERENCE', 'PREFERENCE_BLOCKER', 'memory_selection_decision_reference', memoryRef.reference_id, 'applicable_preference_omitted', { resolvable: true, resolutionType: 'RESELECT_MEMORY' });
  }
  if (planningRef.project_state_preserved !== true || memoryFlags.project_state_preserved !== true) {
    return blocked('WAITING_MEMORY_REFERENCE', 'PROJECT_STATE_BLOCKER', 'memory_selection_decision_reference', memoryRef.reference_id, 'project_state_not_preserved', { resolvable: true, resolutionType: 'RESELECT_MEMORY' });
  }
  if (planningRef.continuity_preserved !== true || memoryFlags.continuity_preserved !== true) {
    return blocked('WAITING_MEMORY_REFERENCE', 'CONTINUITY_BLOCKER', 'memory_selection_decision_reference', memoryRef.reference_id, 'continuity_not_preserved', { resolvable: true, resolutionType: 'RESELECT_MEMORY' });
  }

  // 15. policy.
  if (request.policy_decision_reference.policy_status === 'DENY') {
    return blocked('DENY', 'POLICY_BLOCKER', 'policy_decision_reference', 'policy_decision_reference', 'policy_explicitly_denies_orchestration');
  }
  if (request.policy_decision_reference.allowed_in_simulation !== true || planningRef.policy_validated !== true) {
    return blocked('POLICY_BLOCKED', 'POLICY_BLOCKER', 'policy_decision_reference', 'policy_decision_reference', 'policy_not_validated');
  }

  // 16. contexto.
  if (planningRef.context_reference_ids.length > 0) {
    const contextFlags = contextRef.operational_flags;
    const contextState = evaluateReferenceDomain(contextRef, contextFlags.assembly_planned !== true);
    if (contextState === 'blocked') {
      return blocked('CONTEXT_BLOCKED', 'CONTEXT_BLOCKER', 'context_assembly_result_reference', contextRef.reference_id, 'context_assembly_result_reference_blocked');
    }
    if (contextState === 'waiting') {
      return blocked('WAITING_CONTEXT_REFERENCE', 'CONTEXT_BLOCKER', 'context_assembly_result_reference', contextRef.reference_id, 'context_not_planned', { resolvable: true, resolutionType: 'REASSEMBLE_CONTEXT' });
    }
  }

  // 17. seleção de modelo ou NO_LLM.
  if (planningRef.selected_model_reference_ids.length > 0) {
    const modelStatusValid = modelRef.status === 'NO_LLM_SELECTED_SIMULATION' || modelRef.status === 'MODEL_SELECTED_SIMULATION';
    if (modelStatusValid && policy.allow_no_llm !== true && modelRef.status === 'NO_LLM_SELECTED_SIMULATION') {
      return blocked('MODEL_BLOCKED', 'MODEL_BLOCKER', 'model_selection_decision_reference', modelRef.reference_id, 'no_llm_not_allowed_by_decision_policy');
    }
    if (modelStatusValid && policy.allow_model_reference !== true && modelRef.status === 'MODEL_SELECTED_SIMULATION') {
      return blocked('MODEL_BLOCKED', 'MODEL_BLOCKER', 'model_selection_decision_reference', modelRef.reference_id, 'model_reference_not_allowed_by_decision_policy');
    }
    const modelState = evaluateReferenceDomain(modelRef, !modelStatusValid);
    if (modelState === 'blocked') {
      return blocked('MODEL_BLOCKED', 'MODEL_BLOCKER', 'model_selection_decision_reference', modelRef.reference_id, 'model_selection_decision_reference_blocked');
    }
    if (modelState === 'waiting') {
      return blocked('WAITING_MODEL_REFERENCE', 'MODEL_BLOCKER', 'model_selection_decision_reference', modelRef.reference_id, 'model_selection_not_usable', { resolvable: true, resolutionType: 'RESELECT_MODEL' });
    }
  }

  // 18. ferramentas.
  if (planningRef.selected_tool_reference_ids.length > 0) {
    if (policy.allow_tool_reference !== true) {
      return blocked('TOOL_BLOCKED', 'TOOL_BLOCKER', 'tool_decision_references', 'tool_decision_references', 'tool_reference_not_allowed_by_decision_policy');
    }
    const availableToolIds = new Set(request.tool_decision_references.map((reference) => reference.reference_id));
    const missingTool = planningRef.selected_tool_reference_ids.find((id) => !availableToolIds.has(id));
    if (missingTool) {
      return blocked('TOOL_BLOCKED', 'TOOL_BLOCKER', 'tool_decision_references', missingTool, 'required_tool_reference_missing');
    }
    for (const toolReference of request.tool_decision_references) {
      const toolState = evaluateReferenceDomain(toolReference, toolReference.operational_flags.side_effect_free !== true);
      if (toolState === 'blocked') {
        return blocked('TOOL_BLOCKED', 'TOOL_BLOCKER', 'tool_decision_references', toolReference.reference_id, 'tool_decision_reference_blocked');
      }
      if (toolState === 'waiting') {
        return blocked('WAITING_TOOL_REFERENCE', 'TOOL_BLOCKER', 'tool_decision_references', toolReference.reference_id, 'tool_requires_review', { resolvable: true, resolutionType: 'REVIEW_TOOL' });
      }
    }
  }

  // 19. workflow.
  if (planningRef.selected_workflow_reference_ids.length > 0) {
    if (policy.allow_workflow_reference !== true) {
      return blocked('WORKFLOW_BLOCKED', 'WORKFLOW_BLOCKER', 'workflow_decision_reference', workflowRef.reference_id, 'workflow_reference_not_allowed_by_decision_policy');
    }
    const workflowState = evaluateReferenceDomain(workflowRef, false);
    if (workflowState === 'blocked') {
      return blocked('WORKFLOW_BLOCKED', 'WORKFLOW_BLOCKER', 'workflow_decision_reference', workflowRef.reference_id, 'workflow_decision_reference_blocked');
    }
    if (workflowState === 'waiting') {
      return blocked('WAITING_WORKFLOW_REFERENCE', 'WORKFLOW_BLOCKER', 'workflow_decision_reference', workflowRef.reference_id, 'workflow_requires_review', { resolvable: true, resolutionType: 'REVIEW_WORKFLOW' });
    }
  }

  // 20. orçamento.
  if (planningRef.budget_validated !== true) {
    if (planningRef.plan_generated !== true) {
      return blocked('BUDGET_BLOCKED', 'BUDGET_BLOCKER', 'planning_result_reference', planningRef.planning_result_id, 'budget_not_validated_and_no_plan_generated');
    }
    return blocked('WAITING_BUDGET_REFERENCE', 'BUDGET_BLOCKER', 'planning_result_reference', planningRef.planning_result_id, 'budget_requires_review', { resolvable: true, resolutionType: 'INCREASE_BUDGET' });
  }

  // 21. dependências.
  if (planningRef.parallel_stage_count > 0 && policy.allow_parallel_plan !== true) {
    return blocked('DEPENDENCY_BLOCKED', 'DEPENDENCY_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'parallel_plan_not_allowed_by_decision_policy');
  }
  if (Array.isArray(context.dependencyRecords) && context.dependencyRecords.length > 0 && hasDependencyCycle(context.dependencyRecords)) {
    return blocked('DEPENDENCY_BLOCKED', 'DEPENDENCY_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'dependency_cycle_detected');
  }
  const planDependencyIds = [...planRef.dependency_ids].sort();
  const planningDependencyIds = [...planningRef.dependency_ids].sort();
  if (JSON.stringify(planDependencyIds) !== JSON.stringify(planningDependencyIds)) {
    return blocked('DEPENDENCY_BLOCKED', 'DEPENDENCY_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'dependency_ids_inconsistent_between_planning_result_and_plan_reference');
  }
  if (Array.isArray(context.pendingDependencyReviewIds) && context.pendingDependencyReviewIds.some((id) => planRef.dependency_ids.includes(id))) {
    return blocked('WAITING_DEPENDENCY_REFERENCE', 'DEPENDENCY_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'dependency_requires_revalidation', { resolvable: true, resolutionType: 'REVALIDATE_REFERENCE' });
  }

  // conflitos (side-channel: the minimal references carry no conflict data of their own).
  if (Array.isArray(context.unresolvedConflictIds) && context.unresolvedConflictIds.length > 0) {
    return blocked('CONFLICT_BLOCKED', 'CONFLICT_BLOCKER', 'decision_request', request.decision_request_id, 'unresolved_conflict_detected');
  }
  if (Array.isArray(context.resolvableConflictIds) && context.resolvableConflictIds.length > 0) {
    return blocked('WAITING_CONFLICT_RESOLUTION', 'CONFLICT_BLOCKER', 'decision_request', request.decision_request_id, 'conflict_requires_resolution', { resolvable: true, resolutionType: 'RESOLVE_CONFLICT' });
  }

  // 22. aprovações.
  const approvalRequired = planningRef.status === 'APPROVAL_REQUIRED_SIMULATION' || planningRef.approval_stage_ids.length > 0;
  if (approvalRequired) {
    if (planRef.approval_stage_ids.length === 0) {
      return blocked('APPROVAL_BLOCKED', 'APPROVAL_BLOCKER', 'orchestration_plan_reference', planRef.plan_id, 'approval_required_but_no_approval_stage_declared');
    }
    const readiness = buildOrchestratorReadiness({
      readiness_id: `${request.decision_request_id}-readiness`, planning_result_id: planningRef.planning_result_id,
      plan_id: planRef.plan_id, policy_ready: true, memory_ready: true, preferences_ready: true,
      project_state_ready: true, continuity_ready: true, context_ready: true, model_ready: true, tools_ready: true,
      workflow_ready: true, budget_ready: true, dependencies_ready: true, approval_ready: false,
      fingerprints_ready: true, versions_ready: true, blocking_count: 0, warning_count: 0, critical_count: 0,
      readiness_reason_codes: ['approval_pending']
    });
    const result = buildOrchestratorDecisionResult({
      result_id: `${request.decision_request_id}-result`, decision_request_id: request.decision_request_id,
      planning_result_id: planningRef.planning_result_id, plan_id: planRef.plan_id, agent_id: canonical.agentId,
      tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
      session_reference_id: canonical.sessionId, status: 'WAITING_APPROVAL_SIMULATION', readiness_id: readiness.readiness_id,
      approval_reference_ids: planningRef.approval_stage_ids, request_fingerprint: safeFingerprint(request),
      planning_result_fingerprint: planningRef.planning_result_fingerprint, plan_fingerprint: planRef.plan_fingerprint,
      policy_fingerprint: safeFingerprint(policy), memory_fingerprint: safeFingerprint(memoryRef),
      context_fingerprint: safeFingerprint(contextRef), model_selection_fingerprint: safeFingerprint(modelRef),
      tool_fingerprints: request.tool_decision_references.map((r) => safeFingerprint(r)), workflow_fingerprint: safeFingerprint(workflowRef),
      decision_fingerprint: safeFingerprint({ status: 'WAITING_APPROVAL_SIMULATION' }), registry_version: request.expected_registry_version,
      request_validated: true, planning_validated: true, bindings_validated: true, policy_validated: true,
      memory_validated: true, preferences_preserved: true, project_state_preserved: true, continuity_preserved: true,
      context_validated: true, model_selection_validated: true, tools_validated: true, workflow_validated: true,
      budget_validated: true, dependencies_validated: true, approvals_validated: false, readiness_score: readiness.readiness_score
    });
    const audit = buildOrchestratorDecisionAudit({
      result, readinessFingerprint: safeFingerprint(readiness), logicalSequence, reasonCodes: ['waiting_for_human_approval']
    });
    return { result, blockers: [], readiness, audit };
  }

  // 23-24. consolidar blockers e calcular readiness (nothing failed -- every domain is ready).
  const readiness = buildOrchestratorReadiness({
    readiness_id: `${request.decision_request_id}-readiness`, planning_result_id: planningRef.planning_result_id,
    plan_id: planRef.plan_id, policy_ready: true, memory_ready: true, preferences_ready: true,
    project_state_ready: true, continuity_ready: true, context_ready: true, model_ready: true, tools_ready: true,
    workflow_ready: true, budget_ready: true, dependencies_ready: true, approval_ready: true,
    fingerprints_ready: true, versions_ready: true, blocking_count: 0, warning_count: 0, critical_count: 0,
    readiness_reason_codes: ['plan_ready_in_simulation']
  });

  // 25. emitir decisão.
  if (policy.allow_ready_simulation !== true) {
    return buildBlockedOutcome(request, 'DENY', {
      blockerType: 'POLICY_BLOCKER', sourceReferenceType: 'decision_policy', sourceReferenceId: policy.decision_policy_id,
      severity: 'HIGH', resolvable: false, resolutionType: 'NONE', reasonCode: 'decision_policy_disallows_ready_simulation'
    });
  }

  const result = buildOrchestratorDecisionResult({
    result_id: `${request.decision_request_id}-result`, decision_request_id: request.decision_request_id,
    planning_result_id: planningRef.planning_result_id, plan_id: planRef.plan_id, agent_id: canonical.agentId,
    tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
    session_reference_id: canonical.sessionId, status: 'READY_SIMULATION', readiness_id: readiness.readiness_id,
    request_fingerprint: safeFingerprint(request), planning_result_fingerprint: planningRef.planning_result_fingerprint,
    plan_fingerprint: planRef.plan_fingerprint, policy_fingerprint: safeFingerprint(policy),
    memory_fingerprint: safeFingerprint(memoryRef), context_fingerprint: safeFingerprint(contextRef),
    model_selection_fingerprint: safeFingerprint(modelRef),
    tool_fingerprints: request.tool_decision_references.map((r) => safeFingerprint(r)),
    workflow_fingerprint: safeFingerprint(workflowRef), decision_fingerprint: safeFingerprint({ status: 'READY_SIMULATION' }),
    registry_version: request.expected_registry_version, request_validated: true, planning_validated: true,
    bindings_validated: true, policy_validated: true, memory_validated: true, preferences_preserved: true,
    project_state_preserved: true, continuity_preserved: true, context_validated: true, model_selection_validated: true,
    tools_validated: true, workflow_validated: true, budget_validated: true, dependencies_validated: true,
    approvals_validated: true, readiness_score: readiness.readiness_score
  });

  // 26. produzir auditoria.
  const audit = buildOrchestratorDecisionAudit({
    result, readinessFingerprint: safeFingerprint(readiness), logicalSequence, reasonCodes: ['plan_authorized_simulation_only']
  });

  return { result, blockers: [], readiness, audit };
}

module.exports = {
  evaluateOrchestratorDecisionRequest,
  translatePlannerBlockedStatus
};
