'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-tool-contracts.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  FORBIDDEN_TOOL_STATUSES,
  TOOL_CATEGORIES,
  TOOL_CONTRACT_VALIDATOR_VERSION,
  TOOL_STATUSES,
  validateToolContract
} = require('../src/core/tool-contract');
const {
  MAX_CAPABILITIES,
  TOOL_CAPABILITIES,
  TOOL_CAPABILITY_CONTRACT_VALIDATOR_VERSION,
  validateToolCapabilityContract
} = require('../src/core/tool-capability-contract');
const {
  PERMISSION_BOOLEAN_FIELDS,
  TOOL_PERMISSION_CONTRACT_VALIDATOR_VERSION,
  validateToolPermissionContract
} = require('../src/core/tool-permission-contract');
const { TOOL_COST_CONTRACT_VALIDATOR_VERSION, TOOL_COST_TIERS, validateToolCostContract } = require('../src/core/tool-cost-contract');
const {
  TOOL_SIDE_EFFECTS,
  TOOL_SIDE_EFFECTS_CONTRACT_VALIDATOR_VERSION,
  validateToolSideEffectsContract
} = require('../src/core/tool-side-effects-contract');
const {
  DECISION_STATUSES,
  DECISION_VALUES,
  TOOL_DECISION_SAFE_FLAGS,
  buildToolDecision,
  validateToolDecision
} = require('../src/core/tool-decision');
const { createToolRegistry } = require('../src/core/tool-registry');
const { buildToolAudit, validateToolAudit } = require('../src/core/tool-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenario(id) {
  const found = fixture.scenarios.find((entry) => entry.scenario_id === id);
  return clone(found);
}

function partsFromScenario(s) {
  return {
    tool: s.tool,
    capabilitySet: s.capability_set,
    permissionSet: s.permission_set,
    costReference: s.cost_reference,
    sideEffectReference: s.side_effect_reference
  };
}

test('fixture and docs exist, cover all 11 tool categories, and every sub-contract is free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_TOOL_CONTRACTS.md')), true);
  const categoriesCovered = new Set(fixture.scenarios.map((s) => s.tool.category).filter(Boolean));
  for (const category of TOOL_CATEGORIES) {
    assert.ok(categoriesCovered.has(category), `fixture must cover category ${category}`);
  }
  for (const s of fixture.scenarios) {
    for (const key of ['tool', 'capability_set', 'permission_set', 'cost_reference', 'side_effect_reference']) {
      assert.deepEqual(findAgentCoreOperationalMaterial(s[key]), [], `scenario ${s.scenario_id}.${key} must be free of operational material`);
    }
  }
});

fixture.scenarios.forEach((s) => {
  test(`fixture scenario ${s.scenario_id} reproduces its expected status and decision`, () => {
    const decision = buildToolDecision({ decisionId: `${s.scenario_id}-decision`, ...partsFromScenario(s) });
    assert.equal(decision.status, s.expected_status);
    assert.equal(decision.decision, s.expected_decision);
  });
});

test('tool contract valid, rejects unknown category/status, exact fields, and tenant/organization compatibility', () => {
  const tool = scenario('valid-tool-http').tool;
  assert.equal(validateToolContract(tool).valid, true);
  const missing = clone(tool);
  delete missing.category;
  assert.ok(validateToolContract(missing).errors.some((e) => e.includes('missing_category')));
  assert.ok(validateToolContract({ ...tool, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateToolContract({ ...tool, category: 'NOT_A_CATEGORY' }).errors.some((e) => e.includes('category_not_allowed')));
  assert.ok(validateToolContract({ ...tool, tool_status: 'NOT_A_STATUS' }).errors.some((e) => e.includes('tool_status_not_allowed')));
  for (const forbidden of FORBIDDEN_TOOL_STATUSES) {
    assert.ok(validateToolContract({ ...tool, tool_status: forbidden }).errors.includes(`tool_status_forbidden::${forbidden}`));
  }
  assert.ok(validateToolContract({ ...tool, organization_id: 'other-tenant:org-1' }).errors.includes('organization_id_not_compatible_with_tenant'));
  assert.ok(validateToolContract({ ...tool, simulation: false }).errors.includes('simulation_must_be_true'));
  assert.ok(validateToolContract({ ...tool, production_blocked: false }).errors.includes('production_blocked_must_be_true'));
  assert.equal(TOOL_CATEGORIES.length, 11);
  assert.equal(TOOL_STATUSES.length, 4);
  assert.equal(tool.validator_version, TOOL_CONTRACT_VALIDATOR_VERSION);
});

test('capability contract valid, rejects unknown/duplicate/unsorted/empty capability lists', () => {
  const capabilitySet = scenario('valid-tool-http').capability_set;
  assert.equal(validateToolCapabilityContract(capabilitySet).valid, true);
  assert.ok(validateToolCapabilityContract({ ...capabilitySet, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateToolCapabilityContract({ ...capabilitySet, capabilities: ['NOT_A_CAPABILITY'] }).errors.some((e) => e.includes('capability_not_allowed')));
  assert.ok(validateToolCapabilityContract({ ...capabilitySet, capabilities: [] }).errors.includes('capabilities_invalid'));
  assert.ok(validateToolCapabilityContract({ ...capabilitySet, capabilities: ['READ_REFERENCE', 'READ_REFERENCE'] }).errors.includes('capabilities_invalid'));
  assert.ok(validateToolCapabilityContract({ ...capabilitySet, capabilities: [...TOOL_CAPABILITIES].reverse() }).errors.includes('capabilities_invalid'));
  assert.equal(TOOL_CAPABILITIES.length, 11);
  assert.equal(MAX_CAPABILITIES, 11);
  assert.equal(capabilitySet.validator_version, TOOL_CAPABILITY_CONTRACT_VALIDATOR_VERSION);
});

test('permission contract valid, rejects non-boolean permission flags, and stays simulation-only', () => {
  const permissionSet = scenario('valid-tool-http').permission_set;
  assert.equal(validateToolPermissionContract(permissionSet).valid, true);
  assert.ok(validateToolPermissionContract({ ...permissionSet, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  for (const field of PERMISSION_BOOLEAN_FIELDS) {
    assert.ok(validateToolPermissionContract({ ...permissionSet, [field]: 'yes' }).errors.includes(`${field}_must_be_boolean`));
  }
  assert.ok(validateToolPermissionContract({ ...permissionSet, simulation: false }).errors.includes('simulation_must_be_true'));
  assert.ok(validateToolPermissionContract({ ...permissionSet, production_blocked: false }).errors.includes('production_blocked_must_be_true'));
  assert.equal(PERMISSION_BOOLEAN_FIELDS.length, 8);
  assert.equal(permissionSet.validator_version, TOOL_PERMISSION_CONTRACT_VALIDATOR_VERSION);
  assert.deepEqual(findAgentCoreOperationalMaterial(permissionSet), []);
});

test('cost contract valid and rejects unknown cost tier', () => {
  const costReference = scenario('valid-tool-http').cost_reference;
  assert.equal(validateToolCostContract(costReference).valid, true);
  assert.ok(validateToolCostContract({ ...costReference, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateToolCostContract({ ...costReference, cost_tier: 'FREE' }).errors.some((e) => e.includes('cost_tier_not_allowed')));
  assert.equal(TOOL_COST_TIERS.length, 6);
  assert.equal(costReference.validator_version, TOOL_COST_CONTRACT_VALIDATOR_VERSION);
});

test('side effect contract valid and rejects unknown side effect', () => {
  const sideEffectReference = scenario('valid-tool-http').side_effect_reference;
  assert.equal(validateToolSideEffectsContract(sideEffectReference).valid, true);
  assert.ok(validateToolSideEffectsContract({ ...sideEffectReference, extra: 1 }).errors.some((e) => e.includes('unexpected_field::extra')));
  assert.ok(validateToolSideEffectsContract({ ...sideEffectReference, side_effect: 'MAYBE' }).errors.some((e) => e.includes('side_effect_not_allowed')));
  assert.equal(TOOL_SIDE_EFFECTS.length, 5);
  assert.equal(sideEffectReference.validator_version, TOOL_SIDE_EFFECTS_CONTRACT_VALIDATOR_VERSION);
});

test('decision aggregates all five sub-contracts, forces every safe flag, and degrades cleanly on malformed input', () => {
  const s = scenario('valid-tool-http');
  const decision = buildToolDecision({ decisionId: 'decision-http-1', ...partsFromScenario(s) });
  assert.equal(validateToolDecision(decision).valid, true);
  assert.equal(decision.status, 'TOOL_REGISTERED_SIMULATION');
  assert.equal(decision.decision, 'REGISTER_TOOL_REFERENCE');
  for (const [field, expected] of Object.entries(TOOL_DECISION_SAFE_FLAGS)) {
    assert.equal(decision[field], expected);
  }
  assert.equal(Object.isFrozen(decision), true);
  assert.throws(() => { decision.status = 'x'; }, TypeError);

  const malformed = buildToolDecision({});
  assert.equal(malformed.status, 'VALIDATION_FAILED');
  assert.equal(malformed.decision, 'BLOCKED');
  assert.equal(validateToolDecision(malformed).valid, true);
  for (const [field, expected] of Object.entries(TOOL_DECISION_SAFE_FLAGS)) {
    assert.equal(malformed[field], expected);
  }
  assert.equal(DECISION_STATUSES.length, 4);
  assert.equal(DECISION_VALUES.includes('BLOCKED'), true);
});

test('tenant mismatch and organization mismatch between sub-contracts block registration with the correct status', () => {
  const tenantMismatch = scenario('tenant-mismatch-tool');
  const tenantDecision = buildToolDecision({ decisionId: 'tenant-mismatch-decision', ...partsFromScenario(tenantMismatch) });
  assert.equal(tenantDecision.status, 'TENANT_BLOCKED');
  assert.equal(tenantDecision.decision, 'BLOCKED');

  const orgMismatch = scenario('organization-mismatch-tool');
  const orgDecision = buildToolDecision({ decisionId: 'org-mismatch-decision', ...partsFromScenario(orgMismatch) });
  assert.equal(orgDecision.status, 'ORGANIZATION_BLOCKED');
  assert.equal(orgDecision.decision, 'BLOCKED');
});

test('registry validates by construction, protects against replay, payload mismatch, optimistic concurrency, organization rebinding, and lists safely', () => {
  const registry = createToolRegistry();
  const tool = scenario('valid-tool-http').tool;

  const first = registry.registerTool(tool, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);

  assert.equal(registry.registerTool(tool).status, 'REPLAY_ACCEPTED');

  const mismatch = { ...tool, display_name: 'Changed Display Name' };
  assert.equal(registry.registerTool(mismatch).status, 'PAYLOAD_MISMATCH');

  const bumped = { ...tool, display_name: 'Changed Display Name', tool_version: tool.tool_version + 1 };
  assert.equal(registry.registerTool(bumped).status, 'REGISTERED_SIMULATION');

  const versionConflict = registry.registerTool(
    { ...tool, display_name: 'Changed Again', tool_version: tool.tool_version + 2 },
    { expected_version: 999 }
  );
  assert.equal(versionConflict.status, 'VERSION_CONFLICT');

  const orgRebind = registry.registerTool({ ...tool, organization_id: `${tool.tenant_id}:org-different`, tool_version: tool.tool_version + 2 });
  assert.equal(orgRebind.status, 'ORGANIZATION_BLOCKED');

  const tenantRebind = registry.registerTool({ ...tool, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1', tool_version: tool.tool_version + 2 });
  assert.equal(tenantRebind.status, 'TENANT_BLOCKED');

  const fetched = registry.getToolById(tool.tool_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.display_name = 'x'; }, TypeError);
  assert.equal(registry.getToolById('unknown-tool-id'), null);

  const other = scenario('valid-tool-database').tool;
  registry.registerTool(other, { expected_version: 0 });
  assert.equal(registry.listToolsByTenant(tool.tenant_id).length, 2);
  assert.equal(registry.listToolsByOrganization(tool.organization_id).length, 2);
  assert.equal(registry.listToolsByTenant('tenant-unused').length, 0);

  const invalid = registry.registerTool({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');

  const decision = buildToolDecision({ decisionId: 'registry-decision-1', ...partsFromScenario(scenario('valid-tool-http')) });
  assert.equal(registry.registerDecision(decision, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerDecision(decision).status, 'REPLAY_ACCEPTED');
});

test('registry rejects duplicate ids with conflicting payloads and duplicate fingerprints replay identically', () => {
  const registry = createToolRegistry();
  const tool = scenario('valid-tool-http').tool;
  registry.registerTool(tool, { expected_version: 0 });
  const duplicateIdDifferentPayload = registry.registerTool({ ...tool, description: 'A different description entirely.' });
  assert.equal(duplicateIdDifferentPayload.status, 'PAYLOAD_MISMATCH');
  const duplicateFingerprint = registry.registerTool({ ...tool });
  assert.equal(duplicateFingerprint.status, 'REPLAY_ACCEPTED');
});

test('audit is immutable, structurally minimal, records only fingerprints/bindings/decision, and never marks anything executed', () => {
  const s = scenario('valid-tool-http');
  const decision = buildToolDecision({ decisionId: 'audit-decision-1', ...partsFromScenario(s) });
  const audit = buildToolAudit({ decision });
  assert.equal(validateToolAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'audit_id', 'blockers', 'capability_fingerprint', 'cost_fingerprint', 'decision', 'executed',
    'organization_binding', 'permission_fingerprint', 'production_blocked', 'reason_codes',
    'side_effect_fingerprint', 'simulation', 'tenant_binding', 'tool_fingerprint', 'tool_id', 'validator_version'
  ].sort());

  const blockedDecision = buildToolDecision({ decisionId: 'audit-decision-blocked', ...partsFromScenario(scenario('tenant-mismatch-tool')) });
  const blockedAudit = buildToolAudit({ decision: blockedDecision });
  assert.equal(validateToolAudit(blockedAudit).valid, true);
  assert.equal(blockedAudit.decision, 'TENANT_BLOCKED');
  assert.ok(blockedAudit.blockers.length > 0);
});

test('fingerprints are deterministic and change when the underlying sub-contract payload changes', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const s = scenario('valid-tool-http');
  const decision1 = buildToolDecision({ decisionId: 'fp-decision-1', ...partsFromScenario(s) });
  const decision2 = buildToolDecision({ decisionId: 'fp-decision-1', ...partsFromScenario(clone(s)) });
  assert.equal(decision1.tool_fingerprint, decision2.tool_fingerprint);
  assert.equal(decision1.capability_fingerprint, decision2.capability_fingerprint);

  const changed = clone(s);
  changed.tool.display_name = 'A Renamed Tool';
  const decision3 = buildToolDecision({ decisionId: 'fp-decision-1', ...partsFromScenario(changed) });
  assert.notEqual(decision1.tool_fingerprint, decision3.tool_fingerprint);
});

test('input is never mutated by decision construction', () => {
  const s = scenario('valid-tool-http');
  const parts = partsFromScenario(s);
  const before = JSON.stringify(parts);
  buildToolDecision({ decisionId: 'no-mutate-decision', ...parts });
  assert.equal(JSON.stringify(parts), before);
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
  test(`operational material detector blocks ${name} in tool contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate tool field names, including requires_secret/filesystem/runtime', () => {
  const s = scenario('valid-tool-file-store');
  assert.deepEqual(findAgentCoreOperationalMaterial(s.tool), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.capability_set), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.permission_set), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.cost_reference), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(s.side_effect_reference), []);
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

test('regression tool contract modules do not use network filesystem eval dynamic import or timers', () => {
  const files = [
    'services/api/src/core/tool-contract.js',
    'services/api/src/core/tool-capability-contract.js',
    'services/api/src/core/tool-permission-contract.js',
    'services/api/src/core/tool-cost-contract.js',
    'services/api/src/core/tool-side-effects-contract.js',
    'services/api/src/core/tool-decision.js',
    'services/api/src/core/tool-registry.js',
    'services/api/src/core/tool-audit.js'
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

test('regression tool contracts are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('tool-contract'), false);
    assert.equal(source.includes('tool-registry'), false);
  }
});

test('regression PRs 79 through 87 remain untouched by this PR', () => {
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
    'services/api/src/core/transcription-network-permission-boundary.js',
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/context-assembly-registry.js'
  ].map((file) => path.join(repoRoot, file));
  const toolModules = [
    'tool-contract', 'tool-capability-contract', 'tool-permission-contract', 'tool-cost-contract',
    'tool-side-effects-contract', 'tool-decision', 'tool-registry', 'tool-audit'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of toolModules) {
      assert.equal(source.includes(moduleName), false);
    }
  }
});

test('regression context assembly engine and transcription boundaries remain functionally independent from tool contracts', () => {
  const files = [
    'services/api/src/core/context-assembly-engine.js',
    'services/api/src/core/transcription-network-permission-boundary.js',
    'services/api/src/core/transcription-secret-resolution-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('tool-contract'), false);
    assert.equal(source.includes('tool-registry'), false);
  }
});
