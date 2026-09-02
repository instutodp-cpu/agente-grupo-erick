'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  SAFE_FLAGS,
  OWNERSHIP_ORDINAL,
  buildOwnershipPlan,
  classifyPersistedOwnership,
  planToInsertRow
} = require('../../core/runtime-execution-attempt-worker-ownership');
const { normalizeBindingRow } = require('./runtime-execution-attempt-claim-worker-binding-postgres');
const { normalizeRow: normalizeOwnerRow } = require('./runtime-operational-owner-identity-postgres');
const { rowToWorker } = require('./runtime-worker-registry-postgres');

const DEFAULT_BINDING_TABLE_NAME = 'hermes.runtime_execution_attempt_claim_worker_bindings';
const DEFAULT_OWNER_TABLE_NAME = 'hermes.runtime_operational_owners';
const DEFAULT_WORKER_TABLE_NAME = 'hermes.runtime_workers';
const DEFAULT_OWNERSHIP_TABLE_NAME = 'hermes.runtime_execution_attempt_worker_ownerships';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const JSON_FIELDS = Object.freeze(['ownership_artifact']);
const OWNERSHIP_COLUMNS = FIELDS.join(', ');

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_worker_ownership_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('runtime_worker_ownership_postgres_pool_invalid');
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function normalizeOwnershipRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    ownership_ordinal: Number(row.ownership_ordinal),
    ownership_artifact: parseJson(row.ownership_artifact),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function canonicalWorkerFromRow(row) {
  const persistedWorker = rowToWorker(row);
  const { created_at: _createdAt, updated_at: _updatedAt, ...canonicalWorker } = persistedWorker;
  return canonicalWorker;
}

function resultFor(outcome, plan, row, reasonCode, validationErrors = []) {
  const successful = ['CREATED', 'EXISTING_IDENTICAL'].includes(outcome);
  return cloneFrozen({
    ownership_result: {
      contract_name: CONTRACT_NAME,
      contract_version: CONTRACT_VERSION,
      outcome,
      ownership_id: row?.ownership_id ?? plan?.ownership_id ?? null,
      binding_id: row?.binding_id ?? plan?.identity?.binding_id ?? null,
      operational_owner_id: row?.operational_owner_id ?? plan?.identity?.operational_owner_id ?? null,
      selected_worker_id: row?.selected_worker_id ?? plan?.identity?.selected_worker_id ?? null,
      ownership_ordinal: row?.ownership_ordinal ?? plan?.ownership_ordinal ?? null,
      ...Object.fromEntries(Object.entries(SAFE_FLAGS).map(([key, value]) => [
        key, ['worker_selected', 'worker_bound', 'operational_owner_identity_registered', 'worker_ownership_established']
          .includes(key) ? successful : value
      ])),
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  });
}

function invalidResult(reasonCode, validationErrors = []) {
  return resultFor('INVALID', null, null, reasonCode, validationErrors);
}

function createRuntimeExecutionAttemptWorkerOwnershipPostgres({
  pool,
  bindingTableName = DEFAULT_BINDING_TABLE_NAME,
  ownerTableName = DEFAULT_OWNER_TABLE_NAME,
  workerTableName = DEFAULT_WORKER_TABLE_NAME,
  ownershipTableName = DEFAULT_OWNERSHIP_TABLE_NAME
} = {}) {
  requirePool(pool);
  const bindings = requireTableName(bindingTableName);
  const owners = requireTableName(ownerTableName);
  const workers = requireTableName(workerTableName);
  const ownerships = requireTableName(ownershipTableName);
  const fields = FIELDS.filter((field) => field !== 'created_at');

  async function establishOwnership({ binding_id: bindingId, operational_owner_id: ownerId, ownership_ordinal: ownershipOrdinal = OWNERSHIP_ORDINAL } = {}) {
    if (typeof bindingId !== 'string' || bindingId.length === 0) return invalidResult('binding_id_invalid');
    if (typeof ownerId !== 'string' || ownerId.length === 0) return invalidResult('operational_owner_id_invalid');
    if (!Number.isInteger(ownershipOrdinal) || ownershipOrdinal < 1) return invalidResult('ownership_ordinal_invalid');

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;

      const bindingResponse = await client.query(`SELECT * FROM ${bindings} WHERE binding_id = $1 FOR SHARE`, [bindingId]);
      if (bindingResponse.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', null, null, 'binding_not_found');
      }
      const binding = normalizeBindingRow(bindingResponse.rows[0]);

      const ownerResponse = await client.query(`SELECT * FROM ${owners} WHERE operational_owner_id = $1 FOR SHARE`, [ownerId]);
      if (ownerResponse.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', null, null, 'operational_owner_not_found');
      }
      const owner = normalizeOwnerRow(ownerResponse.rows[0]);

      const workerResponse = await client.query(`SELECT * FROM ${workers} WHERE worker_id = $1 FOR SHARE`, [binding.selected_worker_id]);
      if (workerResponse.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', null, null, 'worker_not_found');
      }
      let worker;
      try {
        worker = canonicalWorkerFromRow(workerResponse.rows[0]);
      } catch (error) {
        await client.query('COMMIT');
        began = false;
        return resultFor('TECHNICAL_FAILURE', null, null, 'worker_row_invalid', [error.message]);
      }

      const plan = buildOwnershipPlan({ binding, owner, worker, ownership_ordinal: ownershipOrdinal });
      if (plan.outcome !== 'READY') {
        await client.query('COMMIT');
        began = false;
        return resultFor(plan.outcome, plan, null, plan.reason_code, plan.errors);
      }

      const insertRow = planToInsertRow(plan);
      const values = fields.map((field) => JSON_FIELDS.includes(field) ? JSON.stringify(insertRow[field]) : insertRow[field]);
      const inserted = await client.query(`
        INSERT INTO ${ownerships} (${fields.join(', ')})
        VALUES (${fields.map((field, index) => `$${index + 1}${JSON_FIELDS.includes(field) ? '::jsonb' : ''}`).join(', ')})
        ON CONFLICT DO NOTHING
        RETURNING ${OWNERSHIP_COLUMNS}
      `, values);
      if (inserted.rowCount === 1) {
        const stored = normalizeOwnershipRow(inserted.rows[0]);
        await client.query('COMMIT');
        began = false;
        return resultFor('CREATED', plan, stored, 'ownership_created');
      }

      const existing = await client.query(`
        SELECT ${OWNERSHIP_COLUMNS} FROM ${ownerships}
        WHERE binding_id = $1 AND ownership_ordinal = $2
        FOR SHARE
      `, [plan.identity.binding_id, plan.ownership_ordinal]);
      if (existing.rowCount !== 1) throw new Error('ownership_conflict_row_missing');
      const stored = normalizeOwnershipRow(existing.rows[0]);
      const classification = classifyPersistedOwnership(stored, plan);
      await client.query('COMMIT');
      began = false;
      return resultFor(classification.outcome, plan, stored, classification.reason_code, classification.validation_errors || []);
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return resultFor('TECHNICAL_FAILURE', null, null, 'persistence_failure', [error.message]);
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    establishOwnership,
    bindingTableName: bindings,
    ownerTableName: owners,
    workerTableName: workers,
    ownershipTableName: ownerships
  });
}

module.exports = {
  DEFAULT_BINDING_TABLE_NAME,
  DEFAULT_OWNER_TABLE_NAME,
  DEFAULT_OWNERSHIP_TABLE_NAME,
  DEFAULT_WORKER_TABLE_NAME,
  createRuntimeExecutionAttemptWorkerOwnershipPostgres,
  normalizeOwnershipRow,
  validateTableName
};
