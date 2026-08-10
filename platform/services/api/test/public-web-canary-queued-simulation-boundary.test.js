'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGoldenQueuePlacementBundle,
  evaluateRuntimeQueuePlacementRequest
} = require('./helpers/runtime-queue-placement-simulation-test-data');
const {
  buildPublicWebCanaryQueuedSimulationEnvelope,
  runPublicWebCanaryQueuedSimulationHandoff
} = require('./helpers/public-web-canary-queued-handoff-test-helper');
const {
  PUBLIC_WEB_CANARY_CAPABILITY,
  computeHandoffFingerprint,
  evaluatePublicWebCanaryQueuedSimulationBoundary,
  validatePublicWebCanaryQueuedSimulationResult
} = require('../src/core/public-web-canary-queued-simulation-boundary');

let baselineEnvelope;

function clone(value) {
  return structuredClone(value);
}

function buildEnvelope(overrides = {}) {
  if (!baselineEnvelope) {
    const bundle = buildGoldenQueuePlacementBundle();
    const placementOutcome = evaluateRuntimeQueuePlacementRequest(bundle.queuePlacementRequest, {});
    baselineEnvelope = buildPublicWebCanaryQueuedSimulationEnvelope({ queuePlacementBundle: bundle, queuePlacementOutcome: placementOutcome });
  }
  return {
    ...clone(baselineEnvelope),
    ...overrides
  };
}

function preparedTrial(overrides = {}) {
  return {
    ok: true,
    plan: {
      trial_id: 'public_web_trial_boundary_001',
      plan_hash: 'plan_hash_boundary_001',
      ...(overrides.plan || {})
    },
    preflight: {
      status: 'preflight_passed',
      evidence_hash: 'preflight_evidence_boundary_001',
      executed: false,
      real_provider_called: false,
      ...(overrides.preflight || {})
    },
    dry_run: {
      status: 'dry_run_passed',
      dry_run_passed: true,
      evidence_hash: 'dry_run_evidence_boundary_001',
      fake_network_called: true,
      fake_provider_calls: 1,
      real_provider_called: false,
      ...(overrides.dry_run || {})
    },
    ...overrides.root
  };
}

function assertValid(result, context) {
  const validation = validatePublicWebCanaryQueuedSimulationResult(result, context);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
}

function recomputeSuccessFingerprint(result) {
  result.handoff_fingerprint = computeHandoffFingerprint({
    pipeline: result.pipeline,
    evidence: result.evidence,
    audit: result.audit
  });
}

test('boundary accepts a prepared Dispatch package and returns a simulation-only canary handoff result', () => {
  const envelope = buildEnvelope();
  const prepared = preparedTrial();
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared });

  assertValid(result, { envelope, preparedTrial: prepared });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED');
  assert.equal(result.capability, PUBLIC_WEB_CANARY_CAPABILITY);
  assert.equal(result.pipeline.dispatch_package_id, envelope.dispatch.package.runtime_dispatch_package_id);
  assert.equal(result.pipeline.dispatch_fingerprint, envelope.dispatch.package.dispatch_package_fingerprint);
  assert.equal(result.pipeline.dispatch_digest, envelope.dispatch.package.dispatch_package_digest);
  assert.equal(result.pipeline.worker_assignment_package_id, envelope.assignment.package.runtime_worker_assignment_package_id);
  assert.ok(result.pipeline.worker_reference_ids.length > 0);
  assert.equal(result.evidence.trial_id, 'public_web_trial_boundary_001');
});

test('boundary preserves request, correlation, trace, dispatch, and assignment identity', () => {
  const envelope = buildEnvelope();
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: preparedTrial() });

  assert.equal(result.pipeline.request_id, envelope.request_id);
  assert.equal(result.pipeline.correlation_id, envelope.correlation_id);
  assert.equal(result.pipeline.trace_id, envelope.trace_id);
  assert.equal(result.audit.request_id, envelope.request_id);
  assert.equal(result.audit.correlation_id, envelope.correlation_id);
  assert.equal(result.audit.trace_id, envelope.trace_id);
  assert.equal(result.audit.dispatch_package_id, envelope.dispatch.package.runtime_dispatch_package_id);
  assert.deepEqual(result.audit.worker_reference_ids, result.pipeline.worker_reference_ids);
});

test('boundary forces every operational guard to simulation-only safe values', () => {
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(buildEnvelope(), { preparedTrial: preparedTrial() });

  assert.equal(result.simulation_mode, true);
  assert.equal(result.production_blocked, true);
  assert.equal(result.executed, false);
  assert.equal(result.runtime_enabled, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.secret_resolved, false);
  assert.equal(result.evidence.network_used, false);
  assert.equal(result.evidence.real_provider_called, false);
  assert.equal(result.evidence.secret_resolved, false);
});

test('boundary is deterministic for replay of the same canonical input and preparation', () => {
  const envelope = buildEnvelope();
  const firstPrepared = preparedTrial();
  const secondPrepared = preparedTrial();
  const first = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: firstPrepared });
  const second = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: secondPrepared });

  assertValid(first, { envelope, preparedTrial: firstPrepared });
  assertValid(second, { envelope, preparedTrial: secondPrepared });
  assert.equal(first.handoff_fingerprint, second.handoff_fingerprint);
  assert.deepEqual(first.pipeline, second.pipeline);
  assert.deepEqual(first.evidence, second.evidence);
  assert.deepEqual(first.audit, second.audit);
});

test('boundary fingerprint changes when material request identity changes', () => {
  const first = evaluatePublicWebCanaryQueuedSimulationBoundary(buildEnvelope(), { preparedTrial: preparedTrial() });
  const changed = buildEnvelope({ request_id: `${baselineEnvelope.request_id}-changed` });
  const second = evaluatePublicWebCanaryQueuedSimulationBoundary(changed, { preparedTrial: preparedTrial() });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.handoff_fingerprint, second.handoff_fingerprint);
  assert.notEqual(first.audit.request_id, second.audit.request_id);
});

test('boundary evidence fingerprint is derived from deterministic evidence material', () => {
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(buildEnvelope(), { preparedTrial: preparedTrial() });

  assert.equal(result.audit.input_fingerprint, computeHandoffFingerprint(result.pipeline));
  assert.equal(result.audit.evidence_fingerprint, computeHandoffFingerprint(result.evidence));
  assert.equal(result.handoff_fingerprint, computeHandoffFingerprint({
    pipeline: result.pipeline,
    evidence: result.evidence,
    audit: result.audit
  }));
});

test('boundary does not mutate input and freezes returned nested result', () => {
  const envelope = buildEnvelope();
  const before = JSON.stringify(envelope);
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: preparedTrial() });

  assert.equal(JSON.stringify(envelope), before);
  assert.throws(() => {
    result.audit.request_id = 'mutated';
  }, TypeError);
  assert.throws(() => {
    result.pipeline.worker_reference_ids.push('mutated');
  }, TypeError);
});

test('boundary isolates requests: mutating one input after evaluation cannot affect replay of another input', () => {
  const envelope = buildEnvelope();
  const mutable = clone(envelope);
  const first = evaluatePublicWebCanaryQueuedSimulationBoundary(mutable, { preparedTrial: preparedTrial() });
  mutable.dispatch.package.dispatch_package_fingerprint = 'polluted';
  mutable.assignment.assignment_refs[0].recommended_worker_reference_id = 'polluted-worker';
  const second = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: preparedTrial() });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.handoff_fingerprint, second.handoff_fingerprint);
});

test('boundary rejects missing canary preparation without executing or calling provider/network', () => {
  const envelope = buildEnvelope();
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope);

  assertValid(result, { envelope });
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('canary_preparation_required'));
  assert.equal(result.executed, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.secret_resolved, false);
});

test('boundary rejects unknown capability fail-closed', () => {
  const envelope = buildEnvelope({ capability: 'unknown_capability' });
  const prepared = preparedTrial();
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(
    envelope,
    { preparedTrial: prepared }
  );

  assertValid(result, { envelope, preparedTrial: prepared });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_HANDOFF_NOT_SUPPORTED');
  assert.ok(result.reason_codes.includes('capability_not_supported'));
});

test('boundary rejects unsafe simulation flags fail-closed', () => {
  for (const [field, value, reason] of [
    ['simulation_mode', false, 'simulation_mode_required'],
    ['production_blocked', false, 'production_blocked_required'],
    ['executed', true, 'executed_must_be_false'],
    ['runtime_enabled', true, 'runtime_enabled_must_be_false'],
    ['network_used', true, 'network_used_must_be_false'],
    ['real_provider_called', true, 'real_provider_called_must_be_false'],
    ['secret_resolved', true, 'secret_resolved_must_be_false']
  ]) {
    const result = evaluatePublicWebCanaryQueuedSimulationBoundary(
      buildEnvelope({ [field]: value }),
      { preparedTrial: preparedTrial() }
    );
    assert.equal(result.ok, false);
    assert.ok(result.reason_codes.includes(reason));
    assert.equal(result.executed, false);
  }
});

test('boundary rejects package, dispatch, assignment, and fingerprint mismatch fail-closed', () => {
  const cases = [
    ['package_absent', (envelope) => { delete envelope.dispatch.package; }, 'dispatch_package_invalid'],
    ['package_present_partial', (envelope) => { envelope.dispatch.package = { dispatch_status: 'DISPATCH_PACKAGE_PREPARED_SIMULATION', dispatch_package_prepared_in_simulation: true }; }, 'dispatch_package_runtime_dispatch_package_id_invalid'],
    ['dispatch_absent', (envelope) => { delete envelope.dispatch; }, 'dispatch_not_prepared'],
    ['dispatch_fingerprint', (envelope) => { envelope.dispatch.package.dispatch_package_fingerprint = 'sha256:' + 'f'.repeat(64); }, 'dispatch_package_fingerprint_mismatch'],
    ['assignment_absent', (envelope) => { delete envelope.assignment.package; }, 'worker_assignment_package_invalid'],
    ['assignment_incompatible', (envelope) => { envelope.dispatch.package.runtime_worker_assignment_package_id = 'other-assignment-package'; }, 'dispatch_assignment_package_mismatch']
  ];

  for (const [name, mutate, reason] of cases) {
    const envelope = buildEnvelope();
    mutate(envelope);
    const result = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: preparedTrial() });
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), `${name}: ${result.reason_codes.join(',')}`);
    assert.equal(result.real_provider_called, false);
  }
});

test('boundary rejects request, correlation, trace, and cross-scope mismatch fail-closed', () => {
  const cases = [
    ['request', (envelope) => { envelope.placement.request.runtime_queue_placement_request_id = 'other-placement-request'; }, 'request_id_mismatch'],
    ['correlation', (envelope) => { envelope.correlation_id = 'other-correlation'; }, 'correlation_id_mismatch'],
    ['trace', (envelope) => { envelope.trace_id = 'other-trace'; }, 'trace_id_mismatch'],
    ['scope', (envelope) => { envelope.dispatch.package.tenant_id = 'other-tenant'; }, 'pipeline_scope_mismatch']
  ];

  for (const [name, mutate, reason] of cases) {
    const envelope = buildEnvelope();
    mutate(envelope);
    const result = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: preparedTrial() });
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), `${name}: ${result.reason_codes.join(',')}`);
  }
});

test('boundary rejects unsafe canary preparation fail-closed', () => {
  const cases = [
    ['preflight_executed', { preflight: { executed: true } }, 'canary_preflight_executed_must_be_false'],
    ['preflight_provider', { preflight: { real_provider_called: true } }, 'canary_preflight_real_provider_called_must_be_false'],
    ['dry_run_failed', { dry_run: { status: 'dry_run_blocked' } }, 'canary_dry_run_not_passed'],
    ['dry_run_provider', { dry_run: { real_provider_called: true } }, 'canary_dry_run_real_provider_called_must_be_false'],
    ['malformed', { root: { ok: false } }, 'canary_preparation_not_ok']
  ];

  for (const [name, overrides, reason] of cases) {
    const result = evaluatePublicWebCanaryQueuedSimulationBoundary(buildEnvelope(), {
      preparedTrial: preparedTrial(overrides)
    });
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), `${name}: ${result.reason_codes.join(',')}`);
    assert.equal(result.executed, false);
    assert.equal(result.network_used, false);
    assert.equal(result.real_provider_called, false);
  }
});

test('boundary result validator rejects incompatible replay result material', () => {
  const envelope = buildEnvelope();
  const prepared = preparedTrial();
  const result = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared });
  const tampered = clone(result);
  tampered.audit.dispatch_package_id = 'other-dispatch-package';

  const validation = validatePublicWebCanaryQueuedSimulationResult(tampered, { envelope, preparedTrial: prepared });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('handoff_fingerprint_mismatch'));
});

test('boundary result validator rejects recomputed pipeline identity tamper against canonical context', () => {
  const envelope = buildEnvelope();
  const prepared = preparedTrial();
  const result = clone(evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared }));
  result.pipeline.dispatch_package_id = 'other-dispatch-package';
  result.audit.dispatch_package_id = 'other-dispatch-package';
  result.audit.input_fingerprint = computeHandoffFingerprint(result.pipeline);
  recomputeSuccessFingerprint(result);

  const validation = validatePublicWebCanaryQueuedSimulationResult(result, { envelope, preparedTrial: prepared });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('result_context_mismatch'));
});

test('boundary result validator rejects recomputed evidence tamper against canonical context', () => {
  const envelope = buildEnvelope();
  const prepared = preparedTrial();
  const result = clone(evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared }));
  result.evidence.trial_id = 'other-trial';
  result.audit.evidence_fingerprint = computeHandoffFingerprint(result.evidence);
  recomputeSuccessFingerprint(result);

  const validation = validatePublicWebCanaryQueuedSimulationResult(result, { envelope, preparedTrial: prepared });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('result_context_mismatch'));
});

test('boundary result validator rejects audit/result mismatch even when handoff fingerprint is recomputed', () => {
  const envelope = buildEnvelope();
  const prepared = preparedTrial();
  const result = clone(evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared }));
  result.audit.request_id = 'other-request';
  recomputeSuccessFingerprint(result);

  const validation = validatePublicWebCanaryQueuedSimulationResult(result, { envelope, preparedTrial: prepared });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('audit_request_id_mismatch'));
});

test('boundary result validator rejects recomputed simulation guard tamper', () => {
  const envelope = buildEnvelope();
  const prepared = preparedTrial();
  const result = clone(evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared }));
  result.network_used = true;
  result.evidence.network_used = true;
  result.audit.evidence_fingerprint = computeHandoffFingerprint(result.evidence);
  recomputeSuccessFingerprint(result);

  const validation = validatePublicWebCanaryQueuedSimulationResult(result, { envelope, preparedTrial: prepared });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('network_used_must_be_false'));
  assert.ok(validation.errors.includes('evidence_network_used_must_be_false'));
});

test('helper consumes the official boundary while preserving observable handoff semantics', async () => {
  const result = await runPublicWebCanaryQueuedSimulationHandoff(buildEnvelope());

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED');
  assert.equal(result.evidence.trial_id, 'public_web_trial_test_001');
  assert.equal(result.executed, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
});
