'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { buildAdmissionResult } = require('../src/core/runtime-execution-attempt-durable-admission');
const { buildClaimIntent } = require('../src/core/runtime-execution-attempt-claim-intent-simulation');
const {
  buildClaimEligibilityDecision,
  computeDecisionDigest,
  computeDecisionFingerprint
} = require('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation');
const { buildAcquisitionPlan, planToInsertRow } = require('../src/core/runtime-execution-attempt-durable-claim-acquisition');
const { buildRuntimeStageSimulationReference } = require('../src/core/runtime-stage-simulation-reference');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  SELECTION_POLICY,
  buildSelectionPlan,
  classifyPersistedSelection,
  planToInsertRow: selectionToInsertRow,
  validatePersistedSelection
} = require('../src/core/runtime-execution-attempt-claim-worker-selection');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/010_create_runtime_execution_attempt_claim_worker_selections.sql');
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
  const p8 = buildAdmissionInput(attemptOrdinal);
  const p9 = buildAdmissionResult({
    outcome: 'ADMITTED', record: p8.p7_durable_record, decision: p8.p8_admission_decision,
    finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted'
  });
  const intent = buildClaimIntent({ p7_durable_record: p8.p7_durable_record, p9_durable_admission: p9 });
  const decision = buildClaimEligibilityDecision({
    runtime_execution_attempt_claim_intent: intent,
    ...buildWorkerEvidence(p8.p7_durable_record.identity_scope)
  });
  const plan = buildAcquisitionPlan({
    runtime_execution_attempt_claim_intent: intent,
    runtime_execution_attempt_claim_eligibility_decision: decision
  });
  return planToInsertRow(plan);
}

function buildStage(overrides = {}) {
  return buildRuntimeStageSimulationReference({
    runtime_stage_reference_id: 'stage-selection-1',
    runtime_stage_reference_version: 1,
    runtime_request_id: 'request-selection-1',
    runtime_execution_package_id: 'package-selection-1',
    execution_plan_id: 'execution-plan-selection-1',
    source_execution_stage_id: 'execution-stage-selection-1',
    source_orchestrator_stage_id: 'orchestrator-stage-selection-1',
    stage_sequence: 0,
    stage_type: 'MODEL_REFERENCE_STAGE',
    task_reference_id: 'task-selection-1',
    side_effect_classification: 'NONE',
    risk_classification: 'LOW',
    required_capabilities: [],
    required_modalities: ['TEXT_INPUT'],
    ...overrides
  });
}

function buildWorker(overrides = {}) {
  return buildWorkerRegistration({
    worker_id: 'worker-selection-a',
    tenant_id: 'tenant-p9',
    organization_id: 'organization-p9',
    project_id: 'project-p9',
    worker_type: 'DEDICATED_REFERENCE',
    lifecycle_state: 'ACTIVE',
    worker_capability_reference_id: 'capability-selection-1',
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

test('P13B selects the first authoritative static candidate by canonical worker_id order', () => {
  const plan = buildSelectionPlan({
    claim: buildClaimRow(),
    stage_reference: buildStage(),
    workers: [buildWorker({ worker_id: 'worker-selection-z' }), buildWorker()]
  });
  assert.equal(plan.outcome, 'READY');
  assert.equal(plan.selected_worker_id, 'worker-selection-a');
  assert.equal(plan.identity.selection_policy, SELECTION_POLICY);
  assert.equal(plan.artifact.selection_creates_binding, false);
  assert.equal(plan.artifact.selection_grants_ownership, false);
  assert.equal(plan.artifact.selection_reserves_capacity, false);
  assert.equal(plan.artifact.selection_creates_lease, false);
  assert.equal(plan.artifact.selection_creates_fencing, false);
  assert.equal(plan.artifact.selection_authorizes_execution, false);
  assert.equal(plan.simulation, false);
  assert.equal(plan.production_blocked, true);
});

test('P13B selection replay is deterministic and does not mutate its inputs', () => {
  const input = { claim: buildClaimRow(), stage_reference: buildStage(), workers: [buildWorker()] };
  const before = mutable(input);
  const first = buildSelectionPlan(input);
  const replay = buildSelectionPlan(input);
  assert.equal(first.selection_id, replay.selection_id);
  assert.equal(first.selection_digest, replay.selection_digest);
  assert.deepEqual(input, before);
  assert.equal(CONTRACT_NAME, 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_SELECTION_AUTHORITY');
  assert.equal(CONTRACT_VERSION, 'runtime_execution_attempt_claim_worker_selection_authority_contract_v1');
});

test('P13B excludes inactive, cross-scope and incompatible workers and fails closed when empty', () => {
  const claim = buildClaimRow();
  const stage = buildStage();
  const inactive = buildWorker({ worker_id: 'worker-inactive', lifecycle_state: 'DISABLED' });
  const wrongScope = buildWorker({ worker_id: 'worker-wrong-scope', tenant_id: 'other-tenant' });
  const wrongType = buildWorker({ worker_id: 'worker-wrong-stage', supported_stage_types: ['TOOL_REFERENCE_STAGE'] });
  const noMatch = buildSelectionPlan({ claim, stage_reference: stage, workers: [inactive, wrongScope, wrongType] });
  assert.equal(noMatch.outcome, 'NO_ELIGIBLE_WORKER');
  assert.equal(noMatch.reason_code, 'no_static_eligible_worker');
  assert.equal(noMatch.selection_creates_binding, false);
});

test('P13B rejects invalid claim authority and malformed canonical stage before selection', () => {
  const claim = buildClaimRow();
  assert.equal(buildSelectionPlan({ claim: { ...claim, claim_state: 'RELEASED' }, stage_reference: buildStage(), workers: [buildWorker()] }).outcome, 'INVALID');
  assert.equal(buildSelectionPlan({ claim: { ...claim, claim_eligibility_decision_status: 'INELIGIBLE' }, stage_reference: buildStage(), workers: [buildWorker()] }).outcome, 'INVALID');
  assert.equal(buildSelectionPlan({ claim, stage_reference: { ...buildStage(), stage_fingerprint: 'tampered' }, workers: [buildWorker()] }).outcome, 'INVALID');
});

test('same claim-stage slot classifies exact replay and divergent selected worker without mutation', () => {
  const claim = buildClaimRow();
  const stage = buildStage();
  const first = buildSelectionPlan({ claim, stage_reference: stage, workers: [buildWorker(), buildWorker({ worker_id: 'worker-selection-z' })] });
  const divergent = buildSelectionPlan({ claim, stage_reference: stage, workers: [buildWorker({ worker_id: 'worker-selection-a', lifecycle_state: 'DISABLED' }), buildWorker({ worker_id: 'worker-selection-z' })] });
  const persisted = selectionToInsertRow(first);
  const before = mutable(persisted);
  assert.equal(classifyPersistedSelection(persisted, first).outcome, 'EXISTING_IDENTICAL');
  assert.equal(classifyPersistedSelection(persisted, divergent).outcome, 'CONFLICT');
  assert.deepEqual(persisted, before);
  assert.equal(validatePersistedSelection(persisted).valid, true);
});

test('P13B migration creates only an immutable claim-stage selection artifact with required constraints', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.runtime_execution_attempt_claim_worker_selections/);
  assert.match(migration, /FOREIGN KEY \(claim_id\).*execution_attempt_claims/s);
  assert.match(migration, /FOREIGN KEY \(selected_worker_id\).*runtime_workers/s);
  assert.match(migration, /UNIQUE \(claim_id, runtime_stage_reference_id, selection_ordinal\)/);
  assert.match(migration, /candidate_set JSONB NOT NULL/);
  assert.match(migration, /selection_digest TEXT NOT NULL/);
  assert.doesNotMatch(migration, /\b(lease|fencing|ownership|capacity_reserved|execution_authorized|worker_binding)_/i);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('P13B pure contract contains no persistence, network, worker binding, lease or execution authority', () => {
  const source = fs.readFileSync(require.resolve('../src/core/runtime-execution-attempt-claim-worker-selection'), 'utf8');
  assert.doesNotMatch(source, /INSERT INTO|UPDATE |DELETE FROM|pool|client\.query|fetch\(|axios|http\.request|https\.request/);
  assert.doesNotMatch(source, /worker_bound\s*[:=]\s*true|lease_created\s*[:=]\s*true|execution_authorized\s*[:=]\s*true/);
});
