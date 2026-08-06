'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeQueuePlacementRequest bundle
// on top of PR #109's own golden RuntimeQueueMaterializationRequest bundle -- the already-
// QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION chain plus every reference this layer needs to
// bundle for non-substitution proof (Materialization Entries, the Materialization Order Reference
// itself, Queue Class References).
const {
  buildGoldenQueueMaterializationBundle, evaluateRuntimeQueueMaterializationRequest
} = require('./runtime-queue-materialization-simulation-test-data');
const { buildRuntimeQueuePlacementRequest } = require('../../src/core/runtime-queue-placement-request');
const { evaluateRuntimeQueuePlacementRequest } = require('../../src/core/runtime-queue-placement-boundary');

function buildGoldenQueuePlacementBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const materializationGolden = buildGoldenQueueMaterializationBundle(scenarioKey, overrides.materialization);
  const materializationOutcome = evaluateRuntimeQueueMaterializationRequest(materializationGolden.queueMaterializationRequest, {});
  if (materializationOutcome.decision.status !== 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION') {
    throw new Error(`golden queue materialization bundle for ${scenarioKey} did not reach QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION: ${materializationOutcome.decision.status}`);
  }

  const baseId = `${materializationGolden.baseId}-queue-placement`;
  const requestId = `${baseId}-request`;

  const request = buildRuntimeQueuePlacementRequest({
    runtime_queue_placement_request_id: requestId,
    runtime_queue_materialization_package_reference: materializationOutcome.package,
    runtime_queue_materialization_entry_references: materializationOutcome.materializationEntryRefs,
    runtime_queue_materialization_order_reference: materializationOutcome.orderRef,
    runtime_queue_class_references: materializationOutcome.queueClassRefs,
    correlation_id: 'corr-queue-placement-1',
    causation_id: 'cause-queue-placement-1',
    trace_id: 'trace-queue-placement-1',
    logical_sequence: 0,
    expected_queue_placement_registry_version: 1,
    simulation_context: materializationGolden.queueAdmissionRequest.simulation_context,
    ...overrides.request
  });

  return {
    ...materializationGolden, materializationOutcome, baseId, requestId,
    queuePlacementRequest: request
  };
}

module.exports = {
  buildGoldenQueuePlacementBundle,
  evaluateRuntimeQueuePlacementRequest
};
