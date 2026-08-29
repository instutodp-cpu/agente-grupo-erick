'use strict';

const { exactFields } = require('../../core/agent-identity-contract');
const {
  FIELDS,
  buildWorkerRegistration,
  sameCanonicalWorker,
  validateLifecycleTransition,
  validateWorkerRegistration
} = require('../../core/runtime-worker-registry-contract');

const DEFAULT_TABLE_NAME = 'hermes.runtime_workers';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const ROW_FIELDS = Object.freeze(FIELDS);
const SELECT_COLUMNS = ROW_FIELDS.join(', ');

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_worker_registry_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('runtime_worker_registry_postgres_pool_invalid');
}

function parseJsonArray(value, field) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error(`${field}_invalid`);
  return parsed;
}

function rowToWorker(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('runtime_worker_registry_row_invalid');
  const worker = { ...row };
  for (const field of [
    'worker_compatibility_reference_ids', 'supported_stage_types', 'supported_modalities',
    'supported_model_provider_ids', 'supported_model_ids', 'supported_tool_ids', 'supported_workflow_ids'
  ]) worker[field] = parseJsonArray(worker[field], field);
  const { created_at, updated_at, ...canonicalWorker } = worker;
  const validation = validateWorkerRegistration(canonicalWorker);
  if (!validation.valid) throw new Error(`runtime_worker_registry_corrupt_row::${validation.errors.join(',')}`);
  return { ...canonicalWorker, created_at, updated_at };
}

function rowValues(worker) {
  return [
    worker.worker_id, worker.tenant_id, worker.organization_id, worker.project_id, worker.worker_type,
    worker.lifecycle_state, worker.worker_capability_reference_id,
    JSON.stringify(worker.worker_compatibility_reference_ids), JSON.stringify(worker.supported_stage_types),
    JSON.stringify(worker.supported_modalities), JSON.stringify(worker.supported_model_provider_ids),
    JSON.stringify(worker.supported_model_ids), JSON.stringify(worker.supported_tool_ids),
    JSON.stringify(worker.supported_workflow_ids), worker.canonical_fingerprint, worker.canonical_digest,
    worker.schema_version, worker.validator_version
  ];
}

function result(outcome, worker = null, reasonCode = null) {
  return Object.freeze({
    outcome,
    worker: worker ? Object.freeze({ ...worker }) : null,
    reason_code: reasonCode,
    registry_authority_created: outcome === 'CREATED',
    worker_selection_performed: false,
    claim_binding_created: false,
    worker_ownership_established: false,
    capacity_reserved: false,
    execution_authorized: false
  });
}

function createRuntimeWorkerRegistryPostgres({ pool, tableName = DEFAULT_TABLE_NAME, authorizeRegistration } = {}) {
  requirePool(pool);
  const qualifiedTableName = requireTableName(tableName);
  const [schemaName, relationName] = qualifiedTableName.split('.');

  async function registerWorker(input) {
    const worker = buildWorkerRegistration(input);
    if (typeof authorizeRegistration !== 'function') return result('INVALID', null, 'registration_authority_required');
    const authorized = await authorizeRegistration(Object.freeze({ ...worker }));
    if (authorized !== true) return result('INVALID', null, 'registration_authority_denied');

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const inserted = await client.query(`
        INSERT INTO ${qualifiedTableName}
          (worker_id, tenant_id, organization_id, project_id, worker_type, lifecycle_state,
           worker_capability_reference_id, worker_compatibility_reference_ids, supported_stage_types,
           supported_modalities, supported_model_provider_ids, supported_model_ids, supported_tool_ids,
           supported_workflow_ids, canonical_fingerprint, canonical_digest, schema_version, validator_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
                $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17, $18)
        ON CONFLICT (worker_id) DO NOTHING
        RETURNING ${SELECT_COLUMNS}`,
      rowValues(worker));
      if (inserted.rowCount === 1) {
        const created = rowToWorker(inserted.rows[0]);
        await client.query('COMMIT');
        began = false;
        return result('CREATED', created);
      }
      const existingResult = await client.query(`SELECT ${SELECT_COLUMNS} FROM ${qualifiedTableName} WHERE worker_id = $1`, [worker.worker_id]);
      if (existingResult.rowCount !== 1) throw new Error('runtime_worker_registry_conflict_row_missing');
      const existing = rowToWorker(existingResult.rows[0]);
      const outcome = sameCanonicalWorker(existing, worker) ? 'EXISTING_IDENTICAL' : 'CONFLICT';
      await client.query('COMMIT');
      began = false;
      return result(outcome, existing, outcome === 'CONFLICT' ? 'canonical_identity_conflict' : null);
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function getWorker({ workerId, tenantId, organizationId, projectId } = {}) {
    if (typeof workerId !== 'string' || workerId.length === 0) return result('INVALID', null, 'worker_id_invalid');
    const values = [workerId];
    const row = await pool.query(`SELECT ${SELECT_COLUMNS} FROM ${qualifiedTableName} WHERE worker_id = $1`, values);
    if (row.rowCount !== 1) return result('NOT_FOUND', null, 'worker_not_found');
    const worker = rowToWorker(row.rows[0]);
    if ([tenantId, organizationId, projectId].some((value) => value !== undefined)
      && (worker.tenant_id !== tenantId || worker.organization_id !== organizationId || worker.project_id !== projectId)) {
      return result('INVALID', null, 'worker_scope_mismatch');
    }
    return result('EXISTING_IDENTICAL', worker);
  }

  async function transitionLifecycle({ workerId, expectedState, nextState } = {}) {
    if (!validateLifecycleTransition(expectedState, nextState)) return result('INVALID', null, 'lifecycle_transition_invalid');
    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const updated = await client.query(`
        UPDATE ${qualifiedTableName}
        SET lifecycle_state = $2, updated_at = CURRENT_TIMESTAMP
        WHERE worker_id = $1 AND lifecycle_state = $3
        RETURNING ${SELECT_COLUMNS}`,
      [workerId, nextState, expectedState]);
      if (updated.rowCount !== 1) {
        const current = await client.query(`SELECT ${SELECT_COLUMNS} FROM ${qualifiedTableName} WHERE worker_id = $1`, [workerId]);
        await client.query('COMMIT');
        began = false;
        if (current.rowCount !== 1) return result('NOT_FOUND', null, 'worker_not_found');
        return result('CONFLICT', rowToWorker(current.rows[0]), 'lifecycle_compare_and_swap_conflict');
      }
      const worker = rowToWorker(updated.rows[0]);
      await client.query('COMMIT');
      began = false;
      return result('UPDATED', worker);
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ registerWorker, getWorker, transitionLifecycle, tableName: qualifiedTableName, schemaName, relationName });
}

module.exports = {
  DEFAULT_TABLE_NAME,
  FIELDS,
  createRuntimeWorkerRegistryPostgres,
  rowToWorker,
  rowValues
};
