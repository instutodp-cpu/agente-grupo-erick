'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  DEFAULT_LEASE_DURATION_MS,
  FIELDS,
  LEASE_ORDINAL,
  LEASE_STATES,
  SAFE_FLAGS,
  buildLeasePlan,
  classifyPersistedLease,
  planToInsertRow,
  validatePersistedLease,
  validDuration
} = require('../../core/runtime-execution-attempt-worker-lease');
const { normalizeBindingRow } = require('./runtime-execution-attempt-claim-worker-binding-postgres');
const { normalizeRow: normalizeOwnerRow } = require('./runtime-operational-owner-identity-postgres');
const { normalizeOwnershipRow } = require('./runtime-execution-attempt-worker-ownership-postgres');
const { rowToWorker } = require('./runtime-worker-registry-postgres');

const DEFAULT_OWNERSHIP_TABLE_NAME = 'hermes.runtime_execution_attempt_worker_ownerships';
const DEFAULT_OWNER_TABLE_NAME = 'hermes.runtime_operational_owners';
const DEFAULT_WORKER_TABLE_NAME = 'hermes.runtime_workers';
const DEFAULT_LEASE_TABLE_NAME = 'hermes.runtime_execution_attempt_worker_leases';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const JSON_FIELDS = Object.freeze(['lease_artifact']);
const LEASE_COLUMNS = FIELDS.join(', ');

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_worker_lease_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('runtime_worker_lease_postgres_pool_invalid');
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function normalizeLeaseRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    lease_ordinal: Number(row.lease_ordinal),
    fencing_token: Number(row.fencing_token),
    lease_artifact: parseJson(row.lease_artifact),
    lease_expires_at: row.lease_expires_at instanceof Date ? row.lease_expires_at.toISOString() : row.lease_expires_at,
    last_renewed_at: row.last_renewed_at instanceof Date ? row.last_renewed_at.toISOString() : row.last_renewed_at,
    released_at: row.released_at instanceof Date ? row.released_at.toISOString() : row.released_at,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function canonicalWorkerFromRow(row) {
  const persistedWorker = rowToWorker(row);
  const { created_at: _createdAt, updated_at: _updatedAt, ...canonicalWorker } = persistedWorker;
  return canonicalWorker;
}

function resultFor(operation, outcome, plan, row, reasonCode, validationErrors = []) {
  const successful = ['CREATED', 'EXISTING_IDENTICAL', 'RENEWED', 'RELEASED'].includes(outcome);
  return cloneFrozen({
    lease_result: {
      contract_name: CONTRACT_NAME,
      contract_version: CONTRACT_VERSION,
      operation,
      outcome,
      lease_id: row?.lease_id ?? plan?.lease_id ?? null,
      ownership_id: row?.ownership_id ?? plan?.identity?.ownership_id ?? null,
      binding_id: row?.binding_id ?? plan?.identity?.binding_id ?? null,
      operational_owner_id: row?.operational_owner_id ?? plan?.identity?.operational_owner_id ?? null,
      selected_worker_id: row?.selected_worker_id ?? plan?.identity?.selected_worker_id ?? null,
      lease_ordinal: row?.lease_ordinal ?? plan?.lease_ordinal ?? null,
      fencing_token: row?.fencing_token ?? plan?.fencing_token ?? null,
      lease_state: row?.lease_state ?? null,
      lease_expires_at: row?.lease_expires_at ?? null,
      ...Object.fromEntries(Object.entries(SAFE_FLAGS).map(([key, value]) => [key, successful ? value : false])),
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  });
}

function invalidResult(operation, reasonCode, validationErrors = []) {
  return resultFor(operation, 'INVALID', null, null, reasonCode, validationErrors);
}

function normalizePredecessorRows(ownershipRow, ownerRow, workerRow) {
  return {
    ownership: normalizeOwnershipRow(ownershipRow),
    owner: normalizeOwnerRow(ownerRow),
    worker: canonicalWorkerFromRow(workerRow)
  };
}

function createRuntimeExecutionAttemptWorkerLeasePostgres({
  pool,
  ownershipTableName = DEFAULT_OWNERSHIP_TABLE_NAME,
  ownerTableName = DEFAULT_OWNER_TABLE_NAME,
  workerTableName = DEFAULT_WORKER_TABLE_NAME,
  leaseTableName = DEFAULT_LEASE_TABLE_NAME
} = {}) {
  requirePool(pool);
  const ownerships = requireTableName(ownershipTableName);
  const owners = requireTableName(ownerTableName);
  const workers = requireTableName(workerTableName);
  const leases = requireTableName(leaseTableName);
  const fields = FIELDS.filter((field) => !['lease_expires_at', 'last_renewed_at', 'released_at', 'created_at', 'updated_at', 'fencing_token', 'lease_state'].includes(field));

  async function loadPredecessors(client, ownershipId, ownerId) {
    const ownershipResponse = await client.query(`SELECT * FROM ${ownerships} WHERE ownership_id = $1 FOR SHARE`, [ownershipId]);
    if (ownershipResponse.rowCount !== 1) return { outcome: 'NOT_FOUND', reasonCode: 'ownership_not_found' };
    const ownership = normalizeOwnershipRow(ownershipResponse.rows[0]);
    const ownerResponse = await client.query(`SELECT * FROM ${owners} WHERE operational_owner_id = $1 FOR SHARE`, [ownerId]);
    if (ownerResponse.rowCount !== 1) return { outcome: 'NOT_FOUND', reasonCode: 'operational_owner_not_found' };
    const owner = normalizeOwnerRow(ownerResponse.rows[0]);
    const workerResponse = await client.query(`SELECT * FROM ${workers} WHERE worker_id = $1 FOR SHARE`, [ownership.selected_worker_id]);
    if (workerResponse.rowCount !== 1) return { outcome: 'NOT_FOUND', reasonCode: 'worker_not_found' };
    return { ...normalizePredecessorRows(ownershipResponse.rows[0], ownerResponse.rows[0], workerResponse.rows[0]) };
  }

  async function acquireLease({ ownership_id: ownershipId, operational_owner_id: ownerId, lease_ordinal: leaseOrdinal = LEASE_ORDINAL, lease_duration_ms: duration = DEFAULT_LEASE_DURATION_MS } = {}) {
    if (typeof ownershipId !== 'string' || ownershipId.length === 0) return invalidResult('ACQUIRE', 'ownership_id_invalid');
    if (typeof ownerId !== 'string' || ownerId.length === 0) return invalidResult('ACQUIRE', 'operational_owner_id_invalid');
    if (!Number.isInteger(leaseOrdinal) || leaseOrdinal < 1) return invalidResult('ACQUIRE', 'lease_ordinal_invalid');
    if (!validDuration(duration)) return invalidResult('ACQUIRE', 'lease_duration_invalid');
    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const predecessors = await loadPredecessors(client, ownershipId, ownerId);
      if (predecessors.outcome) {
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', predecessors.outcome, null, null, predecessors.reasonCode);
      }
      const plan = buildLeasePlan({ ...predecessors, lease_ordinal: leaseOrdinal });
      if (plan.outcome !== 'READY') {
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', plan.outcome, plan, null, plan.reason_code, plan.errors);
      }
      const insertRow = planToInsertRow(plan);
      const values = fields.map((field) => JSON_FIELDS.includes(field) ? JSON.stringify(insertRow[field]) : insertRow[field]);
      const placeholders = fields.map((field, index) => {
        if (field === 'lease_ordinal') return `$${index + 1}`;
        return `$${index + 1}`;
      });
      const ordinalIndex = fields.indexOf('lease_ordinal') + 1;
      const fencingToken = fields.length + 1;
      const state = fields.length + 2;
      const expires = fields.length + 3;
      const inserted = await client.query(`
        INSERT INTO ${leases} (${fields.join(', ')}, fencing_token, lease_state, lease_expires_at)
        VALUES (${placeholders.join(', ')}, $${fencingToken}, $${state}, CURRENT_TIMESTAMP + ($${expires} * INTERVAL '1 millisecond'))
        ON CONFLICT DO NOTHING
        RETURNING ${LEASE_COLUMNS}
      `, [...values, plan.fencing_token, 'ACTIVE', duration]);
      if (inserted.rowCount === 1) {
        const stored = normalizeLeaseRow(inserted.rows[0]);
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', 'CREATED', plan, stored, 'lease_created');
      }
      const existingResponse = await client.query(`SELECT ${LEASE_COLUMNS} FROM ${leases} WHERE ownership_id = $1 AND lease_ordinal = $2 FOR UPDATE`, [plan.identity.ownership_id, plan.lease_ordinal]);
      if (existingResponse.rowCount !== 1) throw new Error('lease_conflict_row_missing');
      let stored = normalizeLeaseRow(existingResponse.rows[0]);
      const classification = classifyPersistedLease(stored, plan);
      if (classification.outcome === 'EXISTING_IDENTICAL' && stored.lease_state === 'ACTIVE') {
        if (new Date(stored.lease_expires_at).getTime() <= Date.now()) {
          const expired = await client.query(`UPDATE ${leases} SET lease_state = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE lease_id = $1 AND lease_state = 'ACTIVE' RETURNING ${LEASE_COLUMNS}`, [stored.lease_id]);
          if (expired.rowCount === 1) stored = normalizeLeaseRow(expired.rows[0]);
          classification.outcome = 'STALE';
          classification.reason_code = 'lease_expired';
        }
      } else if (classification.outcome === 'EXISTING_IDENTICAL' && stored.lease_state !== 'ACTIVE') {
        classification.outcome = 'STALE';
        classification.reason_code = `lease_${stored.lease_state.toLowerCase()}`;
      }
      await client.query('COMMIT');
      began = false;
      return resultFor('ACQUIRE', classification.outcome, plan, stored, classification.reason_code, classification.validation_errors || []);
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return resultFor('ACQUIRE', 'TECHNICAL_FAILURE', null, null, 'persistence_failure', [error.message]);
    } finally {
      client.release();
    }
  }

  async function mutateLease(operation, leaseId, ownerId, fencingToken, duration) {
    if (typeof leaseId !== 'string' || leaseId.length === 0) return invalidResult(operation, 'lease_id_invalid');
    if (typeof ownerId !== 'string' || ownerId.length === 0) return invalidResult(operation, 'operational_owner_id_invalid');
    if (!Number.isInteger(fencingToken) || fencingToken < 1) return invalidResult(operation, 'fencing_token_invalid');
    if (operation === 'RENEW' && !validDuration(duration)) return invalidResult(operation, 'lease_duration_invalid');
    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const found = await client.query(`SELECT ${LEASE_COLUMNS} FROM ${leases} WHERE lease_id = $1 FOR UPDATE`, [leaseId]);
      if (found.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return resultFor(operation, 'NOT_FOUND', null, null, 'lease_not_found');
      }
      let stored = normalizeLeaseRow(found.rows[0]);
      const validation = validatePersistedLease(stored);
      if (!validation.valid) throw new Error(`persisted_lease_invalid::${validation.errors.join(',')}`);
      if (stored.lease_state === 'ACTIVE' && new Date(stored.lease_expires_at).getTime() <= Date.now()) {
        const expired = await client.query(`UPDATE ${leases} SET lease_state = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE lease_id = $1 AND lease_state = 'ACTIVE' RETURNING ${LEASE_COLUMNS}`, [leaseId]);
        if (expired.rowCount === 1) stored = normalizeLeaseRow(expired.rows[0]);
      }
      if (stored.operational_owner_id !== ownerId || stored.fencing_token !== fencingToken || stored.lease_state !== 'ACTIVE') {
        await client.query('COMMIT');
        began = false;
        return resultFor(operation, 'STALE', null, stored, 'stale_owner_or_fencing_token');
      }
      if (operation === 'RENEW') {
        const updated = await client.query(`UPDATE ${leases} SET lease_expires_at = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 millisecond'), last_renewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE lease_id = $1 AND operational_owner_id = $3 AND fencing_token = $4 AND lease_state = 'ACTIVE' RETURNING ${LEASE_COLUMNS}`, [leaseId, duration, ownerId, fencingToken]);
        stored = normalizeLeaseRow(updated.rows[0]);
      } else {
        const updated = await client.query(`UPDATE ${leases} SET lease_state = 'RELEASED', lease_expires_at = CURRENT_TIMESTAMP, released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE lease_id = $1 AND operational_owner_id = $2 AND fencing_token = $3 AND lease_state = 'ACTIVE' RETURNING ${LEASE_COLUMNS}`, [leaseId, ownerId, fencingToken]);
        stored = normalizeLeaseRow(updated.rows[0]);
      }
      await client.query('COMMIT');
      began = false;
      return resultFor(operation, operation === 'RENEW' ? 'RENEWED' : 'RELEASED', null, stored, operation === 'RENEW' ? 'lease_renewed' : 'lease_released');
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return resultFor(operation, 'TECHNICAL_FAILURE', null, null, 'persistence_failure', [error.message]);
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    acquireLease,
    renewLease: ({ lease_id: leaseId, operational_owner_id: ownerId, fencing_token: token, lease_duration_ms: duration = DEFAULT_LEASE_DURATION_MS } = {}) => mutateLease('RENEW', leaseId, ownerId, token, duration),
    releaseLease: ({ lease_id: leaseId, operational_owner_id: ownerId, fencing_token: token } = {}) => mutateLease('RELEASE', leaseId, ownerId, token),
    ownershipTableName: ownerships,
    ownerTableName: owners,
    workerTableName: workers,
    leaseTableName: leases,
    leaseStates: LEASE_STATES
  });
}

module.exports = {
  DEFAULT_LEASE_TABLE_NAME,
  DEFAULT_OWNERSHIP_TABLE_NAME,
  DEFAULT_OWNER_TABLE_NAME,
  DEFAULT_WORKER_TABLE_NAME,
  createRuntimeExecutionAttemptWorkerLeasePostgres,
  normalizeLeaseRow,
  validateTableName
};
