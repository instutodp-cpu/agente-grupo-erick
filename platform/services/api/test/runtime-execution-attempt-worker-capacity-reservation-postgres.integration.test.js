'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { buildAdmissionResult } = require('../src/core/runtime-execution-attempt-durable-admission');
const { buildClaimIntent } = require('../src/core/runtime-execution-attempt-claim-intent-simulation');
const { buildClaimEligibilityDecision } = require('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation');
const { createRuntimeExecutionAttemptPersistencePostgres } = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');
const { createRuntimeExecutionAttemptAdmissionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-admission-postgres');
const { createRuntimeExecutionAttemptClaimAcquisitionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-acquisition-postgres');
const { createRuntimeWorkerRegistryPostgres } = require('../src/adapters/postgres/runtime-worker-registry-postgres');
const { createRuntimeExecutionAttemptClaimWorkerSelectionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-worker-selection-postgres');
const { createRuntimeExecutionAttemptClaimWorkerBindingPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-claim-worker-binding-postgres');
const { createRuntimeOperationalOwnerIdentityPostgres } = require('../src/adapters/postgres/runtime-operational-owner-identity-postgres');
const { createRuntimeExecutionAttemptWorkerOwnershipPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-worker-ownership-postgres');
const { createRuntimeExecutionAttemptWorkerLeasePostgres } = require('../src/adapters/postgres/runtime-execution-attempt-worker-lease-postgres');
const { createRuntimeExecutionAttemptWorkerCapacityReservationPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-worker-capacity-reservation-postgres');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const { buildRuntimeStageSimulationReference } = require('../src/core/runtime-stage-simulation-reference');
const { buildGoldenWorkerAssignmentBundle, evaluateRuntimeWorkerAssignmentRequest } = require('./helpers/runtime-worker-assignment-test-data');
const { computeWorkerAssignmentPackageDigest, computeWorkerAssignmentPackageFingerprint } = require('../src/core/runtime-worker-assignment-package');
const { computeHealthFingerprint } = require('../src/core/runtime-worker-health-reference');
const { computeCapacityDigest, computeCapacityFingerprint } = require('../src/core/runtime-worker-capacity-reference');
const { computeFreshnessFingerprint } = require('../src/core/runtime-readiness-freshness-reference');
const { buildOperationalOwnerIdentity, planToInsertRow: ownerToInsertRow } = require('../src/core/runtime-operational-owner-identity');
const { buildCapacityResource } = require('../src/core/runtime-execution-attempt-worker-capacity-reservation');

const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = `hermes_worker_capacity_p14c_${randomUUID().replaceAll('-', '')}`;
const TABLE = (name) => `${TEST_SCHEMA}.${name}`;
const TEST_ATTEMPTS = TABLE('execution_attempts');
const TEST_CLAIMS = TABLE('execution_attempt_claims');
const TEST_WORKERS = TABLE('runtime_workers');
const TEST_SELECTIONS = TABLE('runtime_execution_attempt_claim_worker_selections');
const TEST_BINDINGS = TABLE('runtime_execution_attempt_claim_worker_bindings');
const TEST_OWNERS = TABLE('runtime_operational_owners');
const TEST_OWNERSHIPS = TABLE('runtime_execution_attempt_worker_ownerships');
const TEST_LEASES = TABLE('runtime_execution_attempt_worker_leases');
const TEST_RESOURCES = TABLE('runtime_worker_capacity_resources');
const TEST_RESERVATIONS = TABLE('runtime_execution_attempt_worker_capacity_reservations');

const migrationNames = [
  '004_create_execution_attempts.sql', '005_enable_execution_attempt_admission_lifecycle.sql',
  '006_create_execution_attempt_claims.sql', '007_complete_execution_attempt_claim_canonical_identity.sql',
  '008_replace_claim_identity_index_with_digest.sql', '009_create_runtime_workers.sql',
  '010_create_runtime_execution_attempt_claim_worker_selections.sql',
  '011_create_runtime_execution_attempt_claim_worker_bindings.sql', '012_create_runtime_operational_owners.sql',
  '013_create_runtime_execution_attempt_worker_ownerships.sql', '014_create_runtime_execution_attempt_worker_leases.sql',
  '015_create_runtime_execution_attempt_worker_capacity_reservations.sql'
];
const migrations = migrationNames.map((file) => fs.readFileSync(path.resolve(__dirname, `../../../migrations/hermes/${file}`), 'utf8'));

function safeDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && /^hermes_test(?:_[a-z0-9_-]+)?$/i.test(database);
  } catch { return false; }
}

function mutable(value) { return JSON.parse(JSON.stringify(value)); }

function isolatedMigration(sql) {
  return sql.replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll("n.nspname = 'hermes'", `n.nspname = '${TEST_SCHEMA}'`)
    .replaceAll('hermes.execution_attempts', TEST_ATTEMPTS)
    .replaceAll('hermes.execution_attempt_claims', TEST_CLAIMS)
    .replaceAll('hermes.runtime_workers', TEST_WORKERS)
    .replaceAll('hermes.runtime_execution_attempt_claim_worker_selections', TEST_SELECTIONS)
    .replaceAll('hermes.runtime_execution_attempt_claim_worker_bindings', TEST_BINDINGS)
    .replaceAll('hermes.runtime_operational_owners', TEST_OWNERS)
    .replaceAll('hermes.runtime_execution_attempt_worker_ownerships', TEST_OWNERSHIPS)
    .replaceAll('hermes.runtime_execution_attempt_worker_leases', TEST_LEASES)
    .replaceAll('hermes.runtime_worker_capacity_resources', TEST_RESOURCES)
    .replaceAll('hermes.runtime_execution_attempt_worker_capacity_reservations', TEST_RESERVATIONS);
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

function acquisitionInput(ordinal) {
  const p8 = buildAdmissionInput(ordinal, { compact: true });
  const p9 = buildAdmissionResult({ outcome: 'ADMITTED', record: p8.p7_durable_record, decision: p8.p8_admission_decision, finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted' });
  const intent = buildClaimIntent({ p7_durable_record: p8.p7_durable_record, p9_durable_admission: p9 });
  const decision = buildClaimEligibilityDecision({ runtime_execution_attempt_claim_intent: intent, ...workerEvidence(p8.p7_durable_record.identity_scope) });
  return { p7: p8.p7_durable_record, p8, intent, decision };
}

function stage(suffix) {
  return buildRuntimeStageSimulationReference({
    runtime_stage_reference_id: `stage-capacity-${suffix}`, runtime_stage_reference_version: 1,
    runtime_request_id: `request-capacity-${suffix}`, runtime_execution_package_id: `package-capacity-${suffix}`,
    execution_plan_id: `execution-plan-capacity-${suffix}`, source_execution_stage_id: `execution-stage-capacity-${suffix}`,
    source_orchestrator_stage_id: `orchestrator-stage-capacity-${suffix}`, stage_sequence: 0,
    stage_type: 'MODEL_REFERENCE_STAGE', task_reference_id: `task-capacity-${suffix}`,
    side_effect_classification: 'NONE', risk_classification: 'LOW', required_capabilities: [], required_modalities: ['TEXT_INPUT']
  });
}

function worker(id, overrides = {}) {
  return buildWorkerRegistration({
    worker_id: id, tenant_id: 'tenant-p9', organization_id: 'organization-p9', project_id: 'project-p9',
    worker_type: 'DEDICATED_REFERENCE', lifecycle_state: 'ACTIVE', worker_capability_reference_id: `capability-${id}`,
    worker_compatibility_reference_ids: [], supported_stage_types: ['MODEL_REFERENCE_STAGE'], supported_modalities: ['TEXT_INPUT'],
    supported_model_provider_ids: [], supported_model_ids: [], supported_tool_ids: [], supported_workflow_ids: [], ...overrides
  });
}

function owner(reference) {
  return ownerToInsertRow(buildOperationalOwnerIdentity({ operational_owner_type: 'operational_owner', owner_reference_id: reference, tenant_id: 'tenant-p9', organization_id: 'organization-p9', project_id: 'project-p9' }));
}

async function createClaim(input, persistence, admission, claimAdapter) {
  assert.equal((await persistence.persistDurably(input.p7)).persistence_result.outcome, 'CREATED');
  assert.equal((await admission.admitDurably({ p7_durable_record: input.p7, p8_admission_decision: input.p8.p8_admission_decision })).admission_result.outcome, 'ADMITTED');
  const acquired = await claimAdapter.acquireDurably({ runtime_execution_attempt_claim_intent: input.intent, runtime_execution_attempt_claim_eligibility_decision: input.decision });
  assert.equal(acquired.acquisition_result.outcome, 'CREATED');
  return acquired.acquisition_result.claim_id;
}

async function prepareGraph({ suffix = 1, persistence, admission, claimAdapter, selectionAdapter, bindingAdapter, ownershipAdapter, ownerAdapter, leaseAdapter }) {
  const input = acquisitionInput(suffix);
  const claimId = await createClaim(input, persistence, admission, claimAdapter);
  const selected = await selectionAdapter.acquireSelection({ claim_id: claimId, stage_reference: stage(suffix) });
  assert.equal(selected.selection_result.outcome, 'CREATED');
  const binding = await bindingAdapter.bindDurably({ claim_id: claimId, selection_id: selected.selection_result.selection_id });
  assert.equal(binding.binding_result.outcome, 'CREATED');
  const registered = await ownerAdapter.registerOperationalOwner(owner(`owner-capacity-${suffix}`));
  assert.equal(registered.operational_owner_result.outcome, 'CREATED');
  const ownership = await ownershipAdapter.establishOwnership({ binding_id: binding.binding_result.binding_id, operational_owner_id: registered.operational_owner_result.operational_owner_id });
  assert.equal(ownership.ownership_result.outcome, 'CREATED');
  const lease = await leaseAdapter.acquireLease({ ownership_id: ownership.ownership_result.ownership_id, operational_owner_id: registered.operational_owner_result.operational_owner_id, lease_duration_ms: 30000 });
  assert.equal(lease.lease_result.outcome, 'CREATED');
  return lease.lease_result;
}

function resourceFor(lease, id, capacityLimit = 1, overrides = {}) {
  return buildCapacityResource({
    capacity_resource_id: id, capacity_dimension: 'worker_stage_assignments', worker_id: lease.selected_worker_id,
    tenant_id: 'tenant-p9', organization_id: 'organization-p9', project_id: 'project-p9',
    session_reference_id: 'session-p9', agent_id: 'agent-p9', actor_id: 'actor-p9',
    capacity_limit: capacityLimit, ...overrides
  });
}

test('real PostgreSQL P14C reserves capacity atomically and preserves the lease/fencing boundary', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 30, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    for (const sql of migrations) await pool.query(isolatedMigration(sql));
    await pool.query(isolatedMigration(migrations.at(-1)));

    const registry = createRuntimeWorkerRegistryPostgres({ pool, tableName: TEST_WORKERS, authorizeRegistration: async () => true });
    await registry.registerWorker(worker('worker-capacity-a'));
    const persistence = createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: TEST_ATTEMPTS });
    const admission = createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_ATTEMPTS });
    const claimAdapter = createRuntimeExecutionAttemptClaimAcquisitionPostgres({ pool, attemptTableName: TEST_ATTEMPTS, claimTableName: TEST_CLAIMS });
    const selectionAdapter = createRuntimeExecutionAttemptClaimWorkerSelectionPostgres({ pool, attemptTableName: TEST_ATTEMPTS, claimTableName: TEST_CLAIMS, workerTableName: TEST_WORKERS, selectionTableName: TEST_SELECTIONS, authorizeSelection: async () => true });
    const bindingAdapter = createRuntimeExecutionAttemptClaimWorkerBindingPostgres({ pool, claimTableName: TEST_CLAIMS, selectionTableName: TEST_SELECTIONS, workerTableName: TEST_WORKERS, bindingTableName: TEST_BINDINGS });
    const ownerAdapter = createRuntimeOperationalOwnerIdentityPostgres({ pool, tableName: TEST_OWNERS });
    const ownershipAdapter = createRuntimeExecutionAttemptWorkerOwnershipPostgres({ pool, bindingTableName: TEST_BINDINGS, ownerTableName: TEST_OWNERS, workerTableName: TEST_WORKERS, ownershipTableName: TEST_OWNERSHIPS });
    const leaseAdapter = createRuntimeExecutionAttemptWorkerLeasePostgres({ pool, ownershipTableName: TEST_OWNERSHIPS, ownerTableName: TEST_OWNERS, workerTableName: TEST_WORKERS, leaseTableName: TEST_LEASES });
    const capacity = createRuntimeExecutionAttemptWorkerCapacityReservationPostgres({ pool, leaseTableName: TEST_LEASES, resourceTableName: TEST_RESOURCES, reservationTableName: TEST_RESERVATIONS });
    const lease = await prepareGraph({ suffix: 1, persistence, admission, claimAdapter, selectionAdapter, bindingAdapter, ownershipAdapter, ownerAdapter, leaseAdapter });
    const secondLease = await prepareGraph({ suffix: 2, persistence, admission, claimAdapter, selectionAdapter, bindingAdapter, ownershipAdapter, ownerAdapter, leaseAdapter });

    const resources = ['identical', 'release', 'stale'].map((suffix) => resourceFor(lease, `capacity-${suffix}`, suffix === 'release' ? 2 : 1));
    resources.push(resourceFor(lease, 'capacity-divergent', 2));
    resources.push(resourceFor(lease, 'capacity-last-unit', 1));
    for (const resource of resources) assert.equal((await capacity.registerCapacityResource(resource)).capacity_resource_result.outcome, 'CREATED');
    assert.equal((await capacity.registerCapacityResource(resources[0])).capacity_resource_result.outcome, 'EXISTING_IDENTICAL');

    const identical = await Promise.all(Array.from({ length: 8 }, () => capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-identical', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 })));
    assert.equal(identical.filter((result) => result.capacity_reservation_result.outcome === 'CREATED').length, 1);
    assert.equal(identical.filter((result) => result.capacity_reservation_result.outcome === 'EXISTING_IDENTICAL').length, 7);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${TEST_RESERVATIONS} WHERE capacity_resource_id = $1`, ['capacity-identical'])).rows[0].count, 1);
    assert.equal((await pool.query(`SELECT reserved_amount::int FROM ${TEST_RESOURCES} WHERE capacity_resource_id = $1`, ['capacity-identical'])).rows[0].reserved_amount, 1);
    const identicalWinnerId = identical.find((result) => result.capacity_reservation_result.outcome === 'CREATED').capacity_reservation_result.reservation_id;
    assert.equal((await capacity.inspectReservation({ reservation_id: identicalWinnerId })).capacity_reservation_result.outcome, 'EXISTING_IDENTICAL');
    const reloadedCapacity = createRuntimeExecutionAttemptWorkerCapacityReservationPostgres({ pool, leaseTableName: TEST_LEASES, resourceTableName: TEST_RESOURCES, reservationTableName: TEST_RESERVATIONS });
    assert.equal((await reloadedCapacity.inspectReservation({ reservation_id: identicalWinnerId })).capacity_reservation_result.outcome, 'EXISTING_IDENTICAL');

    const lastUnit = await Promise.all([
      capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-last-unit', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 }),
      capacity.reserveCapacity({ lease_id: secondLease.lease_id, operational_owner_id: secondLease.operational_owner_id, fencing_token: secondLease.fencing_token, capacity_resource_id: 'capacity-last-unit', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 })
    ]);
    assert.equal(lastUnit.filter((result) => result.capacity_reservation_result.outcome === 'CREATED').length, 1);
    assert.equal(lastUnit.filter((result) => result.capacity_reservation_result.outcome === 'CONFLICT').length, 1);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${TEST_RESERVATIONS} WHERE capacity_resource_id = $1`, ['capacity-last-unit'])).rows[0].count, 1);
    assert.equal((await pool.query(`SELECT reserved_amount::int FROM ${TEST_RESOURCES} WHERE capacity_resource_id = $1`, ['capacity-last-unit'])).rows[0].reserved_amount, 1);

    const divergent = await Promise.all([
      capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-divergent', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 }),
      capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-divergent', capacity_dimension: 'worker_stage_assignments', requested_amount: 2 })
    ]);
    assert.equal(divergent.filter((result) => result.capacity_reservation_result.outcome === 'CREATED').length, 1);
    assert.equal(divergent.filter((result) => result.capacity_reservation_result.outcome === 'CONFLICT').length, 1);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${TEST_RESERVATIONS} WHERE capacity_resource_id = $1`, ['capacity-divergent'])).rows[0].count, 1);

    const releaseCreated = await capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-release', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 });
    assert.equal(releaseCreated.capacity_reservation_result.outcome, 'CREATED');
    const released = await capacity.releaseCapacity({ reservation_id: releaseCreated.capacity_reservation_result.reservation_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token });
    assert.equal(released.capacity_reservation_result.outcome, 'RELEASED');
    assert.equal((await capacity.releaseCapacity({ reservation_id: releaseCreated.capacity_reservation_result.reservation_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token })).capacity_reservation_result.outcome, 'RELEASED');
    const nextGeneration = await capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-release', capacity_dimension: 'worker_stage_assignments', requested_amount: 2, reservation_ordinal: 2 });
    assert.equal(nextGeneration.capacity_reservation_result.outcome, 'CREATED');

    const stale = await capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token + 1, capacity_resource_id: 'capacity-stale', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 });
    assert.equal(stale.capacity_reservation_result.outcome, 'STALE');
    const staleOwner = await capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: 'wrong-owner', fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-stale', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 });
    assert.equal(staleOwner.capacity_reservation_result.outcome, 'STALE');
    const mismatchedResource = resourceFor(lease, 'capacity-scope-mismatch', 1, { tenant_id: 'other-tenant' });
    await capacity.registerCapacityResource(mismatchedResource);
    const scopeMismatch = await capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-scope-mismatch', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 });
    assert.equal(scopeMismatch.capacity_reservation_result.outcome, 'INVALID');
    await pool.query(`UPDATE ${TEST_LEASES} SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE lease_id = $1`, [lease.lease_id]);
    const expired = await capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-stale', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 });
    assert.equal(expired.capacity_reservation_result.outcome, 'STALE');
    assert.equal((await capacity.inspectReservation({ reservation_id: identicalWinnerId })).capacity_reservation_result.outcome, 'STALE');
    await pool.query(`UPDATE ${TEST_LEASES} SET lease_expires_at = CURRENT_TIMESTAMP, lease_state = 'RELEASED' WHERE lease_id = $1`, [lease.lease_id]);
    const releasedLease = await capacity.reserveCapacity({ lease_id: lease.lease_id, operational_owner_id: lease.operational_owner_id, fencing_token: lease.fencing_token, capacity_resource_id: 'capacity-stale', capacity_dimension: 'worker_stage_assignments', requested_amount: 1 });
    assert.equal(releasedLease.capacity_reservation_result.outcome, 'STALE');

    const constraint = await pool.query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'u'`, [TEST_RESERVATIONS]);
    const slot = constraint.rows.find((row) => row.definition.includes('lease_id') && row.definition.includes('capacity_resource_id') && row.definition.includes('reservation_ordinal'));
    assert.ok(slot);
    assert.match(slot.definition, /lease_id, capacity_resource_id, reservation_ordinal/);
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [TEST_SCHEMA, 'runtime_execution_attempt_worker_capacity_reservations']);
    assert.equal(columns.rows.some((row) => /execution|provider|tool|network|secret|quota/i.test(row.column_name)), false);
  } finally {
    try { await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { await pool.end(); }
  }
});
