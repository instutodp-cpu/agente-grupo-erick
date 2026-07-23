'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const {
  validateExecutionAuthorizationRequest, isOrchestratorDecisionReady, isEvidenceBundleReady
} = require('./execution-authorization-request');
const { isActorFullyVerified } = require('./execution-authorization-actor-context');
const { computeTaskReferenceFingerprint } = require('./execution-authorization-task-reference');
const { APPROVAL_READY_STATES } = require('./execution-authorization-approval-reference');
const { AUTHORIZATION_STATUSES, buildExecutionAuthorizationDecision } = require('./execution-authorization-decision');
const { buildExecutionAuthorizationAudit } = require('./execution-authorization-audit');

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

// A subset of ACTOR_ROLES this boundary considers compatible with HIGH-risk authorizations (per
// "HIGH exige papel e política compatíveis"). The spec names no concrete role list, so this is a
// deliberate, documented judgment call (see HERMES_EXECUTION_AUTHORIZATION_BOUNDARY.md).
const HIGH_RISK_COMPATIBLE_ROLES = Object.freeze(['ADMIN', 'MANAGER', 'SUPERVISOR']);

// PR #96's ReadinessEvidenceBundle has its own bundle_status vocabulary (10 values), only 4 of
// which are literal AUTHORIZATION_STATUSES names. The rest are translated to their closest
// semantic equivalent here; anything left over degrades to VALIDATION_FAILED.
const EVIDENCE_BUNDLE_STATUS_TRANSLATION = Object.freeze({
  BUDGET_EVIDENCE_BLOCKED: 'BUDGET_BLOCKED',
  CONFLICT_EVIDENCE_BLOCKED: 'CONFLICT_BLOCKED'
});

function translateOrchestratorStatus(status) {
  if (status === 'READY_SIMULATION') return null;
  if (AUTHORIZATION_STATUSES.includes(status)) return status;
  return 'UNKNOWN_STATUS_BLOCKED';
}

function translateEvidenceBundleStatus(status) {
  if (status === 'READY_EVIDENCE_SIMULATION') return null;
  if (AUTHORIZATION_STATUSES.includes(status)) return status;
  if (EVIDENCE_BUNDLE_STATUS_TRANSLATION[status]) return EVIDENCE_BUNDLE_STATUS_TRANSLATION[status];
  return 'VALIDATION_FAILED';
}

function checkBinding(reference, canonical, label, options = {}) {
  if (!isPlainObject(reference)) return null;
  if (reference.tenant_id !== canonical.tenantId) return { status: 'TENANT_BLOCKED', reason: `${label}_tenant_mismatch` };
  if (reference.organization_id !== canonical.organizationId) return { status: 'ORGANIZATION_BLOCKED', reason: `${label}_organization_mismatch` };
  if (options.checkAgent && reference.agent_id !== canonical.agentId) return { status: 'VALIDATION_FAILED', reason: `${label}_agent_mismatch` };
  if (options.checkProject && reference.project_id !== canonical.projectId) return { status: 'PROJECT_BLOCKED', reason: `${label}_project_mismatch` };
  if (options.checkSession && reference.session_reference_id !== canonical.sessionId) return { status: 'SESSION_BLOCKED', reason: `${label}_session_mismatch` };
  return null;
}

function evaluateExecutionAuthorizationRequest(request, context = {}) {
  // 1-2. request contract shape, including simulation_context as one of its nested fields.
  const requestValidation = validateExecutionAuthorizationRequest(request);
  if (!requestValidation.valid) {
    return buildOutcome(request, 'VALIDATION_FAILED', ['execution_authorization_request_invalid'], context);
  }

  const decisionRef = request.orchestrator_decision_reference;
  const bundleRef = request.readiness_evidence_bundle_reference;
  const planningRef = request.planning_result_reference;
  const planRef = request.orchestration_plan_reference;
  const taskRef = request.task_reference;
  const policy = request.authorization_policy;
  const scope = request.authorization_scope;
  const actor = request.actor_context;
  const approval = request.approval_reference;
  const budget = request.budget_authorization_reference;
  const expiration = request.expiration_evaluation;
  const logicalSequence = request.logical_sequence;

  // 3. decisão do Orchestrator (PR #95).
  const orchestratorTranslated = translateOrchestratorStatus(decisionRef.status);
  if (orchestratorTranslated) {
    return buildOutcome(request, orchestratorTranslated, [`orchestrator_decision_status::${decisionRef.status}`], context);
  }
  if (!isOrchestratorDecisionReady(decisionRef)) {
    return buildOutcome(request, 'VALIDATION_FAILED', ['orchestrator_decision_reference_inconsistent'], context);
  }

  // 4. readiness evidence bundle (PR #96).
  const bundleTranslated = translateEvidenceBundleStatus(bundleRef.bundle_status);
  if (bundleTranslated) {
    return buildOutcome(request, bundleTranslated, [`readiness_evidence_bundle_status::${bundleRef.bundle_status}`], context);
  }
  if (!isEvidenceBundleReady(bundleRef)) {
    return buildOutcome(request, 'VALIDATION_FAILED', ['readiness_evidence_bundle_reference_inconsistent'], context);
  }

  // 5-9. tenant / organização / agent / projeto / sessão, across every object carrying identity.
  const canonical = {
    tenantId: decisionRef.tenant_id, organizationId: decisionRef.organization_id, agentId: decisionRef.agent_id,
    projectId: decisionRef.project_id, sessionId: decisionRef.session_reference_id
  };
  const bindingChecks = [
    ['readiness_evidence_bundle_reference', bundleRef, { checkAgent: true, checkProject: true, checkSession: true }],
    ['planning_result_reference', planningRef, { checkAgent: true, checkProject: true, checkSession: true }],
    ['orchestration_plan_reference', planRef, { checkAgent: true, checkProject: true, checkSession: true }],
    ['task_reference', taskRef, { checkAgent: true, checkProject: true, checkSession: true }],
    ['authorization_scope', scope, {}],
    ['actor_context', actor, { checkProject: true, checkSession: true }],
    ['approval_reference', approval, { checkProject: true, checkSession: true }],
    ['budget_authorization_reference', budget, { checkProject: true, checkSession: true }]
  ];
  for (const [label, reference, options] of bindingChecks) {
    const mismatch = checkBinding(reference, canonical, label, options);
    if (mismatch) return buildOutcome(request, mismatch.status, [mismatch.reason], context);
  }

  // 10. plan e planning result.
  const planIds = [decisionRef.plan_id, bundleRef.plan_id, planningRef.plan_id, planRef.plan_id, taskRef.plan_id];
  if (planIds.some((id) => id !== planIds[0])) {
    return buildOutcome(request, 'PLAN_BLOCKED', ['plan_id_inconsistent_across_references'], context);
  }
  const planningResultIds = [decisionRef.planning_result_id, bundleRef.planning_result_id, planningRef.planning_result_id, taskRef.planning_result_id];
  if (planningResultIds.some((id) => id !== planningResultIds[0])) {
    return buildOutcome(request, 'PLAN_BLOCKED', ['planning_result_id_inconsistent_across_references'], context);
  }

  // 11. versão (side-channel, mirroring PR #95/#96's own registry-version check pattern).
  if (isNonEmptyString(context.currentRegistryVersion) && context.currentRegistryVersion !== request.expected_registry_version) {
    return buildOutcome(request, 'VERSION_BLOCKED', ['expected_registry_version_mismatch'], context);
  }

  // 12. fingerprints (plan_fingerprint agreement between planning result and plan reference, and
  // task_reference's own fingerprint recomputed and compared -- tamper detection, exactly like
  // PR #96's evidence references).
  if (planningRef.plan_fingerprint !== planRef.plan_fingerprint) {
    return buildOutcome(request, 'FINGERPRINT_BLOCKED', ['plan_fingerprint_mismatch_between_planning_result_and_plan_reference'], context);
  }
  if (computeTaskReferenceFingerprint(taskRef) !== taskRef.task_fingerprint) {
    return buildOutcome(request, 'FINGERPRINT_BLOCKED', ['task_reference_fingerprint_mismatch'], context);
  }

  // 13. ator.
  if (!isActorFullyVerified(actor)) {
    return buildOutcome(request, 'ACTOR_BLOCKED', ['actor_not_fully_verified'], context);
  }

  // 14. papel.
  if (scope.allowed_actor_roles.length === 0 || !scope.allowed_actor_roles.includes(actor.actor_role)) {
    return buildOutcome(request, 'ROLE_BLOCKED', ['actor_role_not_authorized_by_scope'], context);
  }

  // 15. escopo. An empty allowed-id list never authorizes anything ("escopo vazio não concede
  // autorização"), and cross-tenant/organization/project/session references are already
  // structurally impossible (scope's cross_*_allowed flags are always forced false).
  const scopeChecks = [
    [scope.allowed_agent_ids, canonical.agentId, 'agent_not_in_scope'],
    [scope.allowed_project_ids, canonical.projectId, 'project_not_in_scope'],
    [scope.allowed_session_reference_ids, canonical.sessionId, 'session_not_in_scope'],
    [scope.allowed_plan_ids, planIds[0], 'plan_not_in_scope'],
    [scope.allowed_actor_ids, actor.actor_id, 'actor_not_in_scope']
  ];
  for (const [allowedList, value, reason] of scopeChecks) {
    if (allowedList.length === 0 || !allowedList.includes(value)) {
      return buildOutcome(request, 'SCOPE_BLOCKED', [reason], context);
    }
  }
  if (planningRef.selected_tool_reference_ids.length > 0) {
    const missingTool = planningRef.selected_tool_reference_ids.find((id) => !scope.allowed_tool_reference_ids.includes(id));
    if (missingTool) return buildOutcome(request, 'SCOPE_BLOCKED', ['tool_reference_not_in_scope'], context);
  }
  if (planningRef.selected_workflow_reference_ids.length > 0) {
    const missingWorkflow = planningRef.selected_workflow_reference_ids.find((id) => !scope.allowed_workflow_reference_ids.includes(id));
    if (missingWorkflow) return buildOutcome(request, 'SCOPE_BLOCKED', ['workflow_reference_not_in_scope'], context);
  }
  if (!scope.allowed_task_types.includes(taskRef.task_type)) {
    return buildOutcome(request, 'SCOPE_BLOCKED', ['task_type_not_in_scope'], context);
  }

  // 16. risco. The risk classification being authorized now comes exclusively from
  // task_reference.risk_classification -- a minimal, versioned, fingerprinted reference bound to
  // this same tenant/organization/project/session/agent/plan/planning_result (validated above),
  // never from a loose out-of-band parameter. See HERMES_EXECUTION_AUTHORIZATION_BOUNDARY.md
  // "Risco" for why this replaced the earlier context.riskClassification side-channel.
  const riskClassification = taskRef.risk_classification;
  // Defensive re-check: execution-authorization-task-reference.js's own safe flags already force
  // both of these false, so a task_reference carrying either as true fails request validation
  // (step 1-2, VALIDATION_FAILED) long before this line -- these two checks are unreachable in
  // practice today, kept only as belt-and-suspenders per the spec's explicit instruction that
  // both must block in this PR.
  if (taskRef.external_side_effect_reference === true) {
    return buildOutcome(request, 'RISK_BLOCKED', ['external_side_effect_reference_not_allowed'], context);
  }
  if (taskRef.irreversible_reference === true) {
    return buildOutcome(request, 'RISK_BLOCKED', ['irreversible_reference_not_allowed'], context);
  }
  if (riskClassification === 'RESTRICTED') {
    return buildOutcome(request, 'RISK_BLOCKED', ['restricted_risk_always_blocks'], context);
  }
  if (!scope.allowed_risk_classifications.includes(riskClassification)) {
    return buildOutcome(request, 'RISK_BLOCKED', ['risk_classification_not_in_scope'], context);
  }
  if (riskClassification === 'HIGH' && !HIGH_RISK_COMPATIBLE_ROLES.includes(actor.actor_role)) {
    return buildOutcome(request, 'RISK_BLOCKED', ['high_risk_requires_compatible_role'], context);
  }
  // CRITICAL risk requires a declared, compatible approval mechanism -- an approval reference
  // that says NOT_REQUIRED for a critical-risk action is itself a risk-level failure, not
  // something to merely wait on. A PENDING or APPROVED_SIMULATION approval is compatible and
  // is fully resolved by the dedicated approval step (17) below.
  if (riskClassification === 'CRITICAL' && approval.approval_state === 'NOT_REQUIRED') {
    return buildOutcome(request, 'RISK_BLOCKED', ['critical_risk_requires_a_declared_approval_mechanism'], context);
  }

  // 17. aprovação.
  if (['DENIED', 'EXPIRED_LOGICAL', 'CONFLICTED'].includes(approval.approval_state)) {
    return buildOutcome(request, 'APPROVAL_BLOCKED', [`approval_state::${approval.approval_state}`], context);
  }
  if (approval.approval_state === 'PENDING') {
    return buildWaitingApproval(request, context);
  }

  // 18. orçamento autorizado.
  if (budget.budget_authorization_validated !== true) {
    return buildOutcome(request, 'BUDGET_BLOCKED', ['budget_authorization_not_validated'], context);
  }

  // 19. expiração lógica.
  if (expiration.expired_logically === true) {
    return buildOutcome(request, 'EXPIRED_AUTHORIZATION', ['authorization_expired_logically'], context);
  }

  // final policy gate, mirroring PR #95's own last-step DENY veto.
  if (policy.allow_authorized_simulation !== true) {
    return buildOutcome(request, 'DENY', ['authorization_policy_disallows_authorized_simulation'], context);
  }

  // 20-21. consolidar blockers (none) e emitir AUTHORIZED_SIMULATION.
  return buildOutcome(request, 'AUTHORIZED_SIMULATION', ['plan_execution_reference_authorized_simulation_only'], context);
}

function buildWaitingApproval(request, context) {
  const decision = buildDecisionForRequest(request, 'WAITING_APPROVAL_SIMULATION', ['waiting_for_declarative_approval_reference']);
  const audit = buildExecutionAuthorizationAudit({
    decision, taskReference: isPlainObject(request) ? request.task_reference : undefined, reasonCodes: decision.reason_codes,
    logicalSequence: request.logical_sequence
  });
  return { decision, audit };
}

function buildDecisionForRequest(request, status, reasonCodes) {
  const requestSafe = isPlainObject(request) ? request : {};
  const decisionRef = isPlainObject(requestSafe.orchestrator_decision_reference) ? requestSafe.orchestrator_decision_reference : {};
  const bundleRef = isPlainObject(requestSafe.readiness_evidence_bundle_reference) ? requestSafe.readiness_evidence_bundle_reference : {};
  const planRef = isPlainObject(requestSafe.orchestration_plan_reference) ? requestSafe.orchestration_plan_reference : {};
  const planningRef = isPlainObject(requestSafe.planning_result_reference) ? requestSafe.planning_result_reference : {};
  const taskRef = isPlainObject(requestSafe.task_reference) ? requestSafe.task_reference : {};
  const scope = isPlainObject(requestSafe.authorization_scope) ? requestSafe.authorization_scope : {};
  const actor = isPlainObject(requestSafe.actor_context) ? requestSafe.actor_context : {};
  const approval = isPlainObject(requestSafe.approval_reference) ? requestSafe.approval_reference : {};
  const budget = isPlainObject(requestSafe.budget_authorization_reference) ? requestSafe.budget_authorization_reference : {};
  const expiration = isPlainObject(requestSafe.expiration_evaluation) ? requestSafe.expiration_evaluation : {};

  return buildExecutionAuthorizationDecision({
    authorization_decision_id: `${requestSafe.authorization_request_id || 'authorization_request_not_available'}-decision`,
    authorization_request_id: requestSafe.authorization_request_id,
    decision_result_id: decisionRef.decision_result_id,
    readiness_bundle_id: bundleRef.readiness_bundle_id,
    planning_result_id: planningRef.planning_result_id || decisionRef.planning_result_id,
    plan_id: planRef.plan_id || decisionRef.plan_id,
    agent_id: decisionRef.agent_id,
    tenant_id: decisionRef.tenant_id,
    organization_id: decisionRef.organization_id,
    project_id: decisionRef.project_id,
    session_reference_id: decisionRef.session_reference_id,
    status,
    actor_id: actor.actor_id,
    actor_role: actor.actor_role,
    authorization_scope_id: scope.scope_id,
    approval_reference_id: approval.approval_reference_id,
    budget_authorization_id: budget.budget_authorization_id,
    expiration_evaluation_id: expiration.expiration_evaluation_id,
    task_reference_id: taskRef.task_reference_id,
    request_fingerprint: isPlainObject(request) ? safeFingerprint(request) : undefined,
    orchestrator_decision_fingerprint: decisionRef.decision_fingerprint,
    readiness_bundle_fingerprint: bundleRef.bundle_fingerprint,
    plan_fingerprint: planRef.plan_fingerprint || planningRef.plan_fingerprint,
    scope_fingerprint: scope.scope_fingerprint,
    actor_fingerprint: actor.actor_fingerprint,
    approval_fingerprint: approval.approval_fingerprint,
    budget_fingerprint: budget.budget_fingerprint,
    expiration_fingerprint: safeFingerprint(expiration),
    task_fingerprint: taskRef.task_fingerprint,
    registry_version: requestSafe.expected_registry_version,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    request_validated: status !== 'VALIDATION_FAILED',
    orchestrator_decision_validated: true,
    evidence_bundle_validated: true,
    bindings_validated: true,
    versions_validated: true,
    fingerprints_validated: true,
    actor_validated: true,
    role_validated: true,
    scope_validated: true,
    risk_validated: true,
    approval_validated: true,
    budget_validated: true,
    expiration_validated: true,
    task_validated: status !== 'VALIDATION_FAILED',
    task_type_validated: status !== 'VALIDATION_FAILED',
    risk_classification_validated: status !== 'VALIDATION_FAILED'
  });
}

function buildOutcome(request, status, reasonCodes, context) {
  const decision = buildDecisionForRequest(request, status, reasonCodes);
  const audit = buildExecutionAuthorizationAudit({
    decision, taskReference: isPlainObject(request) ? request.task_reference : undefined, reasonCodes,
    logicalSequence: isPlainObject(request) && Number.isInteger(request.logical_sequence) ? request.logical_sequence : 0
  });
  return { decision, audit };
}

module.exports = {
  EVIDENCE_BUNDLE_STATUS_TRANSLATION,
  HIGH_RISK_COMPATIBLE_ROLES,
  evaluateExecutionAuthorizationRequest,
  translateEvidenceBundleStatus,
  translateOrchestratorStatus
};
