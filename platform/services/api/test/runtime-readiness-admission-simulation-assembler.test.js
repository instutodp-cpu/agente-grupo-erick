'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleGatewayRuntimeSimulationRequest } = require('../src/core/gateway-runtime-simulation-assembler');
const { assembleRuntimeReadinessRequest, assembleRuntimeAdmissionRequest } = require('../src/core/runtime-readiness-admission-assembler');
const { evaluateRuntimeExecutionSimulationRequest } = require('../src/core/runtime-execution-package');
const { evaluateRuntimeReadinessRequest, evaluateRuntimeAdmissionRequest } = require('../src/core/runtime-admission-boundary');
const { buildGoldenBundle, evaluateExecutionGatewayRequest } = require('./helpers/execution-gateway-test-data');
const fixture = require('./fixtures/hermes-execution-plan-contracts.json');

function input() {
  const golden = buildGoldenBundle('prepared-no-llm-plan');
  const gatewayOutcome = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});
  return {
    executionPlanRequest: fixture.scenarios['prepared-no-llm-plan'].request,
    executionOutcome: { plan: golden.plan, result: golden.result, bindingLedger: golden.bindingLedger, validationLedger: golden.validationLedger },
    gatewayOutcome,
    gatewayPackageReference: golden.packageReference,
    architectureGateEvidenceReference: golden.evidenceReference,
    stageManifestReference: golden.stageManifestReference,
    dependencyGraphReference: golden.dependencyGraphReference,
    authorizationProvenanceReference: golden.provenanceReference,
    authorizationScopeReference: golden.scopeReference,
    registrySnapshotReference: golden.snapshotReference
  };
}

test('assembles official runtime request only from accepted simulation gateway artifacts', () => {
  const assembled = assembleGatewayRuntimeSimulationRequest(input());
  const outcome = evaluateRuntimeExecutionSimulationRequest(assembled.runtimeRequest, {});
  assert.equal(outcome.runtimePackage.runtime_status, 'RUNTIME_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.runtimePackage.runtime_enabled, false);
  assert.equal(outcome.runtimePackage.execution_authorized, false);
  assert.equal(outcome.runtimePackage.execution_started, false);
  assert.equal(outcome.runtimePackage.executed, false);
  assert.equal(outcome.runtimePackage.production_blocked, true);
});

test('fails closed on task identity drift', () => {
  const value = input();
  value.executionPlanRequest = {
    ...value.executionPlanRequest,
    task_reference: { ...value.executionPlanRequest.task_reference, task_reference_id: 'drifted-task-reference' }
  };
  assert.throws(() => assembleGatewayRuntimeSimulationRequest(value), /gateway_runtime_assembler_task_drift/);
});

function readinessInput() {
  const upstream = input();
  const runtimeAssembly = assembleGatewayRuntimeSimulationRequest(upstream);
  const runtimeOutcome = evaluateRuntimeExecutionSimulationRequest(runtimeAssembly.runtimeRequest, {});
  return { ...upstream, runtimeAssembly, runtimeOutcome };
}

test('runtime readiness and admission reach admitted simulation without execution authority', () => {
  const base = assembleRuntimeReadinessRequest(readinessInput());
  const placeholder = `sha256:${'0'.repeat(64)}`;
  const provisionalReplay = base.buildReplay(base.readinessRequestFingerprint, placeholder);
  const provisional = evaluateRuntimeReadinessRequest(base.buildReadinessRequestWithReplay(provisionalReplay), {});
  assert.equal(provisional.decision.status, 'RUNTIME_READY_SIMULATION');
  const firstAdmission = assembleRuntimeAdmissionRequest(base, provisional);
  const readiness = evaluateRuntimeReadinessRequest(firstAdmission.readinessRequest, {});
  assert.equal(readiness.decision.status, 'RUNTIME_READY_SIMULATION');
  const finalAdmission = assembleRuntimeAdmissionRequest(base, readiness);
  const admission = evaluateRuntimeAdmissionRequest(finalAdmission.admissionRequest, {});
  assert.equal(admission.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
  assert.equal(admission.decision.execution_authorized, false);
  assert.equal(admission.decision.execution_started, false);
  assert.equal(admission.decision.executed, false);
  assert.equal(admission.decision.production_blocked, true);
});

test('runtime readiness assembler fails closed when runtime is not prepared', () => {
  const value = readinessInput();
  value.runtimeOutcome = { ...value.runtimeOutcome, decision: { ...value.runtimeOutcome.decision, status: 'RUNTIME_PACKAGE_BLOCKED' } };
  assert.throws(() => assembleRuntimeReadinessRequest(value), /runtime_readiness_admission_assembler_runtime_not_prepared/);
});

test('runtime admission assembler rejects a non-ready readiness decision', () => {
  const value = readinessInput();
  const base = assembleRuntimeReadinessRequest(value);
  assert.throws(() => assembleRuntimeAdmissionRequest(base, { decision: { status: 'RUNTIME_NOT_READY_BLOCKED' } }), /runtime_readiness_admission_assembler_readiness_not_ready/);
});
