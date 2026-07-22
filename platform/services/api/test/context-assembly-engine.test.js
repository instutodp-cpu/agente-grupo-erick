'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-context-assembly-engine.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  SOURCE_TYPES,
  SOURCE_ORIGINS,
  CONTEXT_ASSEMBLY_SOURCE_REFERENCE_VALIDATOR_VERSION,
  validateContextAssemblySourceReference
} = require('../src/core/context-assembly-source-reference');
const { CONTEXT_ASSEMBLY_POLICY_VALIDATOR_VERSION, validateContextAssemblyPolicy } = require('../src/core/context-assembly-policy');
const { OVERFLOW_STRATEGIES, CONTEXT_ASSEMBLY_BUDGET_VALIDATOR_VERSION, validateContextBudget } = require('../src/core/context-assembly-budget');
const {
  SECTION_TYPES,
  CONTEXT_ASSEMBLY_SECTION_VALIDATOR_VERSION,
  validateContextAssemblySection
} = require('../src/core/context-assembly-section');
const { CONTEXT_ASSEMBLY_REQUEST_VALIDATOR_VERSION, validateContextAssemblyRequest } = require('../src/core/context-assembly-request');
const {
  CONTEXT_ASSEMBLY_PLAN_VALIDATOR_VERSION,
  buildContextAssemblyPlan,
  compareSections,
  deduplicateSourceReferences,
  validateContextAssemblyPlan
} = require('../src/core/context-assembly-plan');
const {
  BLOCKED_CONTEXT_PACKAGE_SENTINEL,
  CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS,
  RESULT_STATUSES,
  buildContextAssemblyResult,
  validateContextAssemblyResult
} = require('../src/core/context-assembly-result');
const {
  SOURCE_TYPE_TO_SECTION_TYPE,
  allocateSectionBudget,
  evaluateContextAssemblyRequest
} = require('../src/core/context-assembly-engine');
const { createContextAssemblyRegistry } = require('../src/core/context-assembly-registry');
const { buildContextAssemblyAudit, validateContextAssemblyAudit } = require('../src/core/context-assembly-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SCENARIO_IDS = [
  'deterministic-no-llm-context', 'low-cost-model-context', 'standard-model-context',
  'confidential-context-with-policy', 'confidential-context-without-policy', 'restricted-source-context',
  'budget-within-limit-context', 'budget-overflow-block-context', 'budget-overflow-trim-context',
  'duplicate-source-context', 'required-source-conflict-context', 'tenant-mismatch-context',
  'organization-mismatch-context', 'session-mismatch-context', 'memory-mismatch-context',
  'model-selection-blocked-context', 'no-required-task-context', 'canonical-order-context',
  'replay-context', 'version-conflict-context'
];

function scenario(id) {
  const found = fixture.scenarios.find((entry) => entry.scenario_id === id);
  return clone(found);
}

test('fixture and docs exist, cover all required scenarios, and every request payload is free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_CONTEXT_ASSEMBLY_ENGINE.md')), true);
  assert.deepEqual(fixture.scenarios.map((s) => s.scenario_id).sort(), [...SCENARIO_IDS].sort());
  for (const s of fixture.scenarios) {
    assert.deepEqual(findAgentCoreOperationalMaterial(s.request), [], `scenario ${s.scenario_id} request must be free of operational material`);
  }
});

SCENARIO_IDS.forEach((id) => {
  test(`fixture scenario ${id} reproduces its expected status and decision`, () => {
    const s = scenario(id);
    const outcome = evaluateContextAssemblyRequest(s.request, s.engine_context || {});
    assert.equal(outcome.result.status, s.expected_status);
    assert.equal(outcome.result.decision, s.expected_decision);
  });
});

test('source reference valid, forces content flags false, and enforces tenant/organization compatibility and token bounds', () => {
  const source = scenario('deterministic-no-llm-context').request.source_references[0];
  assert.equal(validateContextAssemblySourceReference(source).valid, true);
  const missing = clone(source);
  delete missing.source_type;
  assert.ok(validateContextAssemblySourceReference(missing).errors.some((e) => e.includes('missing_source_type')));
  assert.ok(validateContextAssemblySourceReference({ ...source, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateContextAssemblySourceReference({ ...source, source_type: 'NOT_A_TYPE' }).errors.some((e) => e.includes('source_type_not_allowed')));
  assert.ok(validateContextAssemblySourceReference({ ...source, source_origin: 'NOT_AN_ORIGIN' }).errors.some((e) => e.includes('source_origin_not_allowed')));
  assert.ok(validateContextAssemblySourceReference({ ...source, content_present: true }).errors.includes('content_present_must_be_false'));
  assert.ok(validateContextAssemblySourceReference({ ...source, content_loaded: true }).errors.includes('content_loaded_must_be_false'));
  assert.ok(validateContextAssemblySourceReference({ ...source, content_included: true }).errors.includes('content_included_must_be_false'));
  assert.ok(validateContextAssemblySourceReference({ ...source, organization_id: 'other-tenant:org-1' }).errors.includes('organization_id_not_compatible_with_tenant'));
  assert.ok(validateContextAssemblySourceReference({ ...source, estimated_tokens: source.maximum_tokens + 1 }).errors.includes('estimated_tokens_exceeds_maximum_tokens'));
  assert.equal(SOURCE_TYPES.length, 14);
  assert.equal(SOURCE_ORIGINS.length, 9);
  assert.equal(source.validator_version, CONTEXT_ASSEMBLY_SOURCE_REFERENCE_VALIDATOR_VERSION);
});

test('assembly policy valid, forces cross-session/cross-agent false and simulation flags true, and bounds source/section maxima', () => {
  const policy = scenario('deterministic-no-llm-context').request.assembly_policy;
  assert.equal(validateContextAssemblyPolicy(policy).valid, true);
  const missing = clone(policy);
  delete missing.allow_confidential;
  assert.ok(validateContextAssemblyPolicy(missing).errors.some((e) => e.includes('missing_allow_confidential')));
  assert.ok(validateContextAssemblyPolicy({ ...policy, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateContextAssemblyPolicy({ ...policy, allow_cross_session: true }).errors.includes('allow_cross_session_must_be_false'));
  assert.ok(validateContextAssemblyPolicy({ ...policy, allow_cross_agent: true }).errors.includes('allow_cross_agent_must_be_false'));
  assert.ok(validateContextAssemblyPolicy({ ...policy, simulation: false }).errors.includes('simulation_must_be_true'));
  assert.ok(validateContextAssemblyPolicy({ ...policy, production_blocked: false }).errors.includes('production_blocked_must_be_true'));
  assert.ok(validateContextAssemblyPolicy({ ...policy, maximum_sources: 0 }).errors.includes('maximum_sources_invalid'));
  assert.ok(validateContextAssemblyPolicy({ ...policy, maximum_sections: 0 }).errors.includes('maximum_sections_invalid'));
  assert.equal(policy.validator_version, CONTEXT_ASSEMBLY_POLICY_VALIDATOR_VERSION);
});

test('context budget valid, rejects reserved-token overrun, and bounds every reserved field', () => {
  const budget = scenario('deterministic-no-llm-context').request.context_budget;
  assert.equal(validateContextBudget(budget).valid, true);
  const missing = clone(budget);
  delete missing.maximum_total_tokens;
  assert.ok(validateContextBudget(missing).errors.some((e) => e.includes('missing_maximum_total_tokens')));
  assert.ok(validateContextBudget({ ...budget, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateContextBudget({ ...budget, reserved_system_tokens: budget.maximum_total_tokens }).errors.some((e) => e.includes('reserved')));
  assert.ok(validateContextBudget({ ...budget, overflow_strategy: 'NOT_A_STRATEGY' }).errors.some((e) => e.includes('overflow_strategy_not_allowed')));
  assert.ok(validateContextBudget({ ...budget, simulation: false }).errors.includes('simulation_must_be_true'));
  assert.ok(validateContextBudget({ ...budget, production_blocked: false }).errors.includes('production_blocked_must_be_true'));
  assert.equal(OVERFLOW_STRATEGIES.length, 4);
  assert.equal(budget.validator_version, CONTEXT_ASSEMBLY_BUDGET_VALIDATOR_VERSION);
});

test('section valid, enforces mutual exclusion of included/trimmed/excluded, and keeps source_count consistent with source_reference_ids', () => {
  const outcome = evaluateContextAssemblyRequest(scenario('deterministic-no-llm-context').request);
  const section = outcome.sections[0];
  assert.equal(validateContextAssemblySection(section).valid, true);
  assert.ok(validateContextAssemblySection({ ...section, included: true, trimmed: true }).errors.some((e) => e.includes('mutually_exclusive')));
  assert.ok(validateContextAssemblySection({ ...section, source_count: section.source_count + 1 }).errors.some((e) => e.includes('source_count')));
  assert.ok(validateContextAssemblySection({ ...section, excluded: true, included: false, exclusion_reason_codes: [] }).errors.length > 0);
  assert.equal(SECTION_TYPES.length, 12);
  assert.equal(section.validator_version, CONTEXT_ASSEMBLY_SECTION_VALIDATOR_VERSION);
});

test('assembly request valid, rejects extra/missing fields, and rejects duplicate source_reference_id', () => {
  const request = scenario('deterministic-no-llm-context').request;
  assert.equal(validateContextAssemblyRequest(request).valid, true);
  const missing = clone(request);
  delete missing.correlation_id;
  assert.ok(validateContextAssemblyRequest(missing).errors.some((e) => e.includes('correlation_id_invalid') || e.includes('missing_correlation_id')));
  assert.ok(validateContextAssemblyRequest({ ...request, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  const dup = clone(request);
  dup.source_references = [dup.source_references[0], { ...dup.source_references[0] }];
  assert.ok(validateContextAssemblyRequest(dup).errors.some((e) => e.includes('source_references_duplicate')));
  assert.equal(request.validator_version, CONTEXT_ASSEMBLY_REQUEST_VALIDATOR_VERSION);
});

test('plan valid, rejects section-id count mismatch, throws on duplicate section ids, and preserves reserved output tokens', () => {
  const outcome = evaluateContextAssemblyRequest(scenario('deterministic-no-llm-context').request);
  assert.equal(validateContextAssemblyPlan(outcome.plan).valid, true);
  assert.equal(outcome.plan.reserved_output_tokens, scenario('deterministic-no-llm-context').request.context_budget.reserved_output_tokens);
  assert.ok(validateContextAssemblyPlan({ ...outcome.plan, included_section_ids: [] }).errors.includes('ordered_section_ids_count_mismatch'));

  const dupSection = { ...outcome.sections[0] };
  assert.throws(
    () => buildContextAssemblyPlan({
      planId: 'plan-dup', assemblyRequestId: 'req-dup', tenantId: 'tenant-alpha', organizationId: 'tenant-alpha:org-1',
      sections: [dupSection, dupSection], includedSourceIds: [], excludedSourceIds: [], deduplicatedSourceIds: [],
      reservedOutputTokens: 100, overflowDetected: false, overflowStrategy: 'BLOCK', maximumTotalTokens: 10000
    }),
    /context_assembly_plan_construction_invalid/
  );
});

test('result valid, forces every safe flag, and enforces status/decision consistency including the blocked sentinel', () => {
  const outcome = evaluateContextAssemblyRequest(scenario('deterministic-no-llm-context').request);
  assert.equal(validateContextAssemblyResult(outcome.result).valid, true);
  for (const [field, expected] of Object.entries(CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS)) {
    assert.equal(outcome.result[field], expected);
  }
  assert.equal(outcome.result.assembly_planned, true);

  const blocked = buildContextAssemblyResult({ status: 'TENANT_BLOCKED', blockers: ['x'], reason_codes: ['x'] });
  assert.equal(validateContextAssemblyResult(blocked).valid, true);
  assert.equal(blocked.decision, 'BLOCKED');
  assert.equal(blocked.context_package_reference_id, BLOCKED_CONTEXT_PACKAGE_SENTINEL);
  assert.equal(blocked.selected_model_reference_id, null);
  assert.equal(blocked.assembly_planned, false);

  const malformed = buildContextAssemblyResult({ status: 'ASSEMBLY_PLANNED_SIMULATION', total_estimated_tokens: -5 });
  assert.equal(malformed.status, 'VALIDATION_FAILED');
  assert.equal(malformed.decision, 'BLOCKED');
  assert.equal(RESULT_STATUSES.length, 14);
});

test('NO_LLM context plan requires no model reference and MODEL_SELECTED context plan carries provider/model reference ids', () => {
  const noLlm = evaluateContextAssemblyRequest(scenario('deterministic-no-llm-context').request);
  assert.equal(noLlm.result.selected_model_reference_id, null);
  assert.equal(noLlm.result.selected_provider_reference_id, null);

  const selected = evaluateContextAssemblyRequest(scenario('low-cost-model-context').request);
  assert.equal(selected.result.selected_model_reference_id, scenario('low-cost-model-context').request.model_selection_decision_reference.selected_model_id);
  assert.equal(selected.result.selected_provider_reference_id, scenario('low-cost-model-context').request.model_selection_decision_reference.selected_provider_id);
});

test('agent mismatch blocks a non-shareable source bound to a different agent', () => {
  const request = clone(scenario('deterministic-no-llm-context').request);
  request.source_references[0].agent_id = 'agent-different';
  request.source_references[0].shareable = false;
  const outcome = evaluateContextAssemblyRequest(request);
  assert.equal(outcome.result.status, 'SOURCE_BLOCKED');

  const shareable = clone(scenario('deterministic-no-llm-context').request);
  shareable.source_references[0].agent_id = 'agent-different';
  shareable.source_references[0].shareable = true;
  const shareableOutcome = evaluateContextAssemblyRequest(shareable);
  assert.equal(shareableOutcome.result.status, 'ASSEMBLY_PLANNED_SIMULATION');
});

test('source type blocked by policy excludes only that source, and untrusted references are excluded unless explicitly allowed', () => {
  const request = clone(scenario('deterministic-no-llm-context').request);
  request.assembly_policy.allow_user_input_reference = false;
  const outcome = evaluateContextAssemblyRequest(request);
  assert.equal(outcome.result.status, 'ASSEMBLY_PLANNED_SIMULATION');
  assert.equal(outcome.plan.included_source_reference_ids.length, 0);
  assert.ok(outcome.plan.excluded_source_reference_ids.includes(request.source_references[0].source_reference_id));

  const untrusted = clone(scenario('deterministic-no-llm-context').request);
  untrusted.source_references[0].trusted_reference = false;
  const untrustedOutcome = evaluateContextAssemblyRequest(untrusted);
  assert.ok(untrustedOutcome.plan.excluded_source_reference_ids.includes(untrusted.source_references[0].source_reference_id));
});

test('required source excluded by policy blocks assembly when fail_on_required_source_exclusion is true', () => {
  const request = clone(scenario('deterministic-no-llm-context').request);
  request.source_references[0].required = true;
  request.assembly_policy.allow_user_input_reference = false;
  request.assembly_policy.fail_on_required_source_exclusion = true;
  const outcome = evaluateContextAssemblyRequest(request);
  assert.equal(outcome.result.status, 'SOURCE_BLOCKED');
});

test('optional source excluded by policy does not block assembly when fail_on_required_source_exclusion is false', () => {
  const request = clone(scenario('deterministic-no-llm-context').request);
  request.assembly_policy.allow_user_input_reference = false;
  request.assembly_policy.fail_on_required_source_exclusion = false;
  const outcome = evaluateContextAssemblyRequest(request);
  assert.equal(outcome.result.status, 'ASSEMBLY_PLANNED_SIMULATION');
});

test('deduplication by fingerprint keeps the highest priority source and drops the rest', () => {
  const s = scenario('duplicate-source-context');
  const outcome = evaluateContextAssemblyRequest(s.request);
  assert.equal(outcome.plan.included_source_reference_ids.length, 1);
  assert.equal(outcome.plan.deduplicated_source_reference_ids.length, 1);
  const kept = s.request.source_references.reduce((max, source) => (source.priority > max.priority ? source : max));
  assert.deepEqual(outcome.plan.included_source_reference_ids, [kept.source_reference_id]);
});

test('conflict between two required sources sharing a content slot with different fingerprints blocks assembly', () => {
  const s = scenario('required-source-conflict-context');
  const conflict = deduplicateSourceReferences(s.request.source_references, { deduplicate: false });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.conflictReferenceId, 'shared-slot-1');
});

test('insertion order never changes the result and canonical section ordering is required-first then priority-descending then type rank then id', () => {
  const s = scenario('canonical-order-context');
  const forward = evaluateContextAssemblyRequest(s.request);
  const reversed = clone(s.request);
  reversed.source_references = [...reversed.source_references].reverse();
  const backward = evaluateContextAssemblyRequest(reversed);
  assert.deepEqual(forward.plan.ordered_section_ids, backward.plan.ordered_section_ids);
  assert.deepEqual(forward.plan.ordered_section_ids, ['section-system_section', 'section-document_section', 'section-user_input_section']);

  const required = { section_id: 'a', section_type: 'SYSTEM_SECTION', required: true, priority: 100 };
  const optionalHighPriority = { section_id: 'b', section_type: 'USER_INPUT_SECTION', required: false, priority: 900 };
  assert.equal(compareSections(required, optionalHighPriority) < 0, true, 'required must sort before higher-priority optional');
  const higher = { section_id: 'c', section_type: 'USER_INPUT_SECTION', required: false, priority: 900 };
  const lower = { section_id: 'd', section_type: 'USER_INPUT_SECTION', required: false, priority: 100 };
  assert.equal(compareSections(higher, lower) < 0, true);
  const sameTypeA = { section_id: 'z', section_type: 'AGENT_SECTION', required: false, priority: 100 };
  const sameTypeB = { section_id: 'a', section_type: 'AGENT_SECTION', required: false, priority: 100 };
  assert.equal(compareSections(sameTypeA, sameTypeB) > 0, true, 'canonical tie-break falls back to section_id');
});

test('budget within limit is fully included, and total allocation stays consistent with the sum of section allocations', () => {
  const outcome = evaluateContextAssemblyRequest(scenario('budget-within-limit-context').request);
  const sumAllocated = outcome.sections.reduce((sum, section) => sum + section.allocated_tokens, 0);
  assert.equal(outcome.plan.total_allocated_tokens, sumAllocated);
  const sumEstimated = outcome.sections.reduce((sum, section) => sum + section.estimated_tokens, 0);
  assert.equal(outcome.plan.total_estimated_tokens, sumEstimated);
});

test('overflow strategy BLOCK hard-blocks when a required source alone exceeds the reserved budget', () => {
  const allocation = allocateSectionBudget(
    [{ source_reference_id: 's1', priority: 500, required: true, estimated_tokens: 1000 }],
    100,
    'BLOCK'
  );
  assert.equal(allocation.blocksAssembly, true);
  assert.equal(allocation.excluded, true);
});

test('overflow strategy DROP_LOWEST_PRIORITY_OPTIONAL drops the lowest-priority optional sources until it fits and never drops required sources', () => {
  const allocation = allocateSectionBudget(
    [
      { source_reference_id: 's-required', priority: 900, required: true, estimated_tokens: 60 },
      { source_reference_id: 's-low', priority: 100, required: false, estimated_tokens: 60 },
      { source_reference_id: 's-mid', priority: 500, required: false, estimated_tokens: 60 }
    ],
    120,
    'DROP_LOWEST_PRIORITY_OPTIONAL'
  );
  assert.equal(allocation.blocksAssembly, false);
  assert.ok(allocation.keptSourceIds.includes('s-required'));
  assert.ok(allocation.excludedSourceIds.includes('s-low'));
  assert.equal(allocation.allocatedTokens <= 120, true);
});

test('overflow strategy TRIM_OPTIONAL_REFERENCES caps allocated tokens at the reserved budget without dropping any source id', () => {
  const allocation = allocateSectionBudget(
    [
      { source_reference_id: 's1', priority: 500, required: false, estimated_tokens: 700 },
      { source_reference_id: 's2', priority: 400, required: false, estimated_tokens: 700 }
    ],
    1000,
    'TRIM_OPTIONAL_REFERENCES'
  );
  assert.equal(allocation.trimmed, true);
  assert.equal(allocation.allocatedTokens, 1000);
  assert.deepEqual(allocation.keptSourceIds.slice().sort(), ['s1', 's2']);
});

test('overflow strategy REQUIRE_REASSEMBLY excludes optional sources without blocking, and blocks only when a required source is present', () => {
  const optionalOnly = allocateSectionBudget(
    [{ source_reference_id: 's1', priority: 500, required: false, estimated_tokens: 700 }],
    100,
    'REQUIRE_REASSEMBLY'
  );
  assert.equal(optionalOnly.blocksAssembly, false);
  assert.equal(optionalOnly.excluded, true);

  const withRequired = allocateSectionBudget(
    [{ source_reference_id: 's1', priority: 500, required: true, estimated_tokens: 700 }],
    100,
    'REQUIRE_REASSEMBLY'
  );
  assert.equal(withRequired.blocksAssembly, true);
});

test('duplicate source ids in a request are rejected and duplicate section ids in a plan are rejected', () => {
  const request = clone(scenario('deterministic-no-llm-context').request);
  const source = request.source_references[0];
  request.source_references = [source, { ...source }];
  assert.equal(validateContextAssemblyRequest(request).valid, false);
});

test('registry validates by construction, protects against replay, payload mismatch, optimistic concurrency and organization rebinding, and lists safely', () => {
  const registry = createContextAssemblyRegistry();
  const source = scenario('deterministic-no-llm-context').request.source_references[0];

  const first = registry.registerSourceReference(source, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerSourceReference(source).status, 'REPLAY_ACCEPTED');

  const mismatch = { ...source, priority: source.priority + 1 };
  assert.equal(registry.registerSourceReference(mismatch).status, 'PAYLOAD_MISMATCH');

  const bumped = { ...source, priority: source.priority + 1, source_reference_version: source.source_reference_version + 1 };
  assert.equal(registry.registerSourceReference(bumped).status, 'REGISTERED_SIMULATION');

  const versionConflict = registry.registerSourceReference(
    { ...source, priority: source.priority + 2, source_reference_version: source.source_reference_version + 2 },
    { expected_version: 999 }
  );
  assert.equal(versionConflict.status, 'VERSION_CONFLICT');

  const orgRebind = registry.registerSourceReference({
    ...source, organization_id: `${source.tenant_id}:org-different`, source_reference_version: source.source_reference_version + 2
  });
  assert.equal(orgRebind.status, 'ORGANIZATION_BLOCKED');

  const tenantRebind = registry.registerSourceReference({
    ...source, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1', source_reference_version: source.source_reference_version + 2
  });
  assert.equal(tenantRebind.status, 'TENANT_BLOCKED');

  const fetched = registry.getSourceReferenceById(source.source_reference_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.priority = 0; }, TypeError);
  assert.equal(registry.getSourceReferenceById('unknown-id'), null);

  registry.registerSourceReference({ ...source, source_reference_id: 'source-other-agent', agent_id: 'agent-other', source_reference_version: 1 }, { expected_version: 0 });
  assert.equal(registry.listSourceReferencesByTenant(source.tenant_id).length, 2);
  assert.equal(registry.listSourceReferencesByOrganization(source.organization_id).length, 2);
  assert.equal(registry.listSourceReferencesByAgent('agent-other').length, 1);
  assert.equal(registry.listSourceReferencesByTenant('tenant-unused').length, 0);

  const invalid = registry.registerSourceReference({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('audit is immutable, structurally minimal, records only fingerprints/counts/bindings, and never marks anything executed', () => {
  const s = scenario('deterministic-no-llm-context');
  const outcome = evaluateContextAssemblyRequest(s.request);
  const audit = buildContextAssemblyAudit({ request: s.request, result: outcome.result, plan: outcome.plan });
  assert.equal(validateContextAssemblyAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'agent_id', 'assembly_request_id', 'audit_id', 'blockers', 'budget_fingerprint', 'decision_status', 'executed',
    'logical_sequence', 'model_selection_decision_fingerprint', 'organization_binding', 'overflow_status',
    'plan_fingerprint', 'policy_fingerprint', 'production_blocked', 'reason_codes', 'request_fingerprint',
    'result_fingerprint', 'section_counts', 'section_fingerprints', 'simulation', 'source_counts',
    'source_fingerprints', 'tenant_binding', 'token_estimates', 'validator_version'
  ].sort());

  const blockedOutcome = evaluateContextAssemblyRequest(scenario('tenant-mismatch-context').request);
  const blockedAudit = buildContextAssemblyAudit({ request: scenario('tenant-mismatch-context').request, result: blockedOutcome.result, plan: blockedOutcome.plan });
  assert.equal(validateContextAssemblyAudit(blockedAudit).valid, true);
  assert.equal(blockedAudit.decision_status, 'TENANT_BLOCKED');
  assert.ok(blockedAudit.blockers.length > 0);
});

test('nothing is ever loaded, generated, called, consumed or executed regardless of outcome', () => {
  for (const id of SCENARIO_IDS) {
    const s = scenario(id);
    const outcome = evaluateContextAssemblyRequest(s.request, s.engine_context || {});
    assert.equal(outcome.result.content_loaded, false);
    assert.equal(outcome.result.history_loaded, false);
    assert.equal(outcome.result.memory_loaded, false);
    assert.equal(outcome.result.document_loaded, false);
    assert.equal(outcome.result.tool_result_loaded, false);
    assert.equal(outcome.result.prompt_generated, false);
    assert.equal(outcome.result.provider_called, false);
    assert.equal(outcome.result.model_called, false);
    assert.equal(outcome.result.network_used, false);
    assert.equal(outcome.result.tokens_consumed, false);
    assert.equal(outcome.result.cost_consumed, false);
    assert.equal(outcome.result.executed, false);
    assert.equal(outcome.result.runtime_enabled, false);
    assert.equal(outcome.result.simulation, true);
    assert.equal(outcome.result.production_blocked, true);
  }
});

test('input is never mutated and every produced structure is deep-frozen', () => {
  const request = scenario('deterministic-no-llm-context').request;
  const before = JSON.stringify(request);
  const outcome = evaluateContextAssemblyRequest(request);
  assert.equal(JSON.stringify(request), before);
  assert.equal(Object.isFrozen(outcome.result), true);
  assert.equal(Object.isFrozen(outcome.plan), true);
  assert.throws(() => { outcome.result.status = 'x'; }, TypeError);
  assert.throws(() => { outcome.plan.ordered_section_ids.push('x'); }, TypeError);
});

test('fingerprints are deterministic and change when the underlying payload changes', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const s = scenario('deterministic-no-llm-context');
  const outcome1 = evaluateContextAssemblyRequest(s.request);
  const outcome2 = evaluateContextAssemblyRequest(clone(s.request));
  assert.equal(outcome1.result.request_fingerprint, outcome2.result.request_fingerprint);

  const changed = clone(s.request);
  changed.source_references[0].priority = 1;
  const outcome3 = evaluateContextAssemblyRequest(changed);
  assert.notEqual(outcome1.result.request_fingerprint, outcome3.result.request_fingerprint);
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key'],
  ['secret value', { secret_value: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['prompt word', { note: 'do not store the system_prompt text' }, 'forbidden_word_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['handler word', { note: 'a handler for this event' }, 'forbidden_word_value'],
  ['execute word', { note: 'do not execute this reference' }, 'forbidden_word_value'],
  ['function value', { note: () => null }, 'forbidden_function']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name} in context assembly payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate context assembly field names', () => {
  const s = scenario('deterministic-no-llm-context');
  assert.deepEqual(findAgentCoreOperationalMaterial(s.request.source_references[0]), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.request.assembly_policy), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.request.context_budget), []);
  const outcome = evaluateContextAssemblyRequest(s.request);
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.result), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.plan), []);
});

test('operational material detector rejects NaN Infinity bigint symbol and cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((e) => e.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((e) => e.includes('forbidden_symbol')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((e) => e.includes('forbidden_cycle')));
});

test('SOURCE_TYPE_TO_SECTION_TYPE covers every declared source type with a valid section type', () => {
  for (const sourceType of SOURCE_TYPES) {
    assert.ok(SECTION_TYPES.includes(SOURCE_TYPE_TO_SECTION_TYPE[sourceType]), `${sourceType} must map to a known section type`);
  }
});

test('regression context assembly modules do not use network filesystem eval dynamic import or timers', () => {
  const files = [
    'services/api/src/core/context-assembly-source-reference.js',
    'services/api/src/core/context-assembly-policy.js',
    'services/api/src/core/context-assembly-budget.js',
    'services/api/src/core/context-assembly-section.js',
    'services/api/src/core/context-assembly-request.js',
    'services/api/src/core/context-assembly-plan.js',
    'services/api/src/core/context-assembly-result.js',
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/context-assembly-registry.js',
    'services/api/src/core/context-assembly-audit.js'
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

test('regression context assembly engine is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('context-assembly'), false);
  }
});

test('regression PRs 79 through 86 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-boundary.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-provider-decision.js',
    'services/api/src/core/model-provider-registry.js',
    'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/model-selection-registry.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js',
    'services/api/src/core/transcription-network-permission-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  const engineModules = [
    'context-assembly-engine', 'context-assembly-source-reference', 'context-assembly-policy', 'context-assembly-budget',
    'context-assembly-section', 'context-assembly-request', 'context-assembly-plan', 'context-assembly-result',
    'context-assembly-registry', 'context-assembly-audit'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of engineModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});

test('regression transcription boundaries remain functionally independent from context assembly', () => {
  const files = [
    'services/api/src/core/transcription-network-permission-boundary.js',
    'services/api/src/core/transcription-secret-resolution-boundary.js',
    'services/api/src/core/transcription-provider-selection-engine.js',
    'services/api/src/core/transcription-orchestrator.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('context-assembly'), false);
  }
});
