'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('../../core/agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('../../core/canonical-content-digest');
const {
  ADMISSION_OUTCOMES,
  buildRuntimeExecutionJobAdmissionResult,
  createRuntimeExecutionJobAdmissionPort
} = require('../../core/runtime-execution-job-admission-contract');
const {
  buildAdmissionReceipt,
  buildDurableJobRecord,
  computeRuntimeExecutionJobDurableDigest,
  computeRuntimeExecutionJobDurableFingerprint,
  validateRuntimeExecutionJobDurableRecord
} = require('../../core/runtime-execution-job-durable-contract');

const POSTGRES_PERSISTENCE_PROOF_CONTRACT_NAME = 'RUNTIME_EXECUTION_JOB_POSTGRES_PERSISTENCE_PROOF';
const POSTGRES_PERSISTENCE_PROOF_CONTRACT_VERSION = 'runtime_execution_job_postgres_persistence_proof_v1';
const POSTGRES_SCHEMA_VERSION = 3;
const CONNECTION_TIMEOUT_MS = 5000;
const LOCK_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_MS = 10000;
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const ROW_FIELDS = Object.freeze([
  'job_reference_id',
  ...IDENTITY_SCOPE_FIELDS,
  'logical_identity_digest',
  'idempotency_fingerprint',
  'record_fingerprint',
  'record_digest',
  'admission_reference_id',
  'revision',
  'state',
  'contract_version',
  'schema_version',
  'durable_record'
]);
const PROOF_FIELDS = Object.freeze([
  'contract_name',
  'contract_version',
  'backend',
  'schema_version',
  'canonical_record_persisted',
  'write_performed',
  'candidate_semantics_persisted',
  'admission_outcome',
  'job_reference_id',
  'logical_identity_digest',
  'record_digest',
  'admission_reference_id',
  'fingerprint',
  'digest'
]);

const SELECT_COLUMNS = ROW_FIELDS.join(', ');
const INSERT_SQL = `INSERT INTO hermes.execution_jobs
  (${ROW_FIELDS.join(', ')})
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
ON CONFLICT DO NOTHING
RETURNING ${SELECT_COLUMNS}`;
const SELECT_BY_IDEMPOTENCY_SQL = `SELECT ${SELECT_COLUMNS}
FROM hermes.execution_jobs
WHERE tenant_id = $1 AND organization_id = $2 AND project_id = $3
  AND session_reference_id = $4 AND agent_id = $5 AND actor_id = $6
  AND idempotency_fingerprint = $7
FOR UPDATE`;
const SELECT_BY_LOGICAL_IDENTITY_SQL = `SELECT ${SELECT_COLUMNS}
FROM hermes.execution_jobs
WHERE tenant_id = $1 AND organization_id = $2 AND project_id = $3
  AND session_reference_id = $4 AND agent_id = $5 AND actor_id = $6
  AND logical_identity_digest = $7
FOR UPDATE`;
const READINESS_SQL = `
SELECT
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'hermes') AS schema_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'hermes' AND table_name = 'execution_jobs') AS table_exists,
  (
    SELECT count(*) = 17
    FROM information_schema.columns
    WHERE table_schema = 'hermes'
      AND table_name = 'execution_jobs'
      AND column_name IN (
        'job_reference_id', 'tenant_id', 'organization_id', 'project_id',
        'session_reference_id', 'agent_id', 'actor_id', 'logical_identity_digest',
        'idempotency_fingerprint', 'record_fingerprint', 'record_digest',
        'admission_reference_id', 'revision', 'state', 'contract_version',
        'schema_version', 'durable_record'
      )
  ) AS columns_exist,
  (
    SELECT count(*) = 4
    FROM information_schema.columns
    WHERE table_schema = 'hermes' AND table_name = 'execution_jobs'
      AND ((column_name = 'revision' AND data_type = 'bigint')
        OR (column_name = 'schema_version' AND data_type = 'integer')
        OR (column_name = 'durable_record' AND data_type = 'jsonb')
        OR (column_name = 'job_reference_id' AND data_type = 'text'))
  ) AS critical_types_exist,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes' AND r.relname = 'execution_jobs' AND c.conname = 'execution_jobs_pkey') AS primary_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes' AND r.relname = 'execution_jobs' AND c.conname = 'execution_jobs_logical_identity_key') AS logical_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes' AND r.relname = 'execution_jobs' AND c.conname = 'execution_jobs_idempotency_key') AS idempotency_key_exists,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes' AND r.relname = 'execution_jobs' AND c.conname = 'execution_jobs_schema_version_check') AS schema_version_check_exists`;

class RuntimeExecutionJobPostgresAdmissionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'RuntimeExecutionJobPostgresAdmissionError';
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('runtime_execution_job_postgres_pool_invalid');
  }
}

function parseJson(value, field) {
  if (isObject(value)) return value;
  if (typeof value !== 'string') throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', `corrupt_${field}`);
  try {
    return JSON.parse(value);
  } catch {
    throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', `corrupt_${field}`);
  }
}

function safeString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', `corrupt_${field}`);
  }
  return value;
}

function scopeValues(scope) {
  return IDENTITY_SCOPE_FIELDS.map((field) => safeString(scope[field], `identity_scope_${field}`));
}

function rowToDurableRecord(row) {
  if (!isObject(row)) throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', 'corrupt_row');
  for (const field of ROW_FIELDS.filter((field) => !['durable_record', 'revision', 'schema_version'].includes(field))) safeString(row[field], field);
  if (!Number.isSafeInteger(Number(row.revision)) || Number(row.revision) !== 1) {
    throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', 'corrupt_revision');
  }
  if (Number(row.schema_version) !== POSTGRES_SCHEMA_VERSION) {
    throw new RuntimeExecutionJobPostgresAdmissionError('SCHEMA_INCOMPATIBLE', 'schema_version_incompatible');
  }
  const record = parseJson(row.durable_record, 'durable_record');
  const pairs = [
    ['job_reference_id', record.job_reference?.id],
    ['tenant_id', record.identity_scope?.tenant_id],
    ['organization_id', record.identity_scope?.organization_id],
    ['project_id', record.identity_scope?.project_id],
    ['session_reference_id', record.identity_scope?.session_reference_id],
    ['agent_id', record.identity_scope?.agent_id],
    ['actor_id', record.identity_scope?.actor_id],
    ['logical_identity_digest', record.logical_job_identity?.digest],
    ['idempotency_fingerprint', record.idempotency_reference?.fingerprint],
    ['record_fingerprint', record.runtime_execution_job_durable_fingerprint],
    ['record_digest', record.runtime_execution_job_durable_digest],
    ['admission_reference_id', record.admission_reference?.id]
  ];
  for (const [column, value] of pairs) {
    if (row[column] !== value) throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', `typed_${column}_mismatch`);
  }
  if (Number(row.revision) !== record.revision || row.state !== record.state || row.contract_version !== record.contract_version) {
    throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', 'typed_contract_field_mismatch');
  }
  const validation = validateRuntimeExecutionJobDurableRecord(record);
  if (!validation.valid) throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', 'durable_record_invalid');
  return cloneFrozen(record);
}

function rowValues(record) {
  return [
    record.job_reference.id,
    ...scopeValues(record.identity_scope),
    record.logical_job_identity.digest,
    record.idempotency_reference.fingerprint,
    record.runtime_execution_job_durable_fingerprint,
    record.runtime_execution_job_durable_digest,
    record.admission_reference.id,
    record.revision,
    record.state,
    record.contract_version,
    POSTGRES_SCHEMA_VERSION,
    stablePayload(record)
  ];
}

function sameCanonicalRecord(left, right) {
  return left.logical_job_identity.digest === right.logical_job_identity.digest
    && left.runtime_execution_job_durable_digest === right.runtime_execution_job_durable_digest;
}

function materializationFromRecord(record) {
  return {
    job_reference: record.job_reference,
    runtime_execution_job_materialization_id: record.runtime_execution_job_materialization_reference.id,
    runtime_execution_job_materialization_version: record.runtime_execution_job_materialization_reference.version,
    runtime_execution_job_materialization_fingerprint: record.runtime_execution_job_materialization_reference.fingerprint,
    runtime_execution_job_materialization_digest: record.runtime_execution_job_materialization_reference.digest,
    identity_scope: record.identity_scope,
    idempotency_reference: record.idempotency_reference
  };
}

function resultForRecord(outcome, record, reasonCode = null) {
  const receipt = outcome === 'EXISTING_IDENTICAL'
    ? buildAdmissionReceipt(materializationFromRecord(record), record.logical_job_identity, record.admission_reference, reasonCode || 'identical_replay')
    : record.admission_receipt;
  return buildRuntimeExecutionJobAdmissionResult({
    outcome,
    job_reference: record.job_reference,
    logical_job_identity: record.logical_job_identity,
    admission_reference: record.admission_reference,
    revision: record.revision,
    job_fingerprint: record.runtime_execution_job_durable_fingerprint,
    job_digest: record.runtime_execution_job_durable_digest,
    admission_receipt: receipt,
    reason_code: reasonCode
  });
}

function rejected(reasonCode) {
  return buildRuntimeExecutionJobAdmissionResult({ outcome: 'REJECTED', reason_code: reasonCode });
}

function proofMaterial(outcome, record, writePerformed, candidateSemanticsPersisted) {
  return {
    contract_name: POSTGRES_PERSISTENCE_PROOF_CONTRACT_NAME,
    contract_version: POSTGRES_PERSISTENCE_PROOF_CONTRACT_VERSION,
    backend: 'postgresql',
    schema_version: POSTGRES_SCHEMA_VERSION,
    canonical_record_persisted: true,
    write_performed: writePerformed,
    candidate_semantics_persisted: candidateSemanticsPersisted,
    admission_outcome: outcome,
    job_reference_id: record.job_reference.id,
    logical_identity_digest: record.logical_job_identity.digest,
    record_digest: record.runtime_execution_job_durable_digest,
    admission_reference_id: record.admission_reference.id
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
  if (!isObject(proof)) return { valid: false, errors: ['proof_must_be_object'] };
  exactFields(proof, PROOF_FIELDS, 'persistence_proof', errors);
  if (proof.contract_name !== POSTGRES_PERSISTENCE_PROOF_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (proof.contract_version !== POSTGRES_PERSISTENCE_PROOF_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (proof.backend !== 'postgresql') errors.push('backend_invalid');
  if (proof.schema_version !== POSTGRES_SCHEMA_VERSION) errors.push('schema_version_invalid');
  if (proof.canonical_record_persisted !== true) errors.push('canonical_record_must_be_persisted');
  if (typeof proof.write_performed !== 'boolean') errors.push('write_performed_invalid');
  if (typeof proof.candidate_semantics_persisted !== 'boolean') errors.push('candidate_semantics_persisted_invalid');
  if (!ADMISSION_OUTCOMES.includes(proof.admission_outcome) || proof.admission_outcome === 'REJECTED') errors.push('admission_outcome_invalid');
  for (const field of ['job_reference_id', 'admission_reference_id']) if (typeof proof[field] !== 'string' || proof[field].length === 0) errors.push(`${field}_invalid`);
  if (!isCanonicalContentDigest(proof.logical_identity_digest)) errors.push('logical_identity_digest_invalid');
  if (!isCanonicalContentDigest(proof.record_digest)) errors.push('record_digest_invalid');
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

function classifyError(error) {
  if (error instanceof RuntimeExecutionJobPostgresAdmissionError) return error;
  if (error?.message === 'unknown_commit_outcome') return new RuntimeExecutionJobPostgresAdmissionError('UNKNOWN_COMMIT_OUTCOME', 'postgres_commit_outcome_unknown');
  if (error?.code === '42P01' || error?.code === '42703') return new RuntimeExecutionJobPostgresAdmissionError('SCHEMA_MISSING', 'postgres_schema_missing');
  if (error?.code === '55P03' || error?.code === '57014') return new RuntimeExecutionJobPostgresAdmissionError('TIMEOUT', 'postgres_timeout');
  if (error?.code === '40001' || error?.code === '40P01') return new RuntimeExecutionJobPostgresAdmissionError('TRANSIENT_TRANSACTION_FAILURE', 'postgres_transaction_retryable_failure');
  return new RuntimeExecutionJobPostgresAdmissionError('POSTGRES_ADMISSION_FAILED', 'postgres_admission_failed');
}

function timeoutError(message) {
  return new RuntimeExecutionJobPostgresAdmissionError('TIMEOUT', message);
}

function awaitWithTimeout(operation, timeoutMs, error, onLateFulfillment = null) {
  let timedOut = false;
  let timer;
  const tracked = Promise.resolve(operation).then(
    (value) => {
      if (timedOut) {
        if (typeof onLateFulfillment === 'function') {
          try { Promise.resolve(onLateFulfillment(value)).catch(() => {}); } catch { /* cleanup is best effort */ }
        }
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
    timer.unref?.();
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
    try { await queryWithTimeout(client, 'ROLLBACK'); } catch { /* fail closed; original error wins */ }
  }
  if (!alreadyReleased) {
    try { client.release(); } catch { /* release is best effort */ }
  }
}

async function commitOrFail(client) {
  try {
    await queryWithTimeout(client, 'COMMIT');
  } catch {
    throw new Error('unknown_commit_outcome');
  }
}

function assertSchemaReadiness(response) {
  if (!response || !Array.isArray(response.rows) || response.rows.length !== 1) {
    throw new RuntimeExecutionJobPostgresAdmissionError('SCHEMA_INCOMPATIBLE', 'postgres_schema_readiness_invalid');
  }
  const row = response.rows[0];
  for (const field of ['schema_exists', 'table_exists', 'columns_exist', 'critical_types_exist', 'primary_key_exists', 'logical_key_exists', 'idempotency_key_exists', 'schema_version_check_exists']) {
    if (row[field] !== true) throw new RuntimeExecutionJobPostgresAdmissionError('SCHEMA_INCOMPATIBLE', 'postgres_schema_incompatible');
  }
}

function createRuntimeExecutionJobAdmissionPostgres({ pool } = {}) {
  requirePool(pool);
  let ready = false;
  let readinessPromise = null;
  // The P2 materialization is immutable once it reaches this adapter. Reusing
  // the already validated candidate is important for replay/concurrency bursts:
  // building a durable record re-canonicalizes the complete dispatch package.
  // Mutable inputs intentionally bypass this cache so callers cannot turn a
  // later mutation into a stale admission candidate.
  const candidateByFrozenMaterialization = new WeakMap();

  function buildCandidate(materializedExecutionJob) {
    const cacheable = materializedExecutionJob !== null
      && typeof materializedExecutionJob === 'object'
      && Object.isFrozen(materializedExecutionJob);
    if (cacheable) {
      const cached = candidateByFrozenMaterialization.get(materializedExecutionJob);
      if (cached) return cached;
    }

    const candidate = buildDurableJobRecord(materializedExecutionJob);
    if (cacheable) candidateByFrozenMaterialization.set(materializedExecutionJob, candidate);
    return candidate;
  }

  async function ensureReady() {
    if (ready) return;
    if (!readinessPromise) {
      readinessPromise = (async () => {
        try {
          assertSchemaReadiness(await awaitWithTimeout(
            pool.query(READINESS_SQL),
            STATEMENT_TIMEOUT_MS,
            timeoutError('postgres_readiness_timeout')
          ));
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

  async function admitDurably(materializedExecutionJob) {
    let candidate;
    try {
      candidate = buildCandidate(materializedExecutionJob);
    } catch {
      return { admission_result: rejected('invalid_p2_materialization'), persistence_proof: null };
    }

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
        (lateClient) => {
          try { lateClient?.release?.(); } catch { /* late cleanup is best effort */ }
        }
      );
      await queryWithTimeout(client, 'BEGIN');
      began = true;
      await queryWithTimeout(client, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      await queryWithTimeout(client, `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      const inserted = await queryWithTimeout(client, INSERT_SQL, rowValues(candidate));
      if (inserted?.rows?.length === 1) {
        const persisted = rowToDurableRecord(inserted.rows[0]);
        if (!sameCanonicalRecord(candidate, persisted)) throw new RuntimeExecutionJobPostgresAdmissionError('CORRUPT_ROW', 'inserted_record_mismatch');
        await commitOrFail(client);
        began = false;
        releaseClient();
        return {
          admission_result: resultForRecord('CREATED', persisted),
          persistence_proof: buildPersistenceProof('CREATED', persisted, true, true)
        };
      }

      const scope = scopeValues(candidate.identity_scope);
      let existingResponse = await queryWithTimeout(client, SELECT_BY_IDEMPOTENCY_SQL, [...scope, candidate.idempotency_reference.fingerprint]);
      if (!existingResponse?.rows || existingResponse.rows.length > 1) throw new RuntimeExecutionJobPostgresAdmissionError('STORAGE_INCONSISTENT', 'idempotency_lookup_inconsistent');
      if (existingResponse.rows.length === 0) {
        existingResponse = await queryWithTimeout(client, SELECT_BY_LOGICAL_IDENTITY_SQL, [...scope, candidate.logical_job_identity.digest]);
      }
      if (!existingResponse?.rows || existingResponse.rows.length !== 1) throw new RuntimeExecutionJobPostgresAdmissionError('STORAGE_INCONSISTENT', 'conflict_record_missing');
      const existing = rowToDurableRecord(existingResponse.rows[0]);
      const identical = sameCanonicalRecord(candidate, existing);
      const outcome = identical ? 'EXISTING_IDENTICAL' : 'CONFLICT';
      const reason = identical ? 'identical_replay' : 'canonical_semantics_conflict';
      await commitOrFail(client);
      began = false;
      releaseClient();
      return {
        admission_result: resultForRecord(outcome, existing, reason),
        persistence_proof: buildPersistenceProof(outcome, existing, false, identical)
      };
    } catch (error) {
      const classified = classifyError(error);
      await rollbackAndRelease(client, began, released);
      throw classified;
    }
  }

  const port = createRuntimeExecutionJobAdmissionPort({
    admit: async (materializedExecutionJob) => (await admitDurably(materializedExecutionJob)).admission_result
  });
  return Object.freeze({
    ...port,
    adapter_name: 'runtime_execution_job_admission_postgres',
    schema_version: POSTGRES_SCHEMA_VERSION,
    admitDurably,
    validatePersistenceProof
  });
}

module.exports = {
  CONNECTION_TIMEOUT_MS,
  INSERT_SQL,
  LOCK_TIMEOUT_MS,
  POSTGRES_PERSISTENCE_PROOF_CONTRACT_NAME,
  POSTGRES_PERSISTENCE_PROOF_CONTRACT_VERSION,
  POSTGRES_SCHEMA_VERSION,
  PROOF_FIELDS,
  READINESS_SQL,
  RuntimeExecutionJobPostgresAdmissionError,
  SELECT_BY_IDEMPOTENCY_SQL,
  SELECT_BY_LOGICAL_IDENTITY_SQL,
  STATEMENT_TIMEOUT_MS,
  buildPersistenceProof,
  createRuntimeExecutionJobAdmissionPostgres,
  rowToDurableRecord,
  validatePersistenceProof
};
