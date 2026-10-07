'use strict';

const { buildRuntimeQueueMaterializationRequest } = require('./runtime-queue-materialization-request');

function assembleRuntimeQueueMaterializationRequest(input = {}) {
  const { queueAdmissionRequest, queueAdmissionOutcome } = input;
  if (!queueAdmissionRequest || !queueAdmissionOutcome) throw new Error('runtime_queue_materialization_assembler_missing_input');
  const { decision, package: admissionPackage, admissionEntryRefs, orderRef, queueClassRefs } = queueAdmissionOutcome;
  if (!decision || !admissionPackage || decision.status !== 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION') {
    throw new Error('runtime_queue_materialization_assembler_admission_not_prepared');
  }
  for (const field of ['queue_admission_applied', 'queue_created', 'queue_item_created', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed']) {
    if (decision[field] !== false) throw new Error('runtime_queue_materialization_assembler_admission_safety_invariant_failed');
  }
  if (decision.production_blocked !== true) throw new Error('runtime_queue_materialization_assembler_admission_safety_invariant_failed');
  return buildRuntimeQueueMaterializationRequest({
    runtime_queue_materialization_request_id: queueAdmissionRequest.runtime_queue_admission_request_id + '-materialization-request',
    runtime_queue_admission_package_reference: admissionPackage,
    runtime_queue_admission_entry_references: admissionEntryRefs,
    runtime_queue_admission_order_reference: orderRef,
    runtime_queue_class_references: queueClassRefs,
    correlation_id: queueAdmissionRequest.correlation_id,
    causation_id: queueAdmissionRequest.causation_id,
    trace_id: queueAdmissionRequest.trace_id,
    logical_sequence: queueAdmissionRequest.logical_sequence,
    expected_queue_materialization_registry_version: 1,
    simulation_context: queueAdmissionRequest.simulation_context
  });
}

module.exports = { assembleRuntimeQueueMaterializationRequest };
