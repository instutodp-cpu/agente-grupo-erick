'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAdmissionInput, buildP7Record } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const {
  buildAdmissionResult,
  validateAdmissionInput,
  validateAdmissionResult
} = require('../src/core/runtime-execution-attempt-durable-admission');
const {
  createRuntimeExecutionAttemptAdmissionPostgres
} = require('../src/adapters/postgres/runtime-execution-attempt-admission-postgres');

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowFor(record, state = 'PREPARED', revision = 1) {
  return {
    attempt_durable_record_id: record.runtime_execution_attempt_durable_record_id,
    durable_job_reference_id: record.durable_job_reference.id,
    materialization_reference_id: record.runtime_execution_attempt_materialization_reference.id,
    materialization_reference_fingerprint: record.runtime_execution_attempt_materialization_reference.fingerprint,
    materialization_reference_digest: record.runtime_execution_attempt_materialization_reference.digest,
    attempt_intent_reference_id: record.runtime_execution_attempt_intent_reference.id,
    attempt_intent_reference_fingerprint: record.runtime_execution_attempt_intent_reference.fingerprint,
    attempt_intent_reference_digest: record.runtime_execution_attempt_intent_reference.digest,
    ...record.identity_scope,
    logical_job_identity_digest: record.logical_job_identity_digest,
    admission_reference_id: record.admission_reference.id,
    attempt_ordinal: record.attempt_ordinal,
    state, revision, contract_version: record.contract_version, schema_version: 1,
    durable_record_fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
    durable_record_digest: record.runtime_execution_attempt_durable_record_digest,
    durable_record: record,
    created_at: new Date(), updated_at: new Date()
  };
}

function fakePool(record, existingState = 'PREPARED', existingRevision = 1) {
  let update = existingState === 'PREPARED' ? rowFor(record, 'ADMITTED', 2) : null;
  const existing = rowFor(record, existingState, existingRevision);
  let connected = 0;
  const client = {
    async query(sql) {
      const normalizedSql = sql.trimStart();
      if (/^BEGIN|^SET LOCAL|^COMMIT|^ROLLBACK/.test(normalizedSql)) return { rows: [] };
      if (normalizedSql.startsWith('UPDATE ')) return { rows: update ? [update] : [] };
      if (normalizedSql.startsWith('SELECT ')) return { rows: [existing] };
      throw new Error(`unexpected_sql:${sql}`);
    },
    release() { connected -= 1; }
  };
  return {
    get connected() { return connected; },
    async query(sql) {
      if (sql.includes('lifecycle_check_exists')) {
        return { rows: [{ schema_exists: true, table_exists: true, primary_key_exists: true, lifecycle_check_exists: true }] };
      }
      throw new Error(`unexpected_pool_sql:${sql}`);
    },
    async connect() { connected += 1; return client; }
  };
}

test('valid P8 positive decision is accepted and result is deterministic', () => {
  const input = buildAdmissionInput();
  assert.equal(validateAdmissionInput(input).valid, true);
  const first = buildAdmissionResult({
    outcome: 'ADMITTED', record: input.p7_durable_record, decision: input.p8_admission_decision,
    finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted'
  });
  const second = buildAdmissionResult({
    outcome: 'ADMITTED', record: input.p7_durable_record, decision: input.p8_admission_decision,
    finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted'
  });
  assert.deepEqual(first, second);
  assert.equal(first.attempt_admitted, true);
  assert.equal(first.simulation, false);
  assert.equal(first.production_blocked, true);
  assert.equal(validateAdmissionResult(first).valid, true);
});

test('invalid, negative, stale, and mismatched P8 evidence fails closed', () => {
  const cases = [
    ['missing decision', (input) => { delete input.p8_admission_decision; }],
    ['wrong attempt identity', (input) => { input.p8_admission_decision.runtime_execution_attempt_durable_record_reference.id = 'wrong'; }],
    ['wrong scope', (input) => { input.p8_admission_decision.identity_scope.tenant_id = 'wrong'; }],
    ['wrong ordinal', (input) => { input.p8_admission_decision.attempt_ordinal = 2; }],
    ['wrong predecessor fingerprint', (input) => { input.p8_admission_decision.runtime_execution_attempt_durable_record_reference.fingerprint = 'wrong'; }],
    ['stale predecessor', (input) => { input.p8_admission_decision.p7_revision = 2; }],
    ['negative decision', (input) => { input.p8_admission_decision.decision = 'REJECT_ATTEMPT_SIMULATION'; }]
  ];
  for (const [label, mutate] of cases) {
    const input = mutable(buildAdmissionInput());
    mutate(input);
    assert.equal(validateAdmissionInput(input).valid, false, label);
  }
});

test('admission result keeps every execution authority flag false', () => {
  const input = buildAdmissionInput();
  const result = buildAdmissionResult({
    outcome: 'ADMITTED', record: input.p7_durable_record, decision: input.p8_admission_decision,
    finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted'
  });
  for (const field of [
    'claim_issued', 'lease_granted', 'fencing_token_issued', 'worker_ownership_established',
    'executor_ownership_established', 'execution_authorized', 'execution_started', 'execution_performed',
    'provider_call_allowed', 'provider_called', 'network_call_allowed', 'network_used',
    'secrets_materialized', 'external_effect_allowed', 'external_effect_performed'
  ]) assert.equal(result[field], false, field);
});

test('PostgreSQL adapter performs one guarded transition and replays as already admitted', async () => {
  const input = buildAdmissionInput();
  const pool = fakePool(input.p7_durable_record);
  const adapter = createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: 'hermes.execution_attempts' });
  const admitted = await adapter.admitDurably(input);
  assert.equal(admitted.admission_result.outcome, 'ADMITTED');
  assert.equal(admitted.admission_result.final_state, 'ADMITTED');
  assert.equal(admitted.admission_result.final_revision, 2);
  assert.equal(pool.connected, 0);

  const replayPool = fakePool(input.p7_durable_record, 'ADMITTED', 2);
  const replay = await createRuntimeExecutionAttemptAdmissionPostgres({ pool: replayPool }).admitDurably(input);
  assert.equal(replay.admission_result.outcome, 'ALREADY_ADMITTED');
  assert.equal(replay.admission_result.transition_applied, false);
  assert.equal(replayPool.connected, 0);
});

test('invalid P8 evidence does not acquire a PostgreSQL client', async () => {
  const input = mutable(buildAdmissionInput());
  input.p8_admission_decision.attempt_ordinal = 2;
  let connects = 0;
  const pool = { query: async () => { throw new Error('database_must_not_be_used'); }, connect: async () => { connects += 1; } };
  const result = await createRuntimeExecutionAttemptAdmissionPostgres({ pool }).admitDurably(input);
  assert.equal(result.admission_result.outcome, 'INVALID');
  assert.equal(connects, 0);
});

test('unsafe table identifiers fail closed and default remains production table', () => {
  const pool = { query() {}, connect() {} };
  assert.equal(createRuntimeExecutionAttemptAdmissionPostgres({ pool }).table_name, 'hermes.execution_attempts');
  assert.throws(
    () => createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: 'hermes.execution_attempts; DROP TABLE x' }),
    /table_name_invalid/
  );
  assert.equal(buildP7Record(3).attempt_ordinal, 3);
});
