'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-execution-authorization-boundary.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  EVIDENCE_BUNDLE_REFERENCE_FIELDS, EXECUTION_AUTHORIZATION_REQUEST_FIELDS, ORCHESTRATOR_DECISION_REFERENCE_FIELDS,
  buildEvidenceBundleReference, buildOrchestratorDecisionReference, validateEvidenceBundleReference,
  validateExecutionAuthorizationRequest, validateOrchestratorDecisionReference
} = require('../src/core/execution-authorization-request');
const {
  EXECUTION_AUTHORIZATION_POLICY_FIELDS, buildExecutionAuthorizationPolicy, validateExecutionAuthorizationPolicy
} = require('../src/core/execution-authorization-policy');
const {
  EXECUTION_AUTHORIZATION_SCOPE_FIELDS, RISK_CLASSIFICATIONS, buildExecutionAuthorizationScope,
  validateExecutionAuthorizationScope
} = require('../src/core/execution-authorization-scope');
const {
  EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_FIELDS, buildExecutionAuthorizationActorContext,
  validateExecutionAuthorizationActorContext
} = require('../src/core/execution-authorization-actor-context');
const {
  APPROVAL_STATES, EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_FIELDS, buildExecutionAuthorizationApprovalReference,
  validateExecutionAuthorizationApprovalReference
} = require('../src/core/execution-authorization-approval-reference');
const {
  EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_FIELDS, buildExecutionAuthorizationBudgetReference,
  validateExecutionAuthorizationBudgetReference
} = require('../src/core/execution-authorization-budget-reference');
const {
  EXECUTION_AUTHORIZATION_EXPIRATION_FIELDS, buildExecutionAuthorizationExpiration,
  validateExecutionAuthorizationExpiration
} = require('../src/core/execution-authorization-expiration');
const {
  EXECUTION_AUTHORIZATION_TASK_REFERENCE_FIELDS, EXECUTION_AUTHORIZATION_TASK_REFERENCE_SAFE_FLAGS,
  buildExecutionAuthorizationTaskReference, computeTaskReferenceFingerprint, validateExecutionAuthorizationTaskReference
} = require('../src/core/execution-authorization-task-reference');
const { TASK_COMPLEXITIES, TASK_TYPES } = require('../src/core/orchestrator-task-definition');
const {
  AUTHORIZATION_DECISIONS, AUTHORIZATION_DECISION_FIELDS, AUTHORIZATION_DECISION_SAFE_FLAGS, AUTHORIZATION_NEXT_STATES,
  AUTHORIZATION_STATUSES, buildExecutionAuthorizationDecision, validateExecutionAuthorizationDecision
} = require('../src/core/execution-authorization-decision');
const { createExecutionAuthorizationRegistry } = require('../src/core/execution-authorization-registry');
const {
  EXECUTION_AUTHORIZATION_AUDIT_FIELDS, buildExecutionAuthorizationAudit, validateExecutionAuthorizationAudit
} = require('../src/core/execution-authorization-audit');
const { evaluateExecutionAuthorizationRequest } = require('../src/core/execution-authorization-boundary');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioFixture(key) {
  return clone(fixture.scenarios[key]);
}

const EXPECTED_SCENARIOS = [
  'authorized-no-llm-simulation', 'authorized-low-cost-model-simulation', 'waiting-approval-simulation',
  'denied-approval', 'expired-approval', 'actor-unverified', 'role-blocked', 'scope-blocked', 'tenant-mismatch',
  'organization-mismatch', 'project-mismatch', 'session-mismatch', 'plan-blocked', 'evidence-bundle-blocked',
  'high-risk-authorized-role', 'high-risk-role-blocked', 'critical-risk-waiting-approval', 'restricted-risk-blocked',
  'budget-authorized', 'budget-exceeded', 'protected-reservation-blocked', 'expired-authorization',
  'fingerprint-mismatch', 'version-mismatch', 'conflict-blocked', 'replay-authorization'
];

function scenarioContext(key) {
  return key === 'version-mismatch' ? { currentRegistryVersion: 'v2' } : {};
}

// A minimal, independent task reference builder for tests that need to construct their own
// (tampered or otherwise non-fixture) requests. Mirrors the fixture generator's own helper.
function taskReference(overrides = {}) {
  return buildExecutionAuthorizationTaskReference({
    task_reference_id: 'taskref-test-1', planning_result_id: 'planning-result-1', plan_id: 'plan-1',
    agent_id: 'agent-1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1',
    session_reference_id: 'session-1', task_id: 'task-1', task_type: 'CODE_REFERENCE',
    task_complexity: 'TIER_2_SIMPLE', risk_classification: 'LOW', data_classification: 'INTERNAL',
    requires_human_approval: false, logical_sequence: 1, ...overrides
  });
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_EXECUTION_AUTHORIZATION_BOUNDARY.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

EXPECTED_SCENARIOS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded authorization decision`, () => {
    const scenario = scenarioFixture(key);
    const outcome = evaluateExecutionAuthorizationRequest(scenario.request, scenarioContext(key));
    assert.equal(outcome.decision.status, scenario.decision.status);
    assert.equal(outcome.decision.decision, scenario.decision.decision);
    assert.equal(outcome.decision.next_state, scenario.decision.next_state);
    assert.equal(validateExecutionAuthorizationDecision(outcome.decision).valid, true);
    assert.equal(validateExecutionAuthorizationAudit(outcome.audit).valid, true);
  });
});

// ---------------------------------------------------------------------------
// Contracts: exact fields, enums, safe flags
// ---------------------------------------------------------------------------

test('execution authorization request: exact fields (20, including task_reference) and rejects missing/extra fields', () => {
  assert.equal(EXECUTION_AUTHORIZATION_REQUEST_FIELDS.length, 20);
  const request = scenarioFixture('authorized-no-llm-simulation').request;
  assert.equal(validateExecutionAuthorizationRequest(request).valid, true);
  assert.equal(validateExecutionAuthorizationRequest({ ...request, unexpected: 1 }).valid, false);
  const { authorization_policy, ...missingPolicy } = request;
  assert.equal(validateExecutionAuthorizationRequest(missingPolicy).valid, false);
  const { task_reference, ...missingTaskReference } = request;
  assert.equal(validateExecutionAuthorizationRequest(missingTaskReference).valid, false, 'task_reference is mandatory');
});

test('orchestrator decision reference: exact fields (22), reuses PR #95 status/decision/next_state enums, and forces safe flags', () => {
  assert.equal(ORCHESTRATOR_DECISION_REFERENCE_FIELDS.length, 22);
  const ref = scenarioFixture('authorized-no-llm-simulation').request.orchestrator_decision_reference;
  assert.equal(validateOrchestratorDecisionReference(ref).valid, true);
  assert.equal(validateOrchestratorDecisionReference({ ...ref, status: 'NOT_A_REAL_STATUS' }).valid, false);
  assert.equal(validateOrchestratorDecisionReference({ ...ref, execution_authorized: true }).valid, false);
  assert.equal(validateOrchestratorDecisionReference({ ...ref, executed: true }).valid, false);
});

test('evidence bundle reference: exact fields (38), reuses PR #96 bundle_status/domain-ready-field enums, and forces safe flags', () => {
  assert.equal(EVIDENCE_BUNDLE_REFERENCE_FIELDS.length, 38);
  const ref = scenarioFixture('authorized-no-llm-simulation').request.readiness_evidence_bundle_reference;
  assert.equal(validateEvidenceBundleReference(ref).valid, true);
  assert.equal(validateEvidenceBundleReference({ ...ref, bundle_status: 'NOT_A_REAL_STATUS' }).valid, false);
  assert.equal(validateEvidenceBundleReference({ ...ref, execution_authorized: true }).valid, false);
});

test('authorization policy: exact fields (26) and every require_*/fail_on_* flag is forced true', () => {
  assert.equal(EXECUTION_AUTHORIZATION_POLICY_FIELDS.length, 26);
  const policy = scenarioFixture('authorized-no-llm-simulation').request.authorization_policy;
  assert.equal(validateExecutionAuthorizationPolicy(policy).valid, true);
  assert.equal(validateExecutionAuthorizationPolicy({ ...policy, require_actor_authorized: false }).valid, false);
  assert.equal(validateExecutionAuthorizationPolicy({ ...policy, allow_external_side_effect_reference: true }).valid, false);
  assert.equal(validateExecutionAuthorizationPolicy({ ...policy, allow_irreversible_reference: true }).valid, false);
});

test('authorization scope: exact fields (22), unique/ordered arrays, no wildcard, cross-boundary flags forced false', () => {
  assert.equal(EXECUTION_AUTHORIZATION_SCOPE_FIELDS.length, 22);
  assert.equal(RISK_CLASSIFICATIONS.length, 5);
  const scope = scenarioFixture('authorized-no-llm-simulation').request.authorization_scope;
  assert.equal(validateExecutionAuthorizationScope(scope).valid, true);
  assert.equal(validateExecutionAuthorizationScope({ ...scope, cross_tenant_allowed: true }).valid, false);
  assert.equal(validateExecutionAuthorizationScope({ ...scope, allowed_agent_ids: ['*'] }).valid, false, 'wildcard entries are rejected');
  assert.equal(validateExecutionAuthorizationScope({ ...scope, allowed_agent_ids: ['agent-1', 'agent-1'] }).valid, false, 'duplicate entries are rejected');
  assert.equal(validateExecutionAuthorizationScope({ ...scope, allowed_agent_ids: ['agent-2', 'agent-1'] }).valid, false, 'unordered entries are rejected');
});

test('actor context: exact fields (14), reuses agent-context-contract.js ACTOR_TYPES/ACTOR_ROLES/AUTHORIZATION_STATES', () => {
  assert.equal(EXECUTION_AUTHORIZATION_ACTOR_CONTEXT_FIELDS.length, 14);
  const actor = scenarioFixture('authorized-no-llm-simulation').request.actor_context;
  assert.equal(validateExecutionAuthorizationActorContext(actor).valid, true);
  assert.equal(validateExecutionAuthorizationActorContext({ ...actor, actor_role: 'NOT_A_ROLE' }).valid, false);
  assert.equal(validateExecutionAuthorizationActorContext({ ...actor, authorization_state: 'APPROVED_REAL' }).valid, false, 'APPROVED_REAL is always forbidden');
});

test('approval reference: exact fields (19), 6 approval states, and approval_applied is always false', () => {
  assert.equal(EXECUTION_AUTHORIZATION_APPROVAL_REFERENCE_FIELDS.length, 19);
  assert.deepEqual(APPROVAL_STATES, ['NOT_REQUIRED', 'PENDING', 'APPROVED_SIMULATION', 'DENIED', 'EXPIRED_LOGICAL', 'CONFLICTED']);
  const approval = scenarioFixture('authorized-no-llm-simulation').request.approval_reference;
  assert.equal(validateExecutionAuthorizationApprovalReference(approval).valid, true);
  assert.equal(validateExecutionAuthorizationApprovalReference({ ...approval, approval_applied: true }).valid, false);
});

test('budget authorization reference: exact fields (22) and budget_consumed is always false', () => {
  assert.equal(EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_FIELDS.length, 22);
  const budget = scenarioFixture('authorized-no-llm-simulation').request.budget_authorization_reference;
  assert.equal(validateExecutionAuthorizationBudgetReference(budget).valid, true);
  assert.equal(validateExecutionAuthorizationBudgetReference({ ...budget, budget_consumed: true }).valid, false);
});

test('expiration evaluation: exact fields (14), logical-sequence-only, never accesses a clock or creates a timer', () => {
  assert.equal(EXECUTION_AUTHORIZATION_EXPIRATION_FIELDS.length, 14);
  const expiration = scenarioFixture('authorized-no-llm-simulation').request.expiration_evaluation;
  assert.equal(validateExecutionAuthorizationExpiration(expiration).valid, true);
  assert.equal(validateExecutionAuthorizationExpiration({ ...expiration, clock_accessed: true }).valid, false);
  assert.equal(validateExecutionAuthorizationExpiration({ ...expiration, timer_created: true }).valid, false);
  assert.equal(validateExecutionAuthorizationExpiration({ ...expiration, authorization_mutated: true }).valid, false);
  assert.equal(validateExecutionAuthorizationExpiration({ ...expiration, current_sequence: 0, authorization_created_sequence: 5 }).valid, false, 'current_sequence must never precede created_sequence');
});

test('task reference: exact fields (23), reuses orchestrator-task-definition.js TASK_TYPES/TASK_COMPLEXITIES and execution-authorization-scope.js RISK_CLASSIFICATIONS, and forces safe flags', () => {
  assert.equal(EXECUTION_AUTHORIZATION_TASK_REFERENCE_FIELDS.length, 23);
  const ref = scenarioFixture('authorized-no-llm-simulation').request.task_reference;
  assert.equal(validateExecutionAuthorizationTaskReference(ref).valid, true);
  assert.equal(validateExecutionAuthorizationTaskReference({ ...ref, task_type: 'NOT_A_TYPE' }).valid, false);
  assert.equal(validateExecutionAuthorizationTaskReference({ ...ref, task_complexity: 'NOT_A_TIER' }).valid, false);
  assert.equal(validateExecutionAuthorizationTaskReference({ ...ref, risk_classification: 'NOT_A_RISK' }).valid, false);
  assert.equal(validateExecutionAuthorizationTaskReference({ ...ref, data_classification: 'NOT_A_CLASSIFICATION' }).valid, false);
  for (const [field, expected] of Object.entries(EXECUTION_AUTHORIZATION_TASK_REFERENCE_SAFE_FLAGS)) {
    assert.equal(validateExecutionAuthorizationTaskReference({ ...ref, [field]: !expected }).valid, false, `${field} must be forced ${expected}`);
  }
});

test('task reference type/complexity/risk enums exactly match the reused upstream enums (no parallel enum was introduced)', () => {
  const ref = scenarioFixture('authorized-no-llm-simulation').request.task_reference;
  assert.ok(TASK_TYPES.includes(ref.task_type));
  assert.ok(TASK_COMPLEXITIES.includes(ref.task_complexity));
  assert.ok(RISK_CLASSIFICATIONS.includes(ref.risk_classification));
});

test('task reference fingerprint tamper detection: changing any field changes the recomputed fingerprint', () => {
  const ref = scenarioFixture('authorized-no-llm-simulation').request.task_reference;
  assert.equal(computeTaskReferenceFingerprint(ref), ref.task_fingerprint);
  assert.notEqual(computeTaskReferenceFingerprint({ ...ref, task_id: 'task-tampered' }), ref.task_fingerprint);
});

test('authorization decision: exact fields (70, including task_reference_id/task_fingerprint/task_validated/task_type_validated/risk_classification_validated), 21 statuses, 7 decisions, 7 next states, and status/decision/next_state are jointly consistent', () => {
  assert.equal(AUTHORIZATION_DECISION_FIELDS.length, 70);
  assert.equal(AUTHORIZATION_STATUSES.length, 21);
  assert.equal(AUTHORIZATION_DECISIONS.length, 7);
  assert.equal(AUTHORIZATION_NEXT_STATES.length, 7);
  const decision = scenarioFixture('authorized-no-llm-simulation').decision;
  assert.equal(validateExecutionAuthorizationDecision(decision).valid, true);
  assert.equal(validateExecutionAuthorizationDecision({ ...decision, decision: 'BLOCKED' }).valid, false, 'decision must match its status via STATUS_OUTCOME_MAP');
  assert.equal(validateExecutionAuthorizationDecision({ ...decision, next_state: 'BLOCKED_REFERENCE' }).valid, false);
  assert.equal(validateExecutionAuthorizationDecision({ ...decision, task_validated: false }).valid, false, 'AUTHORIZED_SIMULATION requires task_validated=true');
  assert.equal(validateExecutionAuthorizationDecision({ ...decision, task_type_validated: false }).valid, false);
  assert.equal(validateExecutionAuthorizationDecision({ ...decision, risk_classification_validated: false }).valid, false);
});

test('audit: exact fields (30, including task_reference_id/task_fingerprint/task_classification/task_validation_flags), and never records task content', () => {
  assert.equal(EXECUTION_AUTHORIZATION_AUDIT_FIELDS.length, 30);
  const audit = scenarioFixture('authorized-no-llm-simulation').audit;
  assert.equal(validateExecutionAuthorizationAudit(audit).valid, true);
  assert.ok(TASK_TYPES.includes(audit.task_classification.task_type));
  assert.ok(TASK_COMPLEXITIES.includes(audit.task_classification.task_complexity));
  assert.ok(RISK_CLASSIFICATIONS.includes(audit.task_classification.risk_classification));
  assert.equal(typeof audit.task_validation_flags.task_validated, 'boolean');
});

// ---------------------------------------------------------------------------
// Boundary engine: AUTHORIZED_SIMULATION and its two required inputs (NO_LLM / low-cost model)
// ---------------------------------------------------------------------------

test('AUTHORIZED_SIMULATION reachable, and execution is never authorized even then', () => {
  const noLlm = evaluateExecutionAuthorizationRequest(scenarioFixture('authorized-no-llm-simulation').request);
  assert.equal(noLlm.decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(noLlm.decision.execution_authorized, false, 'even AUTHORIZED_SIMULATION never authorizes execution');
  assert.equal(noLlm.decision.authorized_in_simulation, true);
  assert.equal(noLlm.decision.task_validated, true);
  assert.equal(noLlm.decision.task_type_validated, true);
  assert.equal(noLlm.decision.risk_classification_validated, true);

  const lowCost = evaluateExecutionAuthorizationRequest(scenarioFixture('authorized-low-cost-model-simulation').request);
  assert.equal(lowCost.decision.status, 'AUTHORIZED_SIMULATION');
});

// ---------------------------------------------------------------------------
// Actor / role / scope
// ---------------------------------------------------------------------------

test('an actor missing any of the 4 verification flags is ACTOR_BLOCKED', () => {
  const request = scenarioFixture('authorized-no-llm-simulation').request;
  for (const field of ['identity_verified', 'membership_verified', 'role_verified', 'scope_verified']) {
    const broken = clone(request);
    broken.authorization_request_id = `authzreq-actor-${field}-check`;
    broken.actor_context = { ...broken.actor_context, [field]: false };
    const outcome = evaluateExecutionAuthorizationRequest(broken);
    assert.equal(outcome.decision.status, 'ACTOR_BLOCKED', `missing ${field} must block`);
  }
});

test('a role outside the scope allowlist, or an empty allowlist, is ROLE_BLOCKED', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('role-blocked').request).decision.status, 'ROLE_BLOCKED');
  const request = clone(scenarioFixture('authorized-no-llm-simulation').request);
  request.authorization_request_id = 'authzreq-empty-role-scope-check';
  request.authorization_scope = { ...request.authorization_scope, allowed_actor_roles: [] };
  assert.equal(evaluateExecutionAuthorizationRequest(request).decision.status, 'ROLE_BLOCKED');
});

test('agent, project, session, and plan each outside scope are independently SCOPE_BLOCKED, and an empty scope never authorizes', () => {
  const base = scenarioFixture('authorized-no-llm-simulation').request;
  for (const field of ['allowed_agent_ids', 'allowed_project_ids', 'allowed_session_reference_ids', 'allowed_plan_ids', 'allowed_actor_ids']) {
    const broken = clone(base);
    broken.authorization_request_id = `authzreq-scope-${field}-check`;
    broken.authorization_scope = { ...broken.authorization_scope, [field]: [] };
    const outcome = evaluateExecutionAuthorizationRequest(broken);
    assert.equal(outcome.decision.status, 'SCOPE_BLOCKED', `empty ${field} must block`);
  }
});

// ---------------------------------------------------------------------------
// Task reference bindings (tenant / organization / project / session / plan / planning result)
// ---------------------------------------------------------------------------

test('a task_reference tenant, organization, project, or session mismatch blocks with the matching status', () => {
  const base = scenarioFixture('authorized-no-llm-simulation').request;
  const cases = [
    ['tenant_id', 'tenant-other', 'TENANT_BLOCKED'],
    ['organization_id', 'tenant-a:org-other', 'ORGANIZATION_BLOCKED'],
    ['project_id', 'proj-other', 'PROJECT_BLOCKED'],
    ['session_reference_id', 'session-other', 'SESSION_BLOCKED']
  ];
  for (const [field, badValue, expectedStatus] of cases) {
    const broken = clone(base);
    broken.authorization_request_id = `authzreq-task-${field}-mismatch-check`;
    broken.task_reference = taskReference({ [field]: badValue });
    const outcome = evaluateExecutionAuthorizationRequest(broken);
    assert.equal(outcome.decision.status, expectedStatus, `task_reference.${field} mismatch must produce ${expectedStatus}`);
  }
});

test('a task_reference plan_id or planning_result_id mismatch is PLAN_BLOCKED', () => {
  const base = scenarioFixture('authorized-no-llm-simulation').request;

  const planMismatch = clone(base);
  planMismatch.authorization_request_id = 'authzreq-task-plan-mismatch-check';
  planMismatch.task_reference = taskReference({ plan_id: 'plan-different' });
  assert.equal(evaluateExecutionAuthorizationRequest(planMismatch).decision.status, 'PLAN_BLOCKED');

  const planningResultMismatch = clone(base);
  planningResultMismatch.authorization_request_id = 'authzreq-task-planning-result-mismatch-check';
  planningResultMismatch.task_reference = taskReference({ planning_result_id: 'planning-result-different' });
  assert.equal(evaluateExecutionAuthorizationRequest(planningResultMismatch).decision.status, 'PLAN_BLOCKED');
});

test('a tampered task_reference fingerprint is FINGERPRINT_BLOCKED (tamper detection)', () => {
  const request = clone(scenarioFixture('authorized-no-llm-simulation').request);
  request.authorization_request_id = 'authzreq-task-fingerprint-tamper-check';
  request.task_reference = { ...request.task_reference, task_complexity: 'TIER_4_COMPLEX' };
  const outcome = evaluateExecutionAuthorizationRequest(request);
  assert.equal(outcome.decision.status, 'FINGERPRINT_BLOCKED');
});

// ---------------------------------------------------------------------------
// Task type
// ---------------------------------------------------------------------------

test('a task_type within allowed_task_types authorizes, and a task_type outside it is SCOPE_BLOCKED', () => {
  const inScope = clone(scenarioFixture('authorized-no-llm-simulation').request);
  inScope.authorization_request_id = 'authzreq-task-type-in-scope-check';
  assert.equal(evaluateExecutionAuthorizationRequest(inScope).decision.status, 'AUTHORIZED_SIMULATION');

  const outOfScope = clone(scenarioFixture('authorized-no-llm-simulation').request);
  outOfScope.authorization_request_id = 'authzreq-task-type-out-of-scope-check';
  outOfScope.authorization_scope = { ...outOfScope.authorization_scope, allowed_task_types: ['ANALYSIS_REFERENCE'] };
  assert.equal(evaluateExecutionAuthorizationRequest(outOfScope).decision.status, 'SCOPE_BLOCKED');
});

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

test('risk LOW and MODERATE authorize normally, HIGH requires a compatible role, CRITICAL requires a declared approval mechanism, RESTRICTED always blocks', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('authorized-no-llm-simulation').request).decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('authorized-low-cost-model-simulation').request).decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('high-risk-authorized-role').request).decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('high-risk-role-blocked').request).decision.status, 'RISK_BLOCKED');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('critical-risk-waiting-approval').request).decision.status, 'WAITING_APPROVAL_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('restricted-risk-blocked').request).decision.status, 'RISK_BLOCKED');

  const criticalNotRequired = clone(scenarioFixture('authorized-no-llm-simulation').request);
  criticalNotRequired.authorization_request_id = 'authzreq-critical-not-required-check';
  criticalNotRequired.task_reference = taskReference({ task_reference_id: 'taskref-critical-not-required', risk_classification: 'CRITICAL' });
  assert.equal(evaluateExecutionAuthorizationRequest(criticalNotRequired).decision.status, 'RISK_BLOCKED', 'CRITICAL risk with a NOT_REQUIRED approval reference has no declared approval mechanism');

  const criticalWithApproval = clone(scenarioFixture('authorized-no-llm-simulation').request);
  criticalWithApproval.authorization_request_id = 'authzreq-critical-with-approval-check';
  criticalWithApproval.task_reference = taskReference({ task_reference_id: 'taskref-critical-approved', risk_classification: 'CRITICAL' });
  criticalWithApproval.approval_reference = buildExecutionAuthorizationApprovalReference({
    approval_reference_id: 'appr-critical-approved', planning_result_id: 'planning-result-1', plan_id: 'plan-1',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', session_reference_id: 'session-1',
    approval_required: true, approval_type: 'MANAGER', minimum_approvals: 1, required_roles: ['MANAGER'],
    approval_decision_reference_ids: ['approval-decision-1']
  });
  assert.equal(evaluateExecutionAuthorizationRequest(criticalWithApproval).decision.status, 'AUTHORIZED_SIMULATION', 'a granted declarative approval satisfies CRITICAL risk');
});

test('a risk classification outside the scope allowlist is RISK_BLOCKED', () => {
  const request = clone(scenarioFixture('authorized-no-llm-simulation').request);
  request.authorization_request_id = 'authzreq-risk-not-in-scope-check';
  request.authorization_scope = { ...request.authorization_scope, allowed_risk_classifications: ['LOW'] };
  request.task_reference = taskReference({ task_reference_id: 'taskref-moderate-not-in-scope', risk_classification: 'MODERATE' });
  assert.equal(evaluateExecutionAuthorizationRequest(request).decision.status, 'RISK_BLOCKED');
});

test('external_side_effect_reference=true and irreversible_reference=true both block (this PR supports neither, not even declaratively)', () => {
  // The task reference contract itself forces both flags false (see
  // EXECUTION_AUTHORIZATION_TASK_REFERENCE_SAFE_FLAGS), so a request carrying either flag as
  // true fails request validation (step 1-2, VALIDATION_FAILED) before the engine's dedicated
  // step-16 defensive re-check (which exists as belt-and-suspenders but is unreachable while the
  // contract-level safe flag holds) is ever reached.
  const base = scenarioFixture('authorized-no-llm-simulation').request.task_reference;

  const externalSideEffect = { ...base, external_side_effect_reference: true };
  externalSideEffect.task_fingerprint = computeTaskReferenceFingerprint(externalSideEffect);
  const externalRequest = clone(scenarioFixture('authorized-no-llm-simulation').request);
  externalRequest.authorization_request_id = 'authzreq-external-side-effect-check';
  externalRequest.task_reference = externalSideEffect;
  assert.equal(evaluateExecutionAuthorizationRequest(externalRequest).decision.status, 'VALIDATION_FAILED');

  const irreversible = { ...base, irreversible_reference: true };
  irreversible.task_fingerprint = computeTaskReferenceFingerprint(irreversible);
  const irreversibleRequest = clone(scenarioFixture('authorized-no-llm-simulation').request);
  irreversibleRequest.authorization_request_id = 'authzreq-irreversible-reference-check';
  irreversibleRequest.task_reference = irreversible;
  assert.equal(evaluateExecutionAuthorizationRequest(irreversibleRequest).decision.status, 'VALIDATION_FAILED');
});

test('the retired context.riskClassification side-channel no longer influences the decision in any way', () => {
  const request = scenarioFixture('restricted-risk-blocked').request;
  const withoutSideChannel = evaluateExecutionAuthorizationRequest(request, {});
  const withStaleSideChannel = evaluateExecutionAuthorizationRequest(request, { riskClassification: 'LOW' });
  assert.equal(withoutSideChannel.decision.status, 'RISK_BLOCKED', 'the real risk classification comes from task_reference and still blocks (RESTRICTED)');
  assert.equal(withStaleSideChannel.decision.status, 'RISK_BLOCKED', 'a stale context.riskClassification=LOW must not override the fingerprinted task_reference');
  assert.equal(withoutSideChannel.decision.status, withStaleSideChannel.decision.status);
});

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

test('approval not required, pending, granted, denied, and expired each produce their documented status', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('authorized-no-llm-simulation').request).decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('waiting-approval-simulation').request).decision.status, 'WAITING_APPROVAL_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('denied-approval').request).decision.status, 'APPROVAL_BLOCKED');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('expired-approval').request).decision.status, 'APPROVAL_BLOCKED');

  const conflicted = clone(scenarioFixture('denied-approval').request);
  conflicted.authorization_request_id = 'authzreq-approval-conflicted-check';
  conflicted.approval_reference = { ...conflicted.approval_reference, approval_state: 'CONFLICTED' };
  assert.equal(evaluateExecutionAuthorizationRequest(conflicted).decision.status, 'APPROVAL_BLOCKED');
});

test('no real approval is ever granted or applied: approval_applied is always false regardless of scenario', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const approval = scenarioFixture(key).request.approval_reference;
    assert.equal(approval.approval_applied, false, `scenario ${key}: approval_applied must always be false`);
  }
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

test('budget authorized proceeds, budget exceeded blocks, and a missing protected reservation blocks', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('budget-authorized').request).decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('budget-exceeded').request).decision.status, 'BUDGET_BLOCKED');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('protected-reservation-blocked').request).decision.status, 'BUDGET_BLOCKED');
});

test('no token or cost is ever consumed: budget_consumed is always false regardless of scenario', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const budget = scenarioFixture(key).request.budget_authorization_reference;
    assert.equal(budget.budget_consumed, false, `scenario ${key}: budget_consumed must always be false`);
  }
});

// ---------------------------------------------------------------------------
// Expiration
// ---------------------------------------------------------------------------

test('a valid authorization is not expired, and an authorization outside its valid sequence window is EXPIRED_AUTHORIZATION', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('authorized-no-llm-simulation').request).decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('expired-authorization').request).decision.status, 'EXPIRED_AUTHORIZATION');
});

test('a current_sequence before the created_sequence is an invalid ExpirationEvaluation, not a silently-accepted one', () => {
  assert.throws(() => buildExecutionAuthorizationExpiration({
    expiration_evaluation_id: 'exp-invalid-sequence', authorization_created_sequence: 10, current_sequence: 1,
    maximum_valid_sequences: 100, expiration_applicable: true
  }));
});

test('regression: no module in this PR reads the wall clock or creates a timer', () => {
  const files = [
    'services/api/src/core/execution-authorization-boundary.js', 'services/api/src/core/execution-authorization-request.js',
    'services/api/src/core/execution-authorization-policy.js', 'services/api/src/core/execution-authorization-scope.js',
    'services/api/src/core/execution-authorization-actor-context.js', 'services/api/src/core/execution-authorization-approval-reference.js',
    'services/api/src/core/execution-authorization-budget-reference.js', 'services/api/src/core/execution-authorization-expiration.js',
    'services/api/src/core/execution-authorization-task-reference.js', 'services/api/src/core/execution-authorization-decision.js',
    'services/api/src/core/execution-authorization-registry.js', 'services/api/src/core/execution-authorization-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval|setImmediate/.test(source), false);
  }
});

// ---------------------------------------------------------------------------
// Tenant / organization / project / session / plan / fingerprint / version / conflict / unknown status
// ---------------------------------------------------------------------------

test('tenant, organization, project, and session mismatches each block independently', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('tenant-mismatch').request).decision.status, 'TENANT_BLOCKED');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('organization-mismatch').request).decision.status, 'ORGANIZATION_BLOCKED');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('project-mismatch').request).decision.status, 'PROJECT_BLOCKED');
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('session-mismatch').request).decision.status, 'SESSION_BLOCKED');
});

test('an inconsistent plan_id across references is PLAN_BLOCKED', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('plan-blocked').request).decision.status, 'PLAN_BLOCKED');
});

test('a plan_fingerprint mismatch between planning result and plan reference is FINGERPRINT_BLOCKED', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('fingerprint-mismatch').request).decision.status, 'FINGERPRINT_BLOCKED');
});

test('a stale expected_registry_version is VERSION_BLOCKED', () => {
  const outcome = evaluateExecutionAuthorizationRequest(scenarioFixture('version-mismatch').request, { currentRegistryVersion: 'v2' });
  assert.equal(outcome.decision.status, 'VERSION_BLOCKED');
});

test('an evidence bundle reporting an unresolved conflict is CONFLICT_BLOCKED', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('conflict-blocked').request).decision.status, 'CONFLICT_BLOCKED');
});

test('a missing evidence bundle is MISSING_EVIDENCE_BLOCKED', () => {
  assert.equal(evaluateExecutionAuthorizationRequest(scenarioFixture('evidence-bundle-blocked').request).decision.status, 'MISSING_EVIDENCE_BLOCKED');
});

test('an orchestrator decision status with no boundary equivalent is UNKNOWN_STATUS_BLOCKED', () => {
  const request = clone(scenarioFixture('authorized-no-llm-simulation').request);
  request.authorization_request_id = 'authzreq-unknown-status-check';
  request.orchestrator_decision_reference = {
    ...request.orchestrator_decision_reference, status: 'WAITING_MEMORY_REFERENCE', decision: 'REQUEST_MEMORY_RESELECTION',
    next_state: 'WAITING_MEMORY_REFERENCE', ready_in_simulation: false
  };
  const outcome = evaluateExecutionAuthorizationRequest(request);
  assert.equal(outcome.decision.status, 'UNKNOWN_STATUS_BLOCKED');
});

test('an orchestrator decision status that is also a legal boundary status passes through 1:1', () => {
  const request = clone(scenarioFixture('authorized-no-llm-simulation').request);
  request.authorization_request_id = 'authzreq-passthrough-status-check';
  request.orchestrator_decision_reference = {
    ...request.orchestrator_decision_reference, status: 'CONFLICT_BLOCKED', decision: 'BLOCKED',
    next_state: 'BLOCKED_REFERENCE', ready_in_simulation: false
  };
  const outcome = evaluateExecutionAuthorizationRequest(request);
  assert.equal(outcome.decision.status, 'CONFLICT_BLOCKED');
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test('precedence: a tenant mismatch wins over an also-broken role', () => {
  const request = clone(scenarioFixture('role-blocked').request);
  request.authorization_request_id = 'authzreq-precedence-tenant-over-role';
  request.actor_context = { ...request.actor_context, tenant_id: 'tenant-other' };
  assert.equal(evaluateExecutionAuthorizationRequest(request).decision.status, 'TENANT_BLOCKED');
});

test('precedence: a fingerprint mismatch wins over a policy that would otherwise deny', () => {
  const request = clone(scenarioFixture('fingerprint-mismatch').request);
  request.authorization_request_id = 'authzreq-precedence-fingerprint-over-policy';
  request.authorization_policy = { ...request.authorization_policy, allow_authorized_simulation: false };
  assert.equal(evaluateExecutionAuthorizationRequest(request).decision.status, 'FINGERPRINT_BLOCKED');
});

test('precedence: an actor block wins over an also-invalid scope', () => {
  const request = clone(scenarioFixture('scope-blocked').request);
  request.authorization_request_id = 'authzreq-precedence-actor-over-scope';
  request.actor_context = { ...request.actor_context, identity_verified: false };
  assert.equal(evaluateExecutionAuthorizationRequest(request).decision.status, 'ACTOR_BLOCKED');
});

test('precedence: a role block wins over an also-invalid task type (scope checks run before risk checks)', () => {
  const request = clone(scenarioFixture('role-blocked').request);
  request.authorization_request_id = 'authzreq-precedence-role-over-task-type';
  request.authorization_scope = { ...request.authorization_scope, allowed_task_types: ['ANALYSIS_REFERENCE'] };
  assert.equal(evaluateExecutionAuthorizationRequest(request).decision.status, 'ROLE_BLOCKED');
});

test('a policy that disallows authorized simulation produces DENY only after every other check has passed', () => {
  const request = clone(scenarioFixture('authorized-no-llm-simulation').request);
  request.authorization_request_id = 'authzreq-policy-deny-check';
  request.authorization_policy = { ...request.authorization_policy, allow_authorized_simulation: false };
  assert.equal(evaluateExecutionAuthorizationRequest(request).decision.status, 'DENY');
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry validates by construction and protects against replay, payload mismatch, version conflict, and fingerprint conflict', () => {
  const registry = createExecutionAuthorizationRegistry();
  const request = scenarioFixture('replay-authorization').request;

  const first = registry.registerAuthorizationRequest(request, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerAuthorizationRequest(request).status, 'REPLAY_ACCEPTED');

  const payloadMismatch = { ...request, correlation_id: 'different-correlation' };
  assert.equal(registry.registerAuthorizationRequest(payloadMismatch).status, 'PAYLOAD_MISMATCH');

  const versionBumped = { ...request, authorization_request_version: 2, correlation_id: 'different-correlation' };
  assert.equal(registry.registerAuthorizationRequest(versionBumped, { expected_version: 5 }).status, 'VERSION_CONFLICT');
  assert.equal(registry.registerAuthorizationRequest(versionBumped, { expected_version: 1 }).status, 'REGISTERED_SIMULATION');

  const versionBumpedAgain = { ...request, authorization_request_version: 3, correlation_id: 'yet-another' };
  assert.equal(registry.registerAuthorizationRequest(versionBumpedAgain, { expected_fingerprint: 'stale' }).status, 'FINGERPRINT_CONFLICT');

  const stored = registry.getAuthorizationRequestById(request.authorization_request_id);
  assert.equal(stored.authorization_request_version, 2, 'a rejected fingerprint conflict must not mutate the stored record');
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => { stored.correlation_id = 'x'; }, TypeError);
  assert.equal(registry.getAuthorizationRequestById('unknown-id'), null);

  const invalid = registry.registerAuthorizationRequest({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('registry blocks tenant and organization rebinding for decisions without mutating the stored record', () => {
  const registry = createExecutionAuthorizationRegistry();
  const decision = scenarioFixture('authorized-no-llm-simulation').decision;
  assert.equal(registry.registerAuthorizationDecision(decision, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  const orgChanged = { ...decision, organization_id: `${decision.tenant_id}:org-different` };
  assert.equal(registry.registerAuthorizationDecision(orgChanged).status, 'ORGANIZATION_BLOCKED');
  const tenantChanged = { ...decision, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerAuthorizationDecision(tenantChanged).status, 'TENANT_BLOCKED');
  assert.equal(registry.getAuthorizationDecisionById(decision.authorization_decision_id).organization_id, decision.organization_id);
});

test('registry provides defensive clones (deep freeze) and safe lists by tenant', () => {
  const registry = createExecutionAuthorizationRegistry();
  const scopeA = scenarioFixture('authorized-no-llm-simulation').request.authorization_scope;
  registry.registerAuthorizationScope(scopeA, { expected_version: 0 });
  const listed = registry.listAuthorizationScopesByTenant(scopeA.tenant_id);
  assert.equal(listed.length, 1);
  assert.equal(registry.listAuthorizationScopesByTenant('tenant-unused').length, 0);
  assert.equal(Object.isFrozen(listed[0]), true);
  assert.throws(() => { listed[0].scope_id = 'x'; }, TypeError);
});

test('input is never mutated by decision construction', () => {
  const input = { authorization_decision_id: 'ad-immutability-check', status: 'AUTHORIZED_SIMULATION', blockers: ['a'] };
  const frozenSnapshot = JSON.stringify(input);
  buildExecutionAuthorizationDecision(input);
  assert.equal(JSON.stringify(input), frozenSnapshot);
});

// ---------------------------------------------------------------------------
// Operational material / hostile input hardening
// ---------------------------------------------------------------------------

[
  ['api key', { api_key: 'x' }, 'forbidden_key'],
  ['secret value', { secret_value: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['prompt word', { note: 'do not store the system_prompt text' }, 'forbidden_word_value'],
  ['execute word', { note: 'do not execute this reference' }, 'forbidden_word_value'],
  ['function value', { note: () => null }, 'forbidden_function']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name} in execution authorization contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate execution authorization field names', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario), [], `scenario ${key} must be free of operational material`);
  }
});

test('operational material detector rejects NaN, Infinity, bigint, symbol, and cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((e) => e.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((e) => e.includes('forbidden_symbol')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((e) => e.includes('forbidden_cycle')));
  assert.throws(() => stablePayload(cyclic));
});

// ---------------------------------------------------------------------------
// Regression
// ---------------------------------------------------------------------------

test('regression execution authorization modules do not use network, filesystem, eval, dynamic import, or timers', () => {
  const files = [
    'services/api/src/core/execution-authorization-boundary.js', 'services/api/src/core/execution-authorization-request.js',
    'services/api/src/core/execution-authorization-policy.js', 'services/api/src/core/execution-authorization-scope.js',
    'services/api/src/core/execution-authorization-actor-context.js', 'services/api/src/core/execution-authorization-approval-reference.js',
    'services/api/src/core/execution-authorization-budget-reference.js', 'services/api/src/core/execution-authorization-expiration.js',
    'services/api/src/core/execution-authorization-task-reference.js', 'services/api/src/core/execution-authorization-decision.js',
    'services/api/src/core/execution-authorization-registry.js', 'services/api/src/core/execution-authorization-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/\beval\(/.test(source), false);
    assert.equal(/\bnew Function\(/.test(source), false);
    assert.equal(/\bimport\(/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|ollama|openrouter|groq|together\.ai|huggingface/i.test(source), false);
    assert.equal(/qdrant|pinecone|weaviate|chroma|milvus/i.test(source), false);
    assert.equal(/postgres|supabase|redis/i.test(source), false);
  }
});

test('regression execution authorization modules are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('execution-authorization-boundary'), false);
    assert.equal(source.includes('execution-authorization-registry'), false);
  }
});

test('regression PRs 79 through 96 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js', 'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-session-reference.js', 'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js', 'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/context-assembly-engine.js', 'services/api/src/core/tool-decision.js',
    'services/api/src/core/workflow-decision.js', 'services/api/src/core/orchestrator-request.js',
    'services/api/src/core/orchestrator-decision.js', 'services/api/src/core/memory-selection-engine.js',
    'services/api/src/core/memory-selection-decision.js', 'services/api/src/core/orchestrator-planner.js',
    'services/api/src/core/orchestrator-planning-request.js', 'services/api/src/core/orchestrator-planning-result.js',
    'services/api/src/core/orchestrator-planning-registry.js', 'services/api/src/core/orchestrator-plan-stage.js',
    'services/api/src/core/orchestrator-plan-dependency.js', 'services/api/src/core/orchestrator-plan-approval.js',
    'services/api/src/core/orchestrator-plan-reference.js', 'services/api/src/core/orchestrator-decision-policy.js',
    'services/api/src/core/orchestrator-blocker.js', 'services/api/src/core/orchestrator-readiness.js',
    'services/api/src/core/orchestrator-decision-request.js', 'services/api/src/core/orchestrator-decision-engine.js',
    'services/api/src/core/orchestrator-decision-result.js', 'services/api/src/core/orchestrator-decision-registry.js',
    'services/api/src/core/orchestrator-decision-audit.js', 'services/api/src/core/orchestrator-budget-evidence-reference.js',
    'services/api/src/core/orchestrator-dependency-evidence-reference.js', 'services/api/src/core/orchestrator-conflict-evidence-reference.js',
    'services/api/src/core/orchestrator-approval-evidence-reference.js', 'services/api/src/core/orchestrator-readiness-evidence-bundle.js',
    'services/api/src/core/orchestrator-decision-evidence-validator.js', 'services/api/src/core/orchestrator-decision-evidence-registry.js',
    'services/api/src/core/orchestrator-decision-evidence-audit.js', 'services/api/src/core/orchestrator-task-definition.js'
  ].map((file) => path.join(repoRoot, file));
  const executionAuthorizationModules = [
    'execution-authorization-boundary', 'execution-authorization-request', 'execution-authorization-policy',
    'execution-authorization-scope', 'execution-authorization-actor-context', 'execution-authorization-approval-reference',
    'execution-authorization-budget-reference', 'execution-authorization-expiration', 'execution-authorization-task-reference',
    'execution-authorization-decision', 'execution-authorization-registry', 'execution-authorization-audit'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of executionAuthorizationModules) {
      assert.equal(source.includes(moduleName), false, `${file} must not reference ${moduleName}`);
    }
  }
});

test('regression full suite invariant: no execution is ever authorized or performed, across every named scenario', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    const outcome = evaluateExecutionAuthorizationRequest(scenario.request, scenarioContext(key));
    for (const [field, expected] of Object.entries(AUTHORIZATION_DECISION_SAFE_FLAGS)) {
      assert.equal(outcome.decision[field], expected, `scenario ${key}: ${field} must be ${expected}`);
    }
  }
});
