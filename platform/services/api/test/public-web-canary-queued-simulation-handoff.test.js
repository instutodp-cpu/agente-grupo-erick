'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGoldenQueuePlacementBundle,
  evaluateRuntimeQueuePlacementRequest
} = require('./helpers/runtime-queue-placement-simulation-test-data');
const {
  PUBLIC_WEB_CANARY_CAPABILITY,
  buildPublicWebCanaryQueuedSimulationEnvelope,
  runPublicWebCanaryQueuedSimulationHandoff
} = require('./helpers/public-web-canary-queued-handoff-test-helper');

let baselineEnvelope;

function buildEnvelope(overrides = {}) {
  if (!baselineEnvelope) {
    const bundle = buildGoldenQueuePlacementBundle();
    const placementOutcome = evaluateRuntimeQueuePlacementRequest(bundle.queuePlacementRequest, {});
    assert.equal(bundle.admissionOutcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
    assert.equal(bundle.materializationOutcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
    assert.equal(placementOutcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
    assert.equal(bundle.workerAssignmentOutcome.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
    assert.equal(bundle.dispatchOutcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
    baselineEnvelope = buildPublicWebCanaryQueuedSimulationEnvelope({ queuePlacementBundle: bundle, queuePlacementOutcome: placementOutcome });
  }
  const envelope = {
    ...clone(baselineEnvelope),
    ...overrides
  };
  return {
    envelope
  };
}

function clone(value) {
  return structuredClone(value);
}

test('happy path: Public Web Canary crosses Queue Admission, Materialization, Placement, Assignment, Dispatch, then handoff returns structured simulation result', async () => {
  const { envelope } = buildEnvelope();
  const result = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED');
  assert.equal(result.capability, PUBLIC_WEB_CANARY_CAPABILITY);
  assert.equal(result.pipeline.queue_admission_package_id, envelope.admission.package.runtime_queue_admission_package_id);
  assert.equal(result.pipeline.queue_materialization_package_id, envelope.materialization.package.runtime_queue_materialization_package_id);
  assert.equal(result.pipeline.queue_placement_package_id, envelope.placement.package.runtime_queue_placement_package_id);
  assert.equal(result.pipeline.worker_assignment_package_id, envelope.assignment.package.runtime_worker_assignment_package_id);
  assert.equal(result.pipeline.dispatch_package_id, envelope.dispatch.package.runtime_dispatch_package_id);
  assert.ok(result.pipeline.worker_reference_ids.length > 0);
  assert.equal(result.evidence.dry_run_passed, true);
  assert.equal(typeof result.handoff_fingerprint, 'string');
});

test('simulation guards: no real execution, provider, network, runtime, or secret resolution is exposed by the handoff', async () => {
  const { envelope } = buildEnvelope();
  const result = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(result.simulation_mode, true);
  assert.equal(result.production_blocked, true);
  assert.equal(result.executed, false);
  assert.equal(result.runtime_enabled, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.secret_resolved, false);
  assert.equal(result.fake_network_used, true);
  assert.equal(result.evidence.real_provider_called, false);
  assert.equal(result.evidence.network_used, false);
  assert.equal(result.evidence.secret_resolved, false);
});

test('fail closed: unknown capability is rejected without side effects', async () => {
  const { envelope } = buildEnvelope({ capability: 'unknown_capability' });
  const result = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_HANDOFF_NOT_SUPPORTED');
  assert.ok(result.reason_codes.includes('capability_not_supported'));
  assert.equal(result.executed, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.secret_resolved, false);
});

test('fail closed: simulation_mode=false is rejected before canary preparation', async () => {
  const { envelope } = buildEnvelope({ simulation_mode: false });
  const result = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('simulation_mode_required'));
  assert.equal(result.executed, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
});

test('fail closed: production_blocked=false is rejected before canary preparation', async () => {
  const { envelope } = buildEnvelope({ production_blocked: false });
  const result = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('production_blocked_required'));
  assert.equal(result.executed, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
});

test('fail closed: missing worker assignment blocks the handoff', async () => {
  const { envelope } = buildEnvelope();
  const tampered = clone(envelope);
  tampered.assignment.assignment_refs = [];

  const result = await runPublicWebCanaryQueuedSimulationHandoff(tampered);

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('worker_assignment_missing'));
  assert.equal(result.executed, false);
});

test('fail closed: dispatch package fingerprint mismatch blocks the handoff', async () => {
  const { envelope } = buildEnvelope();
  const tampered = clone(envelope);
  tampered.dispatch.package.dispatch_package_fingerprint = 'sha256:' + 'f'.repeat(64);

  const result = await runPublicWebCanaryQueuedSimulationHandoff(tampered);

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('dispatch_package_fingerprint_mismatch'));
  assert.equal(result.real_provider_called, false);
});

test('determinism and idempotency: replay of the same envelope returns the same semantic handoff fingerprint', async () => {
  const { envelope } = buildEnvelope();

  const first = await runPublicWebCanaryQueuedSimulationHandoff(envelope);
  const second = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.handoff_fingerprint, second.handoff_fingerprint);
  assert.deepEqual(first.pipeline, second.pipeline);
  assert.deepEqual(first.evidence, second.evidence);
});

test('determinism: material request identity changes the handoff fingerprint', async () => {
  const { envelope } = buildEnvelope();
  const changed = clone(envelope);
  changed.request_id = `${changed.request_id}-changed`;

  const first = await runPublicWebCanaryQueuedSimulationHandoff(envelope);
  const second = await runPublicWebCanaryQueuedSimulationHandoff(changed);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.handoff_fingerprint, second.handoff_fingerprint);
  assert.notEqual(first.audit.request_id, second.audit.request_id);
});

test('determinism: assignment input order does not change the handoff fingerprint', async () => {
  const { envelope } = buildEnvelope();
  const reordered = clone(envelope);
  reordered.assignment.assignment_refs = [...reordered.assignment.assignment_refs].reverse();

  const first = await runPublicWebCanaryQueuedSimulationHandoff(envelope);
  const second = await runPublicWebCanaryQueuedSimulationHandoff(reordered);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.handoff_fingerprint, second.handoff_fingerprint);
});

test('isolation: mutating a consumed input cannot contaminate a later consumer or the frozen result', async () => {
  const { envelope } = buildEnvelope();
  const mutable = clone(envelope);

  const first = await runPublicWebCanaryQueuedSimulationHandoff(mutable);
  mutable.dispatch.package.dispatch_package_fingerprint = 'polluted';
  mutable.assignment.assignment_refs[0].recommended_worker_reference_id = 'polluted-worker';
  const second = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.handoff_fingerprint, second.handoff_fingerprint);
  assert.throws(() => {
    first.audit.request_id = 'mutated';
  }, TypeError);
});

test('auditability: evidence preserves queue/dispatch and correlation identity', async () => {
  const { envelope } = buildEnvelope();
  const result = await runPublicWebCanaryQueuedSimulationHandoff(envelope);

  assert.equal(result.audit.request_id, envelope.request_id);
  assert.equal(result.audit.correlation_id, envelope.correlation_id);
  assert.equal(result.audit.trace_id, envelope.trace_id);
  assert.equal(result.audit.queue_placement_package_id, envelope.placement.package.runtime_queue_placement_package_id);
  assert.equal(result.audit.dispatch_package_id, envelope.dispatch.package.runtime_dispatch_package_id);
  assert.equal(result.evidence.trial_id, 'public_web_trial_test_001');
  assert.equal(result.evidence.dry_run_status, 'dry_run_passed');
});
