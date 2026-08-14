'use strict';

const { stablePayload } = require('./agent-identity-contract');
const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const {
  createAuthorizationLifecyclePersistenceInterface,
  createDurableLifecycleReceipt,
  validateDurableLifecycleEntry
} = require('./hermes-vps-durable-authorization-lifecycle-registry');

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 60000;
const DEFAULT_POOL_MAX = 4;

const SELECT_SQL = `SELECT authorization_id, authorization_payload, authorization_hash,
  provisioning_plan_version, provisioning_plan_hash, execution_scope, state,
  sequence, revision, consumption_reference, revocation_reference, fingerprint,
  receipt_reference, receipt_hash, created_at, updated_at
FROM hermes.authorization_lifecycle
WHERE authorization_id = $1`;

const SELECT_FOR_UPDATE_SQL = `${SELECT_SQL} FOR UPDATE`;

const INSERT_SQL = `INSERT INTO hermes.authorization_lifecycle
  (authorization_id, authorization_payload, authorization_hash,
   provisioning_plan_version, provisioning_plan_hash, execution_scope, state,
   sequence, revision, consumption_reference, revocation_reference, fingerprint,
   receipt_reference, receipt_hash)
VALUES ($1, $2::jsonb, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11::jsonb,
        $12, $13, $14)
ON CONFLICT (authorization_id) DO NOTHING
RETURNING authorization_id, authorization_payload, authorization_hash,
  provisioning_plan_version, provisioning_plan_hash, execution_scope, state,
  sequence, revision, consumption_reference, revocation_reference, fingerprint,
  receipt_reference, receipt_hash, created_at, updated_at`;

const UPDATE_SQL = `UPDATE hermes.authorization_lifecycle
SET state = $2, sequence = $3, revision = $4, consumption_reference = $5::jsonb,
    revocation_reference = $6::jsonb, fingerprint = $7, receipt_reference = $8,
    receipt_hash = $9, updated_at = CURRENT_TIMESTAMP
WHERE authorization_id = $1 AND state = 'REGISTERED' AND fingerprint = $10
  AND revision = $11
RETURNING authorization_id, authorization_payload, authorization_hash,
  provisioning_plan_version, provisioning_plan_hash, execution_scope, state,
  sequence, revision, consumption_reference, revocation_reference, fingerprint,
  receipt_reference, receipt_hash, created_at, updated_at`;

const RETRYABLE_CODES = new Set(['40001', '40P01']);

function result(value) {
  return Object.freeze({ ...value });
}

function jsonValue(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJsonValue(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') throw new Error(`malformed_${field}`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`malformed_${field}`);
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function storedInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`malformed_${field}`);
  return number;
}

function transitionFor(entry) {
  if (entry.state === 'CONSUMED') return { event: 'CONSUME', referenceId: entry.consumption_reference.reference_id };
  if (entry.state === 'REVOKED') return { event: 'REVOKE', referenceId: entry.revocation_reference.reference_id };
  return { event: 'REGISTER', referenceId: null };
}

function rowToRecord(row, provisioning_plan) {
  if (!isPlainObject(row)) throw new Error('malformed_row');
  const entry = {
    authorization_id: row.authorization_id,
    authorization: parseJsonValue(row.authorization_payload, 'authorization_payload'),
    state: row.state,
    sequence: storedInteger(row.sequence, 'sequence'),
    consumption_reference: parseJsonValue(row.consumption_reference, 'consumption_reference'),
    revocation_reference: parseJsonValue(row.revocation_reference, 'revocation_reference'),
    fingerprint: row.fingerprint
  };
  if (!validateDurableLifecycleEntry(entry, provisioning_plan)) throw new Error('malformed_row');
  if (row.authorization_hash !== entry.authorization.authorization_hash) throw new Error('malformed_authorization_hash');
  if (row.provisioning_plan_version !== entry.authorization.provisioning_plan_reference.plan_version) throw new Error('malformed_plan_version');
  if (row.provisioning_plan_hash !== entry.authorization.provisioning_plan_hash) throw new Error('malformed_plan_hash');
  const transition = transitionFor(entry);
  const receipt = createDurableLifecycleReceipt(entry, transition.event, transition.referenceId);
  if (row.receipt_reference !== receipt.receipt_reference || row.receipt_hash !== receipt.receipt_hash) throw new Error('malformed_receipt');
  if (row.revision !== undefined) storedInteger(row.revision, 'revision');
  return { entry, receipt };
}

function sameImmutableIdentity(left, right) {
  return left.authorization_id === right.authorization_id
    && stablePayload(left.authorization) === stablePayload(right.authorization);
}

function retryable(error) {
  return Boolean(error && RETRYABLE_CODES.has(error.code));
}

function failureFor(operation, error) {
  if (error && error.message === 'unknown_commit_outcome') return 'WRITE_FAILED';
  if (operation === 'read') return 'READ_FAILED';
  if (operation === 'insert' || operation === 'revoke') return 'WRITE_FAILED';
  return 'ATOMICITY_FAILED';
}

async function rollbackAndRelease(client, began) {
  if (!client) return;
  if (began) {
    try { await client.query('ROLLBACK'); } catch { /* fail closed; original error wins */ }
  }
  try { client.release(); } catch { /* release is best effort after failure */ }
}

async function transaction(pool, operation, maxRetries, work) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let client;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      began = true;
      const value = await work(client);
      try {
        await client.query('COMMIT');
      } catch (error) {
        try { client.release(); } catch { /* unknown commit outcome remains fail closed */ }
        return result({ ok: false, status: 'WRITE_FAILED', error: 'unknown_commit_outcome' });
      }
      client.release();
      return value;
    } catch (error) {
      await rollbackAndRelease(client, began);
      if (retryable(error) && attempt < maxRetries) continue;
      return result({ ok: false, status: failureFor(operation, error), error: error?.message || 'storage_failure' });
    }
  }
  return result({ ok: false, status: failureFor(operation), error: 'retry_exhausted' });
}

function validateAdapterInputs({ pool, provisioning_plan }) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') throw new Error('postgres_pool_invalid');
  if (!provisioning_plan || !isPlainObject(provisioning_plan)) throw new Error('provisioning_plan_required');
}

function createPostgresHermesVpsAuthorizationLifecyclePersistence({ pool, provisioning_plan, max_retries = DEFAULT_MAX_RETRIES }) {
  validateAdapterInputs({ pool, provisioning_plan });
  const maxRetries = Number.isInteger(max_retries) && max_retries >= 0 ? max_retries : DEFAULT_MAX_RETRIES;

  const adapter = createAuthorizationLifecyclePersistenceInterface({
    read: async (authorizationId) => {
      if (!isNonEmptyString(authorizationId)) return result({ ok: false, status: 'READ_FAILED', error: 'authorization_id_required' });
      try {
        const response = await pool.query(SELECT_SQL, [authorizationId]);
        if (!response || !Array.isArray(response.rows)) return result({ ok: false, status: 'READ_FAILED', error: 'malformed_query_result' });
        if (response.rows.length === 0) return result({ ok: true, status: 'READ', entry: null, receipt: null });
        const record = rowToRecord(response.rows[0], provisioning_plan);
        return result({ ok: true, status: 'READ', entry: record.entry, receipt: record.receipt });
      } catch (error) {
        return result({ ok: false, status: 'READ_FAILED', error: error?.message || 'read_failed' });
      }
    },

    insert: (entry, persistedReceipt) => transaction(pool, 'insert', maxRetries, async (client) => {
      if (!validateDurableLifecycleEntry(entry, provisioning_plan) || !isPlainObject(persistedReceipt)) return result({ ok: false, status: 'WRITE_FAILED', error: 'invalid_insert' });
      const expected = createDurableLifecycleReceipt(entry, 'REGISTER', null);
      if (stablePayload(expected) !== stablePayload(persistedReceipt)) return result({ ok: false, status: 'CONFLICT', error: 'receipt_mismatch' });
      const inserted = await client.query(INSERT_SQL, [
        entry.authorization_id,
        jsonValue(entry.authorization),
        entry.authorization.authorization_hash,
        entry.authorization.provisioning_plan_reference.plan_version,
        entry.authorization.provisioning_plan_hash,
        jsonValue(entry.authorization.execution_scope),
        entry.state,
        entry.sequence,
        0,
        jsonValue(entry.consumption_reference),
        jsonValue(entry.revocation_reference),
        entry.fingerprint,
        persistedReceipt.receipt_reference,
        persistedReceipt.receipt_hash
      ]);
      if (inserted.rows.length > 0) {
        const record = rowToRecord(inserted.rows[0], provisioning_plan);
        return result({ ok: true, status: 'INSERTED', entry: record.entry, receipt: record.receipt });
      }
      const existing = await client.query(SELECT_FOR_UPDATE_SQL, [entry.authorization_id]);
      if (!existing.rows || existing.rows.length !== 1) return result({ ok: false, status: 'WRITE_FAILED', error: 'conflict_record_missing' });
      const record = rowToRecord(existing.rows[0], provisioning_plan);
      return result({ ok: false, status: 'CONFLICT', entry: record.entry, receipt: record.receipt, error: 'authorization_id_already_exists' });
    }),

    compareAndConsume: (authorizationId, expectedFingerprint, consumedEntry, persistedReceipt) => transition(
      pool, 'compareAndConsume', maxRetries, authorizationId, expectedFingerprint, consumedEntry, persistedReceipt, provisioning_plan
    ),

    revoke: (authorizationId, expectedFingerprint, revokedEntry, persistedReceipt) => transition(
      pool, 'revoke', maxRetries, authorizationId, expectedFingerprint, revokedEntry, persistedReceipt, provisioning_plan
    )
  });

  return Object.freeze({ ...adapter, pool });
}

async function transition(pool, operation, maxRetries, authorizationId, expectedFingerprint, nextEntry, persistedReceipt, provisioning_plan) {
  return transaction(pool, operation, maxRetries, async (client) => {
    const requiredState = operation === 'compareAndConsume' ? 'CONSUMED' : 'REVOKED';
    if (!isNonEmptyString(authorizationId) || !isNonEmptyString(expectedFingerprint) || nextEntry?.state !== requiredState || !validateDurableLifecycleEntry(nextEntry, provisioning_plan) || !isPlainObject(persistedReceipt)) return result({ ok: false, status: 'CONFLICT', error: 'invalid_transition' });
    const currentResponse = await client.query(SELECT_FOR_UPDATE_SQL, [authorizationId]);
    if (!currentResponse.rows || currentResponse.rows.length === 0) return result({ ok: false, status: 'NOT_AUTHORIZED' });
    const current = rowToRecord(currentResponse.rows[0], provisioning_plan);
    if (!sameImmutableIdentity(current.entry, nextEntry) || current.entry.fingerprint !== expectedFingerprint || current.entry.state !== 'REGISTERED') return result({ ok: false, status: 'CONFLICT', entry: current.entry, receipt: current.receipt });
    const expectedEvent = operation === 'compareAndConsume' ? 'CONSUME' : 'REVOKE';
    const expectedReference = operation === 'compareAndConsume' ? nextEntry.consumption_reference?.reference_id : nextEntry.revocation_reference?.reference_id;
    const expectedReceipt = createDurableLifecycleReceipt(nextEntry, expectedEvent, expectedReference);
    if (stablePayload(expectedReceipt) !== stablePayload(persistedReceipt)) return result({ ok: false, status: 'CONFLICT', entry: current.entry, receipt: current.receipt, error: 'receipt_mismatch' });
    const currentRevision = storedInteger(currentResponse.rows[0].revision, 'revision');
    const updated = await client.query(UPDATE_SQL, [
      authorizationId,
      nextEntry.state,
      nextEntry.sequence,
      currentRevision + 1,
      jsonValue(nextEntry.consumption_reference),
      jsonValue(nextEntry.revocation_reference),
      nextEntry.fingerprint,
      persistedReceipt.receipt_reference,
      persistedReceipt.receipt_hash,
      expectedFingerprint,
      currentRevision
    ]);
    if (!updated.rows || updated.rows.length !== 1) return result({ ok: false, status: 'CONFLICT', entry: current.entry, receipt: current.receipt, error: 'stale_transition' });
    const record = rowToRecord(updated.rows[0], provisioning_plan);
    return result({ ok: true, status: operation === 'compareAndConsume' ? 'CONSUMED' : 'REVOKED', entry: record.entry, receipt: record.receipt });
  });
}

function createPostgresHermesVpsAuthorizationLifecyclePersistenceFromEnv({ env = process.env, PoolClass } = {}) {
  if (typeof window !== 'undefined') throw new Error('server_side_only');
  const connectionString = env.HERMES_DURABLE_DATABASE_URL;
  if (!isNonEmptyString(connectionString)) throw new Error('hermes_durable_database_configuration_missing');
  const ResolvedPool = PoolClass || require('pg').Pool;
  const pool = new ResolvedPool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: positiveInteger(env.HERMES_DURABLE_DATABASE_POOL_MAX, DEFAULT_POOL_MAX),
    connectionTimeoutMillis: positiveInteger(env.HERMES_DURABLE_DATABASE_CONNECTION_TIMEOUT_MS, DEFAULT_CONNECTION_TIMEOUT_MS),
    idleTimeoutMillis: positiveInteger(env.HERMES_DURABLE_DATABASE_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
    statement_timeout: positiveInteger(env.HERMES_DURABLE_DATABASE_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS)
  });
  return Object.freeze({ pool, create: (provisioning_plan, options = {}) => createPostgresHermesVpsAuthorizationLifecyclePersistence({ pool, provisioning_plan, ...options }), close: () => pool.end() });
}

module.exports = {
  DEFAULT_MAX_RETRIES,
  INSERT_SQL,
  SELECT_FOR_UPDATE_SQL,
  SELECT_SQL,
  UPDATE_SQL,
  createPostgresHermesVpsAuthorizationLifecyclePersistence,
  createPostgresHermesVpsAuthorizationLifecyclePersistenceFromEnv
};
