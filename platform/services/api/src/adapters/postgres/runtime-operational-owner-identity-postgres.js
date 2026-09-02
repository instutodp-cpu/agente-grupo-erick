'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  SAFE_FLAGS,
  buildOperationalOwnerIdentity,
  classifyPersistedOperationalOwner,
  planToInsertRow
} = require('../../core/runtime-operational-owner-identity');

const DEFAULT_TABLE_NAME = 'hermes.runtime_operational_owners';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const JSON_FIELDS = Object.freeze(['owner_identity_artifact']);
const TABLE_COLUMNS = FIELDS.filter((field) => field !== 'created_at').concat('created_at').join(', ');

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('operational_owner_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('operational_owner_postgres_pool_invalid');
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    owner_identity_artifact: parseJson(row.owner_identity_artifact),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function resultFor(outcome, plan, row, reasonCode, validationErrors = []) {
  const successful = ['CREATED', 'EXISTING_IDENTICAL'].includes(outcome);
  return cloneFrozen({
    operational_owner_result: {
      contract_name: CONTRACT_NAME,
      contract_version: CONTRACT_VERSION,
      outcome,
      operational_owner_id: row?.operational_owner_id ?? plan?.operational_owner_id ?? null,
      operational_owner_type: row?.operational_owner_type ?? plan?.identity?.operational_owner_type ?? null,
      owner_reference_id: row?.owner_reference_id ?? plan?.identity?.owner_reference_id ?? null,
      tenant_id: row?.tenant_id ?? plan?.identity?.tenant_id ?? null,
      organization_id: row?.organization_id ?? plan?.identity?.organization_id ?? null,
      project_id: row?.project_id ?? plan?.identity?.project_id ?? null,
      operational_owner_identity_registered: successful,
      ...Object.fromEntries(Object.entries(SAFE_FLAGS).map(([key, value]) => [
        key, key === 'operational_owner_identity_registered' ? successful : value
      ])),
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  });
}

function createRuntimeOperationalOwnerIdentityPostgres({ pool, tableName = DEFAULT_TABLE_NAME } = {}) {
  requirePool(pool);
  const qualifiedTableName = requireTableName(tableName);
  const fields = FIELDS.filter((field) => field !== 'created_at');

  async function registerOperationalOwner(input = {}) {
    const plan = buildOperationalOwnerIdentity(input);
    if (plan.outcome !== 'READY') return resultFor('INVALID', plan, null, plan.reason_code, plan.errors);

    const insertRow = planToInsertRow(plan);
    const values = fields.map((field) => JSON_FIELDS.includes(field) ? JSON.stringify(insertRow[field]) : insertRow[field]);
    let client = null;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      began = true;
      const inserted = await client.query(`
        INSERT INTO ${qualifiedTableName} (${fields.join(', ')})
        VALUES (${fields.map((field, index) => `$${index + 1}${JSON_FIELDS.includes(field) ? '::jsonb' : ''}`).join(', ')})
        ON CONFLICT DO NOTHING
        RETURNING ${TABLE_COLUMNS}
      `, values);
      if (inserted.rowCount === 1) {
        const stored = normalizeRow(inserted.rows[0]);
        await client.query('COMMIT');
        began = false;
        return resultFor('CREATED', plan, stored, 'operational_owner_identity_created');
      }

      const existing = await client.query(`
        SELECT ${TABLE_COLUMNS} FROM ${qualifiedTableName}
        WHERE operational_owner_type = $1 AND owner_reference_id = $2 AND tenant_id = $3
        FOR SHARE
      `, [plan.identity.operational_owner_type, plan.identity.owner_reference_id, plan.identity.tenant_id]);
      if (existing.rowCount !== 1) throw new Error('operational_owner_conflict_row_missing');
      const stored = normalizeRow(existing.rows[0]);
      const classification = classifyPersistedOperationalOwner(stored, plan);
      await client.query('COMMIT');
      began = false;
      return resultFor(classification.outcome, plan, stored, classification.reason_code, classification.validation_errors || []);
    } catch (error) {
      if (began && client) {
        try { await client.query('ROLLBACK'); } catch { /* preserve fail-closed result */ }
      }
      return resultFor('TECHNICAL_FAILURE', plan, null, 'persistence_failure');
    } finally {
      if (client) client.release();
    }
  }

  return Object.freeze({ registerOperationalOwner, tableName: qualifiedTableName });
}

module.exports = {
  DEFAULT_TABLE_NAME,
  createRuntimeOperationalOwnerIdentityPostgres,
  normalizeRow,
  validateTableName
};
