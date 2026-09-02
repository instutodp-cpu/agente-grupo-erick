'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { buildAdmissionResult } = require('../src/core/runtime-execution-attempt-durable-admission');
const { buildClaimIntent } = require('../src/core/runtime-execution-attempt-claim-intent-simulation');
const { buildClaimEligibilityDecision } = require('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation');
const { buildAcquisitionPlan, planToInsertRow: claimToInsertRow } = require('../src/core/runtime-execution-attempt-durable-claim-acquisition');
const { buildRuntimeStageSimulationReference } = require('../src/core/runtime-stage-simulation-reference');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  SAFE_FLAGS,
  buildBindingPlan,
  classifyPersistedBinding,
  planToInsertRow,
  validatePersistedBinding
} = require('../src/core/runtime-execution-attempt-claim-worker-binding');
const { buildSelectionPlan, planToInsertRow: selectionToInsertRow } = require('../src/core/runtime-execution-attempt-claim-worker-selection');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { stablePayload } = require('../src/core/agent-identity-contract');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/011_create_runtime_execution_attempt_claim_worker_bindings.sql');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildWorkerEvidence(scope) {
  const { buildGoldenWorkerAssignmentBundle, evaluateRuntimeWorkerAssignmentRequest } = require('./helpers/runtime-worker-assignment-test-data');
  const { computeWorkerAssignmentPackageDigest, computeWorkerAssignmentPackageFingerprint } = require('../src/core/runtime-worker-assignment-package');
  const { computeHealthFingerprint } = require('../src/core/runtime-worker-health-reference');
  const { computeCapacityDigest, computeCapacityFingerprint } = require('../src/core/runtime-worker-capacity-reference');
  const { computeFreshnessFingerprint } = require('../src/core/runtime-readiness-freshness-reference');
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  const assignmentPackage = mutable(outcome.package);
  const assignmentDecision = mutable(outcome.decision);
  const health = mutable(golden.pool.health);
  const capacity = mutable(golden.pool.capacity);
  const freshness = mutable(golden.freshnessRef);
  Object.assign(assignmentPackage, scope);
  Object.assign(assignmentDecision, scope);
  health.health_fingerprint = computeHealthFingerprint(health);
  capacity.capacity_fingerprint = computeCapacityFingerprint(capacity);
  capacity.capacity_digest = computeCapacityDigest(capacity);
  freshness.freshness_fingerprint = computeFreshnessFingerprint(freshness);
  assignmentPackage.worker_health_fingerprints = [health.health_fingerprint];
  assignmentPackage.worker_capacity_fingerprints = [capacity.capacity_fingerprint];
  assignmentPackage.freshness_fingerprint = freshness.freshness_fingerprint;
  assignmentPackage.worker_assignment_package_fingerprint = computeWorkerAssignmentPackageFingerprint(assignmentPackage);
  assignmentPackage.worker_assignment_package_digest = computeWorkerAssignmentPackageDigest(assignmentPackage);
  assignmentDecision.runtime_worker_assignment_package_fingerprint = assignmentPackage.worker_assignment_package_fingerprint;
  assignmentDecision.runtime_worker_assignment_package_digest = assignmentPackage.worker_assignment_package_digest;
  return {
    runtime_worker_assignment_decision: assignmentDecision,
    runtime_worker_assignment_package: assignmentPackage,
    runtime_worker_health_reference: health,
    runtime_worker_capacity_reference: capacity,
    runtime_freshness_reference: freshness
  };
}

function buildClaimRow(attemptOrdinal = 1) {
  const input = buildAdmissionInput(attemptOrdinal, { compact: true });
  const admission = buildAdmissionResult({
    outcome: 'ADMITTED', record: input.p7_durable_record, decision: input.p8_admission_decision,
    finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted'
  });
  const intent = buildClaimIntent({ p7_durable_record: input.p7_durable_record, p9_durable_admission: admission });
  const decision = buildClaimEligibilityDecision({
    runtime_execution_attempt_claim_intent: intent,
    ...buildWorkerEvidence(input.p7_durable_record.identity_scope)
  });
  return claimToInsertRow(buildAcquisitionPlan({
    runtime_execution_attempt_claim_intent: intent,
    runtime_execution_attempt_claim_eligibility_decision: decision
  }));
}

function buildStage() {
  return buildRuntimeStageSimulationReference({
    runtime_stage_reference_id: 'stage-binding-1',
    runtime_stage_reference_version: 1,
    runtime_request_id: 'request-binding-1',
    runtime_execution_package_id: 'package-binding-1',
    execution_plan_id: 'execution-plan-binding-1',
    source_execution_stage_id: 'execution-stage-binding-1',
    source_orchestrator_stage_id: 'orchestrator-stage-binding-1',
    stage_sequence: 0,
    stage_type: 'MODEL_REFERENCE_STAGE',
    task_reference_id: 'task-binding-1',
    side_effect_classification: 'NONE',
    risk_classification: 'LOW',
    required_capabilities: [],
    required_modalities: ['TEXT_INPUT']
  });
}

function buildWorker(overrides = {}) {
  return buildWorkerRegistration({
    worker_id: 'worker-binding-a',
    tenant_id: 'tenant-p9',
    organization_id: 'organization-p9',
    project_id: 'project-p9',
    worker_type: 'DEDICATED_REFERENCE',
    lifecycle_state: 'ACTIVE',
    worker_capability_reference_id: 'capability-binding-1',
    worker_compatibility_reference_ids: [],
    supported_stage_types: ['MODEL_REFERENCE_STAGE'],
    supported_modalities: ['TEXT_INPUT'],
    supported_model_provider_ids: [],
    supported_model_ids: [],
    supported_tool_ids: [],
    supported_workflow_ids: [],
    ...overrides
  });
}

function buildGraph() {
  const claim = buildClaimRow();
  const stage = buildStage();
  const worker = buildWorker();
  const selectionPlan = buildSelectionPlan({ claim, stage_reference: stage, workers: [worker] });
  assert.equal(selectionPlan.outcome, 'READY');
  return { claim, stage, worker, selection: selectionToInsertRow(selectionPlan) };
}

test('P13C derives a deterministic binding from the compact canonical predecessor graph', () => {
  const first = buildGraph();
  const second = buildGraph();
  const firstPlan = buildBindingPlan(first);
  const secondPlan = buildBindingPlan(second);
  assert.equal(firstPlan.outcome, 'READY');
  assert.equal(firstPlan.binding_id, secondPlan.binding_id);
  assert.equal(firstPlan.binding_fingerprint, secondPlan.binding_fingerprint);
  assert.equal(firstPlan.binding_digest, secondPlan.binding_digest);
  assert.deepEqual(firstPlan.binding_artifact, {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    binding_id: firstPlan.binding_id,
    claim_id: first.claim.claim_id,
    selection_id: first.selection.selection_id,
    runtime_stage_reference_id: first.stage.runtime_stage_reference_id,
    selected_worker_id: first.worker.worker_id,
    binding_digest: firstPlan.binding_digest,
    ...SAFE_FLAGS
  });
  assert.equal(firstPlan.binding_artifact.worker_bound, true);
  assert.equal(firstPlan.binding_artifact.worker_ownership_established, false);
  assert.equal(firstPlan.binding_artifact.lease_created, false);
  assert.equal(firstPlan.binding_artifact.fencing_token_created, false);
  assert.equal(firstPlan.binding_artifact.execution_authorized, false);
});

test('P13C fails closed for stale, invalid, tampered, mismatched, and missing predecessors', () => {
  const graph = buildGraph();
  assert.equal(buildBindingPlan({ ...graph, claim: { ...graph.claim, claim_state: 'RELEASED' } }).outcome, 'STALE');
  assert.equal(buildBindingPlan({ ...graph, selection: { ...graph.selection, selection_digest: 'sha256:' + 'f'.repeat(64) } }).outcome, 'INVALID');
  assert.equal(buildBindingPlan({ ...graph, worker: null }).outcome, 'INVALID');
  assert.equal(buildBindingPlan({ ...graph, worker: buildWorker({ worker_id: 'worker-binding-other' }) }).outcome, 'INVALID');
  assert.equal(buildBindingPlan({ ...graph, worker: buildWorker({ tenant_id: 'tenant-other' }) }).outcome, 'INVALID');
  assert.equal(buildBindingPlan({ ...graph, claim: { ...graph.claim, organization_id: 'organization-other' } }).outcome, 'INVALID');
  assert.equal(buildBindingPlan({ ...graph, selection: { ...graph.selection, claim_id: 'claim-other' } }).outcome, 'INVALID');
  assert.equal(buildBindingPlan({ ...graph, selection: { ...graph.selection, runtime_stage_reference_id: 'stage-other' } }).outcome, 'INVALID');
});

test('P13C classifies exact replay and divergent slot identity without UPDATE', () => {
  const graph = buildGraph();
  const plan = buildBindingPlan(graph);
  const persisted = planToInsertRow(plan);
  assert.equal(validatePersistedBinding(persisted).valid, true);
  assert.equal(classifyPersistedBinding(persisted, plan).outcome, 'EXISTING_IDENTICAL');
  const divergentIdentity = { ...plan.identity, selected_worker_digest: 'sha256:' + 'f'.repeat(64) };
  const divergentDigest = computeCanonicalContentDigest(divergentIdentity);
  const divergent = {
    ...persisted,
    binding_id: `runtime-execution-attempt-claim-worker-binding-${divergentDigest.slice('sha256:'.length)}`,
    selected_worker_digest: divergentIdentity.selected_worker_digest,
    binding_fingerprint: stablePayload(divergentIdentity),
    binding_digest: divergentDigest,
    binding_artifact: { ...persisted.binding_artifact, binding_id: `runtime-execution-attempt-claim-worker-binding-${divergentDigest.slice('sha256:'.length)}`, binding_digest: divergentDigest }
  };
  assert.equal(classifyPersistedBinding(divergent, plan).outcome, 'CONFLICT');
  assert.equal(Object.keys(persisted).includes('owner_id'), false);
  assert.equal(Object.keys(persisted).includes('lease_id'), false);
});

test('P13C migration is idempotent and excludes later-layer authority fields', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.runtime_execution_attempt_claim_worker_bindings/);
  assert.match(migration, /UNIQUE \(claim_id, runtime_stage_reference_id, binding_ordinal\)/);
  assert.match(migration, /FOREIGN KEY \(claim_id\).*execution_attempt_claims/s);
  assert.match(migration, /FOREIGN KEY \(selection_id\).*claim_worker_selections/s);
  assert.match(migration, /FOREIGN KEY \(selected_worker_id\).*runtime_workers/s);
  assert.doesNotMatch(migration, /\b(owner_id|lease_id|expires_at|heartbeat|fencing_token|capacity|quota|execution_status|execution_authority)\b/i);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('P13C boundary is binding-only and cannot authorize later execution layers', () => {
  const source = fs.readFileSync(require.resolve('../src/core/runtime-execution-attempt-claim-worker-binding'), 'utf8');
  const plan = buildBindingPlan(buildGraph());
  assert.equal(plan.outcome, 'READY');
  for (const field of [
    'worker_ownership_established', 'executor_bound', 'executor_ownership_established',
    'capacity_reserved', 'lease_created', 'lease_granted', 'fencing_token_created',
    'fencing_token_issued', 'execution_authorized', 'execution_started', 'execution_performed',
    'binding_grants_ownership', 'binding_reserves_capacity', 'binding_creates_lease',
    'binding_creates_fencing', 'binding_authorizes_execution'
  ]) assert.equal(plan[field], false, field);
  assert.equal(plan.worker_selected, true);
  assert.equal(plan.worker_bound, true);
  assert.equal(plan.production_blocked, true);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE |DELETE FROM|pool|client\.query|fetch\(|axios|http\.request|https\.request/);
});
