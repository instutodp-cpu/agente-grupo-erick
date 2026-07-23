'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-execution-plan-contracts.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  AUTHORIZATION_DECISION_REFERENCE_FIELDS, EXECUTION_PLAN_POLICY_REFERENCE_FIELDS, EXECUTION_PLAN_REQUEST_FIELDS,
  buildAuthorizationDecisionReference, buildExecutionPlanPolicyReference, validateAuthorizationDecisionReference,
  validateExecutionPlanPolicyReference, validateExecutionPlanRequest
} = require('../src/core/execution-plan-request');
const {
  EXECUTION_PLAN_CONTRACT_FIELDS, EXECUTION_PLAN_STATUSES, validateExecutionPlanContract
} = require('../src/core/execution-plan-contract');
const { EXECUTION_PLAN_STAGE_FIELDS, STAGE_STATUSES, validateExecutionPlanStage } = require('../src/core/execution-plan-stage');
const {
  BINDING_TYPES, EXECUTION_PLAN_STAGE_BINDING_FIELDS, buildExecutionPlanStageBinding, validateExecutionPlanStageBinding
} = require('../src/core/execution-plan-stage-binding');
const {
  EXECUTION_PLAN_DEPENDENCY_FIELDS, buildExecutionPlanDependency, validateExecutionPlanDependency
} = require('../src/core/execution-plan-dependency');
const {
  EXECUTION_PLAN_BUDGET_FIELDS, buildExecutionPlanBudget, validateExecutionPlanBudget
} = require('../src/core/execution-plan-budget');
const {
  EXECUTION_PLAN_IDEMPOTENCY_FIELDS, buildExecutionPlanIdempotency, validateExecutionPlanIdempotency
} = require('../src/core/execution-plan-idempotency');
const {
  CONDITION_TYPES, EXECUTION_PLAN_STOP_CONDITION_FIELDS, buildExecutionPlanStopCondition, validateExecutionPlanStopCondition
} = require('../src/core/execution-plan-stop-condition');
const {
  COMPENSATION_TYPES, EXECUTION_PLAN_COMPENSATION_REFERENCE_FIELDS, buildExecutionPlanCompensationReference,
  validateExecutionPlanCompensationReference
} = require('../src/core/execution-plan-compensation-reference');
const {
  EXECUTION_PLAN_RESULT_FIELDS, NEXT_STATES, RESULT_DECISIONS, RESULT_STATUSES, validateExecutionPlanResult
} = require('../src/core/execution-plan-result');
const { EXECUTION_PLAN_AUDIT_FIELDS, validateExecutionPlanAudit } = require('../src/core/execution-plan-audit');
const { evaluateExecutionPlanRequest } = require('../src/core/execution-plan-engine');
const { createExecutionPlanRegistry } = require('../src/core/execution-plan-registry');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioFixture(key) {
  return clone(fixture.scenarios[key]);
}

const EXPECTED_SCENARIOS = [
  'prepared-no-llm-plan', 'prepared-low-cost-model-plan', 'deterministic-plan', 'model-stage-plan', 'tool-stage-plan',
  'workflow-stage-plan', 'sequential-plan', 'parallel-plan', 'approval-blocked-plan', 'authorization-blocked-plan',
  'evidence-blocked-plan', 'memory-blocked-plan', 'context-blocked-plan', 'model-blocked-plan', 'tool-blocked-plan',
  'workflow-blocked-plan', 'budget-blocked-plan', 'dependency-cycle-plan', 'missing-binding-plan',
  'missing-idempotency-plan', 'duplicate-execution-plan', 'missing-stop-condition-plan',
  'state-change-with-compensation-plan', 'state-change-without-compensation-plan', 'external-effect-blocked-plan',
  'irreversible-blocked-plan', 'tenant-mismatch-plan', 'organization-mismatch-plan', 'project-mismatch-plan',
  'session-mismatch-plan', 'fingerprint-mismatch-plan', 'version-mismatch-plan', 'replay-plan', 'canonical-order-plan'
];

const SEQUENTIAL_DEPENDENCY_RECORDS = [{ from_stage_id: 'stage-1', to_stage_id: 'stage-2', dependency_type: 'AFTER_SUCCESS_REFERENCE' }];
const PARALLEL_DEPENDENCY_RECORDS = [{ from_stage_id: 'stage-1', to_stage_id: 'stage-2', dependency_type: 'PARALLEL_REFERENCE' }];
const CYCLIC_DEPENDENCY_RECORDS = [{ from_stage_id: 'stage-1', to_stage_id: 'stage-2' }, { from_stage_id: 'stage-2', to_stage_id: 'stage-1' }];

function scenarioContext(key) {
  if (key === 'version-mismatch-plan') return { currentRegistryVersion: 'v2' };
  if (key === 'sequential-plan') return { dependencyRecords: SEQUENTIAL_DEPENDENCY_RECORDS };
  if (key === 'parallel-plan') return { dependencyRecords: PARALLEL_DEPENDENCY_RECORDS };
  if (key === 'dependency-cycle-plan') return { dependencyRecords: CYCLIC_DEPENDENCY_RECORDS };
  return {};
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_EXECUTION_PLAN_CONTRACTS.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

EXPECTED_SCENARIOS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded plan/result`, () => {
    const scenario = scenarioFixture(key);
    const outcome = evaluateExecutionPlanRequest(scenario.request, scenarioContext(key));
    assert.equal(outcome.plan.execution_plan_status, scenario.plan.execution_plan_status);
    assert.equal(outcome.result.status, scenario.result.status);
    assert.equal(outcome.result.decision, scenario.result.decision);
    assert.equal(outcome.result.next_state, scenario.result.next_state);
    assert.equal(validateExecutionPlanContract(outcome.plan).valid, true);
    assert.equal(validateExecutionPlanResult(outcome.result).valid, true);
    assert.equal(validateExecutionPlanAudit(outcome.audit).valid, true);
  });
});

// ---------------------------------------------------------------------------
// Contracts: exact fields, enums, safe flags
// ---------------------------------------------------------------------------

test('execution plan request: exact fields (25) and rejects missing/extra fields', () => {
  assert.equal(EXECUTION_PLAN_REQUEST_FIELDS.length, 25);
  const request = scenarioFixture('prepared-no-llm-plan').request;
  assert.equal(validateExecutionPlanRequest(request).valid, true);
  assert.equal(validateExecutionPlanRequest({ ...request, unexpected: 1 }).valid, false);
  const { task_reference, ...missingTaskReference } = request;
  assert.equal(validateExecutionPlanRequest(missingTaskReference).valid, false);
});

test('authorization decision reference: exact fields (23), reuses PR #97 status/decision/next_state enums, and forces safe flags', () => {
  assert.equal(AUTHORIZATION_DECISION_REFERENCE_FIELDS.length, 23);
  const ref = scenarioFixture('prepared-no-llm-plan').request.authorization_decision_reference;
  assert.equal(validateAuthorizationDecisionReference(ref).valid, true);
  assert.equal(validateAuthorizationDecisionReference({ ...ref, status: 'NOT_A_REAL_STATUS' }).valid, false);
  assert.equal(validateAuthorizationDecisionReference({ ...ref, execution_authorized: true }).valid, false);
  assert.equal(validateAuthorizationDecisionReference({ ...ref, executed: true }).valid, false);
});

test('execution plan policy reference: exact fields (28) and every require_*/fail_on_* flag is forced true', () => {
  assert.equal(EXECUTION_PLAN_POLICY_REFERENCE_FIELDS.length, 28);
  const policy = scenarioFixture('prepared-no-llm-plan').request.execution_plan_policy_reference;
  assert.equal(validateExecutionPlanPolicyReference(policy).valid, true);
  assert.equal(validateExecutionPlanPolicyReference({ ...policy, require_budget_validation: false }).valid, false);
  assert.equal(validateExecutionPlanPolicyReference({ ...policy, allow_external_side_effect_reference: true }).valid, false);
  assert.equal(validateExecutionPlanPolicyReference({ ...policy, allow_irreversible_reference: true }).valid, false);
});

test('execution plan contract: exact fields (51), 24 statuses, and executable is always false', () => {
  assert.equal(EXECUTION_PLAN_CONTRACT_FIELDS.length, 51);
  assert.equal(EXECUTION_PLAN_STATUSES.length, 24);
  const plan = scenarioFixture('prepared-no-llm-plan').plan;
  assert.equal(validateExecutionPlanContract(plan).valid, true);
  assert.equal(validateExecutionPlanContract({ ...plan, executable: true }).valid, false);
  assert.equal(validateExecutionPlanContract({ ...plan, execution_plan_status: 'PREPARED_SIMULATION', execution_plan_prepared: false }).valid, false);
});

test('execution plan stage: exact fields (39), reuses PR #94 STAGE_TYPES and PR #93 side-effect classifications', () => {
  assert.equal(EXECUTION_PLAN_STAGE_FIELDS.length, 39);
  assert.deepEqual(STAGE_STATUSES, ['PREPARED_SIMULATION', 'WAITING_APPROVAL_REFERENCE', 'BLOCKED', 'NOT_PREPARED']);
  const stage = require('../src/core/execution-plan-stage').buildExecutionPlanStage({
    execution_stage_id: 'stage-x', execution_plan_id: 'plan-x', source_orchestrator_stage_id: 'stage-x',
    stage_sequence: 0, stage_type: 'DETERMINISTIC_STAGE', task_reference_id: 'taskref-x',
    side_effect_classification: 'NONE', risk_classification: 'LOW', stage_status: 'PREPARED_SIMULATION'
  });
  assert.equal(validateExecutionPlanStage(stage).valid, true);
  assert.equal(stage.stage_prepared, true);
  assert.equal(stage.stage_executable, false);
});

test('execution plan stage binding: exact fields (18), 12 binding types, and binding_applied is always false', () => {
  assert.equal(EXECUTION_PLAN_STAGE_BINDING_FIELDS.length, 18);
  assert.equal(BINDING_TYPES.length, 12);
  const binding = buildExecutionPlanStageBinding({
    binding_id: 'binding-x', execution_plan_id: 'plan-x', execution_stage_id: 'stage-x', binding_type: 'TASK_BINDING',
    source_reference_id: 'taskref-x', source_reference_fingerprint: 'fp-x', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    project_id: 'proj-1', session_reference_id: 'session-1', agent_id: 'agent-1', binding_required: true, binding_validated: true
  });
  assert.equal(validateExecutionPlanStageBinding(binding).valid, true);
  assert.equal(validateExecutionPlanStageBinding({ ...binding, binding_applied: true }).valid, false);
});

test('execution plan dependency: exact fields (13), reuses PR #94 DEPENDENCY_TYPES, and rejects self-dependency', () => {
  assert.equal(EXECUTION_PLAN_DEPENDENCY_FIELDS.length, 13);
  const dependency = buildExecutionPlanDependency({
    dependency_id: 'dep-x', execution_plan_id: 'plan-x', from_stage_id: 'stage-1', to_stage_id: 'stage-2',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_validated: true
  });
  assert.equal(validateExecutionPlanDependency(dependency).valid, true);
  assert.throws(() => buildExecutionPlanDependency({
    dependency_id: 'dep-self', execution_plan_id: 'plan-x', from_stage_id: 'stage-1', to_stage_id: 'stage-1',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_validated: true
  }));
  assert.equal(dependency.dependency_satisfied, false);
  assert.equal(dependency.dependency_applied, false);
});

test('execution plan budget: exact fields (29) and budget_consumed is always false', () => {
  assert.equal(EXECUTION_PLAN_BUDGET_FIELDS.length, 29);
  const budget = scenarioFixture('prepared-no-llm-plan').request.execution_plan_budget;
  assert.equal(validateExecutionPlanBudget(budget).valid, true);
  assert.equal(validateExecutionPlanBudget({ ...budget, budget_consumed: true }).valid, false);
});

test('execution plan idempotency: exact fields (19), a synthetic normalized key, and duplicate_execution_blocked/idempotency_consumed forced', () => {
  assert.equal(EXECUTION_PLAN_IDEMPOTENCY_FIELDS.length, 19);
  const idempotency = scenarioFixture('prepared-no-llm-plan').request.idempotency_policy_reference;
  assert.equal(validateExecutionPlanIdempotency(idempotency).valid, true);
  assert.equal(validateExecutionPlanIdempotency({ ...idempotency, duplicate_execution_blocked: false }).valid, false);
  assert.equal(validateExecutionPlanIdempotency({ ...idempotency, idempotency_consumed: true }).valid, false);
  assert.equal(validateExecutionPlanIdempotency({ ...idempotency, idempotency_key_reference: 'has spaces!' }).valid, false, 'idempotency_key_reference must be a normalized synthetic identifier');
});

test('stop condition reference: exact fields (15), 16 condition types, and never evaluated in this PR', () => {
  assert.equal(EXECUTION_PLAN_STOP_CONDITION_FIELDS.length, 15);
  assert.equal(CONDITION_TYPES.length, 16);
  const condition = scenarioFixture('prepared-no-llm-plan').request.stop_condition_references[0];
  assert.equal(validateExecutionPlanStopCondition(condition).valid, true);
  assert.equal(condition.condition_evaluated, false);
  assert.equal(condition.condition_triggered, false);
  assert.equal(condition.stop_applied, false);
  assert.equal(validateExecutionPlanStopCondition({ ...condition, condition_evaluated: true }).valid, false);
});

test('compensation reference: exact fields (15), 5 compensation types, and never executed in this PR', () => {
  assert.equal(EXECUTION_PLAN_COMPENSATION_REFERENCE_FIELDS.length, 15);
  assert.deepEqual(COMPENSATION_TYPES, ['NONE', 'ROLLBACK_REFERENCE', 'REVERSE_ACTION_REFERENCE', 'MANUAL_COMPENSATION_REFERENCE', 'HUMAN_COMPENSATION_REFERENCE']);
  const compensation = buildExecutionPlanCompensationReference({
    compensation_reference_id: 'comp-x', execution_plan_id: 'plan-x', execution_stage_id: 'stage-x',
    compensation_type: 'ROLLBACK_REFERENCE', required: true, compensation_validated: true
  });
  assert.equal(validateExecutionPlanCompensationReference(compensation).valid, true);
  assert.equal(compensation.compensation_executed, false);
});

test('execution plan result: exact fields (67), 20 statuses, 4 decisions, 4 next states', () => {
  assert.equal(EXECUTION_PLAN_RESULT_FIELDS.length, 67);
  assert.equal(RESULT_STATUSES.length, 20);
  assert.equal(RESULT_DECISIONS.length, 4);
  assert.equal(NEXT_STATES.length, 4);
});

test('audit: exact fields (25)', () => {
  assert.equal(EXECUTION_PLAN_AUDIT_FIELDS.length, 25);
});

// ---------------------------------------------------------------------------
// EXECUTION_PLAN_PREPARED_SIMULATION and the two required model paths
// ---------------------------------------------------------------------------

test('EXECUTION_PLAN_PREPARED_SIMULATION reachable via NO_LLM and via an already-selected economical model, and executable is always false', () => {
  const noLlm = evaluateExecutionPlanRequest(scenarioFixture('prepared-no-llm-plan').request);
  assert.equal(noLlm.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  assert.equal(noLlm.plan.executable, false, 'even EXECUTION_PLAN_PREPARED_SIMULATION never becomes executable');
  assert.equal(noLlm.result.executable, false);

  const lowCost = evaluateExecutionPlanRequest(scenarioFixture('prepared-low-cost-model-plan').request);
  assert.equal(lowCost.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
});

test('the economical model selection is preserved end to end (this PR never re-selects a model)', () => {
  const request = scenarioFixture('prepared-low-cost-model-plan').request;
  assert.equal(request.model_selection_reference.selected_cost_tier, 'VERY_LOW');
  const outcome = evaluateExecutionPlanRequest(request);
  assert.equal(outcome.plan.model_selection_reference_id, request.model_selection_reference.reference_id);
  assert.equal(outcome.plan.model_fingerprint, stablePayload(request.model_selection_reference));
});

// ---------------------------------------------------------------------------
// Stages, stage types, dependencies, parallelism
// ---------------------------------------------------------------------------

test('deterministic, model, tool, and workflow stage types are each reachable, driven by which references are actually present', () => {
  const deterministic = scenarioFixture('deterministic-plan');
  assert.equal(deterministic.request.model_selection_reference.selected_cost_tier, 'ZERO_COST_REFERENCE');
  assert.equal(deterministic.request.tool_decision_references.length, 0);
  assert.equal(deterministic.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');

  const modelPlan = scenarioFixture('model-stage-plan');
  assert.equal(modelPlan.request.model_selection_reference.selected_cost_tier, 'VERY_LOW');
  assert.ok(modelPlan.plan.model_selection_reference_id);
  assert.equal(modelPlan.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');

  const toolPlan = scenarioFixture('tool-stage-plan');
  assert.ok(toolPlan.plan.tool_reference_ids.length > 0);
  assert.equal(toolPlan.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');

  const workflowPlan = scenarioFixture('workflow-stage-plan');
  assert.ok(workflowPlan.plan.workflow_reference_id);
  assert.equal(workflowPlan.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
});

test('a sequential dependency chain prepares, and a cyclic one is DEPENDENCY_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('sequential-plan').request, {
    dependencyRecords: [{ from_stage_id: 'stage-1', to_stage_id: 'stage-2', dependency_type: 'AFTER_SUCCESS_REFERENCE' }]
  }).result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');

  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('dependency-cycle-plan').request, {
    dependencyRecords: [{ from_stage_id: 'stage-1', to_stage_id: 'stage-2' }, { from_stage_id: 'stage-2', to_stage_id: 'stage-1' }]
  }).result.status, 'DEPENDENCY_BLOCKED');
});

test('a declarative parallel dependency prepares when allow_parallel_stage is true, and is DEPENDENCY_BLOCKED when the policy disallows it', () => {
  const request = scenarioFixture('parallel-plan').request;
  const parallelContext = { dependencyRecords: [{ from_stage_id: 'stage-1', to_stage_id: 'stage-2', dependency_type: 'PARALLEL_REFERENCE' }] };
  assert.equal(evaluateExecutionPlanRequest(request, parallelContext).result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');

  const disallowed = clone(request);
  disallowed.execution_plan_request_id = 'planreq-parallel-disallowed-check';
  disallowed.execution_plan_policy_reference = { ...disallowed.execution_plan_policy_reference, allow_parallel_stage: false };
  assert.equal(evaluateExecutionPlanRequest(disallowed, parallelContext).result.status, 'DEPENDENCY_BLOCKED');
});

test('dependencies declared on the plan without a matching dependencyRecords side-channel are DEPENDENCY_BLOCKED, not silently ignored', () => {
  const request = scenarioFixture('sequential-plan').request;
  assert.equal(evaluateExecutionPlanRequest(request, {}).result.status, 'DEPENDENCY_BLOCKED');
});

test('input order of tool_decision_references never changes the resulting plan (canonical order)', () => {
  const scenario = scenarioFixture('canonical-order-plan');
  const forward = evaluateExecutionPlanRequest(scenario.request);
  const reversedRequest = clone(scenario.request);
  reversedRequest.tool_decision_references = [...reversedRequest.tool_decision_references].reverse();
  const reversed = evaluateExecutionPlanRequest(reversedRequest);
  assert.equal(forward.result.status, reversed.result.status);
  assert.deepEqual([...forward.plan.tool_reference_ids].sort(), [...reversed.plan.tool_reference_ids].sort());
});

// ---------------------------------------------------------------------------
// Domain blocks (memory / context / model / tool / workflow)
// ---------------------------------------------------------------------------

test('a hard decision=BLOCKED on memory/context/model/tool/workflow references surfaces on the plan contract with its own dedicated status, while the outer result collapses to VALIDATION_FAILED', () => {
  const cases = [
    ['memory-blocked-plan', 'MEMORY_BLOCKED'], ['context-blocked-plan', 'CONTEXT_BLOCKED'],
    ['model-blocked-plan', 'MODEL_BLOCKED'], ['tool-blocked-plan', 'TOOL_BLOCKED'],
    ['workflow-blocked-plan', 'WORKFLOW_BLOCKED']
  ];
  for (const [key, expectedPlanStatus] of cases) {
    const outcome = evaluateExecutionPlanRequest(scenarioFixture(key).request);
    assert.equal(outcome.plan.execution_plan_status, expectedPlanStatus, `${key}: plan status`);
    assert.equal(outcome.result.status, 'VALIDATION_FAILED', `${key}: result status (RESULT_STATUSES has no equivalent bucket, see docs)`);
  }
});

// ---------------------------------------------------------------------------
// Budget / idempotency / stop conditions / compensation
// ---------------------------------------------------------------------------

test('budget within limit prepares, and an exceeded budget is BUDGET_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('prepared-no-llm-plan').request).result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('budget-blocked-plan').request).result.status, 'BUDGET_BLOCKED');
});

test('idempotency is required, and an invalid idempotency reference is IDEMPOTENCY_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('missing-idempotency-plan').request).result.status, 'IDEMPOTENCY_BLOCKED');
});

test('registry replay protection blocks a duplicate execution attempt for the same plan id', () => {
  const registry = createExecutionPlanRegistry();
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('duplicate-execution-plan').request);
  assert.equal(registry.registerExecutionPlan(outcome.plan, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerExecutionPlan(outcome.plan).status, 'REPLAY_ACCEPTED', 'an identical replay is accepted, never silently re-executed');
});

test('stop conditions are required when the policy demands them, and are never evaluated in this PR', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('missing-stop-condition-plan').request).result.status, 'STOP_CONDITION_BLOCKED');
  const prepared = evaluateExecutionPlanRequest(scenarioFixture('prepared-no-llm-plan').request);
  assert.equal(prepared.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
});

test('a state-change stage with a covered compensation prepares, and one without a covering compensation is COMPENSATION_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('state-change-with-compensation-plan').request).result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('state-change-without-compensation-plan').request).result.status, 'COMPENSATION_BLOCKED');
});

test('external effect and irreversible task references are both impossible to construct validly (the task reference contract forces both flags false)', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('external-effect-blocked-plan').request).result.status, 'VALIDATION_FAILED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('irreversible-blocked-plan').request).result.status, 'VALIDATION_FAILED');
});

// ---------------------------------------------------------------------------
// Approval / authorization / evidence
// ---------------------------------------------------------------------------

test('an approval-required plan is WAITING_APPROVAL_REFERENCE, never a hard block', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('approval-blocked-plan').request);
  assert.equal(outcome.result.status, 'WAITING_APPROVAL_REFERENCE');
  assert.equal(outcome.result.decision, 'REQUEST_APPROVAL_REFERENCE');
  assert.equal(outcome.result.next_state, 'WAITING_APPROVAL_REFERENCE');
  assert.equal(outcome.result.execution_authorized, false);
});

test('an authorization decision outside AUTHORIZED_SIMULATION blocks with a translated or generic status', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('authorization-blocked-plan').request).result.status, 'CONFLICT_BLOCKED');
});

test('an evidence bundle outside READY_EVIDENCE_SIMULATION with no direct status equivalent is EVIDENCE_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('evidence-blocked-plan').request).result.status, 'EVIDENCE_BLOCKED');
});

test('a missing binding for a selected tool/model/workflow reference is BINDING_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('missing-binding-plan').request).result.status, 'BINDING_BLOCKED');
});

// ---------------------------------------------------------------------------
// Tenant / organization / project / session / fingerprint / version
// ---------------------------------------------------------------------------

test('tenant, organization, project, and session mismatches on task_reference each block independently', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('tenant-mismatch-plan').request).result.status, 'TENANT_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('organization-mismatch-plan').request).result.status, 'ORGANIZATION_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('project-mismatch-plan').request).result.status, 'PROJECT_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('session-mismatch-plan').request).result.status, 'SESSION_BLOCKED');
});

test('a plan_fingerprint mismatch between planning result and plan reference is FINGERPRINT_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('fingerprint-mismatch-plan').request).result.status, 'FINGERPRINT_BLOCKED');
});

test('a tampered task_reference fingerprint is FINGERPRINT_BLOCKED (tamper detection)', () => {
  const request = clone(scenarioFixture('prepared-no-llm-plan').request);
  request.execution_plan_request_id = 'planreq-task-fingerprint-tamper-check';
  request.task_reference = { ...request.task_reference, task_complexity: 'TIER_4_COMPLEX' };
  assert.equal(evaluateExecutionPlanRequest(request).result.status, 'FINGERPRINT_BLOCKED');
});

test('a stale expected_registry_version is VERSION_BLOCKED', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('version-mismatch-plan').request, { currentRegistryVersion: 'v2' });
  assert.equal(outcome.result.status, 'VERSION_BLOCKED');
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test('precedence: a tenant mismatch wins over an also-broken budget', () => {
  const request = clone(scenarioFixture('budget-blocked-plan').request);
  request.execution_plan_request_id = 'planreq-precedence-tenant-over-budget';
  request.task_reference = { ...request.task_reference, tenant_id: 'tenant-other' };
  assert.equal(evaluateExecutionPlanRequest(request).result.status, 'TENANT_BLOCKED');
});

test('precedence: a fingerprint mismatch wins over an also-invalid idempotency reference', () => {
  const request = clone(scenarioFixture('fingerprint-mismatch-plan').request);
  request.execution_plan_request_id = 'planreq-precedence-fingerprint-over-idempotency';
  request.idempotency_policy_reference = { ...request.idempotency_policy_reference, idempotency_validated: false };
  assert.equal(evaluateExecutionPlanRequest(request).result.status, 'FINGERPRINT_BLOCKED');
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry validates by construction and protects against replay, payload mismatch, version conflict, and fingerprint conflict', () => {
  const registry = createExecutionPlanRegistry();
  const request = scenarioFixture('replay-plan').request;

  const first = registry.registerExecutionPlanRequest(request, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerExecutionPlanRequest(request).status, 'REPLAY_ACCEPTED');

  const payloadMismatch = { ...request, correlation_id: 'different-correlation' };
  assert.equal(registry.registerExecutionPlanRequest(payloadMismatch).status, 'PAYLOAD_MISMATCH');

  const versionBumped = { ...request, execution_plan_request_version: 2, correlation_id: 'different-correlation' };
  assert.equal(registry.registerExecutionPlanRequest(versionBumped, { expected_version: 5 }).status, 'VERSION_CONFLICT');
  assert.equal(registry.registerExecutionPlanRequest(versionBumped, { expected_version: 1 }).status, 'REGISTERED_SIMULATION');

  const versionBumpedAgain = { ...request, execution_plan_request_version: 3, correlation_id: 'yet-another' };
  assert.equal(registry.registerExecutionPlanRequest(versionBumpedAgain, { expected_fingerprint: 'stale' }).status, 'FINGERPRINT_CONFLICT');

  const stored = registry.getExecutionPlanRequestById(request.execution_plan_request_id);
  assert.equal(stored.execution_plan_request_version, 2, 'a rejected fingerprint conflict must not mutate the stored record');
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => { stored.correlation_id = 'x'; }, TypeError);
  assert.equal(registry.getExecutionPlanRequestById('unknown-id'), null);

  const invalid = registry.registerExecutionPlanRequest({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('registry blocks tenant and organization rebinding for plans without mutating the stored record', () => {
  const registry = createExecutionPlanRegistry();
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('prepared-no-llm-plan').request);
  assert.equal(registry.registerExecutionPlan(outcome.plan, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  const orgChanged = { ...outcome.plan, organization_id: `${outcome.plan.tenant_id}:org-different` };
  assert.equal(registry.registerExecutionPlan(orgChanged).status, 'ORGANIZATION_BLOCKED');
  const tenantChanged = { ...outcome.plan, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerExecutionPlan(tenantChanged).status, 'TENANT_BLOCKED');
  assert.equal(registry.getExecutionPlanById(outcome.plan.execution_plan_id).organization_id, outcome.plan.organization_id);
});

test('registry provides defensive clones (deep freeze)', () => {
  const registry = createExecutionPlanRegistry();
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('prepared-no-llm-plan').request);
  registry.registerExecutionPlan(outcome.plan, { expected_version: 0 });
  const fetched = registry.getExecutionPlanById(outcome.plan.execution_plan_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.execution_plan_status = 'x'; }, TypeError);
});

test('input is never mutated by contract construction', () => {
  const input = { execution_plan_id: 'plan-immutability-check', execution_plan_status: 'PREPARED_SIMULATION' };
  const frozenSnapshot = JSON.stringify(input);
  try {
    require('../src/core/execution-plan-contract').buildExecutionPlanContract(input);
  } catch (error) {
    // Construction may fail (missing required fields) -- what matters is input is never mutated.
  }
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
  test(`operational material detector blocks ${name} in execution plan contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate execution plan field names', () => {
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

test('regression execution plan modules do not use network, filesystem, eval, dynamic import, or timers', () => {
  const files = [
    'services/api/src/core/execution-plan-request.js', 'services/api/src/core/execution-plan-contract.js',
    'services/api/src/core/execution-plan-stage.js', 'services/api/src/core/execution-plan-stage-binding.js',
    'services/api/src/core/execution-plan-dependency.js', 'services/api/src/core/execution-plan-budget.js',
    'services/api/src/core/execution-plan-idempotency.js', 'services/api/src/core/execution-plan-stop-condition.js',
    'services/api/src/core/execution-plan-compensation-reference.js', 'services/api/src/core/execution-plan-result.js',
    'services/api/src/core/execution-plan-registry.js', 'services/api/src/core/execution-plan-audit.js',
    'services/api/src/core/execution-plan-engine.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval|setImmediate/.test(source), false);
    assert.equal(/\beval\(/.test(source), false);
    assert.equal(/\bnew Function\(/.test(source), false);
    assert.equal(/\bimport\(/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|ollama|openrouter|groq|together\.ai|huggingface/i.test(source), false);
    assert.equal(/qdrant|pinecone|weaviate|chroma|milvus/i.test(source), false);
    assert.equal(/postgres|supabase|redis/i.test(source), false);
  }
});

test('regression execution plan modules are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('execution-plan-engine'), false);
    assert.equal(source.includes('execution-plan-registry'), false);
  }
});

test('regression PRs 79 through 97 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js', 'services/api/src/core/orchestrator-planner.js',
    'services/api/src/core/orchestrator-planning-request.js', 'services/api/src/core/orchestrator-planning-result.js',
    'services/api/src/core/orchestrator-plan-stage.js', 'services/api/src/core/orchestrator-plan-dependency.js',
    'services/api/src/core/orchestrator-plan-approval.js', 'services/api/src/core/orchestrator-plan-reference.js',
    'services/api/src/core/orchestrator-decision-request.js', 'services/api/src/core/orchestrator-decision-engine.js',
    'services/api/src/core/orchestrator-decision-result.js', 'services/api/src/core/orchestrator-budget-evidence-reference.js',
    'services/api/src/core/orchestrator-readiness-evidence-bundle.js', 'services/api/src/core/orchestrator-decision-evidence-validator.js',
    'services/api/src/core/execution-authorization-boundary.js', 'services/api/src/core/execution-authorization-request.js',
    'services/api/src/core/execution-authorization-policy.js', 'services/api/src/core/execution-authorization-scope.js',
    'services/api/src/core/execution-authorization-actor-context.js', 'services/api/src/core/execution-authorization-approval-reference.js',
    'services/api/src/core/execution-authorization-budget-reference.js', 'services/api/src/core/execution-authorization-expiration.js',
    'services/api/src/core/execution-authorization-task-reference.js', 'services/api/src/core/execution-authorization-decision.js',
    'services/api/src/core/execution-authorization-registry.js', 'services/api/src/core/execution-authorization-audit.js'
  ].map((file) => path.join(repoRoot, file));
  const executionPlanModules = [
    'execution-plan-request', 'execution-plan-contract', 'execution-plan-stage-binding', 'execution-plan-stage',
    'execution-plan-dependency', 'execution-plan-budget', 'execution-plan-idempotency', 'execution-plan-stop-condition',
    'execution-plan-compensation-reference', 'execution-plan-result', 'execution-plan-registry', 'execution-plan-audit',
    'execution-plan-engine'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of executionPlanModules) {
      assert.equal(source.includes(moduleName), false, `${file} must not reference ${moduleName}`);
    }
  }
});

test('regression full suite invariant: no execution is ever authorized, started, or performed, across every named scenario', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    const outcome = evaluateExecutionPlanRequest(scenario.request, scenarioContext(key));
    assert.equal(outcome.plan.executable, false, `scenario ${key}: plan.executable`);
    assert.equal(outcome.plan.execution_authorized, false, `scenario ${key}: plan.execution_authorized`);
    assert.equal(outcome.plan.execution_started, false, `scenario ${key}: plan.execution_started`);
    assert.equal(outcome.plan.executed, false, `scenario ${key}: plan.executed`);
    assert.equal(outcome.plan.runtime_enabled, false, `scenario ${key}: plan.runtime_enabled`);
    assert.equal(outcome.result.executable, false, `scenario ${key}: result.executable`);
    assert.equal(outcome.result.execution_authorized, false, `scenario ${key}: result.execution_authorized`);
    assert.equal(outcome.result.execution_started, false, `scenario ${key}: result.execution_started`);
    assert.equal(outcome.result.stage_started, false, `scenario ${key}: result.stage_started`);
    assert.equal(outcome.result.stage_completed, false, `scenario ${key}: result.stage_completed`);
    assert.equal(outcome.result.tool_called, false, `scenario ${key}: result.tool_called`);
    assert.equal(outcome.result.workflow_executed, false, `scenario ${key}: result.workflow_executed`);
    assert.equal(outcome.result.provider_called, false, `scenario ${key}: result.provider_called`);
    assert.equal(outcome.result.model_called, false, `scenario ${key}: result.model_called`);
    assert.equal(outcome.result.network_used, false, `scenario ${key}: result.network_used`);
    assert.equal(outcome.result.memory_read, false, `scenario ${key}: result.memory_read`);
    assert.equal(outcome.result.memory_written, false, `scenario ${key}: result.memory_written`);
    assert.equal(outcome.result.tokens_consumed, false, `scenario ${key}: result.tokens_consumed`);
    assert.equal(outcome.result.cost_consumed, false, `scenario ${key}: result.cost_consumed`);
    assert.equal(outcome.result.runtime_enabled, false, `scenario ${key}: result.runtime_enabled`);
    assert.equal(outcome.result.executed, false, `scenario ${key}: result.executed`);
  }
});
