'use strict';

const {
  buildDurableAuditRecord,
  createDurableAuditReceipt,
  MAX_PERSISTED_EVENT_BYTES,
  PERSISTENT_AUDIT_CONTRACT_VERSION,
  PERSISTENT_AUDIT_TABLE
} = require('../../core/public-web-canary-durable-audit-contract');

const POSTGRES_SCHEMA_VERSION = 1;
const CONNECTION_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 10000;
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const AUDIT_COLUMNS = Object.freeze([
  'event_id', 'event_digest', 'contract_version', 'canary_session_id',
  'trace_id', 'request_id', 'change_id', 'tenant_id', 'workspace_type',
  'user_id', 'operator_id', 'approved_by', 'event_name', 'event_sequence',
  'occurred_at', 'event_payload', 'created_at'
]);

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('public_web_canary_audit_table_name_invalid');
  return tableName;
}

function buildSql(tableName) {
  const qualified = requireTableName(tableName);
  const columns = AUDIT_COLUMNS.join(', ');
  return {
    insert: `INSERT INTO ${qualified} (
  ${columns}
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING
RETURNING ${columns}`,
    selectByIdentity: `SELECT ${columns} FROM ${qualified}
WHERE event_id = $1 OR event_digest = $2
FOR SHARE`,
    readiness: `
SELECT
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = '${qualified.split('.')[0]}') AS schema_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${qualified.split('.')[0]}' AND table_name = '${qualified.split('.')[1]}') AS table_exists,
  (
    SELECT count(*) = ${AUDIT_COLUMNS.length}
    FROM information_schema.columns
    WHERE table_schema = '${qualified.split('.')[0]}' AND table_name = '${qualified.split('.')[1]}'
  ) AS columns_exist`
  };
}

const DEFAULT_SQL = buildSql(PERSISTENT_AUDIT_TABLE);
const INSERT_SQL = DEFAULT_SQL.insert;
const SELECT_BY_IDENTITY_SQL = DEFAULT_SQL.selectByIdentity;
const READINESS_SQL = DEFAULT_SQL.readiness;

class PublicWebCanaryAuditPersistenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PublicWebCanaryAuditPersistenceError';
    this.code = code;
  }
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('public_web_canary_audit_pool_invalid');
  }
}

function parsePayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new PublicWebCanaryAuditPersistenceError('CORRUPT_ROW', 'event_payload_invalid');
  try {
    return JSON.parse(value);
  } catch {
    throw new PublicWebCanaryAuditPersistenceError('CORRUPT_ROW', 'event_payload_invalid');
  }
}

function rowToRecord(row) {
  if (!row || typeof row !== 'object') throw new PublicWebCanaryAuditPersistenceError('CORRUPT_ROW', 'audit_row_invalid');
  const event = parsePayload(row.event_payload);
  const record = buildDurableAuditRecord(event);
  if (!record.valid
    || row.event_id !== record.event_id
    || row.event_digest !== record.event_digest
    || row.contract_version !== PERSISTENT_AUDIT_CONTRACT_VERSION
    || row.canary_session_id !== event.canary_session_id
    || row.tenant_id !== event.tenant_id
    || row.workspace_type !== event.workspace_type
    || row.operator_id !== event.operator_id
    || (row.approved_by || null) !== (event.approved_by || null)
    || row.event_name !== event.event_name
    || Number(row.event_sequence) !== event.event_sequence) {
    throw new PublicWebCanaryAuditPersistenceError('CORRUPT_ROW', 'audit_row_identity_mismatch');
  }
  return Object.freeze({
    event_id: record.event_id,
    event_digest: record.event_digest,
    contract_version: record.contract_version,
    event,
    created_at: row.created_at || null
  });
}

function rowValues(record) {
  const event = record.event;
  return [
    record.event_id,
    record.event_digest,
    record.contract_version,
    event.canary_session_id,
    event.trace_id,
    event.request_id,
    event.change_id,
    event.tenant_id,
    event.workspace_type,
    event.user_id || null,
    event.operator_id,
    event.approved_by || null,
    event.event_name,
    event.event_sequence,
    event.occurred_at,
    record.serialized
  ];
}

function classifyError(error) {
  if (error instanceof PublicWebCanaryAuditPersistenceError) return error;
  if (error?.code === '42P01' || error?.code === '42703') {
    return new PublicWebCanaryAuditPersistenceError('SCHEMA_MISSING', 'public_web_canary_audit_schema_missing');
  }
  return new PublicWebCanaryAuditPersistenceError('PERSISTENCE_FAILED', 'public_web_canary_audit_persistence_failed');
}

function assertReadiness(response) {
  if (!response || !Array.isArray(response.rows) || response.rows.length !== 1) {
    throw new PublicWebCanaryAuditPersistenceError('SCHEMA_INCOMPATIBLE', 'public_web_canary_audit_readiness_invalid');
  }
  for (const field of ['schema_exists', 'table_exists', 'columns_exist']) {
    if (response.rows[0][field] !== true) {
      throw new PublicWebCanaryAuditPersistenceError('SCHEMA_INCOMPATIBLE', 'public_web_canary_audit_schema_incompatible');
    }
  }
}

async function rollbackAndRelease(client, began) {
  if (!client) return;
  if (began) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
  }
  try { client.release(); } catch { /* bounded cleanup */ }
}

function createPostgresPublicWebCanaryAuditPersistence({ pool, tableName = PERSISTENT_AUDIT_TABLE } = {}) {
  requirePool(pool);
  const sql = buildSql(tableName);
  let ready = false;
  let readinessPromise = null;

  async function ensureReady() {
    if (ready) return { ok: true, status: 'READY' };
    if (!readinessPromise) {
      readinessPromise = (async () => {
        try {
          assertReadiness(await pool.query(sql.readiness));
          ready = true;
          return { ok: true, status: 'READY' };
        } catch (error) {
          throw classifyError(error);
        } finally {
          readinessPromise = null;
        }
      })();
    }
    return readinessPromise;
  }

  async function append(eventInput = {}) {
    const record = buildDurableAuditRecord(eventInput);
    if (!record.valid) return Object.freeze({ ok: false, status: 'INVALID', errors: record.errors });
    await ensureReady();

    let client = null;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      began = true;
      const inserted = await client.query(sql.insert, rowValues(record));
      if (inserted && Array.isArray(inserted.rows) && inserted.rows.length === 1) {
        const persisted = rowToRecord(inserted.rows[0]);
        await client.query('COMMIT');
        began = false;
        client.release();
        return Object.freeze({
          ok: true,
          status: 'INSERTED',
          event: persisted.event,
          receipt: createDurableAuditReceipt(record, 'INSERTED')
        });
      }

      const existingResponse = await client.query(sql.selectByIdentity, [record.event_id, record.event_digest]);
      if (!existingResponse || !Array.isArray(existingResponse.rows) || existingResponse.rows.length !== 1) {
        throw new PublicWebCanaryAuditPersistenceError('CONFLICT', 'public_web_canary_audit_identity_missing');
      }
      const existing = rowToRecord(existingResponse.rows[0]);
      await client.query('COMMIT');
      began = false;
      client.release();
      if (existing.event_digest !== record.event_digest) {
        return Object.freeze({ ok: false, status: 'CONFLICT', event: existing.event });
      }
      return Object.freeze({
        ok: true,
        status: 'REPLAY_ACCEPTED',
        event: existing.event,
        receipt: createDurableAuditReceipt(record, 'REPLAY_ACCEPTED')
      });
    } catch (error) {
      await rollbackAndRelease(client, began);
      throw classifyError(error);
    }
  }

  async function list(filters = {}) {
    await ensureReady();
    const clauses = [];
    const values = [];
    if (filters.canary_session_id) {
      values.push(filters.canary_session_id);
      clauses.push(`canary_session_id = $${values.length}`);
    }
    if (filters.tenant_id) {
      values.push(filters.tenant_id);
      clauses.push(`tenant_id = $${values.length}`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const response = await pool.query(`SELECT ${AUDIT_COLUMNS.join(', ')} FROM ${tableName}${where} ORDER BY occurred_at, event_sequence, event_id`, values);
    if (!response || !Array.isArray(response.rows)) throw new PublicWebCanaryAuditPersistenceError('READ_FAILED', 'public_web_canary_audit_list_failed');
    return response.rows.map(rowToRecord);
  }

  return Object.freeze({
    adapter_name: 'public_web_canary_audit_persistence_postgres',
    contract_version: PERSISTENT_AUDIT_CONTRACT_VERSION,
    table_name: tableName,
    schema_version: POSTGRES_SCHEMA_VERSION,
    max_event_bytes: MAX_PERSISTED_EVENT_BYTES,
    ensureReady,
    append,
    list
  });
}

module.exports = {
  AUDIT_COLUMNS,
  CONNECTION_TIMEOUT_MS,
  INSERT_SQL,
  MAX_PERSISTED_EVENT_BYTES,
  PERSISTENT_AUDIT_CONTRACT_VERSION,
  PublicWebCanaryAuditPersistenceError,
  READINESS_SQL,
  SELECT_BY_IDENTITY_SQL,
  createPostgresPublicWebCanaryAuditPersistence,
  validateTableName
};
