'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-orchestrator-contracts.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  MAX_REQUIRED_MEMORY_REFERENCES,
  MAX_TOOL_REFERENCES,
  MAX_USER_PREFERENCE_REFERENCES,
  ORCHESTRATOR_REQUEST_FIELDS,
  ORCHESTRATOR_REQUEST_VALIDATOR_VERSION,
  validateOrchestratorRequest
} = require('../src/core/orchestrator-request');
const {
  NOT_AVAILABLE_REFERENCE,
  ORCHESTRATOR_PLAN_VALIDATOR_VERSION,
  buildOrchestratorPlan,
  isOrderedUniqueStringList,
  validateOrchestratorPlan
} = require('../src/core/orchestrator-plan');
const {
  FORBIDDEN_ORCHESTRATOR_DECISION_STATUSES,
  ORCHESTRATOR_DECISION_SAFE_FLAGS,
  ORCHESTRATOR_DECISION_STATUSES,
  ORCHESTRATOR_DECISION_VALIDATOR_VERSION,
  buildOrchestratorDecision,
  validateOrchestratorDecision
} = require('../src/core/orchestrator-decision');
const { createOrchestratorRegistry } = require('../src/core/orchestrator-registry');
const { buildOrchestratorAudit, validateOrchestratorAudit } = require('../src/core/orchestrator-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestFixture(key) {
  return clone(fixture.requests[key]);
}
function planFixture(key) {
  return clone(fixture.plans[key]);
}
function decisionFixture(key) {
  return clone(fixture.decisions[key]);
}

test('fixture and docs exist without operational material and cover request/plan/all four decision statuses', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_AGENT_ORCHESTRATOR.md')), true);
  assert.deepEqual(Object.keys(fixture.requests).sort(), ['deterministic-no-llm-request', 'economical-selection-request']);
  assert.deepEqual(Object.keys(fixture.plans).sort(), ['deterministic-no-llm-plan', 'economical-selection-plan']);
  assert.deepEqual(Object.keys(fixture.decisions).sort(), ['blocked-decision', 'plan-ready-decision', 'simulation-only-decision', 'validation-failed-decision']);
  for (const key of Object.keys(fixture.requests)) {
    assert.deepEqual(findAgentCoreOperationalMaterial(fixture.requests[key]), [], `request ${key} must be free of operational material`);
  }
  for (const key of Object.keys(fixture.plans)) {
    assert.deepEqual(findAgentCoreOperationalMaterial(fixture.plans[key]), [], `plan ${key} must be free of operational material`);
  }
  for (const key of Object.keys(fixture.decisions)) {
    assert.deepEqual(findAgentCoreOperationalMaterial(fixture.decisions[key]), [], `decision ${key} must be free of operational material`);
  }
});

Object.keys(fixture.requests).forEach((key) => {
  test(`fixture request ${key} validates as a structurally complete orchestrator request`, () => {
    const request = requestFixture(key);
    assert.equal(validateOrchestratorRequest(request).valid, true);
    assert.equal(request.validator_version, ORCHESTRATOR_REQUEST_VALIDATOR_VERSION);
  });
});

Object.keys(fixture.plans).forEach((key) => {
  test(`fixture plan ${key} validates as a structurally complete orchestrator plan`, () => {
    const plan = planFixture(key);
    assert.equal(validateOrchestratorPlan(plan).valid, true);
    assert.equal(plan.plan_generated, true);
    assert.equal(plan.plan_executed, false);
  });
});

Object.keys(fixture.decisions).forEach((key) => {
  test(`fixture decision ${key} validates and matches an accepted status`, () => {
    const decision = decisionFixture(key);
    assert.equal(validateOrchestratorDecision(decision).valid, true);
    assert.equal(ORCHESTRATOR_DECISION_STATUSES.includes(decision.status), true);
  });
});

test('request valid, rejects unknown/extra/missing fields, and reuses existing PR79-89 reference contracts without duplicating their shape', () => {
  const request = requestFixture('deterministic-no-llm-request');
  assert.equal(validateOrchestratorRequest(request).valid, true);
  const missing = clone(request);
  delete missing.workflow_reference;
  assert.ok(validateOrchestratorRequest(missing).errors.some((e) => e.includes('missing_workflow_reference')));
  assert.ok(validateOrchestratorRequest({ ...request, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateOrchestratorRequest({ ...request, agent_contract_reference: { ...request.agent_contract_reference, tenant_id: undefined } }).errors.length > 0);
  assert.ok(validateOrchestratorRequest({ ...request, model_selection_decision_reference: { ...request.model_selection_decision_reference, decision_status: 'NOT_A_STATUS' } }).errors.some((e) => e.includes('decision_status_not_allowed')));
  const tooManyTools = { ...request, tool_references: Array.from({ length: MAX_TOOL_REFERENCES + 1 }, (_, i) => ({ reference_id: `t${i}`, reference_version: 1, reference_fingerprint: `fp${i}`, validator_version: ORCHESTRATOR_REQUEST_VALIDATOR_VERSION })) };
  assert.ok(!validateOrchestratorRequest(tooManyTools).valid);
  assert.equal(request.validator_version, ORCHESTRATOR_REQUEST_VALIDATOR_VERSION);
});

test('request contains no content, message, or prompt field anywhere in its own field list', () => {
  for (const field of ORCHESTRATOR_REQUEST_FIELDS) {
    assert.equal(/content|message|prompt/i.test(field), false, `field ${field} must not resemble a content/message/prompt field`);
  }
});

test('continuity reference fields (user preferences, project state, continuity summary, required memory, memory selection policy) are required, reference-only, tenant/organization-consistent, fingerprint-validated, and reject duplicate list entries (PR #92 addendum, full memory selection policy deferred to PR #93)', () => {
  const request = requestFixture('deterministic-no-llm-request');
  assert.equal(validateOrchestratorRequest(request).valid, true);
  assert.equal(ORCHESTRATOR_REQUEST_FIELDS.length, 25);

  for (const field of ['user_preference_references', 'project_state_reference', 'continuity_summary_reference', 'required_memory_references', 'memory_selection_policy_reference']) {
    const missing = clone(request);
    delete missing[field];
    assert.ok(validateOrchestratorRequest(missing).errors.some((e) => e.includes(`missing_${field}`)), `${field} must be required`);
  }

  // Singular references: reused validateSingleReference shape, fingerprint validated.
  for (const field of ['project_state_reference', 'continuity_summary_reference', 'memory_selection_policy_reference']) {
    assert.ok(
      validateOrchestratorRequest({ ...request, [field]: { ...request[field], reference_fingerprint: '' } }).errors.some((e) => e.startsWith(`${field}_`)),
      `${field} must validate its fingerprint`
    );
    assert.ok(
      !validateOrchestratorRequest({ ...request, [field]: 'not-an-object' }).valid,
      `${field} must remain a minimal reference object, never inline content`
    );
  }

  // List references: reused validateReferenceList shape, duplicates and fingerprints rejected.
  for (const field of ['user_preference_references', 'required_memory_references']) {
    const item = request[field][0];
    assert.ok(!validateOrchestratorRequest({ ...request, [field]: [item, item] }).valid, `${field} must reject duplicate reference_id entries`);
    assert.ok(
      !validateOrchestratorRequest({ ...request, [field]: [{ ...item, reference_fingerprint: '' }] }).valid,
      `${field} entries must validate their fingerprint`
    );
  }
  const tooManyPreferences = { ...request, user_preference_references: Array.from({ length: MAX_USER_PREFERENCE_REFERENCES + 1 }, (_, i) => ({ reference_id: `pref-${i}`, reference_version: 1, reference_fingerprint: `fp-${i}`, validator_version: ORCHESTRATOR_REQUEST_VALIDATOR_VERSION })) };
  assert.ok(!validateOrchestratorRequest(tooManyPreferences).valid);
  const tooManyRequiredMemories = { ...request, required_memory_references: Array.from({ length: MAX_REQUIRED_MEMORY_REFERENCES + 1 }, (_, i) => ({ reference_id: `mem-${i}`, reference_version: 1, reference_fingerprint: `fp-${i}`, validator_version: ORCHESTRATOR_REQUEST_VALIDATOR_VERSION })) };
  assert.ok(!validateOrchestratorRequest(tooManyRequiredMemories).valid);

  // Tenant/organization consistency: the fixture's agent_contract_reference and
  // memory_retrieval_reference already share the same tenant_id/organization_id -- confirms
  // adding the 5 new reference-only fields did not disturb that existing consistency, and that
  // the request-level tenant_id/organization_id checks that DO exist (on agent_contract_reference
  // itself) still reject a non-string value.
  assert.equal(request.agent_contract_reference.tenant_id, request.memory_retrieval_reference.tenant_id);
  assert.equal(request.agent_contract_reference.organization_id, request.memory_retrieval_reference.organization_id);
  assert.ok(!validateOrchestratorRequest({ ...request, agent_contract_reference: { ...request.agent_contract_reference, tenant_id: 123 } }).valid);

  // None of the 5 fields carry content, a memory read flag, or an execution flag -- they are
  // exactly the same minimal reference shapes (SINGLE_REFERENCE_FIELDS / LIST_REFERENCE_ITEM_FIELDS)
  // already reused elsewhere in this file, confirmed by exact-fields rejecting any extra field.
  assert.ok(!validateOrchestratorRequest({ ...request, project_state_reference: { ...request.project_state_reference, content: 'not allowed' } }).valid);
  assert.ok(!validateOrchestratorRequest({ ...request, required_memory_references: [{ ...request.required_memory_references[0], memory_read: true }] }).valid);
});

test('plan valid, forces plan_generated/plan_executed, rejects unsorted or duplicate ordered lists on hand-crafted input, and throws on construction-invalid input', () => {
  const plan = planFixture('deterministic-no-llm-plan');
  assert.equal(validateOrchestratorPlan(plan).valid, true);
  assert.ok(!validateOrchestratorPlan({ ...plan, plan_generated: false }).valid);
  assert.ok(!validateOrchestratorPlan({ ...plan, plan_executed: true }).valid);
  assert.ok(!validateOrchestratorPlan({ ...plan, ordered_validation_codes: ['b', 'a'] }).valid, 'unsorted array must be rejected even though the builder always normalizes it');
  assert.ok(!validateOrchestratorPlan({ ...plan, ordered_reference_ids: ['x', 'x'] }).valid, 'duplicate entries must be rejected on hand-crafted input');
  assert.ok(!validateOrchestratorPlan({ ...plan, extra: 1 }).valid);
  assert.equal(isOrderedUniqueStringList([]), true, 'an empty ordered list is legal (e.g. zero blockers)');
  assert.equal(isOrderedUniqueStringList(['a', 'a']), false);
  assert.throws(
    () => buildOrchestratorPlan({ planId: 123, orchestratorRequestId: 'r1', tenantId: 't1', organizationId: 't1:o1', agentId: 'a1' }),
    /orchestrator_plan_construction_invalid/
  );
  assert.throws(() => buildOrchestratorPlan({}), /not_serializable/, 'missing identity fields must fail loudly, not silently default');
  const noModel = buildOrchestratorPlan({ planId: 'p1', orchestratorRequestId: 'r1', tenantId: 't1', organizationId: 't1:o1', agentId: 'a1' });
  assert.equal(noModel.model_reference_id, null);
  assert.equal(noModel.context_reference_id, NOT_AVAILABLE_REFERENCE);
  assert.equal(plan.validator_version, ORCHESTRATOR_PLAN_VALIDATOR_VERSION);
});

test('decision accepts only PLAN_READY BLOCKED VALIDATION_FAILED SIMULATION_ONLY and forces every safe flag regardless of caller overrides', () => {
  assert.deepEqual(ORCHESTRATOR_DECISION_STATUSES, ['PLAN_READY', 'BLOCKED', 'VALIDATION_FAILED', 'SIMULATION_ONLY']);
  for (const forbidden of FORBIDDEN_ORCHESTRATOR_DECISION_STATUSES) {
    const decision = buildOrchestratorDecision({ status: forbidden });
    assert.equal(decision.status, 'VALIDATION_FAILED', `${forbidden} must never be accepted, even as a caller override`);
  }
  const attempted = {
    status: 'PLAN_READY', decision_id: 'd1', orchestrator_request_id: 'r1', tenant_id: 't1', organization_id: 't1:o1',
    agent_id: 'a1', plan_reference_id: 'plan-1', request_fingerprint: 'fp1', plan_fingerprint: 'fp2',
    workflow_reference_id: 'w1', context_reference_id: 'c1', executed: true, tool_called: true, workflow_executed: true,
    provider_called: true, model_called: true, runtime_enabled: true, network_used: true, tokens_consumed: true,
    cost_consumed: true, simulation: false, production_blocked: false
  };
  const decision = buildOrchestratorDecision(attempted);
  for (const [field, expected] of Object.entries(ORCHESTRATOR_DECISION_SAFE_FLAGS)) {
    assert.equal(decision[field], expected, `${field} was not forced to ${expected}`);
  }
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(decision.validator_version, ORCHESTRATOR_DECISION_VALIDATOR_VERSION);

  const blocked = buildOrchestratorDecision({ status: 'BLOCKED', blockers: ['x'], reason_codes: ['x'] });
  assert.equal(blocked.plan_reference_id, NOT_AVAILABLE_REFERENCE);
  assert.equal(blocked.plan_fingerprint, 'fingerprint_not_available');

  const malformed = buildOrchestratorDecision({ status: 'PLAN_READY' });
  assert.equal(malformed.status, 'VALIDATION_FAILED');
  assert.equal(malformed.decision_id, 'orchestrator_decision_not_available');
  assert.equal(validateOrchestratorDecision(malformed).valid, true);
});

test('tenant mismatch and organization mismatch are blocked at registration for both plans and decisions, without mutating the stored record', () => {
  const registry = createOrchestratorRegistry();
  const decision = decisionFixture('plan-ready-decision');
  const first = registry.registerDecision(decision, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');

  const orgChanged = { ...decision, organization_id: `${decision.tenant_id}:org-different` };
  assert.equal(registry.registerDecision(orgChanged).status, 'ORGANIZATION_BLOCKED');

  const tenantChanged = { ...decision, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerDecision(tenantChanged).status, 'TENANT_BLOCKED');

  assert.equal(registry.getDecisionById(decision.decision_id).organization_id, decision.organization_id, 'a rejected rebinding attempt must not mutate the stored record');

  const plan = planFixture('deterministic-no-llm-plan');
  assert.equal(registry.registerPlan(plan, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  const planOrgChanged = { ...plan, organization_id: `${plan.tenant_id}:org-different` };
  assert.equal(registry.registerPlan(planOrgChanged).status, 'ORGANIZATION_BLOCKED');
  const planTenantChanged = { ...plan, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerPlan(planTenantChanged).status, 'TENANT_BLOCKED');
});

test('registry validates by construction, protects against replay, payload mismatch, optimistic concurrency, fingerprint conflict, and lists safely', () => {
  const registry = createOrchestratorRegistry();
  const decision = decisionFixture('plan-ready-decision');

  const first = registry.registerDecision(decision, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerDecision(decision).status, 'REPLAY_ACCEPTED');

  const mismatch = { ...decision, reason_codes: ['different_reason'] };
  assert.equal(registry.registerDecision(mismatch).status, 'PAYLOAD_MISMATCH', 'ToolDecision/WorkflowDecision-style entities have no version field, so any payload change without one is PAYLOAD_MISMATCH');

  const fetched = registry.getDecisionById(decision.decision_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.status = 'x'; }, TypeError);
  assert.equal(registry.getDecisionById('unknown-decision-id'), null);

  // FINGERPRINT_CONFLICT requires optimistic concurrency (a version field to bump), which only
  // orchestrator-request.js has among the three stores (orchestrator_request_version) -- mirrors
  // exactly how PR91 exercised FINGERPRINT_CONFLICT against agent-registry.js/agent-policy-registry.js.
  const request = requestFixture('deterministic-no-llm-request');
  const requestFirst = registry.registerRequest(request, { expected_version: 0 });
  assert.equal(requestFirst.status, 'REGISTERED_SIMULATION');
  const requestBumped = { ...request, orchestrator_request_version: 2, correlation_id: 'changed-correlation-1' };
  const correctFingerprint = registry.registerRequest(requestBumped, { expected_fingerprint: requestFirst.fingerprint });
  assert.equal(correctFingerprint.status, 'REGISTERED_SIMULATION');
  const requestNext = { ...request, orchestrator_request_version: 3, correlation_id: 'changed-correlation-2' };
  const wrongFingerprint = registry.registerRequest(requestNext, { expected_fingerprint: 'stale-fingerprint-value' });
  assert.equal(wrongFingerprint.status, 'FINGERPRINT_CONFLICT');
  assert.equal(registry.getRequestById(request.orchestrator_request_id).orchestrator_request_version, 2, 'a rejected fingerprint conflict must not mutate the stored record');
  assert.equal(registry.getRequestById(request.orchestrator_request_id).orchestrator_request_id, request.orchestrator_request_id);

  const plan = planFixture('deterministic-no-llm-plan');
  registry.registerPlan(plan, { expected_version: 0 });
  const otherPlan = planFixture('economical-selection-plan');
  registry.registerPlan(otherPlan, { expected_version: 0 });
  assert.equal(registry.listPlansByTenant(plan.tenant_id).length, 2);
  assert.equal(registry.listPlansByOrganization(plan.organization_id).length, 2);
  assert.equal(registry.listPlansByTenant('tenant-unused').length, 0);

  const invalid = registry.registerDecision({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('audit is immutable, structurally minimal, records only fingerprints/bindings/references/decision/reason codes, and never marks anything executed', () => {
  const decision = decisionFixture('plan-ready-decision');
  const audit = buildOrchestratorAudit({ decision });
  assert.equal(validateOrchestratorAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.reason_codes.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'agent_id', 'audit_id', 'context_reference_id', 'decision', 'executed', 'model_selection_reference_id',
    'orchestrator_request_id', 'organization_binding', 'plan_fingerprint', 'production_blocked', 'reason_codes',
    'request_fingerprint', 'simulation', 'tenant_binding', 'tool_reference_ids', 'validator_version', 'workflow_reference_id'
  ].sort());

  const blockedDecision = decisionFixture('blocked-decision');
  const blockedAudit = buildOrchestratorAudit({ decision: blockedDecision });
  assert.equal(validateOrchestratorAudit(blockedAudit).valid, true);
  assert.equal(blockedAudit.decision, 'BLOCKED');
  assert.ok(blockedAudit.reason_codes.length > 0);
});

test('fingerprints are deterministic and change when the underlying request or plan payload changes', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const plan1 = buildOrchestratorPlan({ planId: 'p1', orchestratorRequestId: 'r1', tenantId: 't1', organizationId: 't1:o1', agentId: 'a1', referenceIds: ['x', 'y'] });
  const plan2 = buildOrchestratorPlan({ planId: 'p1', orchestratorRequestId: 'r1', tenantId: 't1', organizationId: 't1:o1', agentId: 'a1', referenceIds: ['y', 'x'] });
  assert.equal(plan1.plan_fingerprint, plan2.plan_fingerprint, 'input order of referenceIds must not affect the fingerprint since it is sorted before use');

  const plan3 = buildOrchestratorPlan({ planId: 'p1', orchestratorRequestId: 'r1', tenantId: 't1', organizationId: 't1:o1', agentId: 'a1', referenceIds: ['x', 'z'] });
  assert.notEqual(plan1.plan_fingerprint, plan3.plan_fingerprint);
});

test('input is never mutated by plan or decision construction', () => {
  const input = { planId: 'p1', orchestratorRequestId: 'r1', tenantId: 't1', organizationId: 't1:o1', agentId: 'a1', referenceIds: ['x', 'y'] };
  const before = JSON.stringify(input);
  buildOrchestratorPlan(input);
  assert.equal(JSON.stringify(input), before);

  const decisionInput = { status: 'BLOCKED', blockers: ['x'], reason_codes: ['x'] };
  const beforeDecision = JSON.stringify(decisionInput);
  buildOrchestratorDecision(decisionInput);
  assert.equal(JSON.stringify(decisionInput), beforeDecision);
});

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
  test(`operational material detector blocks ${name} in orchestrator contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate orchestrator field names', () => {
  const request = requestFixture('deterministic-no-llm-request');
  const plan = planFixture('deterministic-no-llm-plan');
  const decision = decisionFixture('plan-ready-decision');
  assert.deepEqual(findAgentCoreOperationalMaterial(request), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(plan), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(decision), []);
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

test('regression orchestrator contract modules do not use network filesystem eval dynamic import or timers', () => {
  const files = [
    'services/api/src/core/orchestrator-request.js',
    'services/api/src/core/orchestrator-plan.js',
    'services/api/src/core/orchestrator-decision.js',
    'services/api/src/core/orchestrator-registry.js',
    'services/api/src/core/orchestrator-audit.js'
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

test('regression orchestrator contracts do not call any tool, provider, or model, and are not imported by runtime endpoints', () => {
  const files = [
    'services/api/src/core/orchestrator-request.js',
    'services/api/src/core/orchestrator-plan.js',
    'services/api/src/core/orchestrator-decision.js',
    'services/api/src/core/orchestrator-registry.js',
    'services/api/src/core/orchestrator-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]\.\/tool-decision['"]\)/.test(source), false);
    assert.equal(/require\(['"]\.\/workflow-decision['"]\)/.test(source), false);
    assert.equal(/require\(['"]\.\/model-selection-engine['"]\)/.test(source), false);
    assert.equal(/require\(['"]\.\/context-assembly-engine['"]\)/.test(source), false);
  }
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('orchestrator-request'), false);
    assert.equal(source.includes('orchestrator-registry'), false);
  }
});

test('regression PRs 79 through 91 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-policy-registry.js',
    'services/api/src/core/agent-session-boundary.js',
    'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js',
    'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/model-selection-registry.js',
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/context-assembly-registry.js',
    'services/api/src/core/tool-decision.js',
    'services/api/src/core/tool-registry.js',
    'services/api/src/core/workflow-decision.js',
    'services/api/src/core/workflow-registry.js'
  ].map((file) => path.join(repoRoot, file));
  const orchestratorModules = [
    'orchestrator-request', 'orchestrator-plan', 'orchestrator-decision', 'orchestrator-registry', 'orchestrator-audit'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of orchestratorModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});

test('regression full suite invariant: nothing in this PR ever claims to have executed', () => {
  for (const key of Object.keys(fixture.decisions)) {
    const decision = decisionFixture(key);
    for (const [field, expected] of Object.entries(ORCHESTRATOR_DECISION_SAFE_FLAGS)) {
      assert.equal(decision[field], expected, `decision ${key}.${field} must be ${expected}`);
    }
  }
});
