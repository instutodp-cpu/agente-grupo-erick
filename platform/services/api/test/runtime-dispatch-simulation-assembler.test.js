'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGoldenWorkerAssignmentBundle } = require('./helpers/runtime-worker-assignment-test-data');
const { evaluateRuntimeWorkerAssignmentRequest } = require('../src/core/runtime-worker-assignment-boundary');
const { evaluateRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-boundary');
const { assembleRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-assembler');

function prepared() {
  const upstream = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan');
  const workerAssignmentOutcome = evaluateRuntimeWorkerAssignmentRequest(upstream.workerAssignmentRequest, {});
  assert.equal(workerAssignmentOutcome.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
  return { upstream, workerAssignmentOutcome, schedulerDependencyRefs: upstream.schedulerOutcome.schedulerDependencyRefs };
}

test('composes prepared worker assignment into declarative dispatch package', () => {
  const { upstream, workerAssignmentOutcome, schedulerDependencyRefs } = prepared();
  const request = assembleRuntimeDispatchRequest({ workerAssignmentRequest: upstream.workerAssignmentRequest, workerAssignmentOutcome, schedulerDependencyRefs });
  const outcome = evaluateRuntimeDispatchRequest(request, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  for (const field of ['dispatch_applied', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed']) assert.equal(outcome.decision[field], false);
  assert.equal(outcome.decision.production_blocked, true);
});

test('fails closed when worker assignment is not prepared', () => {
  const { upstream, workerAssignmentOutcome, schedulerDependencyRefs } = prepared();
  const tampered = { ...workerAssignmentOutcome, decision: { ...workerAssignmentOutcome.decision, status: 'WORKER_ASSIGNMENT_POLICY_BLOCKED' } };
  assert.throws(() => assembleRuntimeDispatchRequest({ workerAssignmentRequest: upstream.workerAssignmentRequest, workerAssignmentOutcome: tampered, schedulerDependencyRefs }), /worker_assignment_not_prepared/);
});

test('fails closed on upstream package drift', () => {
  const { upstream, workerAssignmentOutcome, schedulerDependencyRefs } = prepared();
  const tampered = { ...workerAssignmentOutcome, package: { ...workerAssignmentOutcome.package, runtime_scheduler_package_id: 'drift' } };
  assert.throws(() => assembleRuntimeDispatchRequest({ workerAssignmentRequest: upstream.workerAssignmentRequest, workerAssignmentOutcome: tampered, schedulerDependencyRefs }), /package_drift/);
});

test('fails closed on operational worker assignment state', () => {
  const { upstream, workerAssignmentOutcome, schedulerDependencyRefs } = prepared();
  const tampered = { ...workerAssignmentOutcome, decision: { ...workerAssignmentOutcome.decision, worker_started: true } };
  assert.throws(() => assembleRuntimeDispatchRequest({ workerAssignmentRequest: upstream.workerAssignmentRequest, workerAssignmentOutcome: tampered, schedulerDependencyRefs }), /safety_invariant_failed/);
});
