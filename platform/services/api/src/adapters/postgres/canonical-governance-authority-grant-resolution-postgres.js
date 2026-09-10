'use strict';

const {
  DEFAULT_TABLE_NAME: DEFAULT_GRANT_TABLE_NAME,
  ROW_FIELDS: GRANT_ROW_FIELDS,
  parseRow: parseGrantRow
} = require('./canonical-governance-authority-grant-persistence-postgres');
const {
  DEFAULT_TABLE_NAME: DEFAULT_REVOCATION_TABLE_NAME,
  ROW_FIELDS: REVOCATION_ROW_FIELDS,
  parseRow: parseRevocationRow
} = require('./canonical-governance-authority-grant-revocation-persistence-postgres');
const {
  rejectedResolution,
  resolveCanonicalGovernanceAuthorityGrant,
  validateResolutionLookupRequest
} = require('../../core/canonical-governance-authority-grant-resolution');

const POSTGRES_SCHEMA_VERSION = 1;
const ADAPTER_NAME = 'canonical_governance_authority_grant_resolution_postgres';
const CONNECTION_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 10000;
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function validTableName(value) {
  const parts = typeof value === 'string' ? value.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(value, errorCode) {
  if (!validTableName(value)) throw new TypeError(errorCode);
  return value;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('authority_grant_resolution_postgres_pool_invalid');
}

class AuthorityGrantResolutionPostgresError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AuthorityGrantResolutionPostgresError';
    this.code = code;
  }
}

function qualifiedTable(tableName) {
  return tableName;
}

function buildSql(grantTableName, revocationTableName) {
  const grantTable = qualifiedTable(requireTableName(grantTableName, 'authority_grant_resolution_grant_table_name_invalid'));
  const revocationTable = qualifiedTable(requireTableName(revocationTableName, 'authority_grant_resolution_revocation_table_name_invalid'));
  return {
    readiness: `
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${grantTable.split('.')[0]}' AND table_name = '${grantTable.split('.')[1]}') AS grant_table_exists,
  (SELECT count(*) = ${GRANT_ROW_FIELDS.length} FROM information_schema.columns WHERE table_schema = '${grantTable.split('.')[0]}' AND table_name = '${grantTable.split('.')[1]}') AS grant_columns_exact,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = '${grantTable.split('.')[0]}' AND r.relname = '${grantTable.split('.')[1]}' AND c.conname = 'governance_authority_grants_pkey') AS grant_primary_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = '${grantTable.split('.')[0]}' AND r.relname = '${grantTable.split('.')[1]}' AND c.conname = 'governance_authority_grants_grant_digest_key') AS grant_digest_unique_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${revocationTable.split('.')[0]}' AND table_name = '${revocationTable.split('.')[1]}') AS revocation_table_exists,
  (SELECT count(*) = ${REVOCATION_ROW_FIELDS.length} FROM information_schema.columns WHERE table_schema = '${revocationTable.split('.')[0]}' AND table_name = '${revocationTable.split('.')[1]}') AS revocation_columns_exact,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = '${revocationTable.split('.')[0]}' AND r.relname = '${revocationTable.split('.')[1]}' AND c.conname = 'governance_authority_grant_revocations_pkey') AS revocation_primary_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = '${revocationTable.split('.')[0]}' AND r.relname = '${revocationTable.split('.')[1]}' AND c.conname = 'governance_authority_grant_revocations_revocation_digest_key') AS revocation_digest_unique_exists`,
    readGrant: `SELECT ${GRANT_ROW_FIELDS.join(', ')} FROM ${grantTable} WHERE authority_grant_id = $1`,
    readRevocations: `SELECT ${REVOCATION_ROW_FIELDS.join(', ')} FROM ${revocationTable} WHERE installation_id = $1 AND target_authority_grant_id = $2 ORDER BY revocation_digest ASC`
  };
}

function timeoutError(message) {
  return new AuthorityGrantResolutionPostgresError('TIMEOUT', message);
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
  return awaitWithTimeout(operation, STATEMENT_TIMEOUT_MS, timeoutError('postgres_read_timeout'));
}

async function rollbackAndRelease(client, began, released) {
  if (!client) return;
  if (began) {
    try { await queryWithTimeout(client, 'ROLLBACK'); } catch { /* preserve fail-closed result */ }
  }
  if (!released) {
    try { client.release(); } catch { /* bounded cleanup */ }
  }
}

function classifyError(error) {
  if (error instanceof AuthorityGrantResolutionPostgresError) return error;
  if (error?.code === '42P01' || error?.code === '42703') {
    return new AuthorityGrantResolutionPostgresError('SCHEMA_MISSING', 'postgres_schema_missing');
  }
  if (error?.code === '57014' || error?.code === 'TIMEOUT') {
    return new AuthorityGrantResolutionPostgresError('TIMEOUT', 'postgres_read_timeout');
  }
  return new AuthorityGrantResolutionPostgresError('DATABASE_READ_FAILED', 'postgres_read_failed');
}

function assertReadOnly(response) {
  if (!response?.rows || response.rows.length !== 1 || response.rows[0].transaction_read_only !== 'on') {
    throw new AuthorityGrantResolutionPostgresError('READ_ONLY_REQUIRED', 'postgres_transaction_not_read_only');
  }
}

function assertReadiness(response) {
  const fields = [
    'grant_table_exists', 'grant_columns_exact', 'grant_primary_key_exists', 'grant_digest_unique_exists',
    'revocation_table_exists', 'revocation_columns_exact', 'revocation_primary_key_exists',
    'revocation_digest_unique_exists'
  ];
  if (!response?.rows || response.rows.length !== 1 || fields.some((field) => response.rows[0][field] !== true)) {
    throw new AuthorityGrantResolutionPostgresError('SCHEMA_INCOMPATIBLE', 'postgres_schema_incompatible');
  }
}

function invalidInputResult(request) {
  const validation = validateResolutionLookupRequest(request);
  return rejectedResolution(request, 'invalid_resolution_input', validation.errors);
}

function createCanonicalGovernanceAuthorityGrantResolutionPostgres({
  pool,
  grantTableName = DEFAULT_GRANT_TABLE_NAME,
  revocationTableName = DEFAULT_REVOCATION_TABLE_NAME
} = {}) {
  requirePool(pool);
  const sql = buildSql(grantTableName, revocationTableName);

  async function resolveAuthorityGrant(request = {}) {
    const inputValidation = validateResolutionLookupRequest(request);
    if (!inputValidation.valid) return invalidInputResult(request);

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
      await queryWithTimeout(client, 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      began = true;
      await queryWithTimeout(client, `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      assertReadOnly(await queryWithTimeout(client, 'SHOW transaction_read_only'));
      assertReadiness(await queryWithTimeout(client, sql.readiness));

      const grantResponse = await queryWithTimeout(client, sql.readGrant, [request.authority_grant_id]);
      if (!grantResponse?.rows || grantResponse.rows.length > 1) {
        throw new AuthorityGrantResolutionPostgresError('STATE_AMBIGUOUS', 'grant_row_ambiguous');
      }
      if (grantResponse.rows.length === 0) {
        const result = resolveCanonicalGovernanceAuthorityGrant({ ...request, grant: null, revocations: [] });
        await queryWithTimeout(client, 'COMMIT');
        began = false;
        releaseClient();
        return result;
      }

      let grant;
      try {
        grant = parseGrantRow(grantResponse.rows[0]);
      } catch {
        throw new AuthorityGrantResolutionPostgresError('CORRUPT_GRANT_EVIDENCE', 'corrupt_grant_evidence');
      }

      const revocationResponse = await queryWithTimeout(client, sql.readRevocations, [
        request.installation_id,
        request.authority_grant_id
      ]);
      if (!revocationResponse?.rows) {
        throw new AuthorityGrantResolutionPostgresError('DATABASE_READ_FAILED', 'revocation_read_failed');
      }
      const revocations = [];
      for (const row of revocationResponse.rows) {
        try {
          revocations.push(parseRevocationRow(row));
        } catch {
          throw new AuthorityGrantResolutionPostgresError('CORRUPT_REVOCATION_EVIDENCE', 'corrupt_revocation_evidence');
        }
      }

      const result = resolveCanonicalGovernanceAuthorityGrant({ ...request, grant, revocations });
      await queryWithTimeout(client, 'COMMIT');
      began = false;
      releaseClient();
      return result;
    } catch (error) {
      const classified = classifyError(error);
      await rollbackAndRelease(client, began, released);
      const reasonCode = classified.code === 'CORRUPT_GRANT_EVIDENCE'
        ? 'grant_evidence_invalid'
        : classified.code === 'CORRUPT_REVOCATION_EVIDENCE'
          ? 'revocation_evidence_invalid'
          : ['STATE_AMBIGUOUS', 'SCHEMA_INCOMPATIBLE', 'READ_ONLY_REQUIRED'].includes(classified.code)
            ? 'state_ambiguous'
            : 'database_read_failed';
      return rejectedResolution(request, reasonCode, [classified.code.toLowerCase()]);
    } finally {
      if (client && !released) {
        try { client.release(); } catch { /* bounded cleanup */ }
      }
    }
  }

  return Object.freeze({
    adapter_name: ADAPTER_NAME,
    grant_table_name: grantTableName,
    revocation_table_name: revocationTableName,
    schema_version: POSTGRES_SCHEMA_VERSION,
    resolveAuthorityGrant,
    resolve: resolveAuthorityGrant
  });
}

const DEFAULT_SQL = buildSql(DEFAULT_GRANT_TABLE_NAME, DEFAULT_REVOCATION_TABLE_NAME);

module.exports = {
  ADAPTER_NAME,
  CONNECTION_TIMEOUT_MS,
  DEFAULT_GRANT_TABLE_NAME,
  DEFAULT_REVOCATION_TABLE_NAME,
  GRANT_READ_SQL: DEFAULT_SQL.readGrant,
  REVOCATION_READ_SQL: DEFAULT_SQL.readRevocations,
  READINESS_SQL: DEFAULT_SQL.readiness,
  POSTGRES_SCHEMA_VERSION,
  STATEMENT_TIMEOUT_MS,
  AuthorityGrantResolutionPostgresError,
  createCanonicalGovernanceAuthorityGrantResolutionPostgres,
  validTableName
};
