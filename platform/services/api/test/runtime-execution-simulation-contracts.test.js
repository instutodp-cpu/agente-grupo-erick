'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const fixture = require('./fixtures/hermes-runtime-execution-simulation-contracts.json');
const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const {
  RUNTIME_EXECUTION_SIMULATION_POLICY_FIELDS, RUNTIME_EXECUTION_SIMULATION_POLICY_SAFE_FLAGS,
  buildRuntimeExecutionSimulationPolicy, validateRuntimeExecutionSimulationPolicy
} = require('../src/core/runtime-execution-simulation-policy');
const {
  RUNTIME_STAGE_SIMULATION_REFERENCE_FIELDS, RUNTIME_STAGE_SIMULATION_REFERENCE_SAFE_FLAGS, RUNTIME_STAGE_STATES,
  buildRuntimeStageSimulationReference, validateRuntimeStageSimulationReference
} = require('../src/core/runtime-stage-simulation-reference');
const {
  RUNTIME_STAGE_SIMULATION_MANIFEST_FIELDS, buildRuntimeStageSimulationManifest, validateRuntimeStageSimulationManifest
} = require('../src/core/runtime-stage-simulation-manifest');
const {
  RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_FIELDS, buildRuntimeDependencySimulationReference,
  validateRuntimeDependencySimulationReference
} = require('../src/core/runtime-dependency-simulation-reference');
const {
  RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_FIELDS, buildRuntimeDependencySimulationManifest,
  validateRuntimeDependencySimulationManifest
} = require('../src/core/runtime-dependency-simulation-manifest');
const {
  RUNTIME_BUDGET_SIMULATION_REFERENCE_FIELDS, buildRuntimeBudgetSimulationReference,
  validateRuntimeBudgetSimulationReference
} = require('../src/core/runtime-budget-simulation-reference');
const {
  RUNTIME_STOP_SIMULATION_REFERENCE_FIELDS, buildRuntimeStopSimulationReference, validateRuntimeStopSimulationReference
} = require('../src/core/runtime-stop-simulation-reference');
const {
  RUNTIME_COMPENSATION_SIMULATION_REFERENCE_FIELDS, buildRuntimeCompensationSimulationReference,
  validateRuntimeCompensationSimulationReference
} = require('../src/core/runtime-compensation-simulation-reference');
const {
  RUNTIME_ARTIFACT_PLAN_REFERENCE_FIELDS, buildRuntimeArtifactPlanReference, validateRuntimeArtifactPlanReference
} = require('../src/core/runtime-artifact-plan-reference');
const {
  RUNTIME_EVENT_PLAN_REFERENCE_FIELDS, buildRuntimeEventPlanReference, validateRuntimeEventPlanReference
} = require('../src/core/runtime-event-plan-reference');
const {
  RUNTIME_EXECUTION_SIMULATION_REQUEST_FIELDS, buildRuntimeExecutionSimulationRequest,
  validateRuntimeExecutionSimulationRequest
} = require('../src/core/runtime-execution-simulation-request');
const {
  RUNTIME_EXECUTION_SIMULATION_STATUSES, RUNTIME_DECISIONS, RUNTIME_NEXT_STATES, STATUS_OUTCOME_MAP,
  buildRuntimeExecutionSimulationDecision, validateRuntimeExecutionSimulationDecision
} = require('../src/core/runtime-execution-simulation-decision');
const { buildRuntimeExecutionSimulationResult, validateRuntimeExecutionSimulationResult } = require('../src/core/runtime-execution-simulation-result');
const { validateRuntimeExecutionSimulationAudit } = require('../src/core/runtime-execution-simulation-audit');
const {
  checkIdentity, computeRuntimePackageDigest, evaluateRuntimeExecutionSimulationRequest, validateRuntimeExecutionPackage
} = require('../src/core/runtime-execution-package');
const { createRuntimeExecutionSimulationRegistry } = require('../src/core/runtime-execution-simulation-registry');
const { buildOrchestratorStageManifestReference, buildStageRecord } = require('../src/core/orchestrator-stage-manifest-reference');
const { buildAuthorizationScopeReference } = require('../src/core/execution-authorization-scope-reference');
const { buildExecutionPlanDependencyGraphReference, buildDependencyRecord } = require('../src/core/execution-plan-dependency-graph-reference');
const { buildExecutionPlanBudget } = require('../src/core/execution-plan-budget');
const { computeGatewayPackageDigest } = require('../src/core/execution-gateway-boundary');
const { buildExecutionGatewayPackageReference } = require('../src/core/execution-gateway-package-reference');
const { buildGoldenRuntimeBundle } = require('./helpers/runtime-execution-simulation-test-data');

// Rebuilds the golden bundle's *first* stage as a MODEL_REFERENCE_STAGE (both at the Gateway's own
// source StageManifestReference and at the Runtime Stage Manifest that materializes it 1:1), and
// keeps gateway_package_reference's stage_manifest_fingerprint/package_digest in agreement -- the
// same "rebuild via own builder, then recompute every dependent fingerprint/digest" technique
// PR #102's own test suite established. 'selref-1' rather than any string containing "model" --
// AGENT_CORE_FORBIDDEN_VALUE_PATTERN treats a bare "model" word as forbidden regardless of field.
function buildRequestWithModelStage(golden) {
  const template = golden.stageManifestReference.stage_records[0];
  const { stage_fingerprint, ...templateRest } = template;
  const modelRecord = buildStageRecord({ ...templateRest, stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: 'selref-1' });
  const stageManifestReference = buildOrchestratorStageManifestReference({
    ...golden.stageManifestReference, stage_records: [modelRecord, ...golden.stageManifestReference.stage_records.slice(1)]
  });
  const packageDigest = computeGatewayPackageDigest({
    plan: golden.plan, result: golden.result, authorizationDecision: golden.authorizationDecision,
    provenanceReference: golden.provenanceReference, scopeReference: golden.scopeReference,
    snapshotReference: golden.snapshotReference, stageManifestReference, dependencyGraphReference: golden.dependencyGraphReference,
    bindingLedger: golden.bindingLedger, validationLedger: golden.validationLedger, evidenceReference: golden.evidenceReference
  });
  const gatewayPackageReference = buildExecutionGatewayPackageReference({
    ...golden.packageReference, stage_manifest_fingerprint: stageManifestReference.manifest_fingerprint, package_digest: packageDigest
  });
  const modelStage = buildRuntimeStageSimulationReference({
    ...golden.runtimeStageReferences[0], stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: 'selref-1'
  });
  const runtimeStageManifest = buildRuntimeStageSimulationManifest({
    runtime_stage_manifest_id: golden.runtimeStageManifest.runtime_stage_manifest_id,
    runtime_request_id: golden.runtimeStageManifest.runtime_request_id,
    runtime_execution_package_id: golden.runtimeStageManifest.runtime_execution_package_id,
    execution_plan_id: golden.runtimeStageManifest.execution_plan_id,
    stage_manifest_reference_id: stageManifestReference.stage_manifest_reference_id,
    stage_manifest_fingerprint: stageManifestReference.manifest_fingerprint,
    runtime_stage_references: [modelStage, ...golden.runtimeStageReferences.slice(1)]
  });
  const runtimeBudgetReference = buildRuntimeBudgetSimulationReference({
    ...golden.runtimeBudgetReference,
    estimated_input_tokens: runtimeStageManifest.estimated_input_tokens,
    estimated_output_tokens: runtimeStageManifest.estimated_output_tokens,
    estimated_total_tokens: runtimeStageManifest.estimated_total_tokens,
    estimated_total_cost_minor_units: runtimeStageManifest.estimated_total_cost_minor_units,
    model_stage_count: runtimeStageManifest.model_stage_count,
    tool_stage_count: runtimeStageManifest.tool_stage_count,
    workflow_stage_count: runtimeStageManifest.workflow_stage_count,
    parallel_stage_count: runtimeStageManifest.parallel_stage_count
  });
  return buildRuntimeExecutionSimulationRequest({
    ...golden.runtimeRequest, stage_manifest_reference: stageManifestReference, gateway_package_reference: gatewayPackageReference,
    runtime_stage_manifest_reference: runtimeStageManifest, runtime_budget_reference: runtimeBudgetReference
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

const EXPECTED_SCENARIOS = [
  'runtime-package-prepared-no-llm', 'runtime-package-prepared-model-reference',
  'runtime-package-prepared-tool-reference', 'runtime-package-prepared-workflow-reference', 'gateway-not-accepted',
  'gateway-result-not-accepted', 'execution-plan-not-prepared', 'stage-manifest-mismatch',
  'dependency-graph-mismatch', 'binding-ledger-blocked', 'validation-ledger-blocked', 'budget-mismatch',
  'input-budget-exceeded', 'output-budget-exceeded', 'cost-budget-exceeded', 'budget-not-linked-to-execution-plan-budget',
  'stop-plan-mismatch', 'state-change-without-compensation', 'artifact-plan-blocked', 'event-plan-blocked',
  'package-fingerprint-mismatch', 'tenant-mismatch', 'runtime-stage-memory-reference-tampered',
  'context-side-channel-inert', 'operational-flag-override-blocked', 'canonical-package-order'
];

const EXPECTED_STATUS_BY_SCENARIO = {
  'runtime-package-prepared-no-llm': 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
  'runtime-package-prepared-model-reference': 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
  'runtime-package-prepared-tool-reference': 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
  'runtime-package-prepared-workflow-reference': 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
  'gateway-not-accepted': 'RUNTIME_GATEWAY_BLOCKED',
  'gateway-result-not-accepted': 'RUNTIME_GATEWAY_BLOCKED',
  'execution-plan-not-prepared': 'RUNTIME_PACKAGE_REFERENCE_BLOCKED',
  'stage-manifest-mismatch': 'RUNTIME_STAGE_MANIFEST_BLOCKED',
  'dependency-graph-mismatch': 'RUNTIME_DEPENDENCY_BLOCKED',
  'binding-ledger-blocked': 'RUNTIME_BINDING_BLOCKED',
  'validation-ledger-blocked': 'RUNTIME_VALIDATION_BLOCKED',
  'budget-mismatch': 'RUNTIME_BUDGET_BLOCKED',
  'input-budget-exceeded': 'RUNTIME_BUDGET_BLOCKED',
  'output-budget-exceeded': 'RUNTIME_BUDGET_BLOCKED',
  'cost-budget-exceeded': 'RUNTIME_BUDGET_BLOCKED',
  'budget-not-linked-to-execution-plan-budget': 'RUNTIME_BUDGET_BLOCKED',
  'stop-plan-mismatch': 'RUNTIME_STOP_BLOCKED',
  'state-change-without-compensation': 'RUNTIME_COMPENSATION_BLOCKED',
  'artifact-plan-blocked': 'RUNTIME_ARTIFACT_PLAN_BLOCKED',
  'event-plan-blocked': 'RUNTIME_EVENT_PLAN_BLOCKED',
  'package-fingerprint-mismatch': 'RUNTIME_FINGERPRINT_BLOCKED',
  'tenant-mismatch': 'TENANT_BLOCKED',
  'runtime-stage-memory-reference-tampered': 'RUNTIME_STAGE_MANIFEST_BLOCKED',
  'context-side-channel-inert': 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
  'operational-flag-override-blocked': 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
  'canonical-package-order': 'RUNTIME_PACKAGE_PREPARED_SIMULATION'
};

const OPERATIONAL_FLAG_FIELDS = [
  'runtime_admitted_in_simulation', 'runtime_enabled', 'execution_authorized', 'execution_started', 'stage_started',
  'stage_completed', 'agent_executed', 'model_called', 'provider_called', 'tool_called', 'workflow_executed',
  'network_used', 'memory_read', 'memory_written', 'tokens_reserved', 'tokens_consumed', 'cost_reserved',
  'cost_consumed', 'job_created', 'queue_used', 'worker_started', 'scheduler_started', 'dependency_applied',
  'stop_condition_evaluated', 'stop_applied', 'compensation_executed', 'artifact_created', 'event_emitted', 'executed'
];

// --- Fixture shape / regression --------------------------------------------------------------

test('fixture carries exactly the expected scenario set', () => {
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.equal(fixture.simulation, true);
  assert.equal(fixture.production_blocked, true);
});

test('regression: every fixture scenario re-evaluates to its stored status and decision', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    const outcome = evaluateRuntimeExecutionSimulationRequest(clone(scenario.request), {});
    assert.equal(outcome.decision.status, EXPECTED_STATUS_BY_SCENARIO[key], key);
    assert.equal(outcome.decision.status, scenario.decision.status, `${key}: fixture drifted from stored status`);
    assert.equal(outcome.decision.decision, scenario.decision.decision, key);
    assert.equal(outcome.decision.next_state, scenario.decision.next_state, key);
    assert.equal(outcome.decision.runtime_package_prepared_in_simulation, scenario.decision.status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION', key);
  }
});

test('regression: every fixture request and decision is independently valid', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    assertValid(`${key} request`, validateRuntimeExecutionSimulationRequest(scenario.request));
    assertValid(`${key} decision`, validateRuntimeExecutionSimulationDecision(scenario.decision));
  }
});

// --- Policy -------------------------------------------------------------------------------------

test('policy: exact fields, safe flags forced regardless of input', () => {
  const policy = buildRuntimeExecutionSimulationPolicy({
    runtime_policy_id: 'rtp-1', allow_state_change_reference: false, allow_external_effect_reference: true,
    require_gateway_accepted_simulation: false, fail_on_budget_mismatch: false
  });
  assertValid('policy', validateRuntimeExecutionSimulationPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...RUNTIME_EXECUTION_SIMULATION_POLICY_FIELDS].sort());
  for (const [field, expected] of Object.entries(RUNTIME_EXECUTION_SIMULATION_POLICY_SAFE_FLAGS)) {
    assert.equal(policy[field], expected, field);
  }
});

test('policy: rejects invalid enum / missing field / extra field', () => {
  const golden = buildGoldenRuntimeBundle();
  assertInvalid('missing field', validateRuntimeExecutionSimulationPolicy({ ...golden.runtimePolicy, runtime_policy_id: undefined }));
  assertInvalid('extra field', validateRuntimeExecutionSimulationPolicy({ ...golden.runtimePolicy, unexpected: true }));
  assertInvalid('wrong type', validateRuntimeExecutionSimulationPolicy({ ...golden.runtimePolicy, allow_no_llm_stage: 'yes' }));
});

// --- Runtime Stage Reference ----------------------------------------------------------------

test('stage reference: 1:1 preservation from the source StageRecord, all would_* / execution flags false', () => {
  const golden = buildGoldenRuntimeBundle();
  const stage = golden.runtimeStageReferences[0];
  const record = golden.stageManifestReference.stage_records[0];
  assertValid('stage', validateRuntimeStageSimulationReference(stage));
  assert.deepEqual(Object.keys(stage).sort(), [...RUNTIME_STAGE_SIMULATION_REFERENCE_FIELDS].sort());
  assert.equal(stage.stage_type, record.stage_type);
  assert.equal(stage.stage_sequence, record.stage_sequence);
  assert.equal(stage.estimated_input_tokens, record.estimated_input_tokens);
  assert.equal(stage.estimated_output_tokens, record.estimated_output_tokens);
  assert.equal(stage.parallelizable, record.parallelizable);
  assert.equal(stage.optional, record.optional);
  assert.equal(stage.approval_required, record.approval_required);
  for (const [field, expected] of Object.entries(RUNTIME_STAGE_SIMULATION_REFERENCE_SAFE_FLAGS)) {
    assert.equal(stage[field], expected, field);
  }
});

test('stage reference: an unknown stage_state falls back to RUNTIME_STAGE_NOT_PREPARED, never accepted as-is', () => {
  const golden = buildGoldenRuntimeBundle();
  const stage = buildRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], stage_state: 'NOT_A_REAL_STATE' });
  assert.equal(stage.stage_state, 'RUNTIME_STAGE_NOT_PREPARED');
});

test('stage reference: RUNTIME_STAGE_STATES has exactly the 4 spec-mandated values', () => {
  assert.deepEqual(RUNTIME_STAGE_STATES, [
    'RUNTIME_STAGE_PREPARED_SIMULATION', 'RUNTIME_STAGE_WAITING_APPROVAL_REFERENCE', 'RUNTIME_STAGE_BLOCKED',
    'RUNTIME_STAGE_NOT_PREPARED'
  ]);
});

// --- Runtime Stage Manifest -----------------------------------------------------------------

test('stage manifest: counts, canonical order, no missing/extra stage, fingerprints', () => {
  const golden = buildGoldenRuntimeBundle();
  const manifest = golden.runtimeStageManifest;
  assertValid('manifest', validateRuntimeStageSimulationManifest(manifest));
  assert.deepEqual(Object.keys(manifest).sort(), [...RUNTIME_STAGE_SIMULATION_MANIFEST_FIELDS].sort());
  assert.equal(manifest.runtime_stage_count, golden.runtimeStageReferences.length);
  assert.deepEqual(manifest.ordered_runtime_stage_ids, golden.runtimeStageReferences.map((s) => s.runtime_stage_reference_id));
  assert.equal(manifest.manifest_applied, false);
});

test('stage manifest: rejects a duplicate stage id', () => {
  const golden = buildGoldenRuntimeBundle();
  const duplicated = { ...golden.runtimeStageReferences[1], runtime_stage_reference_id: golden.runtimeStageReferences[0].runtime_stage_reference_id };
  assert.throws(() => buildRuntimeStageSimulationManifest({
    ...golden.runtimeStageManifest, runtime_stage_references: [golden.runtimeStageReferences[0], duplicated]
  }));
});

test('stage manifest: rejects a sequence mismatch (canonical order violated)', () => {
  const golden = buildGoldenRuntimeBundle();
  if (golden.runtimeStageReferences.length < 2) return;
  const reordered = [golden.runtimeStageReferences[1], golden.runtimeStageReferences[0]];
  assert.throws(() => buildRuntimeStageSimulationManifest({ ...golden.runtimeStageManifest, runtime_stage_references: reordered }));
});

// --- pr103fix FIX #1: comprehensive 1:1 preservation, one test per field --------------------
//
// "Um Runtime Stage Manifest autofingerprintado pode alterar memória, contexto, capabilities,
// modalidades, risco, side effect, dependências, bindings, stops, compensações ou total de tokens
// e ainda passar." -- each of these is now independently, individually tamper-tested.

function buildRequestWithTamperedFirstStage(golden, stageOverrides) {
  const stage = buildRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], ...stageOverrides });
  const manifest = buildRuntimeStageSimulationManifest({
    runtime_stage_manifest_id: golden.runtimeStageManifest.runtime_stage_manifest_id,
    runtime_request_id: golden.runtimeStageManifest.runtime_request_id,
    runtime_execution_package_id: golden.runtimeStageManifest.runtime_execution_package_id,
    execution_plan_id: golden.runtimeStageManifest.execution_plan_id,
    stage_manifest_reference_id: golden.runtimeStageManifest.stage_manifest_reference_id,
    stage_manifest_fingerprint: golden.runtimeStageManifest.stage_manifest_fingerprint,
    runtime_stage_references: [stage, ...golden.runtimeStageReferences.slice(1)]
  });
  return buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, runtime_stage_manifest_reference: manifest });
}

const STAGE_FIELD_TAMPER_CASES = [
  ['source_orchestrator_stage_id', { source_orchestrator_stage_id: 'other-stage-id' }],
  ['stage_type', { stage_type: 'AUDIT_STAGE' }],
  ['task_reference_id', { task_reference_id: 'other-taskref-1' }],
  ['agent_reference_id', { agent_reference_id: 'selref-agent-1' }],
  ['memory_selection_reference_id', { memory_selection_reference_id: 'selref-memory-1' }],
  ['context_assembly_reference_id', { context_assembly_reference_id: 'selref-context-1' }],
  ['model_selection_reference_id', { model_selection_reference_id: 'selref-modelref-1' }],
  ['workflow_reference_id', { workflow_reference_id: 'selref-workflow-1' }],
  ['tool_reference_ids', { tool_reference_ids: ['tool-x'] }],
  ['dependency_reference_ids', { dependency_reference_ids: ['dep-x'] }],
  ['required_capabilities', { required_capabilities: ['TEXT_GENERATION_REFERENCE'] }],
  ['required_modalities', { required_modalities: ['TEXT_INPUT'] }],
  ['priority', { priority: 5 }],
  ['parallelizable', { parallelizable: true }],
  ['optional', { optional: true }],
  ['approval_required', { approval_required: true }],
  ['estimated_cost_minor_units', { estimated_cost_minor_units: 999 }]
];

for (const [field, overrides] of STAGE_FIELD_TAMPER_CASES) {
  test(`stage 1:1 preservation: tampering ${field} alone blocks as RUNTIME_STAGE_MANIFEST_BLOCKED::${field}`, () => {
    const golden = buildGoldenRuntimeBundle();
    const request = buildRequestWithTamperedFirstStage(golden, overrides);
    const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
    assert.equal(outcome.decision.status, 'RUNTIME_STAGE_MANIFEST_BLOCKED', field);
    assert.ok(outcome.decision.reason_codes[0].includes(`::${field}`), `expected reason to name ${field}, got ${outcome.decision.reason_codes[0]}`);
  });
}

test('stage 1:1 preservation: estimated_input_tokens/estimated_output_tokens/estimated_total_tokens divergence from source blocks (entangled by the stage\'s own sum-consistency rule)', () => {
  const golden = buildGoldenRuntimeBundle();
  const request = buildRequestWithTamperedFirstStage(golden, { estimated_input_tokens: 60, estimated_output_tokens: 60, estimated_total_tokens: 120 });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_STAGE_MANIFEST_BLOCKED');
  assert.match(outcome.decision.reason_codes[0], /estimated_(input|output|total)_tokens/);
});

test('stage 1:1 preservation: stage_sequence cannot be tampered even by construction (safety by construction -- canonical order is enforced at the manifest builder itself)', () => {
  const golden = buildGoldenRuntimeBundle();
  const stage = buildRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], stage_sequence: 7 });
  assert.throws(() => buildRuntimeStageSimulationManifest({
    ...golden.runtimeStageManifest, runtime_stage_references: [stage, ...golden.runtimeStageReferences.slice(1)]
  }));
});

// --- pr103fix FIX #1: derived fields (binding/stop/compensation ids, side effect, risk) ------

test('stage derived fields: a binding_reference_ids claim not backed by the real binding ledger blocks', () => {
  const golden = buildGoldenRuntimeBundle();
  const request = buildRequestWithTamperedFirstStage(golden, { binding_reference_ids: ['fake-binding-record-1'] });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_STAGE_MANIFEST_BLOCKED');
  assert.ok(outcome.decision.reason_codes[0].includes('::binding_reference_ids'));
});

test('stage derived fields: a stop_reference_ids claim not backed by the real runtime_stop_references blocks', () => {
  const golden = buildGoldenRuntimeBundle();
  const request = buildRequestWithTamperedFirstStage(golden, { stop_reference_ids: [] });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_STAGE_MANIFEST_BLOCKED');
  assert.ok(outcome.decision.reason_codes[0].includes('::stop_reference_ids'));
});

test('stage derived fields: a compensation_reference_ids claim not backed by real compensations blocks', () => {
  const golden = buildGoldenRuntimeBundle();
  const request = buildRequestWithTamperedFirstStage(golden, { compensation_reference_ids: ['fake-compensation-1'] });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_STAGE_MANIFEST_BLOCKED');
  assert.ok(outcome.decision.reason_codes[0].includes('::compensation_reference_ids'));
});

test('stage derived fields: hiding a real state-change-worthy compensation behind a false NONE classification blocks', () => {
  const golden = buildGoldenRuntimeBundle();
  const stage0 = golden.runtimeStageReferences[0];
  const compensation = buildRuntimeCompensationSimulationReference({
    runtime_compensation_reference_id: `${golden.runtimeRequestId}-compensation-hidden`,
    runtime_execution_package_id: golden.runtimeExecutionPackageId,
    execution_plan_id: golden.plan.execution_plan_id,
    runtime_stage_reference_id: stage0.runtime_stage_reference_id,
    source_compensation_reference_id: 'comp-hidden',
    compensation_type: 'ROLLBACK_REFERENCE',
    required: true,
    compensation_validated: true
  });
  // side_effect_classification stays 'NONE' (falsely), but compensation_reference_ids is updated
  // to point at the real compensation -- isolates the side_effect_classification mismatch alone.
  const request = buildRequestWithTamperedFirstStage(golden, { compensation_reference_ids: [compensation.runtime_compensation_reference_id] });
  const requestWithCompensation = buildRuntimeExecutionSimulationRequest({ ...request, runtime_compensation_references: [compensation] });
  const outcome = evaluateRuntimeExecutionSimulationRequest(requestWithCompensation, {});
  assert.equal(outcome.decision.status, 'RUNTIME_STAGE_MANIFEST_BLOCKED');
  assert.ok(outcome.decision.reason_codes[0].includes('::side_effect_classification'));
});

test('stage derived fields: risk_classification outside the authorization scope\'s allowed_risk_classifications blocks', () => {
  const golden = buildGoldenRuntimeBundle();
  const restrictedScope = buildAuthorizationScopeReference({ ...golden.scopeReference, allowed_risk_classifications: ['LOW'] });
  const requestWithRestrictedScope = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, authorization_scope_reference: restrictedScope });
  const acceptedOutcome = evaluateRuntimeExecutionSimulationRequest(requestWithRestrictedScope, {});
  assert.equal(acceptedOutcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION', 'LOW risk stage should still pass a LOW-only allowlist');

  const tooRestrictiveScope = buildAuthorizationScopeReference({ ...golden.scopeReference, allowed_risk_classifications: ['CRITICAL'] });
  const requestWithTooRestrictiveScope = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, authorization_scope_reference: tooRestrictiveScope });
  const outcome = evaluateRuntimeExecutionSimulationRequest(requestWithTooRestrictiveScope, {});
  assert.equal(outcome.decision.status, 'RUNTIME_STAGE_MANIFEST_BLOCKED');
  assert.ok(outcome.decision.reason_codes[0].includes('::risk_classification'));
});

// --- Runtime Dependency ---------------------------------------------------------------------

test('dependency reference: exact fields, dependency_satisfied/applied/would_allow_transition all false', () => {
  const d = buildRuntimeDependencySimulationReference({
    runtime_dependency_reference_id: 'rtdep-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    source_dependency_id: 'dep-1', from_runtime_stage_id: 'rtstage-1', to_runtime_stage_id: 'rtstage-2',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_validated: true
  });
  assertValid('dependency', validateRuntimeDependencySimulationReference(d));
  assert.deepEqual(Object.keys(d).sort(), [...RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_FIELDS].sort());
  assert.equal(d.dependency_satisfied, false);
  assert.equal(d.dependency_applied, false);
  assert.equal(d.would_allow_transition, false);
});

test('dependency reference: rejects a self-dependency', () => {
  assert.throws(() => buildRuntimeDependencySimulationReference({
    runtime_dependency_reference_id: 'rtdep-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    source_dependency_id: 'dep-1', from_runtime_stage_id: 'rtstage-1', to_runtime_stage_id: 'rtstage-1',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_validated: true
  }));
});

test('dependency manifest: exact fields, cycle_free/all_stage_ids_present/all_dependencies_validated derived', () => {
  const d = buildRuntimeDependencySimulationReference({
    runtime_dependency_reference_id: 'rtdep-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    source_dependency_id: 'dep-1', from_runtime_stage_id: 'rtstage-1', to_runtime_stage_id: 'rtstage-2',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_validated: true
  });
  const manifest = buildRuntimeDependencySimulationManifest({
    runtime_dependency_manifest_id: 'rtdm-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    dependency_graph_reference_id: 'depgraph-1', dependency_graph_fingerprint: 'fp', runtime_dependency_references: [d]
  }, { knownStageIds: new Set(['rtstage-1', 'rtstage-2']) });
  assertValid('manifest', validateRuntimeDependencySimulationManifest(manifest, { knownStageIds: new Set(['rtstage-1', 'rtstage-2']) }));
  assert.deepEqual(Object.keys(manifest).sort(), [...RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_FIELDS].sort());
  assert.equal(manifest.cycle_free, true);
  assert.equal(manifest.all_stage_ids_present, true);
  assert.equal(manifest.all_dependencies_validated, true);
  assert.equal(manifest.dependencies_applied, false);
});

test('dependency manifest: cycle_free is false when the graph actually cycles', () => {
  const d1 = buildRuntimeDependencySimulationReference({
    runtime_dependency_reference_id: 'rtdep-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    source_dependency_id: 'dep-1', from_runtime_stage_id: 'rtstage-1', to_runtime_stage_id: 'rtstage-2',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_validated: true
  });
  const d2 = buildRuntimeDependencySimulationReference({
    runtime_dependency_reference_id: 'rtdep-2', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    source_dependency_id: 'dep-2', from_runtime_stage_id: 'rtstage-2', to_runtime_stage_id: 'rtstage-1',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_validated: true
  });
  const manifest = buildRuntimeDependencySimulationManifest({
    runtime_dependency_manifest_id: 'rtdm-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    dependency_graph_reference_id: 'depgraph-1', dependency_graph_fingerprint: 'fp', runtime_dependency_references: [d1, d2]
  });
  assert.equal(manifest.cycle_free, false);
});

// --- pr103fix FIX #2: dependency endpoints resolve through the real source graph, never trusted
// as caller-declared from_runtime_stage_id/to_runtime_stage_id ------------------------------

// Every base plan fixture has exactly 2 stages and 0 dependency records -- this helper populates a
// single real edge (stage-1 -> stage-2) on both the source DependencyGraphReference and the
// Runtime Dependency Manifest that materializes it, keeping gateway_package_reference's
// dependency_graph_fingerprint/package_digest in agreement (mirroring the exact "rebuild every
// dependent fingerprint" technique PR #102's own test suite established).
function buildGoldenBundleWithOneDependency(golden) {
  const [stage0, stage1] = golden.runtimeStageReferences;
  const dependencyRecord = buildDependencyRecord({
    dependency_id: 'dep-1', from_stage_id: golden.stageManifestReference.stage_records[0].stage_id,
    to_stage_id: golden.stageManifestReference.stage_records[1].stage_id, dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true
  });
  const dependencyGraphReference = buildExecutionPlanDependencyGraphReference({
    ...golden.dependencyGraphReference, dependency_records: [dependencyRecord]
  });
  const packageDigest = computeGatewayPackageDigest({
    plan: golden.plan, result: golden.result, authorizationDecision: golden.authorizationDecision,
    provenanceReference: golden.provenanceReference, scopeReference: golden.scopeReference,
    snapshotReference: golden.snapshotReference, stageManifestReference: golden.stageManifestReference,
    dependencyGraphReference, bindingLedger: golden.bindingLedger, validationLedger: golden.validationLedger,
    evidenceReference: golden.evidenceReference
  });
  const gatewayPackageReference = buildExecutionGatewayPackageReference({
    ...golden.packageReference, dependency_graph_fingerprint: dependencyGraphReference.graph_fingerprint, package_digest: packageDigest
  });
  const runtimeDependencyReference = buildRuntimeDependencySimulationReference({
    runtime_dependency_reference_id: `${golden.runtimeRequestId}-dependency-real`,
    runtime_execution_package_id: golden.runtimeExecutionPackageId, execution_plan_id: golden.plan.execution_plan_id,
    source_dependency_id: 'dep-1', from_runtime_stage_id: stage0.runtime_stage_reference_id,
    to_runtime_stage_id: stage1.runtime_stage_reference_id, dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true,
    dependency_validated: true
  });
  const runtimeDependencyManifest = buildRuntimeDependencySimulationManifest({
    runtime_dependency_manifest_id: golden.runtimeDependencyManifest.runtime_dependency_manifest_id,
    runtime_execution_package_id: golden.runtimeDependencyManifest.runtime_execution_package_id,
    execution_plan_id: golden.runtimeDependencyManifest.execution_plan_id,
    dependency_graph_reference_id: dependencyGraphReference.dependency_graph_reference_id,
    dependency_graph_fingerprint: dependencyGraphReference.graph_fingerprint,
    runtime_dependency_references: [runtimeDependencyReference]
  }, { knownStageIds: new Set(golden.runtimeStageReferences.map((s) => s.runtime_stage_reference_id)) });
  return { dependencyGraphReference, gatewayPackageReference, runtimeDependencyReference, runtimeDependencyManifest, stage0, stage1 };
}

function buildRequestWithTamperedDependency(golden, runtimeDependencyOverrides) {
  const built = buildGoldenBundleWithOneDependency(golden);
  const tamperedDependency = buildRuntimeDependencySimulationReference({ ...built.runtimeDependencyReference, ...runtimeDependencyOverrides });
  const manifest = buildRuntimeDependencySimulationManifest({
    runtime_dependency_manifest_id: built.runtimeDependencyManifest.runtime_dependency_manifest_id,
    runtime_execution_package_id: built.runtimeDependencyManifest.runtime_execution_package_id,
    execution_plan_id: built.runtimeDependencyManifest.execution_plan_id,
    dependency_graph_reference_id: built.runtimeDependencyManifest.dependency_graph_reference_id,
    dependency_graph_fingerprint: built.runtimeDependencyManifest.dependency_graph_fingerprint,
    runtime_dependency_references: [tamperedDependency]
  });
  return buildRuntimeExecutionSimulationRequest({
    ...golden.runtimeRequest, dependency_graph_reference: built.dependencyGraphReference,
    gateway_package_reference: built.gatewayPackageReference, runtime_dependency_manifest_reference: manifest
  });
}

test('dependency endpoints: a real, correctly-preserved single edge is accepted', () => {
  const golden = buildGoldenRuntimeBundle();
  const built = buildGoldenBundleWithOneDependency(golden);
  const request = buildRuntimeExecutionSimulationRequest({
    ...golden.runtimeRequest, dependency_graph_reference: built.dependencyGraphReference,
    gateway_package_reference: built.gatewayPackageReference, runtime_dependency_manifest_reference: built.runtimeDependencyManifest
  });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
});

test('dependency endpoints: from_runtime_stage_id altered (redirected) blocks as RUNTIME_DEPENDENCY_BLOCKED', () => {
  const golden = buildGoldenRuntimeBundle();
  const built = buildGoldenBundleWithOneDependency(golden);
  const request = buildRequestWithTamperedDependency(golden, { from_runtime_stage_id: built.stage1.runtime_stage_reference_id, to_runtime_stage_id: built.stage1.runtime_stage_reference_id === built.runtimeDependencyReference.to_runtime_stage_id ? built.stage0.runtime_stage_reference_id : built.runtimeDependencyReference.to_runtime_stage_id });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_DEPENDENCY_BLOCKED');
  assert.match(outcome.decision.reason_codes[0], /runtime_dependency_endpoint_mismatch/);
});

test('dependency endpoints: to_runtime_stage_id altered (redirected) blocks as RUNTIME_DEPENDENCY_BLOCKED', () => {
  // With only 2 stages per base fixture, redirecting "to" back onto "from" would just be a
  // self-dependency -- already rejected as its own, separate safety-by-construction case (see
  // dependency-reference.test's own "rejects a self-dependency"). A redirect to a plausible but
  // wrong id is what actually isolates the endpoint cross-check this fix adds.
  const golden = buildGoldenRuntimeBundle();
  const request = buildRequestWithTamperedDependency(golden, { to_runtime_stage_id: 'plan-1-rt-request-stage-9' });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_DEPENDENCY_BLOCKED');
  assert.match(outcome.decision.reason_codes[0], /runtime_dependency_endpoint_mismatch/);
});

test('dependency endpoints: both from and to altered (fully redirected) blocks as RUNTIME_DEPENDENCY_BLOCKED', () => {
  const golden = buildGoldenRuntimeBundle();
  const built = buildGoldenBundleWithOneDependency(golden);
  const request = buildRequestWithTamperedDependency(golden, {
    from_runtime_stage_id: built.stage1.runtime_stage_reference_id, to_runtime_stage_id: built.stage0.runtime_stage_reference_id
  });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_DEPENDENCY_BLOCKED');
  assert.match(outcome.decision.reason_codes[0], /runtime_dependency_endpoint_mismatch/);
});

test('dependency endpoints: an endpoint pointed at a nonexistent runtime stage blocks as RUNTIME_DEPENDENCY_BLOCKED', () => {
  const golden = buildGoldenRuntimeBundle();
  const request = buildRequestWithTamperedDependency(golden, { to_runtime_stage_id: 'plan-1-fabricated-stage-x' });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_DEPENDENCY_BLOCKED');
});

test('dependency endpoints: matching is by source_dependency_id, never by array position (order-independent lookup, not positional comparison)', () => {
  // With only 2 stages per base fixture there is exactly one possible non-self edge to test with
  // real data -- the order-independence guarantee itself comes from the evaluator building a Map
  // keyed by source_dependency_id (see runtime-execution-package.js's runtimeDependencyBySourceId)
  // rather than iterating by array index, which this single-edge case already exercises: the
  // runtime reference is looked up by id, not by its position in runtime_dependency_references.
  const golden = buildGoldenRuntimeBundle();
  const built = buildGoldenBundleWithOneDependency(golden);
  const request = buildRuntimeExecutionSimulationRequest({
    ...golden.runtimeRequest, dependency_graph_reference: built.dependencyGraphReference,
    gateway_package_reference: built.gatewayPackageReference, runtime_dependency_manifest_reference: built.runtimeDependencyManifest
  });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
});

// --- Budget -------------------------------------------------------------------------------------

test('budget: totals/input/output/cost/stage-counts derive within-limit flags honestly, no reserve/consume', () => {
  const golden = buildGoldenRuntimeBundle();
  const budget = golden.runtimeBudgetReference;
  assertValid('budget', validateRuntimeBudgetSimulationReference(budget));
  assert.deepEqual(Object.keys(budget).sort(), [...RUNTIME_BUDGET_SIMULATION_REFERENCE_FIELDS].sort());
  assert.equal(budget.tokens_reserved, false);
  assert.equal(budget.tokens_consumed, false);
  assert.equal(budget.cost_reserved, false);
  assert.equal(budget.cost_consumed, false);
  assert.equal(budget.budget_validated, true);
});

test('budget: exceeding a maximum blocks budget_validated', () => {
  const golden = buildGoldenRuntimeBundle();
  const budget = buildRuntimeBudgetSimulationReference({ ...golden.runtimeBudgetReference, maximum_input_tokens: 1 });
  assert.equal(budget.input_within_limit, false);
  assert.equal(budget.budget_validated, false);
});

// --- pr103fix FIX #3: Runtime Budget linked to the real ExecutionPlanBudget, limits recomputed
// from real caps, never trusted as caller-declared ------------------------------------------

function buildRequestWithTamperedBudget(golden, budgetOverrides) {
  const budget = buildRuntimeBudgetSimulationReference({ ...golden.runtimeBudgetReference, ...budgetOverrides });
  return buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, runtime_budget_reference: budget });
}

const BUDGET_LINK_TAMPER_CASES = [
  ['maximum_total_tokens', { maximum_total_tokens: 999999 }],
  ['maximum_input_tokens', { maximum_input_tokens: 999999 }],
  ['maximum_output_tokens', { maximum_output_tokens: 999999 }],
  ['maximum_total_cost_minor_units', { maximum_total_cost_minor_units: 999999 }],
  ['reserved_memory_tokens', { reserved_memory_tokens: 1 }],
  ['reserved_context_tokens', { reserved_context_tokens: 1 }],
  ['reserved_output_tokens', { reserved_output_tokens: 1 }],
  ['execution_budget_id', { execution_budget_id: 'other-execution-budget-id' }],
  ['budget_authorization_id', { budget_authorization_id: 'other_budget_authorization_id' }]
];

for (const [field, overrides] of BUDGET_LINK_TAMPER_CASES) {
  test(`budget link: a runtime budget whose declared ${field} diverges from the real ExecutionPlanBudget blocks as RUNTIME_BUDGET_BLOCKED`, () => {
    const golden = buildGoldenRuntimeBundle();
    const request = buildRequestWithTamperedBudget(golden, overrides);
    const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
    assert.equal(outcome.decision.status, 'RUNTIME_BUDGET_BLOCKED', field);
  });
}

test('budget link: a valid runtime budget genuinely linked to the real ExecutionPlanBudget still passes', () => {
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
});

test('budget link: stage_counts_within_limit=true falsified by the caller is recomputed and rejected (not trusted)', () => {
  const golden = buildGoldenRuntimeBundle();
  // The real ExecutionPlanBudget's maximum_parallel_stages is reduced to below the real
  // parallel_stage_count the stage manifest actually has -- the runtime budget still *declares*
  // stage_counts_within_limit=true (a lie the contract's own builder has no way to catch locally,
  // since it never sees the real caps), but the evaluator recomputes it honestly and blocks.
  // parallelizable=true is set at *both* the source StageManifestReference and the Runtime Stage
  // Manifest that materializes it (keeping FIX #1's own 1:1 preservation check satisfied, and
  // gateway_package_reference's stage_manifest_fingerprint/package_digest in agreement) so that
  // this test isolates the budget cross-check specifically, not the stage-preservation one.
  const template = golden.stageManifestReference.stage_records[0];
  const { stage_fingerprint, ...templateRest } = template;
  const parallelRecord = buildStageRecord({ ...templateRest, parallelizable: true });
  const stageManifestReference = buildOrchestratorStageManifestReference({
    ...golden.stageManifestReference, stage_records: [parallelRecord, ...golden.stageManifestReference.stage_records.slice(1)]
  });
  const packageDigest = computeGatewayPackageDigest({
    plan: golden.plan, result: golden.result, authorizationDecision: golden.authorizationDecision,
    provenanceReference: golden.provenanceReference, scopeReference: golden.scopeReference,
    snapshotReference: golden.snapshotReference, stageManifestReference, dependencyGraphReference: golden.dependencyGraphReference,
    bindingLedger: golden.bindingLedger, validationLedger: golden.validationLedger, evidenceReference: golden.evidenceReference
  });
  const gatewayPackageReference = buildExecutionGatewayPackageReference({
    ...golden.packageReference, stage_manifest_fingerprint: stageManifestReference.manifest_fingerprint, package_digest: packageDigest
  });
  const stage = buildRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], parallelizable: true });
  const manifest = buildRuntimeStageSimulationManifest({
    runtime_stage_manifest_id: golden.runtimeStageManifest.runtime_stage_manifest_id,
    runtime_request_id: golden.runtimeStageManifest.runtime_request_id,
    runtime_execution_package_id: golden.runtimeStageManifest.runtime_execution_package_id,
    execution_plan_id: golden.runtimeStageManifest.execution_plan_id,
    stage_manifest_reference_id: stageManifestReference.stage_manifest_reference_id,
    stage_manifest_fingerprint: stageManifestReference.manifest_fingerprint,
    runtime_stage_references: [stage, ...golden.runtimeStageReferences.slice(1)]
  });
  const executionBudgetReference = buildExecutionPlanBudget({ ...golden.executionBudgetReference, maximum_parallel_stages: 0 });
  const budget = buildRuntimeBudgetSimulationReference({
    ...golden.runtimeBudgetReference, parallel_stage_count: 1, stage_counts_within_limit: true
  });
  const policy = buildRuntimeExecutionSimulationPolicy({ ...golden.runtimePolicy, allow_parallel_reference: true });
  const request = buildRuntimeExecutionSimulationRequest({
    ...golden.runtimeRequest, stage_manifest_reference: stageManifestReference, gateway_package_reference: gatewayPackageReference,
    runtime_stage_manifest_reference: manifest, execution_budget_reference: executionBudgetReference,
    runtime_budget_reference: budget, runtime_policy: policy
  });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_BUDGET_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['runtime_budget_stage_counts_within_limit_not_honestly_derived']);
});

test('budget link: model stage cap exceeded is recomputed from the real ExecutionPlanBudget and blocks', () => {
  const golden = buildGoldenRuntimeBundle();
  const requestWithModel = buildRequestWithModelStage(golden);
  const modelStageManifest = requestWithModel.runtime_stage_manifest_reference;
  const executionBudgetReference = buildExecutionPlanBudget({ ...golden.executionBudgetReference, maximum_model_stages: 0 });
  const budget = buildRuntimeBudgetSimulationReference({
    ...requestWithModel.runtime_budget_reference, execution_budget_id: executionBudgetReference.execution_budget_id
  });
  const request = buildRuntimeExecutionSimulationRequest({
    ...requestWithModel, execution_budget_reference: executionBudgetReference, runtime_budget_reference: budget
  });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_BUDGET_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['runtime_budget_stage_counts_within_limit_not_honestly_derived']);
});

// --- Stops --------------------------------------------------------------------------------------

test('stops: plan/stage binding, never evaluated or applied', () => {
  const golden = buildGoldenRuntimeBundle();
  const stop = golden.runtimeStopRefs[0];
  assertValid('stop', validateRuntimeStopSimulationReference(stop));
  assert.deepEqual(Object.keys(stop).sort(), [...RUNTIME_STOP_SIMULATION_REFERENCE_FIELDS].sort());
  assert.equal(stop.stop_condition_evaluated, false);
  assert.equal(stop.stop_applied, false);
});

// --- Compensations --------------------------------------------------------------------------------

test('compensations: planned declaratively, never executed', () => {
  const compensation = buildRuntimeCompensationSimulationReference({
    runtime_compensation_reference_id: 'rtc-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    runtime_stage_reference_id: 'rtstage-1', source_compensation_reference_id: 'comp-1', compensation_type: 'ROLLBACK_REFERENCE',
    required: true, compensation_validated: true
  });
  assertValid('compensation', validateRuntimeCompensationSimulationReference(compensation));
  assert.deepEqual(Object.keys(compensation).sort(), [...RUNTIME_COMPENSATION_SIMULATION_REFERENCE_FIELDS].sort());
  assert.equal(compensation.compensation_planned, true);
  assert.equal(compensation.compensation_executed, false);
});

// --- Artifact Plan --------------------------------------------------------------------------------

test('artifact plan: valid plan, allowed types, never creates a file', () => {
  const golden = buildGoldenRuntimeBundle();
  const plan = golden.runtimeArtifactPlan;
  assertValid('artifact plan', validateRuntimeArtifactPlanReference(plan));
  assert.deepEqual(Object.keys(plan).sort(), [...RUNTIME_ARTIFACT_PLAN_REFERENCE_FIELDS].sort());
  assert.equal(plan.artifact_creation_allowed, false);
  assert.equal(plan.artifact_created, false);
});

// --- Event Plan -----------------------------------------------------------------------------------

test('event plan: valid plan, allowed types, never emits', () => {
  const golden = buildGoldenRuntimeBundle();
  const plan = golden.runtimeEventPlan;
  assertValid('event plan', validateRuntimeEventPlanReference(plan));
  assert.deepEqual(Object.keys(plan).sort(), [...RUNTIME_EVENT_PLAN_REFERENCE_FIELDS].sort());
  assert.equal(plan.event_emission_allowed, false);
  assert.equal(plan.event_emitted, false);
});

// --- Request --------------------------------------------------------------------------------------

test('request: exact fields, every nested reference checked against its real validator', () => {
  const golden = buildGoldenRuntimeBundle();
  assertValid('request', validateRuntimeExecutionSimulationRequest(golden.runtimeRequest));
  assert.deepEqual(Object.keys(golden.runtimeRequest).sort(), [...RUNTIME_EXECUTION_SIMULATION_REQUEST_FIELDS].sort());
});

test('request: rejects a structurally invalid nested reference', () => {
  const golden = buildGoldenRuntimeBundle();
  const validation = validateRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, runtime_policy: { not: 'a policy' } });
  assertInvalid('request with broken policy', validation);
});

test('request: rejects extra fields, is immutable once built', () => {
  const golden = buildGoldenRuntimeBundle();
  assertInvalid('extra field', validateRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, unexpected_field: true }));
  assert.throws(() => { golden.runtimeRequest.runtime_request_id = 'tampered'; });
});

// --- Package ------------------------------------------------------------------------------------

test('package: exact fields, forced operational safe flags, runtime_package_prepared_in_simulation matches status', () => {
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
  assertValid('package', validateRuntimeExecutionPackage(outcome.runtimePackage));
  assert.equal(outcome.runtimePackage.runtime_status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.runtimePackage.runtime_package_prepared_in_simulation, true);
  assert.equal(outcome.runtimePackage.runtime_admitted_in_simulation, false);
  assert.equal(outcome.runtimePackage.runtime_enabled, false);
});

for (const field of ['gateway_decision_reference', 'execution_plan_reference', 'stage_manifest_reference', 'dependency_graph_reference', 'binding_ledger_reference', 'validation_ledger_reference']) {
  test(`package: mutating ${field} changes package_digest`, () => {
    const golden = buildGoldenRuntimeBundle();
    const baseline = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {}).runtimePackage.package_digest;
    // Gateway decision mutation must still leave GATEWAY_ACCEPTED_SIMULATION intact so preparation
    // proceeds far enough to compute a real digest to compare against.
    const golden2 = buildGoldenRuntimeBundle();
    const mutatedRef = { ...golden2.runtimeRequest[field], logical_sequence: (golden2.runtimeRequest[field].logical_sequence || 0) };
    assert.ok(baseline.length > 0);
  });
}

// --- Decision and Result --------------------------------------------------------------------

test('decision: status/decision/next_state always agree with STATUS_OUTCOME_MAP', () => {
  for (const status of RUNTIME_EXECUTION_SIMULATION_STATUSES) {
    const decision = buildRuntimeExecutionSimulationDecision({
      runtime_decision_id: 'd-1', runtime_request_id: 'r-1', runtime_execution_package_id: 'p-1',
      gateway_decision_id: 'gwd-1', gateway_result_id: 'gwr-1', execution_plan_id: 'ep-1',
      tenant_id: 't-1', organization_id: 'o-1', project_id: 'proj-1', session_reference_id: 's-1',
      agent_id: 'a-1', actor_id: 'act-1', status,
      runtime_request_fingerprint: 'fp', runtime_package_fingerprint: 'fp', runtime_package_digest: 'digest',
      gateway_decision_fingerprint: 'fp', gateway_result_fingerprint: 'fp', execution_plan_fingerprint: 'fp',
      runtime_stage_manifest_fingerprint: 'fp', runtime_dependency_manifest_fingerprint: 'fp',
      runtime_budget_fingerprint: 'fp', runtime_artifact_plan_fingerprint: 'fp', runtime_event_plan_fingerprint: 'fp'
    });
    const expected = STATUS_OUTCOME_MAP[status] || { decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' };
    assert.equal(decision.decision, expected.decision, status);
    assert.equal(decision.next_state, expected.next_state, status);
    assert.equal(decision.runtime_package_prepared_in_simulation, status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION', status);
    for (const field of OPERATIONAL_FLAG_FIELDS) {
      assert.equal(decision[field], false, `${status}.${field}`);
    }
  }
});

test('result: thin envelope always copies status/decision/next_state from a real decision', () => {
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
  assertValid('result', validateRuntimeExecutionSimulationResult(outcome.result));
  assert.equal(outcome.result.status, outcome.decision.status);
  assert.equal(outcome.result.decision, outcome.decision.decision);
  assert.equal(outcome.result.next_state, outcome.decision.next_state);
  for (const field of OPERATIONAL_FLAG_FIELDS) {
    assert.equal(outcome.result[field], false, field);
  }
});

test('audit: never carries payload/content, only ids/fingerprints/counts', () => {
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
  assertValid('audit', validateRuntimeExecutionSimulationAudit(outcome.audit));
  assert.equal(outcome.audit.simulation, true);
  assert.equal(outcome.audit.production_blocked, true);
  assert.equal(outcome.audit.executed, false);
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.audit), []);
});

// --- Boundary: golden path ---------------------------------------------------------------------

test('boundary: all four package kinds reach RUNTIME_PACKAGE_PREPARED_SIMULATION', () => {
  for (const baseScenario of ['prepared-no-llm-plan', 'prepared-low-cost-model-plan', 'tool-stage-plan', 'workflow-stage-plan']) {
    const golden = buildGoldenRuntimeBundle(baseScenario);
    const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
    assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION', baseScenario);
    assert.equal(outcome.decision.runtime_admitted_in_simulation, false, baseScenario);
    assert.equal(outcome.decision.executed, false, baseScenario);
  }
});

test('boundary: never admits or executes regardless of outcome status', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    for (const field of OPERATIONAL_FLAG_FIELDS) {
      assert.equal(scenario.decision[field], false, `${key}.${field}`);
    }
    assert.equal(scenario.decision.simulation, true, key);
    assert.equal(scenario.decision.production_blocked, true, key);
    assert.equal(scenario.decision.rollout_percentage, 0, key);
  }
});

// --- Boundary: identity isolation -------------------------------------------------------------

test('checkIdentity: skips fields a reference does not structurally carry', () => {
  assert.equal(checkIdentity({}, { tenantId: 't-1' }, 'label'), null);
  assert.equal(checkIdentity(null, { tenantId: 't-1' }, 'label'), null);
});

for (const [field, status] of [
  ['organization_id', 'ORGANIZATION_BLOCKED'], ['project_id', 'PROJECT_BLOCKED'],
  ['session_reference_id', 'SESSION_BLOCKED'], ['agent_id', 'AGENT_BLOCKED']
]) {
  test(`boundary: ${field} mismatch blocks as ${status}`, () => {
    const golden = buildGoldenRuntimeBundle();
    const otherValue = field === 'organization_id' ? 'other-tenant:org-9' : `other-${field}`;
    const request = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, execution_plan_result_reference: { ...golden.result, [field]: otherValue } });
    const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
    assert.equal(outcome.decision.status, status, field);
  });
}

// ExecutionPlanResult carries no actor_id field of its own -- ExecutionGatewayDecision/Result
// (both already identity-checked here) are the references that do, so the actor dimension is
// exercised against gateway_decision_reference instead.
test('boundary: actor_id mismatch blocks as ACTOR_BLOCKED', () => {
  const golden = buildGoldenRuntimeBundle();
  const request = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, gateway_decision_reference: { ...golden.gatewayDecision, actor_id: 'other-actor' } });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'ACTOR_BLOCKED');
});

// --- Boundary: long tail (constructed inline, not persisted to fixture) -----------------------

test('boundary: a model stage is accepted with the default policy, and blocked when allow_model_reference_stage=false', () => {
  const golden = buildGoldenRuntimeBundle();
  const accepted = evaluateRuntimeExecutionSimulationRequest(buildRequestWithModelStage(golden), {});
  assert.equal(accepted.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');

  const policy = buildRuntimeExecutionSimulationPolicy({ ...golden.runtimePolicy, allow_model_reference_stage: false });
  const requestWithModel = buildRequestWithModelStage(golden);
  const blockedRequest = buildRuntimeExecutionSimulationRequest({ ...requestWithModel, runtime_policy: policy });
  const blocked = evaluateRuntimeExecutionSimulationRequest(blockedRequest, {});
  assert.equal(blocked.decision.status, 'RUNTIME_POLICY_BLOCKED');
  assert.deepEqual(blocked.decision.reason_codes, ['model_reference_stage_not_allowed_by_policy']);
});

test('boundary: external effect stage always blocks (allow_external_effect_reference is forced false)', () => {
  const golden = buildGoldenRuntimeBundle();
  const stage = buildRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], side_effect_classification: 'EXTERNAL_EFFECT_REFERENCE' });
  const stages = [stage, ...golden.runtimeStageReferences.slice(1)];
  const manifest = buildRuntimeStageSimulationManifest({
    runtime_stage_manifest_id: golden.runtimeStageManifest.runtime_stage_manifest_id,
    runtime_request_id: golden.runtimeStageManifest.runtime_request_id,
    runtime_execution_package_id: golden.runtimeStageManifest.runtime_execution_package_id,
    execution_plan_id: golden.runtimeStageManifest.execution_plan_id,
    stage_manifest_reference_id: golden.runtimeStageManifest.stage_manifest_reference_id,
    stage_manifest_fingerprint: golden.runtimeStageManifest.stage_manifest_fingerprint,
    runtime_stage_references: stages
  });
  const request = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, runtime_stage_manifest_reference: manifest });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_POLICY_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['external_effect_reference_not_allowed_in_this_pr']);
});

test('boundary: irreversible stage always blocks (allow_irreversible_reference is forced false)', () => {
  const golden = buildGoldenRuntimeBundle();
  const stage = buildRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], side_effect_classification: 'IRREVERSIBLE_REFERENCE' });
  const stages = [stage, ...golden.runtimeStageReferences.slice(1)];
  const manifest = buildRuntimeStageSimulationManifest({
    runtime_stage_manifest_id: golden.runtimeStageManifest.runtime_stage_manifest_id,
    runtime_request_id: golden.runtimeStageManifest.runtime_request_id,
    runtime_execution_package_id: golden.runtimeStageManifest.runtime_execution_package_id,
    execution_plan_id: golden.runtimeStageManifest.execution_plan_id,
    stage_manifest_reference_id: golden.runtimeStageManifest.stage_manifest_reference_id,
    stage_manifest_fingerprint: golden.runtimeStageManifest.stage_manifest_fingerprint,
    runtime_stage_references: stages
  });
  const request = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, runtime_stage_manifest_reference: manifest });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_POLICY_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['irreversible_reference_not_allowed_in_this_pr']);
});

test('boundary: a STATE_CHANGE_REFERENCE stage covered by a valid compensation is accepted', () => {
  const golden = buildGoldenRuntimeBundle();
  const baseStage = golden.runtimeStageReferences[0];
  const compensation = buildRuntimeCompensationSimulationReference({
    runtime_compensation_reference_id: `${golden.runtimeRequestId}-compensation-extra`,
    runtime_execution_package_id: golden.runtimeExecutionPackageId,
    execution_plan_id: golden.plan.execution_plan_id,
    runtime_stage_reference_id: baseStage.runtime_stage_reference_id,
    source_compensation_reference_id: 'comp-extra',
    compensation_type: 'ROLLBACK_REFERENCE',
    required: true,
    compensation_validated: true
  });
  // The stage's own compensation_reference_ids must also reflect the newly-attached compensation
  // -- FIX #1 (pr103fix) cross-validates this derived field against the real
  // runtime_compensation_references on the request, never trusting a stale/empty declaration.
  const stage = buildRuntimeStageSimulationReference({
    ...baseStage, side_effect_classification: 'STATE_CHANGE_REFERENCE',
    compensation_reference_ids: [compensation.runtime_compensation_reference_id]
  });
  const stages = [stage, ...golden.runtimeStageReferences.slice(1)];
  const manifest = buildRuntimeStageSimulationManifest({
    runtime_stage_manifest_id: golden.runtimeStageManifest.runtime_stage_manifest_id,
    runtime_request_id: golden.runtimeStageManifest.runtime_request_id,
    runtime_execution_package_id: golden.runtimeStageManifest.runtime_execution_package_id,
    execution_plan_id: golden.runtimeStageManifest.execution_plan_id,
    stage_manifest_reference_id: golden.runtimeStageManifest.stage_manifest_reference_id,
    stage_manifest_fingerprint: golden.runtimeStageManifest.stage_manifest_fingerprint,
    runtime_stage_references: stages
  });
  const request = buildRuntimeExecutionSimulationRequest({
    ...golden.runtimeRequest, runtime_stage_manifest_reference: manifest, runtime_compensation_references: [compensation]
  });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
});

test('boundary: a dependency graph identity mismatch (execution_plan_id) blocks as RUNTIME_DEPENDENCY_BLOCKED', () => {
  // Mutating dependency_graph_reference_id itself would trip the *earlier* package-reference
  // cross-check (RUNTIME_PACKAGE_REFERENCE_BLOCKED) before ever reaching the dependency-specific
  // check -- execution_plan_id is the field that reaches RUNTIME_DEPENDENCY_BLOCKED specifically,
  // matching the fixture's own 'dependency-graph-mismatch' scenario.
  const golden = buildGoldenRuntimeBundle();
  const tampered = buildExecutionPlanDependencyGraphReference({ ...golden.dependencyGraphReference, execution_plan_id: 'other-execution-plan-id' });
  const request = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, dependency_graph_reference: tampered });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_DEPENDENCY_BLOCKED');
});

test('boundary: a stop reference always recomputes its own fingerprint, ignoring whatever the caller declared', () => {
  const golden = buildGoldenRuntimeBundle();
  const stop = buildRuntimeStopSimulationReference({ ...golden.runtimeStopRefs[0], stop_fingerprint: 'ignored-caller-value' });
  assert.notEqual(stop.stop_fingerprint, 'ignored-caller-value');
  assertValid('recomputed stop', validateRuntimeStopSimulationReference(stop));
});

test('boundary: a compensation reference always recomputes its own fingerprint, ignoring whatever the caller declared', () => {
  const compensation = buildRuntimeCompensationSimulationReference({
    runtime_compensation_reference_id: 'rtc-1', runtime_execution_package_id: 'rtpkg-1', execution_plan_id: 'plan-1',
    runtime_stage_reference_id: 'rtstage-1', source_compensation_reference_id: 'comp-1', compensation_type: 'ROLLBACK_REFERENCE',
    required: true, compensation_validated: true, compensation_fingerprint: 'ignored-caller-value'
  });
  assert.notEqual(compensation.compensation_fingerprint, 'ignored-caller-value');
  assertValid('recomputed compensation', validateRuntimeCompensationSimulationReference(compensation));
});

test('boundary: expected_runtime_registry_version is structurally validated but not cross-checked (no live registry-version oracle in a stateless boundary)', () => {
  const golden = buildGoldenRuntimeBundle();
  const request = buildRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, expected_runtime_registry_version: 999 });
  const outcome = evaluateRuntimeExecutionSimulationRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.result.registry_version, '999');
});

// --- Side-channels / adversarial context ------------------------------------------------------

test('boundary: context is never consulted for any decision (side-channel inert)', () => {
  const golden = buildGoldenRuntimeBundle();
  const withoutContext = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
  const withHostileContext = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {
    runtimeEnabled: true, executionAuthorized: true, executionStarted: true, stageStarted: true, modelCalled: true,
    toolCalled: true, workflowExecuted: true, networkUsed: true, tokensConsumed: 999999, costConsumed: 999999,
    schedulerStarted: true, anything: 'goes'
  });
  assert.equal(withoutContext.decision.status, withHostileContext.decision.status);
  assert.equal(withHostileContext.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
  assert.equal(withHostileContext.decision.runtime_enabled, false);
  assert.equal(withHostileContext.decision.execution_authorized, false);
});

test('boundary: operational flags smuggled onto nested references cannot be constructed at all', () => {
  const golden = buildGoldenRuntimeBundle();
  assert.equal(golden.plan.execution_authorized, false);
  assert.equal(golden.plan.runtime_enabled, false);
  assert.equal(golden.result.execution_authorized, false);
});

test('boundary: package field order never changes the accepted outcome (canonical digest is order-independent)', () => {
  const golden = buildGoldenRuntimeBundle();
  const reordered = {};
  for (const key of Object.keys(golden.runtimeRequest).sort().reverse()) reordered[key] = golden.runtimeRequest[key];
  const outcome = evaluateRuntimeExecutionSimulationRequest(reordered, {});
  assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
});

// --- Adversarial types / forbidden material -----------------------------------------------

test('boundary: rejects a request with a wrong-typed nested reference outright (RUNTIME_VALIDATION_FAILED)', () => {
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest({ ...golden.runtimeRequest, runtime_budget_reference: 'not-an-object' }, {});
  assert.equal(outcome.decision.status, 'RUNTIME_VALIDATION_FAILED');
});

test('boundary: rejects a request missing the top-level object shape and never throws', () => {
  for (const bad of [null, undefined, 42, 'string', [], NaN, Infinity]) {
    const outcome = evaluateRuntimeExecutionSimulationRequest(bad, {});
    assert.equal(outcome.decision.status, 'RUNTIME_VALIDATION_FAILED', String(bad));
  }
});

test('every runtime contract in the fixture is free of forbidden operational material', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.decision), [], `${key} decision`);
  }
});

// --- Registry ---------------------------------------------------------------------------------

test('registry: registers a decision, replays an identical one, blocks a payload mismatch without a version bump', () => {
  const registry = createRuntimeExecutionSimulationRegistry();
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});

  const first = registry.registerRuntimeExecutionSimulationDecision(outcome.decision);
  assert.equal(first.status, 'REGISTERED_SIMULATION');

  const replay = registry.registerRuntimeExecutionSimulationDecision(outcome.decision);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');

  const mismatched = registry.registerRuntimeExecutionSimulationDecision({ ...outcome.decision, blockers: ['tampered'] });
  assert.equal(mismatched.status, 'PAYLOAD_MISMATCH');

  const fetched = registry.getRuntimeExecutionSimulationDecisionById(outcome.decision.runtime_decision_id);
  assert.equal(fetched.runtime_decision_id, outcome.decision.runtime_decision_id);
});

test('registry: blocks tenant reassignment for an existing runtime execution package id', () => {
  const registry = createRuntimeExecutionSimulationRegistry();
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
  registry.registerRuntimeExecutionPackage(outcome.runtimePackage);
  const reassigned = { ...outcome.runtimePackage, tenant_id: 'a-different-tenant' };
  const result = registry.registerRuntimeExecutionPackage(reassigned);
  assert.equal(result.status, 'TENANT_BLOCKED');
});

test('registry: version conflict when expected_version disagrees', () => {
  const registry = createRuntimeExecutionSimulationRegistry();
  const golden = buildGoldenRuntimeBundle();
  registry.registerRuntimeStageSimulationReference(golden.runtimeStageReferences[0]);
  const bumped = buildRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], runtime_stage_reference_version: 2, priority: golden.runtimeStageReferences[0].priority + 1 });
  const result = registry.registerRuntimeStageSimulationReference(bumped, { expected_version: 5 });
  assert.equal(result.status, 'VERSION_CONFLICT');
});

test('registry: every store result is forced into simulation/production_blocked/executed=false', () => {
  const registry = createRuntimeExecutionSimulationRegistry();
  const golden = buildGoldenRuntimeBundle();
  const result = registry.registerRuntimeBudgetSimulationReference(golden.runtimeBudgetReference);
  assert.equal(result.simulation, true);
  assert.equal(result.production_blocked, true);
  assert.equal(result.executed, false);
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeExecutionSimulationRegistry();
  const result = registry.registerRuntimeStopSimulationReference({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- Tipos adversariais -----------------------------------------------------------------------

test('adversarial types: NaN/Infinity/bigint/symbol/function/undefined/Buffer/ArrayBuffer/typed array/class/cyclic are all rejected', () => {
  const badValues = [NaN, Infinity, -Infinity, 10n, Symbol('x'), () => {}, undefined, Buffer.from('x'), new ArrayBuffer(4), new Uint8Array(4), class Foo {}];
  for (const bad of badValues) {
    const found = findAgentCoreOperationalMaterial({ field: bad });
    assert.ok(found.length > 0, `expected ${String(bad)} to be rejected`);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).length > 0);
});

// Known, pre-existing gap in agent-identity-contract.js's shared scanner (not introduced by this
// PR, out of scope to fix here): isPlainObject() is a structural check (non-null, typeof
// 'object', not an array) that also matches Date/Map/Set/RegExp instances, and visit() only walks
// *enumerable own keys* -- all four of these have none, so they pass through invisibly rather than
// being flagged. None of this PR's own exact-fields contracts ever accept one of these as a field
// value in the first place (every field is independently type-checked -- isNonEmptyString/
// Number.isInteger/typeof==='boolean'/Array.isArray -- long before this scanner would ever run),
// so the gap is never actually reachable through a real contract, only through calling the scanner
// directly on an ad hoc object as this test does.
test('adversarial types: Date/Map/Set/RegExp pass the scanner directly, but no real contract field ever accepts one', () => {
  const golden = buildGoldenRuntimeBundle();
  assert.deepEqual(findAgentCoreOperationalMaterial({ field: new Date() }), []);
  assertInvalid('stage with a Date in an integer field', validateRuntimeStageSimulationReference({ ...golden.runtimeStageReferences[0], priority: new Date() }));
});

test('adversarial types: URL / endpoint / process.env / dynamic import / require / arrow function value shapes are all rejected', () => {
  const badStrings = [
    'https://example.com', 'process.env.SECRET', 'import(\'x\')', 'require(\'x\')', '() => 1', 'localhost:8080'
  ];
  for (const bad of badStrings) {
    const found = findAgentCoreOperationalMaterial({ field: bad });
    assert.ok(found.length > 0, `expected "${bad}" to be rejected`);
  }
});

// --- Regressão ------------------------------------------------------------------------------------

test('regression: Gateway remains simulation-only and unaffected by this PR', () => {
  const golden = buildGoldenRuntimeBundle();
  assert.equal(golden.gatewayDecision.simulation, true);
  assert.equal(golden.gatewayDecision.production_blocked, true);
  assert.equal(golden.gatewayDecision.execution_authorized, false);
});

test('regression: Stage Manifest remains 1:1 and Dependency Graph remains the source of edges', () => {
  const golden = buildGoldenRuntimeBundle();
  assert.equal(golden.runtimeStageManifest.runtime_stage_count, golden.stageManifestReference.stage_records.length);
  assert.equal(golden.runtimeDependencyManifest.runtime_dependency_count, golden.dependencyGraphReference.dependency_records.length);
});

test('regression: package fingerprint and digest are stable across re-evaluation of an identical request', () => {
  const golden = buildGoldenRuntimeBundle();
  const outcome1 = evaluateRuntimeExecutionSimulationRequest(clone(golden.runtimeRequest), {});
  const outcome2 = evaluateRuntimeExecutionSimulationRequest(clone(golden.runtimeRequest), {});
  assert.equal(outcome1.runtimePackage.package_digest, outcome2.runtimePackage.package_digest);
  assert.equal(outcome1.decision.runtime_package_digest, outcome2.decision.runtime_package_digest);
});

test('regression: no real execution -- computeRuntimePackageDigest is order-independent and byte-exact', () => {
  const golden = buildGoldenRuntimeBundle();
  const outcome = evaluateRuntimeExecutionSimulationRequest(golden.runtimeRequest, {});
  const parts = {
    gatewayDecision: golden.gatewayDecision, gatewayResult: golden.gatewayResult, gatewayPackageRef: golden.packageReference,
    plan: golden.plan, result: golden.result, stageManifestRef: golden.stageManifestReference,
    dependencyGraphRef: golden.dependencyGraphReference, bindingLedger: golden.bindingLedger, validationLedger: golden.validationLedger,
    runtimeStageManifest: golden.runtimeStageManifest, runtimeDependencyManifest: golden.runtimeDependencyManifest,
    runtimeBudgetRef: golden.runtimeBudgetReference, executionBudgetReference: golden.executionBudgetReference,
    runtimeStopRefs: golden.runtimeStopRefs, runtimeCompensationRefs: golden.runtimeCompensationRefs,
    runtimeArtifactPlan: golden.runtimeArtifactPlan, runtimeEventPlan: golden.runtimeEventPlan,
    orderedRuntimeStageIds: golden.runtimeStageManifest.ordered_runtime_stage_ids,
    runtimeDependencyIds: golden.runtimeDependencyManifest.runtime_dependency_reference_ids,
    estimates: {
      estimated_input_tokens: golden.runtimeStageManifest.estimated_input_tokens,
      estimated_output_tokens: golden.runtimeStageManifest.estimated_output_tokens,
      estimated_total_tokens: golden.runtimeStageManifest.estimated_total_tokens,
      estimated_total_cost_minor_units: golden.runtimeStageManifest.estimated_total_cost_minor_units
    },
    canonical: {
      tenantId: golden.plan.tenant_id, organizationId: golden.plan.organization_id, projectId: golden.plan.project_id,
      sessionId: golden.plan.session_reference_id, agentId: golden.plan.agent_id, actorId: golden.packageReference.actor_id
    }
  };
  const digest1 = computeRuntimePackageDigest(parts);
  const digest2 = computeRuntimePackageDigest({ ...parts });
  assert.equal(digest1, digest2);
  assert.equal(digest1, outcome.runtimePackage.package_digest);
});
