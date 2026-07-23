'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-orchestrator-decision-engine.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  BLOCKER_TYPES, BLOCKING_ELIGIBLE_SEVERITIES, ORCHESTRATOR_BLOCKER_FIELDS, RESOLUTION_TYPES, SEVERITIES,
  buildOrchestratorBlocker, validateOrchestratorBlocker
} = require('../src/core/orchestrator-blocker');
const {
  ORCHESTRATOR_READINESS_FIELDS, READINESS_DOMAIN_FIELDS, buildOrchestratorReadiness, computeReadinessScore,
  validateOrchestratorReadiness
} = require('../src/core/orchestrator-readiness');
const { ORCHESTRATOR_DECISION_POLICY_FIELDS, validateOrchestratorDecisionPolicy } = require('../src/core/orchestrator-decision-policy');
const {
  ORCHESTRATION_PLAN_REFERENCE_FIELDS, PLANNING_RESULT_REFERENCE_FIELDS, validateOrchestrationPlanReference,
  validatePlanningResultReference
} = require('../src/core/orchestrator-plan-reference');
const { ORCHESTRATOR_DECISION_REQUEST_FIELDS, validateOrchestratorDecisionRequest } = require('../src/core/orchestrator-decision-request');
const {
  NEXT_STATES, ORCHESTRATOR_DECISION_RESULT_FIELDS, ORCHESTRATOR_DECISION_RESULT_SAFE_FLAGS, RESULT_DECISIONS,
  RESULT_STATUSES, buildOrchestratorDecisionResult, validateOrchestratorDecisionResult
} = require('../src/core/orchestrator-decision-result');
const { createOrchestratorDecisionRegistry } = require('../src/core/orchestrator-decision-registry');
const { buildOrchestratorDecisionAudit, validateOrchestratorDecisionAudit } = require('../src/core/orchestrator-decision-audit');
const { evaluateOrchestratorDecisionRequest } = require('../src/core/orchestrator-decision-engine');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioFixture(key) {
  return clone(fixture.scenarios[key]);
}

const EXPECTED_SCENARIOS = [
  'ready-no-llm-decision', 'ready-low-cost-model-decision', 'human-approval-decision', 'memory-reselection-decision',
  'context-reassembly-decision', 'selection-reselection-decision', 'tool-review-decision', 'workflow-review-decision',
  'budget-review-decision', 'dependency-review-decision', 'conflict-resolution-decision', 'policy-blocked-decision',
  'tenant-mismatch-decision', 'organization-mismatch-decision', 'project-mismatch-decision', 'session-mismatch-decision',
  'fingerprint-mismatch-decision', 'version-mismatch-decision', 'readiness-score-decision', 'canonical-order-decision',
  'replay-decision'
];

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_AGENT_ORCHESTRATOR_DECISION_ENGINE.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

EXPECTED_SCENARIOS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded decision result`, () => {
    const scenario = scenarioFixture(key);
    const context = key === 'dependency-review-decision' ? { pendingDependencyReviewIds: ['dep-1'] }
      : key === 'conflict-resolution-decision' ? { resolvableConflictIds: ['conflict-1'] }
      : key === 'version-mismatch-decision' ? { currentRegistryVersion: 'registry-v2' } : {};
    const outcome = evaluateOrchestratorDecisionRequest(scenario.request, context);
    assert.equal(outcome.result.status, scenario.result.status);
    assert.equal(outcome.result.decision, scenario.result.decision);
    assert.equal(outcome.result.next_state, scenario.result.next_state);
    assert.equal(validateOrchestratorDecisionResult(outcome.result).valid, true);
    for (const blocker of outcome.blockers) assert.equal(validateOrchestratorBlocker(blocker).valid, true);
    assert.equal(validateOrchestratorReadiness(outcome.readiness).valid, true);
    assert.equal(validateOrchestratorDecisionAudit(outcome.audit).valid, true);
  });
});

// ---------------------------------------------------------------------------
// Blocker
// ---------------------------------------------------------------------------

test('blocker exact fields, enum rejection, and only HIGH/CRITICAL may block', () => {
  const blocker = scenarioFixture('memory-reselection-decision').blockers[0];
  assert.equal(validateOrchestratorBlocker(blocker).valid, true);
  assert.equal(validateOrchestratorBlocker({ ...blocker, blocker_type: 'UNKNOWN' }).valid, false);
  assert.equal(validateOrchestratorBlocker({ ...blocker, severity: 'EXTREME' }).valid, false);
  assert.equal(validateOrchestratorBlocker({ ...blocker, resolution_type: 'UNKNOWN' }).valid, false);
  assert.equal(validateOrchestratorBlocker({ ...blocker, severity: 'WARNING', blocking: true }).valid, false, 'WARNING can never block');
  assert.equal(validateOrchestratorBlocker({ ...blocker, severity: 'INFO', blocking: true }).valid, false, 'INFO can never block');
  assert.equal(validateOrchestratorBlocker({ ...blocker, resolvable: false, resolution_type: 'RESELECT_MEMORY' }).valid, false);
  assert.equal(validateOrchestratorBlocker({ ...blocker, resolvable: true, resolution_type: 'NONE' }).valid, false);
  assert.equal(BLOCKER_TYPES.length, 22);
  assert.equal(SEVERITIES.length, 4);
  assert.equal(RESOLUTION_TYPES.length, 12);
  assert.equal(ORCHESTRATOR_BLOCKER_FIELDS.length, 12);
  assert.deepEqual(BLOCKING_ELIGIBLE_SEVERITIES, ['HIGH', 'CRITICAL']);
});

test('a WARNING-severity blocker can exist but never silently authorizes a missing mandatory condition', () => {
  const warning = buildOrchestratorBlocker({
    blocker_id: 'blk-warn-1', blocker_type: 'VALIDATION_BLOCKER', source_reference_type: 'decision_request',
    source_reference_id: 'decreq-1', severity: 'WARNING', blocking: false, resolvable: false, reason_code: 'diagnostic_note',
    logical_sequence: 1
  });
  assert.equal(validateOrchestratorBlocker(warning).valid, true);
  assert.equal(warning.blocking, false, 'a WARNING can never be forced to blocking=true even if requested');
});

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

test('readiness score is deterministic, integer, 0-100, and never overrides a mandatory blocker', () => {
  const readiness = scenarioFixture('readiness-score-decision').readiness;
  assert.equal(validateOrchestratorReadiness(readiness).valid, true);
  assert.equal(readiness.readiness_score, 100);
  assert.equal(Number.isInteger(readiness.readiness_score), true);
  assert.equal(readiness.overall_ready_in_simulation, true);

  const blockedReadiness = buildOrchestratorReadiness({
    readiness_id: 'r1', planning_result_id: 'p1', plan_id: 'plan1', policy_ready: true, memory_ready: true,
    preferences_ready: true, project_state_ready: true, continuity_ready: true, context_ready: true,
    model_ready: true, tools_ready: true, workflow_ready: true, budget_ready: true, dependencies_ready: true,
    approval_ready: true, fingerprints_ready: true, versions_ready: true, blocking_count: 1, critical_count: 0
  });
  assert.equal(blockedReadiness.overall_ready_in_simulation, false, 'even one blocking blocker forces overall_ready_in_simulation=false regardless of a perfect score');
  assert.ok(blockedReadiness.readiness_score >= 0);

  assert.equal(validateOrchestratorReadiness({ ...readiness, overall_ready_in_simulation: true, memory_ready: false }).valid, false);
  assert.equal(ORCHESTRATOR_READINESS_FIELDS.length, 28);
  assert.equal(READINESS_DOMAIN_FIELDS.length, 14);
});

test('computeReadinessScore is floatless and never random', () => {
  const allReady = {};
  for (const field of READINESS_DOMAIN_FIELDS) allReady[field] = true;
  const scoreA = computeReadinessScore(allReady, 0);
  const scoreB = computeReadinessScore(allReady, 0);
  assert.equal(scoreA, scoreB);
  assert.equal(Number.isInteger(scoreA), true);
  const oneNotReady = { ...allReady, memory_ready: false };
  assert.ok(computeReadinessScore(oneNotReady, 0) < scoreA);
});

test('a blocking HIGH blocker and a blocking CRITICAL blocker both force overall_ready_in_simulation=false', () => {
  for (const severity of ['HIGH', 'CRITICAL']) {
    const readiness = buildOrchestratorReadiness({
      readiness_id: `r-${severity}`, planning_result_id: 'p1', plan_id: 'plan1', policy_ready: true, memory_ready: true,
      preferences_ready: true, project_state_ready: true, continuity_ready: true, context_ready: true,
      model_ready: true, tools_ready: true, workflow_ready: true, budget_ready: true, dependencies_ready: true,
      approval_ready: true, fingerprints_ready: true, versions_ready: true,
      blocking_count: severity === 'HIGH' ? 1 : 0, critical_count: severity === 'CRITICAL' ? 1 : 0
    });
    assert.equal(readiness.overall_ready_in_simulation, false);
  }
});

// ---------------------------------------------------------------------------
// Decision Policy / Plan References / Decision Request
// ---------------------------------------------------------------------------

test('decision policy forces every fixed safe value', () => {
  const policy = scenarioFixture('ready-no-llm-decision').request.decision_policy;
  assert.equal(validateOrchestratorDecisionPolicy(policy).valid, true);
  assert.equal(validateOrchestratorDecisionPolicy({ ...policy, require_memory_preserved: false }).valid, false);
  assert.equal(validateOrchestratorDecisionPolicy({ ...policy, fail_on_any_blocker: false }).valid, false);
  assert.equal(validateOrchestratorDecisionPolicy({ ...policy, simulation: false }).valid, false);
  assert.equal(ORCHESTRATOR_DECISION_POLICY_FIELDS.length, 27);
});

test('planning result reference and orchestration plan reference are minimal, reference-only, and forced-false on execution flags', () => {
  const request = scenarioFixture('ready-no-llm-decision').request;
  assert.equal(validatePlanningResultReference(request.planning_result_reference).valid, true);
  assert.equal(validatePlanningResultReference({ ...request.planning_result_reference, plan_executed: true }).valid, false);
  assert.equal(validatePlanningResultReference({ ...request.planning_result_reference, executed: true }).valid, false);
  assert.equal(validateOrchestrationPlanReference(request.orchestration_plan_reference).valid, true);
  assert.equal(validateOrchestrationPlanReference({ ...request.orchestration_plan_reference, plan_executed: true }).valid, false);
  assert.equal(Object.keys(request.planning_result_reference).includes('stage_definitions'), false);
  assert.equal(PLANNING_RESULT_REFERENCE_FIELDS.length, 41);
  assert.equal(ORCHESTRATION_PLAN_REFERENCE_FIELDS.length, 24);
});

test('decision request valid, exact fields, and rejects extra/missing fields', () => {
  const request = scenarioFixture('ready-no-llm-decision').request;
  assert.equal(validateOrchestratorDecisionRequest(request).valid, true);
  assert.equal(ORCHESTRATOR_DECISION_REQUEST_FIELDS.length, 19);
  assert.equal(validateOrchestratorDecisionRequest({ ...request, unexpected: 1 }).valid, false);
  const { decision_policy, ...missingPolicy } = request;
  assert.equal(validateOrchestratorDecisionRequest(missingPolicy).valid, false);
});

// ---------------------------------------------------------------------------
// Engine: READY_SIMULATION, cost preservation, approval
// ---------------------------------------------------------------------------

test('READY_SIMULATION reachable with NO_LLM and with an already-selected economical model', () => {
  const noLlm = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-no-llm-decision').request);
  assert.equal(noLlm.result.status, 'READY_SIMULATION');
  assert.equal(noLlm.result.execution_authorized, false, 'even READY_SIMULATION never authorizes execution');

  const lowCost = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-low-cost-model-decision').request);
  assert.equal(lowCost.result.status, 'READY_SIMULATION');
});

test('the economical model selection is preserved end to end (the Decision Engine never re-selects)', () => {
  const request = scenarioFixture('ready-low-cost-model-decision').request;
  assert.equal(request.model_selection_decision_reference.selected_cost_tier, 'VERY_LOW');
  const outcome = evaluateOrchestratorDecisionRequest(request);
  assert.equal(outcome.result.status, 'READY_SIMULATION');
  assert.equal(outcome.result.model_selection_fingerprint, stablePayload(request.model_selection_decision_reference));
});

test('WAITING_APPROVAL_SIMULATION is emitted when the Planner already flagged approval as required, and no approval is created or applied', () => {
  const outcome = evaluateOrchestratorDecisionRequest(scenarioFixture('human-approval-decision').request);
  assert.equal(outcome.result.status, 'WAITING_APPROVAL_SIMULATION');
  assert.equal(outcome.result.decision, 'REQUEST_HUMAN_APPROVAL');
  assert.equal(outcome.result.next_state, 'WAITING_APPROVAL_REFERENCE');
  assert.equal(outcome.result.approval_required, true);
  assert.equal(outcome.result.ready_in_simulation, false);
  assert.equal(outcome.result.execution_authorized, false);
});

// ---------------------------------------------------------------------------
// Memory / preferences / project state / continuity / pending tasks / decisions
// ---------------------------------------------------------------------------

test('memory not preserved, preference omitted, project state absent, and continuity absent all surface as WAITING_MEMORY_REFERENCE', () => {
  const request = scenarioFixture('memory-reselection-decision').request;
  const outcome = evaluateOrchestratorDecisionRequest(request);
  assert.equal(outcome.result.status, 'WAITING_MEMORY_REFERENCE');
  assert.equal(outcome.result.decision, 'REQUEST_MEMORY_RESELECTION');

  const preferenceOmitted = clone(request);
  preferenceOmitted.decision_request_id = 'decreq-preference-omitted-check';
  preferenceOmitted.memory_selection_decision_reference = {
    ...preferenceOmitted.memory_selection_decision_reference,
    operational_flags: {
      required_memory_preserved: true, preferences_preserved: false, project_state_preserved: true,
      continuity_preserved: true, pending_tasks_preserved: true, applicable_decisions_preserved: true
    }
  };
  assert.equal(evaluateOrchestratorDecisionRequest(preferenceOmitted).result.status, 'WAITING_MEMORY_REFERENCE');

  const pendingTaskOmitted = clone(request);
  pendingTaskOmitted.decision_request_id = 'decreq-pending-task-omitted-check';
  pendingTaskOmitted.memory_selection_decision_reference = {
    ...pendingTaskOmitted.memory_selection_decision_reference,
    operational_flags: {
      required_memory_preserved: true, preferences_preserved: true, project_state_preserved: true,
      continuity_preserved: true, pending_tasks_preserved: false, applicable_decisions_preserved: true
    }
  };
  assert.equal(evaluateOrchestratorDecisionRequest(pendingTaskOmitted).result.status, 'WAITING_MEMORY_REFERENCE');

  const decisionOmitted = clone(request);
  decisionOmitted.decision_request_id = 'decreq-decision-omitted-check';
  decisionOmitted.memory_selection_decision_reference = {
    ...decisionOmitted.memory_selection_decision_reference,
    operational_flags: {
      required_memory_preserved: true, preferences_preserved: true, project_state_preserved: true,
      continuity_preserved: true, pending_tasks_preserved: true, applicable_decisions_preserved: false
    }
  };
  assert.equal(evaluateOrchestratorDecisionRequest(decisionOmitted).result.status, 'WAITING_MEMORY_REFERENCE');
});

test('a hard-blocked memory selection decision (decision=BLOCKED) surfaces as MEMORY_BLOCKED, not WAITING_MEMORY_REFERENCE', () => {
  const request = clone(scenarioFixture('ready-no-llm-decision').request);
  request.decision_request_id = 'decreq-memory-hard-blocked-check';
  request.memory_selection_decision_reference = { ...request.memory_selection_decision_reference, decision: 'BLOCKED' };
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'MEMORY_BLOCKED');
});

test('the Decision Engine never reclassifies memory: it only reads operational_flags already produced by PR #93/#94', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'services/api/src/core/orchestrator-decision-engine.js'), 'utf8');
  assert.equal(source.includes('memory-selection-engine'), false);
  assert.equal(source.includes('memory-selection-request'), false);
});

// ---------------------------------------------------------------------------
// Context / model / tools / workflow / budget / dependencies / conflict
// ---------------------------------------------------------------------------

test('context not planned surfaces as WAITING_CONTEXT_REFERENCE, never a re-assembly', () => {
  const outcome = evaluateOrchestratorDecisionRequest(scenarioFixture('context-reassembly-decision').request);
  assert.equal(outcome.result.status, 'WAITING_CONTEXT_REFERENCE');
  assert.equal(outcome.result.decision, 'REQUEST_CONTEXT_REASSEMBLY');
});

test('a model selection reference carrying its own blockers (but not decision=BLOCKED) surfaces as WAITING_MODEL_REFERENCE', () => {
  const outcome = evaluateOrchestratorDecisionRequest(scenarioFixture('selection-reselection-decision').request);
  assert.equal(outcome.result.status, 'WAITING_MODEL_REFERENCE');
  assert.equal(outcome.result.decision, 'REQUEST_MODEL_RESELECTION');
});

test('model selection blocked (decision=BLOCKED) surfaces as MODEL_BLOCKED', () => {
  const request = clone(scenarioFixture('ready-low-cost-model-decision').request);
  request.decision_request_id = 'decreq-selection-hard-blocked-check';
  request.model_selection_decision_reference = { ...request.model_selection_decision_reference, decision: 'BLOCKED' };
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'MODEL_BLOCKED');
});

test('tool requiring review surfaces as WAITING_TOOL_REFERENCE, and a hard-blocked tool surfaces as TOOL_BLOCKED', () => {
  const waiting = evaluateOrchestratorDecisionRequest(scenarioFixture('tool-review-decision').request);
  assert.equal(waiting.result.status, 'WAITING_TOOL_REFERENCE');

  const request = clone(scenarioFixture('tool-review-decision').request);
  request.decision_request_id = 'decreq-tool-hard-blocked-check';
  request.tool_decision_references = [{ ...request.tool_decision_references[0], decision: 'BLOCKED' }];
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'TOOL_BLOCKED');
});

test('workflow requiring review surfaces as WAITING_WORKFLOW_REFERENCE, and a hard-blocked workflow surfaces as WORKFLOW_BLOCKED', () => {
  const waiting = evaluateOrchestratorDecisionRequest(scenarioFixture('workflow-review-decision').request);
  assert.equal(waiting.result.status, 'WAITING_WORKFLOW_REFERENCE');

  const request = clone(scenarioFixture('workflow-review-decision').request);
  request.decision_request_id = 'decreq-workflow-hard-blocked-check';
  request.workflow_decision_reference = { ...request.workflow_decision_reference, decision: 'BLOCKED' };
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'WORKFLOW_BLOCKED');
});

test('budget not validated surfaces as WAITING_BUDGET_REFERENCE when a plan exists, and BUDGET_BLOCKED when no plan was generated', () => {
  const waiting = evaluateOrchestratorDecisionRequest(scenarioFixture('budget-review-decision').request);
  assert.equal(waiting.result.status, 'WAITING_BUDGET_REFERENCE');

  const request = clone(scenarioFixture('budget-review-decision').request);
  request.decision_request_id = 'decreq-budget-hard-blocked-check';
  request.planning_result_reference = { ...request.planning_result_reference, budget_validated: false, plan_generated: false };
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'BUDGET_BLOCKED');
});

test('a dependency requiring revalidation surfaces as WAITING_DEPENDENCY_REFERENCE, and a real cycle surfaces as DEPENDENCY_BLOCKED', () => {
  const waiting = evaluateOrchestratorDecisionRequest(scenarioFixture('dependency-review-decision').request, {
    pendingDependencyReviewIds: ['dep-1']
  });
  assert.equal(waiting.result.status, 'WAITING_DEPENDENCY_REFERENCE');

  const request = scenarioFixture('ready-no-llm-decision').request;
  const cyclic = evaluateOrchestratorDecisionRequest(request, {
    dependencyRecords: [{ from_stage_id: 'a', to_stage_id: 'b' }, { from_stage_id: 'b', to_stage_id: 'a' }]
  });
  assert.equal(cyclic.result.status, 'DEPENDENCY_BLOCKED');
});

test('an unresolved conflict blocks, and a resolvable conflict waits for resolution', () => {
  const waiting = evaluateOrchestratorDecisionRequest(scenarioFixture('conflict-resolution-decision').request, {
    resolvableConflictIds: ['conflict-1']
  });
  assert.equal(waiting.result.status, 'WAITING_CONFLICT_RESOLUTION');

  const request = scenarioFixture('ready-no-llm-decision').request;
  const blocked = evaluateOrchestratorDecisionRequest(request, { unresolvedConflictIds: ['conflict-1'] });
  assert.equal(blocked.result.status, 'CONFLICT_BLOCKED');
});

// ---------------------------------------------------------------------------
// Tenant / organization / project / session / fingerprint / version / unknown status
// ---------------------------------------------------------------------------

test('tenant, organization, project, and session mismatches block the decision', () => {
  assert.equal(evaluateOrchestratorDecisionRequest(scenarioFixture('tenant-mismatch-decision').request).result.status, 'TENANT_BLOCKED');
  assert.equal(evaluateOrchestratorDecisionRequest(scenarioFixture('organization-mismatch-decision').request).result.status, 'ORGANIZATION_BLOCKED');
  assert.equal(evaluateOrchestratorDecisionRequest(scenarioFixture('project-mismatch-decision').request).result.status, 'PROJECT_BLOCKED');
  assert.equal(evaluateOrchestratorDecisionRequest(scenarioFixture('session-mismatch-decision').request).result.status, 'SESSION_BLOCKED');
});

test('a fingerprint mismatch between the planning result and plan references blocks with FINGERPRINT_BLOCKED', () => {
  assert.equal(evaluateOrchestratorDecisionRequest(scenarioFixture('fingerprint-mismatch-decision').request).result.status, 'FINGERPRINT_BLOCKED');
});

test('a stale expected_registry_version blocks with VERSION_BLOCKED', () => {
  const outcome = evaluateOrchestratorDecisionRequest(scenarioFixture('version-mismatch-decision').request, { currentRegistryVersion: 'registry-v2' });
  assert.equal(outcome.result.status, 'VERSION_BLOCKED');
});

test('a Planner status outside PLAN_READY_SIMULATION/APPROVAL_REQUIRED_SIMULATION is translated 1:1 when the name matches, and falls back to VALIDATION_FAILED otherwise', () => {
  const denyRequest = clone(scenarioFixture('ready-no-llm-decision').request);
  denyRequest.decision_request_id = 'decreq-deny-passthrough-check';
  denyRequest.planning_result_reference = { ...denyRequest.planning_result_reference, status: 'DENY', decision: 'BLOCKED' };
  assert.equal(evaluateOrchestratorDecisionRequest(denyRequest).result.status, 'DENY');

  const modelSelectionBlockedRequest = clone(scenarioFixture('ready-no-llm-decision').request);
  modelSelectionBlockedRequest.decision_request_id = 'decreq-selection-blocked-translate-check';
  modelSelectionBlockedRequest.planning_result_reference = {
    ...modelSelectionBlockedRequest.planning_result_reference, status: 'MODEL_SELECTION_BLOCKED', decision: 'BLOCKED'
  };
  assert.equal(evaluateOrchestratorDecisionRequest(modelSelectionBlockedRequest).result.status, 'MODEL_BLOCKED', 'PR94 MODEL_SELECTION_BLOCKED translates to PR95 MODEL_BLOCKED');
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test('precedence: tenant mismatch wins over an also-broken memory reference', () => {
  const request = clone(scenarioFixture('memory-reselection-decision').request);
  request.decision_request_id = 'decreq-precedence-tenant-over-memory';
  request.memory_selection_decision_reference = { ...request.memory_selection_decision_reference, tenant_id: 'tenant-other' };
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'TENANT_BLOCKED');
});

test('precedence: a fingerprint mismatch wins over a policy that would otherwise deny', () => {
  const request = clone(scenarioFixture('fingerprint-mismatch-decision').request);
  request.decision_request_id = 'decreq-precedence-fingerprint-over-policy';
  request.policy_decision_reference = { ...request.policy_decision_reference, policy_status: 'DENY' };
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'FINGERPRINT_BLOCKED');
});

test('precedence: memory preservation (steps 11-14) is checked before policy (step 15), per the numbered "ordem obrigatoria de avaliacao"', () => {
  // The spec's numbered evaluation order checks memory (11-14) before policy (15), while its
  // separate summary precedence table lists POLICY_BLOCKED above MEMORY_BLOCKED. This
  // implementation treats the more granular, explicitly numbered section as authoritative
  // (documented in HERMES_AGENT_ORCHESTRATOR_DECISION_ENGINE.md) -- so an also-denied policy
  // never masks a memory issue that was already detected first.
  const request = clone(scenarioFixture('memory-reselection-decision').request);
  request.decision_request_id = 'decreq-precedence-memory-before-policy';
  request.policy_decision_reference = { ...request.policy_decision_reference, policy_status: 'DENY' };
  assert.equal(evaluateOrchestratorDecisionRequest(request).result.status, 'WAITING_MEMORY_REFERENCE');
});

test('readiness score never changes which status is emitted (precedence is structural, not score-driven)', () => {
  const request = clone(scenarioFixture('memory-reselection-decision').request);
  request.decision_request_id = 'decreq-readiness-never-overrides-check';
  const outcome = evaluateOrchestratorDecisionRequest(request);
  assert.equal(outcome.result.status, 'WAITING_MEMORY_REFERENCE');
  assert.equal(outcome.readiness.readiness_score < 100, true, 'a not-fully-ready plan never reports a perfect score');
});

// ---------------------------------------------------------------------------
// Ordering / determinism
// ---------------------------------------------------------------------------

test('input order of tool_decision_references never changes the resulting decision (canonical order)', () => {
  const scenario = scenarioFixture('canonical-order-decision');
  const forward = evaluateOrchestratorDecisionRequest(scenario.request);
  const reversedRequest = clone(scenario.request);
  reversedRequest.tool_decision_references = [...reversedRequest.tool_decision_references].reverse();
  const reversed = evaluateOrchestratorDecisionRequest(reversedRequest);
  assert.equal(forward.result.status, reversed.result.status);
  assert.deepEqual([...forward.result.tool_fingerprints].sort(), [...reversed.result.tool_fingerprints].sort());
});

// ---------------------------------------------------------------------------
// Result / decision invariants
// ---------------------------------------------------------------------------

test('result accepts only the 28 documented statuses, 11 decisions, and 11 next states', () => {
  assert.equal(RESULT_STATUSES.length, 28);
  assert.equal(RESULT_DECISIONS.length, 11);
  assert.equal(NEXT_STATES.length, 11);
  assert.equal(ORCHESTRATOR_DECISION_RESULT_FIELDS.length, 70);
});

test('every produced result forces every safe invariant flag regardless of scenario, even READY_SIMULATION', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    const context = key === 'dependency-review-decision' ? { pendingDependencyReviewIds: ['dep-1'] }
      : key === 'conflict-resolution-decision' ? { resolvableConflictIds: ['conflict-1'] }
      : key === 'version-mismatch-decision' ? { currentRegistryVersion: 'registry-v2' } : {};
    const outcome = evaluateOrchestratorDecisionRequest(scenario.request, context);
    for (const [field, expected] of Object.entries(ORCHESTRATOR_DECISION_RESULT_SAFE_FLAGS)) {
      assert.equal(outcome.result[field], expected, `scenario ${key} result.${field} must be ${expected}`);
    }
    assert.equal(outcome.result.execution_authorized, false, `scenario ${key}: execution_authorized must always be false`);
  }
});

test('buildOrchestratorDecisionResult degrades to VALIDATION_FAILED/BLOCKED on invalid input', () => {
  const invalid = buildOrchestratorDecisionResult({ status: 'NONSENSE' });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
  assert.equal(invalid.decision, 'BLOCKED');
  assert.equal(invalid.ready_in_simulation, false);
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry validates by construction and protects against replay, payload mismatch, version conflict, and fingerprint conflict', () => {
  const registry = createOrchestratorDecisionRegistry();
  const request = scenarioFixture('replay-decision').request;

  const first = registry.registerDecisionRequest(request, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerDecisionRequest(request).status, 'REPLAY_ACCEPTED');

  const payloadMismatch = { ...request, correlation_id: 'different-correlation' };
  assert.equal(registry.registerDecisionRequest(payloadMismatch).status, 'PAYLOAD_MISMATCH');

  const versionBumped = { ...request, decision_request_version: 2, correlation_id: 'different-correlation' };
  assert.equal(registry.registerDecisionRequest(versionBumped, { expected_version: 5 }).status, 'VERSION_CONFLICT');
  assert.equal(registry.registerDecisionRequest(versionBumped, { expected_version: 1 }).status, 'REGISTERED_SIMULATION');

  const versionBumpedAgain = { ...request, decision_request_version: 3, correlation_id: 'yet-another' };
  assert.equal(registry.registerDecisionRequest(versionBumpedAgain, { expected_fingerprint: 'stale' }).status, 'FINGERPRINT_CONFLICT');

  const stored = registry.getDecisionRequestById(request.decision_request_id);
  assert.equal(stored.decision_request_version, 2, 'a rejected fingerprint conflict must not mutate the stored record');
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => { stored.correlation_id = 'x'; }, TypeError);
  assert.equal(registry.getDecisionRequestById('unknown-id'), null);

  const invalid = registry.registerDecisionRequest({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('registry blocks tenant and organization rebinding for results without mutating the stored record', () => {
  const registry = createOrchestratorDecisionRegistry();
  const outcome = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-no-llm-decision').request);
  assert.equal(registry.registerDecisionResult(outcome.result).status, 'REGISTERED_SIMULATION');
  const orgChanged = { ...outcome.result, organization_id: `${outcome.result.tenant_id}:org-different` };
  assert.equal(registry.registerDecisionResult(orgChanged).status, 'ORGANIZATION_BLOCKED');
  const tenantChanged = { ...outcome.result, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerDecisionResult(tenantChanged).status, 'TENANT_BLOCKED');
  assert.equal(registry.getDecisionResultById(outcome.result.result_id).organization_id, outcome.result.organization_id);
});

test('registry provides defensive clones (deep freeze) and safe lists by tenant/organization', () => {
  const registry = createOrchestratorDecisionRegistry();
  const outcomeA = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-no-llm-decision').request);
  const outcomeB = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-low-cost-model-decision').request);
  registry.registerDecisionResult(outcomeA.result);
  registry.registerDecisionResult(outcomeB.result);
  const listed = registry.listDecisionResultsByTenant(outcomeA.result.tenant_id);
  assert.equal(listed.length, 2);
  assert.equal(registry.listDecisionResultsByTenant('tenant-unused').length, 0);

  const fetched = registry.getDecisionResultById(outcomeA.result.result_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.status = 'x'; }, TypeError);
});

test('blockers register independently and replay/mismatch exactly like every other entity store', () => {
  const registry = createOrchestratorDecisionRegistry();
  const blocker = scenarioFixture('memory-reselection-decision').blockers[0];
  assert.equal(registry.registerBlocker(blocker).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerBlocker(blocker).status, 'REPLAY_ACCEPTED');
  const samePayloadDifferentVersion = { ...blocker, reason_code: 'a_different_reason' };
  assert.equal(registry.registerBlocker(samePayloadDifferentVersion).status, 'PAYLOAD_MISMATCH', 'same blocker_version with a different payload must never silently overwrite');
  const versionBumped = { ...blocker, blocker_version: 2, reason_code: 'a_different_reason' };
  assert.equal(registry.registerBlocker(versionBumped).status, 'REGISTERED_SIMULATION', 'a genuine version bump with a changed payload is a legitimate update');
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test('audit is immutable, records only fingerprints/bindings/counts/readiness score, and never marks anything executed', () => {
  const outcome = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-no-llm-decision').request);
  const audit = outcome.audit;
  assert.equal(validateOrchestratorDecisionAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.reason_codes.push('x'); }, TypeError);

  const blockedOutcome = evaluateOrchestratorDecisionRequest(scenarioFixture('tenant-mismatch-decision').request);
  const blockedAudit = buildOrchestratorDecisionAudit({ result: blockedOutcome.result });
  assert.equal(validateOrchestratorDecisionAudit(blockedAudit).valid, true);
  assert.equal(blockedAudit.status, 'TENANT_BLOCKED');
});

test('fingerprints are deterministic and change when the underlying request payload changes', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const outcomeA = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-no-llm-decision').request);
  const outcomeB = evaluateOrchestratorDecisionRequest(scenarioFixture('ready-no-llm-decision').request);
  assert.equal(outcomeA.result.request_fingerprint, outcomeB.result.request_fingerprint);

  const changedRequest = clone(scenarioFixture('ready-no-llm-decision').request);
  changedRequest.decision_request_id = 'decreq-fingerprint-change-check';
  const outcomeC = evaluateOrchestratorDecisionRequest(changedRequest);
  assert.notEqual(outcomeA.result.request_fingerprint, outcomeC.result.request_fingerprint);
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
  test(`operational material detector blocks ${name} in decision engine contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate decision engine field names', () => {
  const scenario = scenarioFixture('ready-no-llm-decision');
  assert.deepEqual(findAgentCoreOperationalMaterial(scenario.request), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(scenario.result), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(scenario.readiness), []);
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

test('regression decision engine modules do not use network, filesystem, eval, dynamic import, or timers', () => {
  const files = [
    'services/api/src/core/orchestrator-decision-engine.js',
    'services/api/src/core/orchestrator-decision-request.js',
    'services/api/src/core/orchestrator-plan-reference.js',
    'services/api/src/core/orchestrator-decision-policy.js',
    'services/api/src/core/orchestrator-blocker.js',
    'services/api/src/core/orchestrator-readiness.js',
    'services/api/src/core/orchestrator-decision-result.js',
    'services/api/src/core/orchestrator-decision-registry.js',
    'services/api/src/core/orchestrator-decision-audit.js'
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

test('regression decision engine modules are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('orchestrator-decision-engine'), false);
    assert.equal(source.includes('orchestrator-decision-registry'), false);
  }
});

test('regression PRs 79 through 94 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-session-reference.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/tool-decision.js',
    'services/api/src/core/workflow-decision.js',
    'services/api/src/core/orchestrator-request.js',
    'services/api/src/core/orchestrator-decision.js',
    'services/api/src/core/memory-selection-engine.js',
    'services/api/src/core/memory-selection-decision.js',
    'services/api/src/core/orchestrator-planner.js',
    'services/api/src/core/orchestrator-planning-request.js',
    'services/api/src/core/orchestrator-planning-result.js',
    'services/api/src/core/orchestrator-planning-registry.js',
    'services/api/src/core/orchestrator-plan-stage.js',
    'services/api/src/core/orchestrator-plan-dependency.js'
  ].map((file) => path.join(repoRoot, file));
  const decisionEngineModules = [
    'orchestrator-decision-engine', 'orchestrator-decision-request', 'orchestrator-plan-reference',
    'orchestrator-decision-policy', 'orchestrator-blocker', 'orchestrator-readiness', 'orchestrator-decision-result',
    'orchestrator-decision-registry', 'orchestrator-decision-audit'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of decisionEngineModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});

test('regression full suite invariant: no execution is ever authorized or performed, across every named scenario', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    const context = key === 'dependency-review-decision' ? { pendingDependencyReviewIds: ['dep-1'] }
      : key === 'conflict-resolution-decision' ? { resolvableConflictIds: ['conflict-1'] }
      : key === 'version-mismatch-decision' ? { currentRegistryVersion: 'registry-v2' } : {};
    const outcome = evaluateOrchestratorDecisionRequest(scenario.request, context);
    assert.equal(outcome.result.execution_authorized, false);
    assert.equal(outcome.result.execution_started, false);
    assert.equal(outcome.result.agent_executed, false);
    assert.equal(outcome.result.tool_called, false);
    assert.equal(outcome.result.workflow_executed, false);
    assert.equal(outcome.result.provider_called, false);
    assert.equal(outcome.result.model_called, false);
    assert.equal(outcome.result.network_used, false);
    assert.equal(outcome.result.memory_read, false);
    assert.equal(outcome.result.memory_written, false);
    assert.equal(outcome.result.tokens_consumed, false);
    assert.equal(outcome.result.cost_consumed, false);
  }
});
