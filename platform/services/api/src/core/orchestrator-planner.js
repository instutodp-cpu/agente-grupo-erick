'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { validateOrchestratorPlanningRequest } = require('./orchestrator-planning-request');
const { hasDependencyCycle } = require('./orchestrator-plan-dependency');
const { buildOrchestratorPlanningResult } = require('./orchestrator-planning-result');
const { buildOrchestratorPlanningAudit } = require('./orchestrator-planning-audit');

const VALIDATOR_VERSIONS = {
  stage: 'orchestrator_plan_stage_validator_v1',
  dependency: 'orchestrator_plan_dependency_validator_v1',
  criteria: 'orchestrator_success_criteria_validator_v1',
  plan: 'orchestrator_plan_index_validator_v1'
};

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function buildBlockedOutcome(request, status, reasonCodes) {
  const requestSafe = isPlainObject(request) ? request : {};
  const task = isPlainObject(requestSafe.task_definition) ? requestSafe.task_definition : {};
  const agentContract = isPlainObject(requestSafe.agent_contract_reference) ? requestSafe.agent_contract_reference : {};
  const memoryRef = isPlainObject(requestSafe.memory_selection_decision_reference) ? requestSafe.memory_selection_decision_reference : {};
  const sessionRef = isPlainObject(requestSafe.session_decision_reference) ? requestSafe.session_decision_reference : {};

  const result = buildOrchestratorPlanningResult({
    result_id: `planning_result_${requestSafe.planning_request_id || 'not_available'}`,
    planning_request_id: requestSafe.planning_request_id,
    orchestration_request_id: isPlainObject(requestSafe.orchestrator_request_reference) ? requestSafe.orchestrator_request_reference.reference_id : undefined,
    agent_id: agentContract.agent_id,
    tenant_id: agentContract.tenant_id,
    organization_id: agentContract.organization_id,
    project_id: memoryRef.project_id,
    session_reference_id: sessionRef.session_id,
    status,
    request_fingerprint: isPlainObject(request) ? safeFingerprint(request) : undefined,
    task_fingerprint: isPlainObject(task) ? safeFingerprint(task) : undefined,
    policy_fingerprint: isPlainObject(requestSafe.planning_policy) ? safeFingerprint(requestSafe.planning_policy) : undefined,
    budget_fingerprint: isPlainObject(requestSafe.plan_budget) ? safeFingerprint(requestSafe.plan_budget) : undefined,
    registry_version: requestSafe.expected_registry_version,
    blockers: reasonCodes,
    reason_codes: reasonCodes
  });
  const audit = buildOrchestratorPlanningAudit({
    result, logicalSequence: Number.isInteger(requestSafe.logical_sequence) ? requestSafe.logical_sequence : 0,
    approvalContext: requestSafe.approval_context
  });
  return { result, stages: [], dependencies: [], criteria: [], plan: null, audit };
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

// Declarative, deterministic decomposition templates keyed by task_type. Each entry is an
// ordered list of stage blueprints; the planner turns each blueprint into a real
// OrchestratorPlanStage with a deterministic id and links a simple linear AFTER_SUCCESS_REFERENCE
// dependency chain between consecutive stages (multi-agent gets its own fan-out/join shape below).
const DETERMINISTIC_TEMPLATE = ['VALIDATION_STAGE', 'DETERMINISTIC_STAGE', 'AUDIT_STAGE', 'FINALIZATION_STAGE'];
const MODEL_TEMPLATE = ['VALIDATION_STAGE', 'MEMORY_REFERENCE_STAGE', 'CONTEXT_REFERENCE_STAGE', 'MODEL_REFERENCE_STAGE', 'AUDIT_STAGE', 'FINALIZATION_STAGE'];
const TOOL_TEMPLATE = ['VALIDATION_STAGE', 'MEMORY_REFERENCE_STAGE', 'CONTEXT_REFERENCE_STAGE', 'TOOL_REFERENCE_STAGE', 'AUDIT_STAGE', 'FINALIZATION_STAGE'];
const WORKFLOW_TEMPLATE = ['VALIDATION_STAGE', 'MEMORY_REFERENCE_STAGE', 'CONTEXT_REFERENCE_STAGE', 'WORKFLOW_REFERENCE_STAGE', 'AUDIT_STAGE', 'FINALIZATION_STAGE'];

function templateForTaskType(taskType) {
  if (taskType === 'DETERMINISTIC_REFERENCE') return DETERMINISTIC_TEMPLATE;
  if (taskType === 'TOOL_COORDINATION_REFERENCE') return TOOL_TEMPLATE;
  if (taskType === 'WORKFLOW_COORDINATION_REFERENCE') return WORKFLOW_TEMPLATE;
  return MODEL_TEMPLATE;
}

function buildStage(context, stageType, sequence, extra = {}) {
  const { requestId, task, references } = context;
  return {
    stage_id: `${requestId}-stage-${sequence}`,
    stage_version: 1,
    stage_type: stageType,
    stage_sequence: sequence,
    agent_reference_id: extra.agent_reference_id !== undefined ? extra.agent_reference_id : null,
    task_reference_id: task.task_id,
    model_selection_reference_id: stageType === 'MODEL_REFERENCE_STAGE' ? references.model.reference_id : null,
    context_assembly_reference_id: stageType === 'CONTEXT_REFERENCE_STAGE' ? references.context.reference_id : null,
    memory_selection_reference_id: stageType === 'MEMORY_REFERENCE_STAGE' ? references.memory.reference_id : null,
    tool_reference_ids: stageType === 'TOOL_REFERENCE_STAGE' ? references.toolIds : [],
    workflow_reference_id: stageType === 'WORKFLOW_REFERENCE_STAGE' ? references.workflow.reference_id : null,
    dependency_reference_ids: [],
    required_capabilities: [],
    required_modalities: [],
    priority: sequence,
    parallelizable: extra.parallelizable === true,
    optional: extra.optional === true,
    approval_required: stageType === 'HUMAN_APPROVAL_STAGE',
    estimated_input_tokens: extra.estimated_input_tokens || 0,
    estimated_output_tokens: extra.estimated_output_tokens || 0,
    estimated_total_tokens: (extra.estimated_input_tokens || 0) + (extra.estimated_output_tokens || 0),
    estimated_cost_minor_units: extra.estimated_cost_minor_units || 0,
    success_criteria_reference_ids: extra.success_criteria_reference_ids || [],
    fallback_reference_ids: [],
    escalation_reference_ids: [],
    stage_planned: true,
    stage_executed: false,
    simulation: true,
    production_blocked: true,
    validator_version: VALIDATOR_VERSIONS.stage
  };
}

function buildDependency(context, sequence, fromStageId, toStageId, dependencyType) {
  return {
    dependency_id: `${context.requestId}-dep-${sequence}`,
    from_stage_id: fromStageId,
    to_stage_id: toStageId,
    dependency_type: dependencyType,
    required: true,
    satisfied_in_simulation: true,
    dependency_applied: false,
    reason_codes: [],
    validator_version: VALIDATOR_VERSIONS.dependency
  };
}

function buildCriteria(context, sequence, criteriaType, targetReferenceId) {
  return {
    criteria_id: `${context.requestId}-criteria-${sequence}`,
    criteria_version: 1,
    criteria_type: criteriaType,
    target_reference_id: targetReferenceId,
    required: true,
    evaluation_reference: `${context.requestId}-criteria-check-${sequence}`,
    criteria_satisfied: false,
    evaluation_executed: false,
    validator_version: VALIDATOR_VERSIONS.criteria
  };
}

const CRITERIA_TYPE_FOR_STAGE = Object.freeze({
  VALIDATION_STAGE: 'VALIDATION_REFERENCE',
  MEMORY_REFERENCE_STAGE: 'MEMORY_PRESERVATION_REFERENCE',
  CONTEXT_REFERENCE_STAGE: 'CONTEXT_BUDGET_REFERENCE',
  MODEL_REFERENCE_STAGE: 'QUALITY_REFERENCE',
  TOOL_REFERENCE_STAGE: 'TOOL_RESULT_REFERENCE',
  WORKFLOW_REFERENCE_STAGE: 'WORKFLOW_RESULT_REFERENCE',
  HUMAN_APPROVAL_STAGE: 'HUMAN_APPROVAL_REFERENCE',
  AUDIT_STAGE: 'AUDIT_REFERENCE'
});

// Builds the linear (non-multi-agent) stage list for one template, inserting a
// HUMAN_APPROVAL_STAGE right after validation when approval is required, and attaching one
// declarative success criteria per meaningful stage. Deterministic: identical input always
// produces identical stage/dependency/criteria ids and ordering.
function decomposeLinear(context, template, approvalRequired) {
  const stages = [];
  const dependencies = [];
  const criteria = [];
  let sequence = 0;
  let dependencySequence = 0;
  let criteriaSequence = 0;
  let previousStageId = null;

  const orderedTypes = [];
  for (const stageType of template) {
    orderedTypes.push(stageType);
    if (stageType === 'VALIDATION_STAGE' && approvalRequired) orderedTypes.push('HUMAN_APPROVAL_STAGE');
  }

  for (const stageType of orderedTypes) {
    const stage = buildStage(context, stageType, sequence);
    const criteriaType = CRITERIA_TYPE_FOR_STAGE[stageType];
    if (criteriaType) {
      const criteriaRecord = buildCriteria(context, criteriaSequence, criteriaType, stage.stage_id);
      criteria.push(criteriaRecord);
      stage.success_criteria_reference_ids = [criteriaRecord.criteria_id];
      criteriaSequence += 1;
    }
    stages.push(stage);
    if (previousStageId) {
      const dependency = buildDependency(context, dependencySequence, previousStageId, stage.stage_id, 'AFTER_SUCCESS_REFERENCE');
      dependencies.push(dependency);
      stage.dependency_reference_ids = [dependency.dependency_id];
      dependencySequence += 1;
    }
    previousStageId = stage.stage_id;
    sequence += 1;
  }
  return { stages, dependencies, criteria };
}

function decomposeMultiAgent(context, agentStageCount, approvalRequired) {
  const stages = [];
  const dependencies = [];
  const criteria = [];
  let dependencySequence = 0;
  let criteriaSequence = 0;

  const validationStage = buildStage(context, 'VALIDATION_STAGE', 0);
  const validationCriteria = buildCriteria(context, criteriaSequence, 'VALIDATION_REFERENCE', validationStage.stage_id);
  criteriaSequence += 1;
  validationStage.success_criteria_reference_ids = [validationCriteria.criteria_id];
  stages.push(validationStage);
  criteria.push(validationCriteria);

  let previousGateStageId = validationStage.stage_id;
  if (approvalRequired) {
    const approvalStage = buildStage(context, 'HUMAN_APPROVAL_STAGE', 1);
    const approvalCriteria = buildCriteria(context, criteriaSequence, 'HUMAN_APPROVAL_REFERENCE', approvalStage.stage_id);
    criteriaSequence += 1;
    approvalStage.success_criteria_reference_ids = [approvalCriteria.criteria_id];
    const dependency = buildDependency(context, dependencySequence, validationStage.stage_id, approvalStage.stage_id, 'AFTER_APPROVAL_REFERENCE');
    dependencySequence += 1;
    approvalStage.dependency_reference_ids = [dependency.dependency_id];
    stages.push(approvalStage);
    criteria.push(approvalCriteria);
    dependencies.push(dependency);
    previousGateStageId = approvalStage.stage_id;
  }

  let sequence = stages.length;
  const agentStageIds = [];
  for (let index = 0; index < agentStageCount; index += 1) {
    const agentStage = buildStage(context, 'MODEL_REFERENCE_STAGE', sequence, { parallelizable: true });
    const dependency = buildDependency(context, dependencySequence, previousGateStageId, agentStage.stage_id, 'PARALLEL_REFERENCE');
    dependencySequence += 1;
    agentStage.dependency_reference_ids = [dependency.dependency_id];
    stages.push(agentStage);
    dependencies.push(dependency);
    agentStageIds.push(agentStage.stage_id);
    sequence += 1;
  }

  const joinStage = buildStage(context, 'FINALIZATION_STAGE', sequence);
  sequence += 1;
  for (const agentStageId of agentStageIds) {
    const dependency = buildDependency(context, dependencySequence, agentStageId, joinStage.stage_id, 'JOIN_REFERENCE');
    dependencySequence += 1;
    joinStage.dependency_reference_ids = [...joinStage.dependency_reference_ids, dependency.dependency_id];
    dependencies.push(dependency);
  }
  stages.push(joinStage);

  const auditStage = buildStage(context, 'AUDIT_STAGE', sequence);
  sequence += 1;
  const auditCriteria = buildCriteria(context, criteriaSequence, 'AUDIT_REFERENCE', auditStage.stage_id);
  criteriaSequence += 1;
  auditStage.success_criteria_reference_ids = [auditCriteria.criteria_id];
  const auditDependency = buildDependency(context, dependencySequence, joinStage.stage_id, auditStage.stage_id, 'AFTER_SUCCESS_REFERENCE');
  dependencySequence += 1;
  auditStage.dependency_reference_ids = [auditDependency.dependency_id];
  stages.push(auditStage);
  dependencies.push(auditDependency);
  criteria.push(auditCriteria);

  const finalizationStage = buildStage(context, 'FINALIZATION_STAGE', sequence);
  const finalizationDependency = buildDependency(context, dependencySequence, auditStage.stage_id, finalizationStage.stage_id, 'AFTER_SUCCESS_REFERENCE');
  finalizationStage.dependency_reference_ids = [finalizationDependency.dependency_id];
  stages.push(finalizationStage);
  dependencies.push(finalizationDependency);

  return { stages, dependencies, criteria };
}

function countStagesByType(stages) {
  const counts = {
    stage_count: stages.length,
    parallel_stage_count: stages.filter((stage) => stage.parallelizable).length,
    model_stage_count: stages.filter((stage) => stage.stage_type === 'MODEL_REFERENCE_STAGE').length,
    tool_stage_count: stages.filter((stage) => stage.stage_type === 'TOOL_REFERENCE_STAGE').length,
    workflow_stage_count: stages.filter((stage) => stage.stage_type === 'WORKFLOW_REFERENCE_STAGE').length,
    approval_stage_count: stages.filter((stage) => stage.stage_type === 'HUMAN_APPROVAL_STAGE').length
  };
  return counts;
}

function evaluateOrchestratorPlanningRequest(request) {
  // 1. validar o request
  const requestValidation = validateOrchestratorPlanningRequest(request);
  if (!requestValidation.valid) {
    return buildBlockedOutcome(request, 'VALIDATION_FAILED', requestValidation.errors);
  }

  const task = request.task_definition;
  const planningPolicy = request.planning_policy;
  const planBudget = request.plan_budget;
  const approvalContext = request.approval_context;
  const agentContract = request.agent_contract_reference;

  // 2-3. validar tenant/organização/agent/project/session bindings across every reference.
  const canonical = {
    tenantId: agentContract.tenant_id,
    organizationId: agentContract.organization_id,
    agentId: agentContract.agent_id,
    projectId: isNonEmptyString(request.memory_selection_decision_reference.project_id) ? request.memory_selection_decision_reference.project_id : null,
    sessionId: isNonEmptyString(request.session_decision_reference.session_id) ? request.session_decision_reference.session_id : null
  };
  const referencesToCheck = [
    ['orchestrator_request_reference', request.orchestrator_request_reference],
    ['memory_selection_decision_reference', request.memory_selection_decision_reference],
    ['context_assembly_result_reference', request.context_assembly_result_reference],
    ['model_selection_decision_reference', request.model_selection_decision_reference],
    ['workflow_decision_reference', request.workflow_decision_reference],
    ...request.tool_decision_references.map((reference, index) => [`tool_decision_references[${index}]`, reference])
  ];
  for (const [label, reference] of referencesToCheck) {
    const mismatch = checkReferenceBinding(reference, canonical, label);
    if (mismatch) return buildBlockedOutcome(request, mismatch.status, [mismatch.reason]);
  }

  // 4. validar referências de policy.
  if (request.policy_decision_reference.policy_status === 'DENY' || request.policy_decision_reference.allowed_in_simulation !== true) {
    return buildBlockedOutcome(request, 'POLICY_BLOCKED', ['policy_decision_reference_denies_planning']);
  }

  // 5-6. validar decisão de memória, continuidade e preferências preservadas.
  const memoryFlags = request.memory_selection_decision_reference.operational_flags;
  if (request.memory_selection_decision_reference.decision === 'BLOCKED') {
    return buildBlockedOutcome(request, 'MEMORY_BLOCKED', ['memory_selection_decision_reference_blocked']);
  }
  for (const field of [
    'required_memory_preserved', 'preferences_preserved', 'project_state_preserved', 'continuity_preserved',
    'pending_tasks_preserved', 'applicable_decisions_preserved'
  ]) {
    if (memoryFlags[field] !== true) {
      return buildBlockedOutcome(request, 'MEMORY_BLOCKED', [`memory_selection_${field}_not_preserved`]);
    }
  }

  // 7. validar decisão de contexto.
  if (task.requires_context === true) {
    const contextFlags = request.context_assembly_result_reference.operational_flags;
    if (request.context_assembly_result_reference.decision === 'BLOCKED' || contextFlags.assembly_planned !== true) {
      return buildBlockedOutcome(request, 'CONTEXT_BLOCKED', ['context_assembly_result_reference_not_planned']);
    }
  }

  // 8. validar decisão de modelo. The Planner never selects a model itself -- it only checks
  // the already-produced Model Selection Engine decision is usable (or that NO_LLM was chosen).
  if (task.requires_model === true && request.model_selection_decision_reference.decision === 'BLOCKED') {
    return buildBlockedOutcome(request, 'MODEL_SELECTION_BLOCKED', ['model_selection_decision_reference_blocked']);
  }

  // 9. validar referências de tools.
  if (task.required_tool_reference_ids.length > 0) {
    for (const toolReference of request.tool_decision_references) {
      if (toolReference.decision === 'BLOCKED') {
        return buildBlockedOutcome(request, 'TOOL_BLOCKED', [`tool_decision_reference_blocked::${toolReference.reference_id}`]);
      }
    }
    const availableToolIds = new Set(request.tool_decision_references.map((reference) => reference.reference_id));
    const missingTool = task.required_tool_reference_ids.find((id) => !availableToolIds.has(id));
    if (missingTool) return buildBlockedOutcome(request, 'TOOL_BLOCKED', [`required_tool_reference_missing::${missingTool}`]);
  }

  // 10. validar referência de workflow.
  if (isNonEmptyString(task.required_workflow_reference_id) && request.workflow_decision_reference.decision === 'BLOCKED') {
    return buildBlockedOutcome(request, 'WORKFLOW_BLOCKED', ['workflow_decision_reference_blocked']);
  }

  // 11. validar orçamento.
  const availableTokens = planBudget.maximum_total_tokens - planBudget.reserved_output_tokens;
  if (task.estimated_total_tokens > availableTokens) {
    return buildBlockedOutcome(request, 'BUDGET_BLOCKED', ['task_estimated_tokens_exceed_available_budget']);
  }
  if (task.estimated_cost_minor_units > planBudget.maximum_total_cost_minor_units) {
    return buildBlockedOutcome(request, 'BUDGET_BLOCKED', ['task_estimated_cost_exceeds_maximum_total_cost']);
  }

  // 12. validar aprovações.
  const approvalRequired = task.requires_human_approval === true || task.task_complexity === 'TIER_5_CRITICAL' || approvalContext.approval_required === true;
  if (approvalRequired && approvalContext.approval_type === 'NONE') {
    return buildBlockedOutcome(request, 'APPROVAL_BLOCKED', ['approval_required_but_approval_type_none']);
  }

  // 13-18. decompose the task deterministically, ordering stages, declaring dependencies and
  // parallelism, and associating references -- purely declarative, nothing executes.
  const decompositionAllowed = task.decomposition_allowed === true && planningPolicy.allow_task_decomposition === true;
  const parallelismAllowed = task.parallelism_allowed === true && planningPolicy.allow_parallel_stages === true;
  const context = {
    requestId: request.planning_request_id,
    task,
    references: {
      memory: request.memory_selection_decision_reference,
      context: request.context_assembly_result_reference,
      model: request.model_selection_decision_reference,
      toolIds: request.tool_decision_references.map((reference) => reference.reference_id),
      workflow: request.workflow_decision_reference
    }
  };

  let decomposition;
  if (!decompositionAllowed) {
    const singleStageType = task.task_type === 'DETERMINISTIC_REFERENCE' ? 'DETERMINISTIC_STAGE'
      : task.required_tool_reference_ids.length > 0 ? 'TOOL_REFERENCE_STAGE'
      : isNonEmptyString(task.required_workflow_reference_id) ? 'WORKFLOW_REFERENCE_STAGE'
      : task.requires_model === true ? 'MODEL_REFERENCE_STAGE' : 'DETERMINISTIC_STAGE';
    decomposition = decomposeLinear(context, [singleStageType], approvalRequired);
  } else if (task.task_type === 'MULTI_AGENT_REFERENCE') {
    if (!parallelismAllowed) {
      return buildBlockedOutcome(request, 'POLICY_BLOCKED', ['multi_agent_task_requires_parallelism_allowed']);
    }
    const agentStageCount = Math.max(2, Math.min(
      task.required_capabilities.length || 2, planningPolicy.maximum_agent_references, planningPolicy.maximum_parallel_stages
    ));
    decomposition = decomposeMultiAgent(context, agentStageCount, approvalRequired);
  } else {
    decomposition = decomposeLinear(context, templateForTaskType(task.task_type), approvalRequired);
  }

  const { stages, dependencies, criteria } = decomposition;

  if (stages.length > task.maximum_stages || stages.length > planningPolicy.maximum_stages) {
    return buildBlockedOutcome(request, 'POLICY_BLOCKED', ['stage_count_exceeds_maximum_stages']);
  }
  const stageIds = new Set(stages.map((stage) => stage.stage_id));
  if (stageIds.size !== stages.length) {
    return buildBlockedOutcome(request, 'VALIDATION_FAILED', ['duplicate_stage_ids_generated']);
  }
  if (hasDependencyCycle(dependencies)) {
    return buildBlockedOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_cycle_detected']);
  }

  const parallelStageCount = stages.filter((stage) => stage.parallelizable).length;
  if (parallelStageCount > planningPolicy.maximum_parallel_stages) {
    return buildBlockedOutcome(request, 'POLICY_BLOCKED', ['parallel_stage_count_exceeds_maximum_parallel_stages']);
  }

  // 19. gerar plano.
  const planId = `${request.planning_request_id}-plan`;
  const planFingerprint = safeFingerprint({
    planning_request_id: request.planning_request_id,
    stage_ids: stages.map((stage) => stage.stage_id).sort(),
    dependency_ids: dependencies.map((dependency) => dependency.dependency_id).sort()
  });
  const plan = {
    plan_id: planId,
    planning_request_id: request.planning_request_id,
    tenant_id: canonical.tenantId,
    organization_id: canonical.organizationId,
    stage_ids: stages.map((stage) => stage.stage_id).sort(),
    dependency_ids: dependencies.map((dependency) => dependency.dependency_id).sort(),
    plan_fingerprint: planFingerprint,
    validator_version: VALIDATOR_VERSIONS.plan
  };

  // 20. produzir resultado e auditoria.
  const status = approvalRequired ? 'APPROVAL_REQUIRED_SIMULATION' : 'PLAN_READY_SIMULATION';
  const counts = countStagesByType(stages);
  const modelReferenceIds = task.requires_model === true && isNonEmptyString(request.model_selection_decision_reference.reference_id)
    ? [request.model_selection_decision_reference.reference_id] : [];
  const toolReferenceIds = request.tool_decision_references.map((reference) => reference.reference_id);
  const workflowReferenceIds = isNonEmptyString(task.required_workflow_reference_id) ? [request.workflow_decision_reference.reference_id] : [];

  const result = buildOrchestratorPlanningResult({
    result_id: `planning_result_${request.planning_request_id}`,
    planning_request_id: request.planning_request_id,
    orchestration_request_id: request.orchestrator_request_reference.reference_id,
    agent_id: canonical.agentId,
    tenant_id: canonical.tenantId,
    organization_id: canonical.organizationId,
    project_id: canonical.projectId || 'project_not_available',
    session_reference_id: canonical.sessionId || 'session_not_available',
    status,
    plan_id: planId,
    stage_ids: plan.stage_ids,
    dependency_ids: plan.dependency_ids,
    approval_stage_ids: stages.filter((stage) => stage.stage_type === 'HUMAN_APPROVAL_STAGE').map((stage) => stage.stage_id),
    selected_model_reference_ids: modelReferenceIds,
    selected_tool_reference_ids: toolReferenceIds,
    selected_workflow_reference_ids: workflowReferenceIds,
    required_memory_reference_ids: task.required_memory_reference_ids,
    context_reference_ids: task.requires_context === true && isNonEmptyString(request.context_assembly_result_reference.reference_id)
      ? [request.context_assembly_result_reference.reference_id] : [],
    success_criteria_ids: criteria.map((item) => item.criteria_id).sort(),
    request_fingerprint: safeFingerprint(request),
    task_fingerprint: safeFingerprint(task),
    policy_fingerprint: safeFingerprint(planningPolicy),
    budget_fingerprint: safeFingerprint(planBudget),
    plan_fingerprint: planFingerprint,
    registry_version: request.expected_registry_version,
    stage_count: counts.stage_count,
    parallel_stage_count: counts.parallel_stage_count,
    model_stage_count: counts.model_stage_count,
    tool_stage_count: counts.tool_stage_count,
    workflow_stage_count: counts.workflow_stage_count,
    approval_stage_count: counts.approval_stage_count,
    estimated_total_tokens: task.estimated_total_tokens,
    estimated_total_cost_minor_units: task.estimated_cost_minor_units,
    request_validated: true,
    bindings_validated: true,
    reason_codes: [approvalRequired ? 'orchestration_plan_requires_human_approval' : 'orchestration_plan_ready_simulation_only']
  });

  const audit = buildOrchestratorPlanningAudit({
    result,
    stageFingerprints: stages.map((stage) => safeFingerprint(stage)),
    dependencyFingerprints: dependencies.map((dependency) => safeFingerprint(dependency)),
    successCriteriaFingerprints: criteria.map((item) => safeFingerprint(item)),
    logicalSequence: request.logical_sequence,
    approvalContext
  });

  return { result, stages, dependencies, criteria, plan, audit };
}

module.exports = {
  countStagesByType,
  evaluateOrchestratorPlanningRequest
};
