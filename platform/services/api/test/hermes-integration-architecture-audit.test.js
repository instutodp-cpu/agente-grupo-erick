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

const IN_SCOPE_PATTERN = /^(agent|model|context-assembly|tool|workflow)-.*\.js$/;
const CONTRACT_NAME_PATTERN = /^(agent|model|context-assembly|tool|workflow)-.*(contract|reference|scope|request|constraints|task-profile|candidate|condition|dependency)\.js$/;
const ENGINE_OR_REGISTRY_PATTERN = /(registry|engine|boundary)\.js$/;

test('architecture: no PR79-89 contract file imports an engine, registry, or boundary file', () => {
  const contractFiles = coreFiles(CONTRACT_NAME_PATTERN).filter((file) => !ENGINE_OR_REGISTRY_PATTERN.test(path.basename(file)));
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

test('architecture: no circular require chains across the full PR79-89 in-scope module set', () => {
  const files = coreFiles(IN_SCOPE_PATTERN);
  const graph = new Map();
  for (const file of files) {
    const name = path.basename(file);
    const source = fs.readFileSync(file, 'utf8');
    graph.set(name, localRequires(source));
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

test('architecture: forbidden runtime APIs are absent from every PR79-89 core module', () => {
  const files = coreFiles(IN_SCOPE_PATTERN);
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

test('architecture: Context Assembly Engine does not import Model Selection Engine, Tool Contracts, or Workflow Contracts', () => {
  const source = fs.readFileSync(path.join(coreDir, 'context-assembly-engine.js'), 'utf8');
  const required = localRequires(source);
  assert.deepEqual(required.filter((r) => /^model-selection-engine|^tool-|^workflow-/.test(r)), []);
});

test('architecture: Model Selection Engine does not import Context Assembly, Tool Contracts, or Workflow Contracts', () => {
  const files = coreFiles(/^model-selection-.*\.js$/);
  const violations = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const required of localRequires(source)) {
      if (/^context-assembly-|^tool-|^workflow-/.test(required)) violations.push(`${path.basename(file)} -> ${required}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('architecture: Tool Contracts do not import Workflow Contracts (Tool predates and must not depend on Workflow)', () => {
  const files = coreFiles(/^tool-.*\.js$/);
  const violations = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const required of localRequires(source)) {
      if (/^workflow-/.test(required)) violations.push(`${path.basename(file)} -> ${required}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('architecture: no in-scope module imports a nonexistent Agent Orchestrator module', () => {
  const files = coreFiles(IN_SCOPE_PATTERN);
  const violations = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const required of localRequires(source)) {
      if (/orchestrat/i.test(required)) violations.push(`${path.basename(file)} -> ${required}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('architecture: every decision/result builder across PR79-89 forces its safe flags regardless of caller overrides', () => {
  const forbiddenOverride = {
    simulation: false,
    production_blocked: false,
    runtime_enabled: true,
    executed: true,
    agent_executed: true,
    workflow_executed: true,
    step_executed: true,
    tool_called: true,
    provider_called: true,
    model_called: true,
    network_used: true,
    memory_read: true,
    memory_written: true,
    history_loaded: true,
    content_loaded: true,
    context_assembled: true,
    document_loaded: true,
    tool_result_loaded: true,
    prompt_generated: true,
    tokens_consumed: true,
    cost_consumed: true,
    fallback_executed: true,
    escalation_executed: true,
    rollout_percentage: 100
  };

  const cases = [
    { module: '../src/core/agent-policy-decision.js', build: 'buildAgentPolicyDecision', safeFlags: 'AGENT_POLICY_DECISION_SAFE_FLAGS' },
    { module: '../src/core/agent-session-decision.js', build: 'buildAgentSessionDecision', safeFlags: 'AGENT_SESSION_DECISION_SAFE_FLAGS' },
    { module: '../src/core/agent-memory-decision.js', build: 'buildAgentMemoryDecision', safeFlags: 'AGENT_MEMORY_DECISION_SAFE_FLAGS' },
    { module: '../src/core/model-provider-decision.js', build: 'buildModelProviderDecision', safeFlags: 'MODEL_PROVIDER_DECISION_SAFE_FLAGS' },
    { module: '../src/core/model-selection-decision.js', build: 'buildModelSelectionDecision', safeFlags: 'MODEL_SELECTION_DECISION_SAFE_FLAGS' },
    { module: '../src/core/context-assembly-result.js', build: 'buildContextAssemblyResult', safeFlags: 'CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS' },
    { module: '../src/core/tool-decision.js', build: 'buildToolDecision', safeFlags: 'TOOL_DECISION_SAFE_FLAGS' },
    { module: '../src/core/workflow-decision.js', build: 'buildWorkflowDecision', safeFlags: 'WORKFLOW_DECISION_SAFE_FLAGS' }
  ];

  for (const testCase of cases) {
    const mod = require(testCase.module);
    if (typeof mod[testCase.build] !== 'function' || !mod[testCase.safeFlags]) continue;
    const decision = mod[testCase.build](forbiddenOverride);
    for (const [flag, expected] of Object.entries(mod[testCase.safeFlags])) {
      assert.equal(decision[flag], expected, `${testCase.module}: ${flag} was not forced to ${expected}`);
    }
    assert.equal(Object.isFrozen(decision), true, `${testCase.module}: decision must be frozen`);
  }
});

test('architecture: every audit builder across PR79-89 hardcodes simulation=true, production_blocked=true, executed=false unreachably', () => {
  const auditModules = [
    ['../src/core/agent-core-audit.js', ['buildAgentCoreAudit', 'buildAgentAudit', 'buildCoreAudit']],
    ['../src/core/agent-policy-audit.js', ['buildAgentPolicyAudit']],
    ['../src/core/agent-session-audit.js', ['buildAgentSessionAudit']],
    ['../src/core/agent-memory-audit.js', ['buildAgentMemoryAudit']],
    ['../src/core/model-provider-audit.js', ['buildModelProviderAudit']],
    ['../src/core/model-selection-audit.js', ['buildModelSelectionAudit']],
    ['../src/core/context-assembly-audit.js', ['buildContextAssemblyAudit']],
    ['../src/core/tool-audit.js', ['buildToolAudit']],
    ['../src/core/workflow-audit.js', ['buildWorkflowAudit']]
  ];
  let checked = 0;
  for (const [modulePath, candidateNames] of auditModules) {
    const mod = require(modulePath);
    const buildName = candidateNames.find((name) => typeof mod[name] === 'function');
    if (!buildName) continue;
    const audit = mod[buildName]({});
    if (!('simulation' in audit)) continue;
    assert.equal(audit.simulation, true, `${modulePath}: simulation must be true`);
    assert.equal(audit.production_blocked, true, `${modulePath}: production_blocked must be true`);
    assert.equal(audit.executed, false, `${modulePath}: executed must be false`);
    assert.equal(Object.isFrozen(audit), true, `${modulePath}: audit must be frozen`);
    checked += 1;
  }
  assert.ok(checked >= 7, `expected to check at least 7 audit builders, checked ${checked}`);
});

test('architecture: expected factory exports are present and frozen on every PR79-89 registry', () => {
  const registries = [
    ['../src/core/agent-registry.js', 'createAgentRegistry'],
    ['../src/core/agent-policy-registry.js', 'createAgentPolicyRegistry'],
    ['../src/core/agent-session-registry.js', 'createAgentSessionRegistry'],
    ['../src/core/agent-memory-registry.js', 'createAgentMemoryRegistry'],
    ['../src/core/model-provider-registry.js', 'createModelProviderRegistry'],
    ['../src/core/model-selection-registry.js', 'createModelSelectionRegistry'],
    ['../src/core/context-assembly-registry.js', 'createContextAssemblyRegistry'],
    ['../src/core/tool-registry.js', 'createToolRegistry'],
    ['../src/core/workflow-registry.js', 'createWorkflowRegistry']
  ];
  for (const [modulePath, factoryName] of registries) {
    const mod = require(modulePath);
    assert.equal(typeof mod[factoryName], 'function', `${modulePath} must export ${factoryName}`);
    const registry = mod[factoryName]();
    assert.equal(typeof registry, 'object');
    assert.equal(Object.isFrozen(registry), true, `${modulePath}: registry instance must be frozen`);
  }
});

test('architecture: registries do not share module-level state across instances (spot check newest three)', () => {
  const { createContextAssemblyRegistry } = require('../src/core/context-assembly-registry');
  const { createToolRegistry } = require('../src/core/tool-registry');
  const { createWorkflowRegistry } = require('../src/core/workflow-registry');
  const fixture = require('./fixtures/hermes-tool-contracts.json');
  const tool = JSON.parse(JSON.stringify(fixture.scenarios.find((s) => s.scenario_id === 'valid-tool-http').tool));

  const toolRegistryA = createToolRegistry();
  const toolRegistryB = createToolRegistry();
  assert.equal(toolRegistryA.registerTool(tool, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  assert.equal(toolRegistryB.getToolById(tool.tool_id), null, 'a fresh tool registry instance must not see records registered on another instance');

  assert.notEqual(createContextAssemblyRegistry(), createContextAssemblyRegistry());
  assert.notEqual(createWorkflowRegistry(), createWorkflowRegistry());
});

test('architecture: registries independently re-validate and reject hand-crafted unsafe records bypassing the decision builder', () => {
  const { createToolRegistry } = require('../src/core/tool-registry');
  const registry = createToolRegistry();
  const maliciousDecision = {
    decision_id: 'malicious-1', tool_id: 't1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    status: 'TOOL_REGISTERED_SIMULATION', decision: 'REGISTER_TOOL_REFERENCE', tool_fingerprint: 'fp1',
    capability_fingerprint: 'fp2', permission_fingerprint: 'fp3', cost_fingerprint: 'fp4', side_effect_fingerprint: 'fp5',
    category: 'HTTP_REFERENCE', capabilities: ['READ_REFERENCE'], blockers: [], reason_codes: ['x'],
    executed: true, runtime_enabled: true, network_used: true, provider_called: true, tool_called: true,
    simulation: false, production_blocked: false, rollout_percentage: 100, validator_version: 'tool_decision_validator_v1'
  };
  const outcome = registry.registerDecision(maliciousDecision, { expected_version: 0 });
  assert.equal(outcome.status, 'VALIDATION_FAILED');
  assert.equal(outcome.ok, false);
  assert.equal(registry.getDecisionById('malicious-1'), null);
});

// Synthetic end-to-end declarative composition: Agent -> Policy -> Session -> Memory Reference
// -> Model Selection -> Context Assembly -> Tool Reference -> Workflow Reference. Every input is
// injected explicitly from fixtures; no registry is auto-queried anywhere in this chain.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toModelSelectionDecisionReference(msDecision, refId) {
  return {
    decision_reference_id: refId,
    decision_status: msDecision.status,
    decision_value: msDecision.decision,
    selected_provider_id: msDecision.selected_provider_id,
    selected_model_id: msDecision.selected_model_id,
    decision_fingerprint: msDecision.selected_candidate_fingerprint || msDecision.request_fingerprint,
    validator_version: 'context_assembly_request_validator_v1'
  };
}

test('end-to-end: NO_LLM deterministic scenario composes cleanly across model selection, context assembly, tool and workflow with nothing executed', () => {
  const { evaluateModelSelectionRequest } = require('../src/core/model-selection-engine');
  const { evaluateContextAssemblyRequest } = require('../src/core/context-assembly-engine');
  const { buildToolDecision } = require('../src/core/tool-decision');
  const { buildWorkflowDecision } = require('../src/core/workflow-decision');
  const msFixture = require('./fixtures/hermes-model-selection-engine.json');
  const caFixture = require('./fixtures/hermes-context-assembly-engine.json');
  const twFixture = require('./fixtures/hermes-tool-contracts.json');
  const wfFixture = require('./fixtures/hermes-workflow-contracts.json');

  const msScenario = msFixture.scenarios['deterministic-no-llm-selection'];
  const msResult = evaluateModelSelectionRequest(msScenario.request, { candidates: msScenario.candidates });
  assert.equal(msResult.decision.status, 'NO_LLM_SELECTED_SIMULATION');

  const caScenario = clone(caFixture.scenarios.find((s) => s.scenario_id === 'deterministic-no-llm-context'));
  const caResult = evaluateContextAssemblyRequest(caScenario.request);
  assert.equal(caResult.result.status, 'ASSEMBLY_PLANNED_SIMULATION');
  assert.equal(caResult.result.selected_model_reference_id, null);

  const twScenario = clone(twFixture.scenarios.find((s) => s.scenario_id === 'valid-tool-http'));
  const toolDecision = buildToolDecision({
    decisionId: 'e2e-tool-1', tool: twScenario.tool, capabilitySet: twScenario.capability_set,
    permissionSet: twScenario.permission_set, costReference: twScenario.cost_reference, sideEffectReference: twScenario.side_effect_reference
  });
  assert.equal(toolDecision.status, 'TOOL_REGISTERED_SIMULATION');

  const wfScenario = clone(wfFixture.scenarios.find((s) => s.scenario_id === 'deterministic-linear-workflow'));
  const workflowDecision = buildWorkflowDecision({ decisionId: 'e2e-workflow-1', workflow: wfScenario.workflow, steps: wfScenario.steps });
  assert.equal(workflowDecision.status, 'WORKFLOW_REGISTERED_SIMULATION');

  assert.equal(msResult.decision.executed, false);
  assert.equal(caResult.result.executed, false);
  assert.equal(toolDecision.executed, false);
  assert.equal(workflowDecision.workflow_executed, false);
});

test('end-to-end: an economical model selection decision maps onto the context assembly plan with matching provider/model ids', () => {
  const { evaluateModelSelectionRequest } = require('../src/core/model-selection-engine');
  const { evaluateContextAssemblyRequest } = require('../src/core/context-assembly-engine');
  const msFixture = require('./fixtures/hermes-model-selection-engine.json');
  const caFixture = require('./fixtures/hermes-context-assembly-engine.json');

  const msScenario = msFixture.scenarios['low-cost-text-selection'];
  const msResult = evaluateModelSelectionRequest(msScenario.request, { candidates: msScenario.candidates });
  assert.equal(msResult.decision.status, 'MODEL_SELECTED_SIMULATION');

  const caTemplate = clone(caFixture.scenarios.find((s) => s.scenario_id === 'low-cost-model-context'));
  const mappedRef = toModelSelectionDecisionReference(msResult.decision, 'e2e-decision-ref-2');
  const caResult = evaluateContextAssemblyRequest({ ...caTemplate.request, model_selection_decision_reference: mappedRef });

  assert.equal(caResult.result.selected_model_reference_id, msResult.decision.selected_model_id);
  assert.equal(caResult.result.selected_provider_reference_id, msResult.decision.selected_provider_id);
});

test('end-to-end: policy denial blocks both model selection and context assembly independently', () => {
  const { evaluateModelSelectionRequest } = require('../src/core/model-selection-engine');
  const { evaluateContextAssemblyRequest } = require('../src/core/context-assembly-engine');
  const msFixture = require('./fixtures/hermes-model-selection-engine.json');
  const caFixture = require('./fixtures/hermes-context-assembly-engine.json');

  const msScenario = msFixture.scenarios['deterministic-no-llm-selection'];
  const denied = clone(msScenario.request);
  denied.policy_decision_reference.policy_status = 'DENY';
  denied.policy_decision_reference.allowed_in_simulation = false;
  assert.equal(evaluateModelSelectionRequest(denied, { candidates: msScenario.candidates }).decision.status, 'POLICY_BLOCKED');

  const caScenario = clone(caFixture.scenarios.find((s) => s.scenario_id === 'deterministic-no-llm-context'));
  caScenario.request.policy_decision_reference.policy_status = 'DENY';
  caScenario.request.policy_decision_reference.allowed_in_simulation = false;
  assert.equal(evaluateContextAssemblyRequest(caScenario.request).result.status, 'POLICY_BLOCKED');
});

test('end-to-end: tenant and organization mismatch block both context assembly and workflow registration', () => {
  const { evaluateContextAssemblyRequest } = require('../src/core/context-assembly-engine');
  const { buildWorkflowDecision } = require('../src/core/workflow-decision');
  const caFixture = require('./fixtures/hermes-context-assembly-engine.json');
  const wfFixture = require('./fixtures/hermes-workflow-contracts.json');

  const tenantCa = clone(caFixture.scenarios.find((s) => s.scenario_id === 'tenant-mismatch-context'));
  assert.equal(evaluateContextAssemblyRequest(tenantCa.request).result.status, 'TENANT_BLOCKED');
  const tenantWf = clone(wfFixture.scenarios.find((s) => s.scenario_id === 'tenant-mismatch-workflow'));
  assert.equal(buildWorkflowDecision({ decisionId: 'e2e-workflow-6', workflow: tenantWf.workflow, steps: tenantWf.steps }).status, 'TENANT_BLOCKED');

  const orgCa = clone(caFixture.scenarios.find((s) => s.scenario_id === 'organization-mismatch-context'));
  assert.equal(evaluateContextAssemblyRequest(orgCa.request).result.status, 'ORGANIZATION_BLOCKED');
  const orgWf = clone(wfFixture.scenarios.find((s) => s.scenario_id === 'organization-mismatch-workflow'));
  assert.equal(buildWorkflowDecision({ decisionId: 'e2e-workflow-7', workflow: orgWf.workflow, steps: orgWf.steps }).status, 'ORGANIZATION_BLOCKED');
});

test('end-to-end: a stale expected_fingerprint on re-registration is rejected as FINGERPRINT_CONFLICT', () => {
  const { createToolRegistry } = require('../src/core/tool-registry');
  const twFixture = require('./fixtures/hermes-tool-contracts.json');
  const tool = clone(twFixture.scenarios.find((s) => s.scenario_id === 'valid-tool-http').tool);
  const registry = createToolRegistry();
  assert.equal(registry.registerTool(tool, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  const bumped = { ...tool, display_name: 'Changed Display Name', tool_version: tool.tool_version + 1 };
  const conflict = registry.registerTool(bumped, { expected_fingerprint: 'stale-fingerprint-value' });
  assert.equal(conflict.status, 'FINGERPRINT_CONFLICT');
});

test('end-to-end: budget overflow blocks context assembly', () => {
  const { evaluateContextAssemblyRequest } = require('../src/core/context-assembly-engine');
  const caFixture = require('./fixtures/hermes-context-assembly-engine.json');
  const scenario = clone(caFixture.scenarios.find((s) => s.scenario_id === 'budget-overflow-block-context'));
  assert.equal(evaluateContextAssemblyRequest(scenario.request).result.status, 'BUDGET_BLOCKED');
});

test('finding: WorkflowDecision has no dedicated blocked status for a pending human approval requirement', () => {
  const { buildWorkflowDecision } = require('../src/core/workflow-decision');
  const wfFixture = require('./fixtures/hermes-workflow-contracts.json');
  const scenario = clone(wfFixture.scenarios.find((s) => s.scenario_id === 'approval-admin-workflow'));
  const decision = buildWorkflowDecision({ decisionId: 'e2e-workflow-10', workflow: scenario.workflow, steps: scenario.steps });
  // Characterizes a real integration gap (see the audit report): approval_required is per-step
  // metadata that never surfaces as a distinct decision status, so a future Orchestrator cannot
  // tell "clear to proceed" apart from "still needs a human's sign-off" from status alone.
  assert.equal(decision.status, 'WORKFLOW_REGISTERED_SIMULATION');
  assert.ok(scenario.steps.some((step) => step.approval_required === true));
});

test('finding: mapping a real ModelSelectionDecision onto a ModelSelectionDecisionReference requires an explicit adapter, not a direct field copy', () => {
  const { evaluateModelSelectionRequest } = require('../src/core/model-selection-engine');
  const msFixture = require('./fixtures/hermes-model-selection-engine.json');
  const scenario = msFixture.scenarios['low-cost-text-selection'];
  const decision = evaluateModelSelectionRequest(scenario.request, { candidates: scenario.candidates }).decision;
  // The reference shape ContextAssemblyRequest expects uses decision_reference_id/decision_status/
  // decision_value/decision_fingerprint; the real decision object uses decision_id/status/decision
  // and has five separate fingerprint fields, never one literally named decision_fingerprint.
  assert.equal('decision_fingerprint' in decision, false);
  assert.equal('decision_reference_id' in decision, false);
  assert.ok('decision_id' in decision && 'status' in decision && 'decision' in decision);
});
