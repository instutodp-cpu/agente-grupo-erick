'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const coreDir = path.resolve(__dirname, '../src/core');

function coreFiles(pattern) {
  return fs.readdirSync(coreDir)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(coreDir, name));
}

function localRequires(source) {
  const matches = [...source.matchAll(/require\(['"]\.\/([a-zA-Z0-9_-]+)['"]\)/g)];
  return matches.map((match) => `${match[1]}.js`);
}

const CONTRACT_FILE_PATTERN = /^(agent|model)-.*(contract|reference|scope|request|constraints|task-profile|candidate)\.js$/;
const ENGINE_OR_REGISTRY_PATTERN = /(registry|engine|boundary)\.js$/;
const DECISION_OR_EVALUATOR_NAME = /^(evaluate|validate|build)/;

test('architecture: no contract file imports an engine, registry, or boundary file', () => {
  const contractFiles = coreFiles(CONTRACT_FILE_PATTERN).filter((file) => !ENGINE_OR_REGISTRY_PATTERN.test(path.basename(file)));
  const violations = [];
  for (const file of contractFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const required of localRequires(source)) {
      if (ENGINE_OR_REGISTRY_PATTERN.test(required)) {
        violations.push(`${path.basename(file)} -> ${required}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('architecture: no circular require chains among agent-*/model-* core modules', () => {
  const files = [
    ...coreFiles(/^agent-.*\.js$/),
    ...coreFiles(/^model-.*\.js$/)
  ];
  const graph = new Map();
  for (const file of files) {
    const name = path.basename(file);
    const source = fs.readFileSync(file, 'utf8');
    graph.set(name, localRequires(source).filter((dep) => graph !== null && files.some((f) => path.basename(f) === dep)));
  }
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function visit(node, trail) {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      cycles.push([...trail, node].join(' -> '));
      return;
    }
    visiting.add(node);
    for (const dep of graph.get(node) || []) {
      if (graph.has(dep)) visit(dep, [...trail, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) visit(node, []);
  assert.deepEqual(cycles, []);
});

test('architecture: forbidden runtime APIs are absent from every agent-*/model-* core module', () => {
  const files = [...coreFiles(/^agent-.*\.js$/), ...coreFiles(/^model-.*\.js$/)];
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const checks = [
      [/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/, 'forbidden node: import'],
      [/\bfetch\(/, 'fetch('],
      [/process\.env/, 'process.env'],
      [/Date\.now\(\)/, 'Date.now()'],
      [/\bnew Date\(\)/, 'new Date()'],
      [/setTimeout|setInterval/, 'timers'],
      [/\beval\(/, 'eval('],
      [/\bnew Function\(/, 'new Function('],
      [/\bimport\(/, 'dynamic import(']
    ];
    for (const [pattern, label] of checks) {
      if (pattern.test(source)) offenders.push(`${path.basename(file)}: ${label}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('architecture: every decision builder forces its safe flags regardless of caller overrides', () => {
  const cases = [
    {
      module: '../src/core/agent-policy-decision.js',
      build: 'buildAgentPolicyDecision',
      safeFlags: 'AGENT_POLICY_DECISION_SAFE_FLAGS',
      overrides: { policy_request_id: 'r1', agent_id: 'a1', tenant_id: 't1', organization_id: 't1:o1', status: 'ALLOW_SIMULATION', effect: 'ALLOW_SIMULATION' }
    },
    {
      module: '../src/core/agent-session-decision.js',
      build: 'buildAgentSessionDecision',
      safeFlags: 'AGENT_SESSION_DECISION_SAFE_FLAGS'
    },
    {
      module: '../src/core/agent-memory-decision.js',
      build: 'buildAgentMemoryDecision',
      safeFlags: 'AGENT_MEMORY_DECISION_SAFE_FLAGS'
    },
    {
      module: '../src/core/model-provider-decision.js',
      build: 'buildModelProviderDecision',
      safeFlags: 'MODEL_PROVIDER_DECISION_SAFE_FLAGS'
    },
    {
      module: '../src/core/model-selection-decision.js',
      build: 'buildModelSelectionDecision',
      safeFlags: 'MODEL_SELECTION_DECISION_SAFE_FLAGS'
    }
  ];

  const forbiddenOverride = {
    simulation: false,
    production_blocked: false,
    runtime_enabled: true,
    executed: true,
    provider_called: true,
    model_called: true,
    network_used: true,
    tokens_consumed: true,
    cost_consumed: true,
    memory_read: true,
    memory_written: true,
    tool_called: true,
    fallback_executed: true,
    escalation_executed: true
  };

  for (const testCase of cases) {
    const mod = require(testCase.module);
    if (typeof mod[testCase.build] !== 'function' || !mod[testCase.safeFlags]) continue;
    const attempted = { ...(testCase.overrides || {}), ...forbiddenOverride };
    const decision = mod[testCase.build](attempted);
    for (const [flag, expected] of Object.entries(mod[testCase.safeFlags])) {
      assert.equal(decision[flag], expected, `${testCase.module}: ${flag} was not forced to ${expected}`);
    }
    assert.equal(Object.isFrozen(decision), true, `${testCase.module}: decision must be frozen`);
  }
});

test('architecture: expected exports are present on every PR79-84 registry factory', () => {
  const registries = [
    ['../src/core/agent-registry.js', 'createAgentRegistry'],
    ['../src/core/agent-policy-registry.js', 'createAgentPolicyRegistry'],
    ['../src/core/agent-session-registry.js', 'createAgentSessionRegistry'],
    ['../src/core/agent-memory-registry.js', 'createAgentMemoryRegistry'],
    ['../src/core/model-provider-registry.js', 'createModelProviderRegistry'],
    ['../src/core/model-selection-registry.js', 'createModelSelectionRegistry']
  ];
  for (const [modulePath, factoryName] of registries) {
    const mod = require(modulePath);
    assert.equal(typeof mod[factoryName], 'function', `${modulePath} must export ${factoryName}`);
    const registry = mod[factoryName]();
    assert.equal(typeof registry, 'object');
    assert.equal(Object.isFrozen(registry), true, `${modulePath}: registry instance must be frozen`);
  }
});

test('architecture: registries do not share module-level state across instances', () => {
  const { createModelSelectionRegistry } = require('../src/core/model-selection-registry');
  const { MODEL_SELECTION_TASK_PROFILE_VALIDATOR_VERSION } = require('../src/core/model-selection-task-profile');
  const taskProfile = {
    task_profile_id: 'isolation-check', task_profile_version: 1, agent_id: 'a1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    task_type: 'REASONING_REFERENCE', complexity_tier: 'TIER_3_MODERATE', risk_classification: 'LOW', data_classification: 'INTERNAL',
    required_capabilities: [], required_modalities: [], minimum_quality_tier: 'STANDARD', maximum_latency_tier: 'MODERATE',
    estimated_input_tokens: 0, estimated_output_tokens: 0, estimated_total_tokens: 0, requires_structured_output: false,
    requires_tool_calling: false, requires_long_context: false, requires_multilingual: false, deterministic_resolution_available: false,
    deterministic_resolution_reference: null, human_review_required: false, logical_sequence: 1,
    validator_version: MODEL_SELECTION_TASK_PROFILE_VALIDATOR_VERSION
  };
  const registryA = createModelSelectionRegistry();
  const registryB = createModelSelectionRegistry();
  assert.equal(registryA.registerTaskProfile(taskProfile, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  assert.equal(registryB.getTaskProfileById('isolation-check'), null, 'a fresh registry instance must not see records registered on another instance');
});

test('regression: operational material detector now catches camelCase, PascalCase, and glued key bypasses (AUDIT-001, fixed)', () => {
  const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
  assert.ok(findAgentCoreOperationalMaterial({ apiKeyValue: 'x' }).some((entry) => entry.startsWith('forbidden_key')));
  assert.ok(findAgentCoreOperationalMaterial({ ApiKeyValue: 'x' }).some((entry) => entry.startsWith('forbidden_key')));
  assert.ok(findAgentCoreOperationalMaterial({ myapikey: 'x' }).some((entry) => entry.startsWith('forbidden_key')));
  assert.ok(findAgentCoreOperationalMaterial({ api_key_value: 'x' }).some((entry) => entry.startsWith('forbidden_key')));
  assert.ok(findAgentCoreOperationalMaterial({ 'api-key-value': 'x' }).some((entry) => entry.startsWith('forbidden_key')));
  assert.ok(findAgentCoreOperationalMaterial({ api_key: 'x' }).some((entry) => entry.startsWith('forbidden_key')));
  // Cyrillic homoglyph and zero-width obfuscation in free-text values are now normalized before matching.
  assert.ok(findAgentCoreOperationalMaterial({ note: 'the sеcret value' }).some((entry) => entry.startsWith('forbidden_word_value')));
  // Known collision-prone field names must remain unaffected (no new false positives).
  assert.deepEqual(findAgentCoreOperationalMaterial({ transport_binding_valid: true }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ executed: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ fallback_executed: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ escalation_executed: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ selection_executed: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ model_id: 'hermes-neo-x-ref' }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ provider_id: 'hermes-svc-ref' }), []);
});

test('characterization: operational material detector does not scan Map/Set/RegExp/Error contents (AUDIT-008)', () => {
  const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
  assert.deepEqual(findAgentCoreOperationalMaterial({ note: new Map([['api_key', 'secret-value']]) }), []);
  assert.equal(stablePayload({ a: new Map([['x', 1]]) }), stablePayload({ a: {} }), 'Map and empty object currently fingerprint identically');
});

test('regression: model-selection-ranking now rejects duplicate candidate_id values (AUDIT-003, fixed)', () => {
  const { buildModelSelectionRanking } = require('../src/core/model-selection-ranking');
  const base = {
    candidate_id: 'dup-1', model_id: 'entry-dup', cost_tier: 'LOW', estimated_cost_minor_units: 100, quality_tier: 'STANDARD',
    privacy_tier: 'NO_TRAINING_REFERENCE', latency_tier: 'LOW', availability_status: 'AVAILABLE_REFERENCE', health_status: 'HEALTHY_REFERENCE',
    local_reference: false, supported_capabilities: [], candidate_status: 'ELIGIBLE_SIMULATION'
  };
  assert.throws(
    () => buildModelSelectionRanking('ranking-dup', 'selection-request-dup', [base, { ...base }], { maximum_fallbacks: 1, maximum_escalations: 0 }),
    /model_selection_ranking_duplicate_candidate_id::dup-1/
  );
});

test('regression: model-selection-candidate now cross-checks cost_tier against estimated_cost_minor_units (AUDIT-004, fixed)', () => {
  const { MODEL_SELECTION_CANDIDATE_VALIDATOR_VERSION, validateModelSelectionCandidate } = require('../src/core/model-selection-candidate');
  const inconsistentCandidate = {
    candidate_id: 'entry-inconsistent', candidate_version: 1, provider_id: 'hermes-svc-ref', model_id: 'entry-inconsistent',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', provider_fingerprint: 'fp-svc', model_fingerprint: 'fp-entry',
    capability_fingerprints: [], pricing_fingerprint: 'fp-price', limits_fingerprint: 'fp-limits', availability_fingerprint: 'fp-avail',
    privacy_fingerprint: 'fp-privacy', health_fingerprint: 'fp-health', quality_tier: 'STANDARD', cost_tier: 'ZERO_COST_REFERENCE',
    latency_tier: 'LOW', privacy_tier: 'NO_TRAINING_REFERENCE', supported_capabilities: [], supported_modalities: [],
    context_window_tokens: 8192, maximum_input_tokens: 4096, maximum_output_tokens: 4096, estimated_cost_minor_units: 5000,
    availability_status: 'AVAILABLE_REFERENCE', health_status: 'HEALTHY_REFERENCE', local_reference: false, zero_cost_reference: false,
    candidate_status: 'PENDING_EVALUATION', validator_version: MODEL_SELECTION_CANDIDATE_VALIDATOR_VERSION
  };
  const validation = validateModelSelectionCandidate(inconsistentCandidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('cost_tier_inconsistent_with_estimated_cost::ZERO_COST_REFERENCE'));
});

test('architecture: registries independently re-validate and reject hand-crafted unsafe records bypassing the decision builder', () => {
  const { createModelSelectionRegistry } = require('../src/core/model-selection-registry');
  const registry = createModelSelectionRegistry();
  const maliciousDecision = {
    decision_id: 'malicious-1', selection_request_id: 'r1', agent_id: 'a1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    status: 'MODEL_SELECTED_SIMULATION', decision: 'SELECT_MODEL_REFERENCE', selected_candidate_id: 'c1', selected_provider_id: 'svc-1',
    selected_model_id: 'entry-1', selected_cost_tier: 'LOW', estimated_cost_minor_units: 100, deterministic_resolution_selected: false,
    fallback_plan_present: false, escalation_plan_present: false, candidate_count: 1, eligible_candidate_count: 1, ineligible_candidate_count: 0,
    request_fingerprint: 'fp1', task_profile_fingerprint: 'fp2', constraints_fingerprint: 'fp3', ranking_fingerprint: 'fp4',
    selected_candidate_fingerprint: 'fp5', registry_version: 'v1', blockers: [], reason_codes: ['x'], selection_evaluated: true,
    model_selected_in_simulation: true, provider_called: true, model_called: true, network_used: true, tokens_consumed: true,
    cost_consumed: true, fallback_executed: false, escalation_executed: false, executed: true, runtime_enabled: true,
    simulation: false, production_blocked: false, rollout_percentage: 0, validator_version: 'model_selection_decision_validator_v1'
  };
  const outcome = registry.registerDecision(maliciousDecision, { expected_version: 0 });
  assert.equal(outcome.status, 'VALIDATION_FAILED');
  assert.equal(outcome.ok, false);
  assert.equal(registry.getDecisionById('malicious-1'), null);
});
