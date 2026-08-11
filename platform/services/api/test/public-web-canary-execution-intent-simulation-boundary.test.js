'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGoldenQueuePlacementBundle,
  evaluateRuntimeQueuePlacementRequest
} = require('./helpers/runtime-queue-placement-simulation-test-data');
const {
  buildPublicWebCanaryQueuedSimulationEnvelope
} = require('./helpers/public-web-canary-queued-handoff-test-helper');
const {
  PUBLIC_WEB_CANARY_CAPABILITY,
  computeHandoffFingerprint,
  evaluatePublicWebCanaryQueuedSimulationBoundary
} = require('../src/core/public-web-canary-queued-simulation-boundary');
const {
  computeIntentFingerprint,
  evaluatePublicWebCanaryExecutionIntentSimulation,
  validatePublicWebCanaryExecutionIntentSimulationResult
} = require('../src/core/public-web-canary-execution-intent-simulation-boundary');

let baselineEnvelope;

function clone(value) {
  return structuredClone(value);
}

function buildEnvelope(overrides = {}) {
  if (!baselineEnvelope) {
    const bundle = buildGoldenQueuePlacementBundle();
    const placementOutcome = evaluateRuntimeQueuePlacementRequest(bundle.queuePlacementRequest, {});
    baselineEnvelope = buildPublicWebCanaryQueuedSimulationEnvelope({
      queuePlacementBundle: bundle,
      queuePlacementOutcome: placementOutcome
    });
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
      trial_id: 'public_web_trial_intent_001',
      plan_hash: 'plan_hash_intent_001',
      ...(overrides.plan || {})
    },
    preflight: {
      status: 'preflight_passed',
      evidence_hash: 'preflight_evidence_intent_001',
      executed: false,
      real_provider_called: false,
      ...(overrides.preflight || {})
    },
    dry_run: {
      status: 'dry_run_passed',
      dry_run_passed: true,
      evidence_hash: 'dry_run_evidence_intent_001',
      fake_network_called: true,
      fake_provider_calls: 1,
      real_provider_called: false,
      ...(overrides.dry_run || {})
    },
    ...overrides.root
  };
}

function buildHandoff({ envelope = buildEnvelope(), prepared = preparedTrial() } = {}) {
  return {
    envelope,
    prepared,
    handoff: evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared })
  };
}

function assertValidIntent(result, context) {
  const validation = validatePublicWebCanaryExecutionIntentSimulationResult(result, context);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
}

function recomputeIntentFingerprint(result) {
  const material = {
    validator_version: result.validator_version,
    capability: result.identity.capability,
    request_id: result.identity.request_id,
    correlation_id: result.identity.correlation_id,
    trace_id: result.identity.trace_id,
    tenant_id: result.scope.tenant_id,
    organization_id: result.scope.organization_id,
    project_id: result.scope.project_id,
    parent_handoff_fingerprint: result.parent.handoff_fingerprint,
    parent_handoff_status: result.parent.handoff_status,
    parent_handoff_validator_version: result.parent.handoff_validator_version,
    dispatch_package_id: result.parent.dispatch_package_id,
    dispatch_fingerprint: result.parent.dispatch_fingerprint,
    dispatch_digest: result.parent.dispatch_digest,
    worker_assignment_package_id: result.parent.worker_assignment_package_id,
    worker_assignment_fingerprint: result.parent.worker_assignment_fingerprint,
    queue_placement_package_id: result.parent.queue_placement_package_id,
    trial_id: result.parent.trial_id,
    plan_hash: result.parent.plan_hash,
    preflight_evidence_hash: result.parent.preflight_evidence_hash,
    dry_run_evidence_hash: result.parent.dry_run_evidence_hash,
    intent_created: result.authority.intent_created,
    admission_granted: result.authority.admission_granted,
    execution_authorized: result.authority.execution_authorized,
    provider_authorized: result.authority.provider_authorized,
    network_authorized: result.authority.network_authorized,
    secret_resolution_authorized: result.authority.secret_resolution_authorized,
    execution_started: result.authority.execution_started,
    runtime_enabled: result.authority.runtime_enabled,
    worker_started: result.authority.worker_started,
    queue_mutated: result.authority.queue_mutated,
    persistence_written: result.authority.persistence_written,
    real_canary_executed: result.authority.real_canary_executed,
    can_trigger_real_execution: result.authority.can_trigger_real_execution,
    simulation_mode: result.simulation_mode,
    production_blocked: result.production_blocked,
    executed: result.executed,
    network_used: result.network_used,
    real_provider_called: result.real_provider_called,
    secret_resolved: result.secret_resolved
  };
  result.evidence.intent_input_fingerprint = computeIntentFingerprint(result.parent);
  result.evidence.authority_fingerprint = computeIntentFingerprint(result.authority);
  result.audit.authority_fingerprint = computeIntentFingerprint(result.authority);
  result.audit.evidence_fingerprint = computeIntentFingerprint(result.evidence);
  result.intent_id = `public_web_canary_execution_intent:${computeIntentFingerprint({ material, evidence: result.evidence })}`;
  result.audit.intent_id = result.intent_id;
  result.intent_fingerprint = computeIntentFingerprint({
    material,
    evidence: result.evidence,
    audit: result.audit
  });
}

test('intent boundary creates a simulation-only execution intent from a validated PR1 handoff', () => {
  const { envelope, prepared, handoff } = buildHandoff();
  const result = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared });

  assertValidIntent(result, { handoffResult: handoff, envelope, preparedTrial: prepared });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATED');
  assert.equal(result.capability, PUBLIC_WEB_CANARY_CAPABILITY);
  assert.equal(result.identity.request_id, handoff.pipeline.request_id);
  assert.equal(result.identity.correlation_id, handoff.pipeline.correlation_id);
  assert.equal(result.identity.trace_id, handoff.pipeline.trace_id);
  assert.equal(result.parent.handoff_fingerprint, handoff.handoff_fingerprint);
  assert.equal(result.parent.dispatch_package_id, handoff.pipeline.dispatch_package_id);
  assert.equal(result.parent.trial_id, handoff.evidence.trial_id);
  assert.equal(result.scope.tenant_id, envelope.dispatch.package.tenant_id);
});

test('intent boundary grants only intent authority and never admission, authorization, provider, network, or secret authority', () => {
  const { envelope, prepared, handoff } = buildHandoff();
  const result = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared });

  assert.equal(result.authority.intent_created, true);
  for (const field of [
    'admission_granted',
    'execution_authorized',
    'provider_authorized',
    'network_authorized',
    'secret_resolution_authorized',
    'execution_started',
    'runtime_enabled',
    'worker_started',
    'queue_mutated',
    'persistence_written',
    'real_canary_executed',
    'can_trigger_real_execution'
  ]) {
    assert.equal(result.authority[field], false, field);
  }
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.executed, false);
  assert.equal(result.runtime_enabled, false);
  assert.equal(result.network_used, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.secret_resolved, false);
});

test('intent boundary is deterministic and idempotent for the same validated handoff', () => {
  const { envelope, prepared, handoff } = buildHandoff();
  const first = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared });
  const second = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: clone(prepared) });

  assertValidIntent(first, { handoffResult: handoff, envelope, preparedTrial: prepared });
  assertValidIntent(second, { handoffResult: handoff, envelope, preparedTrial: prepared });
  assert.equal(first.intent_id, second.intent_id);
  assert.equal(first.intent_fingerprint, second.intent_fingerprint);
  assert.deepEqual(first.identity, second.identity);
  assert.deepEqual(first.parent, second.parent);
  assert.deepEqual(first.audit, second.audit);
});

test('intent fingerprint changes when parent semantic material changes', () => {
  const firstContext = buildHandoff();
  const secondContext = buildHandoff({ prepared: preparedTrial({ plan: { plan_hash: 'plan_hash_intent_002' } }) });
  const first = evaluatePublicWebCanaryExecutionIntentSimulation(firstContext.handoff, {
    envelope: firstContext.envelope,
    preparedTrial: firstContext.prepared
  });
  const second = evaluatePublicWebCanaryExecutionIntentSimulation(secondContext.handoff, {
    envelope: secondContext.envelope,
    preparedTrial: secondContext.prepared
  });

  assert.notEqual(first.parent.plan_hash, second.parent.plan_hash);
  assert.notEqual(first.intent_id, second.intent_id);
  assert.notEqual(first.intent_fingerprint, second.intent_fingerprint);
});

test('intent boundary rejects malformed, blocked, or tampered parent handoffs fail-closed', () => {
  const { envelope, prepared, handoff } = buildHandoff();
  const blockedEnvelope = buildEnvelope({ runtime_enabled: true });
  const blockedPrepared = preparedTrial();
  const blockedParent = evaluatePublicWebCanaryQueuedSimulationBoundary(blockedEnvelope, { preparedTrial: blockedPrepared });
  const unsupportedParent = clone(handoff);
  unsupportedParent.capability = 'unsupported_public_web_canary_capability';
  const cases = [
    ['malformed_parent', null, { envelope, preparedTrial: prepared }, 'parent_public_web_canary_queued_simulation_result_must_be_object'],
    ['tampered_parent', (() => {
      const tampered = clone(handoff);
      tampered.pipeline.dispatch_package_id = 'other-dispatch-package';
      return tampered;
    })(), { envelope, preparedTrial: prepared }, 'parent_handoff_fingerprint_mismatch'],
    ['blocked_parent', blockedParent, { envelope: blockedEnvelope, preparedTrial: blockedPrepared }, 'parent_handoff_not_successful'],
    ['unsupported_capability_parent', unsupportedParent, { envelope, preparedTrial: prepared }, 'capability_not_supported']
  ];

  for (const [name, parent, context, reason] of cases) {
    const result = evaluatePublicWebCanaryExecutionIntentSimulation(parent, context);
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), `${name}: ${result.reason_codes.join(',')}`);
    if (name === 'unsupported_capability_parent') {
      assert.equal(result.status, 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_NOT_SUPPORTED');
      assert.equal(result.capability, PUBLIC_WEB_CANARY_CAPABILITY);
      assert.equal(result.identity.capability, PUBLIC_WEB_CANARY_CAPABILITY);
    }
    assert.equal(result.authority.intent_created, false);
    assert.equal(result.executed, false);
    assert.equal(result.network_used, false);
    assert.equal(result.real_provider_called, false);
  }
});

test('intent validator rejects recomputed parent identity tamper against canonical handoff context', () => {
  const { envelope, prepared, handoff } = buildHandoff();
  const result = clone(evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared }));
  result.parent.dispatch_package_id = 'other-dispatch-package';
  result.audit.dispatch_package_id = 'other-dispatch-package';
  recomputeIntentFingerprint(result);

  const validation = validatePublicWebCanaryExecutionIntentSimulationResult(result, {
    handoffResult: handoff,
    envelope,
    preparedTrial: prepared
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('intent_context_mismatch'));
});

test('intent validator rejects audit, evidence, identity, and simulation guard tamper', () => {
  const tamperCases = [
    ['audit_mismatch', (result) => { result.audit.request_id = 'other-request'; }, 'audit_request_id_mismatch'],
    ['evidence_mismatch', (result) => { result.evidence.handoff_fingerprint = 'sha256:' + 'a'.repeat(64); }, 'evidence_handoff_fingerprint_mismatch'],
    ['identity_mismatch', (result) => { result.identity.correlation_id = 'other-correlation'; }, 'audit_correlation_id_mismatch'],
    ['guard_mismatch', (result) => { result.network_used = true; result.audit.network_used = true; }, 'network_used_must_be_false'],
    ['authority_escalation', (result) => { result.authority.execution_authorized = true; }, 'authority_execution_authorized_must_be_false']
  ];

  for (const [name, mutate, reason] of tamperCases) {
    const { envelope, prepared, handoff } = buildHandoff();
    const result = clone(evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared }));
    mutate(result);
    recomputeIntentFingerprint(result);

    const validation = validatePublicWebCanaryExecutionIntentSimulationResult(result, {
      handoffResult: handoff,
      envelope,
      preparedTrial: prepared
    });
    assert.equal(validation.valid, false, name);
    assert.ok(validation.errors.includes(reason), `${name}: ${validation.errors.join(',')}`);
  }
});

test('intent validator rejects unsupported version and missing canonical validation context', () => {
  const { envelope, prepared, handoff } = buildHandoff();
  const result = clone(evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared }));

  const noContext = validatePublicWebCanaryExecutionIntentSimulationResult(result);
  assert.equal(noContext.valid, false);
  assert.ok(noContext.errors.includes('intent_validation_context_required'));

  result.validator_version = 'unsupported_version';
  recomputeIntentFingerprint(result);
  const unsupportedVersion = validatePublicWebCanaryExecutionIntentSimulationResult(result, {
    handoffResult: handoff,
    envelope,
    preparedTrial: prepared
  });
  assert.equal(unsupportedVersion.valid, false);
  assert.ok(unsupportedVersion.errors.includes('validator_version_invalid'));
});

test('intent result is frozen, does not mutate input, and has no operational side effects', () => {
  const { envelope, prepared, handoff } = buildHandoff();
  const beforeHandoff = JSON.stringify(handoff);
  const beforeEnvelope = JSON.stringify(envelope);
  const result = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared });

  assert.equal(JSON.stringify(handoff), beforeHandoff);
  assert.equal(JSON.stringify(envelope), beforeEnvelope);
  assert.throws(() => {
    result.authority.network_authorized = true;
  }, TypeError);
  assert.throws(() => {
    result.parent.trial_id = 'mutated';
  }, TypeError);
  assert.equal(result.evidence.production_effect, 'ZERO');
  assert.equal(result.authority.queue_mutated, false);
  assert.equal(result.authority.persistence_written, false);
  assert.equal(result.authority.worker_started, false);
  assert.equal(result.authority.real_canary_executed, false);
});
