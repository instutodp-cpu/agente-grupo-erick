'use strict';

const { stablePayload } = require('../../core/agent-identity-contract');
const {
  buildAdmissionResult,
  validateAdmissionInput
} = require('../../core/runtime-execution-attempt-durable-admission');
const {
  CONNECTION_TIMEOUT_MS,
  LOCK_TIMEOUT_MS,
  ROW_FIELDS,
  STATEMENT_TIMEOUT_MS,
  lifecycleFor,
  rowToDurableRecord
} = require('./runtime-execution-attempt-persistence-postgres');

const DEFAULT_TABLE_NAME = 'hermes.execution_attempts';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SELECT_COLUMNS = ROW_FIELDS.join(', ');
const P9_READINESS_FIELDS = ['schema_exists', 'table_exists', 'primary_key_exists', 'lifecycle_check_exists'];

function validateTableName(tableName) {
  if (typeof tableName !== 'string') return false;
  const parts = tableName.split('.');
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_execution_attempt_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('runtime_execution_attempt_postgres_pool_invalid');
  }
}

function timeoutError(message) {
  const error = new Error(message);
  error.code = 'TIMEOUT';
  return error;
}

function awaitWithTimeout(operation, timeoutMs, error, onLateFulfillment = null) {
  let timedOut = false;
  let timer;
  const tracked = Promise.resolve(operation).then(
    (value) => {
      if (timedOut && typeof onLateFulfillment === 'function') {
        try { Promise.resolve(onLateFulfillment(value)).catch(() => {}); } catch { /* bounded cleanup */ }
        return undefined;
      }
      return value;
    },
    (reason) => {
      if (timedOut) return undefined;
      throw reason;
    }
  );
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([tracked, deadline]).finally(() => clearTimeout(timer));
}

function queryWithTimeout(client, sql, values) {
  const operation = values === undefined ? client.query(sql) : client.query(sql, values);
  return awaitWithTimeout(operation, STATEMENT_TIMEOUT_MS, timeoutError('postgres_statement_timeout'));
}

async function rollbackAndRelease(client, began, released) {
  if (!client) return;
  if (began) {
    try { await queryWithTimeout(client, 'ROLLBACK'); } catch { /* original error wins */ }
  }
  if (!released) {
    try { client.release(); } catch { /* release is best effort */ }
  }
}

async function commitOrFail(client) {
  try {
    await queryWithTimeout(client, 'COMMIT');
  } catch {
    const error = new Error('postgres_commit_outcome_unknown');
    error.code = 'UNKNOWN_COMMIT_OUTCOME';
    throw error;
  }
}

function classifyError(error) {
  if (error?.code === '42P01' || error?.code === '42703') return new Error('postgres_schema_missing');
  if (error?.code === '55P03' || error?.code === '57014' || error?.code === 'TIMEOUT') return new Error('postgres_timeout');
  if (error?.code === '40001' || error?.code === '40P01') return new Error('postgres_admission_retryable_failure');
  return error;
}

function buildSql(tableName) {
  const [schemaName, relationName] = requireTableName(tableName).split('.');
  const qualified = `${schemaName}.${relationName}`;
  return {
    readiness: `
SELECT
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = '${schemaName}') AS schema_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_name = '${relationName}') AS table_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}' AND c.conname = 'execution_attempts_pkey') AS primary_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}' AND c.conname = 'execution_attempts_lifecycle_check') AS lifecycle_check_exists`,
    update: `
UPDATE ${qualified}
SET state = 'ADMITTED', revision = 2, updated_at = CURRENT_TIMESTAMP
WHERE attempt_durable_record_id = $1
  AND durable_job_reference_id = $2
  AND materialization_reference_id = $3
  AND materialization_reference_fingerprint = $4
  AND materialization_reference_digest = $5
  AND attempt_intent_reference_id = $6
  AND attempt_intent_reference_fingerprint = $7
  AND attempt_intent_reference_digest = $8
  AND tenant_id = $9 AND organization_id = $10 AND project_id = $11
  AND session_reference_id = $12 AND agent_id = $13 AND actor_id = $14
  AND logical_job_identity_digest = $15
  AND admission_reference_id = $16
  AND attempt_ordinal = $17
  AND contract_version = $18
  AND schema_version = $19
  AND durable_record_fingerprint = $20
  AND durable_record_digest = $21
  AND state = 'PREPARED'
  AND revision = 1
RETURNING ${SELECT_COLUMNS}`,
    selectById: `SELECT ${SELECT_COLUMNS} FROM ${qualified} WHERE attempt_durable_record_id = $1 FOR UPDATE`,
    selectByJobOrdinal: `SELECT ${SELECT_COLUMNS} FROM ${qualified} WHERE durable_job_reference_id = $1 AND attempt_ordinal = $2 FOR UPDATE`
  };
}

function valuesFor(record) {
  return [
    record.runtime_execution_attempt_durable_record_id,
    record.durable_job_reference.id,
    record.runtime_execution_attempt_materialization_reference.id,
    record.runtime_execution_attempt_materialization_reference.fingerprint,
    record.runtime_execution_attempt_materialization_reference.digest,
    record.runtime_execution_attempt_intent_reference.id,
    record.runtime_execution_attempt_intent_reference.fingerprint,
    record.runtime_execution_attempt_intent_reference.digest,
    record.identity_scope.tenant_id,
    record.identity_scope.organization_id,
    record.identity_scope.project_id,
    record.identity_scope.session_reference_id,
    record.identity_scope.agent_id,
    record.identity_scope.actor_id,
    record.logical_job_identity_digest,
    record.admission_reference.id,
    record.attempt_ordinal,
    record.contract_version,
    1,
    record.runtime_execution_attempt_durable_record_fingerprint,
    record.runtime_execution_attempt_durable_record_digest
  ];
}

function assertReadiness(response) {
  if (!response?.rows || response.rows.length !== 1 || P9_READINESS_FIELDS.some((field) => response.rows[0][field] !== true)) {
    throw new Error('postgres_schema_incompatible');
  }
}

function sameRecord(left, right) {
  return stablePayload(left) === stablePayload(right);
}

function createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName = DEFAULT_TABLE_NAME } = {}) {
  requirePool(pool);
  const sql = buildSql(tableName);
  let ready = false;
  let readinessPromise = null;

  async function ensureReady() {
    if (ready) return;
    if (!readinessPromise) {
      readinessPromise = (async () => {
        try {
          assertReadiness(await awaitWithTimeout(pool.query(sql.readiness), STATEMENT_TIMEOUT_MS, timeoutError('postgres_readiness_timeout')));
          ready = true;
        } finally {
          readinessPromise = null;
        }
      })();
    }
    return readinessPromise;
  }

  async function admitDurably(input) {
    const validation = validateAdmissionInput(input);
    if (!validation.valid) {
      return {
        admission_result: buildAdmissionResult({
          outcome: 'INVALID',
          record: input?.p7_durable_record,
          decision: input?.p8_admission_decision,
          finalState: null,
          finalRevision: null,
          transitionApplied: false,
          reasonCode: 'invalid_canonical_predecessor'
        }),
        validation_errors: validation.errors
      };
    }

    await ensureReady();
    const record = input.p7_durable_record;
    const decision = input.p8_admission_decision;
    let client;
    let began = false;
    let released = false;
    try {
      const releaseClient = () => {
        if (released) return;
        released = true;
        client.release();
      };
      client = await awaitWithTimeout(
        pool.connect(),
        CONNECTION_TIMEOUT_MS,
        timeoutError('postgres_connection_timeout'),
        (lateClient) => { try { lateClient?.release?.(); } catch { /* bounded late cleanup */ } }
      );
      await queryWithTimeout(client, 'BEGIN');
      began = true;
      await queryWithTimeout(client, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      await queryWithTimeout(client, `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      const updated = await queryWithTimeout(client, sql.update, valuesFor(record));
      if (updated?.rows?.length === 1) {
        const persisted = rowToDurableRecord(updated.rows[0]);
        if (!sameRecord(record, persisted)) throw new Error('admitted_record_mismatch');
        await commitOrFail(client);
        began = false;
        releaseClient();
        return { admission_result: buildAdmissionResult({ outcome: 'ADMITTED', record: persisted, decision, finalState: 'ADMITTED', finalRevision: 2, transitionApplied: true, reasonCode: 'prepared_to_admitted' }) };
      }

      let existingResponse = await queryWithTimeout(client, sql.selectById, [record.runtime_execution_attempt_durable_record_id]);
      if (existingResponse.rows.length === 0) {
        existingResponse = await queryWithTimeout(client, sql.selectByJobOrdinal, [record.durable_job_reference.id, record.attempt_ordinal]);
      }
      if (existingResponse.rows.length === 0) {
        await commitOrFail(client);
        began = false;
        releaseClient();
        return { admission_result: buildAdmissionResult({ outcome: 'NOT_FOUND', record, decision, finalState: null, finalRevision: null, transitionApplied: false, reasonCode: 'attempt_not_found' }) };
      }
      if (existingResponse.rows.length !== 1) throw new Error('admission_lookup_inconsistent');
      const existingRow = existingResponse.rows[0];
      const existing = rowToDurableRecord(existingRow);
      const lifecycle = lifecycleFor(existingRow.state, existingRow.revision);
      const canonicalMatch = sameRecord(record, existing);
      let outcome = 'CONFLICT';
      let reasonCode = 'canonical_semantics_conflict';
      if (canonicalMatch && lifecycle.state === 'ADMITTED' && lifecycle.revision === 2) {
        outcome = 'ALREADY_ADMITTED';
        reasonCode = 'already_admitted';
      } else if (canonicalMatch && lifecycle.state === 'PREPARED' && lifecycle.revision === 1) {
        outcome = 'STALE';
        reasonCode = 'prepared_transition_not_applied';
      }
      await commitOrFail(client);
      began = false;
      releaseClient();
      return { admission_result: buildAdmissionResult({ outcome, record: existing, decision, finalState: lifecycle.state, finalRevision: lifecycle.revision, transitionApplied: false, reasonCode }) };
    } catch (error) {
      await rollbackAndRelease(client, began, released);
      throw classifyError(error);
    }
  }

  return Object.freeze({
    adapter_name: 'runtime_execution_attempt_admission_postgres',
    table_name: tableName,
    admitDurably
  });
}

module.exports = {
  DEFAULT_TABLE_NAME,
  createRuntimeExecutionAttemptAdmissionPostgres,
  validateTableName
};
