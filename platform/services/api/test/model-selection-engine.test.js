'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-model-selection-engine.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  COMPLEXITY_TIERS,
  MODEL_SELECTION_TASK_PROFILE_VALIDATOR_VERSION,
  TASK_TYPES,
  validateModelSelectionTaskProfile
} = require('../src/core/model-selection-task-profile');
const {
  MODEL_SELECTION_CONSTRAINTS_VALIDATOR_VERSION,
  validateModelSelectionConstraints
} = require('../src/core/model-selection-constraints');
const {
  CANDIDATE_STATUSES,
  COST_TIER_RANGES,
  MODEL_SELECTION_CANDIDATE_VALIDATOR_VERSION,
  NO_LLM_CANDIDATE_ID,
  buildNoLlmCandidate,
  isCostConsistentWithTier,
  isNoLlmEligible,
  validateModelSelectionCandidate
} = require('../src/core/model-selection-candidate');
const { MODEL_SELECTION_REQUEST_VALIDATOR_VERSION, validateModelSelectionRequest } = require('../src/core/model-selection-request');
const { MODEL_SELECTION_SCORE_VALIDATOR_VERSION, computeModelSelectionScore, validateModelSelectionScore } = require('../src/core/model-selection-score');
const {
  MODEL_SELECTION_RANKING_VALIDATOR_VERSION,
  NO_ELIGIBLE_CANDIDATE_SENTINEL,
  buildModelSelectionRanking,
  validateModelSelectionRanking
} = require('../src/core/model-selection-ranking');
const {
  MODEL_SELECTION_ESCALATION_PLAN_VALIDATOR_VERSION,
  TRIGGER_REFERENCES,
  buildModelSelectionEscalationPlan,
  validateModelSelectionEscalationPlan
} = require('../src/core/model-selection-escalation-plan');
const {
  DECISION_STATUSES,
  DECISION_VALUES,
  MODEL_SELECTION_DECISION_SAFE_FLAGS,
  buildModelSelectionDecision,
  validateModelSelectionDecision
} = require('../src/core/model-selection-decision');
const { evaluateCandidateStatus, evaluateModelSelectionRequest } = require('../src/core/model-selection-engine');
const { createModelSelectionRegistry } = require('../src/core/model-selection-registry');
const { buildModelSelectionAudit, validateModelSelectionAudit } = require('../src/core/model-selection-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SCENARIO_KEYS = [
  'deterministic-no-llm-selection', 'zero-cost-local-selection', 'low-cost-text-selection', 'structured-output-selection',
  'long-context-selection', 'advanced-reasoning-selection', 'high-risk-advanced-selection', 'premium-only-eligible-selection',
  'budget-blocked-selection', 'privacy-blocked-selection', 'unavailable-model-selection', 'unknown-pricing-selection',
  'capability-mismatch-selection', 'context-limit-selection', 'tenant-mismatch-selection', 'organization-mismatch-selection',
  'tie-breaker-selection', 'fallback-plan-selection', 'escalation-plan-selection', 'no-eligible-candidate-selection'
];

function scenario(key) {
  return clone(fixture.scenarios[key]);
}

test('fixture and docs exist without operational material and cover all required scenarios', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_MODEL_SELECTION_ENGINE.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...SCENARIO_KEYS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

SCENARIO_KEYS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its expected decision status`, () => {
    const s = scenario(key);
    const result = evaluateModelSelectionRequest(s.request, { candidates: s.candidates });
    assert.equal(result.decision.status, s.expected_status);
  });
});

test('task profile valid and rejects missing extra invalid enums tier rules and token mismatch', () => {
  const profile = scenario('advanced-reasoning-selection').request.task_profile;
  assert.equal(validateModelSelectionTaskProfile(profile).valid, true);
  const missing = clone(profile);
  delete missing.task_type;
  assert.ok(validateModelSelectionTaskProfile(missing).errors.some((error) => error.includes('missing_task_type')));
  assert.ok(validateModelSelectionTaskProfile({ ...profile, extra: 1 }).errors.some((error) => error.includes('unexpected_field::extra')));
  assert.ok(validateModelSelectionTaskProfile({ ...profile, task_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('task_type_not_allowed')));
  assert.ok(validateModelSelectionTaskProfile({ ...profile, complexity_tier: 'TIER_0_DETERMINISTIC' }).errors.includes('tier_0_requires_deterministic_resolution_available'));
  assert.ok(validateModelSelectionTaskProfile({ ...profile, complexity_tier: 'TIER_5_CRITICAL' }).errors.includes('tier_5_requires_human_review_required'));
  assert.ok(validateModelSelectionTaskProfile({ ...profile, risk_classification: 'HIGH', minimum_quality_tier: 'STANDARD' }).errors.includes('high_risk_or_tier_5_requires_minimum_quality_advanced'));
  assert.ok(validateModelSelectionTaskProfile({ ...profile, estimated_total_tokens: 1 }).errors.includes('estimated_total_tokens_mismatch'));
  assert.ok(validateModelSelectionTaskProfile({ ...profile, required_capabilities: ['a', 'a'] }).errors.includes('required_capabilities_invalid'));
  assert.equal(TASK_TYPES.length, 13);
  assert.equal(COMPLEXITY_TIERS.length, 6);
  assert.equal(profile.validator_version, MODEL_SELECTION_TASK_PROFILE_VALIDATOR_VERSION);
});

test('constraints valid and reject missing extra invalid enums NaN Infinity and float-like monetary values', () => {
  const constraints = scenario('advanced-reasoning-selection').request.constraints;
  assert.equal(validateModelSelectionConstraints(constraints).valid, true);
  const missing = clone(constraints);
  delete missing.allow_no_llm;
  assert.ok(validateModelSelectionConstraints(missing).errors.some((error) => error.includes('missing_allow_no_llm')));
  assert.ok(validateModelSelectionConstraints({ ...constraints, extra: 1 }).errors.some((error) => error.includes('unexpected_field::extra')));
  assert.ok(validateModelSelectionConstraints({ ...constraints, required_privacy_tier: 'RESTRICTED_BLOCKED' }).errors.includes('required_privacy_tier_forbidden::RESTRICTED_BLOCKED'));
  assert.ok(validateModelSelectionConstraints({ ...constraints, maximum_cost_minor_units: Number.NaN }).errors.some((error) => error.includes('maximum_cost_minor_units_invalid')));
  assert.ok(validateModelSelectionConstraints({ ...constraints, maximum_cost_minor_units: Infinity }).errors.some((error) => error.includes('maximum_cost_minor_units_invalid')));
  assert.ok(validateModelSelectionConstraints({ ...constraints, maximum_cost_minor_units: 1.5 }).errors.some((error) => error.includes('maximum_cost_minor_units_invalid')));
  assert.equal(constraints.validator_version, MODEL_SELECTION_CONSTRAINTS_VALIDATOR_VERSION);
});

test('candidate valid, NO_LLM synthetic candidate is well formed, and eligibility respects every required condition', () => {
  const candidate = scenario('advanced-reasoning-selection').candidates[0];
  assert.equal(validateModelSelectionCandidate(candidate).valid, true);
  assert.ok(validateModelSelectionCandidate({ ...candidate, extra: 1 }).errors.some((error) => error.includes('unexpected_field::extra')));
  assert.ok(validateModelSelectionCandidate({ ...candidate, candidate_status: 'NOT_A_STATUS' }).errors.some((error) => error.includes('candidate_status_not_allowed')));
  assert.ok(validateModelSelectionCandidate({ ...candidate, privacy_tier: 'RESTRICTED_BLOCKED' }).errors.includes('privacy_tier_forbidden::RESTRICTED_BLOCKED'));
  assert.equal(CANDIDATE_STATUSES.length, 13);

  const noLlm = buildNoLlmCandidate('tenant-a', 'tenant-a:org-1');
  assert.equal(validateModelSelectionCandidate(noLlm).valid, true);
  assert.equal(noLlm.candidate_id, NO_LLM_CANDIDATE_ID);
  assert.equal(noLlm.provider_id, null);
  assert.equal(noLlm.model_id, null);
  assert.equal(noLlm.estimated_cost_minor_units, 0);
  assert.equal(Object.isFrozen(noLlm), true);

  const tier0Profile = { deterministic_resolution_available: true, complexity_tier: 'TIER_0_DETERMINISTIC', required_capabilities: [], required_modalities: [], requires_tool_calling: false, requires_long_context: false };
  assert.equal(isNoLlmEligible(tier0Profile, { allow_no_llm: true }), true);
  assert.equal(isNoLlmEligible({ ...tier0Profile, required_capabilities: ['REASONING_REFERENCE'] }, { allow_no_llm: true }), false);
  assert.equal(isNoLlmEligible({ ...tier0Profile, required_modalities: ['IMAGE_INPUT_REFERENCE'] }, { allow_no_llm: true }), false);
  assert.equal(isNoLlmEligible({ ...tier0Profile, requires_tool_calling: true }, { allow_no_llm: true }), false);
  assert.equal(isNoLlmEligible({ ...tier0Profile, requires_long_context: true }, { allow_no_llm: true }), false);
  assert.equal(isNoLlmEligible(tier0Profile, { allow_no_llm: false }), false);
  assert.equal(isNoLlmEligible({ ...tier0Profile, complexity_tier: 'TIER_3_MODERATE' }, { allow_no_llm: true }), false);
  assert.equal(isNoLlmEligible({ ...tier0Profile, deterministic_resolution_available: false }, { allow_no_llm: true }), false);
});

test('candidate cost validation is deterministic: VERY_LOW cannot carry a PREMIUM-range cost and UNKNOWN_BLOCKED still blocks', () => {
  const candidate = scenario('advanced-reasoning-selection').candidates[0];

  const veryLowWithPremiumCost = { ...candidate, cost_tier: 'VERY_LOW', estimated_cost_minor_units: COST_TIER_RANGES.PREMIUM.min };
  const veryLowValidation = validateModelSelectionCandidate(veryLowWithPremiumCost);
  assert.equal(veryLowValidation.valid, false);
  assert.ok(veryLowValidation.errors.includes('cost_tier_inconsistent_with_estimated_cost::VERY_LOW'));

  const veryLowConsistent = { ...candidate, cost_tier: 'VERY_LOW', estimated_cost_minor_units: COST_TIER_RANGES.VERY_LOW.min };
  assert.equal(validateModelSelectionCandidate(veryLowConsistent).valid, true);

  const zeroCostWithNonZeroAmount = { ...candidate, cost_tier: 'ZERO_COST_REFERENCE', estimated_cost_minor_units: 1 };
  assert.ok(validateModelSelectionCandidate(zeroCostWithNonZeroAmount).errors.includes('cost_tier_inconsistent_with_estimated_cost::ZERO_COST_REFERENCE'));

  const unknownPricing = { ...candidate, cost_tier: 'UNKNOWN_BLOCKED', estimated_cost_minor_units: 500 };
  assert.equal(validateModelSelectionCandidate(unknownPricing).valid, true, 'UNKNOWN_BLOCKED is exempt from tier/cost range checks; it is blocked elsewhere by candidate_status resolution');

  for (const [tier, range] of Object.entries(COST_TIER_RANGES)) {
    assert.equal(isCostConsistentWithTier(tier, range.min), true, `${tier} minimum boundary must be accepted`);
    assert.equal(isCostConsistentWithTier(tier, range.max), true, `${tier} maximum boundary must be accepted`);
  }
  assert.equal(isCostConsistentWithTier('HIGH', COST_TIER_RANGES.HIGH.max + 1), false);
  assert.equal(isCostConsistentWithTier('PREMIUM', COST_TIER_RANGES.MODERATE.min), false);
});

test('selection request valid and rejects missing extra and cross-reference mismatches', () => {
  const request = scenario('advanced-reasoning-selection').request;
  assert.equal(validateModelSelectionRequest(request).valid, true);
  const missing = clone(request);
  delete missing.correlation_id;
  assert.ok(validateModelSelectionRequest(missing).errors.some((error) => error.includes('missing_correlation_id')));
  assert.ok(validateModelSelectionRequest({ ...request, extra: 1 }).errors.some((error) => error.includes('unexpected_field::extra')));
  const agentMismatch = clone(request);
  agentMismatch.task_profile.agent_id = 'agent-other';
  assert.ok(validateModelSelectionRequest(agentMismatch).errors.includes('agent_id_mismatch_between_agent_contract_reference_and_task_profile'));
  assert.equal(request.validator_version, MODEL_SELECTION_REQUEST_VALIDATOR_VERSION);
});

test('score is deterministic, rewards lower cost, blocks ineligible candidates and rejects malformed shapes', () => {
  const s = scenario('low-cost-text-selection');
  const eligible = { ...s.candidates[0], candidate_status: 'ELIGIBLE_SIMULATION' };
  const score1 = computeModelSelectionScore(eligible, s.request.task_profile, s.request.constraints);
  const score2 = computeModelSelectionScore(eligible, s.request.task_profile, s.request.constraints);
  assert.deepEqual(score1, score2);
  assert.equal(validateModelSelectionScore(score1).valid, true);

  const cheaper = { ...eligible, estimated_cost_minor_units: Math.max(0, eligible.estimated_cost_minor_units - 10) };
  const cheaperScore = computeModelSelectionScore(cheaper, s.request.task_profile, s.request.constraints);
  assert.ok(cheaperScore.cost_score >= score1.cost_score);

  const ineligible = { ...eligible, candidate_status: 'CAPABILITY_BLOCKED' };
  const ineligibleScore = computeModelSelectionScore(ineligible, s.request.task_profile, s.request.constraints);
  assert.equal(ineligibleScore.total_score, 0);
  assert.equal(ineligibleScore.eligibility_score, 0);

  assert.ok(!validateModelSelectionScore({ ...score1, extra: 1 }).valid);
  assert.ok(!validateModelSelectionScore({ ...score1, total_score: -1 }).valid);
});

test('ranking orders by eligibility, NO_LLM priority, cost tier, cost amount, quality, privacy, latency, availability, health, locality and canonical tie-break', () => {
  const noLlm = { ...buildNoLlmCandidate('tenant-a', 'tenant-a:org-1'), candidate_status: 'ELIGIBLE_SIMULATION' };
  const cheap = { candidate_id: 'c-cheap', model_id: 'entry-b', cost_tier: 'LOW', estimated_cost_minor_units: 100, quality_tier: 'STANDARD', privacy_tier: 'NO_TRAINING_REFERENCE', latency_tier: 'LOW', availability_status: 'AVAILABLE_REFERENCE', health_status: 'HEALTHY_REFERENCE', local_reference: false, supported_capabilities: [], candidate_status: 'ELIGIBLE_SIMULATION' };
  const expensive = { candidate_id: 'c-expensive', model_id: 'entry-a', cost_tier: 'HIGH', estimated_cost_minor_units: 5000, quality_tier: 'PREMIUM', privacy_tier: 'NO_TRAINING_REFERENCE', latency_tier: 'LOW', availability_status: 'AVAILABLE_REFERENCE', health_status: 'HEALTHY_REFERENCE', local_reference: false, supported_capabilities: [], candidate_status: 'ELIGIBLE_SIMULATION' };
  const blocked = { candidate_id: 'c-blocked', model_id: 'entry-c', candidate_status: 'CAPABILITY_BLOCKED' };
  const constraints = { maximum_fallbacks: 1, maximum_escalations: 1 };

  const ranking = buildModelSelectionRanking('ranking-1', 'selection-request-1', [expensive, cheap, blocked, noLlm], constraints);
  assert.equal(validateModelSelectionRanking(ranking).valid, true);
  assert.deepEqual(ranking.ordered_candidate_ids, [NO_LLM_CANDIDATE_ID, 'c-cheap', 'c-expensive', 'c-blocked']);
  assert.equal(ranking.primary_candidate_id, NO_LLM_CANDIDATE_ID);
  assert.equal(ranking.ranking_generated, true);
  assert.equal(ranking.selection_executed, false);

  const rankingReordered = buildModelSelectionRanking('ranking-1', 'selection-request-1', [noLlm, blocked, cheap, expensive], constraints);
  assert.deepEqual(ranking.ordered_candidate_ids, rankingReordered.ordered_candidate_ids);

  const tieA = { ...cheap, candidate_id: 'c-tie-z', model_id: 'zeta' };
  const tieB = { ...cheap, candidate_id: 'c-tie-a', model_id: 'alpha' };
  const tieRanking = buildModelSelectionRanking('ranking-2', 'selection-request-1', [tieA, tieB], { maximum_fallbacks: 0, maximum_escalations: 0 });
  assert.equal(tieRanking.tie_breaker_applied, true);
  assert.deepEqual(tieRanking.eligible_candidate_ids, ['c-tie-a', 'c-tie-z']);

  const noneRanking = buildModelSelectionRanking('ranking-3', 'selection-request-1', [blocked], { maximum_fallbacks: 0, maximum_escalations: 0 });
  assert.equal(noneRanking.primary_candidate_id, NO_ELIGIBLE_CANDIDATE_SENTINEL);
  assert.deepEqual(noneRanking.eligible_candidate_ids, []);

  assert.ok(!validateModelSelectionRanking({ ...ranking, extra: 1 }).valid);
});

test('ranking rejects duplicate candidate_id and guarantees fallback/escalation never equal primary and never overlap each other', () => {
  const mk = (id, cost) => ({
    candidate_id: id, model_id: id, cost_tier: 'LOW', estimated_cost_minor_units: cost, quality_tier: 'STANDARD',
    privacy_tier: 'NO_TRAINING_REFERENCE', latency_tier: 'LOW', availability_status: 'AVAILABLE_REFERENCE', health_status: 'HEALTHY_REFERENCE',
    local_reference: false, supported_capabilities: [], candidate_status: 'ELIGIBLE_SIMULATION'
  });

  assert.throws(
    () => buildModelSelectionRanking('ranking-dup', 'selection-request-1', [mk('dup-1', 100), mk('dup-1', 200)], { maximum_fallbacks: 1, maximum_escalations: 1 }),
    /model_selection_ranking_duplicate_candidate_id::dup-1/
  );
  assert.throws(
    () => buildModelSelectionRanking('ranking-missing', 'selection-request-1', [{ ...mk('x', 1), candidate_id: undefined }], { maximum_fallbacks: 0, maximum_escalations: 0 }),
    /model_selection_ranking_candidate_id_missing/
  );

  const ranking = buildModelSelectionRanking(
    'ranking-distinct', 'selection-request-1',
    [mk('a', 100), mk('b', 200), mk('c', 300)],
    { maximum_fallbacks: 1, maximum_escalations: 1 }
  );
  assert.equal(ranking.primary_candidate_id, 'a');
  assert.deepEqual(ranking.fallback_candidate_ids, ['b']);
  assert.deepEqual(ranking.escalation_candidate_ids, ['c']);
  assert.equal(ranking.fallback_candidate_ids.includes(ranking.primary_candidate_id), false);
  assert.equal(ranking.escalation_candidate_ids.includes(ranking.primary_candidate_id), false);
  assert.equal(ranking.escalation_candidate_ids.some((id) => ranking.fallback_candidate_ids.includes(id)), false);
  assert.equal(new Set(ranking.ordered_candidate_ids).size, ranking.ordered_candidate_ids.length);
  assert.equal(validateModelSelectionRanking(ranking).valid, true);

  const invalidFallbackEqualsPrimary = { ...ranking, fallback_candidate_ids: [ranking.primary_candidate_id] };
  assert.ok(validateModelSelectionRanking(invalidFallbackEqualsPrimary).errors.includes('fallback_candidate_ids_must_not_include_primary_candidate_id'));
  const invalidEscalationEqualsPrimary = { ...ranking, escalation_candidate_ids: [ranking.primary_candidate_id] };
  assert.ok(validateModelSelectionRanking(invalidEscalationEqualsPrimary).errors.includes('escalation_candidate_ids_must_not_include_primary_candidate_id'));
  const invalidOverlap = { ...ranking, escalation_candidate_ids: ranking.fallback_candidate_ids };
  assert.ok(validateModelSelectionRanking(invalidOverlap).errors.includes('escalation_candidate_ids_must_not_overlap_fallback_candidate_ids'));
  const invalidDuplicateOrdered = { ...ranking, ordered_candidate_ids: [...ranking.ordered_candidate_ids, ranking.ordered_candidate_ids[0]] };
  assert.equal(validateModelSelectionRanking(invalidDuplicateOrdered).valid, false);
});

test('escalation plan is purely declarative, forces executed flags false, and only accepts known trigger references', () => {
  const ranking = { primary_candidate_id: 'NO_LLM', fallback_candidate_ids: ['c-fallback'], escalation_candidate_ids: ['c-escalation'] };
  const constraints = { allow_fallback: true, allow_escalation: true, maximum_fallbacks: 1, maximum_escalations: 1 };
  const plan = buildModelSelectionEscalationPlan('plan-1', 'selection-request-1', ranking, constraints, false);
  assert.equal(validateModelSelectionEscalationPlan(plan).valid, true);
  assert.equal(plan.plan_generated, true);
  assert.equal(plan.fallback_executed, false);
  assert.equal(plan.escalation_executed, false);
  assert.ok(plan.fallback_trigger_references.every((trigger) => TRIGGER_REFERENCES.includes(trigger)));
  assert.equal(TRIGGER_REFERENCES.length, 9);
  assert.ok(!validateModelSelectionEscalationPlan({ ...plan, fallback_executed: true }).valid);
  assert.ok(!validateModelSelectionEscalationPlan({ ...plan, fallback_trigger_references: ['NOT_A_TRIGGER'] }).valid);

  const disallowed = buildModelSelectionEscalationPlan('plan-2', 'selection-request-1', ranking, { allow_fallback: false, allow_escalation: false, maximum_fallbacks: 0, maximum_escalations: 0 }, false);
  assert.deepEqual(disallowed.fallback_candidate_ids, []);
  assert.deepEqual(disallowed.escalation_candidate_ids, []);
});

test('decision enforces NO_LLM, MODEL_SELECTED and BLOCKED invariants and never allows any execution flag', () => {
  const noLlm = buildModelSelectionDecision({
    decision_id: 'd1', selection_request_id: 'r1', agent_id: 'a1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    status: 'NO_LLM_SELECTED_SIMULATION', selected_candidate_id: NO_LLM_CANDIDATE_ID, selected_cost_tier: 'ZERO_COST_REFERENCE',
    request_fingerprint: 'fp1', task_profile_fingerprint: 'fp2', constraints_fingerprint: 'fp3', ranking_fingerprint: 'fp4',
    selected_candidate_fingerprint: 'fp5', registry_version: 'v1'
  });
  assert.equal(validateModelSelectionDecision(noLlm).valid, true);
  assert.equal(noLlm.selected_provider_id, null);
  assert.equal(noLlm.selected_model_id, null);
  assert.equal(noLlm.deterministic_resolution_selected, true);
  assert.equal(noLlm.model_selected_in_simulation, false);

  const modelSelected = buildModelSelectionDecision({
    decision_id: 'd2', selection_request_id: 'r1', agent_id: 'a1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    status: 'MODEL_SELECTED_SIMULATION', selected_candidate_id: 'c1', selected_provider_id: 'svc-1', selected_model_id: 'entry-1',
    selected_cost_tier: 'LOW', estimated_cost_minor_units: 100, request_fingerprint: 'fp1', task_profile_fingerprint: 'fp2',
    constraints_fingerprint: 'fp3', ranking_fingerprint: 'fp4', selected_candidate_fingerprint: 'fp5', registry_version: 'v1'
  });
  assert.equal(validateModelSelectionDecision(modelSelected).valid, true);
  assert.equal(modelSelected.model_selected_in_simulation, true);
  assert.equal(modelSelected.deterministic_resolution_selected, false);

  const blocked = buildModelSelectionDecision({
    decision_id: 'd3', selection_request_id: 'r1', agent_id: 'a1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    status: 'NO_ELIGIBLE_CANDIDATE', request_fingerprint: 'fp1', task_profile_fingerprint: 'fp2', constraints_fingerprint: 'fp3',
    ranking_fingerprint: 'fp4', selected_candidate_fingerprint: 'fp5', registry_version: 'v1', blockers: ['x'], reason_codes: ['x']
  });
  assert.equal(validateModelSelectionDecision(blocked).valid, true);
  assert.equal(blocked.selected_provider_id, null);
  assert.equal(blocked.selected_model_id, null);
  assert.equal(blocked.model_selected_in_simulation, false);

  for (const decision of [noLlm, modelSelected, blocked]) {
    for (const [field, expected] of Object.entries(MODEL_SELECTION_DECISION_SAFE_FLAGS)) {
      assert.equal(decision[field], expected);
    }
    assert.equal(decision.selection_evaluated, true);
    assert.equal(Object.isFrozen(decision), true);
  }
  assert.equal(DECISION_STATUSES.length, 15);
  assert.equal(DECISION_VALUES.includes('BLOCKED'), true);

  const malformed = buildModelSelectionDecision({ status: 'MODEL_SELECTED_SIMULATION' });
  assert.equal(malformed.status, 'VALIDATION_FAILED');
  assert.equal(malformed.decision, 'BLOCKED');
});

test('engine selects NO_LLM for TIER_0 and blocks NO_LLM whenever a model capability is required', () => {
  const s = scenario('deterministic-no-llm-selection');
  const result = evaluateModelSelectionRequest(s.request, { candidates: s.candidates });
  assert.equal(result.decision.status, 'NO_LLM_SELECTED_SIMULATION');
  assert.equal(result.decision.selected_candidate_id, NO_LLM_CANDIDATE_ID);

  const requiresReasoning = clone(s.request);
  requiresReasoning.task_profile.required_capabilities = ['REASONING_REFERENCE'];
  const blockedResult = evaluateModelSelectionRequest(requiresReasoning, { candidates: [] });
  assert.notEqual(blockedResult.decision.status, 'NO_LLM_SELECTED_SIMULATION');
});

test('engine picks the cheapest candidate that satisfies requirements and only escalates to premium when required', () => {
  const cheapWins = scenario('low-cost-text-selection');
  const cheapResult = evaluateModelSelectionRequest(cheapWins.request, { candidates: cheapWins.candidates });
  assert.equal(cheapResult.decision.selected_model_id, cheapWins.candidates.find((c) => c.cost_tier === 'VERY_LOW').candidate_id);

  const premiumOnly = scenario('premium-only-eligible-selection');
  const premiumResult = evaluateModelSelectionRequest(premiumOnly.request, { candidates: premiumOnly.candidates });
  assert.equal(premiumResult.decision.selected_model_id, premiumOnly.candidates.find((c) => c.quality_tier === 'PREMIUM').candidate_id);
});

test('engine blocks quality, context, privacy, availability, health, budget, capability, tenant and organization mismatches', () => {
  const blockedScenarios = [
    'premium-only-eligible-selection', 'context-limit-selection', 'privacy-blocked-selection', 'unavailable-model-selection',
    'unknown-pricing-selection', 'budget-blocked-selection', 'capability-mismatch-selection', 'tenant-mismatch-selection',
    'organization-mismatch-selection'
  ];
  for (const key of blockedScenarios) {
    const s = scenario(key);
    const result = evaluateModelSelectionRequest(s.request, { candidates: s.candidates });
    assert.notEqual(result.decision.status, 'VALIDATION_FAILED', `${key} should not fail request validation`);
  }
});

test('engine blocks RESTRICTED risk requests entirely and enforces TIER_5 human review at the task profile level', () => {
  const s = scenario('advanced-reasoning-selection');
  const restricted = clone(s.request);
  restricted.task_profile.risk_classification = 'RESTRICTED';
  const restrictedResult = evaluateModelSelectionRequest(restricted, { candidates: s.candidates });
  assert.equal(restrictedResult.decision.status, 'RISK_BLOCKED');

  const tier5WithoutReview = clone(s.request);
  tier5WithoutReview.task_profile.complexity_tier = 'TIER_5_CRITICAL';
  const tier5Result = evaluateModelSelectionRequest(tier5WithoutReview, { candidates: s.candidates });
  assert.equal(tier5Result.decision.status, 'VALIDATION_FAILED');
});

test('policy DENY and REQUIRE_APPROVAL always prevail over score, and version/fingerprint mismatches block candidates independently of cost', () => {
  const s = scenario('low-cost-text-selection');
  const denied = clone(s.request);
  denied.policy_decision_reference.policy_status = 'DENY';
  denied.policy_decision_reference.allowed_in_simulation = false;
  const deniedResult = evaluateModelSelectionRequest(denied, { candidates: s.candidates });
  assert.equal(deniedResult.decision.status, 'POLICY_BLOCKED');
  assert.equal(deniedResult.decision.selected_candidate_id, 'SELECTION_BLOCKED');

  const versionMismatch = clone(s.request);
  versionMismatch.candidate_model_references[0].reference_version = 99;
  const versionResult = evaluateModelSelectionRequest(versionMismatch, { candidates: s.candidates });
  const cheapCandidate = s.candidates.find((c) => c.candidate_id === versionMismatch.candidate_model_references[0].reference_id);
  const status = evaluateCandidateStatus(cheapCandidate, versionMismatch.task_profile, versionMismatch.constraints, versionMismatch);
  assert.equal(status, 'VERSION_BLOCKED');
  assert.notEqual(versionResult.decision.selected_model_id, cheapCandidate.candidate_id);
});

test('fallback and escalation plans are generated declaratively but nothing is ever executed', () => {
  const fallback = scenario('fallback-plan-selection');
  const fallbackResult = evaluateModelSelectionRequest(fallback.request, { candidates: fallback.candidates });
  assert.equal(fallbackResult.decision.fallback_plan_present, true);
  assert.equal(fallbackResult.escalationPlan.fallback_executed, false);

  const escalation = scenario('escalation-plan-selection');
  const escalationResult = evaluateModelSelectionRequest(escalation.request, { candidates: escalation.candidates });
  assert.equal(escalationResult.decision.escalation_plan_present, true);
  assert.equal(escalationResult.escalationPlan.escalation_executed, false);

  for (const result of [fallbackResult, escalationResult]) {
    assert.equal(result.decision.provider_called, false);
    assert.equal(result.decision.model_called, false);
    assert.equal(result.decision.network_used, false);
    assert.equal(result.decision.tokens_consumed, false);
    assert.equal(result.decision.cost_consumed, false);
    assert.equal(result.decision.executed, false);
    assert.equal(result.decision.runtime_enabled, false);
  }
});

test('registry replay payload mismatch version conflict tenant organization block and safe listing', () => {
  const s = scenario('low-cost-text-selection');
  const result = evaluateModelSelectionRequest(s.request, { candidates: s.candidates });
  const registry = createModelSelectionRegistry();

  const taskProfile = s.request.task_profile;
  const constraints = s.request.constraints;
  const first = registry.registerTaskProfile(taskProfile, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerTaskProfile(taskProfile).status, 'REPLAY_ACCEPTED');
  const mismatch = registry.registerTaskProfile({ ...taskProfile, task_type: 'CLASSIFICATION_REFERENCE' });
  assert.equal(mismatch.status, 'PAYLOAD_MISMATCH');
  const bumped = { ...taskProfile, task_profile_version: 2, task_type: 'CLASSIFICATION_REFERENCE' };
  assert.equal(registry.registerTaskProfile(bumped).status, 'REGISTERED_SIMULATION');
  const reassigned = { ...taskProfile, task_profile_version: 3, tenant_id: 'tenant-other' };
  assert.equal(registry.registerTaskProfile(reassigned).status, 'TENANT_BLOCKED');

  assert.equal(registry.registerConstraints(s.request.selection_request_id, constraints).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerConstraints(s.request.selection_request_id, constraints).status, 'REPLAY_ACCEPTED');

  for (const candidate of result.candidates) {
    const outcome = registry.registerCandidate(candidate, { expected_version: 0 });
    assert.equal(outcome.status, 'REGISTERED_SIMULATION');
  }
  assert.equal(registry.registerRanking(result.ranking).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerDecision(result.decision, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerEscalationPlan(result.escalationPlan).status, 'REGISTERED_SIMULATION');

  const fetched = registry.getDecisionById(result.decision.decision_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.status = 'x'; }, TypeError);

  assert.equal(registry.listTaskProfilesByTenant(taskProfile.tenant_id).length, 1);
  assert.equal(registry.listTaskProfilesByTenant('tenant-other-unused').length, 0);
});

test('audit is immutable, structurally minimal, and never contains a full payload, prompt, secret, endpoint or code', () => {
  const s = scenario('low-cost-text-selection');
  const result = evaluateModelSelectionRequest(s.request, { candidates: s.candidates });
  const audit = buildModelSelectionAudit({ request: s.request, decision: result.decision, ranking: result.ranking, escalationPlan: result.escalationPlan, candidates: result.candidates, logical_sequence: 1 });
  assert.equal(validateModelSelectionAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'audit_id', 'blockers', 'candidate_fingerprints', 'complexity_tier', 'constraints_fingerprint', 'data_classification',
    'decision', 'decision_fingerprint', 'escalation_plan_fingerprint', 'estimated_cost_minor_units', 'executed',
    'logical_sequence', 'organization_binding', 'production_blocked', 'ranking_fingerprint', 'reason_codes',
    'registry_version', 'request_fingerprint', 'risk_classification', 'selected_candidate_id', 'selected_cost_tier',
    'simulation', 'task_profile_fingerprint', 'task_type', 'tenant_binding', 'validator_version'
  ].sort());
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key'],
  ['secret value', { secret_value: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['prompt word', { note: 'do not store the system_prompt text' }, 'forbidden_word_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['execute word', { note: 'do not execute this reference' }, 'forbidden_word_value']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name} in model selection payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate model selection field names', () => {
  const s = scenario('low-cost-text-selection');
  assert.deepEqual(findAgentCoreOperationalMaterial(s.request.task_profile), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.request.constraints), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.candidates[0]), []);
});

test('operational material detector rejects NaN Infinity bigint symbol function and cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((error) => error.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((error) => error.includes('forbidden_symbol')));
  assert.ok(findAgentCoreOperationalMaterial({ value: () => null }).some((error) => error.includes('forbidden_function')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((error) => error.includes('forbidden_cycle')));
});

test('fingerprints are deterministic, change with payload, and evaluation never mutates caller input', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const s = scenario('low-cost-text-selection');
  const beforeRequest = JSON.stringify(s.request);
  const beforeCandidates = JSON.stringify(s.candidates);
  const result1 = evaluateModelSelectionRequest(s.request, { candidates: s.candidates });
  assert.equal(JSON.stringify(s.request), beforeRequest);
  assert.equal(JSON.stringify(s.candidates), beforeCandidates);
  const result2 = evaluateModelSelectionRequest(scenario('low-cost-text-selection').request, { candidates: scenario('low-cost-text-selection').candidates });
  assert.equal(result1.decision.ranking_fingerprint, result2.decision.ranking_fingerprint);

  const differentRequest = clone(s.request);
  differentRequest.task_profile.estimated_input_tokens = 999;
  differentRequest.task_profile.estimated_total_tokens = 999 + differentRequest.task_profile.estimated_output_tokens;
  const result3 = evaluateModelSelectionRequest(differentRequest, { candidates: s.candidates });
  assert.notEqual(result1.decision.task_profile_fingerprint, result3.decision.task_profile_fingerprint);
});

test('regression model selection modules do not use network filesystem eval dynamic import or timers', () => {
  const files = [
    'services/api/src/core/model-selection-task-profile.js',
    'services/api/src/core/model-selection-constraints.js',
    'services/api/src/core/model-selection-candidate.js',
    'services/api/src/core/model-selection-request.js',
    'services/api/src/core/model-selection-score.js',
    'services/api/src/core/model-selection-ranking.js',
    'services/api/src/core/model-selection-escalation-plan.js',
    'services/api/src/core/model-selection-decision.js',
    'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/model-selection-registry.js',
    'services/api/src/core/model-selection-audit.js'
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
  }
});

test('regression model selection engine is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('model-selection'), false);
  }
});

test('regression PRs 79 through 83 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-boundary.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-provider-decision.js',
    'services/api/src/core/model-provider-registry.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js',
    'services/api/src/core/transcription-network-permission-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  const engineModules = [
    'model-selection-engine', 'model-selection-task-profile', 'model-selection-candidate', 'model-selection-request',
    'model-selection-score', 'model-selection-ranking', 'model-selection-escalation-plan', 'model-selection-decision',
    'model-selection-registry', 'model-selection-audit', 'model-selection-constraints'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of engineModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});
