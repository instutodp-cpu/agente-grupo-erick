'use strict';

const { assertConfirmationPersistence } = require('./confirmation-persistence');

const CONFIRMATION_TABLE = 'hermes.confirmations';
const SELECT_COLUMNS = 'confirmation_id, trace_id, domain, intent, status, expires_at';
const SELECT_SQL = `SELECT ${SELECT_COLUMNS} FROM ${CONFIRMATION_TABLE} WHERE confirmation_id = $1`;
const LIST_SQL = `SELECT ${SELECT_COLUMNS} FROM ${CONFIRMATION_TABLE}`;
const INSERT_SQL = `INSERT INTO ${CONFIRMATION_TABLE}
  (confirmation_id, trace_id, domain, intent, status, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING ${SELECT_COLUMNS}`;
const TRANSITION_SQL = `UPDATE ${CONFIRMATION_TABLE}
SET status = $2
WHERE confirmation_id = $1 AND status = $3
RETURNING ${SELECT_COLUMNS}`;
const DELETE_SQL = `DELETE FROM ${CONFIRMATION_TABLE}`;
const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'expired']);
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function validateTableName(table_name = CONFIRMATION_TABLE) {
  if (typeof table_name !== 'string') throw new TypeError('confirmation_table_name_invalid');
  const parts = table_name.split('.');
  if (parts.length !== 2 || parts.some((part) => !SAFE_IDENTIFIER.test(part))) {
    throw new TypeError('confirmation_table_name_invalid');
  }
  return table_name;
}

function queriesFor(table_name) {
  return {
    select: `SELECT ${SELECT_COLUMNS} FROM ${table_name} WHERE confirmation_id = $1`,
    list: `SELECT ${SELECT_COLUMNS} FROM ${table_name}`,
    insert: `INSERT INTO ${table_name}
  (confirmation_id, trace_id, domain, intent, status, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING ${SELECT_COLUMNS}`,
    transition: `UPDATE ${table_name}
SET status = $2
WHERE confirmation_id = $1 AND status = $3
RETURNING ${SELECT_COLUMNS}`,
    delete: `DELETE FROM ${table_name}`
  };
}

function cloneRecord(record) {
  return record ? { ...record } : null;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`confirmation_${field}_required`);
  }
  return value;
}

function recordParams(record) {
  if (!record || typeof record !== 'object') throw new TypeError('confirmation_record_invalid');
  return [
    requiredString(record.confirmation_id, 'id'),
    requiredString(record.trace_id, 'trace_id'),
    requiredString(record.domain, 'domain'),
    requiredString(record.intent, 'intent'),
    requiredString(record.status, 'status'),
    requiredString(record.expires_at, 'expires_at')
  ];
}

function mappedExpiry(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('malformed_expires_at');
    return value.toISOString();
  }
  const expiry = requiredString(value, 'expires_at');
  if (Number.isNaN(Date.parse(expiry))) throw new Error('malformed_expires_at');
  return expiry;
}

function rowToRecord(row) {
  if (!row || typeof row !== 'object') throw new Error('malformed_confirmation_row');
  const status = requiredString(row.status, 'status');
  if (!VALID_STATUSES.has(status)) throw new Error('malformed_status');
  return {
    confirmation_id: requiredString(row.confirmation_id, 'id'),
    trace_id: requiredString(row.trace_id, 'trace_id'),
    domain: requiredString(row.domain, 'domain'),
    intent: requiredString(row.intent, 'intent'),
    status,
    expires_at: mappedExpiry(row.expires_at)
  };
}

function rowsExactlyOne(response) {
  if (!response || !Array.isArray(response.rows)) throw new Error('malformed_query_result');
  if (response.rows.length !== 1) throw new Error('malformed_query_result');
  return rowToRecord(response.rows[0]);
}

function validatePool(pool) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('confirmation_postgres_pool_invalid');
}

function createPostgresConfirmationPersistence({ pool, table_name = CONFIRMATION_TABLE } = {}) {
  validatePool(pool);
  const tableName = validateTableName(table_name);
  const queries = queriesFor(tableName);

  const adapter = {
    async create(record) {
      const response = await pool.query(queries.insert, recordParams(record));
      return rowsExactlyOne(response);
    },

    async get(confirmation_id) {
      requiredString(confirmation_id, 'id');
      const response = await pool.query(queries.select, [confirmation_id]);
      if (!response || !Array.isArray(response.rows)) throw new Error('malformed_query_result');
      if (response.rows.length === 0) return null;
      if (response.rows.length !== 1) throw new Error('malformed_query_result');
      return rowToRecord(response.rows[0]);
    },

    async compareAndTransition({ confirmation_id, expected_status, next_status } = {}) {
      requiredString(confirmation_id, 'id');
      requiredString(expected_status, 'expected_status');
      requiredString(next_status, 'next_status');

      const updated = await pool.query(queries.transition, [confirmation_id, next_status, expected_status]);
      if (!updated || !Array.isArray(updated.rows)) throw new Error('malformed_query_result');
      if (updated.rows.length === 1) {
        const record = rowToRecord(updated.rows[0]);
        return {
          outcome: next_status === expected_status ? 'unchanged' : 'transitioned',
          record: cloneRecord(record)
        };
      }
      if (updated.rows.length !== 0) throw new Error('malformed_query_result');

      // The conditional UPDATE remains the atomic decision. This read only
      // classifies a zero-row result as absent or stale.
      const current = await this.get(confirmation_id);
      if (!current) return { outcome: 'not_found', record: null };
      return { outcome: 'state_mismatch', record: cloneRecord(current) };
    },

    async list() {
      const response = await pool.query(queries.list, []);
      if (!response || !Array.isArray(response.rows)) throw new Error('malformed_query_result');
      return response.rows.map(rowToRecord).map(cloneRecord);
    },

    async reset() {
      await pool.query(queries.delete, []);
    }
  };

  return Object.freeze(assertConfirmationPersistence(adapter));
}

module.exports = {
  CONFIRMATION_TABLE,
  DELETE_SQL,
  INSERT_SQL,
  LIST_SQL,
  SELECT_SQL,
  TRANSITION_SQL,
  createPostgresConfirmationPersistence,
  rowToRecord,
  validateTableName
};
