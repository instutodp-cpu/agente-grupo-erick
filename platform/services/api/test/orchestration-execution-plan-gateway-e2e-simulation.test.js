'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildGoldenBundle } = require('./helpers/execution-gateway-test-data');
const { evaluateExecutionGatewayRequest, computeGatewayPackageDigest } = require('../src/core/execution-gateway-boundary');
const { assembleArchitectureGateEvidenceFromCi } = require('../src/core/architecture-gate-ci-evidence-assembler');
const { buildExecutionGatewayFreshnessReference } = require('../src/core/execution-gateway-freshness-reference');
const { buildExecutionGatewayPackageReference } = require('../src/core/execution-gateway-package-reference');
const { buildExecutionGatewayRequest } = require('../src/core/execution-gateway-request');

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


test('E2E simulation: externally verified real CI evidence replaces synthetic architecture evidence at gateway', () => {
  const bundle = buildGoldenBundle('prepared-no-llm-plan');
  const evidence = assembleArchitectureGateEvidenceFromCi({
    architecture_gate_evidence_reference_id: bundle.evidenceReference.architecture_gate_evidence_reference_id,
    repository_id: 'repo-agente-grupo-erick', repository_full_name: 'instutodp-cpu/agente-grupo-erick', default_branch: 'main',
    commit_sha: 'b976c373ea6df625c4da6127faa587181def8abf', head_commit_sha: 'b976c373ea6df625c4da6127faa587181def8abf',
    base_commit_sha: '043f2a80cf97ed1099fdf139ab0254e39fd5e13c', workflow_id: 'hermes-core-smoke',
    workflow_name: 'Hermes Core smoke test', workflow_version: 'v1', workflow_run_id: '37226509013', workflow_run_attempt: 1,
    workflow_run_status: 'COMPLETED', workflow_run_conclusion: 'SUCCESS', trigger_type: 'PULL_REQUEST_REFERENCE',
    ruleset_id: 'hermes-core-smoke', ruleset_version: '1',
    gates: [{ gate_result_id: 'hermes-core-smoke-success', gate_id: 'HERMES_CORE_SMOKE', gate_version: 'v1', status: 'PASSED', severity: 'CRITICAL', required: true }],
    evidence_created_logical_sequence: 0, maximum_valid_sequences: 1000, current_logical_sequence: 5
  });
  const freshness = buildExecutionGatewayFreshnessReference({
    freshness_reference_id: bundle.freshnessReference.freshness_reference_id, execution_plan_id: bundle.plan.execution_plan_id,
    authorization_decision_id: bundle.plan.authorization_decision_id, registry_snapshot_reference_id: bundle.snapshotReference.registry_snapshot_reference_id,
    architecture_gate_evidence_reference_id: evidence.architecture_gate_evidence_reference_id,
    created_logical_sequence: 0, current_logical_sequence: 5, maximum_valid_sequences: 1000
  });
  const digest = computeGatewayPackageDigest({
    plan: bundle.plan, result: bundle.result, authorizationDecision: bundle.authorizationDecision,
    provenanceReference: bundle.provenanceReference, scopeReference: bundle.scopeReference, snapshotReference: bundle.snapshotReference,
    stageManifestReference: bundle.stageManifestReference, dependencyGraphReference: bundle.dependencyGraphReference,
    bindingLedger: bundle.bindingLedger, validationLedger: bundle.validationLedger, evidenceReference: evidence
  });
  const pkg = buildExecutionGatewayPackageReference({
    ...bundle.packageReference,
    architecture_gate_evidence_reference_id: evidence.architecture_gate_evidence_reference_id,
    architecture_gate_evidence_fingerprint: evidence.evidence_fingerprint,
    package_digest: digest
  });
  const request = buildExecutionGatewayRequest({
    ...bundle.gatewayRequest, gateway_package_reference: pkg, architecture_gate_evidence_reference: evidence, freshness_reference: freshness
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(evidence.workflow_run_reference.workflow_run_id, '37226509013');
  assert.equal(evidence.commit_sha, 'b976c373ea6df625c4da6127faa587181def8abf');
  assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
  assert.equal(outcome.decision.execution_authorized, false);
  assert.equal(outcome.decision.executed, false);
  assert.equal(outcome.decision.production_blocked, true);
});
