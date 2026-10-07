'use strict';

const { buildRuntimeQueuePlacementRequest } = require('./runtime-queue-placement-request');

function assembleRuntimeQueuePlacementRequest(input = {}) {
  const { queueMaterializationRequest, queueMaterializationOutcome } = input;
  if (!queueMaterializationRequest || !queueMaterializationOutcome) throw new Error('runtime_queue_placement_assembler_missing_input');
  const { decision, package: materializationPackage, materializationEntryRefs, orderRef, queueClassRefs } = queueMaterializationOutcome;
  if (!decision || !materializationPackage || decision.status !== 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION') {
    throw new Error('runtime_queue_placement_assembler_materialization_not_prepared');
  }
  for (const field of ['queue_materialization_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued', 'worker_notified', 'job_created', 'dispatch_executed', 'executed']) {
    if (decision[field] !== false) throw new Error('runtime_queue_placement_assembler_materialization_safety_invariant_failed');
  }
  if (decision.production_blocked !== true) throw new Error('runtime_queue_placement_assembler_materialization_safety_invariant_failed');
  return buildRuntimeQueuePlacementRequest({
    runtime_queue_placement_request_id: queueMaterializationRequest.runtime_queue_materialization_request_id + '-placement-request',
    runtime_queue_materialization_package_reference: materializationPackage,
    runtime_queue_materialization_entry_references: materializationEntryRefs,
    runtime_queue_materialization_order_reference: orderRef,
    runtime_queue_class_references: queueClassRefs,
    correlation_id: queueMaterializationRequest.correlation_id,
    causation_id: queueMaterializationRequest.causation_id,
    trace_id: queueMaterializationRequest.trace_id,
    logical_sequence: queueMaterializationRequest.logical_sequence,
    expected_queue_placement_registry_version: 1,
    simulation_context: queueMaterializationRequest.simulation_context
  });
}

module.exports = { assembleRuntimeQueuePlacementRequest };
