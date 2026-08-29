'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  buildAcquisitionPlan,
  classifyPersistedClaim,
  planToInsertRow,
  validateInput
} = require('../../core/runtime-execution-attempt-durable-claim-acquisition');
const {
  CONNECTION_TIMEOUT_MS,
  ROW_FIELDS,
  STATEMENT_TIMEOUT_MS,
  lifecycleFor,
  rowToDurableRecord
} = require('./runtime-execution-attempt-persistence-postgres');

const DEFAULT_ATTEMPT_TABLE_NAME = 'hermes.execution_attempts';
const DEFAULT_CLAIM_TABLE_NAME = 'hermes.execution_attempt_claims';
const CLAIM_ACQUISITION_TIMEOUT_MS = 60000;
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const CLAIM_COLUMNS = Object.freeze([
  'claim_id', 'claim_ordinal', 'attempt_durable_record_id', 'attempt_state', 'attempt_revision',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'attempt_ordinal', 'claim_intent_contract_name', 'claim_intent_contract_version',
  'claim_intent_reference_id', 'claim_intent_reference_version', 'claim_intent_reference_fingerprint',
  'claim_intent_reference_digest', 'claim_eligibility_contract_name', 'claim_eligibility_contract_version',
  'claim_eligibility_decision_status', 'claim_eligibility_decision_reference_id',
  'claim_eligibility_decision_reference_version', 'claim_eligibility_decision_reference_fingerprint',
  'claim_eligibility_decision_reference_digest', 'claim_contract_version', 'claim_state',
  'claim_fingerprint', 'claim_digest', 'claim_artifact', 'claim_receipt', 'schema_version', 'created_at'
]);
const CLAIM_SELECT_COLUMNS = CLAIM_COLUMNS.join(', ');
const ATTEMPT_SELECT_COLUMNS = ROW_FIELDS.join(', ');

function validateTableName(tableName) {
  if (typeof tableName !== 'string') return false;
  const parts = tableName.split('.');
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_execution_attempt_claim_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('runtime_execution_attempt_claim_postgres_pool_invalid');
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

function queryWithTimeout(client, sql, values, timeoutMs = STATEMENT_TIMEOUT_MS) {
  const operation = values === undefined ? client.query(sql) : client.query(sql, values);
  return awaitWithTimeout(operation, timeoutMs, timeoutError('postgres_statement_timeout'));
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

async function commitOrFail(client, timeoutMs = STATEMENT_TIMEOUT_MS) {
  try {
    await queryWithTimeout(client, 'COMMIT', undefined, timeoutMs);
  } catch {
    const error = new Error('postgres_commit_outcome_unknown');
    error.code = 'UNKNOWN_COMMIT_OUTCOME';
    throw error;
  }
}

function classifyError(error) {
  if (error?.code === '42P01' || error?.code === '42703') return new Error('postgres_schema_missing');
  if (error?.code === '55P03' || error?.code === '57014' || error?.code === 'TIMEOUT') return new Error('postgres_timeout');
  if (error?.code === '40001' || error?.code === '40P01') return new Error('postgres_claim_retryable_failure');
  return error;
}

function buildSql(attemptTableName, claimTableName) {
  const [attemptSchema, attemptRelation] = requireTableName(attemptTableName).split('.');
  const [claimSchema, claimRelation] = requireTableName(claimTableName).split('.');
  const attempts = `${attemptSchema}.${attemptRelation}`;
  const claims = `${claimSchema}.${claimRelation}`;
  return {
    readiness: `
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${claimSchema}' AND table_name = '${claimRelation}') AS table_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${claimSchema}' AND r.relname = '${claimRelation}' AND c.conname = 'execution_attempt_claims_pkey') AS primary_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${claimSchema}' AND r.relname = '${claimRelation}' AND c.conname = 'execution_attempt_claims_attempt_ordinal_key') AS slot_key_exists,
  EXISTS (SELECT 1 FROM pg_class i JOIN pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = '${claimSchema}' AND i.relname = 'execution_attempt_claims_active_attempt_key') AS active_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${claimSchema}' AND r.relname = '${claimRelation}' AND c.conname = 'execution_attempt_claims_claim_id_format_check') AS identity_check_exists`,
    selectAttempt: `SELECT ${ATTEMPT_SELECT_COLUMNS} FROM ${attempts} WHERE attempt_durable_record_id = $1 FOR UPDATE`,
    insertClaim: `INSERT INTO ${claims} (${CLAIM_COLUMNS.filter((field) => field !== 'created_at').join(', ')})
VALUES (${CLAIM_COLUMNS.filter((field) => field !== 'created_at').map((field, index) => `$${index + 1}${['claim_artifact', 'claim_receipt'].includes(field) ? '::jsonb' : ''}`).join(', ')})
ON CONFLICT DO NOTHING
RETURNING ${CLAIM_SELECT_COLUMNS}`,
    selectClaimsByAttempt: `SELECT ${CLAIM_SELECT_COLUMNS} FROM ${claims}
WHERE attempt_durable_record_id = $1 ORDER BY claim_ordinal FOR UPDATE`
  };
}

function claimValues(row) {
  return CLAIM_COLUMNS.filter((field) => field !== 'created_at').map((field) => {
    if (field === 'claim_artifact' || field === 'claim_receipt') return JSON.stringify(row[field]);
    return row[field];
  });
}

function normalizeClaimRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  return {
    ...row,
    claim_ordinal: Number(row.claim_ordinal),
    attempt_revision: Number(row.attempt_revision),
    attempt_ordinal: Number(row.attempt_ordinal),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function sameReference(left, right) {
  return ['id', 'version', 'fingerprint', 'digest'].every((field) => left?.[field] === right?.[field]);
}

function attemptReference(record) {
  return {
    id: record.runtime_execution_attempt_durable_record_id,
    version: record.runtime_execution_attempt_durable_record_version,
    fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
    digest: record.runtime_execution_attempt_durable_record_digest
  };
}

function validateCurrentAttempt(row, plan, decision) {
  let record;
  try {
    record = rowToDurableRecord(row);
    const lifecycle = lifecycleFor(row.state, row.revision);
    if (lifecycle.state !== 'ADMITTED' || lifecycle.revision !== 2) return { outcome: 'STALE', reason_code: 'attempt_not_admitted' };
  } catch {
    return { outcome: 'TECHNICAL_FAILURE', reason_code: 'attempt_row_invalid' };
  }
  if (!sameReference(attemptReference(record), decision.runtime_execution_attempt_durable_record_reference)) {
    return { outcome: 'STALE', reason_code: 'attempt_predecessor_stale' };
  }
  if (record.attempt_ordinal !== plan.identity.attempt_ordinal) return { outcome: 'STALE', reason_code: 'attempt_ordinal_stale' };
  if (IDENTITY_SCOPE_FIELDS.some((field) => record.identity_scope[field] !== plan.identity[field])) {
    return { outcome: 'STALE', reason_code: 'attempt_scope_stale' };
  }
  return { outcome: 'VALID', record };
}

const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);

function resultFor(outcome, plan, row, reasonCode, validationErrors = []) {
  const successful = ['CREATED', 'EXISTING_IDENTICAL'].includes(outcome);
  const claimExists = successful;
  const receipt = row?.claim_receipt && typeof row.claim_receipt === 'object'
    ? { ...row.claim_receipt, outcome, created_at: row.created_at ?? null }
    : null;
  return cloneFrozen({
    acquisition_result: {
      contract_name: 'RUNTIME_EXECUTION_ATTEMPT_DURABLE_CLAIM_ACQUISITION',
      contract_version: 'runtime_execution_attempt_durable_claim_acquisition_contract_v1',
      outcome,
      claim_id: row?.claim_id ?? plan?.claim_id ?? null,
      claim_state: row?.claim_state ?? plan?.claim_state ?? null,
      claim_ordinal: Number(row?.claim_ordinal ?? plan?.claim_ordinal ?? 0) || null,
      attempt_durable_record_id: row?.attempt_durable_record_id ?? plan?.identity.attempt_durable_record_id ?? null,
      attempt_state: row?.attempt_state ?? plan?.identity.attempt_state ?? null,
      attempt_revision: Number(row?.attempt_revision ?? plan?.identity.attempt_revision ?? 0) || null,
      claim_fingerprint: row?.claim_fingerprint ?? plan?.claim_fingerprint ?? null,
      claim_digest: row?.claim_digest ?? plan?.claim_digest ?? null,
      claim_issued: claimExists,
      claim_artifact_created: outcome === 'CREATED',
      worker_selected: false,
      worker_bound: false,
      worker_assignment_consumed: false,
      worker_ownership_established: false,
      executor_bound: false,
      executor_ownership_established: false,
      lease_created: false,
      lease_granted: false,
      fencing_token_created: false,
      fencing_token_issued: false,
      execution_authorized: false,
      execution_started: false,
      execution_performed: false,
      capacity_reservation_included: false,
      quota_mutation_included: false,
      queue_mutation_included: false,
      scheduler_mutation_included: false,
      simulation: false,
      production_blocked: true,
      claim_receipt: receipt,
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  });
}

function assertReadiness(response) {
  const row = response?.rows?.[0];
  if (!row || Object.values(row).some((value) => value !== true)) throw new Error('postgres_claim_schema_incompatible');
}

function createRuntimeExecutionAttemptClaimAcquisitionPostgres({
  pool,
  attemptTableName = DEFAULT_ATTEMPT_TABLE_NAME,
  claimTableName = DEFAULT_CLAIM_TABLE_NAME
} = {}) {
  requirePool(pool);
  const sql = buildSql(attemptTableName, claimTableName);
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

  async function acquireDurably(input) {
    const validation = validateInput(input);
    if (!validation.valid) return resultFor(validation.outcome || 'INVALID', null, null, 'invalid_canonical_predecessor', validation.errors);

    let plan;
    try {
      plan = buildAcquisitionPlan(input);
    } catch (error) {
      return resultFor(error.code || 'INVALID', null, null, 'invalid_canonical_predecessor', error.validation_errors || [error.message]);
    }

    await ensureReady();
    const insertRow = planToInsertRow(plan);
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
      const claimQuery = (sqlText, values) => queryWithTimeout(client, sqlText, values, CLAIM_ACQUISITION_TIMEOUT_MS);
      const claimCommit = () => commitOrFail(client, CLAIM_ACQUISITION_TIMEOUT_MS);
      await claimQuery('BEGIN');
      began = true;
      await claimQuery(`SET LOCAL lock_timeout = '${CLAIM_ACQUISITION_TIMEOUT_MS}ms'`);
      await claimQuery(`SET LOCAL statement_timeout = '${CLAIM_ACQUISITION_TIMEOUT_MS}ms'`);

      const attemptResponse = await claimQuery(sql.selectAttempt, [plan.identity.attempt_durable_record_id]);
      if (attemptResponse.rows.length === 0) {
        await claimCommit();
        began = false;
        releaseClient();
        return resultFor('NOT_FOUND', plan, null, 'attempt_not_found');
      }
      if (attemptResponse.rows.length !== 1) throw new Error('attempt_lookup_inconsistent');
      const currentAttempt = validateCurrentAttempt(
        attemptResponse.rows[0],
        plan,
        input.runtime_execution_attempt_claim_eligibility_decision
      );
      if (currentAttempt.outcome !== 'VALID') {
        await claimCommit();
        began = false;
        releaseClient();
        return resultFor(currentAttempt.outcome, plan, null, currentAttempt.reason_code);
      }

      const existingBeforeInsert = await claimQuery(sql.selectClaimsByAttempt, [plan.identity.attempt_durable_record_id]);
      if (existingBeforeInsert.rows.length > 1) throw new Error('claim_conflict_without_single_row');
      if (existingBeforeInsert.rows.length === 1) {
        const existingRow = normalizeClaimRow(existingBeforeInsert.rows[0]);
        const classification = classifyPersistedClaim(existingRow, plan);
        await claimCommit();
        began = false;
        releaseClient();
        return resultFor(classification.outcome, plan, existingRow, classification.reason_code, classification.validation_errors || []);
      }

      const inserted = await claimQuery(sql.insertClaim, claimValues(insertRow));
      if (inserted.rows.length === 1) {
        const storedRow = normalizeClaimRow(inserted.rows[0]);
        const stored = classifyPersistedClaim(storedRow, plan);
        if (stored.outcome !== 'EXISTING_IDENTICAL') throw new Error('created_claim_identity_mismatch');
        await claimCommit();
        began = false;
        releaseClient();
        return resultFor('CREATED', plan, storedRow, 'claim_created');
      }

      const existingResponse = await claimQuery(sql.selectClaimsByAttempt, [plan.identity.attempt_durable_record_id]);
      if (existingResponse.rows.length !== 1) throw new Error('claim_conflict_without_single_row');
      const existingRow = normalizeClaimRow(existingResponse.rows[0]);
      const classification = classifyPersistedClaim(existingRow, plan);
      await claimCommit();
      began = false;
      releaseClient();
      return resultFor(classification.outcome, plan, existingRow, classification.reason_code, classification.validation_errors || []);
    } catch (error) {
      await rollbackAndRelease(client, began, released);
      throw classifyError(error);
    }
  }

  return Object.freeze({
    adapter_name: 'runtime_execution_attempt_claim_acquisition_postgres',
    attempt_table_name: attemptTableName,
    claim_table_name: claimTableName,
    normalizeClaimRow,
    acquireDurably
  });
}

module.exports = {
  DEFAULT_ATTEMPT_TABLE_NAME,
  DEFAULT_CLAIM_TABLE_NAME,
  createRuntimeExecutionAttemptClaimAcquisitionPostgres,
  validateTableName
};
