'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { PLAN_GENERATED_STATUSES: PLANNER_PLAN_GENERATED_STATUSES } = require('./orchestrator-planning-result');
const {
  validateExecutionPlanRequest, isAuthorizationDecisionReady
} = require('./execution-plan-request');
const {
  isOrchestratorDecisionReady, isEvidenceBundleReady
} = require('./execution-authorization-request');
const { computeTaskReferenceFingerprint } = require('./execution-authorization-task-reference');
const { buildExecutionPlanStage } = require('./execution-plan-stage');
const { buildExecutionPlanStageBinding } = require('./execution-plan-stage-binding');
const { buildExecutionPlanDependency } = require('./execution-plan-dependency');
const { computeDependencyGraphReferenceFingerprint } = require('./execution-plan-dependency-graph-reference');
const { computeManifestFingerprint, computeStageRecordFingerprint } = require('./orchestrator-stage-manifest-reference');
const { EXECUTION_PLAN_STATUSES, buildExecutionPlanContract } = require('./execution-plan-contract');
const { buildExecutionPlanResult } = require('./execution-plan-result');
const { buildExecutionPlanAudit } = require('./execution-plan-audit');
const { buildExecutionPlanPackage, computeExecutionPlanPackageFingerprint } = require('./execution-plan-package-integrity');
const {
  buildBindingLedgerForPlan, validateProvenanceCrossChecks, validateScopeCrossChecks, validateSnapshotCrossChecks
} = require('./execution-reference-binding-validator');
const { buildExecutionReferenceBindingResult } = require('./execution-reference-binding-result');
const { buildExecutionReferenceBindingAudit } = require('./execution-reference-binding-audit');
const { deriveValidationLedgerFromStatus, isStageValid } = require('./validation-pipeline');

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

// Agent/project/session checks are null-tolerant: a reference whose own field is null, or which
// carries no such field at all (e.g. DependencyGraphReference has no agent_id in its own
// exact-fields list), is "not scoped" and is never checked against canonical -- the same pattern
// PR #95's own engine established for its minimal model/tool/workflow references. sessionField
// differs because the "full identity" references (decision/bundle/planning-result/plan/task/
// stage-manifest) use session_reference_id, while the PR #94-shaped decision references
// (memory/context/model/tool/workflow) use session_id.
function checkBinding(reference, canonical, label, sessionField = 'session_reference_id') {
  if (!isPlainObject(reference)) return null;
  if (reference.tenant_id !== canonical.tenantId) return { status: 'TENANT_BLOCKED', reason: `${label}_tenant_mismatch` };
  if (reference.organization_id !== canonical.organizationId) return { status: 'ORGANIZATION_BLOCKED', reason: `${label}_organization_mismatch` };
  if (reference.agent_id != null && reference.agent_id !== canonical.agentId) {
    return { status: 'VALIDATION_FAILED', reason: `${label}_agent_mismatch` };
  }
  if (reference.project_id != null && canonical.projectId !== null && reference.project_id !== canonical.projectId) {
    return { status: 'PROJECT_BLOCKED', reason: `${label}_project_mismatch` };
  }
  if (reference[sessionField] != null && canonical.sessionId !== null && reference[sessionField] !== canonical.sessionId) {
    return { status: 'SESSION_BLOCKED', reason: `${label}_session_mismatch` };
  }
  return null;
}

// Derives side_effect_classification from data already present in the request as proper
// fingerprinted references (never a loose side-channel, per the lesson from PR #97's fix):
// task_reference's own external_side_effect_reference/irreversible_reference flags (always
// false while PR #97's own contract forces them so -- this path is correctly wired but
// unreachable today, see docs), and whether any compensation_references[] entry targets this
// stage and declares itself `required` (the caller's own declaration that the stage changes
// state) -- independent of whether that same entry's compensation_type is actually non-NONE,
// so a state-change stage with a NONE-typed compensation is still classified STATE_CHANGE_
// REFERENCE and can then correctly fail the separate "compensation covers it" check.
function deriveSideEffectClassification(taskRef, compensationReferences, stageId) {
  if (taskRef.external_side_effect_reference === true) return 'EXTERNAL_EFFECT_REFERENCE';
  if (taskRef.irreversible_reference === true) return 'IRREVERSIBLE_REFERENCE';
  const declaresStateChange = compensationReferences.some(
    (reference) => reference.execution_stage_id === stageId && (reference.required === true || reference.compensation_type !== 'NONE')
  );
  return declaresStateChange ? 'STATE_CHANGE_REFERENCE' : 'NONE';
}

function evaluateExecutionPlanRequest(request, context = {}) {
  // 1-2. request contract shape, including simulation_context, dependency_graph_reference, and
  // stage_manifest_reference as nested fields of the request itself -- no side-channel is ever
  // consulted here (pr99 continues pr98fix's own "no side-channel" discipline).
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
  const stageManifestRef = request.stage_manifest_reference;
  const provenanceRef = request.authorization_provenance_reference;
  const scopeRef = request.authorization_scope_reference;
  const snapshotRef = request.registry_snapshot_reference;
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

  // 9-13. tenant / organização / projeto / sessão / agent, across every reference carrying them
  // (now including stage_manifest_reference -- pr99's own manifest is bound exactly like every
  // other reference in the request).
  // pr100: actorId/authorizationScopeId are sourced from the request's own AuthorizationScopeReference
  // (already structurally valid from step 1-2) -- never from context, and never re-derived once
  // scope cross-checks below confirm this scope is the correct one for this decision/canonical
  // identity.
  const canonical = {
    tenantId: authzRef.tenant_id, organizationId: authzRef.organization_id, agentId: authzRef.agent_id,
    projectId: authzRef.project_id, sessionId: authzRef.session_reference_id,
    actorId: scopeRef.actor_id, authorizationScopeId: scopeRef.authorization_scope_id
  };
  const bindingChecks = [
    ['orchestrator_decision_reference', decisionRef, 'session_reference_id'],
    ['readiness_evidence_bundle_reference', bundleRef, 'session_reference_id'],
    ['planning_result_reference', planningRef, 'session_reference_id'],
    ['orchestration_plan_reference', planRef, 'session_reference_id'],
    ['task_reference', taskRef, 'session_reference_id'],
    ['stage_manifest_reference', stageManifestRef, 'session_reference_id'],
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

  // pr100 (Problema 1-3): authorization provenance, authorization scope, and registry snapshot are
  // validated as a contiguous block right after the pre-existing tenant/organization/agent/project/
  // session and blocked-decision gates above, and before every manifest/dependency/budget check
  // below that this PR did not move -- a documented, scoped judgment call in the same spirit as
  // PR #99's own precedence compromise (see docs), rather than a full positional reorder of a
  // 700-line function against every pre-existing regression fixture.
  const provenanceMismatch = validateProvenanceCrossChecks(provenanceRef, { authzRef, planningRef, planRef, taskRef, budget, scopeRef, canonical });
  if (provenanceMismatch) return buildOutcome(request, provenanceMismatch.status, [provenanceMismatch.reason], context);

  const scopeMismatch = validateScopeCrossChecks(scopeRef, {
    authzRef, canonical, planRef, taskRef, stageRecords: stageManifestRef.stage_records, budget, provenanceRef
  });
  if (scopeMismatch) return buildOutcome(request, scopeMismatch.status, [scopeMismatch.reason], context);

  // Registry entity fingerprints this evaluation can already compute without waiting for the
  // later manifest/dependency-graph cross-check blocks below -- every one of these references is
  // already structurally valid from step 1-2, so its own self-declared fingerprint field (or, for
  // AuthorizationProvenanceReference, which carries no self-fingerprint field by design, its
  // externally-computed one) is safe to read now.
  //
  // execution_plan_request is deliberately fingerprinted over the request's own *shallow* identity
  // fields only -- never the entire request object. Every nested reference this request carries
  // (stage_manifest, dependency_graph, provenance, scope, budget, idempotency, task, planning
  // result, orchestration plan, ...) already has its own dedicated tamper check elsewhere in this
  // engine or is one of this snapshot's own other six entities; fingerprinting the whole request
  // here would mean this fingerprint embeds every one of those nested fingerprints as a string
  // value, which then gets embedded again as a BindingRecord field, then the BindingLedger, then
  // the ExecutionPlanPackage, then plan/result/audit -- each layer re-serializing the same content
  // as an escaped string inside a string, compounding into a multi-hundred-KB fingerprint per
  // plan. Every other fingerprint in this codebase fingerprints one bounded record for exactly
  // this reason; this one now does too.
  const depGraphRefForSnapshot = request.dependency_graph_reference;
  const requestShallowIdentity = {
    execution_plan_request_id: request.execution_plan_request_id,
    execution_plan_request_version: request.execution_plan_request_version,
    correlation_id: request.correlation_id,
    causation_id: request.causation_id,
    trace_id: request.trace_id,
    logical_sequence: request.logical_sequence,
    expected_registry_version: request.expected_registry_version,
    validator_version: request.validator_version
  };
  const registryEntityFingerprints = {
    execution_plan_request: safeFingerprint(requestShallowIdentity),
    stage_manifest: stageManifestRef.manifest_fingerprint,
    dependency_graph: depGraphRefForSnapshot.graph_fingerprint,
    provenance: safeFingerprint(provenanceRef),
    scope: scopeRef.scope_fingerprint,
    execution_plan_budget: budget.budget_fingerprint,
    idempotency_policy: idempotency.idempotency_fingerprint
  };
  const snapshotMismatch = validateSnapshotCrossChecks(snapshotRef, {
    canonical, executionPlanRequestId: request.execution_plan_request_id, executionPlanId,
    entityFingerprints: registryEntityFingerprints
  });
  if (snapshotMismatch) return buildOutcome(request, snapshotMismatch.status, [snapshotMismatch.reason], context);

  // plan/planning-result id agreement (moved up from its old late position -- it only needs data
  // already available at this point, and the required precedence table places TASK_BLOCKED near
  // the top of the evaluation order).
  if (planningRef.plan_id !== executionPlanId || taskRef.plan_id !== executionPlanId) {
    return buildOutcome(request, 'TASK_BLOCKED', ['task_reference_plan_id_mismatch'], context);
  }

  // pr99 (Problema 1): StageManifestReference cross-checks. The manifest is the sole source of
  // truth for stage_type/sequence/references/parallelism/optional/approval/estimates -- the
  // engine never derives or reconstructs any of it. Only cross-reference agreement with the rest
  // of the request, and tamper detection, are engine-level concerns; every purely-structural rule
  // (canonical sequence order, stage_ids/stage_records/stage_count agreement, no duplicates) was
  // already enforced at construction time by orchestrator-stage-manifest-reference.js, exactly
  // like PR #98fix's DependencyGraphReference.
  if (stageManifestRef.planning_result_id !== planningRef.planning_result_id) {
    return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['stage_manifest_reference_planning_result_id_mismatch'], context);
  }
  if (stageManifestRef.orchestration_plan_id !== executionPlanId) {
    return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['stage_manifest_reference_orchestration_plan_id_mismatch'], context);
  }
  if (stageManifestRef.stage_records.some((record) => record.task_reference_id !== taskRef.task_reference_id)) {
    return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['stage_record_task_reference_id_mismatch'], context);
  }
  // orchestration_plan_reference.ordered_stage_ids and planning_result_reference.stage_ids are
  // both alphabetically canonicalized lists (PR #94), not semantically ordered -- so equivalence
  // with the manifest's own stage_sequence-ordered stage_ids is checked as a set, never
  // positionally.
  const manifestStageIdSet = new Set(stageManifestRef.stage_ids);
  const planStageIdSet = new Set(planRef.ordered_stage_ids);
  const planningStageIdSet = new Set(planningRef.stage_ids);
  if (manifestStageIdSet.size !== planStageIdSet.size || ![...manifestStageIdSet].every((id) => planStageIdSet.has(id))) {
    return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['stage_manifest_reference_stage_ids_mismatch_orchestration_plan'], context);
  }
  if (manifestStageIdSet.size !== planningStageIdSet.size || ![...manifestStageIdSet].every((id) => planningStageIdSet.has(id))) {
    return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['stage_manifest_reference_stage_ids_mismatch_planning_result'], context);
  }
  // tamper detection: recompute and compare every fingerprint the manifest itself claims.
  if (computeManifestFingerprint(stageManifestRef) !== stageManifestRef.manifest_fingerprint) {
    return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['stage_manifest_reference_fingerprint_mismatch'], context);
  }
  for (const record of stageManifestRef.stage_records) {
    if (computeStageRecordFingerprint(record) !== record.stage_fingerprint) {
      return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', [`stage_record_fingerprint_mismatch::${record.stage_id}`], context);
    }
  }

  // estágios: materialized 1:1 from each StageRecord -- no inference, no reconstruction of
  // stage_type, no zeroing of parallelizable/optional/estimates. The engine can never trade
  // stage_type, reorder stages semantically, add a model/tool/workflow reference a stage's own
  // record didn't already declare, or select a different model/tool/workflow.
  const stages = stageManifestRef.stage_records.map((record) => buildExecutionPlanStage({
    execution_stage_id: record.stage_id, execution_plan_id: executionPlanId, source_orchestrator_stage_id: record.stage_id,
    stage_sequence: record.stage_sequence, stage_type: record.stage_type, task_reference_id: record.task_reference_id,
    agent_reference_id: record.agent_reference_id, memory_selection_reference_id: record.memory_selection_reference_id,
    context_assembly_reference_id: record.context_assembly_reference_id,
    model_selection_reference_id: record.model_selection_reference_id,
    tool_reference_ids: record.tool_reference_ids, workflow_reference_id: record.workflow_reference_id,
    dependency_ids: record.dependency_reference_ids,
    priority: record.priority, parallelizable: record.parallelizable, optional: record.optional,
    approval_required: record.approval_required,
    side_effect_classification: deriveSideEffectClassification(taskRef, compensationRefs, record.stage_id),
    risk_classification: taskRef.risk_classification,
    estimated_input_tokens: record.estimated_input_tokens, estimated_output_tokens: record.estimated_output_tokens,
    estimated_total_tokens: record.estimated_total_tokens, estimated_cost_minor_units: record.estimated_cost_minor_units,
    maximum_attempts_reference: idempotency.maximum_execution_attempts, timeout_reference: null,
    stage_status: 'PREPARED_SIMULATION'
  }));

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

  // bindings: built strictly from each StageRecord's own references -- never a model/tool/
  // workflow/memory/context binding for a stage whose own record does not declare one, and every
  // declared reference id must match the single decision object the request actually carries for
  // that reference type (a stage cannot silently point at "another" model/tool/workflow).
  const bindings = [];
  stages.forEach((stage, index) => {
    const record = stageManifestRef.stage_records[index];
    const stageAgentId = record.agent_reference_id || canonical.agentId;
    bindings.push(buildExecutionPlanStageBinding({
      binding_id: `${stage.execution_stage_id}-task-binding`, execution_plan_id: executionPlanId,
      execution_stage_id: stage.execution_stage_id, binding_type: 'TASK_BINDING', source_reference_id: taskRef.task_reference_id,
      source_reference_version: taskRef.task_reference_version, source_reference_fingerprint: taskRef.task_fingerprint,
      tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
      session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true, binding_validated: true
    }));
    bindings.push(buildExecutionPlanStageBinding({
      binding_id: `${stage.execution_stage_id}-agent-binding`, execution_plan_id: executionPlanId,
      execution_stage_id: stage.execution_stage_id, binding_type: 'AGENT_BINDING', source_reference_id: stageAgentId,
      source_reference_version: 1, source_reference_fingerprint: safeFingerprint(stageAgentId),
      tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
      session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true, binding_validated: true
    }));
    if (record.memory_selection_reference_id !== null) {
      bindings.push(buildExecutionPlanStageBinding({
        binding_id: `${stage.execution_stage_id}-memory-binding`, execution_plan_id: executionPlanId,
        execution_stage_id: stage.execution_stage_id, binding_type: 'MEMORY_BINDING', source_reference_id: record.memory_selection_reference_id,
        source_reference_version: 1, source_reference_fingerprint: safeFingerprint(memoryRef),
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
        binding_validated: record.memory_selection_reference_id === memoryRef.reference_id && memoryRef.decision !== 'BLOCKED'
      }));
    }
    if (record.context_assembly_reference_id !== null) {
      bindings.push(buildExecutionPlanStageBinding({
        binding_id: `${stage.execution_stage_id}-context-binding`, execution_plan_id: executionPlanId,
        execution_stage_id: stage.execution_stage_id, binding_type: 'CONTEXT_BINDING', source_reference_id: record.context_assembly_reference_id,
        source_reference_version: 1, source_reference_fingerprint: safeFingerprint(contextRef),
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
        binding_validated: record.context_assembly_reference_id === contextRef.reference_id && contextRef.decision !== 'BLOCKED'
      }));
    }
    if (record.model_selection_reference_id !== null) {
      bindings.push(buildExecutionPlanStageBinding({
        binding_id: `${stage.execution_stage_id}-selection-binding`, execution_plan_id: executionPlanId,
        execution_stage_id: stage.execution_stage_id, binding_type: 'MODEL_BINDING', source_reference_id: record.model_selection_reference_id,
        source_reference_version: 1, source_reference_fingerprint: safeFingerprint(modelRef),
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
        binding_validated: record.model_selection_reference_id === modelRef.reference_id && modelRef.decision !== 'BLOCKED'
      }));
    }
    record.tool_reference_ids.forEach((toolId, toolIndex) => {
      const toolRef = toolRefs.find((r) => r.reference_id === toolId);
      bindings.push(buildExecutionPlanStageBinding({
        binding_id: `${stage.execution_stage_id}-tool-binding-${toolIndex}`, execution_plan_id: executionPlanId,
        execution_stage_id: stage.execution_stage_id, binding_type: 'TOOL_BINDING', source_reference_id: toolId,
        source_reference_version: 1, source_reference_fingerprint: safeFingerprint(toolRef || toolId),
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
        binding_validated: Boolean(toolRef) && toolRef.decision !== 'BLOCKED'
      }));
    });
    if (record.workflow_reference_id !== null) {
      bindings.push(buildExecutionPlanStageBinding({
        binding_id: `${stage.execution_stage_id}-workflow-binding`, execution_plan_id: executionPlanId,
        execution_stage_id: stage.execution_stage_id, binding_type: 'WORKFLOW_BINDING', source_reference_id: record.workflow_reference_id,
        source_reference_version: 1, source_reference_fingerprint: safeFingerprint(workflowRef),
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        session_reference_id: canonical.sessionId, agent_id: canonical.agentId, binding_required: true,
        binding_validated: record.workflow_reference_id === workflowRef.reference_id && workflowRef.decision !== 'BLOCKED'
      }));
    }
  });
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
    // binding_validated is never coupled to budget.budget_validated here -- the binding only
    // asserts that the plan is structurally bound to *a* budget reference. Whether that budget is
    // itself within limits is a separate, more specific check (further below), and must remain
    // reachable as BUDGET_BLOCKED rather than being masked by the generic BINDING_BLOCKED, per
    // "usar status específico quando houver causa específica."
    agent_id: canonical.agentId, binding_required: true, binding_validated: true
  }));

  if (policy.fail_on_binding_mismatch === true && bindings.some((binding) => binding.binding_validated !== true)) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['stage_binding_not_validated'], context);
  }
  // A selected reference id declared by the Planner (PR #94) that this request's own
  // model/tool/workflow references do not actually carry is a genuine binding mismatch, not a
  // *_BLOCKED status for the reference itself (which is otherwise structurally fine).
  if (
    planningRef.selected_model_reference_ids.length > 0 && bindings.some((b) => b.binding_type === 'MODEL_BINDING') &&
    !planningRef.selected_model_reference_ids.includes(modelRef.reference_id)
  ) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['selected_model_reference_id_not_bound'], context);
  }
  if (
    planningRef.selected_tool_reference_ids.length > 0 && bindings.some((b) => b.binding_type === 'TOOL_BINDING') &&
    planningRef.selected_tool_reference_ids.some((id) => !toolRefs.some((r) => r.reference_id === id))
  ) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['selected_tool_reference_id_not_bound'], context);
  }
  if (
    planningRef.selected_workflow_reference_ids.length > 0 && bindings.some((b) => b.binding_type === 'WORKFLOW_BINDING') &&
    !planningRef.selected_workflow_reference_ids.includes(workflowRef.reference_id)
  ) {
    return buildOutcome(request, 'BINDING_BLOCKED', ['selected_workflow_reference_id_not_bound'], context);
  }

  // fingerprints: plan_fingerprint agreement, plus task_reference tamper detection.
  if (planningRef.plan_fingerprint !== planRef.plan_fingerprint) {
    return buildOutcome(request, 'FINGERPRINT_BLOCKED', ['plan_fingerprint_mismatch_between_planning_result_and_plan_reference'], context);
  }
  if (computeTaskReferenceFingerprint(taskRef) !== taskRef.task_fingerprint) {
    return buildOutcome(request, 'FINGERPRINT_BLOCKED', ['task_reference_fingerprint_mismatch'], context);
  }

  // pr100: context is never read for any decisional condition -- registry_snapshot_reference
  // (validated above, step 5) is the sole source of registry-version agreement now, replacing the
  // last context.currentRegistryVersion side-channel this engine ever had (context.dependencyRecords
  // was already removed in pr98fix). A dedicated test proves context.currentRegistryVersion,
  // context.authorizationScope, context.bindingRecords, and context.anything are all inert.

  // escopo autorizado: pr100's AuthorizationScopeReference (validated above, step 4) is now the
  // real source of authorized scope, replacing the tenant/organization/project/session/agent
  // bindings-only substitute this PR's own predecessor relied on. See docs.

  // orçamento: validado, e as estimativas dos estágios (agora reais, nunca zeradas) devem
  // concordar exatamente com o planning result, o orchestration plan e o próprio budget --
  // nenhuma divergência é ajustada silenciosamente.
  if (budget.budget_validated !== true) {
    return buildOutcome(request, 'BUDGET_BLOCKED', ['execution_plan_budget_not_validated'], context);
  }
  const estimatedInputTokens = stages.reduce((sum, s) => sum + s.estimated_input_tokens, 0);
  const estimatedOutputTokens = stages.reduce((sum, s) => sum + s.estimated_output_tokens, 0);
  const estimatedTotalTokens = stages.reduce((sum, s) => sum + s.estimated_total_tokens, 0);
  const estimatedTotalCost = stages.reduce((sum, s) => sum + s.estimated_cost_minor_units, 0);
  if (estimatedTotalTokens !== planningRef.estimated_total_tokens || estimatedTotalCost !== planningRef.estimated_total_cost_minor_units) {
    return buildOutcome(request, 'BUDGET_BLOCKED', ['stage_estimates_mismatch_planning_result'], context);
  }
  if (estimatedTotalTokens !== planRef.estimated_total_tokens || estimatedTotalCost !== planRef.estimated_total_cost_minor_units) {
    return buildOutcome(request, 'BUDGET_BLOCKED', ['stage_estimates_mismatch_orchestration_plan'], context);
  }
  if (
    estimatedInputTokens !== budget.estimated_input_tokens || estimatedOutputTokens !== budget.estimated_output_tokens ||
    estimatedTotalTokens !== budget.estimated_total_tokens || estimatedTotalCost !== budget.estimated_total_cost_minor_units
  ) {
    return buildOutcome(request, 'BUDGET_BLOCKED', ['stage_estimates_mismatch_execution_plan_budget'], context);
  }
  const modelStageCount = stages.filter((s) => s.stage_type === 'MODEL_REFERENCE_STAGE').length;
  const toolStageCount = stages.filter((s) => s.stage_type === 'TOOL_REFERENCE_STAGE').length;
  const workflowStageCount = stages.filter((s) => s.stage_type === 'WORKFLOW_REFERENCE_STAGE').length;
  const parallelStageCount = stages.filter((s) => s.parallelizable === true).length;
  if (modelStageCount > budget.maximum_model_stages) return buildOutcome(request, 'BUDGET_BLOCKED', ['model_stage_count_exceeds_budget'], context);
  if (toolStageCount > budget.maximum_tool_stages) return buildOutcome(request, 'BUDGET_BLOCKED', ['tool_stage_count_exceeds_budget'], context);
  if (workflowStageCount > budget.maximum_workflow_stages) return buildOutcome(request, 'BUDGET_BLOCKED', ['workflow_stage_count_exceeds_budget'], context);
  if (parallelStageCount > budget.maximum_parallel_stages) return buildOutcome(request, 'BUDGET_BLOCKED', ['parallel_stage_count_exceeds_budget'], context);

  // dependências (pr98fix, augmented by pr99). DependencyGraphReference remains the sole source
  // of edges; context.dependencyRecords is still never read anywhere in this file. New for pr99:
  // the graph and the manifest must agree on exactly which dependency ids exist and which stage
  // each targets, and a PARALLEL_REFERENCE edge's target stage must itself be parallelizable.
  const depGraphRef = request.dependency_graph_reference;
  const depGraphMismatch = checkBinding(depGraphRef, canonical, 'dependency_graph_reference', 'session_reference_id');
  if (depGraphMismatch) return buildOutcome(request, depGraphMismatch.status, [depGraphMismatch.reason], context);
  if (depGraphRef.execution_plan_id !== executionPlanId) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_graph_reference_execution_plan_id_mismatch'], context);
  }
  if (depGraphRef.planning_result_id !== planningRef.planning_result_id) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_graph_reference_planning_result_id_mismatch'], context);
  }
  if (depGraphRef.orchestration_plan_id !== planRef.plan_id) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_graph_reference_orchestration_plan_id_mismatch'], context);
  }
  const stageIdSet = new Set(planRef.ordered_stage_ids);
  const depGraphStageIdSet = new Set(depGraphRef.stage_ids);
  if (depGraphRef.stage_ids.length !== planRef.ordered_stage_ids.length || ![...depGraphStageIdSet].every((id) => stageIdSet.has(id))) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_graph_reference_stage_ids_mismatch'], context);
  }
  if (computeDependencyGraphReferenceFingerprint(depGraphRef) !== depGraphRef.graph_fingerprint) {
    return buildOutcome(request, 'FINGERPRINT_BLOCKED', ['dependency_graph_reference_fingerprint_mismatch'], context);
  }
  const dependencyRecords = depGraphRef.dependency_records;

  const manifestDependencyIds = new Set(stageManifestRef.stage_records.flatMap((record) => record.dependency_reference_ids));
  const graphDependencyIds = new Set(dependencyRecords.map((record) => record.dependency_id));
  if (manifestDependencyIds.size !== graphDependencyIds.size || ![...manifestDependencyIds].every((id) => graphDependencyIds.has(id))) {
    return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['stage_manifest_dependency_ids_not_equivalent_to_dependency_graph'], context);
  }
  const stageRecordById = new Map(stageManifestRef.stage_records.map((record) => [record.stage_id, record]));
  for (const dependencyRecord of dependencyRecords) {
    const toStage = stageRecordById.get(dependencyRecord.to_stage_id);
    if (!toStage || !toStage.dependency_reference_ids.includes(dependencyRecord.dependency_id)) {
      return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['dependency_graph_dependency_id_not_present_on_target_stage_record'], context);
    }
    const fromStage = stageRecordById.get(dependencyRecord.from_stage_id);
    if (!fromStage) {
      return buildOutcome(request, 'STAGE_MANIFEST_BLOCKED', ['dependency_graph_from_stage_not_in_manifest'], context);
    }
    if (dependencyRecord.dependency_type === 'PARALLEL_REFERENCE') {
      if (toStage.parallelizable !== true) {
        return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['parallel_dependency_target_stage_not_parallelizable'], context);
      }
    } else if (fromStage.stage_sequence >= toStage.stage_sequence) {
      return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['dependency_reverses_planner_semantic_order'], context);
    }
  }
  const parallelStageIds = new Set(dependencyRecords.filter((record) => record.dependency_type === 'PARALLEL_REFERENCE').flatMap((record) => [record.from_stage_id, record.to_stage_id]));
  if (parallelStageIds.size > 0 && policy.allow_parallel_stage !== true) {
    return buildOutcome(request, 'DEPENDENCY_BLOCKED', ['parallel_stage_not_allowed_by_policy'], context);
  }
  const dependencies = dependencyRecords.map((record) => buildExecutionPlanDependency({
    dependency_id: record.dependency_id, execution_plan_id: executionPlanId,
    from_stage_id: record.from_stage_id, to_stage_id: record.to_stage_id,
    dependency_type: record.dependency_type, required: record.required === true, dependency_validated: true
  }));

  // idempotência.
  if (policy.require_idempotency === true && idempotency.idempotency_validated !== true) {
    return buildOutcome(request, 'IDEMPOTENCY_BLOCKED', ['idempotency_not_validated'], context);
  }

  // condições de parada.
  if (policy.require_stop_conditions === true && stopConditionRefs.length === 0) {
    return buildOutcome(request, 'STOP_CONDITION_BLOCKED', ['no_stop_conditions_declared'], context);
  }

  // compensações declarativas: every STATE_CHANGE_REFERENCE stage needs at least one non-NONE
  // compensation reference targeting it.
  const stateChangeStages = stages.filter((stage) => stage.side_effect_classification === 'STATE_CHANGE_REFERENCE');
  for (const stage of stateChangeStages) {
    const covered = compensationRefs.some((reference) => reference.execution_stage_id === stage.execution_stage_id && reference.compensation_type !== 'NONE');
    if (!covered) {
      return buildOutcome(request, 'COMPENSATION_BLOCKED', ['state_change_stage_missing_compensation'], context);
    }
  }

  // pr100 (steps 13-14): every already-computed ExecutionPlanStageBinding is wrapped into a
  // BindingRecord, reference-level BindingRecords are appended for the scope/provenance/snapshot/
  // manifest/dependency-graph/idempotency/stop-conditions/compensations this evaluation already
  // validated above, and the whole set is consolidated into one BindingLedger. This never applies
  // a binding, resolves a reference's content, or authorizes/starts execution -- only validates
  // and records.
  // request_fingerprint on IdempotencyPolicyReference predates this PR's own registry snapshot
  // envelope and is never cross-checked against the live request here -- see docs "Limitações".
  const ledger = buildBindingLedgerForPlan({
    stageBindings: bindings, provenanceRef, scopeRef, snapshotRef, stageManifestRef,
    depGraphRef, idempotency, stopConditions: stopConditionRefs, compensations: compensationRefs,
    canonical, executionPlanId, executionPlanRequestId: request.execution_plan_request_id, authzRef, logicalSequence,
    planFingerprint: planRef.plan_fingerprint, validStageIds: stages.map((s) => s.execution_stage_id)
  });
  if (ledger.references_bound_in_simulation !== true) {
    return buildOutcome(request, 'REFERENCE_BINDING_BLOCKED', ['reference_binding_not_fully_bound'], context, {
      stages, bindings, dependencies, estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens, estimatedTotalCost, ledger
    });
  }

  // approval: mirrors PR #95/#97's own WAITING_APPROVAL_SIMULATION-style pattern. A plan whose
  // approval_stage_ids are non-empty still waits, even though HUMAN_APPROVAL_STAGE stages are now
  // sourced from the manifest rather than derived -- the Authorization Decision already
  // represents simulated authorization for *preparation*, never a substitute for the specific
  // human approval PR #94's own planning result declared this plan still needs.
  if (planningRef.approval_stage_ids.length > 0) {
    return buildOutcome(request, 'WAITING_APPROVAL_REFERENCE', ['waiting_for_stage_approval_reference'], context, {
      stages, bindings, dependencies, estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens, estimatedTotalCost, ledger
    });
  }

  // gerar execution plan, resultado, auditoria.
  return buildOutcome(request, 'EXECUTION_PLAN_PREPARED_SIMULATION', ['execution_plan_prepared_simulation_only'], context, {
    stages, bindings, dependencies, estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens, estimatedTotalCost, ledger
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
  const dependencyGraphRef = isPlainObject(requestSafe.dependency_graph_reference) ? requestSafe.dependency_graph_reference : {};
  const stageManifestRef = isPlainObject(requestSafe.stage_manifest_reference) ? requestSafe.stage_manifest_reference : {};
  const provenanceRef = isPlainObject(requestSafe.authorization_provenance_reference) ? requestSafe.authorization_provenance_reference : {};
  const scopeRef = isPlainObject(requestSafe.authorization_scope_reference) ? requestSafe.authorization_scope_reference : {};
  const snapshotRef = isPlainObject(requestSafe.registry_snapshot_reference) ? requestSafe.registry_snapshot_reference : {};

  const logicalSequence = Number.isInteger(requestSafe.logical_sequence) ? requestSafe.logical_sequence : 0;
  const executionPlanId = planRef.plan_id || 'plan_not_available';
  const stages = materialized && Array.isArray(materialized.stages) ? materialized.stages : [];
  const bindings = materialized && Array.isArray(materialized.bindings) ? materialized.bindings : [];
  const dependencies = materialized && Array.isArray(materialized.dependencies) ? materialized.dependencies : [];
  const stopConditions = Array.isArray(requestSafe.stop_condition_references) ? requestSafe.stop_condition_references : [];
  const compensations = Array.isArray(requestSafe.compensation_references) ? requestSafe.compensation_references : [];
  const stageManifestFingerprint = stageManifestRef.manifest_fingerprint || 'fingerprint_not_available';
  // AuthorizationProvenanceReference carries no self-fingerprint field by design (see docs) --
  // its fingerprint is always computed externally here, the same way memory_fingerprint/
  // context_fingerprint already are for other referenceless-fingerprint objects.
  const provenanceFingerprint = isPlainObject(requestSafe.authorization_provenance_reference) ? safeFingerprint(provenanceRef) : 'fingerprint_not_available';
  const ledger = materialized && isPlainObject(materialized.ledger) ? materialized.ledger : {};

  // pr101: derives the ValidationLedger this evaluation's own already-computed `status` implies,
  // via validation-pipeline.js's post-hoc derivation -- see that module's own comment for why this
  // doesn't re-run a forward pipeline against this function's existing, already-tested control
  // flow. Every legacy `*_validated` flag below that used to be hardcoded true regardless of
  // status is now read from this ledger instead.
  const validationLedger = deriveValidationLedgerFromStatus({
    status,
    reasonCodes,
    ledgerIdentity: {
      validation_ledger_id: `${executionPlanId}-validation-ledger`,
      execution_plan_request_id: requestSafe.execution_plan_request_id || null,
      execution_plan_id: executionPlanId,
      tenant_id: authzRef.tenant_id || 'tenant_not_available',
      organization_id: authzRef.organization_id || 'organization_not_available',
      project_id: authzRef.project_id || 'project_not_available',
      session_reference_id: authzRef.session_reference_id || 'session_not_available',
      agent_id: authzRef.agent_id || 'agent_not_available',
      actor_id: scopeRef.actor_id || 'actor_not_available',
      logical_sequence: logicalSequence
    }
  });

  const requestFingerprint = isPlainObject(request) ? safeFingerprint(request) : 'fingerprint_not_available';

  // pr99 (Problema 3): the weak plan_id+stage_ids-only fingerprint is replaced by a canonical
  // package covering the manifest, dependencies, bindings, budget, idempotency, stops,
  // compensations, and every upstream reference fingerprint -- see execution-plan-package-
  // integrity.js and docs "Canonical fingerprint versus autenticidade".
  const executionPlanPackage = buildExecutionPlanPackage({
    execution_plan_id: executionPlanId,
    execution_plan_version: 1,
    authorization_decision_fingerprint: authzRef.authorization_decision_fingerprint,
    orchestrator_decision_fingerprint: decisionRef.decision_fingerprint,
    readiness_bundle_fingerprint: bundleRef.bundle_fingerprint,
    planning_result_fingerprint: planningRef.planning_result_fingerprint,
    orchestration_plan_fingerprint: planRef.plan_fingerprint,
    task_fingerprint: taskRef.task_fingerprint,
    stage_manifest_reference_id: stageManifestRef.stage_manifest_reference_id,
    stage_manifest_fingerprint: stageManifestFingerprint,
    dependency_graph_fingerprint: dependencyGraphRef.graph_fingerprint,
    budget_fingerprint: budget.budget_fingerprint,
    idempotency_fingerprint: idempotency.idempotency_fingerprint,
    memory_fingerprint: safeFingerprint(memoryRef),
    context_fingerprint: safeFingerprint(contextRef),
    model_fingerprint: isPlainObject(requestSafe.model_selection_reference) ? safeFingerprint(modelRef) : null,
    tool_fingerprints: toolRefs.map((r) => safeFingerprint(r)),
    workflow_fingerprint: isPlainObject(requestSafe.workflow_decision_reference) ? safeFingerprint(workflowRef) : null,
    ordered_stage_ids: stages.map((s) => s.execution_stage_id),
    stage_fingerprints: Array.isArray(stageManifestRef.stage_records) ? stageManifestRef.stage_records.map((r) => r.stage_fingerprint) : [],
    dependency_ids: dependencies.map((d) => d.dependency_id),
    dependency_fingerprints: dependencies.map((d) => d.dependency_fingerprint),
    binding_ids: bindings.map((b) => b.binding_id),
    binding_fingerprints: bindings.map((b) => b.binding_fingerprint),
    stop_condition_ids: stopConditions.map((c) => c.stop_condition_id),
    stop_condition_fingerprints: stopConditions.map((c) => c.condition_fingerprint),
    compensation_reference_ids: compensations.map((c) => c.compensation_reference_id),
    compensation_fingerprints: compensations.map((c) => c.compensation_fingerprint),
    authorization_provenance_fingerprint: provenanceFingerprint,
    authorization_scope_fingerprint: scopeRef.scope_fingerprint,
    registry_snapshot_fingerprint: snapshotRef.snapshot_fingerprint,
    binding_ledger_fingerprint: ledger.ledger_fingerprint,
    binding_record_ids: Array.isArray(ledger.binding_record_ids) ? ledger.binding_record_ids : [],
    binding_record_fingerprints: Array.isArray(ledger.binding_records) ? ledger.binding_records.map((r) => r.binding_record_fingerprint) : [],
    estimated_input_tokens: materialized ? materialized.estimatedInputTokens : 0,
    estimated_output_tokens: materialized ? materialized.estimatedOutputTokens : 0,
    estimated_total_tokens: materialized ? materialized.estimatedTotalTokens : 0,
    estimated_total_cost_minor_units: materialized ? materialized.estimatedTotalCost : 0,
    logical_sequence: logicalSequence
  });
  // pr99fix (Fix 2): a package awaiting approval is just as fully materialized (stages,
  // bindings, dependencies, estimates, manifest, dependency graph, budget, idempotency, stop
  // conditions, compensations) as a prepared one -- it needs a real canonical fingerprint too, so
  // a future approved package can be compared against the one that was actually reviewed.
  // `materialized` is only ever passed (truthy) for EXECUTION_PLAN_PREPARED_SIMULATION and
  // WAITING_APPROVAL_REFERENCE; every earlier blocked status computes no fingerprint here.
  const executionPlanFingerprint = materialized
    ? computeExecutionPlanPackageFingerprint(executionPlanPackage)
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
    // pr100 fix: previously the execution plan's own id, standing in for a real authorized scope
    // -- now the actual AuthorizationScopeReference this plan was bound against (docs: "O campo
    // execution_scope_reference_id aponta para o AuthorizationScopeReference real, nunca para o
    // próprio Execution Plan.").
    execution_scope_reference_id: scopeRef.authorization_scope_reference_id || 'authorization_scope_reference_not_available',
    stage_manifest_reference_id: stageManifestRef.stage_manifest_reference_id || 'stage_manifest_reference_not_available',
    stage_manifest_fingerprint: stageManifestFingerprint,
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
    authorization_provenance_reference_id: provenanceRef.authorization_provenance_reference_id || 'authorization_provenance_reference_not_available',
    authorization_provenance_fingerprint: provenanceFingerprint,
    authorization_scope_reference_id: scopeRef.authorization_scope_reference_id || 'authorization_scope_reference_not_available',
    authorization_scope_fingerprint: scopeRef.scope_fingerprint || 'fingerprint_not_available',
    registry_snapshot_reference_id: snapshotRef.registry_snapshot_reference_id || 'registry_snapshot_reference_not_available',
    registry_snapshot_fingerprint: snapshotRef.snapshot_fingerprint || 'fingerprint_not_available',
    binding_ledger_id: ledger.binding_ledger_id || 'binding_ledger_not_available',
    binding_ledger_fingerprint: ledger.ledger_fingerprint || 'fingerprint_not_available',
    validation_ledger_id: validationLedger.validation_ledger_id,
    validation_ledger_fingerprint: validationLedger.ledger_fingerprint,
    validation_pipeline_completed: validationLedger.pipeline_completed,
    architecture_gates_passed: true,
    logical_sequence: logicalSequence
  });

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
    dependency_graph_fingerprint: dependencyGraphRef.graph_fingerprint,
    stage_manifest_reference_id: stageManifestRef.stage_manifest_reference_id,
    stage_manifest_fingerprint: stageManifestFingerprint,
    execution_plan_fingerprint: executionPlanFingerprint,
    authorization_provenance_reference_id: provenanceRef.authorization_provenance_reference_id,
    authorization_provenance_fingerprint: provenanceFingerprint,
    authorization_scope_reference_id: scopeRef.authorization_scope_reference_id,
    authorization_scope_fingerprint: scopeRef.scope_fingerprint,
    registry_snapshot_reference_id: snapshotRef.registry_snapshot_reference_id,
    registry_snapshot_fingerprint: snapshotRef.snapshot_fingerprint,
    binding_ledger_id: ledger.binding_ledger_id,
    binding_ledger_fingerprint: ledger.ledger_fingerprint,
    validation_ledger_id: validationLedger.validation_ledger_id,
    validation_ledger_fingerprint: validationLedger.ledger_fingerprint,
    validation_pipeline_completed: validationLedger.pipeline_completed,
    all_required_validations_valid: validationLedger.all_required_validations_valid,
    first_blocking_stage: validationLedger.first_blocking_stage,
    first_blocking_status: validationLedger.first_blocking_status,
    architecture_gates_passed: true,
    registry_version: requestSafe.expected_registry_version,
    stage_count: stages.length,
    dependency_count: dependencies.length,
    binding_count: bindings.length,
    stop_condition_count: stopConditions.length,
    compensation_count: compensations.length,
    estimated_input_tokens: materialized ? materialized.estimatedInputTokens : 0,
    estimated_output_tokens: materialized ? materialized.estimatedOutputTokens : 0,
    estimated_total_tokens: materialized ? materialized.estimatedTotalTokens : 0,
    estimated_total_cost_minor_units: materialized ? materialized.estimatedTotalCost : 0,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    request_validated: status !== 'VALIDATION_FAILED',
    // pr101: previously hardcoded true regardless of what this evaluation actually reached --
    // now read from the ValidationLedger's own per-stage outcomes, so a plan blocked at (say)
    // BUDGET honestly reports authorization_validated=true (that stage really did pass) but
    // idempotency_validated=false (that stage was never reached, not merely "unchecked but fine").
    authorization_validated: isStageValid(validationLedger, 'AUTHORIZATION'),
    evidence_validated: isStageValid(validationLedger, 'EVIDENCE'),
    bindings_validated: isStageValid(validationLedger, 'REFERENCE_BINDING'),
    budget_validated: isStageValid(validationLedger, 'BUDGET'),
    dependencies_validated: isStageValid(validationLedger, 'DEPENDENCY_GRAPH'),
    idempotency_validated: isStageValid(validationLedger, 'IDEMPOTENCY'),
    stop_conditions_validated: isStageValid(validationLedger, 'STOP_CONDITIONS'),
    compensations_validated: isStageValid(validationLedger, 'COMPENSATIONS')
  });

  const stageTypeCounts = stages.reduce((counts, stage) => {
    counts[stage.stage_type] = (counts[stage.stage_type] || 0) + 1;
    return counts;
  }, {});

  const audit = buildExecutionPlanAudit({
    result, plan, stages, stopConditions, compensations, reasonCodes, logicalSequence,
    dependencyGraphReferenceId: dependencyGraphRef.dependency_graph_reference_id,
    stageManifestReferenceId: stageManifestRef.stage_manifest_reference_id,
    stageManifestFingerprint,
    stageManifestValidated: result.stage_manifest_validated,
    stageTypeCounts,
    parallelStageCount: stages.filter((s) => s.parallelizable === true).length,
    optionalStageCount: stages.filter((s) => s.optional === true).length,
    approvalStageCount: stages.filter((s) => s.approval_required === true).length,
    estimatedInputTokens: materialized ? materialized.estimatedInputTokens : 0,
    estimatedOutputTokens: materialized ? materialized.estimatedOutputTokens : 0,
    validatedBindingCount: Number.isInteger(ledger.validated_binding_count) ? ledger.validated_binding_count : 0,
    blockedBindingCount: Number.isInteger(ledger.blocked_binding_count) ? ledger.blocked_binding_count : 0
  });

  // pr100: the ledger status this evaluation actually reached, translated into the same
  // *_BLOCKED/REFERENCES_BOUND_SIMULATION vocabulary the ledger itself already uses -- a plan
  // blocked for any OTHER reason (budget, dependency, idempotency, etc.) still produces a
  // structurally valid binding result/audit reflecting whatever ledger state existed at that
  // point (empty if the plan never reached binding-ledger construction).
  const bindingLedgerStatus = ledger.ledger_status || 'VALIDATION_FAILED';
  const bindingResult = buildExecutionReferenceBindingResult({
    binding_result_id: `${requestSafe.execution_plan_request_id || 'execution_plan_request_not_available'}-binding-result`,
    execution_plan_request_id: requestSafe.execution_plan_request_id || 'execution_plan_request_not_available',
    execution_plan_id: executionPlanId,
    binding_ledger_id: ledger.binding_ledger_id || 'binding_ledger_not_available',
    binding_ledger_fingerprint: ledger.ledger_fingerprint || 'fingerprint_not_available',
    tenant_id: authzRef.tenant_id || 'tenant_not_available',
    organization_id: authzRef.organization_id || 'organization_not_available',
    project_id: authzRef.project_id || 'project_not_available',
    session_reference_id: authzRef.session_reference_id || 'session_not_available',
    agent_id: authzRef.agent_id || 'agent_not_available',
    actor_id: scopeRef.actor_id || 'actor_not_available',
    status: bindingLedgerStatus,
    reason_codes: reasonCodes,
    logical_sequence: logicalSequence
  });

  const bindingAudit = buildExecutionReferenceBindingAudit({
    ledger, provenanceRef, scopeRef, snapshotRef, provenanceFingerprint, reasonCodes
  });

  return { plan, result, audit, bindingResult, bindingAudit };
}

module.exports = {
  evaluateExecutionPlanRequest
};
