'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { buildAdmissionResult } = require('../src/core/runtime-execution-attempt-durable-admission');
const { buildClaimIntent } = require('../src/core/runtime-execution-attempt-claim-intent-simulation');
const { buildClaimEligibilityDecision } = require('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation');
const { buildAcquisitionPlan, planToInsertRow } = require('../src/core/runtime-execution-attempt-durable-claim-acquisition');
const { createRuntimeExecutionAttemptPersistencePostgres } = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');
const { createRuntimeExecutionAttemptAdmissionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-admission-postgres');
const { createRuntimeExecutionAttemptClaimAcquisitionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-acquisition-postgres');
const { createRuntimeWorkerRegistryPostgres } = require('../src/adapters/postgres/runtime-worker-registry-postgres');
const { createRuntimeExecutionAttemptClaimWorkerSelectionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-worker-selection-postgres');
const { createRuntimeExecutionAttemptClaimWorkerBindingPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-worker-binding-postgres');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const { buildRuntimeStageSimulationReference } = require('../src/core/runtime-stage-simulation-reference');
const {
  CONTRACT_NAME: SELECTION_CONTRACT_NAME,
  CONTRACT_VERSION: SELECTION_CONTRACT_VERSION,
  SELECTION_FIELDS,
  SELECTION_ID_PREFIX,
  buildSelectionPlan,
  planToInsertRow: selectionToInsertRow
} = require('../src/core/runtime-execution-attempt-claim-worker-selection');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { stablePayload } = require('../src/core/agent-identity-contract');

const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_claim_worker_binding_p13c_test';
const TEST_ATTEMPTS = `${TEST_SCHEMA}.execution_attempts`;
const TEST_CLAIMS = `${TEST_SCHEMA}.execution_attempt_claims`;
const TEST_WORKERS = `${TEST_SCHEMA}.runtime_workers`;
const TEST_SELECTIONS = `${TEST_SCHEMA}.runtime_execution_attempt_claim_worker_selections`;
const TEST_BINDINGS = `${TEST_SCHEMA}.runtime_execution_attempt_claim_worker_bindings`;

const migrationPaths = [
  '004_create_execution_attempts.sql',
  '005_enable_execution_attempt_admission_lifecycle.sql',
  '006_create_execution_attempt_claims.sql',
  '007_complete_execution_attempt_claim_canonical_identity.sql',
  '008_replace_claim_identity_index_with_digest.sql',
  '009_create_runtime_workers.sql',
  '010_create_runtime_execution_attempt_claim_worker_selections.sql',
  '011_create_runtime_execution_attempt_claim_worker_bindings.sql'
].map((file) => path.resolve(__dirname, `../../../migrations/hermes/${file}`));
const migrations = migrationPaths.map((file) => fs.readFileSync(file, 'utf8'));

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
    .replaceAll('hermes.runtime_execution_attempt_claim_worker_selections', TEST_SELECTIONS)
    .replaceAll('hermes.runtime_execution_attempt_claim_worker_bindings', TEST_BINDINGS);
}

function workerEvidence(scope) {
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

function acquisitionInput(attemptOrdinal) {
  const p8 = buildAdmissionInput(attemptOrdinal, { compact: true });
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

function stage() {
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

function worker(overrides = {}) {
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

function selectionWithOrdinal(plan, selectionOrdinal) {
  const identity = { ...plan.identity, selection_ordinal: selectionOrdinal };
  const selectionFingerprint = stablePayload(identity);
  const selectionDigest = computeCanonicalContentDigest(identity);
  const selectionId = `${SELECTION_ID_PREFIX}${selectionDigest.slice('sha256:'.length)}`;
  return selectionToInsertRow({
    ...plan,
    identity,
    selection_id: selectionId,
    selection_fingerprint: selectionFingerprint,
    selection_digest: selectionDigest,
    artifact: {
      ...plan.artifact,
      selection_id: selectionId,
      selection_fingerprint: selectionFingerprint,
      selection_digest: selectionDigest
    }
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

async function settle(operations) {
  const results = await Promise.allSettled(operations);
  const rejection = results.find((result) => result.status === 'rejected');
  if (rejection) throw rejection.reason;
  return results.map((result) => result.value);
}

test('real PostgreSQL P13C binds the persisted claim, selection, and canonical worker', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 30, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    for (const sql of migrations) await pool.query(isolatedMigration(sql));
    await pool.query(isolatedMigration(migrations.at(-1)));

    const registry = createRuntimeWorkerRegistryPostgres({ pool, tableName: TEST_WORKERS, authorizeRegistration: async () => true });
    await registry.registerWorker(worker());
    await registry.registerWorker(worker({ worker_id: 'worker-binding-z' }));
    const persistence = createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: TEST_ATTEMPTS });
    const admission = createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_ATTEMPTS });
    const claimAdapter = createRuntimeExecutionAttemptClaimAcquisitionPostgres({ pool, attemptTableName: TEST_ATTEMPTS, claimTableName: TEST_CLAIMS });
    const selectionAdapter = createRuntimeExecutionAttemptClaimWorkerSelectionPostgres({
      pool, attemptTableName: TEST_ATTEMPTS, claimTableName: TEST_CLAIMS, workerTableName: TEST_WORKERS,
      selectionTableName: TEST_SELECTIONS, authorizeSelection: async () => true
    });
    const bindingAdapter = createRuntimeExecutionAttemptClaimWorkerBindingPostgres({
      pool, claimTableName: TEST_CLAIMS, selectionTableName: TEST_SELECTIONS,
      workerTableName: TEST_WORKERS, bindingTableName: TEST_BINDINGS
    });

    const input = acquisitionInput(1);
    const claimId = await createClaim(input, persistence, admission, claimAdapter);
    const selection = await selectionAdapter.acquireSelection({ claim_id: claimId, stage_reference: stage() });
    assert.equal(selection.selection_result.outcome, 'CREATED');
    const selectionId = selection.selection_result.selection_id;
    const originalSelection = await pool.query(`SELECT selection_digest FROM ${TEST_SELECTIONS} WHERE selection_id = $1`, [selectionId]);
    const originalSelectionDigest = originalSelection.rows[0].selection_digest;

    const first = await bindingAdapter.bindDurably({ claim_id: claimId, selection_id: selectionId });
    assert.equal(first.binding_result.outcome, 'CREATED');
    assert.equal(first.binding_result.worker_selected, true);
    assert.equal(first.binding_result.worker_bound, true);
    assert.equal(first.binding_result.worker_ownership_established, false);
    assert.equal(first.binding_result.capacity_reserved, false);
    assert.equal(first.binding_result.lease_created, false);
    assert.equal(first.binding_result.fencing_token_created, false);
    assert.equal(first.binding_result.execution_authorized, false);
    assert.equal(first.binding_result.production_blocked, true);

    const replay = await bindingAdapter.bindDurably({ claim_id: claimId, selection_id: selectionId });
    assert.equal(replay.binding_result.outcome, 'EXISTING_IDENTICAL');
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${TEST_BINDINGS}`)).rows[0].count, 1);

    const missingClaim = await bindingAdapter.bindDurably({ claim_id: 'missing-claim', selection_id: selectionId });
    assert.equal(missingClaim.binding_result.outcome, 'NOT_FOUND');
    const missingSelection = await bindingAdapter.bindDurably({ claim_id: claimId, selection_id: 'missing-selection' });
    assert.equal(missingSelection.binding_result.outcome, 'NOT_FOUND');

    const tamperedSelection = await pool.query(`
      UPDATE ${TEST_SELECTIONS}
      SET selection_digest = $2,
          selection_artifact = jsonb_set(selection_artifact, '{selection_digest}', to_jsonb($2::text), false)
      WHERE selection_id = $1
    `, [selectionId, `sha256:${'f'.repeat(64)}`]);
    assert.equal(tamperedSelection.rowCount, 1);
    const tampered = await bindingAdapter.bindDurably({ claim_id: claimId, selection_id: selectionId });
    assert.equal(tampered.binding_result.outcome, 'INVALID');
    await pool.query(`DELETE FROM ${TEST_BINDINGS} WHERE claim_id = $1`, [claimId]);
    await pool.query(`
      UPDATE ${TEST_SELECTIONS}
      SET selection_digest = $2,
          selection_artifact = jsonb_set(selection_artifact, '{selection_digest}', to_jsonb($2::text), false)
      WHERE selection_id = $1
    `, [selectionId, originalSelectionDigest]);
    const restored = await bindingAdapter.bindDurably({ claim_id: claimId, selection_id: selectionId });
    assert.equal(restored.binding_result.outcome, 'CREATED');

    const disabled = await registry.transitionLifecycle({ workerId: 'worker-binding-a', expectedState: 'ACTIVE', nextState: 'DISABLED' });
    assert.equal(disabled.outcome, 'UPDATED');
    await pool.query(`DELETE FROM ${TEST_BINDINGS} WHERE claim_id = $1`, [claimId]);
    const identityOnly = await bindingAdapter.bindDurably({ claim_id: claimId, selection_id: selectionId });
    assert.equal(identityOnly.binding_result.outcome, 'CREATED');

    const concurrentInput = acquisitionInput(2);
    const concurrentClaimId = await createClaim(concurrentInput, persistence, admission, claimAdapter);
    const concurrentSelection = await selectionAdapter.acquireSelection({ claim_id: concurrentClaimId, stage_reference: stage() });
    const sameResults = await settle(Array.from({ length: 6 }, () => bindingAdapter.bindDurably({
      claim_id: concurrentClaimId, selection_id: concurrentSelection.selection_result.selection_id
    })));
    assert.equal(sameResults.filter((result) => result.binding_result.outcome === 'CREATED').length, 1);
    assert.equal(sameResults.filter((result) => result.binding_result.outcome === 'EXISTING_IDENTICAL').length, 5);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${TEST_BINDINGS} WHERE claim_id = $1`, [concurrentClaimId])).rows[0].count, 1);

    const divergentInput = acquisitionInput(3);
    const divergentClaimId = await createClaim(divergentInput, persistence, admission, claimAdapter);
    const divergentSelection = await selectionAdapter.acquireSelection({ claim_id: divergentClaimId, stage_reference: stage() });
    assert.equal(divergentSelection.selection_result.outcome, 'CREATED');
    const divergentBinding = await bindingAdapter.bindDurably({
      claim_id: divergentClaimId, selection_id: divergentSelection.selection_result.selection_id
    });
    assert.equal(divergentBinding.binding_result.outcome, 'CREATED');

    const divergentClaimRow = planToInsertRow(buildAcquisitionPlan({
      runtime_execution_attempt_claim_intent: divergentInput.intent,
      runtime_execution_attempt_claim_eligibility_decision: divergentInput.decision
    }));
    const alternateSelectionPlan = buildSelectionPlan({
      claim: divergentClaimRow,
      stage_reference: stage(),
      workers: [worker({ worker_id: 'worker-binding-z' })]
    });
    assert.equal(alternateSelectionPlan.outcome, 'READY');
    const alternateSelection = selectionWithOrdinal(alternateSelectionPlan, 2);
    const selectionFields = ['contract_name', 'contract_version', ...SELECTION_FIELDS.filter((field) => field !== 'created_at')];
    const selectionJsonFields = new Set(['candidate_worker_ids', 'candidate_set', 'stage_reference', 'selection_artifact']);
    const selectionValues = selectionFields.map((field) => selectionJsonFields.has(field)
      ? JSON.stringify(alternateSelection[field])
      : field === 'contract_name' ? SELECTION_CONTRACT_NAME
        : field === 'contract_version' ? SELECTION_CONTRACT_VERSION
          : alternateSelection[field]);
    await pool.query(`
      INSERT INTO ${TEST_SELECTIONS} (${selectionFields.join(', ')})
      VALUES (${selectionFields.map((field, index) => `$${index + 1}${selectionJsonFields.has(field) ? '::jsonb' : ''}`).join(', ')})
    `, selectionValues);
    const persistedAlternate = await pool.query(`SELECT selection_id FROM ${TEST_SELECTIONS} WHERE selection_id = $1`, [alternateSelection.selection_id]);
    assert.equal(persistedAlternate.rowCount, 1);
    const divergentResult = await bindingAdapter.bindDurably({ claim_id: divergentClaimId, selection_id: alternateSelection.selection_id });
    assert.equal(divergentResult.binding_result.outcome, 'CONFLICT');

    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [TEST_SCHEMA, 'runtime_execution_attempt_claim_worker_bindings']);
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(names.some((name) => /owner|lease|expiry|heartbeat|fenc|capacity|quota|execution/i.test(name)), false);
  } finally {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    } finally {
      await pool.end();
    }
  }
});
