'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGoldenQueueAdmissionBundle, evaluateRuntimeQueueAdmissionRequest } = require('./helpers/runtime-queue-admission-simulation-test-data');
const { evaluateRuntimeQueueMaterializationRequest } = require('../src/core/runtime-queue-materialization-boundary');
const { evaluateRuntimeQueuePlacementRequest } = require('../src/core/runtime-queue-placement-boundary');
const { assembleRuntimeQueueMaterializationRequest } = require('../src/core/runtime-queue-materialization-assembler');
const { assembleRuntimeQueuePlacementRequest } = require('../src/core/runtime-queue-placement-assembler');

test('composes canonical admission outcome through materialization and placement without operational effects', () => {
  const golden = buildGoldenQueueAdmissionBundle('prepared-no-llm-plan');
  const admission = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const materializationRequest = assembleRuntimeQueueMaterializationRequest({ queueAdmissionRequest: golden.queueAdmissionRequest, queueAdmissionOutcome: admission });
  assert.deepEqual(materializationRequest.runtime_queue_admission_package_reference, admission.package);
  const materialization = evaluateRuntimeQueueMaterializationRequest(materializationRequest, {});
  assert.equal(materialization.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(materialization.decision.queue_created, false);
  assert.equal(materialization.decision.production_blocked, true);
  const placementRequest = assembleRuntimeQueuePlacementRequest({ queueMaterializationRequest: materializationRequest, queueMaterializationOutcome: materialization });
  assert.deepEqual(placementRequest.runtime_queue_materialization_package_reference, materialization.package);
  const placement = evaluateRuntimeQueuePlacementRequest(placementRequest, {});
  assert.equal(placement.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
  assert.equal(placement.decision.queue_created, false);
  assert.equal(placement.decision.queue_item_created, false);
  assert.equal(placement.decision.executed, false);
  assert.equal(placement.decision.production_blocked, true);
});

test('materialization assembler fails closed when admission is not prepared', () => {
  assert.throws(() => assembleRuntimeQueueMaterializationRequest({ queueAdmissionRequest: {}, queueAdmissionOutcome: { decision: { status: 'BLOCKED' }, package: {} } }), /admission_not_prepared/);
});

test('placement assembler fails closed when materialization is not prepared', () => {
  assert.throws(() => assembleRuntimeQueuePlacementRequest({ queueMaterializationRequest: {}, queueMaterializationOutcome: { decision: { status: 'BLOCKED' }, package: {} } }), /materialization_not_prepared/);
});
