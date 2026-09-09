'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  reject,
  resolved,
  rootValidationReason,
  keyValidationReason,
  validateResolutionInput,
  validateRootKeyRecord,
  validateRootState
} = require('../../core/canonical-governance-root-active-authority-resolution-contract');

const DEFAULT_TABLES = Object.freeze({
  installations: 'hermes.installations',
  roots: 'hermes.governance_root_subjects',
  keys: 'hermes.governance_root_keys'
});
const TABLE_KEYS = Object.freeze(Object.keys(DEFAULT_TABLES));
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function validTableName(value) {
  const parts = typeof value === 'string' ? value.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function tablesWithOverrides(overrides = {}) {
  const tables = { ...DEFAULT_TABLES, ...overrides };
  if (TABLE_KEYS.some((key) => !validTableName(tables[key]))) throw new TypeError('governance_root_resolution_table_name_invalid');
  return Object.freeze(tables);
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('governance_root_resolution_pool_invalid');
}

async function rollback(client, began) {
  if (!began || !client) return;
  try { await client.query('ROLLBACK'); } catch { /* preserve fail-closed result */ }
}

function createCanonicalGovernanceRootActiveAuthorityResolutionPostgres({ pool, tables } = {}) {
  requirePool(pool);
  const qualified = tablesWithOverrides(tables);

  async function resolve(input = {}) {
    const inputValidation = validateResolutionInput(input);
    if (!inputValidation.valid) return reject(inputValidation.reason_code);

    const { envelope } = input;
    let client = null;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      began = true;

      const installationResult = await client.query(`
        SELECT installation_id, lifecycle_state
        FROM ${qualified.installations}
        WHERE installation_id = $1
      `, [envelope.installation_id]);
      if (installationResult.rowCount === 0) {
        await rollback(client, began); began = false;
        return reject('UNKNOWN_INSTALLATION');
      }
      if (installationResult.rowCount !== 1) {
        await rollback(client, began); began = false;
        return reject('STATE_AMBIGUOUS');
      }
      if (installationResult.rows[0].lifecycle_state !== 'BOOTSTRAPPED') {
        await rollback(client, began); began = false;
        return reject('INSTALLATION_NOT_ACTIVE');
      }

      const rootResult = await client.query(`
        SELECT installation_id, root_subject_id, root_digest, active_generation, lifecycle_state
        FROM ${qualified.roots}
        WHERE installation_id = $1
      `, [envelope.installation_id]);
      if (rootResult.rowCount === 0) {
        await rollback(client, began); began = false;
        return reject('ROOT_NOT_FOUND');
      }
      if (rootResult.rowCount !== 1) {
        await rollback(client, began); began = false;
        return reject('STATE_AMBIGUOUS');
      }
      const root = rootResult.rows[0];
      const rootValidation = validateRootState(root, {
        installation_id: envelope.installation_id,
        root_subject_id: envelope.root_subject_id,
        root_digest: envelope.root_digest,
        active_generation: envelope.root_generation,
        lifecycle_state: 'ACTIVE'
      });
      if (!rootValidation.valid) {
        await rollback(client, began); began = false;
        return reject(rootValidationReason(rootValidation.errors));
      }

      const activeKeyResult = await client.query(`
        SELECT root_key_id, root_subject_id, generation, algorithm, public_key,
               key_fingerprint, key_digest, lifecycle_state
        FROM ${qualified.keys}
        WHERE root_subject_id = $1 AND lifecycle_state = 'ACTIVE'
      `, [envelope.root_subject_id]);
      if (activeKeyResult.rowCount === 0) {
        await rollback(client, began); began = false;
        return reject('ROOT_KEY_NOT_FOUND');
      }
      if (activeKeyResult.rowCount !== 1) {
        await rollback(client, began); began = false;
        return reject('STATE_AMBIGUOUS');
      }
      const key = activeKeyResult.rows[0];
      const keyValidation = validateRootKeyRecord(key, {
        root_subject_id: envelope.root_subject_id,
        generation: envelope.root_generation,
        root_key_id: envelope.root_key_id,
        key_fingerprint: envelope.root_key_fingerprint,
        key_digest: envelope.root_key_digest
      });
      if (!keyValidation.valid) {
        await rollback(client, began); began = false;
        return reject(keyValidationReason(keyValidation.errors));
      }

      await client.query('COMMIT');
      began = false;
      return cloneFrozen(resolved(root, key));
    } catch {
      await rollback(client, began);
      began = false;
      return reject('DATABASE_READ_FAILED');
    } finally {
      if (client) client.release();
    }
  }

  return Object.freeze({
    resolve,
    tables: qualified
  });
}

module.exports = { createCanonicalGovernanceRootActiveAuthorityResolutionPostgres };
