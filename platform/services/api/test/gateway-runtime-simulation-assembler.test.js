'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleGatewayRuntimeSimulationRequest } = require('../src/core/gateway-runtime-simulation-assembler');
const { evaluateRuntimeExecutionSimulationRequest } = require('../src/core/runtime-execution-package');
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

test('fails closed when gateway is not accepted in simulation', () => {
  const value = input();
  value.gatewayOutcome = { ...value.gatewayOutcome, decision: { ...value.gatewayOutcome.decision, status: 'POLICY_BLOCKED', gateway_accepted_in_simulation: false } };
  assert.throws(() => assembleGatewayRuntimeSimulationRequest(value), /gateway_runtime_assembler_gateway_not_accepted_simulation/);
});
