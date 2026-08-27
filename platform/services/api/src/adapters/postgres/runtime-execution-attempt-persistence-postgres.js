'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('../../core/agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('../../core/canonical-content-digest');
const {
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
  validateRuntimeExecutionAttemptDurableRecord
} = require('../../core/runtime-execution-attempt-durable-record');

const POSTGRES_SCHEMA_VERSION = 1;
const PERSISTENCE_CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_DURABLE_PERSISTENCE';
const PERSISTENCE_CONTRACT_VERSION = 'runtime_execution_attempt_durable_persistence_v1';
const PERSISTENCE_PROOF_CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_POSTGRES_PERSISTENCE_PROOF';
const PERSISTENCE_PROOF_CONTRACT_VERSION = 'runtime_execution_attempt_postgres_persistence_proof_v1';
const CONNECTION_TIMEOUT_MS = 5000;
const LOCK_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 10000;
const DEFAULT_TABLE_NAME = 'hermes.execution_attempts';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SUPPORTED_LIFECYCLE = Object.freeze({
  PREPARED: Object.freeze({ revision: 1, attempt_admitted: false }),
  ADMITTED: Object.freeze({ revision: 2, attempt_admitted: true })
});

const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const ROW_FIELDS = Object.freeze([
  'attempt_durable_record_id',
  'durable_job_reference_id',
  'materialization_reference_id',
  'materialization_reference_fingerprint',
  'materialization_reference_digest',
  'attempt_intent_reference_id',
  'attempt_intent_reference_fingerprint',
  'attempt_intent_reference_digest',
  ...IDENTITY_SCOPE_FIELDS,
  'logical_job_identity_digest',
  'admission_reference_id',
  'attempt_ordinal',
  'state',
  'revision',
  'contract_version',
  'schema_version',
  'durable_record_fingerprint',
  'durable_record_digest',
  'durable_record',
  'created_at',
  'updated_at'
]);
const RESULT_FIELDS = Object.freeze([
  'contract_name',
  'contract_version',
  'outcome',
  'attempt_durable_record_id',
  'durable_record_fingerprint',
  'durable_record_digest',
  'state',
  'revision',
  'reason_code',
  'attempt_created',
  'attempt_persisted',
  'attempt_admitted',
  'persistence_real',
  'execution_simulation',
  'production_execution_blocked',
  'claim_issued',
  'lease_granted',
  'fencing_token_issued',
  'worker_ownership_established',
  'executor_ownership_established',
  'execution_authorized',
  'execution_started',
  'execution_performed',
  'provider_call_allowed',
  'provider_called',
  'network_call_allowed',
  'network_used',
  'secrets_materialized',
  'external_effect_allowed',
  'external_effect_performed'
]);
const PROOF_FIELDS = Object.freeze([
  'contract_name',
  'contract_version',
  'backend',
  'schema_version',
  'canonical_record_persisted',
  'write_performed',
  'candidate_semantics_persisted',
  'persistence_outcome',
  'attempt_durable_record_id',
  'durable_record_fingerprint',
  'durable_record_digest',
  'fingerprint',
  'digest'
]);

const SELECT_COLUMNS = ROW_FIELDS.join(', ');
function validateTableName(tableName) {
  if (typeof tableName !== 'string') return false;
  const parts = tableName.split('.');
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) {
    throw new TypeError('runtime_execution_attempt_postgres_table_name_invalid');
  }
  return tableName;
}

function lifecycleFor(state, revision) {
  const expected = SUPPORTED_LIFECYCLE[state];
  if (!expected || Number(revision) !== expected.revision) {
    throw new RuntimeExecutionAttemptPostgresPersistenceError(
      'CORRUPT_ROW',
      'unsupported_execution_attempt_lifecycle'
    );
  }
  return { state, revision: expected.revision, attempt_admitted: expected.attempt_admitted };
}

function deriveAttemptAdmittedFromLifecycle(state, revision) {
  return lifecycleFor(state, revision).attempt_admitted;
}

function buildSql(tableName) {
  const [schemaName, relationName] = requireTableName(tableName).split('.');
  const qualifiedTableName = `${schemaName}.${relationName}`;
  return {
    insert: `INSERT INTO ${qualifiedTableName}
  (attempt_durable_record_id, durable_job_reference_id,
   materialization_reference_id, materialization_reference_fingerprint, materialization_reference_digest,
   attempt_intent_reference_id, attempt_intent_reference_fingerprint, attempt_intent_reference_digest,
   tenant_id, organization_id, project_id, session_reference_id, agent_id, actor_id,
   logical_job_identity_digest, admission_reference_id, attempt_ordinal, state, revision,
   contract_version, schema_version, durable_record_fingerprint, durable_record_digest, durable_record)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb)
ON CONFLICT DO NOTHING
RETURNING ${SELECT_COLUMNS}`,
    selectById: `SELECT ${SELECT_COLUMNS}
FROM ${qualifiedTableName}
WHERE attempt_durable_record_id = $1
FOR UPDATE`,
    selectByJobOrdinal: `SELECT ${SELECT_COLUMNS}
FROM ${qualifiedTableName}
WHERE durable_job_reference_id = $1 AND attempt_ordinal = $2
FOR UPDATE`,
    readiness: `
SELECT
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = '${schemaName}') AS schema_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_name = '${relationName}') AS table_exists,
  (
    SELECT count(*) = 26
    FROM information_schema.columns
    WHERE table_schema = '${schemaName}' AND table_name = '${relationName}'
  ) AS columns_exist,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}' AND c.conname = 'execution_attempts_pkey') AS primary_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}' AND c.conname = 'execution_attempts_job_ordinal_key') AS job_ordinal_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${schemaName}' AND r.relname = '${relationName}'
      AND c.conname IN ('execution_attempts_state_check', 'execution_attempts_lifecycle_check')) AS state_check_exists`
  };
}

const DEFAULT_SQL = buildSql(DEFAULT_TABLE_NAME);
const INSERT_SQL = DEFAULT_SQL.insert;
const SELECT_BY_ID_SQL = DEFAULT_SQL.selectById;
const SELECT_BY_JOB_ORDINAL_SQL = DEFAULT_SQL.selectByJobOrdinal;
const READINESS_SQL = DEFAULT_SQL.readiness;

class RuntimeExecutionAttemptPostgresPersistenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'RuntimeExecutionAttemptPostgresPersistenceError';
    this.code = code;
  }
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('runtime_execution_attempt_postgres_pool_invalid');
  }
}

function resultFor(outcome, record = null, reasonCode = null, lifecycle = null) {
  const created = outcome === 'CREATED';
  const persisted = outcome === 'CREATED' || outcome === 'EXISTING_IDENTICAL';
  const persistedLifecycle = record ? (lifecycle || lifecycleFor('PREPARED', 1)) : null;
  return Object.freeze({
    contract_name: PERSISTENCE_CONTRACT_NAME,
    contract_version: PERSISTENCE_CONTRACT_VERSION,
    outcome,
    attempt_durable_record_id: record?.runtime_execution_attempt_durable_record_id ?? null,
    durable_record_fingerprint: record?.runtime_execution_attempt_durable_record_fingerprint ?? null,
    durable_record_digest: record?.runtime_execution_attempt_durable_record_digest ?? null,
    state: persistedLifecycle?.state ?? null,
    revision: persistedLifecycle?.revision ?? null,
    reason_code: reasonCode,
    attempt_created: created,
    attempt_persisted: persisted,
    attempt_admitted: persistedLifecycle?.attempt_admitted ?? false,
    persistence_real: persisted,
    execution_simulation: true,
    production_execution_blocked: true,
    claim_issued: false,
    lease_granted: false,
    fencing_token_issued: false,
    worker_ownership_established: false,
    executor_ownership_established: false,
    execution_authorized: false,
    execution_started: false,
    execution_performed: false,
    provider_call_allowed: false,
    provider_called: false,
    network_call_allowed: false,
    network_used: false,
    secrets_materialized: false,
    external_effect_allowed: false,
    external_effect_performed: false
  });
}

function proofMaterial(outcome, record, writePerformed, candidateSemanticsPersisted) {
  return {
    contract_name: PERSISTENCE_PROOF_CONTRACT_NAME,
    contract_version: PERSISTENCE_PROOF_CONTRACT_VERSION,
    backend: 'postgresql',
    schema_version: POSTGRES_SCHEMA_VERSION,
    canonical_record_persisted: true,
    write_performed: writePerformed,
    candidate_semantics_persisted: candidateSemanticsPersisted,
    persistence_outcome: outcome,
    attempt_durable_record_id: record.runtime_execution_attempt_durable_record_id,
    durable_record_fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
    durable_record_digest: record.runtime_execution_attempt_durable_record_digest
  };
}

function buildPersistenceProof(outcome, record, writePerformed, candidateSemanticsPersisted) {
  const material = proofMaterial(outcome, record, writePerformed, candidateSemanticsPersisted);
  return cloneFrozen({
    ...material,
    fingerprint: stablePayload(material),
    digest: computeCanonicalContentDigest(material)
  });
}

function validatePersistenceProof(proof) {
  const errors = [];
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return { valid: false, errors: ['proof_must_be_object'] };
  exactFields(proof, PROOF_FIELDS, 'persistence_proof', errors);
  if (proof.contract_name !== PERSISTENCE_PROOF_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (proof.contract_version !== PERSISTENCE_PROOF_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (proof.backend !== 'postgresql') errors.push('backend_invalid');
  if (proof.schema_version !== POSTGRES_SCHEMA_VERSION) errors.push('schema_version_invalid');
  if (proof.canonical_record_persisted !== true) errors.push('canonical_record_not_persisted');
  if (typeof proof.write_performed !== 'boolean') errors.push('write_performed_invalid');
  if (typeof proof.candidate_semantics_persisted !== 'boolean') errors.push('candidate_semantics_persisted_invalid');
  if (!['CREATED', 'EXISTING_IDENTICAL'].includes(proof.persistence_outcome)) errors.push('persistence_outcome_invalid');
  for (const field of ['attempt_durable_record_id', 'durable_record_fingerprint']) {
    if (typeof proof[field] !== 'string' || proof[field].length === 0) errors.push(`${field}_invalid`);
  }
  if (!isCanonicalContentDigest(proof.durable_record_digest)) errors.push('durable_record_digest_invalid');
  if (typeof proof.fingerprint !== 'string' || proof.fingerprint.length === 0) errors.push('fingerprint_invalid');
  if (!isCanonicalContentDigest(proof.digest)) errors.push('digest_invalid');
  try {
    const { fingerprint, digest, ...material } = proof;
    if (stablePayload(material) !== fingerprint) errors.push('fingerprint_mismatch');
    if (computeCanonicalContentDigest(material) !== digest) errors.push('digest_mismatch');
  } catch {
    errors.push('proof_integrity_invalid');
  }
  return { valid: errors.length === 0, errors };
}

function parseRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'durable_record_invalid');
  try {
    return JSON.parse(value);
  } catch {
    throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'durable_record_invalid');
  }
}

function requireString(row, field) {
  if (typeof row[field] !== 'string' || row[field].length === 0) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', `${field}_invalid`);
}

function rowToDurableRecord(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'row_invalid');
  for (const field of ROW_FIELDS.filter((field) => !['durable_record', 'attempt_ordinal', 'revision', 'schema_version', 'created_at', 'updated_at'].includes(field))) requireString(row, field);
  if (!Number.isSafeInteger(Number(row.attempt_ordinal)) || Number(row.attempt_ordinal) < 1) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'attempt_ordinal_invalid');
  lifecycleFor(row.state, row.revision);
  if (Number(row.schema_version) !== POSTGRES_SCHEMA_VERSION) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'revision_or_schema_invalid');
  if (row.contract_version !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'state_or_contract_invalid');
  const record = parseRecord(row.durable_record);
  const pairs = [
    ['attempt_durable_record_id', record.runtime_execution_attempt_durable_record_id],
    ['durable_job_reference_id', record.durable_job_reference?.id],
    ['materialization_reference_id', record.runtime_execution_attempt_materialization_reference?.id],
    ['materialization_reference_fingerprint', record.runtime_execution_attempt_materialization_reference?.fingerprint],
    ['materialization_reference_digest', record.runtime_execution_attempt_materialization_reference?.digest],
    ['attempt_intent_reference_id', record.runtime_execution_attempt_intent_reference?.id],
    ['attempt_intent_reference_fingerprint', record.runtime_execution_attempt_intent_reference?.fingerprint],
    ['attempt_intent_reference_digest', record.runtime_execution_attempt_intent_reference?.digest],
    ['tenant_id', record.identity_scope?.tenant_id],
    ['organization_id', record.identity_scope?.organization_id],
    ['project_id', record.identity_scope?.project_id],
    ['session_reference_id', record.identity_scope?.session_reference_id],
    ['agent_id', record.identity_scope?.agent_id],
    ['actor_id', record.identity_scope?.actor_id],
    ['logical_job_identity_digest', record.logical_job_identity_digest],
    ['admission_reference_id', record.admission_reference?.id],
    ['attempt_ordinal', record.attempt_ordinal],
    ['durable_record_fingerprint', record.runtime_execution_attempt_durable_record_fingerprint],
    ['durable_record_digest', record.runtime_execution_attempt_durable_record_digest]
  ];
  for (const [column, value] of pairs) {
    if (String(row[column]) !== String(value)) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', `typed_${column}_mismatch`);
  }
  const validation = validateRuntimeExecutionAttemptDurableRecord(record);
  if (!validation.valid) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'durable_record_invalid');
  return cloneFrozen(record);
}

function rowValues(record) {
  return [
    record.runtime_execution_attempt_durable_record_id,
    record.durable_job_reference.id,
    record.runtime_execution_attempt_materialization_reference.id,
    record.runtime_execution_attempt_materialization_reference.fingerprint,
    record.runtime_execution_attempt_materialization_reference.digest,
    record.runtime_execution_attempt_intent_reference.id,
    record.runtime_execution_attempt_intent_reference.fingerprint,
    record.runtime_execution_attempt_intent_reference.digest,
    ...IDENTITY_SCOPE_FIELDS.map((field) => record.identity_scope[field]),
    record.logical_job_identity_digest,
    record.admission_reference.id,
    record.attempt_ordinal,
    'PREPARED',
    1,
    RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
    POSTGRES_SCHEMA_VERSION,
    record.runtime_execution_attempt_durable_record_fingerprint,
    record.runtime_execution_attempt_durable_record_digest,
    JSON.stringify(record)
  ];
}

function sameCanonicalRecord(left, right) {
  return left.runtime_execution_attempt_durable_record_id === right.runtime_execution_attempt_durable_record_id
    && left.runtime_execution_attempt_durable_record_fingerprint === right.runtime_execution_attempt_durable_record_fingerprint
    && left.runtime_execution_attempt_durable_record_digest === right.runtime_execution_attempt_durable_record_digest
    && stablePayload(left) === stablePayload(right);
}

function timeoutError(message) {
  return new RuntimeExecutionAttemptPostgresPersistenceError('TIMEOUT', message);
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

async function rollbackAndRelease(client, began, alreadyReleased = false) {
  if (!client) return;
  if (began) {
    try { await queryWithTimeout(client, 'ROLLBACK'); } catch { /* original error wins */ }
  }
  if (!alreadyReleased) {
    try { client.release(); } catch { /* release is best effort */ }
  }
}

async function commitOrFail(client) {
  try {
    await queryWithTimeout(client, 'COMMIT');
  } catch {
    throw new RuntimeExecutionAttemptPostgresPersistenceError('UNKNOWN_COMMIT_OUTCOME', 'postgres_commit_outcome_unknown');
  }
}

function classifyError(error) {
  if (error instanceof RuntimeExecutionAttemptPostgresPersistenceError) return error;
  if (error?.code === '42P01' || error?.code === '42703') return new RuntimeExecutionAttemptPostgresPersistenceError('SCHEMA_MISSING', 'postgres_schema_missing');
  if (error?.code === '55P03' || error?.code === '57014') return new RuntimeExecutionAttemptPostgresPersistenceError('TIMEOUT', 'postgres_timeout');
  return new RuntimeExecutionAttemptPostgresPersistenceError('POSTGRES_PERSISTENCE_FAILED', 'postgres_persistence_failed');
}

function assertSchemaReadiness(response) {
  if (!response || !Array.isArray(response.rows) || response.rows.length !== 1) throw new RuntimeExecutionAttemptPostgresPersistenceError('SCHEMA_INCOMPATIBLE', 'postgres_schema_readiness_invalid');
  for (const field of ['schema_exists', 'table_exists', 'columns_exist', 'primary_key_exists', 'job_ordinal_key_exists', 'state_check_exists']) {
    if (response.rows[0][field] !== true) throw new RuntimeExecutionAttemptPostgresPersistenceError('SCHEMA_INCOMPATIBLE', 'postgres_schema_incompatible');
  }
}

function createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName = DEFAULT_TABLE_NAME } = {}) {
  requirePool(pool);
  const sql = buildSql(tableName);
  let ready = false;
  let readinessPromise = null;

  async function ensureReady() {
    if (ready) return;
    if (!readinessPromise) {
      readinessPromise = (async () => {
        try {
          assertSchemaReadiness(await awaitWithTimeout(pool.query(sql.readiness), STATEMENT_TIMEOUT_MS, timeoutError('postgres_readiness_timeout')));
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

  async function persistDurably(candidate) {
    const validation = validateRuntimeExecutionAttemptDurableRecord(candidate);
    if (!validation.valid) return { persistence_result: resultFor('REJECTED', null, 'invalid_p6_record'), persistence_proof: null };

    await ensureReady();
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
      const inserted = await queryWithTimeout(client, sql.insert, rowValues(candidate));
      if (inserted?.rows?.length === 1) {
        const persisted = rowToDurableRecord(inserted.rows[0]);
        if (!sameCanonicalRecord(candidate, persisted)) throw new RuntimeExecutionAttemptPostgresPersistenceError('CORRUPT_ROW', 'inserted_record_mismatch');
        await commitOrFail(client);
        began = false;
        releaseClient();
        return {
          persistence_result: resultFor('CREATED', persisted, 'persisted_prepared', lifecycleFor(inserted.rows[0].state, inserted.rows[0].revision)),
          persistence_proof: buildPersistenceProof('CREATED', persisted, true, true)
        };
      }

      let existingResponse = await queryWithTimeout(client, sql.selectById, [candidate.runtime_execution_attempt_durable_record_id]);
      if (!existingResponse?.rows || existingResponse.rows.length > 1) throw new RuntimeExecutionAttemptPostgresPersistenceError('STORAGE_INCONSISTENT', 'identity_lookup_inconsistent');
      if (existingResponse.rows.length === 0) {
        existingResponse = await queryWithTimeout(client, sql.selectByJobOrdinal, [candidate.durable_job_reference.id, candidate.attempt_ordinal]);
      }
      if (!existingResponse?.rows || existingResponse.rows.length !== 1) throw new RuntimeExecutionAttemptPostgresPersistenceError('STORAGE_INCONSISTENT', 'conflict_record_missing');
      const existing = rowToDurableRecord(existingResponse.rows[0]);
      const identical = sameCanonicalRecord(candidate, existing);
      const outcome = identical ? 'EXISTING_IDENTICAL' : 'CONFLICT';
      await commitOrFail(client);
      began = false;
      releaseClient();
      return {
        persistence_result: resultFor(outcome, existing, identical ? 'identical_replay' : 'canonical_semantics_conflict', lifecycleFor(existingResponse.rows[0].state, existingResponse.rows[0].revision)),
        persistence_proof: identical ? buildPersistenceProof(outcome, existing, false, true) : null
      };
    } catch (error) {
      const classified = classifyError(error);
      await rollbackAndRelease(client, began, released);
      throw classified;
    }
  }

  return Object.freeze({
    adapter_name: 'runtime_execution_attempt_persistence_postgres',
    table_name: tableName,
    schema_version: POSTGRES_SCHEMA_VERSION,
    persistDurably,
    validatePersistenceProof
  });
}

module.exports = {
  CONNECTION_TIMEOUT_MS,
  INSERT_SQL,
  IDENTITY_SCOPE_FIELDS,
  LOCK_TIMEOUT_MS,
  PERSISTENCE_CONTRACT_NAME,
  PERSISTENCE_CONTRACT_VERSION,
  PERSISTENCE_PROOF_CONTRACT_NAME,
  PERSISTENCE_PROOF_CONTRACT_VERSION,
  POSTGRES_SCHEMA_VERSION,
  PROOF_FIELDS,
  READINESS_SQL,
  RESULT_FIELDS,
  ROW_FIELDS,
  RuntimeExecutionAttemptPostgresPersistenceError,
  SELECT_BY_ID_SQL,
  SELECT_BY_JOB_ORDINAL_SQL,
  STATEMENT_TIMEOUT_MS,
  buildPersistenceProof,
  createRuntimeExecutionAttemptPersistencePostgres,
  deriveAttemptAdmittedFromLifecycle,
  lifecycleFor,
  resultFor,
  rowToDurableRecord,
  rowValues,
  validatePersistenceProof
};
