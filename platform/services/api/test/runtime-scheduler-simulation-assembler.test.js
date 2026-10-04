'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleRuntimeSchedulerRequest } = require('../src/core/runtime-scheduler-assembler');
const { evaluateRuntimeSchedulerRequest } = require('../src/core/runtime-scheduler-boundary');
const { buildGoldenAdmissionBundle, evaluateRuntimeAdmissionRequest } = require('./helpers/runtime-readiness-admission-test-data');
const fixture = require('./fixtures/hermes-execution-plan-contracts.json');

function input() {
  const golden = buildGoldenAdmissionBundle('prepared-no-llm-plan');
  const admissionOutcome = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  return {
    executionPlanRequest: fixture.scenarios['prepared-no-llm-plan'].request,
    runtimeAssembly: {
      runtimeStageManifest: golden.runtimeStageManifest,
      runtimeDependencyManifest: golden.runtimeDependencyManifest,
      runtimeBudgetReference: golden.runtimeBudgetReference,
      runtimeStopRefs: golden.runtimeStopRefs,
      runtimeCompensationRefs: golden.runtimeCompensationRefs,
      runtimeArtifactPlan: golden.runtimeArtifactPlan,
      runtimeEventPlan: golden.runtimeEventPlan
    },
    runtimeOutcome: { runtimePackage: golden.runtimePackage },
    readinessOutcome: { decision: golden.readinessDecision },
    admissionAssembly: {
      readinessRequest: golden.readinessRequest,
      admissionRequest: golden.admissionRequest,
      replayReference: golden.replayRef
    },
    admissionOutcome
  };
}

test('assembles canonical scheduler request and reaches prepared simulation', () => {
  const value = input();
  const request = assembleRuntimeSchedulerRequest(value);
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.decision.scheduler_started, false);
  assert.equal(outcome.decision.queue_created, false);
  assert.equal(outcome.decision.worker_started, false);
  assert.equal(outcome.decision.stage_dispatched, false);
  assert.equal(outcome.decision.executed, false);
  assert.equal(outcome.decision.production_blocked, true);
});

test('fails closed on runtime package drift', () => {
  const value = input();
  value.runtimeOutcome = {
    runtimePackage: { ...value.runtimeOutcome.runtimePackage, runtime_execution_package_id: 'drifted-runtime-package' }
  };
  assert.throws(() => assembleRuntimeSchedulerRequest(value), /runtime_scheduler_assembler_package_drift/);
});

test('fails closed when upstream admission is not admitted', () => {
  const value = input();
  value.admissionOutcome = {
    ...value.admissionOutcome,
    decision: { ...value.admissionOutcome.decision, status: 'RUNTIME_ADMISSION_BLOCKED' }
  };
  assert.throws(() => assembleRuntimeSchedulerRequest(value), /runtime_scheduler_assembler_upstream_not_admitted/);
});

test('fails closed when runtime safety invariant is violated', () => {
  const value = input();
  value.runtimeOutcome = {
    runtimePackage: { ...value.runtimeOutcome.runtimePackage, execution_started: true }
  };
  assert.throws(() => assembleRuntimeSchedulerRequest(value), /runtime_scheduler_assembler_safety_invariant_failed/);
});

test('fails closed when admission safety invariant is violated', () => {
  const value = input();
  value.admissionOutcome = {
    ...value.admissionOutcome,
    decision: { ...value.admissionOutcome.decision, execution_authorized: true }
  };
  assert.throws(() => assembleRuntimeSchedulerRequest(value), /runtime_scheduler_assembler_admission_safety_invariant_failed/);
});
