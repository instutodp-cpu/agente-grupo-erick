'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-memory-selection-continuity-policy.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  MEMORY_SELECTION_REQUEST_FIELDS,
  MEMORY_SELECTION_REQUEST_VALIDATOR_VERSION,
  validateMemorySelectionRequest
} = require('../src/core/memory-selection-request');
const {
  CONFIDENCE_LEVELS,
  ITEM_CLASSES,
  ITEM_TYPES,
  MEMORY_SELECTION_ITEM_REFERENCE_FIELDS,
  OMISSION_RISKS,
  SCOPE_TYPES,
  isExplicitPreference,
  validateContinuitySummaryReference,
  validateMemorySelectionItemReference,
  validateProjectStateReference
} = require('../src/core/memory-selection-item-reference');
const { validateSelectionPolicy } = require('../src/core/memory-selection-policy');
const { OVERFLOW_STRATEGIES, validateSelectionBudget } = require('../src/core/memory-selection-budget');
const { computeSelectionScore, validateSelectionScore } = require('../src/core/memory-selection-score');
const { buildSelectionPlan, validateSelectionPlan } = require('../src/core/memory-selection-plan');
const {
  DECISION_STATUSES,
  MEMORY_SELECTION_DECISION_SAFE_FLAGS,
  buildSelectionDecision,
  validateSelectionDecision
} = require('../src/core/memory-selection-decision');
const { createMemorySelectionRegistry } = require('../src/core/memory-selection-registry');
const { buildSelectionAudit, validateSelectionAudit } = require('../src/core/memory-selection-audit');
const { evaluateMemorySelectionRequest } = require('../src/core/memory-selection-engine');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function itemFixture(key) {
  return clone(fixture.items[key]);
}
function scenarioFixture(key) {
  return clone(fixture.scenarios[key]);
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_MEMORY_SELECTION_CONTINUITY_POLICY.md')), true);
  const expectedItems = [
    'explicit-language-preference', 'explicit-format-preference', 'model-cost-preference', 'safety-restriction',
    'pending-task', 'project-decision', 'required-memory', 'relevant-memory', 'optional-memory',
    'superseded-memory', 'conflicted-memory', 'duplicate-memory-a', 'duplicate-memory-b'
  ];
  assert.deepEqual(Object.keys(fixture.items).sort(), expectedItems.sort());
  const expectedScenarios = [
    'budget-within-limit', 'drop-optional-overflow', 'relevant-overflow', 'required-memory-budget-block',
    'tenant-mismatch', 'organization-mismatch', 'project-mismatch', 'superseded-memory', 'conflicted-memory',
    'duplicate-memory', 'canonical-order'
  ];
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), expectedScenarios.sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

Object.keys(fixture.items).forEach((key) => {
  test(`fixture item ${key} validates as a structurally complete item reference`, () => {
    assert.equal(validateMemorySelectionItemReference(itemFixture(key)).valid, true);
  });
});

test('fixture active-project-state validates as a structurally complete project state reference', () => {
  assert.equal(validateProjectStateReference(clone(fixture.project_states['active-project-state'])).valid, true);
});

test('fixture project-continuity-summary validates as a structurally complete continuity summary reference', () => {
  assert.equal(validateContinuitySummaryReference(clone(fixture.continuity_summaries['project-continuity-summary'])).valid, true);
});

Object.keys(fixture.scenarios).forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded decision status`, () => {
    const scenario = scenarioFixture(key);
    const result = evaluateMemorySelectionRequest(scenario.request);
    assert.equal(result.decision.status, scenario.decision.status);
    assert.equal(validateSelectionDecision(result.decision).valid, true);
    if (result.plan) assert.equal(validateSelectionPlan(result.plan).valid, true);
    assert.equal(validateSelectionAudit(result.audit).valid, true);
  });
});

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

test('request valid, exact fields, rejects unknown/missing fields', () => {
  const request = scenarioFixture('budget-within-limit').request;
  assert.equal(validateMemorySelectionRequest(request).valid, true);
  assert.equal(request.validator_version, MEMORY_SELECTION_REQUEST_VALIDATOR_VERSION);
  assert.equal(MEMORY_SELECTION_REQUEST_FIELDS.length, 20);

  const extra = { ...request, unexpected_field: 'x' };
  assert.equal(validateMemorySelectionRequest(extra).valid, false);

  const { agent_id, ...missingAgent } = request;
  assert.equal(validateMemorySelectionRequest(missingAgent).valid, false);
});

test('request contains no content, message, or prompt field anywhere in its own field list', () => {
  for (const field of MEMORY_SELECTION_REQUEST_FIELDS) {
    assert.equal(/content|message|prompt/i.test(field), false, `field ${field} must not resemble a content/message/prompt field`);
  }
});

// ---------------------------------------------------------------------------
// Item reference / project state / continuity summary contracts
// ---------------------------------------------------------------------------

test('item reference exact fields and enum rejection', () => {
  const item = itemFixture('required-memory');
  assert.equal(validateMemorySelectionItemReference(item).valid, true);
  assert.equal(validateMemorySelectionItemReference({ ...item, item_class: 'CRITICAL' }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, item_type: 'UNKNOWN_TYPE' }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, scope_type: 'UNIVERSE' }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, omission_risk: 'SEVERE' }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, confidence_level: 'GUESSED' }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, unexpected_field: 1 }).valid, false);
  assert.equal(ITEM_CLASSES.length, 3);
  assert.equal(ITEM_TYPES.length, 18);
  assert.equal(SCOPE_TYPES.length, 8);
  assert.equal(OMISSION_RISKS.length, 4);
  assert.equal(CONFIDENCE_LEVELS.length, 5);
  assert.equal(MEMORY_SELECTION_ITEM_REFERENCE_FIELDS.length, 28);
});

test('content_present and content_loaded are always forced to false, and required=true requires item_class=REQUIRED', () => {
  const item = itemFixture('required-memory');
  assert.equal(validateMemorySelectionItemReference({ ...item, content_present: true }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, content_loaded: true }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, required: true, item_class: 'RELEVANT' }).valid, false);
  assert.equal(validateMemorySelectionItemReference({ ...item, required: true, item_class: 'REQUIRED' }).valid, true);
});

test('isExplicitPreference recognizes explicitly declared EXPLICIT/CONFIRMED items only', () => {
  const explicit = itemFixture('explicit-language-preference');
  assert.equal(isExplicitPreference(explicit), true);
  assert.equal(isExplicitPreference({ ...explicit, confidence_level: 'DERIVED' }), false);
  assert.equal(isExplicitPreference({ ...explicit, explicitly_declared: false }), false);
});

test('project state reference forces required/content_present/content_loaded and rejects unsorted or duplicate lists', () => {
  const state = clone(fixture.project_states['active-project-state']);
  assert.equal(validateProjectStateReference(state).valid, true);
  assert.equal(validateProjectStateReference({ ...state, required: false }).valid, false);
  assert.equal(validateProjectStateReference({ ...state, content_present: true }).valid, false);
  assert.equal(validateProjectStateReference({ ...state, content_loaded: true }).valid, false);
  assert.equal(validateProjectStateReference({ ...state, pending_task_reference_ids: ['b', 'a'] }).valid, false);
  assert.equal(validateProjectStateReference({ ...state, pending_task_reference_ids: ['a', 'a'] }).valid, false);
});

test('continuity summary reference forces required/content_present/content_loaded, validates summary_scope, and sequence ordering', () => {
  const summary = clone(fixture.continuity_summaries['project-continuity-summary']);
  assert.equal(validateContinuitySummaryReference(summary).valid, true);
  assert.equal(validateContinuitySummaryReference({ ...summary, summary_scope: 'GALAXY' }).valid, false);
  assert.equal(validateContinuitySummaryReference({ ...summary, covered_sequence_start: 10, covered_sequence_end: 5 }).valid, false);
  assert.equal(validateContinuitySummaryReference({ ...summary, required: false }).valid, false);
});

// ---------------------------------------------------------------------------
// Selection policy / budget contracts
// ---------------------------------------------------------------------------

test('selection policy forces every fixed safe value and rejects a tampered value', () => {
  const policy = scenarioFixture('budget-within-limit').request.selection_policy;
  assert.equal(validateSelectionPolicy(policy).valid, true);
  assert.equal(validateSelectionPolicy({ ...policy, preserve_explicit_preferences: false }).valid, false);
  assert.equal(validateSelectionPolicy({ ...policy, allow_required_omission: true }).valid, false);
  assert.equal(validateSelectionPolicy({ ...policy, fail_on_conflict: false }).valid, false);
  assert.equal(validateSelectionPolicy({ ...policy, exclude_superseded: false }).valid, false);
  assert.equal(validateSelectionPolicy({ ...policy, simulation: false }).valid, false);
  assert.equal(validateSelectionPolicy({ ...policy, production_blocked: false }).valid, false);
});

test('selection budget requires non-negative integers, forces overflow strategy enum, and rejects reserves exceeding the maximum', () => {
  const budget = scenarioFixture('budget-within-limit').request.selection_budget;
  assert.equal(validateSelectionBudget(budget).valid, true);
  assert.equal(validateSelectionBudget({ ...budget, maximum_total_tokens: -1 }).valid, false);
  assert.equal(validateSelectionBudget({ ...budget, reserved_output_tokens: 1.5 }).valid, false);
  assert.equal(validateSelectionBudget({ ...budget, overflow_strategy: 'IGNORE' }).valid, false);
  assert.equal(validateSelectionBudget({ ...budget, budget_enforced: false }).valid, false);
  assert.equal(validateSelectionBudget({ ...budget, budget_consumed: true }).valid, false);
  const overReserved = { ...budget, reserved_output_tokens: budget.maximum_total_tokens };
  assert.equal(validateSelectionBudget(overReserved).valid, false, 'reserve sum must not exceed maximum_total_tokens');
  assert.equal(OVERFLOW_STRATEGIES.length, 5);
});

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

test('score is deterministic, all-integer, and rewards required/explicit/project-match/high-risk items', () => {
  const request = scenarioFixture('budget-within-limit').request;
  const requiredItem = itemFixture('required-memory');
  const explicitPref = itemFixture('explicit-language-preference');
  const optionalItem = itemFixture('optional-memory');

  const scoreA = computeSelectionScore(requiredItem, request);
  const scoreB = computeSelectionScore(requiredItem, request);
  assert.deepEqual(scoreA, scoreB, 'score must be a pure deterministic function of its inputs');
  assert.equal(validateSelectionScore(scoreA).valid, true);
  for (const value of Object.values(scoreA)) {
    if (typeof value === 'number') assert.equal(Number.isInteger(value), true, 'no floats are permitted anywhere in a score');
  }

  const explicitScore = computeSelectionScore(explicitPref, request);
  const optionalScore = computeSelectionScore(optionalItem, request);
  assert.ok(explicitScore.preference_score > optionalScore.preference_score);
  assert.ok(scoreA.required_score > optionalScore.required_score);

  const inferredItem = { ...optionalItem, confidence_level: 'INFERRED' };
  const explicitConfidenceItem = { ...optionalItem, confidence_level: 'EXPLICIT' };
  const inferredScore = computeSelectionScore(inferredItem, request);
  const explicitConfidenceScore = computeSelectionScore(explicitConfidenceItem, request);
  assert.ok(explicitConfidenceScore.confidence_score > inferredScore.confidence_score, 'EXPLICIT must outrank INFERRED');
});

test('semantic_relevance_reference is a caller-supplied declarative integer, never computed', () => {
  const request = scenarioFixture('budget-within-limit').request;
  const item = itemFixture('relevant-memory');
  const withoutHint = computeSelectionScore(item, request);
  const withHint = computeSelectionScore(item, request, { semanticRelevanceReference: 77 });
  assert.equal(withoutHint.semantic_relevance_reference, 0);
  assert.equal(withHint.semantic_relevance_reference, 77);
});

// ---------------------------------------------------------------------------
// Engine: preservation, exclusion, blocking
// ---------------------------------------------------------------------------

test('tenant, organization, project, and session mismatches block the request', () => {
  assert.equal(evaluateMemorySelectionRequest(scenarioFixture('tenant-mismatch').request).decision.status, 'TENANT_BLOCKED');
  assert.equal(evaluateMemorySelectionRequest(scenarioFixture('organization-mismatch').request).decision.status, 'ORGANIZATION_BLOCKED');
  assert.equal(evaluateMemorySelectionRequest(scenarioFixture('project-mismatch').request).decision.status, 'PROJECT_BLOCKED');

  const base = scenarioFixture('budget-within-limit').request;
  const sessionMismatch = {
    ...base,
    memory_item_references: [{ ...itemFixture('relevant-memory'), scope_type: 'SESSION_REFERENCE', session_reference_id: 'session-other' }]
  };
  assert.equal(evaluateMemorySelectionRequest(sessionMismatch).decision.status, 'SESSION_BLOCKED');
});

test('explicit preferences, project state, and continuity are always preserved and never excluded for budget economy', () => {
  const result = evaluateMemorySelectionRequest(scenarioFixture('budget-within-limit').request);
  assert.equal(result.decision.status, 'SELECTION_PLANNED_SIMULATION');
  assert.equal(result.decision.preferences_preserved, true);
  assert.equal(result.decision.project_state_preserved, true);
  assert.equal(result.decision.continuity_preserved, true);
  assert.equal(result.decision.pending_tasks_preserved, true);
  assert.equal(result.decision.applicable_decisions_preserved, true);
  assert.ok(result.plan.included_preference_reference_ids.includes('item-explicit-language-preference'));
  assert.ok(result.plan.included_continuity_reference_ids.length > 0);
});

test('REQUIRED items are always preserved regardless of score', () => {
  const result = evaluateMemorySelectionRequest(scenarioFixture('budget-within-limit').request);
  assert.equal(result.decision.required_memory_preserved, true);
  assert.ok(result.plan.included_required_reference_ids.includes('item-required-memory'));
});

test('OPTIONAL is excluded before RELEVANT under DROP_OPTIONAL overflow', () => {
  const result = evaluateMemorySelectionRequest(scenarioFixture('drop-optional-overflow').request);
  assert.equal(result.decision.status, 'SELECTION_PLANNED_SIMULATION');
  assert.ok(result.plan.excluded_optional_reference_ids.includes('item-drop-optional-optional'));
  assert.ok(result.plan.included_relevant_reference_ids.includes('item-drop-optional-relevant'));
  assert.equal(result.plan.overflow_detected, true);
});

test('RELEVANT is excluded only when policy allow_relevant_omission is true and overflow_strategy permits it', () => {
  const allowed = evaluateMemorySelectionRequest(scenarioFixture('relevant-overflow').request);
  assert.equal(allowed.decision.status, 'SELECTION_PLANNED_SIMULATION');
  assert.ok(allowed.plan.excluded_relevant_reference_ids.includes('item-relevant-overflow-1'));

  const disallowedRequest = clone(scenarioFixture('relevant-overflow').request);
  disallowedRequest.selection_policy = { ...disallowedRequest.selection_policy, allow_relevant_omission: false };
  const disallowed = evaluateMemorySelectionRequest(disallowedRequest);
  assert.equal(disallowed.decision.status, 'BUDGET_BLOCKED');

  const blockStrategyRequest = clone(scenarioFixture('relevant-overflow').request);
  blockStrategyRequest.selection_budget = { ...blockStrategyRequest.selection_budget, overflow_strategy: 'BLOCK' };
  const blockStrategy = evaluateMemorySelectionRequest(blockStrategyRequest);
  assert.equal(blockStrategy.decision.status, 'BUDGET_BLOCKED');
});

test('HIGH and CRITICAL omission risk items can never be silently dropped for budget economy', () => {
  const base = scenarioFixture('drop-optional-overflow').request;
  const highRiskOptional = clone(base);
  highRiskOptional.selection_budget = { ...highRiskOptional.selection_budget, maximum_total_tokens: 100 };
  highRiskOptional.memory_item_references = [
    { ...itemFixture('optional-memory'), omission_risk: 'HIGH', estimated_tokens: 500 }
  ];
  const highResult = evaluateMemorySelectionRequest(highRiskOptional);
  assert.equal(highResult.decision.status, 'BUDGET_BLOCKED');

  const criticalRiskOptional = clone(highRiskOptional);
  criticalRiskOptional.memory_item_references = [
    { ...itemFixture('optional-memory'), omission_risk: 'CRITICAL', estimated_tokens: 500 }
  ];
  const criticalResult = evaluateMemorySelectionRequest(criticalRiskOptional);
  assert.equal(criticalResult.decision.status, 'BUDGET_BLOCKED');
});

test('superseded items are excluded, and unresolved conflicts block while resolved conflicts pass', () => {
  const superseded = evaluateMemorySelectionRequest(scenarioFixture('superseded-memory').request);
  assert.equal(superseded.decision.status, 'SELECTION_PLANNED_SIMULATION');
  assert.ok(superseded.plan.excluded_superseded_reference_ids.includes('item-superseded-memory'));

  const unresolved = evaluateMemorySelectionRequest(scenarioFixture('conflicted-memory').request);
  assert.equal(unresolved.decision.status, 'CONFLICT_BLOCKED');

  const resolvedRequest = clone(scenarioFixture('conflicted-memory').request);
  resolvedRequest.memory_item_references = resolvedRequest.memory_item_references.map((item) => ({
    ...item, conflict_resolution_reference_id: 'resolution-1'
  }));
  const resolved = evaluateMemorySelectionRequest(resolvedRequest);
  assert.equal(resolved.decision.status, 'SELECTION_PLANNED_SIMULATION');
});

test('UNKNOWN_BLOCKED confidence always blocks the request', () => {
  const request = clone(scenarioFixture('budget-within-limit').request);
  request.memory_item_references = [{ ...itemFixture('relevant-memory'), confidence_level: 'UNKNOWN_BLOCKED' }];
  const result = evaluateMemorySelectionRequest(request);
  assert.equal(result.decision.status, 'VALIDATION_FAILED');
});

test('items are deduplicated by fingerprint, keeping the first occurrence in canonical order', () => {
  const result = evaluateMemorySelectionRequest(scenarioFixture('duplicate-memory').request);
  assert.equal(result.decision.status, 'SELECTION_PLANNED_SIMULATION');
  assert.equal(result.plan.excluded_duplicate_reference_ids.length, 1);
  assert.equal(result.plan.included_relevant_reference_ids.length, 1);
  assert.ok(result.plan.included_relevant_reference_ids.includes('item-duplicate-memory-a'));
});

test('input order never changes the resulting plan (order independence and canonical id tie-break)', () => {
  const scenario = scenarioFixture('canonical-order');
  const forward = evaluateMemorySelectionRequest(scenario.request);
  const reversedRequest = clone(scenario.request);
  reversedRequest.memory_item_references = [...reversedRequest.memory_item_references].reverse();
  const reversed = evaluateMemorySelectionRequest(reversedRequest);
  assert.deepEqual(forward.plan.ordered_reference_ids, reversed.plan.ordered_reference_ids);
  const sorted = [...forward.plan.ordered_reference_ids].sort();
  assert.deepEqual(forward.plan.ordered_reference_ids, sorted, 'canonical order ties break on item_reference_id');
});

test('budget scenarios: within limit succeeds, reserve exceeding total is rejected at the contract level, required not fitting blocks', () => {
  const withinLimit = evaluateMemorySelectionRequest(scenarioFixture('budget-within-limit').request);
  assert.equal(withinLimit.decision.status, 'SELECTION_PLANNED_SIMULATION');

  const overReservedBudget = { ...scenarioFixture('budget-within-limit').request.selection_budget, reserved_output_tokens: 999999999 };
  assert.equal(validateSelectionBudget(overReservedBudget).valid, false);

  const requiredBlocked = evaluateMemorySelectionRequest(scenarioFixture('required-memory-budget-block').request);
  assert.equal(requiredBlocked.decision.status, 'REQUIRED_MEMORY_BLOCKED');
});

test('REQUIRE_HIERARCHICAL_SUMMARY and REQUIRE_REASSEMBLY are purely declarative: no summary is generated, only a reason code and overflow flag are recorded', () => {
  const request = clone(scenarioFixture('relevant-overflow').request);
  request.selection_budget = { ...request.selection_budget, overflow_strategy: 'REQUIRE_HIERARCHICAL_SUMMARY' };
  const result = evaluateMemorySelectionRequest(request);
  assert.equal(result.decision.status, 'SELECTION_PLANNED_SIMULATION');
  assert.equal(result.decision.summary_generated, false);
  assert.equal(result.plan.overflow_detected, true);
  assert.ok(result.audit.exclusion_reason_codes.includes('hierarchical_summary_required_declarative'));
});

test('every produced decision carries every safe simulation flag regardless of scenario', () => {
  for (const key of Object.keys(fixture.scenarios)) {
    const result = evaluateMemorySelectionRequest(scenarioFixture(key).request);
    for (const [field, expected] of Object.entries(MEMORY_SELECTION_DECISION_SAFE_FLAGS)) {
      assert.equal(result.decision[field], expected, `scenario ${key} decision.${field} must be ${expected}`);
    }
  }
});

test('no memory is loaded, read, or embedded, no vector store or network is used, and no tokens or cost are consumed', () => {
  const result = evaluateMemorySelectionRequest(scenarioFixture('budget-within-limit').request);
  assert.equal(result.decision.memory_loaded, false);
  assert.equal(result.decision.memory_read, false);
  assert.equal(result.decision.memory_written, false);
  assert.equal(result.decision.embedding_generated, false);
  assert.equal(result.decision.vector_store_used, false);
  assert.equal(result.decision.tokens_consumed, false);
  assert.equal(result.decision.cost_consumed, false);
  assert.equal(result.decision.network_used, false);
  assert.equal(result.decision.executed, false);
});

// ---------------------------------------------------------------------------
// Plan / decision construction
// ---------------------------------------------------------------------------

test('plan forces plan_generated/selection_executed and throws on construction-invalid input', () => {
  const plan = buildSelectionPlan({
    planId: 'plan-x', selectionRequestId: 'req-x', tenantId: 't1', organizationId: 't1:o1', projectId: 'p1',
    includedRequiredReferenceIds: ['a'], totalEstimatedTokens: 10, allocatedTokens: 10, reservedOutputTokens: 5,
    remainingTokens: 985, overflowStrategy: 'DROP_OPTIONAL', requiredMemoryPreserved: true, preferencesPreserved: true,
    projectStatePreserved: true, continuityPreserved: true, pendingTasksPreserved: true, applicableDecisionsPreserved: true
  });
  assert.equal(plan.plan_generated, true);
  assert.equal(plan.selection_executed, false);
  assert.equal(validateSelectionPlan(plan).valid, true);
  // Empty input: plan_fingerprint's stablePayload() runs before the explicit validation throw
  // below and fails first on the missing identity fields (mirrors orchestrator-plan.js, PR #92).
  assert.throws(() => buildSelectionPlan({}), /undefined_not_serializable/);
  // A malformed (non-string) identity field reaches the intended explicit validation throw.
  assert.throws(
    () => buildSelectionPlan({ planId: 'plan-x', selectionRequestId: 'req-x', tenantId: 123, organizationId: 't1:o1', projectId: 'p1' }),
    /memory_selection_plan_construction_invalid/
  );
});

test('decision accepts only the 13 documented statuses and forces preservation/omission invariants when planned', () => {
  assert.equal(DECISION_STATUSES.length, 13);
  const planned = buildSelectionDecision({
    status: 'SELECTION_PLANNED_SIMULATION', decision_id: 'd1', selection_request_id: 'r1', agent_id: 'a1',
    tenant_id: 't1', organization_id: 't1:o1', project_id: 'p1', plan_fingerprint: 'fp1', request_fingerprint: 'fp2',
    policy_fingerprint: 'fp3', budget_fingerprint: 'fp4'
  });
  assert.equal(planned.decision, 'PLAN_MEMORY_REFERENCES');
  assert.equal(planned.required_memory_preserved, true);
  assert.equal(planned.required_memory_omitted, false);

  const blocked = buildSelectionDecision({ status: 'POLICY_BLOCKED' });
  assert.equal(blocked.decision, 'BLOCKED');
  assert.equal(blocked.required_memory_preserved, false);

  const invalidStatus = buildSelectionDecision({ status: 'NONSENSE_STATUS' });
  assert.equal(invalidStatus.status, 'VALIDATION_FAILED');
  assert.equal(invalidStatus.decision, 'BLOCKED');
});

test('input is never mutated by plan, decision, or score construction', () => {
  const planInput = { planId: 'p1', selectionRequestId: 'r1', tenantId: 't1', organizationId: 't1:o1', projectId: 'pr1', includedRequiredReferenceIds: ['a'] };
  const beforePlan = JSON.stringify(planInput);
  buildSelectionPlan(planInput);
  assert.equal(JSON.stringify(planInput), beforePlan);

  const decisionInput = { status: 'BUDGET_BLOCKED', blockers: ['x'] };
  const beforeDecision = JSON.stringify(decisionInput);
  buildSelectionDecision(decisionInput);
  assert.equal(JSON.stringify(decisionInput), beforeDecision);

  const item = itemFixture('relevant-memory');
  const request = scenarioFixture('budget-within-limit').request;
  const beforeItem = JSON.stringify(item);
  computeSelectionScore(item, request);
  assert.equal(JSON.stringify(item), beforeItem);
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry validates by construction and protects against replay, payload mismatch, version conflict, and fingerprint conflict', () => {
  const registry = createMemorySelectionRegistry();
  const request = scenarioFixture('budget-within-limit').request;

  const first = registry.registerRequest(request, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerRequest(request).status, 'REPLAY_ACCEPTED');

  const payloadMismatch = { ...request, correlation_id: 'different-correlation' };
  assert.equal(registry.registerRequest(payloadMismatch).status, 'PAYLOAD_MISMATCH');

  const versionBumped = { ...request, selection_request_version: 2, correlation_id: 'different-correlation' };
  const staleExpectedVersion = registry.registerRequest(versionBumped, { expected_version: 5 });
  assert.equal(staleExpectedVersion.status, 'VERSION_CONFLICT');

  const bumped = registry.registerRequest(versionBumped, { expected_version: 1 });
  assert.equal(bumped.status, 'REGISTERED_SIMULATION');

  const versionBumpedAgain = { ...request, selection_request_version: 3, correlation_id: 'yet-another-correlation' };
  const wrongFingerprint = registry.registerRequest(versionBumpedAgain, { expected_fingerprint: 'stale-fingerprint' });
  assert.equal(wrongFingerprint.status, 'FINGERPRINT_CONFLICT');

  const stored = registry.getRequestById(request.selection_request_id);
  assert.equal(stored.selection_request_version, 2, 'a rejected fingerprint conflict must not mutate the stored record');
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => { stored.correlation_id = 'x'; }, TypeError);
  assert.equal(registry.getRequestById('unknown-request-id'), null);

  const invalid = registry.registerRequest({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('registry blocks tenant and organization rebinding for item references and plans without mutating the stored record', () => {
  const registry = createMemorySelectionRegistry();
  const item = itemFixture('required-memory');
  assert.equal(registry.registerItemReference(item).status, 'REGISTERED_SIMULATION');

  const orgChanged = { ...item, organization_id: `${item.tenant_id}:org-different` };
  assert.equal(registry.registerItemReference(orgChanged).status, 'ORGANIZATION_BLOCKED');

  const tenantChanged = { ...item, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerItemReference(tenantChanged).status, 'TENANT_BLOCKED');

  assert.equal(registry.getItemReferenceById(item.item_reference_id).organization_id, item.organization_id);

  const scenario = scenarioFixture('budget-within-limit');
  const result = evaluateMemorySelectionRequest(scenario.request);
  assert.equal(registry.registerPlan(result.plan).status, 'REGISTERED_SIMULATION');
  const planOrgChanged = { ...result.plan, organization_id: `${result.plan.tenant_id}:org-different` };
  assert.equal(registry.registerPlan(planOrgChanged).status, 'ORGANIZATION_BLOCKED');
});

test('registry lists item references safely by tenant and organization, and every store performs a defensive clone', () => {
  const registry = createMemorySelectionRegistry();
  const itemA = itemFixture('required-memory');
  const itemB = { ...itemFixture('relevant-memory'), item_reference_id: 'item-relevant-memory-clone' };
  registry.registerItemReference(itemA);
  registry.registerItemReference(itemB);
  assert.equal(registry.listItemReferencesByTenant(itemA.tenant_id).length, 2);
  assert.equal(registry.listItemReferencesByOrganization(itemA.organization_id).length, 2);
  assert.equal(registry.listItemReferencesByTenant('tenant-unused').length, 0);

  const fetched = registry.getItemReferenceById(itemA.item_reference_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.priority = 999999; }, TypeError, 'a returned record must be a frozen defensive clone');
  assert.equal(registry.getItemReferenceById(itemA.item_reference_id).priority, itemA.priority);
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test('audit is immutable, records only fingerprints/bindings/counts/decision, and never marks anything executed', () => {
  const result = evaluateMemorySelectionRequest(scenarioFixture('budget-within-limit').request);
  const audit = result.audit;
  assert.equal(validateSelectionAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'audit_id', 'blockers', 'budget_fingerprint', 'decision', 'decision_fingerprint', 'executed',
    'exclusion_reason_codes', 'item_fingerprints', 'logical_sequence', 'omission_risk_summary',
    'organization_binding', 'plan_fingerprint', 'policy_fingerprint', 'preservation_flags', 'production_blocked',
    'project_binding', 'reference_counts_by_class', 'request_fingerprint', 'score_fingerprints', 'selection_request_id',
    'simulation', 'tenant_binding', 'validator_version'
  ].sort());

  const blockedResult = evaluateMemorySelectionRequest(scenarioFixture('conflicted-memory').request);
  const blockedAudit = buildSelectionAudit({ decision: blockedResult.decision });
  assert.equal(validateSelectionAudit(blockedAudit).valid, true);
  assert.equal(blockedAudit.decision, 'CONFLICT_BLOCKED');
});

test('fingerprints are deterministic and change when the underlying payload changes', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const resultA = evaluateMemorySelectionRequest(scenarioFixture('budget-within-limit').request);
  const resultB = evaluateMemorySelectionRequest(scenarioFixture('budget-within-limit').request);
  assert.equal(resultA.plan.plan_fingerprint, resultB.plan.plan_fingerprint);

  const changedRequest = clone(scenarioFixture('budget-within-limit').request);
  changedRequest.memory_item_references = changedRequest.memory_item_references.slice(0, 1);
  const resultC = evaluateMemorySelectionRequest(changedRequest);
  assert.notEqual(resultA.plan.plan_fingerprint, resultC.plan.plan_fingerprint);
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
  test(`operational material detector blocks ${name} in memory selection contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate memory selection field names', () => {
  const scenario = scenarioFixture('budget-within-limit');
  assert.deepEqual(findAgentCoreOperationalMaterial(scenario.request), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(scenario.decision), []);
  if (scenario.plan) assert.deepEqual(findAgentCoreOperationalMaterial(scenario.plan), []);
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

test('regression memory selection modules do not use network, filesystem, eval, dynamic import, or timers', () => {
  const files = [
    'services/api/src/core/memory-selection-request.js',
    'services/api/src/core/memory-selection-item-reference.js',
    'services/api/src/core/memory-selection-policy.js',
    'services/api/src/core/memory-selection-budget.js',
    'services/api/src/core/memory-selection-score.js',
    'services/api/src/core/memory-selection-plan.js',
    'services/api/src/core/memory-selection-decision.js',
    'services/api/src/core/memory-selection-registry.js',
    'services/api/src/core/memory-selection-audit.js',
    'services/api/src/core/memory-selection-engine.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval/.test(source), false);
    assert.equal(/\beval\(/.test(source), false);
    assert.equal(/\bnew Function\(/.test(source), false);
    assert.equal(/\bimport\(/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|ollama|openrouter|groq|together\.ai|huggingface/i.test(source), false);
    // "embedding" itself is deliberately excluded from this check: embedding_generated is a
    // mandated invariant field name (always forced false), not real vector-db usage.
    assert.equal(/qdrant|pinecone|weaviate|chroma|milvus/i.test(source), false);
    assert.equal(/postgres|supabase|redis/i.test(source), false);
  }
});

test('regression memory selection modules are not imported by runtime endpoints and do not call the Agent Orchestrator', () => {
  const files = [
    'services/api/src/core/memory-selection-engine.js',
    'services/api/src/core/memory-selection-registry.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]\.\/orchestrator-/.test(source), false);
  }
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('memory-selection-engine'), false);
    assert.equal(source.includes('memory-selection-registry'), false);
  }
});

test('regression PRs 79 through 92 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-registry.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/agent-memory-retrieval-reference.js',
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/model-selection-registry.js',
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/context-assembly-registry.js',
    'services/api/src/core/tool-decision.js',
    'services/api/src/core/tool-registry.js',
    'services/api/src/core/workflow-decision.js',
    'services/api/src/core/workflow-registry.js',
    'services/api/src/core/orchestrator-request.js',
    'services/api/src/core/orchestrator-plan.js',
    'services/api/src/core/orchestrator-decision.js',
    'services/api/src/core/orchestrator-registry.js',
    'services/api/src/core/orchestrator-audit.js'
  ].map((file) => path.join(repoRoot, file));
  const memorySelectionModules = [
    'memory-selection-request', 'memory-selection-item-reference', 'memory-selection-policy',
    'memory-selection-budget', 'memory-selection-score', 'memory-selection-plan', 'memory-selection-decision',
    'memory-selection-registry', 'memory-selection-audit', 'memory-selection-engine'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of memorySelectionModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});

test('regression full suite invariant: nothing in this PR ever claims to have executed, and REQUIRED memory is never omitted on success', () => {
  for (const key of Object.keys(fixture.scenarios)) {
    const scenario = scenarioFixture(key);
    const result = evaluateMemorySelectionRequest(scenario.request);
    for (const [field, expected] of Object.entries(MEMORY_SELECTION_DECISION_SAFE_FLAGS)) {
      assert.equal(result.decision[field], expected, `scenario ${key} decision.${field} must be ${expected}`);
    }
    if (result.decision.status === 'SELECTION_PLANNED_SIMULATION') {
      assert.equal(result.decision.required_memory_omitted, false);
      assert.equal(result.decision.preference_omitted, false);
      assert.equal(result.decision.project_state_omitted, false);
      assert.equal(result.decision.continuity_omitted, false);
    }
  }
});
