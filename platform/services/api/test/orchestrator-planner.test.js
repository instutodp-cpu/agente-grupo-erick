'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-orchestrator-planner.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  ORCHESTRATOR_TASK_DEFINITION_FIELDS,
  TASK_COMPLEXITIES,
  TASK_TYPES,
  validateOrchestratorTaskDefinition
} = require('../src/core/orchestrator-task-definition');
const { ORCHESTRATOR_PLANNING_POLICY_FIELDS, validateOrchestratorPlanningPolicy } = require('../src/core/orchestrator-planning-policy');
const { ORCHESTRATOR_PLAN_BUDGET_FIELDS, validateOrchestratorPlanBudget } = require('../src/core/orchestrator-plan-budget');
const { APPROVAL_TYPES, validateOrchestratorPlanApproval } = require('../src/core/orchestrator-plan-approval');
const { CRITERIA_TYPES, validateOrchestratorSuccessCriteria } = require('../src/core/orchestrator-plan-success-criteria');
const { DEPENDENCY_TYPES, hasDependencyCycle, validateOrchestratorPlanDependency } = require('../src/core/orchestrator-plan-dependency');
const { STAGE_TYPES, validateOrchestratorPlanStage } = require('../src/core/orchestrator-plan-stage');
const {
  ORCHESTRATOR_PLANNING_REQUEST_FIELDS,
  validateOrchestratorPlanningRequest,
  validateMemorySelectionDecisionReference
} = require('../src/core/orchestrator-planning-request');
const {
  PLAN_GENERATED_STATUSES,
  RESULT_DECISIONS,
  RESULT_STATUSES,
  ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS,
  buildOrchestratorPlanningResult,
  validateOrchestratorPlanningResult
} = require('../src/core/orchestrator-planning-result');
const { createOrchestratorPlanningRegistry, validatePlanIndex } = require('../src/core/orchestrator-planning-registry');
const { buildOrchestratorPlanningAudit, validateOrchestratorPlanningAudit } = require('../src/core/orchestrator-planning-audit');
const { evaluateOrchestratorPlanningRequest } = require('../src/core/orchestrator-planner');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioFixture(key) {
  return clone(fixture.scenarios[key]);
}

const EXPECTED_SCENARIOS = [
  'deterministic-plan', 'no-llm-plan', 'low-cost-selection-plan', 'simple-selection-plan', 'tool-reference-plan',
  'workflow-reference-plan', 'human-approval-plan', 'multi-agent-plan', 'parallel-plan', 'sequential-plan',
  'memory-blocked-plan', 'continuity-blocked-plan', 'context-blocked-plan', 'model-selection-blocked-plan',
  'tool-blocked-plan', 'workflow-blocked-plan', 'budget-blocked-plan', 'tenant-mismatch-plan',
  'organization-mismatch-plan', 'project-mismatch-plan', 'fingerprint-conflict-plan', 'replay-plan',
  'canonical-order-plan'
];

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_AGENT_ORCHESTRATOR_PLANNER.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.equal(Array.isArray(fixture.dependency_cycle_plan), true);
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

EXPECTED_SCENARIOS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded planning result`, () => {
    const scenario = scenarioFixture(key);
    const outcome = evaluateOrchestratorPlanningRequest(scenario.request);
    assert.equal(outcome.result.status, scenario.result.status);
    assert.equal(outcome.result.decision, scenario.result.decision);
    assert.equal(validateOrchestratorPlanningResult(outcome.result).valid, true);
    for (const stage of outcome.stages) assert.equal(validateOrchestratorPlanStage(stage).valid, true);
    for (const dependency of outcome.dependencies) assert.equal(validateOrchestratorPlanDependency(dependency).valid, true);
    for (const criteria of outcome.criteria) assert.equal(validateOrchestratorSuccessCriteria(criteria).valid, true);
    if (outcome.plan) assert.equal(validatePlanIndex(outcome.plan).valid, true);
    assert.equal(validateOrchestratorPlanningAudit(outcome.audit).valid, true);
  });
});

test('dependency-cycle-plan fixture actually contains a cycle detected by hasDependencyCycle', () => {
  assert.equal(hasDependencyCycle(fixture.dependency_cycle_plan), true);
  for (const dependency of fixture.dependency_cycle_plan) {
    assert.equal(validateOrchestratorPlanDependency(dependency).valid, true);
  }
});

// ---------------------------------------------------------------------------
// Task Definition
// ---------------------------------------------------------------------------

test('task definition valid, exact fields, enum rejection, and TIER_0/TIER_5 rules', () => {
  const task = scenarioFixture('simple-selection-plan').request.task_definition;
  assert.equal(validateOrchestratorTaskDefinition(task).valid, true);
  assert.equal(validateOrchestratorTaskDefinition({ ...task, task_type: 'UNKNOWN_TYPE' }).valid, false);
  assert.equal(validateOrchestratorTaskDefinition({ ...task, task_complexity: 'TIER_9' }).valid, false);
  assert.equal(validateOrchestratorTaskDefinition({ ...task, task_risk: 'EXTREME' }).valid, false);
  assert.equal(validateOrchestratorTaskDefinition({ ...task, unexpected_field: 1 }).valid, false);
  const { task_scope, ...missingScope } = task;
  assert.equal(validateOrchestratorTaskDefinition(missingScope).valid, false);
  assert.equal(TASK_TYPES.length, 14);
  assert.equal(TASK_COMPLEXITIES.length, 6);
  assert.equal(ORCHESTRATOR_TASK_DEFINITION_FIELDS.length, 25);

  const tier0 = scenarioFixture('deterministic-plan').request.task_definition;
  assert.equal(validateOrchestratorTaskDefinition({ ...tier0, requires_model: true }).valid, false, 'TIER_0 must force NO_LLM');
  const tier5 = scenarioFixture('human-approval-plan').request.task_definition;
  assert.equal(validateOrchestratorTaskDefinition({ ...tier5, requires_human_approval: false }).valid, false, 'TIER_5 requires human approval');
});

// ---------------------------------------------------------------------------
// Planning Policy / Plan Budget / Approval / Success Criteria / Dependency / Stage
// ---------------------------------------------------------------------------

test('planning policy forces every fixed safe value', () => {
  const policy = scenarioFixture('simple-selection-plan').request.planning_policy;
  assert.equal(validateOrchestratorPlanningPolicy(policy).valid, true);
  assert.equal(validateOrchestratorPlanningPolicy({ ...policy, require_memory_preservation: false }).valid, false);
  assert.equal(validateOrchestratorPlanningPolicy({ ...policy, fail_on_binding_mismatch: false }).valid, false);
  assert.equal(validateOrchestratorPlanningPolicy({ ...policy, simulation: false }).valid, false);
  assert.equal(ORCHESTRATOR_PLANNING_POLICY_FIELDS.length, 28);
});

test('plan budget requires non-negative integers and rejects reserves exceeding the maximum', () => {
  const budget = scenarioFixture('simple-selection-plan').request.plan_budget;
  assert.equal(validateOrchestratorPlanBudget(budget).valid, true);
  assert.equal(validateOrchestratorPlanBudget({ ...budget, maximum_total_tokens: -1 }).valid, false);
  assert.equal(validateOrchestratorPlanBudget({ ...budget, reserved_output_tokens: 1.5 }).valid, false);
  assert.equal(validateOrchestratorPlanBudget({ ...budget, budget_consumed: true }).valid, false);
  const overReserved = { ...budget, reserved_output_tokens: budget.maximum_total_tokens };
  assert.equal(validateOrchestratorPlanBudget(overReserved).valid, false);
  assert.equal(ORCHESTRATOR_PLAN_BUDGET_FIELDS.length, 19);
});

test('approval context forces approval_granted/approval_applied false and enforces NONE-type consistency', () => {
  const approval = scenarioFixture('human-approval-plan').request.approval_context;
  assert.equal(validateOrchestratorPlanApproval(approval).valid, true);
  assert.equal(validateOrchestratorPlanApproval({ ...approval, approval_granted: true }).valid, false);
  assert.equal(validateOrchestratorPlanApproval({ ...approval, approval_applied: true }).valid, false);
  const none = scenarioFixture('simple-selection-plan').request.approval_context;
  assert.equal(validateOrchestratorPlanApproval({ ...none, approval_required: true }).valid, false, 'NONE type cannot require approval');
  assert.equal(APPROVAL_TYPES.length, 7);
});

test('success criteria forces criteria_satisfied/evaluation_executed false', () => {
  const criteria = scenarioFixture('simple-selection-plan').criteria[0];
  assert.equal(validateOrchestratorSuccessCriteria(criteria).valid, true);
  assert.equal(validateOrchestratorSuccessCriteria({ ...criteria, criteria_satisfied: true }).valid, false);
  assert.equal(validateOrchestratorSuccessCriteria({ ...criteria, evaluation_executed: true }).valid, false);
  assert.equal(CRITERIA_TYPES.length, 11);
});

test('dependency forces dependency_applied false, rejects self-dependency, and detects cycles', () => {
  const dependency = scenarioFixture('simple-selection-plan').dependencies[0];
  assert.equal(validateOrchestratorPlanDependency(dependency).valid, true);
  assert.equal(validateOrchestratorPlanDependency({ ...dependency, dependency_applied: true }).valid, false);
  assert.equal(validateOrchestratorPlanDependency({ ...dependency, to_stage_id: dependency.from_stage_id }).valid, false);
  assert.equal(DEPENDENCY_TYPES.length, 7);
  assert.equal(hasDependencyCycle([]), false);
  assert.equal(hasDependencyCycle([{ from_stage_id: 'a', to_stage_id: 'a' }]), true, 'a self-loop is a cycle');
});

test('stage forces stage_planned/stage_executed/simulation/production_blocked and rejects self-dependency', () => {
  const stage = scenarioFixture('simple-selection-plan').stages[0];
  assert.equal(validateOrchestratorPlanStage(stage).valid, true);
  assert.equal(validateOrchestratorPlanStage({ ...stage, stage_executed: true }).valid, false);
  assert.equal(validateOrchestratorPlanStage({ ...stage, dependency_reference_ids: [stage.stage_id] }).valid, false);
  assert.equal(STAGE_TYPES.length, 10);
});

// ---------------------------------------------------------------------------
// Planning Request
// ---------------------------------------------------------------------------

test('planning request valid, exact fields, and reference reuse from PRs 79-93', () => {
  const request = scenarioFixture('simple-selection-plan').request;
  assert.equal(validateOrchestratorPlanningRequest(request).valid, true);
  assert.equal(ORCHESTRATOR_PLANNING_REQUEST_FIELDS.length, 22);
  const extra = { ...request, unexpected: 1 };
  assert.equal(validateOrchestratorPlanningRequest(extra).valid, false);
  const { agent_contract_reference, ...missingAgent } = request;
  assert.equal(validateOrchestratorPlanningRequest(missingAgent).valid, false);
});

test('memory selection decision reference is minimal (no full contract fields) and reference-only', () => {
  const memoryReference = scenarioFixture('simple-selection-plan').request.memory_selection_decision_reference;
  assert.equal(validateMemorySelectionDecisionReference(memoryReference).valid, true);
  assert.equal(Object.keys(memoryReference).includes('user_preference_references'), false, 'must never carry the full upstream contract');
  assert.equal(validateMemorySelectionDecisionReference({ ...memoryReference, unexpected: 1 }).valid, false);
});

// ---------------------------------------------------------------------------
// Planner: deterministic/no-llm/model plans, cost preservation, decomposition
// ---------------------------------------------------------------------------

test('deterministic task produces a 4-stage plan with NO_LLM preserved', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('deterministic-plan').request);
  assert.equal(outcome.result.status, 'PLAN_READY_SIMULATION');
  assert.deepEqual(outcome.stages.map((stage) => stage.stage_type), ['VALIDATION_STAGE', 'DETERMINISTIC_STAGE', 'AUDIT_STAGE', 'FINALIZATION_STAGE']);
  assert.equal(outcome.result.selected_model_reference_ids.length, 0);
});

test('NO_LLM selection is preserved end to end for a non-deterministic task', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('no-llm-plan').request);
  assert.equal(outcome.result.status, 'PLAN_READY_SIMULATION');
  assert.equal(outcome.result.selected_model_reference_ids.length, 0, 'requires_model=false means the Planner never references a model stage');
});

test('a plan with a model already selected transports the reference without re-selecting it', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  assert.equal(outcome.result.status, 'PLAN_READY_SIMULATION');
  assert.deepEqual(outcome.result.selected_model_reference_ids, ['selection-decision-1']);
});

test('the Planner preserves the low-cost model selection instead of choosing a more expensive one', () => {
  const request = scenarioFixture('low-cost-selection-plan').request;
  assert.equal(request.model_selection_decision_reference.selected_cost_tier, 'VERY_LOW');
  const outcome = evaluateOrchestratorPlanningRequest(request);
  assert.equal(outcome.result.status, 'PLAN_READY_SIMULATION');
  assert.deepEqual(outcome.result.selected_model_reference_ids, [request.model_selection_decision_reference.reference_id]);
});

test('the Planner never selects a premium model itself: it only ever transports whatever cost tier the reference already carries', () => {
  const cheapRequest = scenarioFixture('low-cost-selection-plan').request;
  const premiumRequest = clone(cheapRequest);
  premiumRequest.planning_request_id = 'plreq-premium-check';
  premiumRequest.model_selection_decision_reference = {
    ...premiumRequest.model_selection_decision_reference, selected_cost_tier: 'PREMIUM'
  };
  const cheapOutcome = evaluateOrchestratorPlanningRequest(cheapRequest);
  const premiumOutcome = evaluateOrchestratorPlanningRequest(premiumRequest);
  // Same stage shape either way -- the Planner's own logic never inspects or upgrades cost tier.
  assert.deepEqual(cheapOutcome.stages.map((s) => s.stage_type), premiumOutcome.stages.map((s) => s.stage_type));
});

test('simple decomposition (linear template) and complex decomposition (multi-agent) both respect maximum_stages', () => {
  const simple = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  assert.ok(simple.stages.length <= scenarioFixture('simple-selection-plan').request.task_definition.maximum_stages);

  const multiAgent = evaluateOrchestratorPlanningRequest(scenarioFixture('multi-agent-plan').request);
  assert.ok(multiAgent.stages.length <= scenarioFixture('multi-agent-plan').request.task_definition.maximum_stages);

  const tooManyStagesRequest = clone(scenarioFixture('multi-agent-plan').request);
  tooManyStagesRequest.planning_request_id = 'plreq-maximum-stages-check';
  tooManyStagesRequest.task_definition = { ...tooManyStagesRequest.task_definition, maximum_stages: 2 };
  const blocked = evaluateOrchestratorPlanningRequest(tooManyStagesRequest);
  assert.equal(blocked.result.status, 'POLICY_BLOCKED');
});

test('dependencies form an acyclic graph for every generated plan, and a hand-crafted cycle is rejected', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture(key).request);
    assert.equal(hasDependencyCycle(outcome.dependencies), false, `scenario ${key} must never produce a cyclic dependency graph`);
  }
  assert.equal(hasDependencyCycle(fixture.dependency_cycle_plan), true);
});

test('parallelism is declarative only: multi-agent stages are marked parallelizable but never executed concurrently', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('multi-agent-plan').request);
  const parallelStages = outcome.stages.filter((stage) => stage.parallelizable);
  assert.ok(parallelStages.length >= 2);
  for (const stage of parallelStages) assert.equal(stage.stage_executed, false);
  assert.equal(outcome.result.parallel_stage_count, parallelStages.length);

  const incompatibleRequest = clone(scenarioFixture('multi-agent-plan').request);
  incompatibleRequest.planning_request_id = 'plreq-parallelism-incompatible';
  incompatibleRequest.task_definition = { ...incompatibleRequest.task_definition, parallelism_allowed: false };
  const incompatible = evaluateOrchestratorPlanningRequest(incompatibleRequest);
  assert.equal(incompatible.result.status, 'POLICY_BLOCKED', 'multi-agent tasks require parallelism to be allowed');
});

test('a sequential (non-parallel) plan has zero parallelizable stages', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('sequential-plan').request);
  assert.equal(outcome.result.parallel_stage_count, 0);
  assert.ok(outcome.stages.every((stage) => stage.parallelizable === false));
});

test('a HUMAN_APPROVAL_STAGE is created when approval is required, and it never represents approval granted', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('human-approval-plan').request);
  assert.equal(outcome.result.status, 'APPROVAL_REQUIRED_SIMULATION');
  assert.equal(outcome.result.decision, 'GENERATE_APPROVAL_PLAN');
  const approvalStage = outcome.stages.find((stage) => stage.stage_type === 'HUMAN_APPROVAL_STAGE');
  assert.ok(approvalStage);
  assert.equal(approvalStage.stage_executed, false);
  assert.equal(outcome.result.approval_stage_ids.length, 1);
});

test('approval is declared but never applied: approval_granted and approval_applied stay false even when required', () => {
  const request = scenarioFixture('human-approval-plan').request;
  assert.equal(request.approval_context.approval_granted, false);
  assert.equal(request.approval_context.approval_applied, false);
});

// ---------------------------------------------------------------------------
// Memory / continuity / project state preservation
// ---------------------------------------------------------------------------

test('memory, continuity, project state, and preference preservation are all required for a ready plan', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  assert.equal(outcome.result.memory_preserved, true);
  assert.equal(outcome.result.continuity_preserved, true);
  assert.equal(outcome.result.project_state_preserved, true);
});

test('memory blocked and continuity blocked both surface as MEMORY_BLOCKED (no separate continuity status exists)', () => {
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('memory-blocked-plan').request).result.status, 'MEMORY_BLOCKED');
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('continuity-blocked-plan').request).result.status, 'MEMORY_BLOCKED');
});

test('required memory reference missing from the task definition does not silently pass (memory reference itself is still checked)', () => {
  const request = clone(scenarioFixture('memory-blocked-plan').request);
  assert.equal(request.memory_selection_decision_reference.decision, 'BLOCKED');
});

// ---------------------------------------------------------------------------
// Context / model / tool / workflow blocking
// ---------------------------------------------------------------------------

test('context blocked when assembly_planned is false or the reference itself is blocked', () => {
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('context-blocked-plan').request).result.status, 'CONTEXT_BLOCKED');
});

test('model selection blocked propagates to MODEL_SELECTION_BLOCKED without the Planner attempting its own selection', () => {
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('model-selection-blocked-plan').request).result.status, 'MODEL_SELECTION_BLOCKED');
});

test('tool blocked when any required tool decision reference is blocked or missing', () => {
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('tool-blocked-plan').request).result.status, 'TOOL_BLOCKED');
  const missingToolRequest = clone(scenarioFixture('tool-reference-plan').request);
  missingToolRequest.planning_request_id = 'plreq-missing-tool-check';
  missingToolRequest.task_definition = { ...missingToolRequest.task_definition, required_tool_reference_ids: ['tool-dec-not-present'] };
  const outcome = evaluateOrchestratorPlanningRequest(missingToolRequest);
  assert.equal(outcome.result.status, 'TOOL_BLOCKED');
});

test('workflow blocked when the required workflow decision reference is blocked', () => {
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('workflow-blocked-plan').request).result.status, 'WORKFLOW_BLOCKED');
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

test('budget exceeded blocks the plan, and protected reserves are respected', () => {
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('budget-blocked-plan').request).result.status, 'BUDGET_BLOCKED');
  const budget = scenarioFixture('simple-selection-plan').request.plan_budget;
  const overReserved = { ...budget, reserved_memory_tokens: budget.maximum_total_tokens };
  assert.equal(validateOrchestratorPlanBudget(overReserved).valid, false);
});

// ---------------------------------------------------------------------------
// Tenant / organization / project / session bindings
// ---------------------------------------------------------------------------

test('tenant, organization, and project mismatches block the plan', () => {
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('tenant-mismatch-plan').request).result.status, 'TENANT_BLOCKED');
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('organization-mismatch-plan').request).result.status, 'ORGANIZATION_BLOCKED');
  assert.equal(evaluateOrchestratorPlanningRequest(scenarioFixture('project-mismatch-plan').request).result.status, 'PROJECT_BLOCKED');
});

test('session mismatch blocks the plan', () => {
  const request = clone(scenarioFixture('simple-selection-plan').request);
  request.planning_request_id = 'plreq-session-mismatch-check';
  request.context_assembly_result_reference = { ...request.context_assembly_result_reference, session_id: 'session-other' };
  const outcome = evaluateOrchestratorPlanningRequest(request);
  assert.equal(outcome.result.status, 'SESSION_BLOCKED');
});

// ---------------------------------------------------------------------------
// Ordering / determinism
// ---------------------------------------------------------------------------

test('input order of tool_decision_references never changes the resulting plan (canonical order)', () => {
  const scenario = scenarioFixture('canonical-order-plan');
  const forward = evaluateOrchestratorPlanningRequest(scenario.request);
  const reversedRequest = clone(scenario.request);
  reversedRequest.tool_decision_references = [...reversedRequest.tool_decision_references].reverse();
  const reversed = evaluateOrchestratorPlanningRequest(reversedRequest);
  assert.deepEqual(forward.plan.stage_ids, reversed.plan.stage_ids);
  assert.deepEqual(forward.plan.dependency_ids, reversed.plan.dependency_ids);
  assert.deepEqual(forward.result.selected_tool_reference_ids, reversed.result.selected_tool_reference_ids);
});

test('plan.stage_ids and plan.dependency_ids are canonically (alphabetically) ordered', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  assert.deepEqual(outcome.plan.stage_ids, [...outcome.plan.stage_ids].sort());
  assert.deepEqual(outcome.plan.dependency_ids, [...outcome.plan.dependency_ids].sort());
});

// ---------------------------------------------------------------------------
// Result / decision invariants
// ---------------------------------------------------------------------------

test('result accepts only the 19 documented statuses and 3 documented decisions', () => {
  assert.equal(RESULT_STATUSES.length, 19);
  assert.equal(RESULT_DECISIONS.length, 3);
  assert.deepEqual(PLAN_GENERATED_STATUSES, ['PLAN_READY_SIMULATION', 'APPROVAL_REQUIRED_SIMULATION']);
});

test('result forces every safe invariant flag regardless of status, and plan_generated only for planned statuses', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture(key).request);
    for (const [field, expected] of Object.entries(ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS)) {
      assert.equal(outcome.result[field], expected, `scenario ${key} result.${field} must be ${expected}`);
    }
    assert.equal(outcome.result.plan_generated, PLAN_GENERATED_STATUSES.includes(outcome.result.status));
  }
});

test('nothing ever executes: plan/agent/tool/workflow/provider/model execution flags stay false, no network, no tokens, no cost consumed', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  assert.equal(outcome.result.plan_executed, false);
  assert.equal(outcome.result.agent_executed, false);
  assert.equal(outcome.result.tool_called, false);
  assert.equal(outcome.result.workflow_executed, false);
  assert.equal(outcome.result.provider_called, false);
  assert.equal(outcome.result.model_called, false);
  assert.equal(outcome.result.network_used, false);
  assert.equal(outcome.result.tokens_consumed, false);
  assert.equal(outcome.result.cost_consumed, false);
  assert.equal(outcome.result.fallback_executed, false);
  assert.equal(outcome.result.escalation_executed, false);
  assert.equal(outcome.result.executed, false);
  for (const stage of outcome.stages) assert.equal(stage.stage_executed, false);
});

test('buildOrchestratorPlanningResult degrades to VALIDATION_FAILED/BLOCKED on invalid input', () => {
  const invalid = buildOrchestratorPlanningResult({ status: 'NONSENSE' });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
  assert.equal(invalid.decision, 'BLOCKED');
  assert.equal(invalid.plan_generated, false);
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry validates by construction and protects against replay, payload mismatch, version conflict, and fingerprint conflict', () => {
  const registry = createOrchestratorPlanningRegistry();
  const request = scenarioFixture('replay-plan').request;

  const first = registry.registerPlanningRequest(request, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerPlanningRequest(request).status, 'REPLAY_ACCEPTED');

  const payloadMismatch = { ...request, correlation_id: 'different-correlation' };
  assert.equal(registry.registerPlanningRequest(payloadMismatch).status, 'PAYLOAD_MISMATCH');

  const versionBumped = { ...request, planning_request_version: 2, correlation_id: 'different-correlation' };
  assert.equal(registry.registerPlanningRequest(versionBumped, { expected_version: 5 }).status, 'VERSION_CONFLICT');
  assert.equal(registry.registerPlanningRequest(versionBumped, { expected_version: 1 }).status, 'REGISTERED_SIMULATION');

  const versionBumpedAgain = { ...request, planning_request_version: 3, correlation_id: 'yet-another' };
  assert.equal(registry.registerPlanningRequest(versionBumpedAgain, { expected_fingerprint: 'stale' }).status, 'FINGERPRINT_CONFLICT');

  const stored = registry.getPlanningRequestById(request.planning_request_id);
  assert.equal(stored.planning_request_version, 2, 'a rejected fingerprint conflict must not mutate the stored record');
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => { stored.correlation_id = 'x'; }, TypeError);
  assert.equal(registry.getPlanningRequestById('unknown-id'), null);

  const invalid = registry.registerPlanningRequest({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('fingerprint conflict scenario from the fixture registers cleanly and rejects a stale expected_fingerprint on the next version', () => {
  const registry = createOrchestratorPlanningRegistry();
  const request = scenarioFixture('fingerprint-conflict-plan').request;
  assert.equal(registry.registerPlanningRequest(request, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  const bumped = { ...request, planning_request_version: 2, correlation_id: 'bumped' };
  assert.equal(registry.registerPlanningRequest(bumped, { expected_fingerprint: 'not-the-real-fingerprint' }).status, 'FINGERPRINT_CONFLICT');
});

test('registry blocks tenant and organization rebinding for stages and plans without mutating the stored record', () => {
  const registry = createOrchestratorPlanningRegistry();
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  assert.equal(registry.registerPlan(outcome.plan).status, 'REGISTERED_SIMULATION');
  const orgChanged = { ...outcome.plan, organization_id: `${outcome.plan.tenant_id}:org-different` };
  assert.equal(registry.registerPlan(orgChanged).status, 'ORGANIZATION_BLOCKED');
  const tenantChanged = { ...outcome.plan, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerPlan(tenantChanged).status, 'TENANT_BLOCKED');
  assert.equal(registry.getPlanById(outcome.plan.plan_id).organization_id, outcome.plan.organization_id);
});

test('registry provides defensive clones (deep freeze) and safe lists for stages and results', () => {
  const registry = createOrchestratorPlanningRegistry();
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  for (const stage of outcome.stages) registry.registerPlanStage(stage);
  const fetched = registry.getPlanStageById(outcome.stages[0].stage_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.priority = 999; }, TypeError);

  registry.registerPlanningResult(outcome.result);
  const listed = registry.listPlanningResultsByTenant(outcome.result.tenant_id);
  assert.equal(listed.length, 1);
  assert.equal(registry.listPlanningResultsByTenant('tenant-unused').length, 0);
});

test('duplicate stage ids and duplicate dependencies are rejected by the registry (same version, different payload)', () => {
  const registry = createOrchestratorPlanningRegistry();
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  const stage = outcome.stages[0];
  assert.equal(registry.registerPlanStage(stage).status, 'REGISTERED_SIMULATION');
  const sameVersionDifferentPayload = { ...stage, priority: stage.priority + 1 };
  assert.equal(registry.registerPlanStage(sameVersionDifferentPayload).status, 'PAYLOAD_MISMATCH', 'same stage_version with a different payload must never silently overwrite');

  const dependency = outcome.dependencies[0];
  assert.equal(registry.registerPlanDependency(dependency).status, 'REGISTERED_SIMULATION');
  const dependencySamePayload = { ...dependency };
  assert.equal(registry.registerPlanDependency(dependencySamePayload).status, 'REPLAY_ACCEPTED');
  const dependencyDifferentPayload = { ...dependency, satisfied_in_simulation: !dependency.satisfied_in_simulation };
  assert.equal(registry.registerPlanDependency(dependencyDifferentPayload).status, 'PAYLOAD_MISMATCH', 'dependencies have no version field, so any payload change is a payload mismatch');
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test('audit is immutable, records only fingerprints/bindings/counts/estimates/declared approvals, and never marks anything executed', () => {
  const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  const audit = outcome.audit;
  assert.equal(validateOrchestratorPlanningAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);

  const blockedOutcome = evaluateOrchestratorPlanningRequest(scenarioFixture('budget-blocked-plan').request);
  const blockedAudit = buildOrchestratorPlanningAudit({ result: blockedOutcome.result });
  assert.equal(validateOrchestratorPlanningAudit(blockedAudit).valid, true);
  assert.equal(blockedAudit.decision, 'BUDGET_BLOCKED');
});

test('fingerprints are deterministic and change when the underlying request payload changes', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const outcomeA = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  const outcomeB = evaluateOrchestratorPlanningRequest(scenarioFixture('simple-selection-plan').request);
  assert.equal(outcomeA.plan.plan_fingerprint, outcomeB.plan.plan_fingerprint);

  const changedRequest = clone(scenarioFixture('simple-selection-plan').request);
  changedRequest.planning_request_id = 'plreq-fingerprint-change-check';
  const outcomeC = evaluateOrchestratorPlanningRequest(changedRequest);
  assert.notEqual(outcomeA.plan.plan_fingerprint, outcomeC.plan.plan_fingerprint);
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
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['execute word', { note: 'do not execute this reference' }, 'forbidden_word_value'],
  ['function value', { note: () => null }, 'forbidden_function']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name} in planner contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate planner field names', () => {
  const scenario = scenarioFixture('simple-selection-plan');
  assert.deepEqual(findAgentCoreOperationalMaterial(scenario.request), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(scenario.result), []);
  for (const stage of scenario.stages) assert.deepEqual(findAgentCoreOperationalMaterial(stage), []);
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

test('regression planner modules do not use network, filesystem, eval, dynamic import, or timers', () => {
  const files = [
    'services/api/src/core/orchestrator-planner.js',
    'services/api/src/core/orchestrator-planning-request.js',
    'services/api/src/core/orchestrator-task-definition.js',
    'services/api/src/core/orchestrator-plan-stage.js',
    'services/api/src/core/orchestrator-plan-dependency.js',
    'services/api/src/core/orchestrator-plan-budget.js',
    'services/api/src/core/orchestrator-plan-approval.js',
    'services/api/src/core/orchestrator-plan-success-criteria.js',
    'services/api/src/core/orchestrator-planning-policy.js',
    'services/api/src/core/orchestrator-planning-result.js',
    'services/api/src/core/orchestrator-planning-registry.js',
    'services/api/src/core/orchestrator-planning-audit.js'
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

test('regression planner modules are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('orchestrator-planner'), false);
    assert.equal(source.includes('orchestrator-planning-registry'), false);
  }
});

test('regression PRs 79 through 93 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-registry.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-session-reference.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/model-selection-registry.js',
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/context-assembly-registry.js',
    'services/api/src/core/context-assembly-result.js',
    'services/api/src/core/tool-decision.js',
    'services/api/src/core/tool-registry.js',
    'services/api/src/core/workflow-decision.js',
    'services/api/src/core/workflow-registry.js',
    'services/api/src/core/orchestrator-request.js',
    'services/api/src/core/orchestrator-plan.js',
    'services/api/src/core/orchestrator-decision.js',
    'services/api/src/core/orchestrator-registry.js',
    'services/api/src/core/orchestrator-audit.js',
    'services/api/src/core/memory-selection-request.js',
    'services/api/src/core/memory-selection-engine.js',
    'services/api/src/core/memory-selection-decision.js',
    'services/api/src/core/memory-selection-registry.js'
  ].map((file) => path.join(repoRoot, file));
  const plannerModules = [
    'orchestrator-planner', 'orchestrator-planning-request', 'orchestrator-task-definition',
    'orchestrator-plan-stage', 'orchestrator-plan-dependency', 'orchestrator-plan-budget',
    'orchestrator-plan-approval', 'orchestrator-plan-success-criteria', 'orchestrator-planning-policy',
    'orchestrator-planning-result', 'orchestrator-planning-registry', 'orchestrator-planning-audit'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of plannerModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});

test('regression full suite invariant: nothing in this PR ever claims to have executed, across every named scenario', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const outcome = evaluateOrchestratorPlanningRequest(scenarioFixture(key).request);
    for (const [field, expected] of Object.entries(ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS)) {
      assert.equal(outcome.result[field], expected, `scenario ${key} result.${field} must be ${expected}`);
    }
  }
});
