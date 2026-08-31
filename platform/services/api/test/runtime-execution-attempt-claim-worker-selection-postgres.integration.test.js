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
const { createRuntimeExecutionAttemptClaimAcquisitionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-acquisition-postgres');
const { createRuntimeExecutionAttemptPersistencePostgres } = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');
const { createRuntimeExecutionAttemptAdmissionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-admission-postgres');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const { createRuntimeWorkerRegistryPostgres } = require('../src/adapters/postgres/runtime-worker-registry-postgres');
const { buildRuntimeStageSimulationReference } = require('../src/core/runtime-stage-simulation-reference');
const { buildGoldenWorkerAssignmentBundle, evaluateRuntimeWorkerAssignmentRequest } = require('./helpers/runtime-worker-assignment-test-data');
const { computeWorkerAssignmentPackageDigest, computeWorkerAssignmentPackageFingerprint } = require('../src/core/runtime-worker-assignment-package');
const { computeHealthFingerprint } = require('../src/core/runtime-worker-health-reference');
const { computeCapacityDigest, computeCapacityFingerprint } = require('../src/core/runtime-worker-capacity-reference');
const { computeFreshnessFingerprint } = require('../src/core/runtime-readiness-freshness-reference');
const { createRuntimeExecutionAttemptClaimWorkerSelectionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-worker-selection-postgres');

const migrationPaths = [
  '004_create_execution_attempts.sql',
  '005_enable_execution_attempt_admission_lifecycle.sql',
  '006_create_execution_attempt_claims.sql',
  '007_complete_execution_attempt_claim_canonical_identity.sql',
  '008_replace_claim_identity_index_with_digest.sql',
  '009_create_runtime_workers.sql',
  '010_create_runtime_execution_attempt_claim_worker_selections.sql'
].map((file) => path.resolve(__dirname, `../../../migrations/hermes/${file}`));
const migrations = migrationPaths.map((file) => fs.readFileSync(file, 'utf8'));
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_claim_worker_selection_p13b_test';
const TEST_ATTEMPTS = `${TEST_SCHEMA}.execution_attempts`;
const TEST_CLAIMS = `${TEST_SCHEMA}.execution_attempt_claims`;
const TEST_WORKERS = `${TEST_SCHEMA}.runtime_workers`;
const TEST_SELECTIONS = `${TEST_SCHEMA}.runtime_execution_attempt_claim_worker_selections`;

function safeDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && /^hermes_test(?:_[a-z0-9_-]+)?$/i.test(database);
  } catch {
    return false;
  }
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function isolatedMigration(sql) {
  return sql.replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll("n.nspname = 'hermes'", `n.nspname = '${TEST_SCHEMA}'`)
    .replaceAll('hermes.execution_attempts', TEST_ATTEMPTS)
    .replaceAll('hermes.execution_attempt_claims', TEST_CLAIMS)
    .replaceAll('hermes.runtime_workers', TEST_WORKERS)
    .replaceAll('hermes.runtime_execution_attempt_claim_worker_selections', TEST_SELECTIONS);
}

function workerEvidence(scope) {
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

function acquisitionInput(attemptOrdinal) {
  const p8 = buildAdmissionInput(attemptOrdinal);
  const p9 = buildAdmissionResult({
    outcome: 'ADMITTED', record: p8.p7_durable_record, decision: p8.p8_admission_decision,
    finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted'
  });
  const intent = buildClaimIntent({ p7_durable_record: p8.p7_durable_record, p9_durable_admission: p9 });
  const decision = buildClaimEligibilityDecision({
    runtime_execution_attempt_claim_intent: intent,
    ...workerEvidence(p8.p7_durable_record.identity_scope)
  });
  return { p7: p8.p7_durable_record, p8, intent, decision };
}

function stage(overrides = {}) {
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

function worker(overrides = {}) {
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

async function createClaim(input, persistence, admission, claimAdapter) {
  assert.equal((await persistence.persistDurably(input.p7)).persistence_result.outcome, 'CREATED');
  assert.equal((await admission.admitDurably({
    p7_durable_record: input.p7,
    p8_admission_decision: input.p8.p8_admission_decision
  })).admission_result.outcome, 'ADMITTED');
  const acquired = await claimAdapter.acquireDurably({
    runtime_execution_attempt_claim_intent: input.intent,
    runtime_execution_attempt_claim_eligibility_decision: input.decision
  });
  assert.equal(acquired.acquisition_result.outcome, 'CREATED');
  return acquired.acquisition_result.claim_id;
}

test('real PostgreSQL P13B persists claim-stage selection, replays, conflicts, and serializes concurrency', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 30, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    for (const sql of migrations) await pool.query(isolatedMigration(sql));
    await pool.query(isolatedMigration(migrations.at(-1)));

    const registry = createRuntimeWorkerRegistryPostgres({ pool, tableName: TEST_WORKERS, authorizeRegistration: async () => true });
    await registry.registerWorker(worker());
    await registry.registerWorker(worker({ worker_id: 'worker-selection-z' }));
    await registry.registerWorker(worker({ worker_id: 'worker-selection-image', supported_modalities: ['IMAGE'] }));
    await registry.registerWorker(worker({ worker_id: 'worker-selection-disabled', lifecycle_state: 'DISABLED' }));
    await registry.registerWorker(worker({ worker_id: 'worker-selection-other-scope', tenant_id: 'other-tenant' }));

    const persistence = createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: TEST_ATTEMPTS });
    const admission = createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_ATTEMPTS });
    const claimAdapter = createRuntimeExecutionAttemptClaimAcquisitionPostgres({ pool, attemptTableName: TEST_ATTEMPTS, claimTableName: TEST_CLAIMS });
    const selectionAdapter = createRuntimeExecutionAttemptClaimWorkerSelectionPostgres({
      pool, attemptTableName: TEST_ATTEMPTS, claimTableName: TEST_CLAIMS, workerTableName: TEST_WORKERS,
      selectionTableName: TEST_SELECTIONS, authorizeSelection: async () => true
    });

    const firstInput = acquisitionInput(1);
    const firstClaimId = await createClaim(firstInput, persistence, admission, claimAdapter);
    const first = await selectionAdapter.acquireSelection({ claim_id: firstClaimId, stage_reference: stage() });
    assert.equal(first.selection_result.outcome, 'CREATED');
    assert.equal(first.selection_result.selected_worker_id, 'worker-selection-a');
    const firstCount = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_SELECTIONS}`);
    assert.equal(firstCount.rows[0].count, 1);

    const replay = await selectionAdapter.acquireSelection({ claim_id: firstClaimId, stage_reference: stage() });
    assert.equal(replay.selection_result.outcome, 'EXISTING_IDENTICAL');
    const replayCount = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_SELECTIONS}`);
    assert.equal(replayCount.rows[0].count, 1);

    const conflict = await selectionAdapter.acquireSelection({ claim_id: firstClaimId, stage_reference: stage({ required_modalities: ['IMAGE_INPUT_REFERENCE'] }) });
    assert.equal(conflict.selection_result.outcome, 'CONFLICT');
    const winner = await pool.query(`SELECT selected_worker_id, selection_digest FROM ${TEST_SELECTIONS}`);
    assert.equal(winner.rows[0].selected_worker_id, 'worker-selection-a');

    const identicalInput = acquisitionInput(2);
    const identicalClaimId = await createClaim(identicalInput, persistence, admission, claimAdapter);
    const identicalResults = await Promise.all(Array.from({ length: 6 }, () => selectionAdapter.acquireSelection({ claim_id: identicalClaimId, stage_reference: stage() })));
    assert.equal(identicalResults.filter((result) => result.selection_result.outcome === 'CREATED').length, 1);
    assert.equal(identicalResults.filter((result) => result.selection_result.outcome === 'EXISTING_IDENTICAL').length, 5);
    assert.equal(identicalResults.filter((result) => result.selection_result.outcome === 'CONFLICT').length, 0);
    const identicalCount = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_SELECTIONS} WHERE claim_id = $1`, [identicalClaimId]);
    assert.equal(identicalCount.rows[0].count, 1);

    const divergentInput = acquisitionInput(3);
    const divergentClaimId = await createClaim(divergentInput, persistence, admission, claimAdapter);
    const divergentResults = await Promise.all([
      selectionAdapter.acquireSelection({ claim_id: divergentClaimId, stage_reference: stage() }),
      selectionAdapter.acquireSelection({ claim_id: divergentClaimId, stage_reference: stage({ required_modalities: ['IMAGE_INPUT_REFERENCE'] }) })
    ]);
    assert.equal(divergentResults.filter((result) => result.selection_result.outcome === 'CREATED').length, 1);
    assert.equal(divergentResults.filter((result) => result.selection_result.outcome === 'CONFLICT').length, 1);
    const divergentCount = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_SELECTIONS} WHERE claim_id = $1`, [divergentClaimId]);
    assert.equal(divergentCount.rows[0].count, 1);

    const missing = await selectionAdapter.acquireSelection({ claim_id: 'missing-claim', stage_reference: stage() });
    assert.equal(missing.selection_result.outcome, 'NOT_FOUND');
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [TEST_SCHEMA, 'runtime_execution_attempt_claim_worker_selections']);
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(names.some((name) => /binding|ownership|lease|fenc|capacity|execution/i.test(name)), false);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  }
});
