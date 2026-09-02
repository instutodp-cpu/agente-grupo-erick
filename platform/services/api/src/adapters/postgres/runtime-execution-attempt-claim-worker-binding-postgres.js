'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  BINDING_FIELDS,
  BINDING_ORDINAL,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  SAFE_FLAGS,
  buildBindingPlan,
  classifyPersistedBinding,
  planToInsertRow
} = require('../../core/runtime-execution-attempt-claim-worker-binding');
const { normalizeSelectionRow } = require('./runtime-execution-attempt-claim-worker-selection-postgres');
const { rowToWorker } = require('./runtime-worker-registry-postgres');

const DEFAULT_CLAIM_TABLE_NAME = 'hermes.execution_attempt_claims';
const DEFAULT_SELECTION_TABLE_NAME = 'hermes.runtime_execution_attempt_claim_worker_selections';
const DEFAULT_WORKER_TABLE_NAME = 'hermes.runtime_workers';
const DEFAULT_BINDING_TABLE_NAME = 'hermes.runtime_execution_attempt_claim_worker_bindings';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const JSON_FIELDS = Object.freeze(['binding_artifact']);
const BINDING_COLUMNS = BINDING_FIELDS.filter((field) => field !== 'created_at').concat('created_at').join(', ');

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_worker_binding_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('runtime_worker_binding_postgres_pool_invalid');
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function normalizeClaimRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    claim_ordinal: Number(row.claim_ordinal),
    attempt_revision: Number(row.attempt_revision),
    attempt_ordinal: Number(row.attempt_ordinal),
    claim_artifact: parseJson(row.claim_artifact),
    claim_receipt: parseJson(row.claim_receipt),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function normalizeBindingRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    runtime_stage_reference_version: Number(row.runtime_stage_reference_version),
    binding_ordinal: Number(row.binding_ordinal),
    binding_artifact: parseJson(row.binding_artifact),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function resultFor(outcome, plan, row, reasonCode, validationErrors = []) {
  const successful = ['CREATED', 'EXISTING_IDENTICAL'].includes(outcome);
  return cloneFrozen({
    binding_result: {
      contract_name: CONTRACT_NAME,
      contract_version: CONTRACT_VERSION,
      outcome,
      binding_id: row?.binding_id ?? plan?.binding_id ?? null,
      claim_id: row?.claim_id ?? plan?.identity?.claim_id ?? null,
      selection_id: row?.selection_id ?? plan?.identity?.selection_id ?? null,
      runtime_stage_reference_id: row?.runtime_stage_reference_id ?? plan?.identity?.runtime_stage_reference_id ?? null,
      selected_worker_id: row?.selected_worker_id ?? plan?.identity?.selected_worker_id ?? null,
      binding_ordinal: row?.binding_ordinal ?? plan?.binding_ordinal ?? null,
      worker_selected: successful,
      worker_bound: successful,
      ...Object.fromEntries(Object.entries(SAFE_FLAGS).map(([key, value]) => [
        key, ['worker_selected', 'worker_bound'].includes(key) ? successful : value
      ])),
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  });
}

function createRuntimeExecutionAttemptClaimWorkerBindingPostgres({
  pool,
  claimTableName = DEFAULT_CLAIM_TABLE_NAME,
  selectionTableName = DEFAULT_SELECTION_TABLE_NAME,
  workerTableName = DEFAULT_WORKER_TABLE_NAME,
  bindingTableName = DEFAULT_BINDING_TABLE_NAME
} = {}) {
  requirePool(pool);
  const claims = requireTableName(claimTableName);
  const selections = requireTableName(selectionTableName);
  const workers = requireTableName(workerTableName);
  const bindings = requireTableName(bindingTableName);
  const bindingColumns = BINDING_COLUMNS;

  async function bindDurably({ claim_id: claimId, selection_id: selectionId, binding_ordinal: bindingOrdinal = BINDING_ORDINAL } = {}) {
    if (typeof claimId !== 'string' || claimId.length === 0) return resultFor('INVALID', null, null, 'claim_id_invalid');
    if (typeof selectionId !== 'string' || selectionId.length === 0) return resultFor('INVALID', null, null, 'selection_id_invalid');
    if (!Number.isInteger(bindingOrdinal) || bindingOrdinal < 1) return resultFor('INVALID', null, null, 'binding_ordinal_invalid');

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const claimResponse = await client.query(`SELECT * FROM ${claims} WHERE claim_id = $1 FOR SHARE`, [claimId]);
      if (claimResponse.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', null, null, 'claim_not_found');
      }
      const claim = normalizeClaimRow(claimResponse.rows[0]);

      const selectionResponse = await client.query(`SELECT * FROM ${selections} WHERE selection_id = $1 FOR SHARE`, [selectionId]);
      if (selectionResponse.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', null, null, 'selection_not_found');
      }
      const selection = normalizeSelectionRow(selectionResponse.rows[0]);

      const workerResponse = await client.query(`SELECT * FROM ${workers} WHERE worker_id = $1 FOR SHARE`, [selection.selected_worker_id]);
      if (workerResponse.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', null, null, 'worker_not_found');
      }
      let worker;
      try {
        const persistedWorker = rowToWorker(workerResponse.rows[0]);
        const { created_at: _createdAt, updated_at: _updatedAt, ...canonicalWorker } = persistedWorker;
        worker = canonicalWorker;
      } catch {
        await client.query('COMMIT');
        began = false;
        return resultFor('TECHNICAL_FAILURE', null, null, 'worker_row_invalid');
      }

      const plan = buildBindingPlan({ claim, selection, worker, binding_ordinal: bindingOrdinal });
      if (plan.outcome !== 'READY') {
        await client.query('COMMIT');
        began = false;
        return resultFor(plan.outcome, plan, null, plan.reason_code, plan.errors);
      }

      const insertRow = planToInsertRow(plan);
      const fields = BINDING_FIELDS.filter((field) => field !== 'created_at');
      const values = fields.map((field) => JSON_FIELDS.includes(field) ? JSON.stringify(insertRow[field]) : insertRow[field]);
      const inserted = await client.query(`
        INSERT INTO ${bindings} (${fields.join(', ')})
        VALUES (${fields.map((field, index) => `$${index + 1}${JSON_FIELDS.includes(field) ? '::jsonb' : ''}`).join(', ')})
        ON CONFLICT DO NOTHING
        RETURNING ${bindingColumns}
      `, values);
      if (inserted.rowCount === 1) {
        const stored = normalizeBindingRow(inserted.rows[0]);
        await client.query('COMMIT');
        began = false;
        return resultFor('CREATED', plan, stored, 'binding_created');
      }

      const existing = await client.query(`
        SELECT ${bindingColumns} FROM ${bindings}
        WHERE claim_id = $1 AND runtime_stage_reference_id = $2 AND binding_ordinal = $3
        FOR SHARE
      `, [plan.identity.claim_id, plan.identity.runtime_stage_reference_id, plan.binding_ordinal]);
      if (existing.rowCount !== 1) throw new Error('binding_conflict_row_missing');
      const stored = normalizeBindingRow(existing.rows[0]);
      const classification = classifyPersistedBinding(stored, plan);
      await client.query('COMMIT');
      began = false;
      return resultFor(classification.outcome, plan, stored, classification.reason_code, classification.validation_errors || []);
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ bindDurably, bindingTableName: bindings });
}

module.exports = {
  DEFAULT_BINDING_TABLE_NAME,
  createRuntimeExecutionAttemptClaimWorkerBindingPostgres,
  normalizeBindingRow,
  validateTableName
};
