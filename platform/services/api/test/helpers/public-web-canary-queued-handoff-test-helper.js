'use strict';

const {
  PUBLIC_WEB_CANARY_CAPABILITY,
  collectPublicWebCanaryQueuedSimulationFailures,
  evaluatePublicWebCanaryQueuedSimulationBoundary
} = require('../../src/core/public-web-canary-queued-simulation-boundary');
const { createPublicWebCanaryOperationalTrial } = require('../../src/pilots/public-web-canary-operational-trial');
const {
  deterministicClock,
  fakeDryRunRunner,
  fakeNodeHttpsClient,
  validPreflightContext,
  validTrialConfig
} = require('./public-web-canary-trial-test-data');

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
  const reasonCodes = collectPublicWebCanaryQueuedSimulationFailures(envelope);
  if (reasonCodes.length > 0) return evaluatePublicWebCanaryQueuedSimulationBoundary(envelope);

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
    return evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, {
      preparedTrial: {
        ok: false,
        plan: {},
        preflight: {},
        dry_run: {}
      }
    });
  }
  return deepFreeze(evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared }));
}

module.exports = {
  PUBLIC_WEB_CANARY_CAPABILITY,
  buildPublicWebCanaryQueuedSimulationEnvelope,
  runPublicWebCanaryQueuedSimulationHandoff
};
