'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-execution-plan-stage-manifest-integrity.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  STAGE_MANIFEST_REFERENCE_FIELDS, STAGE_MANIFEST_REFERENCE_SAFE_FLAGS, STAGE_RECORD_FIELDS,
  buildOrchestratorStageManifestReference, buildStageRecord, computeManifestFingerprint, computeStageRecordFingerprint,
  isCanonicalStageSequenceOrder, validateOrchestratorStageManifestReference, validateStageRecord
} = require('../src/core/orchestrator-stage-manifest-reference');
const { EXECUTION_PLAN_PACKAGE_FIELDS, buildExecutionPlanPackage, computeExecutionPlanPackageFingerprint } = require('../src/core/execution-plan-package-integrity');
const { validateExecutionPlanRequest } = require('../src/core/execution-plan-request');
const { EXECUTION_PLAN_STATUSES, validateExecutionPlanContract } = require('../src/core/execution-plan-contract');
const { RESULT_STATUSES, validateExecutionPlanResult } = require('../src/core/execution-plan-result');
const { validateExecutionPlanAudit } = require('../src/core/execution-plan-audit');
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
  'valid-deterministic-stage-manifest', 'valid-selection-stage-manifest', 'valid-tool-stage-manifest',
  'valid-workflow-stage-manifest', 'valid-approval-stage-manifest', 'valid-multi-agent-stage-manifest',
  'duplicate-stage-id-manifest', 'duplicate-stage-sequence-manifest', 'stage-sequence-gap-manifest',
  'stage-order-mismatch-manifest', 'tenant-mismatch-manifest', 'organization-mismatch-manifest',
  'project-mismatch-manifest', 'session-mismatch-manifest', 'agent-mismatch-manifest',
  'planning-result-mismatch-manifest', 'orchestration-plan-mismatch-manifest', 'stage-set-mismatch-manifest',
  'stage-fingerprint-mismatch-manifest', 'manifest-fingerprint-mismatch', 'dependency-id-missing-manifest',
  'dependency-id-extra-manifest', 'parallel-dependency-mismatch-manifest', 'tokens-total-mismatch-manifest',
  'cost-total-mismatch-manifest', 'budget-input-mismatch-manifest', 'budget-output-mismatch-manifest',
  'stage-count-budget-blocked', 'package-fingerprint-stage-type-change', 'package-fingerprint-tokens-change',
  'package-fingerprint-dependency-change', 'package-fingerprint-binding-change', 'replay-stage-manifest'
];

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_EXECUTION_PLAN_STAGE_MANIFEST.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

EXPECTED_SCENARIOS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded plan/result`, () => {
    const scenario = scenarioFixture(key);
    const outcome = evaluateExecutionPlanRequest(scenario.request, {});
    assert.equal(outcome.plan.execution_plan_status, scenario.plan.execution_plan_status);
    assert.equal(outcome.result.status, scenario.result.status);
    assertValid(`scenario:${key}:plan`, validateExecutionPlanContract(outcome.plan));
    assertValid(`scenario:${key}:result`, validateExecutionPlanResult(outcome.result));
    assertValid(`scenario:${key}:audit`, validateExecutionPlanAudit(outcome.audit));
  });
});

// ---------------------------------------------------------------------------
// Contrato: StageManifestReference / StageRecord
// ---------------------------------------------------------------------------

test('stage manifest reference: exact fields (17), and simulation/production_blocked forced', () => {
  assert.equal(STAGE_MANIFEST_REFERENCE_FIELDS.length, 17);
  assert.deepEqual(STAGE_MANIFEST_REFERENCE_SAFE_FLAGS, { simulation: true, production_blocked: true });
  const manifest = scenarioFixture('valid-deterministic-stage-manifest').request.stage_manifest_reference;
  assertValid('manifest', validateOrchestratorStageManifestReference(manifest));
  assert.equal(validateOrchestratorStageManifestReference({ ...manifest, simulation: false }).valid, false);
  assert.equal(validateOrchestratorStageManifestReference({ ...manifest, production_blocked: false }).valid, false);
  assert.equal(validateOrchestratorStageManifestReference({ ...manifest, unexpected: 1 }).valid, false, 'campo extra deve bloquear');
  const { stage_records, ...missingStageRecords } = manifest;
  assert.equal(validateOrchestratorStageManifestReference(missingStageRecords).valid, false, 'campo ausente deve bloquear');
});

test('stage record: exact fields (27)', () => {
  assert.equal(STAGE_RECORD_FIELDS.length, 27);
  const record = scenarioFixture('valid-deterministic-stage-manifest').request.stage_manifest_reference.stage_records[0];
  assertValid('record', validateStageRecord(record));
  assert.equal(validateStageRecord({ ...record, stage_type: 'NOT_A_REAL_TYPE' }).valid, false, 'enum inválido deve bloquear');
  assert.equal(validateStageRecord({ ...record, tool_reference_ids: ['a', 'a'] }).valid, false, 'arrays duplicados devem bloquear');
  assert.equal(validateStageRecord({ ...record, priority: -1 }).valid, false, 'priority inválida deve bloquear');
  assert.equal(validateStageRecord({ ...record, estimated_total_tokens: 1 }).valid, false, 'tokens inconsistentes devem bloquear (total != input+output)');
  assert.equal(validateStageRecord({ ...record, estimated_cost_minor_units: -1 }).valid, false, 'custo inválido deve bloquear');
  assert.equal(validateStageRecord({ ...record, agent_reference_id: '' }).valid, false, 'nullable reference inválida (string vazia) deve bloquear');
  assert.throws(() => buildStageRecord({ ...record, stage_id: undefined }));
});

test('stage record: clone defensivo, deep freeze, and input is never mutated', () => {
  const input = { stage_id: 'stage-x', stage_type: 'DETERMINISTIC_STAGE', stage_sequence: 0, task_reference_id: 'taskref-x' };
  const snapshot = JSON.stringify(input);
  const record = buildStageRecord(input);
  assert.equal(JSON.stringify(input), snapshot, 'builder must never mutate its own input');
  assert.equal(Object.isFrozen(record), true);
  assert.throws(() => { record.priority = 99; }, TypeError);
});

test('stage manifest reference: canonical order = stage_sequence, never alphabetical', () => {
  const recordA = buildStageRecord({ stage_id: 'stage-b', stage_type: 'DETERMINISTIC_STAGE', stage_sequence: 0, task_reference_id: 'taskref-x' });
  const recordB = buildStageRecord({ stage_id: 'stage-a', stage_type: 'DETERMINISTIC_STAGE', stage_sequence: 1, task_reference_id: 'taskref-x' });
  assert.equal(isCanonicalStageSequenceOrder([recordA, recordB]), true, 'stage-b before stage-a is canonical because stage_sequence says so');
  const manifest = buildOrchestratorStageManifestReference({
    stage_manifest_reference_id: 'stagemanifest-canonical-check', planning_result_id: 'planning-result-x',
    orchestration_plan_id: 'plan-x', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1',
    session_reference_id: 'session-1', agent_id: 'agent-1', stage_records: [recordA, recordB], logical_sequence: 1
  });
  assert.deepEqual(manifest.stage_ids, ['stage-b', 'stage-a'], 'stage_ids must preserve semantic order, never sort alphabetically');
});

// ---------------------------------------------------------------------------
// Fidelidade 1:1: o Execution Plan preserva exatamente os StageRecords do Planner
// ---------------------------------------------------------------------------

test('deterministic, model, tool, workflow, and approval stage types are all preserved exactly as declared -- never reconstructed', () => {
  const cases = [
    ['valid-deterministic-stage-manifest', 'DETERMINISTIC_STAGE'],
    ['valid-selection-stage-manifest', 'MODEL_REFERENCE_STAGE'],
    ['valid-tool-stage-manifest', 'TOOL_REFERENCE_STAGE'],
    ['valid-workflow-stage-manifest', 'WORKFLOW_REFERENCE_STAGE'],
    ['valid-approval-stage-manifest', 'HUMAN_APPROVAL_STAGE']
  ];
  for (const [key, expectedStageType] of cases) {
    const scenario = scenarioFixture(key);
    assert.equal(scenario.request.stage_manifest_reference.stage_records[0].stage_type, expectedStageType, `${key}: manifest declares ${expectedStageType}`);
  }
});

test('VALIDATION_STAGE, MEMORY_REFERENCE_STAGE, CONTEXT_REFERENCE_STAGE, AUDIT_STAGE, and FINALIZATION_STAGE are never collapsed into MODEL_REFERENCE_STAGE (the exact defect pr99 fixes)', () => {
  const otherStageTypes = ['VALIDATION_STAGE', 'MEMORY_REFERENCE_STAGE', 'CONTEXT_REFERENCE_STAGE', 'AUDIT_STAGE', 'FINALIZATION_STAGE'];
  const baseline = scenarioFixture('valid-deterministic-stage-manifest');
  for (const stageType of otherStageTypes) {
    const request = clone(baseline.request);
    request.execution_plan_request_id = `planreq-stage-type-preserved-${stageType.toLowerCase()}`;
    request.stage_manifest_reference = { ...request.stage_manifest_reference };
    const record0 = { ...request.stage_manifest_reference.stage_records[0], stage_type: stageType };
    record0.stage_fingerprint = computeStageRecordFingerprint(record0);
    const record1 = request.stage_manifest_reference.stage_records[1];
    request.stage_manifest_reference = buildOrchestratorStageManifestReference({
      ...request.stage_manifest_reference, stage_records: [record0, record1]
    });
    const outcome = evaluateExecutionPlanRequest(request, {});
    assert.equal(outcome.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION', `${stageType}: request should prepare`);
    // The engine never derives a stage_type -- the manifest's own declared type is the only source.
    assert.equal(request.stage_manifest_reference.stage_records[0].stage_type, stageType);
  }
});

test('multi-agent stages preserve each stage\'s own agent_reference_id and parallelizable', () => {
  const scenario = scenarioFixture('valid-multi-agent-stage-manifest');
  const [record0, record1] = scenario.request.stage_manifest_reference.stage_records;
  assert.equal(record0.agent_reference_id, 'agent-1');
  assert.equal(record1.agent_reference_id, 'agent-2');
  assert.equal(record1.parallelizable, true);
  assert.equal(scenario.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
});

test('optional, priority, required_capabilities, required_modalities, success_criteria, fallback, and escalation references all round-trip through the manifest unchanged', () => {
  const record = buildStageRecord({
    stage_id: 'stage-fidelity', stage_type: 'DETERMINISTIC_STAGE', stage_sequence: 0, task_reference_id: 'taskref-x',
    optional: true, priority: 42, required_capabilities: ['CODE_REFERENCE'], required_modalities: ['TEXT_INPUT'],
    success_criteria_reference_ids: ['criteria-a'], fallback_reference_ids: ['fallback-a'], escalation_reference_ids: ['escalation-a']
  });
  assert.equal(record.optional, true);
  assert.equal(record.priority, 42);
  assert.deepEqual(record.required_capabilities, ['CODE_REFERENCE']);
  assert.deepEqual(record.required_modalities, ['TEXT_INPUT']);
  assert.deepEqual(record.success_criteria_reference_ids, ['criteria-a']);
  assert.deepEqual(record.fallback_reference_ids, ['fallback-a']);
  assert.deepEqual(record.escalation_reference_ids, ['escalation-a']);
});

test('approval-required stages remain HUMAN_APPROVAL_STAGE and approval_required matches the Planner exactly; execution_authorized stays false while waiting', () => {
  const scenario = scenarioFixture('valid-approval-stage-manifest');
  const outcome = evaluateExecutionPlanRequest(scenario.request, {});
  assert.equal(outcome.result.status, 'WAITING_APPROVAL_REFERENCE');
  assert.equal(scenario.request.stage_manifest_reference.stage_records[0].stage_type, 'HUMAN_APPROVAL_STAGE');
  assert.equal(scenario.request.stage_manifest_reference.stage_records[0].approval_required, true);
  assert.equal(outcome.result.execution_authorized, false);
  assert.equal(outcome.result.stage_manifest_validated, true, 'the manifest is fully validated even while waiting for approval');
});

// ---------------------------------------------------------------------------
// Estimativas
// ---------------------------------------------------------------------------

test('estimates are never zeroed -- they come from the manifest and are never re-derived', () => {
  const scenario = scenarioFixture('valid-deterministic-stage-manifest');
  const outcome = evaluateExecutionPlanRequest(scenario.request, {});
  assert.equal(outcome.result.estimated_total_tokens, 100);
  assert.equal(outcome.result.estimated_total_cost_minor_units, 5);
  assert.equal(outcome.audit.estimated_input_tokens, 50);
  assert.equal(outcome.audit.estimated_output_tokens, 50);
});

test('stage estimate totals must agree exactly with planning result, orchestration plan, and execution plan budget -- any mismatch blocks', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('tokens-total-mismatch-manifest').request, {}).result.status, 'BUDGET_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('cost-total-mismatch-manifest').request, {}).result.status, 'BUDGET_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('budget-input-mismatch-manifest').request, {}).result.status, 'BUDGET_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('budget-output-mismatch-manifest').request, {}).result.status, 'BUDGET_BLOCKED');
});

test('model/tool/workflow stage counts exceeding the execution plan budget block with BUDGET_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('stage-count-budget-blocked').request, {}).result.status, 'BUDGET_BLOCKED');
});

test('parallel stage count exceeding maximum_parallel_stages blocks with BUDGET_BLOCKED', () => {
  const scenario = scenarioFixture('package-fingerprint-dependency-change');
  const request = clone(scenario.request);
  request.execution_plan_request_id = 'planreq-parallel-stage-count-budget-check';
  request.stage_manifest_reference = { ...request.stage_manifest_reference };
  const [record0, record1] = request.stage_manifest_reference.stage_records;
  const parallelRecord1 = { ...record1, parallelizable: true };
  parallelRecord1.stage_fingerprint = computeStageRecordFingerprint(parallelRecord1);
  request.stage_manifest_reference = buildOrchestratorStageManifestReference({
    ...request.stage_manifest_reference, stage_records: [record0, parallelRecord1]
  });
  request.execution_plan_budget = { ...request.execution_plan_budget, maximum_parallel_stages: 0 };
  request.execution_plan_budget.budget_fingerprint = undefined;
  const { buildExecutionPlanBudget } = require('../src/core/execution-plan-budget');
  request.execution_plan_budget = buildExecutionPlanBudget({ ...request.execution_plan_budget, maximum_parallel_stages: 0 });
  assert.equal(evaluateExecutionPlanRequest(request, {}).result.status, 'BUDGET_BLOCKED');
});

// ---------------------------------------------------------------------------
// Manifesto: rejeições estruturais (validated by construction) e cross-checks (engine)
// ---------------------------------------------------------------------------

test('an empty stage_records list is rejected at construction', () => {
  assert.throws(() => buildOrchestratorStageManifestReference({
    stage_manifest_reference_id: 'stagemanifest-empty', planning_result_id: 'planning-result-x', orchestration_plan_id: 'plan-x',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', session_reference_id: 'session-1',
    agent_id: 'agent-1', stage_records: [], logical_sequence: 1
  }));
});

test('duplicate stage id, duplicate stage sequence, sequence gap, and wrong stage_ids order all fail request validation with VALIDATION_FAILED', () => {
  for (const key of ['duplicate-stage-id-manifest', 'duplicate-stage-sequence-manifest', 'stage-sequence-gap-manifest', 'stage-order-mismatch-manifest']) {
    const scenario = scenarioFixture(key);
    assert.equal(validateExecutionPlanRequest(scenario.request).valid, false, `${key} must be structurally invalid`);
    assert.equal(evaluateExecutionPlanRequest(scenario.request, {}).result.status, 'VALIDATION_FAILED', key);
  }
});

test('tenant, organization, project, and session mismatches on stage_manifest_reference each block independently; agent mismatch is VALIDATION_FAILED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('tenant-mismatch-manifest').request, {}).result.status, 'TENANT_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('organization-mismatch-manifest').request, {}).result.status, 'ORGANIZATION_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('project-mismatch-manifest').request, {}).result.status, 'PROJECT_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('session-mismatch-manifest').request, {}).result.status, 'SESSION_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('agent-mismatch-manifest').request, {}).result.status, 'VALIDATION_FAILED');
});

test('planning_result_id, orchestration_plan_id, and stage set disagreement are all STAGE_MANIFEST_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('planning-result-mismatch-manifest').request, {}).result.status, 'STAGE_MANIFEST_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('orchestration-plan-mismatch-manifest').request, {}).result.status, 'STAGE_MANIFEST_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('stage-set-mismatch-manifest').request, {}).result.status, 'STAGE_MANIFEST_BLOCKED');
});

test('a tampered StageRecord and a tampered manifest_fingerprint are both caught only by the engine\'s recompute-and-compare tamper detection, not by construction-time validation', () => {
  const stageFingerprintScenario = scenarioFixture('stage-fingerprint-mismatch-manifest');
  assert.equal(validateExecutionPlanRequest(stageFingerprintScenario.request).valid, true, 'construction-time validation never recomputes a stage_fingerprint');
  assert.equal(evaluateExecutionPlanRequest(stageFingerprintScenario.request, {}).result.status, 'STAGE_MANIFEST_BLOCKED');

  const manifestFingerprintScenario = scenarioFixture('manifest-fingerprint-mismatch');
  assert.equal(validateExecutionPlanRequest(manifestFingerprintScenario.request).valid, true, 'construction-time validation never recomputes manifest_fingerprint either');
  assert.equal(evaluateExecutionPlanRequest(manifestFingerprintScenario.request, {}).result.status, 'STAGE_MANIFEST_BLOCKED');
});

test('a stale expected_registry_version is still VERSION_BLOCKED with a required stage_manifest_reference present', () => {
  const scenario = scenarioFixture('valid-deterministic-stage-manifest');
  const outcome = evaluateExecutionPlanRequest(scenario.request, { currentRegistryVersion: 'v2' });
  assert.equal(outcome.result.status, 'VERSION_BLOCKED');
});

test('operational material is rejected everywhere in the manifest, and a non-serializable payload is rejected', () => {
  assert.deepEqual(findAgentCoreOperationalMaterial({ note: 'do not call the model provider endpoint' }).length > 0, true);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => stablePayload(cyclic));
  assert.equal(findAgentCoreOperationalMaterial(cyclic).some((e) => e.includes('forbidden_cycle')), true);
});

// ---------------------------------------------------------------------------
// Dependências: equivalência entre StageManifest e DependencyGraphReference
// ---------------------------------------------------------------------------

test('manifest dependencies equivalent to the graph pass, a missing manifest-side id blocks, an extra manifest-side id blocks, and parallel/policy incompatibility blocks', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('package-fingerprint-dependency-change').request, {}).result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('dependency-id-missing-manifest').request, {}).result.status, 'STAGE_MANIFEST_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('dependency-id-extra-manifest').request, {}).result.status, 'STAGE_MANIFEST_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('parallel-dependency-mismatch-manifest').request, {}).result.status, 'DEPENDENCY_BLOCKED');
});

test('policy disabling parallel stages still blocks a structurally valid parallel dependency', () => {
  const scenario = scenarioFixture('valid-multi-agent-stage-manifest');
  // valid-multi-agent-stage-manifest has no dependency edges at all; build a genuine parallel one
  // reusing its already-parallelizable stage-2.
  const { buildExecutionPlanDependencyGraphReference, buildDependencyRecord } = require('../src/core/execution-plan-dependency-graph-reference');
  const request = clone(scenario.request);
  request.execution_plan_request_id = 'planreq-parallel-policy-disabled-check';
  request.execution_plan_policy_reference = { ...request.execution_plan_policy_reference, allow_parallel_stage: false };
  request.dependency_graph_reference = buildExecutionPlanDependencyGraphReference({
    dependency_graph_reference_id: 'depgraph-parallel-policy-disabled', execution_plan_id: request.orchestration_plan_reference.plan_id,
    planning_result_id: request.planning_result_reference.planning_result_id, orchestration_plan_id: request.orchestration_plan_reference.plan_id,
    tenant_id: request.dependency_graph_reference.tenant_id, organization_id: request.dependency_graph_reference.organization_id,
    project_id: request.dependency_graph_reference.project_id, session_reference_id: request.dependency_graph_reference.session_reference_id,
    stage_ids: ['stage-1', 'stage-2'],
    dependency_records: [buildDependencyRecord({ dependency_id: 'dep-policy-disabled-1', from_stage_id: 'stage-1', to_stage_id: 'stage-2', dependency_type: 'PARALLEL_REFERENCE', required: true })],
    logical_sequence: 1
  });
  const [record0, record1] = request.stage_manifest_reference.stage_records;
  const updatedRecord1 = { ...record1, dependency_reference_ids: ['dep-policy-disabled-1'] };
  updatedRecord1.stage_fingerprint = computeStageRecordFingerprint(updatedRecord1);
  request.stage_manifest_reference = buildOrchestratorStageManifestReference({ ...request.stage_manifest_reference, stage_records: [record0, updatedRecord1] });
  assert.equal(evaluateExecutionPlanRequest(request, {}).result.status, 'DEPENDENCY_BLOCKED');
});

test('context.dependencyRecords remains a dead side-channel with zero effect, even for a scenario that legitimately carries a real dependency', () => {
  const request = scenarioFixture('package-fingerprint-dependency-change').request;
  const withoutSideChannel = evaluateExecutionPlanRequest(request, {});
  const withStaleSideChannel = evaluateExecutionPlanRequest(request, { dependencyRecords: [{ from_stage_id: 'stage-2', to_stage_id: 'stage-1' }] });
  assert.equal(withoutSideChannel.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  assert.equal(withStaleSideChannel.result.status, withoutSideChannel.result.status);
  assert.equal(withStaleSideChannel.result.execution_plan_fingerprint, withoutSideChannel.result.execution_plan_fingerprint);
});

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

test('memory and context bindings are created only for stages whose own record declares them', () => {
  const baseline = scenarioFixture('valid-deterministic-stage-manifest');
  const request = clone(baseline.request);
  request.execution_plan_request_id = 'planreq-memory-context-binding-check';
  const [record0, record1] = request.stage_manifest_reference.stage_records;
  const withMemoryContext = {
    ...record0, memory_selection_reference_id: request.memory_selection_reference.reference_id,
    context_assembly_reference_id: request.context_assembly_reference.reference_id
  };
  withMemoryContext.stage_fingerprint = computeStageRecordFingerprint(withMemoryContext);
  request.stage_manifest_reference = buildOrchestratorStageManifestReference({ ...request.stage_manifest_reference, stage_records: [withMemoryContext, record1] });
  const outcome = evaluateExecutionPlanRequest(request, {});
  assert.equal(outcome.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
});

test('a binding source id that does not match the request\'s own model/tool/workflow reference is BINDING_BLOCKED', () => {
  const scenario = scenarioFixture('valid-selection-stage-manifest');
  const request = clone(scenario.request);
  request.execution_plan_request_id = 'planreq-selection-binding-mismatch-check';
  const [record0, record1] = request.stage_manifest_reference.stage_records;
  const mismatched = { ...record0, model_selection_reference_id: 'selection-decision-not-the-real-one' };
  mismatched.stage_fingerprint = computeStageRecordFingerprint(mismatched);
  request.stage_manifest_reference = buildOrchestratorStageManifestReference({ ...request.stage_manifest_reference, stage_records: [mismatched, record1] });
  assert.equal(evaluateExecutionPlanRequest(request, {}).result.status, 'BINDING_BLOCKED');
});

test('missing-binding-plan (from execution-plan-contracts fixture): a selected tool id the request does not carry is BINDING_BLOCKED', () => {
  const contractsFixture = require('./fixtures/hermes-execution-plan-contracts.json');
  const scenario = contractsFixture.scenarios['missing-binding-plan'];
  assert.equal(evaluateExecutionPlanRequest(scenario.request, {}).result.status, 'BINDING_BLOCKED');
});

// ---------------------------------------------------------------------------
// Package fingerprint
// ---------------------------------------------------------------------------

test('execution plan package: exact fields (35)', () => {
  assert.equal(EXECUTION_PLAN_PACKAGE_FIELDS.length, 35);
});

test('two identical packages produce identical fingerprints, and changing stage_type, tokens, dependencies, or bindings each changes execution_plan_fingerprint', () => {
  const baseline = scenarioFixture('valid-deterministic-stage-manifest');
  const baselineOutcome = evaluateExecutionPlanRequest(baseline.request, {});
  assert.equal(baselineOutcome.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');

  const variants = [
    'package-fingerprint-stage-type-change', 'package-fingerprint-tokens-change',
    'package-fingerprint-dependency-change', 'package-fingerprint-binding-change'
  ];
  for (const key of variants) {
    const variantOutcome = evaluateExecutionPlanRequest(scenarioFixture(key).request, {});
    assert.equal(variantOutcome.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION', key);
    assert.notEqual(variantOutcome.result.execution_plan_fingerprint, baselineOutcome.result.execution_plan_fingerprint, `${key} must change execution_plan_fingerprint relative to the baseline`);
  }

  const replayOutcomeA = evaluateExecutionPlanRequest(scenarioFixture('valid-deterministic-stage-manifest').request, {});
  const replayOutcomeB = evaluateExecutionPlanRequest(scenarioFixture('valid-deterministic-stage-manifest').request, {});
  assert.equal(replayOutcomeA.result.execution_plan_fingerprint, replayOutcomeB.result.execution_plan_fingerprint, 'two identical packages must produce identical fingerprints');
});

test('execution_plan_fingerprint covers the full canonical package, not just execution_plan_id and stage ids', () => {
  const pkgA = buildExecutionPlanPackage({ execution_plan_id: 'plan-x', ordered_stage_ids: ['stage-1'], stage_fingerprints: ['fp-a'] });
  const pkgB = buildExecutionPlanPackage({ execution_plan_id: 'plan-x', ordered_stage_ids: ['stage-1'], stage_fingerprints: ['fp-b'] });
  assert.notEqual(computeExecutionPlanPackageFingerprint(pkgA), computeExecutionPlanPackageFingerprint(pkgB));
});

test('input order of semantically-unordered id/fingerprint pairs never changes the package fingerprint, but stage order does', () => {
  const pkgForward = buildExecutionPlanPackage({
    dependency_ids: ['dep-a', 'dep-b'], dependency_fingerprints: ['fp-dep-a', 'fp-dep-b'],
    ordered_stage_ids: ['stage-1', 'stage-2'], stage_fingerprints: ['fp-stage-1', 'fp-stage-2']
  });
  const pkgReversedDependencies = buildExecutionPlanPackage({
    dependency_ids: ['dep-b', 'dep-a'], dependency_fingerprints: ['fp-dep-b', 'fp-dep-a'],
    ordered_stage_ids: ['stage-1', 'stage-2'], stage_fingerprints: ['fp-stage-1', 'fp-stage-2']
  });
  assert.equal(computeExecutionPlanPackageFingerprint(pkgForward), computeExecutionPlanPackageFingerprint(pkgReversedDependencies), 'dependency id/fingerprint pairs are canonicalized regardless of insertion order');

  const pkgReversedStages = buildExecutionPlanPackage({
    dependency_ids: ['dep-a', 'dep-b'], dependency_fingerprints: ['fp-dep-a', 'fp-dep-b'],
    ordered_stage_ids: ['stage-2', 'stage-1'], stage_fingerprints: ['fp-stage-2', 'fp-stage-1']
  });
  assert.notEqual(computeExecutionPlanPackageFingerprint(pkgForward), computeExecutionPlanPackageFingerprint(pkgReversedStages), 'stage order is semantic and must never be canonicalized away');
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry: OrchestratorStageManifestReference store supports register, replay, tenant reassignment protection, defensive clone, and immutable output', () => {
  const registry = createExecutionPlanRegistry();
  const manifest = scenarioFixture('replay-stage-manifest').request.stage_manifest_reference;

  const first = registry.registerOrchestratorStageManifestReference(manifest, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerOrchestratorStageManifestReference(manifest).status, 'REPLAY_ACCEPTED');

  const payloadMismatch = { ...manifest, logical_sequence: manifest.logical_sequence + 100 };
  assert.equal(registry.registerOrchestratorStageManifestReference(payloadMismatch).status, 'PAYLOAD_MISMATCH');

  const tenantChanged = { ...manifest, tenant_id: 'tenant-different' };
  assert.equal(registry.registerOrchestratorStageManifestReference(tenantChanged).status, 'TENANT_BLOCKED');

  const fetched = registry.getOrchestratorStageManifestReferenceById(manifest.stage_manifest_reference_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.tenant_id = 'x'; }, TypeError);
  assert.equal(registry.getOrchestratorStageManifestReferenceById('unknown-id'), null);

  const invalid = registry.registerOrchestratorStageManifestReference({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

// ---------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------

test('for every named scenario, no execution is ever authorized, started, or performed, and overriding any safe flag is rejected', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    const outcome = evaluateExecutionPlanRequest(scenario.request, {});
    assert.equal(outcome.plan.executable, false, `${key}: plan.executable`);
    assert.equal(outcome.plan.execution_authorized, false, `${key}: plan.execution_authorized`);
    assert.equal(outcome.plan.execution_started, false, `${key}: plan.execution_started`);
    assert.equal(outcome.plan.executed, false, `${key}: plan.executed`);
    assert.equal(outcome.plan.runtime_enabled, false, `${key}: plan.runtime_enabled`);
    assert.equal(outcome.result.executable, false, `${key}: result.executable`);
    assert.equal(outcome.result.execution_authorized, false, `${key}: result.execution_authorized`);
    assert.equal(outcome.result.execution_started, false, `${key}: result.execution_started`);
    assert.equal(outcome.result.stage_started, false, `${key}: result.stage_started`);
    assert.equal(outcome.result.stage_completed, false, `${key}: result.stage_completed`);
    assert.equal(outcome.result.tool_called, false, `${key}: result.tool_called`);
    assert.equal(outcome.result.workflow_executed, false, `${key}: result.workflow_executed`);
    assert.equal(outcome.result.provider_called, false, `${key}: result.provider_called`);
    assert.equal(outcome.result.model_called, false, `${key}: result.model_called`);
    assert.equal(outcome.result.network_used, false, `${key}: result.network_used`);
    assert.equal(outcome.result.memory_read, false, `${key}: result.memory_read`);
    assert.equal(outcome.result.memory_written, false, `${key}: result.memory_written`);
    assert.equal(outcome.result.tokens_consumed, false, `${key}: result.tokens_consumed`);
    assert.equal(outcome.result.cost_consumed, false, `${key}: result.cost_consumed`);
    assert.equal(outcome.result.runtime_enabled, false, `${key}: result.runtime_enabled`);
    assert.equal(outcome.result.executed, false, `${key}: result.executed`);
  }

  const manifest = scenarioFixture('valid-deterministic-stage-manifest').request.stage_manifest_reference;
  assert.equal(validateOrchestratorStageManifestReference({ ...manifest, simulation: false }).valid, false, 'overriding simulation=false must be rejected');
  // buildStageRecord always recomputes its own stage_fingerprint from whatever content it is
  // given -- a caller-supplied stage_fingerprint is never trusted, so construction cannot be
  // fooled by a pre-tampered fingerprint on the way in (the record it produces is always
  // internally consistent by construction). Only a value hand-edited *after* construction, as
  // exercised by stage-fingerprint-mismatch-manifest above, can diverge.
  const record = manifest.stage_records[0];
  const rebuilt = buildStageRecord({ ...record, priority: record.priority + 1 });
  assert.equal(rebuilt.stage_fingerprint, computeStageRecordFingerprint(rebuilt));
});

test('tipos adversariais: NaN, Infinity, bigint, symbol, function, undefined, binary, and cyclic reference are all rejected by the operational material detector or stablePayload', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((e) => e.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((e) => e.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((e) => e.includes('forbidden_symbol')));
  assert.ok(findAgentCoreOperationalMaterial({ value: () => null }).some((e) => e.includes('forbidden_function')));
  assert.ok(findAgentCoreOperationalMaterial({ value: undefined }).some((e) => e.includes('forbidden_undefined')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Buffer.from('x') }).some((e) => e.includes('forbidden_binary')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((e) => e.includes('forbidden_cycle')));
  // Date is rejected by stablePayload's own explicit instanceof check (used by every validator's
  // final serialization pass), not by the generic operational-material detector.
  assert.throws(() => stablePayload(new Date()));
  assert.ok(findAgentCoreOperationalMaterial({ note: 'process.env.SECRET' }).length > 0);
  assert.ok(findAgentCoreOperationalMaterial({ note: 'https://example.invalid/endpoint' }).length > 0);
});

test('operational material detector avoids false positives on every legitimate stage-manifest field name and scenario', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario), [], `scenario ${key} must be free of operational material`);
  }
});

// ---------------------------------------------------------------------------
// Regressão
// ---------------------------------------------------------------------------

test('regression: new modules do not use network, filesystem, eval, dynamic import, or timers', () => {
  const files = [
    'services/api/src/core/orchestrator-stage-manifest-reference.js', 'services/api/src/core/execution-plan-package-integrity.js'
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
  }
});

test('regression: new modules are not imported by runtime endpoints, and deriveStageType no longer exists anywhere', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('orchestrator-stage-manifest-reference'), false);
    assert.equal(source.includes('execution-plan-package-integrity'), false);
  }
  const engineSource = fs.readFileSync(path.join(repoRoot, 'services/api/src/core/execution-plan-engine.js'), 'utf8');
  assert.equal(/function\s+deriveStageType/.test(engineSource), false, 'deriveStageType must be fully removed, not merely unused');
  assert.equal(engineSource.includes('deriveStageType('), false);
});

test('regression: PRs 79 through 98 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js', 'services/api/src/core/orchestrator-planner.js',
    'services/api/src/core/orchestrator-planning-request.js', 'services/api/src/core/orchestrator-planning-result.js',
    'services/api/src/core/orchestrator-plan-stage.js', 'services/api/src/core/orchestrator-plan-dependency.js',
    'services/api/src/core/execution-authorization-boundary.js', 'services/api/src/core/execution-authorization-task-reference.js',
    'services/api/src/core/execution-authorization-decision.js', 'services/api/src/core/execution-plan-dependency.js',
    'services/api/src/core/execution-plan-dependency-graph-reference.js'
  ].map((file) => path.join(repoRoot, file));
  const newModules = ['orchestrator-stage-manifest-reference', 'execution-plan-package-integrity'];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of newModules) {
      assert.equal(source.includes(moduleName), false, `${file} must not reference ${moduleName}`);
    }
  }
});

test('regression: NO_LLM and the already-selected economical model are both preserved -- this PR never selects a different model or provider', () => {
  const contractsFixture = require('./fixtures/hermes-execution-plan-contracts.json');
  const noLlm = evaluateExecutionPlanRequest(contractsFixture.scenarios['prepared-no-llm-plan'].request, {});
  assert.equal(noLlm.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  const lowCost = evaluateExecutionPlanRequest(contractsFixture.scenarios['prepared-low-cost-model-plan'].request, {});
  assert.equal(lowCost.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  assert.equal(lowCost.plan.model_selection_reference_id, contractsFixture.scenarios['prepared-low-cost-model-plan'].request.model_selection_reference.reference_id);
});
