'use strict';

const { cloneFrozen, stablePayload } = require('../../core/agent-identity-contract');
const {
  AUTHORITY_GRANT_REVOCATION_FIELDS,
  authorityGrantRevocationDigest,
  validateAuthorityGrantRevocation
} = require('../../core/canonical-governance-authority-grant-revocation-contract');

const POSTGRES_SCHEMA_VERSION = 1;
const PERSISTENCE_CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_AUTHORITY_GRANT_REVOCATION_PERSISTENCE';
const PERSISTENCE_CONTRACT_VERSION = 'hermes_canonical_governance_authority_grant_revocation_persistence_v1';
const CONNECTION_TIMEOUT_MS = 5000;
const LOCK_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 10000;
const DEFAULT_TABLE_NAME = 'hermes.governance_authority_grant_revocations';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const ROW_FIELDS = Object.freeze([
  ...AUTHORITY_GRANT_REVOCATION_FIELDS.filter((field) => field !== 'revocation_digest'),
  'revocation_digest', 'created_at'
]);
const RESULT_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'outcome', 'authority_grant_revocation_id',
  'revocation_digest', 'persisted_revocation', 'write_performed', 'reason_code'
]);
const SELECT_COLUMNS = ROW_FIELDS.join(', ');

function validateTableName(tableName) {
  if (typeof tableName !== 'string') return false;
  const parts = tableName.split('.');
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('authority_grant_revocation_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('authority_grant_revocation_postgres_pool_invalid');
  }
}

class AuthorityGrantRevocationPostgresPersistenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AuthorityGrantRevocationPostgresPersistenceError';
    this.code = code;
  }
}

function parseJson(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { throw new AuthorityGrantRevocationPostgresPersistenceError('CORRUPT_ROW', 'jsonb_invalid'); }
  }
  return value;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function buildSql(tableName) {
  const [schemaName, relationName] = requireTableName(tableName).split('.');
  const qualified = `${schemaName}.${relationName}`;
  return {
    insert: `INSERT INTO ${qualified} (
  authority_grant_revocation_id, contract_version, revocation_domain, installation_id,
  target_authority_grant_id, target_grant_digest,
  issuer_root_subject_id, issuer_root_generation, issuer_root_digest,
  issuer_root_key_id, issuer_root_key_fingerprint, issuer_root_key_digest,
  reason_code, issued_at, effective_at, revocation_digest
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT DO NOTHING
RETURNING ${SELECT_COLUMNS}`,
    selectByIdentity: `SELECT ${SELECT_COLUMNS}
FROM ${qualified}
WHERE authority_grant_revocation_id = $1 OR revocation_digest = $2
FOR UPDATE`,
    readiness: `
SELECT
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = '${schemaName}') AS schema_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_name = '${relationName}') AS table_exists,
  (
    SELECT count(*) = 17
    FROM information_schema.columns
    WHERE table_schema = '${schemaName}' AND table_name = '${relationName}'
  ) AS columns_exist,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}' AND c.conname = 'governance_authority_grant_revocations_pkey') AS primary_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}' AND c.conname = 'governance_authority_grant_revocations_revocation_digest_key') AS digest_unique_exists,
  EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}'
      AND NOT t.tgisinternal AND t.tgname = 'governance_authority_grant_revocations_mutation_trigger') AS mutation_trigger_exists`
  };
}

const DEFAULT_SQL = buildSql(DEFAULT_TABLE_NAME);
const INSERT_SQL = DEFAULT_SQL.insert;
const READINESS_SQL = DEFAULT_SQL.readiness;
const SELECT_BY_ID_OR_DIGEST_SQL = DEFAULT_SQL.selectByIdentity;

function resultFor(outcome, candidate, persistedRevocation, writePerformed, reasonCode) {
  return Object.freeze({
    contract_name: PERSISTENCE_CONTRACT_NAME,
    contract_version: PERSISTENCE_CONTRACT_VERSION,
    outcome,
    authority_grant_revocation_id: persistedRevocation?.authority_grant_revocation_id
      || candidate?.authority_grant_revocation_id || null,
    revocation_digest: persistedRevocation?.revocation_digest || candidate?.revocation_digest || null,
    persisted_revocation: persistedRevocation || null,
    write_performed: writePerformed,
    reason_code: reasonCode
  });
}

function parseRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new AuthorityGrantRevocationPostgresPersistenceError('CORRUPT_ROW', 'row_invalid');
  }
  const revocation = {
    contract_version: row.contract_version,
    revocation_domain: row.revocation_domain,
    authority_grant_revocation_id: row.authority_grant_revocation_id,
    installation_id: row.installation_id,
    target_authority_grant_id: row.target_authority_grant_id,
    target_grant_digest: row.target_grant_digest,
    issuer_root_subject_id: row.issuer_root_subject_id,
    issuer_root_generation: Number(row.issuer_root_generation),
    issuer_root_digest: row.issuer_root_digest,
    issuer_root_key_id: row.issuer_root_key_id,
    issuer_root_key_fingerprint: row.issuer_root_key_fingerprint,
    issuer_root_key_digest: row.issuer_root_key_digest,
    reason_code: row.reason_code,
    issued_at: iso(row.issued_at),
    effective_at: iso(row.effective_at),
    revocation_digest: row.revocation_digest
  };
  const validation = validateAuthorityGrantRevocation(revocation);
  if (!validation.valid) {
    throw new AuthorityGrantRevocationPostgresPersistenceError('CORRUPT_ROW', 'authority_grant_revocation_invalid');
  }
  return cloneFrozen(revocation);
}

function sameCanonicalRevocation(left, right) {
  return stablePayload(left) === stablePayload(right)
    && authorityGrantRevocationDigest(left) === authorityGrantRevocationDigest(right);
}

function rowValues(revocation) {
  return [
    revocation.authority_grant_revocation_id, revocation.contract_version, revocation.revocation_domain,
    revocation.installation_id, revocation.target_authority_grant_id, revocation.target_grant_digest,
    revocation.issuer_root_subject_id, revocation.issuer_root_generation, revocation.issuer_root_digest,
    revocation.issuer_root_key_id, revocation.issuer_root_key_fingerprint, revocation.issuer_root_key_digest,
    revocation.reason_code, revocation.issued_at, revocation.effective_at, revocation.revocation_digest
  ];
}

function timeoutError(message) {
  return new AuthorityGrantRevocationPostgresPersistenceError('TIMEOUT', message);
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
    try { await queryWithTimeout(client, 'ROLLBACK'); } catch { /* preserve original error */ }
  }
  if (!released) {
    try { client.release(); } catch { /* bounded cleanup */ }
  }
}

async function commitOrFail(client) {
  try {
    await queryWithTimeout(client, 'COMMIT');
  } catch {
    throw new AuthorityGrantRevocationPostgresPersistenceError('UNKNOWN_COMMIT_OUTCOME', 'postgres_commit_outcome_unknown');
  }
}

function classifyError(error) {
  if (error instanceof AuthorityGrantRevocationPostgresPersistenceError) return error;
  if (error?.code === '42P01' || error?.code === '42703') {
    return new AuthorityGrantRevocationPostgresPersistenceError('SCHEMA_MISSING', 'postgres_schema_missing');
  }
  if (error?.code === '55P03' || error?.code === '57014' || error?.code === 'TIMEOUT') {
    return new AuthorityGrantRevocationPostgresPersistenceError('TIMEOUT', 'postgres_timeout');
  }
  if (error?.code === '40001' || error?.code === '40P01') {
    return new AuthorityGrantRevocationPostgresPersistenceError('RETRYABLE_FAILURE', 'postgres_retryable_failure');
  }
  return new AuthorityGrantRevocationPostgresPersistenceError('POSTGRES_PERSISTENCE_FAILED', 'postgres_persistence_failed');
}

function assertSchemaReadiness(response) {
  const fields = ['schema_exists', 'table_exists', 'columns_exist', 'primary_key_exists', 'digest_unique_exists', 'mutation_trigger_exists'];
  if (!response?.rows || response.rows.length !== 1 || fields.some((field) => response.rows[0][field] !== true)) {
    throw new AuthorityGrantRevocationPostgresPersistenceError('SCHEMA_INCOMPATIBLE', 'postgres_schema_incompatible');
  }
}

function createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres({
  pool,
  tableName = DEFAULT_TABLE_NAME
} = {}) {
  requirePool(pool);
  const sql = buildSql(tableName);
  let ready = false;
  let readinessPromise = null;

  async function ensureReady() {
    if (ready) return;
    if (!readinessPromise) {
      readinessPromise = (async () => {
        try {
          const response = await awaitWithTimeout(pool.query(sql.readiness), STATEMENT_TIMEOUT_MS, timeoutError('postgres_readiness_timeout'));
          assertSchemaReadiness(response);
          ready = true;
        } catch (error) {
          throw classifyError(error);
        } finally {
          readinessPromise = null;
        }
      })();
    }
    return readinessPromise;
  }

  async function persistAuthorityGrantRevocation(candidate) {
    const validation = validateAuthorityGrantRevocation(candidate);
    if (!validation.valid) {
      return {
        persistence_result: resultFor('REJECTED', candidate, null, false, 'invalid_canonical_authority_grant_revocation'),
        validation_errors: validation.errors
      };
    }

    await ensureReady();
    let client = null;
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

      const inserted = await queryWithTimeout(client, sql.insert, rowValues(candidate));
      if (inserted?.rows?.length === 1) {
        const persisted = parseRow(inserted.rows[0]);
        if (!sameCanonicalRevocation(candidate, persisted)) {
          throw new AuthorityGrantRevocationPostgresPersistenceError('CORRUPT_ROW', 'inserted_revocation_mismatch');
        }
        await commitOrFail(client);
        began = false;
        releaseClient();
        return { persistence_result: resultFor('PERSISTED', candidate, persisted, true, 'persisted_canonical_revocation') };
      }

      const existingResponse = await queryWithTimeout(
        client,
        sql.selectByIdentity,
        [candidate.authority_grant_revocation_id, candidate.revocation_digest]
      );
      if (!existingResponse?.rows || existingResponse.rows.length !== 1) {
        throw new AuthorityGrantRevocationPostgresPersistenceError('STORAGE_INCONSISTENT', 'conflict_record_missing_or_ambiguous');
      }
      const existing = parseRow(existingResponse.rows[0]);
      const identical = sameCanonicalRevocation(candidate, existing);
      await commitOrFail(client);
      began = false;
      releaseClient();
      return {
        persistence_result: resultFor(
          identical ? 'ALREADY_PERSISTED_IDENTICAL' : 'REJECTED',
          candidate,
          existing,
          false,
          identical ? 'identical_canonical_replay' : 'authority_grant_revocation_identity_conflict'
        )
      };
    } catch (error) {
      const classified = classifyError(error);
      await rollbackAndRelease(client, began, released);
      throw classified;
    }
  }

  return Object.freeze({
    adapter_name: 'canonical_governance_authority_grant_revocation_persistence_postgres',
    table_name: tableName,
    schema_version: POSTGRES_SCHEMA_VERSION,
    persistAuthorityGrantRevocation
  });
}

module.exports = {
  AUTHORITY_GRANT_REVOCATION_FIELDS,
  CONNECTION_TIMEOUT_MS,
  DEFAULT_TABLE_NAME,
  INSERT_SQL,
  LOCK_TIMEOUT_MS,
  PERSISTENCE_CONTRACT_NAME,
  PERSISTENCE_CONTRACT_VERSION,
  POSTGRES_SCHEMA_VERSION,
  READINESS_SQL,
  RESULT_FIELDS,
  ROW_FIELDS,
  SELECT_BY_ID_OR_DIGEST_SQL,
  STATEMENT_TIMEOUT_MS,
  AuthorityGrantRevocationPostgresPersistenceError,
  createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres,
  parseRow,
  rowValues,
  sameCanonicalRevocation
};
