'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildGoldenBundle } = require('./helpers/execution-gateway-test-data');
const { evaluateExecutionGatewayRequest } = require('../src/core/execution-gateway-boundary');

test('E2E simulation: execution plan stage manifest reaches gateway with exact identity and remains non-operational', () => {
  for (const scenario of ['prepared-no-llm-plan', 'prepared-low-cost-model-plan', 'tool-stage-plan', 'workflow-stage-plan']) {
    const bundle = buildGoldenBundle(scenario);
    const outcome = evaluateExecutionGatewayRequest(bundle.gatewayRequest, {});

    assert.equal(bundle.result.execution_plan_prepared, true, scenario);
    assert.equal(bundle.result.stage_manifest_validated, true, scenario);
    assert.equal(
      bundle.gatewayRequest.stage_manifest_reference.manifest_fingerprint,
      bundle.plan.stage_manifest_fingerprint,
      scenario
    );
    assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION', scenario);
    assert.equal(outcome.decision.gateway_accepted_in_simulation, true, scenario);

    for (const object of [bundle.result, outcome.decision, outcome.result]) {
      assert.equal(object.simulation, true, scenario);
      assert.equal(object.production_blocked, true, scenario);
      assert.equal(object.execution_authorized, false, scenario);
      assert.equal(object.executed, false, scenario);
      assert.equal(object.network_used, false, scenario);
    }
  }
});

test('E2E simulation: stage-manifest identity drift fails closed at the gateway', () => {
  const bundle = buildGoldenBundle('prepared-no-llm-plan');
  const request = structuredClone(bundle.gatewayRequest);
  request.stage_manifest_reference.orchestration_plan_id = 'drifted-plan';

  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.notEqual(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
  assert.equal(outcome.decision.execution_authorized, false);
  assert.equal(outcome.decision.executed, false);
  assert.equal(outcome.decision.production_blocked, true);
});
