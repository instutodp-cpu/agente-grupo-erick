'use strict';

const { computeCanonicalContentDigest } = require('../../src/core/canonical-content-digest');
const { createPublicWebCanaryOperationalTrial } = require('../../src/pilots/public-web-canary-operational-trial');
const {
  deterministicClock,
  fakeDryRunRunner,
  fakeNodeHttpsClient,
  validPreflightContext,
  validTrialConfig
} = require('./public-web-canary-trial-test-data');

const PUBLIC_WEB_CANARY_CAPABILITY = 'public_web_canary_operational_trial';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function clone(value) {
  if (typeof structuredClone !== 'function') throw new Error('structured_clone_required_for_public_web_canary_handoff_tests');
  return structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function canonicalDigest(value) {
  return computeCanonicalContentDigest(value);
}

function sortedValues(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].sort();
}

function assertStatus(actual, expected, reasonCodes, reason) {
  if (actual !== expected) reasonCodes.push(reason);
}

function assertFalse(value, reasonCodes, reason) {
  if (value !== false) reasonCodes.push(reason);
}

function assertTrue(value, reasonCodes, reason) {
  if (value !== true) reasonCodes.push(reason);
}

function assertFingerprintPair(left, right, reasonCodes, reason) {
  if (typeof left !== 'string' || left.length === 0 || left !== right) reasonCodes.push(reason);
}

function collectPipelineFailures(envelope) {
  const reasonCodes = [];
  if (!isPlainObject(envelope)) return ['handoff_envelope_must_be_object'];
  if (envelope.capability !== PUBLIC_WEB_CANARY_CAPABILITY) reasonCodes.push('capability_not_supported');
  assertTrue(envelope.simulation_mode, reasonCodes, 'simulation_mode_required');
  assertTrue(envelope.production_blocked, reasonCodes, 'production_blocked_required');
  assertFalse(envelope.executed, reasonCodes, 'executed_must_be_false');
  assertFalse(envelope.runtime_enabled, reasonCodes, 'runtime_enabled_must_be_false');
  assertFalse(envelope.network_used, reasonCodes, 'network_used_must_be_false');
  assertFalse(envelope.secret_resolved, reasonCodes, 'secret_resolved_must_be_false');
  assertFalse(envelope.real_provider_called, reasonCodes, 'real_provider_called_must_be_false');

  const admission = envelope.admission || {};
  const materialization = envelope.materialization || {};
  const placement = envelope.placement || {};
  const assignment = envelope.assignment || {};
  const dispatch = envelope.dispatch || {};

  assertStatus(admission.decision && admission.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION', reasonCodes, 'queue_admission_not_prepared');
  assertStatus(materialization.decision && materialization.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION', reasonCodes, 'queue_materialization_not_prepared');
  assertStatus(placement.decision && placement.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION', reasonCodes, 'queue_placement_not_prepared');
  assertStatus(assignment.decision && assignment.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION', reasonCodes, 'worker_assignment_not_prepared');
  assertStatus(dispatch.decision && dispatch.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION', reasonCodes, 'dispatch_not_prepared');

  assertFingerprintPair(
    admission.decision && admission.decision.runtime_queue_admission_package_fingerprint,
    admission.package && admission.package.queue_admission_package_fingerprint,
    reasonCodes,
    'queue_admission_package_fingerprint_mismatch'
  );
  assertFingerprintPair(
    materialization.decision && materialization.decision.runtime_queue_materialization_package_fingerprint,
    materialization.package && materialization.package.queue_materialization_package_fingerprint,
    reasonCodes,
    'queue_materialization_package_fingerprint_mismatch'
  );
  assertFingerprintPair(
    placement.decision && placement.decision.runtime_queue_placement_package_fingerprint,
    placement.package && placement.package.queue_placement_package_fingerprint,
    reasonCodes,
    'queue_placement_package_fingerprint_mismatch'
  );
  assertFingerprintPair(
    assignment.decision && assignment.decision.runtime_worker_assignment_package_fingerprint,
    assignment.package && assignment.package.worker_assignment_package_fingerprint,
    reasonCodes,
    'worker_assignment_package_fingerprint_mismatch'
  );
  assertFingerprintPair(
    dispatch.decision && dispatch.decision.runtime_dispatch_package_fingerprint,
    dispatch.package && dispatch.package.dispatch_package_fingerprint,
    reasonCodes,
    'dispatch_package_fingerprint_mismatch'
  );

  const assignmentRefs = Array.isArray(assignment.assignment_refs) ? assignment.assignment_refs : [];
  const assignedWorkers = sortedValues(assignmentRefs.map((ref) => ref && ref.recommended_worker_reference_id));
  if (assignedWorkers.length === 0) reasonCodes.push('worker_assignment_missing');
  return reasonCodes;
}

function pipelineSummary(envelope) {
  const assignmentRefs = Array.isArray(envelope.assignment && envelope.assignment.assignment_refs)
    ? envelope.assignment.assignment_refs
    : [];
  const workerIds = sortedValues(assignmentRefs.map((ref) => ref && ref.recommended_worker_reference_id));
  return {
    request_id: envelope.request_id,
    correlation_id: envelope.correlation_id,
    trace_id: envelope.trace_id,
    queue_admission_package_id: envelope.admission.package.runtime_queue_admission_package_id,
    queue_admission_fingerprint: envelope.admission.package.queue_admission_package_fingerprint,
    queue_materialization_package_id: envelope.materialization.package.runtime_queue_materialization_package_id,
    queue_materialization_fingerprint: envelope.materialization.package.queue_materialization_package_fingerprint,
    queue_placement_package_id: envelope.placement.package.runtime_queue_placement_package_id,
    queue_placement_fingerprint: envelope.placement.package.queue_placement_package_fingerprint,
    worker_assignment_package_id: envelope.assignment.package.runtime_worker_assignment_package_id,
    worker_assignment_fingerprint: envelope.assignment.package.worker_assignment_package_fingerprint,
    worker_reference_ids: workerIds,
    dispatch_package_id: envelope.dispatch.package.runtime_dispatch_package_id,
    dispatch_fingerprint: envelope.dispatch.package.dispatch_package_fingerprint,
    dispatch_digest: envelope.dispatch.package.dispatch_package_digest
  };
}

function blockedResult(envelope, reasonCodes) {
  const safeEnvelope = isPlainObject(envelope) ? envelope : {};
  const audit = {
    event_name: 'public_web_canary_queued_handoff_blocked',
    capability: safeEnvelope.capability || null,
    request_id: safeEnvelope.request_id || null,
    correlation_id: safeEnvelope.correlation_id || null,
    trace_id: safeEnvelope.trace_id || null,
    reason_codes: [...reasonCodes].sort(),
    simulation_mode: true,
    production_blocked: true,
    executed: false,
    runtime_enabled: false,
    network_used: false,
    real_provider_called: false,
    secret_resolved: false
  };
  const result = {
    ok: false,
    status: reasonCodes.includes('capability_not_supported')
      ? 'PUBLIC_WEB_CANARY_HANDOFF_NOT_SUPPORTED'
      : 'PUBLIC_WEB_CANARY_HANDOFF_BLOCKED',
    reason_codes: audit.reason_codes,
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    simulation_mode: true,
    production_blocked: true,
    executed: false,
    runtime_enabled: false,
    network_used: false,
    real_provider_called: false,
    secret_resolved: false,
    fake_network_used: false,
    handoff_fingerprint: canonicalDigest(audit),
    evidence: null,
    audit
  };
  return deepFreeze(result);
}

function successPayload(envelope, prepared) {
  const pipeline = pipelineSummary(envelope);
  const dryRun = prepared.dry_run || {};
  const preflight = prepared.preflight || {};
  const plan = prepared.plan || {};
  const evidence = {
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    trial_id: plan.trial_id,
    plan_hash: plan.plan_hash,
    preflight_status: preflight.status,
    preflight_evidence_hash: preflight.evidence_hash,
    dry_run_status: dryRun.status,
    dry_run_passed: dryRun.dry_run_passed === true,
    dry_run_evidence_hash: dryRun.evidence_hash,
    fake_network_used: dryRun.fake_network_called === true,
    fake_provider_calls: Number.isInteger(dryRun.fake_provider_calls) ? dryRun.fake_provider_calls : 0,
    real_provider_called: false,
    network_used: false,
    secret_resolved: false
  };
  const audit = {
    event_name: 'public_web_canary_queued_handoff_simulated',
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    request_id: pipeline.request_id,
    correlation_id: pipeline.correlation_id,
    trace_id: pipeline.trace_id,
    queue_placement_package_id: pipeline.queue_placement_package_id,
    worker_reference_ids: pipeline.worker_reference_ids,
    dispatch_package_id: pipeline.dispatch_package_id,
    input_fingerprint: canonicalDigest(pipeline),
    evidence_fingerprint: canonicalDigest(evidence),
    simulation_mode: true,
    production_blocked: true,
    executed: false,
    runtime_enabled: false,
    network_used: false,
    real_provider_called: false,
    secret_resolved: false
  };
  return {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED',
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    simulation_mode: true,
    production_blocked: true,
    executed: false,
    runtime_enabled: false,
    network_used: false,
    real_provider_called: false,
    secret_resolved: false,
    fake_network_used: evidence.fake_network_used,
    handoff_fingerprint: canonicalDigest({ pipeline, evidence, audit }),
    pipeline,
    evidence,
    audit
  };
}

function buildPublicWebCanaryQueuedSimulationEnvelope({ queuePlacementBundle, queuePlacementOutcome, capability = PUBLIC_WEB_CANARY_CAPABILITY } = {}) {
  const bundle = queuePlacementBundle;
  const placementOutcome = queuePlacementOutcome;
  if (!bundle || !placementOutcome) throw new Error('queue_placement_bundle_and_outcome_required');
  return deepFreeze({
    capability,
    request_id: `${bundle.queuePlacementRequest.runtime_queue_placement_request_id}-public-web-canary-handoff`,
    correlation_id: bundle.queuePlacementRequest.correlation_id,
    trace_id: bundle.queuePlacementRequest.trace_id,
    simulation_mode: true,
    production_blocked: true,
    executed: false,
    runtime_enabled: false,
    network_used: false,
    secret_resolved: false,
    real_provider_called: false,
    admission: {
      request: bundle.queueAdmissionRequest,
      decision: bundle.admissionOutcome.decision,
      result: bundle.admissionOutcome.result,
      package: bundle.admissionOutcome.package
    },
    materialization: {
      request: bundle.queueMaterializationRequest,
      decision: bundle.materializationOutcome.decision,
      result: bundle.materializationOutcome.result,
      package: bundle.materializationOutcome.package
    },
    placement: {
      request: bundle.queuePlacementRequest,
      decision: placementOutcome.decision,
      result: placementOutcome.result,
      package: placementOutcome.package
    },
    assignment: {
      request: bundle.workerAssignmentRequest,
      decision: bundle.workerAssignmentOutcome.decision,
      result: bundle.workerAssignmentOutcome.result,
      package: bundle.workerAssignmentOutcome.package,
      assignment_refs: bundle.workerAssignmentOutcome.assignmentRefs
    },
    dispatch: {
      request: bundle.dispatchRequest,
      decision: bundle.dispatchOutcome.decision,
      result: bundle.dispatchOutcome.result,
      package: bundle.dispatchOutcome.package
    }
  });
}

async function runPublicWebCanaryQueuedSimulationHandoff(envelopeInput, options = {}) {
  const envelope = clone(envelopeInput);
  const reasonCodes = collectPipelineFailures(envelope);
  if (reasonCodes.length > 0) return blockedResult(envelope, reasonCodes);

  const canaryRunner = options.canaryRunner || fakeDryRunRunner();
  const nodeHttpsClient = options.nodeHttpsClient || fakeNodeHttpsClient();
  const trial = createPublicWebCanaryOperationalTrial({
    ...validPreflightContext({
      canaryRunner,
      nodeHttpsClient
    }),
    canaryRunner,
    nodeHttpsClient,
    clock: deterministicClock
  });
  const prepared = await trial.prepareTrial({
    config: options.trialConfig || validTrialConfig(),
    preflightOnly: false
  });
  if (!prepared || prepared.ok !== true || !prepared.dry_run || prepared.dry_run.real_provider_called !== false) {
    return blockedResult(envelope, ['public_web_canary_prepare_failed_closed']);
  }
  return deepFreeze(successPayload(envelope, prepared));
}

module.exports = {
  PUBLIC_WEB_CANARY_CAPABILITY,
  buildPublicWebCanaryQueuedSimulationEnvelope,
  runPublicWebCanaryQueuedSimulationHandoff
};
