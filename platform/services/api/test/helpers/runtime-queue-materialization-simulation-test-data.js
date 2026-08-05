'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeQueueMaterializationRequest
// bundle on top of PR #108's own golden RuntimeQueueAdmissionRequest bundle -- the already-
// QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION chain plus every reference this layer needs to bundle
// for non-substitution proof (Admission Entries, the Admission Order Reference itself, Queue Class
// References).
const {
  buildGoldenQueueAdmissionBundle, evaluateRuntimeQueueAdmissionRequest
} = require('./runtime-queue-admission-simulation-test-data');
const { buildRuntimeQueueMaterializationRequest } = require('../../src/core/runtime-queue-materialization-request');
const { evaluateRuntimeQueueMaterializationRequest } = require('../../src/core/runtime-queue-materialization-boundary');

function buildGoldenQueueMaterializationBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const admissionGolden = buildGoldenQueueAdmissionBundle(scenarioKey, overrides.admission);
  const admissionOutcome = evaluateRuntimeQueueAdmissionRequest(admissionGolden.queueAdmissionRequest, {});
  if (admissionOutcome.decision.status !== 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION') {
    throw new Error(`golden queue admission bundle for ${scenarioKey} did not reach QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION: ${admissionOutcome.decision.status}`);
  }

  const baseId = `${admissionGolden.baseId}-queue-materialization`;
  const requestId = `${baseId}-request`;

  const request = buildRuntimeQueueMaterializationRequest({
    runtime_queue_materialization_request_id: requestId,
    runtime_queue_admission_package_reference: admissionOutcome.package,
    runtime_queue_admission_entry_references: admissionOutcome.admissionEntryRefs,
    runtime_queue_admission_order_reference: admissionOutcome.orderRef,
    runtime_queue_class_references: admissionOutcome.queueClassRefs,
    correlation_id: 'corr-queue-materialization-1',
    causation_id: 'cause-queue-materialization-1',
    trace_id: 'trace-queue-materialization-1',
    logical_sequence: 0,
    expected_queue_materialization_registry_version: 1,
    simulation_context: admissionGolden.queueAdmissionRequest.simulation_context,
    ...overrides.request
  });

  return {
    ...admissionGolden, admissionOutcome, baseId, requestId,
    queueMaterializationRequest: request
  };
}

module.exports = {
  buildGoldenQueueMaterializationBundle,
  evaluateRuntimeQueueMaterializationRequest
};
