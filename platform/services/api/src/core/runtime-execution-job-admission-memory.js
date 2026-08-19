'use strict';

// P3A reference adapter only: deterministic in-memory semantics, not durable
// storage and not a production repository. P3B must provide the real adapter.

const { cloneFrozen } = require('./agent-identity-contract');
const {
  buildRuntimeExecutionJobAdmissionResult,
  createRuntimeExecutionJobAdmissionPort
} = require('./runtime-execution-job-admission-contract');
const {
  buildAdmissionReceipt,
  buildDurableJobRecord,
  computeRuntimeExecutionJobDurableDigest,
  validateRuntimeExecutionJobDurableRecord
} = require('./runtime-execution-job-durable-contract');

const ADAPTER_NAME = 'runtime_execution_job_admission_memory_reference';
const REFERENCE_ADAPTER_ONLY = true;
const REAL_DB_DURABILITY = false;
const MIGRATION_APPLIED = false;
const DATABASE_ATOMICITY_PROVEN = false;
const candidateByFrozenMaterialization = new WeakMap();
const resultByRecord = new WeakMap();

function resultForRecord(outcome, record, reasonCode = null) {
  const receipt = outcome === 'EXISTING_IDENTICAL'
    ? buildAdmissionReceipt(
      {
        job_reference: record.job_reference,
        runtime_execution_job_materialization_id: record.runtime_execution_job_materialization_reference.id,
        runtime_execution_job_materialization_version: record.runtime_execution_job_materialization_reference.version,
        runtime_execution_job_materialization_fingerprint: record.runtime_execution_job_materialization_reference.fingerprint,
        runtime_execution_job_materialization_digest: record.runtime_execution_job_materialization_reference.digest,
        identity_scope: record.identity_scope,
        idempotency_reference: record.idempotency_reference
      },
      record.logical_job_identity,
      record.admission_reference,
      reasonCode || 'identical_replay'
    )
    : record.admission_receipt;
  const result = buildRuntimeExecutionJobAdmissionResult({
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
  return result;
}

function rejected(reasonCode) {
  return buildRuntimeExecutionJobAdmissionResult({ outcome: 'REJECTED', reason_code: reasonCode });
}

function createRuntimeExecutionJobAdmissionMemory() {
  const recordsByLogicalIdentity = new Map();
  const logicalIdentityByIdempotency = new Map();

  function cachedResult(outcome, record, reasonCode) {
    let results = resultByRecord.get(record);
    if (!results) {
      results = new Map();
      resultByRecord.set(record, results);
    }
    const key = `${outcome}:${reasonCode || ''}`;
    if (!results.has(key)) results.set(key, resultForRecord(outcome, record, reasonCode));
    return results.get(key);
  }

  function admit(materializedExecutionJob) {
    let candidate;
    if (materializedExecutionJob !== null
      && typeof materializedExecutionJob === 'object'
      && Object.isFrozen(materializedExecutionJob)) {
      candidate = candidateByFrozenMaterialization.get(materializedExecutionJob);
    }
    if (!candidate) {
      try {
        candidate = buildDurableJobRecord(materializedExecutionJob);
      } catch {
        return rejected('invalid_p2_materialization');
      }
      if (materializedExecutionJob !== null
        && typeof materializedExecutionJob === 'object'
        && Object.isFrozen(materializedExecutionJob)) {
        candidateByFrozenMaterialization.set(materializedExecutionJob, candidate);
      }
    }

    const logicalKey = candidate.logical_job_identity.digest;
    const idempotencyKey = candidate.idempotency_reference.fingerprint;
    const existingLogicalKey = logicalIdentityByIdempotency.get(idempotencyKey);
    if (existingLogicalKey !== undefined) {
      const existing = recordsByLogicalIdentity.get(existingLogicalKey);
      if (!existing) return rejected('memory_index_inconsistent');
      if (existing.logical_job_identity.digest === logicalKey
        && existing.runtime_execution_job_durable_digest === candidate.runtime_execution_job_durable_digest) {
        return cachedResult('EXISTING_IDENTICAL', existing, 'identical_replay');
      }
      const scopeMismatch = JSON.stringify(existing.identity_scope) !== JSON.stringify(candidate.identity_scope);
      return cachedResult('CONFLICT', existing, scopeMismatch ? 'identity_scope_conflict' : 'canonical_semantics_conflict');
    }

    const existing = recordsByLogicalIdentity.get(logicalKey);
    if (existing) {
      if (existing.runtime_execution_job_durable_digest === candidate.runtime_execution_job_durable_digest) {
        logicalIdentityByIdempotency.set(idempotencyKey, logicalKey);
        return cachedResult('EXISTING_IDENTICAL', existing, 'identical_replay');
      }
      return cachedResult('CONFLICT', existing, 'canonical_semantics_conflict');
    }

    recordsByLogicalIdentity.set(logicalKey, candidate);
    logicalIdentityByIdempotency.set(idempotencyKey, logicalKey);
    return cachedResult('CREATED', candidate);
  }

  const port = createRuntimeExecutionJobAdmissionPort({ admit });
  return Object.freeze({
    ...port,
    adapter_name: ADAPTER_NAME,
    reference_adapter_only: REFERENCE_ADAPTER_ONLY,
    real_db_durability: REAL_DB_DURABILITY,
    migration_applied: MIGRATION_APPLIED,
    database_atomicity_proven: DATABASE_ATOMICITY_PROVEN,
    inspect: (logicalIdentityDigest) => {
      const record = recordsByLogicalIdentity.get(logicalIdentityDigest);
      return record ? cloneFrozen(record) : null;
    },
    size: () => recordsByLogicalIdentity.size,
    validateRecord: (record) => validateRuntimeExecutionJobDurableRecord(record),
    computeRecordDigest: (record) => computeRuntimeExecutionJobDurableDigest(record)
  });
}

module.exports = {
  ADAPTER_NAME,
  DATABASE_ATOMICITY_PROVEN,
  MIGRATION_APPLIED,
  REAL_DB_DURABILITY,
  REFERENCE_ADAPTER_ONLY,
  createRuntimeExecutionJobAdmissionMemory
};
