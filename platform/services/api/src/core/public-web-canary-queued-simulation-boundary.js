'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { findCanaryForbiddenFields } = require('./public-web-canary-session-contract');

const PUBLIC_WEB_CANARY_CAPABILITY = 'public_web_canary_operational_trial';
const PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_VALIDATOR_VERSION = 'public_web_canary_queued_simulation_result_validator_v1';

const PUBLIC_WEB_CANARY_QUEUED_SIMULATION_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED',
  'PUBLIC_WEB_CANARY_HANDOFF_BLOCKED',
  'PUBLIC_WEB_CANARY_HANDOFF_NOT_SUPPORTED'
]);

const PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_FIELDS = Object.freeze([
  'ok',
  'status',
  'reason_codes',
  'capability',
  'simulation_mode',
  'production_blocked',
  'executed',
  'runtime_enabled',
  'network_used',
  'real_provider_called',
  'secret_resolved',
  'fake_network_used',
  'handoff_fingerprint',
  'pipeline',
  'evidence',
  'audit',
  'validator_version'
]);

const SAFE_FLAGS = Object.freeze({
  simulation_mode: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false,
  network_used: false,
  real_provider_called: false,
  secret_resolved: false
});

function computeHandoffFingerprint(payload) {
  return computeCanonicalContentDigest(payload);
}

function sortedValues(values) {
  return uniqueSorted(Array.isArray(values) ? values : []);
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
  if (!isNonEmptyString(left) || left !== right) reasonCodes.push(reason);
}

function assertSame(left, right, reasonCodes, reason) {
  if (!isNonEmptyString(left) || left !== right) reasonCodes.push(reason);
}

function assertRequiredStringFields(source, fields, reasonCodes, prefix) {
  if (!isPlainObject(source)) return;
  for (const field of fields) {
    if (!isNonEmptyString(source[field])) reasonCodes.push(`${prefix}_${field}_invalid`);
  }
}

function assertPreparedPackage(pkg, statusField, expectedStatus, preparedField, reasonCodes, reason) {
  if (!isPlainObject(pkg)) {
    reasonCodes.push(reason);
    return;
  }
  assertStatus(pkg[statusField], expectedStatus, reasonCodes, reason);
  assertTrue(pkg[preparedField], reasonCodes, reason);
}

function assertPreparedResult(result, expectedStatus, preparedField, reasonCodes, reason) {
  if (!isPlainObject(result)) {
    reasonCodes.push(reason);
    return;
  }
  assertStatus(result.status, expectedStatus, reasonCodes, reason);
  assertTrue(result[preparedField], reasonCodes, reason);
}

function collectWorkerReferenceIds(assignment) {
  const refs = Array.isArray(assignment && assignment.assignment_refs) ? assignment.assignment_refs : [];
  return sortedValues(refs.map((ref) => ref && ref.recommended_worker_reference_id));
}

function collectPublicWebCanaryQueuedSimulationFailures(envelope) {
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

  const admission = isPlainObject(envelope.admission) ? envelope.admission : {};
  const materialization = isPlainObject(envelope.materialization) ? envelope.materialization : {};
  const placement = isPlainObject(envelope.placement) ? envelope.placement : {};
  const assignment = isPlainObject(envelope.assignment) ? envelope.assignment : {};
  const dispatch = isPlainObject(envelope.dispatch) ? envelope.dispatch : {};

  assertPreparedPackage(admission.package, 'queue_admission_status', 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION', 'queue_admission_package_prepared_in_simulation', reasonCodes, 'queue_admission_package_invalid');
  assertPreparedResult(admission.result, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION', 'queue_admission_package_prepared_in_simulation', reasonCodes, 'queue_admission_result_invalid');
  assertPreparedPackage(materialization.package, 'queue_materialization_status', 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION', 'queue_materialization_package_prepared_in_simulation', reasonCodes, 'queue_materialization_package_invalid');
  assertPreparedResult(materialization.result, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION', 'queue_materialization_package_prepared_in_simulation', reasonCodes, 'queue_materialization_result_invalid');
  assertPreparedPackage(placement.package, 'queue_placement_status', 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION', 'queue_placement_package_prepared_in_simulation', reasonCodes, 'queue_placement_package_invalid');
  assertPreparedResult(placement.result, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION', 'queue_placement_package_prepared_in_simulation', reasonCodes, 'queue_placement_result_invalid');
  assertPreparedPackage(assignment.package, 'worker_assignment_status', 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION', 'worker_assignment_package_prepared_in_simulation', reasonCodes, 'worker_assignment_package_invalid');
  assertPreparedResult(assignment.result, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION', 'worker_assignment_package_prepared_in_simulation', reasonCodes, 'worker_assignment_result_invalid');
  assertPreparedPackage(dispatch.package, 'dispatch_status', 'DISPATCH_PACKAGE_PREPARED_SIMULATION', 'dispatch_package_prepared_in_simulation', reasonCodes, 'dispatch_package_invalid');
  assertPreparedResult(dispatch.result, 'DISPATCH_PACKAGE_PREPARED_SIMULATION', 'dispatch_package_prepared_in_simulation', reasonCodes, 'dispatch_result_invalid');
  assertRequiredStringFields(dispatch.package, [
    'runtime_dispatch_package_id',
    'runtime_worker_assignment_package_id',
    'runtime_scheduler_package_id',
    'runtime_execution_package_id',
    'tenant_id',
    'organization_id',
    'project_id',
    'dispatch_package_fingerprint',
    'dispatch_package_digest'
  ], reasonCodes, 'dispatch_package');
  assertRequiredStringFields(dispatch.result, [
    'runtime_dispatch_result_id',
    'runtime_dispatch_package_id',
    'runtime_worker_assignment_package_id',
    'runtime_scheduler_package_id',
    'runtime_execution_package_id',
    'tenant_id',
    'organization_id',
    'project_id',
    'runtime_dispatch_package_fingerprint',
    'runtime_dispatch_package_digest'
  ], reasonCodes, 'dispatch_result');
  assertRequiredStringFields(assignment.package, [
    'runtime_worker_assignment_package_id',
    'runtime_scheduler_package_id',
    'runtime_execution_package_id',
    'tenant_id',
    'organization_id',
    'project_id',
    'worker_assignment_package_fingerprint',
    'worker_assignment_package_digest'
  ], reasonCodes, 'worker_assignment_package');

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

  assertSame(dispatch.result && dispatch.result.runtime_dispatch_package_id, dispatch.package && dispatch.package.runtime_dispatch_package_id, reasonCodes, 'dispatch_result_package_mismatch');
  assertSame(dispatch.package && dispatch.package.runtime_worker_assignment_package_id, assignment.package && assignment.package.runtime_worker_assignment_package_id, reasonCodes, 'dispatch_assignment_package_mismatch');
  assertSame(assignment.package && assignment.package.runtime_scheduler_package_id, dispatch.package && dispatch.package.runtime_scheduler_package_id, reasonCodes, 'assignment_dispatch_scheduler_package_mismatch');
  assertSame(placement.package && placement.package.tenant_id, dispatch.package && dispatch.package.tenant_id, reasonCodes, 'pipeline_scope_mismatch');
  assertSame(placement.package && placement.package.organization_id, dispatch.package && dispatch.package.organization_id, reasonCodes, 'pipeline_scope_mismatch');
  assertSame(placement.package && placement.package.project_id, dispatch.package && dispatch.package.project_id, reasonCodes, 'pipeline_scope_mismatch');

  const placementRequest = placement.request || {};
  if (!isNonEmptyString(envelope.request_id)) reasonCodes.push('request_id_invalid');
  assertSame(placement.package && placement.package.runtime_queue_placement_request_id, placementRequest.runtime_queue_placement_request_id, reasonCodes, 'request_id_mismatch');
  assertSame(envelope.correlation_id, placementRequest.correlation_id, reasonCodes, 'correlation_id_mismatch');
  assertSame(envelope.trace_id, placementRequest.trace_id, reasonCodes, 'trace_id_mismatch');

  if (collectWorkerReferenceIds(assignment).length === 0) reasonCodes.push('worker_assignment_missing');
  return uniqueSorted(reasonCodes);
}

function pipelineSummary(envelope) {
  const assignment = envelope.assignment || {};
  const workerIds = collectWorkerReferenceIds(assignment);
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

function collectPreparationFailures(prepared) {
  const reasonCodes = [];
  if (!isPlainObject(prepared)) return ['canary_preparation_required'];
  if (prepared.ok !== true) reasonCodes.push('canary_preparation_not_ok');
  const plan = isPlainObject(prepared.plan) ? prepared.plan : {};
  const preflight = isPlainObject(prepared.preflight) ? prepared.preflight : {};
  const dryRun = isPlainObject(prepared.dry_run) ? prepared.dry_run : {};
  for (const [field, source] of [
    ['trial_id', plan],
    ['plan_hash', plan],
    ['status', preflight],
    ['evidence_hash', preflight],
    ['status', dryRun],
    ['evidence_hash', dryRun]
  ]) {
    if (!isNonEmptyString(source[field])) reasonCodes.push(`canary_preparation_${field}_invalid`);
  }
  if (preflight.executed !== false) reasonCodes.push('canary_preflight_executed_must_be_false');
  if (preflight.real_provider_called !== false) reasonCodes.push('canary_preflight_real_provider_called_must_be_false');
  if (dryRun.status !== 'dry_run_passed') reasonCodes.push('canary_dry_run_not_passed');
  if (dryRun.dry_run_passed !== true) reasonCodes.push('canary_dry_run_passed_required');
  if (dryRun.real_provider_called !== false) reasonCodes.push('canary_dry_run_real_provider_called_must_be_false');
  return uniqueSorted(reasonCodes);
}

function buildEvidence(prepared) {
  const plan = prepared.plan;
  const preflight = prepared.preflight;
  const dryRun = prepared.dry_run;
  return {
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
}

function buildBlockedResult(envelope, reasonCodes) {
  const safeEnvelope = isPlainObject(envelope) ? envelope : {};
  const audit = {
    event_name: 'public_web_canary_queued_handoff_blocked',
    capability: safeEnvelope.capability || null,
    request_id: safeEnvelope.request_id || null,
    correlation_id: safeEnvelope.correlation_id || null,
    trace_id: safeEnvelope.trace_id || null,
    reason_codes: uniqueSorted(reasonCodes),
    ...SAFE_FLAGS
  };
  const result = {
    ok: false,
    status: reasonCodes.includes('capability_not_supported')
      ? 'PUBLIC_WEB_CANARY_HANDOFF_NOT_SUPPORTED'
      : 'PUBLIC_WEB_CANARY_HANDOFF_BLOCKED',
    reason_codes: audit.reason_codes,
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    ...SAFE_FLAGS,
    fake_network_used: false,
    handoff_fingerprint: computeHandoffFingerprint(audit),
    pipeline: null,
    evidence: null,
    audit,
    validator_version: PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_VALIDATOR_VERSION
  };
  return cloneFrozen(result);
}

function buildSuccessResult(envelope, prepared) {
  const pipeline = pipelineSummary(envelope);
  const evidence = buildEvidence(prepared);
  const audit = {
    event_name: 'public_web_canary_queued_handoff_simulated',
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    request_id: pipeline.request_id,
    correlation_id: pipeline.correlation_id,
    trace_id: pipeline.trace_id,
    queue_placement_package_id: pipeline.queue_placement_package_id,
    worker_reference_ids: pipeline.worker_reference_ids,
    dispatch_package_id: pipeline.dispatch_package_id,
    input_fingerprint: computeHandoffFingerprint(pipeline),
    evidence_fingerprint: computeHandoffFingerprint(evidence),
    ...SAFE_FLAGS
  };
  const result = {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED',
    reason_codes: [],
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    ...SAFE_FLAGS,
    fake_network_used: evidence.fake_network_used,
    handoff_fingerprint: computeHandoffFingerprint({ pipeline, evidence, audit }),
    pipeline,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_VALIDATOR_VERSION
  };
  return cloneFrozen(result);
}

function evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, options = {}) {
  const pipelineFailures = collectPublicWebCanaryQueuedSimulationFailures(envelope);
  if (pipelineFailures.length > 0) return buildBlockedResult(envelope, pipelineFailures);
  const preparationFailures = collectPreparationFailures(options.preparedTrial || options.canaryPreparation);
  if (preparationFailures.length > 0) return buildBlockedResult(envelope, preparationFailures);
  return buildSuccessResult(envelope, options.preparedTrial || options.canaryPreparation);
}

function valuesEqual(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function validatePublicWebCanaryQueuedSimulationResult(result, context = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['public_web_canary_queued_simulation_result_must_be_object'] };
  exactFields(result, PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_FIELDS, 'public_web_canary_queued_simulation_result', errors);
  if (typeof result.ok !== 'boolean') errors.push('ok_must_be_boolean');
  if (!PUBLIC_WEB_CANARY_QUEUED_SIMULATION_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!Array.isArray(result.reason_codes) || result.reason_codes.some((reason) => !isNonEmptyString(reason))) errors.push('reason_codes_invalid');
  if (result.capability !== PUBLIC_WEB_CANARY_CAPABILITY) errors.push('capability_invalid');
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (typeof result.fake_network_used !== 'boolean') errors.push('fake_network_used_must_be_boolean');
  if (!isNonEmptyString(result.handoff_fingerprint)) errors.push('handoff_fingerprint_invalid');
  if (result.validator_version !== PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (result.ok === true) {
    if (result.status !== 'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED') errors.push('ok_status_mismatch');
    if (result.reason_codes.length !== 0) errors.push('ok_reason_codes_must_be_empty');
    if (!isPlainObject(result.pipeline)) errors.push('pipeline_required');
    if (!isPlainObject(result.evidence)) errors.push('evidence_required');
    if (!isPlainObject(result.audit)) errors.push('audit_required');
    if (isPlainObject(result.evidence) && result.fake_network_used !== (result.evidence.fake_network_used === true)) errors.push('fake_network_used_mismatch');
    if (isPlainObject(result.pipeline) && isPlainObject(result.audit)) {
      for (const field of ['request_id', 'correlation_id', 'trace_id']) {
        if (result.audit[field] !== result.pipeline[field]) errors.push(`audit_${field}_mismatch`);
      }
      if (result.audit.dispatch_package_id !== result.pipeline.dispatch_package_id) errors.push('audit_dispatch_package_id_mismatch');
      if (!valuesEqual(result.audit.worker_reference_ids, result.pipeline.worker_reference_ids)) errors.push('audit_worker_reference_ids_mismatch');
      if (result.audit.input_fingerprint !== computeHandoffFingerprint(result.pipeline)) errors.push('audit_input_fingerprint_mismatch');
    }
    if (isPlainObject(result.evidence) && isPlainObject(result.audit)) {
      if (result.evidence.capability !== result.capability) errors.push('evidence_capability_mismatch');
      if (result.evidence.real_provider_called !== false) errors.push('evidence_real_provider_called_must_be_false');
      if (result.evidence.network_used !== false) errors.push('evidence_network_used_must_be_false');
      if (result.evidence.secret_resolved !== false) errors.push('evidence_secret_resolved_must_be_false');
      if (result.audit.evidence_fingerprint !== computeHandoffFingerprint(result.evidence)) errors.push('audit_evidence_fingerprint_mismatch');
    }
    if (computeHandoffFingerprint({ pipeline: result.pipeline, evidence: result.evidence, audit: result.audit }) !== result.handoff_fingerprint) {
      errors.push('handoff_fingerprint_mismatch');
    }
  } else {
    if (result.status === 'PUBLIC_WEB_CANARY_HANDOFF_SIMULATED') errors.push('blocked_status_mismatch');
    if (result.reason_codes.length === 0) errors.push('blocked_reason_codes_required');
    if (result.pipeline !== null) errors.push('blocked_pipeline_must_be_null');
    if (result.evidence !== null) errors.push('blocked_evidence_must_be_null');
    if (!isPlainObject(result.audit)) errors.push('blocked_audit_required');
    if (isPlainObject(result.audit) && computeHandoffFingerprint(result.audit) !== result.handoff_fingerprint) {
      errors.push('handoff_fingerprint_mismatch');
    }
    if (isPlainObject(result.audit) && !valuesEqual(result.audit.reason_codes, result.reason_codes)) {
      errors.push('audit_reason_codes_mismatch');
    }
  }
  if (!isPlainObject(context) || !Object.prototype.hasOwnProperty.call(context, 'envelope')) {
    errors.push('validation_context_required');
  } else {
    const expected = evaluatePublicWebCanaryQueuedSimulationBoundary(context.envelope, {
      preparedTrial: context.preparedTrial || context.canaryPreparation
    });
    if (!valuesEqual(result, expected)) errors.push('result_context_mismatch');
  }
  if (findCanaryForbiddenFields(result).length > 0) errors.push('forbidden_field_detected');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  PUBLIC_WEB_CANARY_CAPABILITY,
  PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_FIELDS,
  PUBLIC_WEB_CANARY_QUEUED_SIMULATION_RESULT_VALIDATOR_VERSION,
  PUBLIC_WEB_CANARY_QUEUED_SIMULATION_STATUSES,
  SAFE_FLAGS,
  collectPublicWebCanaryQueuedSimulationFailures,
  computeHandoffFingerprint,
  evaluatePublicWebCanaryQueuedSimulationBoundary,
  validatePublicWebCanaryQueuedSimulationResult
};
