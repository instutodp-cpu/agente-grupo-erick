'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  buildSelectionPlan,
  classifyPersistedSelection,
  planToInsertRow,
  validateStageReference
} = require('../../core/runtime-execution-attempt-claim-worker-selection');
const { rowToWorker } = require('./runtime-worker-registry-postgres');
const { rowToDurableRecord, lifecycleFor } = require('./runtime-execution-attempt-persistence-postgres');

const DEFAULT_ATTEMPT_TABLE_NAME = 'hermes.execution_attempts';
const DEFAULT_CLAIM_TABLE_NAME = 'hermes.execution_attempt_claims';
const DEFAULT_WORKER_TABLE_NAME = 'hermes.runtime_workers';
const DEFAULT_SELECTION_TABLE_NAME = 'hermes.runtime_execution_attempt_claim_worker_selections';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SELECTION_COLUMNS = Object.freeze([
  'contract_name', 'contract_version', 'selection_id', 'claim_id', 'attempt_durable_record_id', 'claim_digest', 'runtime_stage_reference_id',
  'runtime_stage_reference_version', 'stage_fingerprint', 'stage_digest', 'attempt_ordinal', 'tenant_id', 'organization_id',
  'project_id', 'session_reference_id', 'agent_id', 'actor_id', 'selection_ordinal', 'selected_worker_id',
  'selected_worker_digest', 'candidate_worker_ids', 'candidate_set', 'candidate_set_digest', 'selection_policy',
  'selection_policy_version', 'selection_fingerprint', 'selection_digest', 'stage_reference', 'selection_artifact',
  'created_at'
]);
const WORKER_COLUMNS = Object.freeze([
  'worker_id', 'tenant_id', 'organization_id', 'project_id', 'worker_type', 'lifecycle_state',
  'worker_capability_reference_id', 'worker_compatibility_reference_ids', 'supported_stage_types',
  'supported_modalities', 'supported_model_provider_ids', 'supported_model_ids', 'supported_tool_ids',
  'supported_workflow_ids', 'canonical_fingerprint', 'canonical_digest', 'schema_version', 'validator_version',
  'created_at', 'updated_at'
]);

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_worker_selection_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') throw new TypeError('runtime_worker_selection_postgres_pool_invalid');
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function normalizeSelectionRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    runtime_stage_reference_version: Number(row.runtime_stage_reference_version),
    attempt_ordinal: Number(row.attempt_ordinal),
    selection_ordinal: Number(row.selection_ordinal),
    candidate_worker_ids: parseJson(row.candidate_worker_ids),
    candidate_set: parseJson(row.candidate_set),
    stage_reference: parseJson(row.stage_reference),
    selection_artifact: parseJson(row.selection_artifact),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function normalizeClaimRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    claim_ordinal: Number(row.claim_ordinal),
    attempt_revision: Number(row.attempt_revision),
    attempt_ordinal: Number(row.attempt_ordinal),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function normalizeWorkerRow(row) {
  const { created_at, updated_at, ...canonicalWorker } = rowToWorker({
    ...row,
    ...Object.fromEntries([
      'worker_compatibility_reference_ids', 'supported_stage_types', 'supported_modalities',
      'supported_model_provider_ids', 'supported_model_ids', 'supported_tool_ids', 'supported_workflow_ids'
    ].map((field) => [field, parseJson(row[field])]))
  });
  return canonicalWorker;
}

function resultFor(outcome, plan, row, reasonCode, validationErrors = []) {
  const selected = ['CREATED', 'EXISTING_IDENTICAL'].includes(outcome);
  return cloneFrozen({
    selection_result: {
      contract_name: 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_SELECTION_AUTHORITY',
      contract_version: 'runtime_execution_attempt_claim_worker_selection_authority_contract_v1',
      outcome,
      selection_id: row?.selection_id ?? plan?.selection_id ?? null,
      claim_id: row?.claim_id ?? plan?.claim_id ?? null,
      attempt_durable_record_id: row?.attempt_durable_record_id ?? plan?.attempt_durable_record_id ?? null,
      runtime_stage_reference_id: row?.runtime_stage_reference_id ?? plan?.identity?.runtime_stage_reference_id ?? null,
      selected_worker_id: row?.selected_worker_id ?? plan?.selected_worker_id ?? null,
      candidate_set: row?.candidate_set ?? plan?.candidate_set ?? [],
      worker_selected: selected,
      worker_bound: false,
      worker_ownership_established: false,
      selection_creates_binding: false,
      selection_grants_ownership: false,
      selection_reserves_capacity: false,
      selection_creates_lease: false,
      selection_creates_fencing: false,
      execution_authorized: false,
      execution_started: false,
      execution_performed: false,
      simulation: false,
      production_blocked: true,
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  });
}

function createRuntimeExecutionAttemptClaimWorkerSelectionPostgres({
  pool,
  attemptTableName = DEFAULT_ATTEMPT_TABLE_NAME,
  claimTableName = DEFAULT_CLAIM_TABLE_NAME,
  workerTableName = DEFAULT_WORKER_TABLE_NAME,
  selectionTableName = DEFAULT_SELECTION_TABLE_NAME,
  authorizeSelection
} = {}) {
  requirePool(pool);
  const attempts = requireTableName(attemptTableName);
  const claims = requireTableName(claimTableName);
  const workers = requireTableName(workerTableName);
  const selections = requireTableName(selectionTableName);
  const selectionColumns = SELECTION_COLUMNS.join(', ');
  const workerColumns = WORKER_COLUMNS.join(', ');

  async function selectClaim(client, claimId) {
    const response = await client.query(`SELECT * FROM ${claims} WHERE claim_id = $1 FOR SHARE`, [claimId]);
    return normalizeClaimRow(response.rows[0] || null);
  }

  async function selectAttempt(client, attemptId) {
    const response = await client.query(`SELECT * FROM ${attempts} WHERE attempt_durable_record_id = $1 FOR SHARE`, [attemptId]);
    return response.rows[0] || null;
  }

  async function selectWorkers(client, claim) {
    const response = await client.query(`
      SELECT ${workerColumns}
      FROM ${workers}
      WHERE lifecycle_state = 'ACTIVE'
        AND tenant_id = $1
        AND organization_id = $2
        AND project_id = $3
      ORDER BY worker_id
      FOR SHARE
    `, [claim.tenant_id, claim.organization_id, claim.project_id]);
    return response.rows.map(normalizeWorkerRow);
  }

  async function acquireSelection({ claim_id: claimId, stage_reference: stage } = {}) {
    const stageValidation = validateStageReference(stage);
    if (!stageValidation.valid) return resultFor('INVALID', null, null, 'invalid_stage_predecessor', stageValidation.errors);
    if (typeof claimId !== 'string' || claimId.length === 0) return resultFor('INVALID', null, null, 'claim_id_invalid');
    if (typeof authorizeSelection !== 'function') return resultFor('INVALID', null, null, 'selection_authority_required');

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const claim = await selectClaim(client, claimId);
      if (!claim) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', null, null, 'claim_not_found');
      }
      const workersInScope = await selectWorkers(client, claim);
      const plan = buildSelectionPlan({ claim, stage_reference: stage, workers: workersInScope });
      if (plan.outcome === 'INVALID') {
        await client.query('COMMIT');
        began = false;
        return resultFor('INVALID', plan, null, plan.reason_code, plan.errors);
      }
      if (plan.outcome === 'NO_ELIGIBLE_WORKER') {
        await client.query('COMMIT');
        began = false;
        return resultFor(plan.outcome, plan, null, plan.reason_code);
      }

      const attempt = await selectAttempt(client, plan.attempt_durable_record_id);
      if (!attempt) {
        await client.query('COMMIT');
        began = false;
        return resultFor('NOT_FOUND', plan, null, 'attempt_not_found');
      }
      let durableRecord;
      try {
        durableRecord = rowToDurableRecord(attempt);
      } catch {
        await client.query('COMMIT');
        began = false;
        return resultFor('TECHNICAL_FAILURE', plan, null, 'attempt_row_invalid');
      }
      const lifecycle = lifecycleFor(attempt.state, attempt.revision);
      const scopeMatches = ['tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id']
        .every((field) => durableRecord.identity_scope[field] === plan.identity[field]);
      if (lifecycle.state !== 'ADMITTED' || lifecycle.revision !== 2 || durableRecord.attempt_ordinal !== Number(plan.identity.attempt_ordinal)
        || !scopeMatches) {
        await client.query('COMMIT');
        began = false;
        return resultFor('STALE', plan, null, 'attempt_predecessor_stale');
      }

      const authorized = await authorizeSelection(Object.freeze({ ...plan }));
      if (authorized !== true) {
        await client.query('COMMIT');
        began = false;
        return resultFor('INVALID', plan, null, 'selection_authority_denied');
      }

      const insertValues = planToInsertRow(plan);
      const fields = SELECTION_COLUMNS.filter((field) => field !== 'created_at');
      const values = fields.map((field) => {
        const value = insertValues[field];
        return ['candidate_worker_ids', 'candidate_set', 'stage_reference', 'selection_artifact'].includes(field)
          ? JSON.stringify(value) : value;
      });
      const inserted = await client.query(`
        INSERT INTO ${selections} (${fields.join(', ')})
        VALUES (${fields.map((field, index) => `$${index + 1}${['candidate_worker_ids', 'candidate_set', 'stage_reference', 'selection_artifact'].includes(field) ? '::jsonb' : ''}`).join(', ')})
        ON CONFLICT DO NOTHING
        RETURNING ${selectionColumns}
      `, values);
      if (inserted.rowCount === 1) {
        const stored = normalizeSelectionRow(inserted.rows[0]);
        await client.query('COMMIT');
        began = false;
        return resultFor('CREATED', plan, stored, 'selection_created');
      }
      const existing = await client.query(`
        SELECT ${selectionColumns} FROM ${selections}
        WHERE claim_id = $1 AND runtime_stage_reference_id = $2 AND selection_ordinal = $3
        FOR SHARE
      `, [plan.identity.claim_id, plan.identity.runtime_stage_reference_id, plan.identity.selection_ordinal]);
      if (existing.rowCount !== 1) throw new Error('selection_conflict_row_missing');
      const stored = normalizeSelectionRow(existing.rows[0]);
      const classification = classifyPersistedSelection(stored, plan);
      await client.query('COMMIT');
      began = false;
      return resultFor(classification.outcome, plan, stored, classification.reason_code, classification.validation_errors || []);
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ acquireSelection, selectionTableName: selections, workerTableName: workers });
}

module.exports = {
  DEFAULT_SELECTION_TABLE_NAME,
  createRuntimeExecutionAttemptClaimWorkerSelectionPostgres,
  normalizeSelectionRow,
  validateTableName
};
