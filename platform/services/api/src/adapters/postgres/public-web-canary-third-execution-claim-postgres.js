'use strict';

const crypto = require('node:crypto');

const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_CLAIM_TABLE = 'hermes.public_web_canary_execution_claims';
const DEFAULT_COMMIT_TABLE = 'hermes.public_web_canary_atomic_commits';
const DEFAULT_RESOURCE_TABLE = 'hermes.public_web_canary_single_use_resources';
const MAX_CONFIRMATION_AGE_MS = 120000;

function table(value) {
  const parts = typeof value === 'string' ? value.split('.') : [];
  if (parts.length !== 2 || !parts.every((part) => SIMPLE_IDENTIFIER.test(part))) throw new TypeError('public_web_canary_execution_claim_table_invalid');
  return value;
}

function blocked(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_DURABLE_EXECUTION_CLAIM_BLOCKED',
    reason,
    execution_claimed: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false
  });
}

function fingerprint(command) {
  const canonical = [
    command.trial_id, command.official_authorization_id, command.preparatory_authorization_id,
    command.grant_id, command.reservation_id, command.environment, command.target_origin,
    command.target_path, command.method, command.port, command.maximum_requests,
    command.rollout_percentage, command.redirects_allowed, command.production_allowed,
    command.confirmed_at, command.confirmation_maximum_age_ms, command.single_use
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function createPublicWebCanaryThirdExecutionClaimPostgres({
  pool,
  claimTableName = DEFAULT_CLAIM_TABLE,
  commitTableName = DEFAULT_COMMIT_TABLE,
  resourceTableName = DEFAULT_RESOURCE_TABLE
} = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('public_web_canary_execution_claim_pool_invalid');
  const claims = table(claimTableName);
  const commits = table(commitTableName);
  const resources = table(resourceTableName);

  async function claimExecution(input = {}) {
    const boundary = input.side_effect_boundary || {};
    const command = boundary.execution_command || {};
    if (
      boundary.ok !== true ||
      boundary.status !== 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED' ||
      boundary.side_effect_boundary_ready !== true ||
      boundary.execution_command_prepared !== true ||
      boundary.execution_started !== false ||
      boundary.external_network_called !== false ||
      boundary.production_allowed !== false ||
      input.production_allowed !== false
    ) return blocked('side_effect_boundary_required');

    if (
      !command.trial_id || !command.official_authorization_id || !command.grant_id || !command.reservation_id ||
      command.environment !== 'staging' || command.target_origin !== 'https://example.com' ||
      command.target_path !== '/' || command.method !== 'GET' || command.port !== 443 ||
      command.maximum_requests !== 1 || command.rollout_percentage !== 1 ||
      command.redirects_allowed !== false || command.production_allowed !== false ||
      command.single_use !== true || command.execution_started !== false ||
      command.external_network_called !== false || command.confirmation_maximum_age_ms !== MAX_CONFIRMATION_AGE_MS
    ) return blocked('approved_single_request_command_required');

    const confirmedAt = Date.parse(String(command.confirmed_at || ''));
    if (!Number.isFinite(confirmedAt)) return blocked('confirmation_timestamp_invalid');

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;

      const committed = await client.query(
        `SELECT trial_id, official_authorization_id, grant_id, reservation_id
         FROM ${commits} WHERE trial_id = $1 FOR UPDATE`,
        [command.trial_id]
      );
      if (committed.rowCount !== 1) throw new Error('atomic_commit_required');
      const commit = committed.rows[0];
      if (
        commit.official_authorization_id !== command.official_authorization_id ||
        commit.grant_id !== command.grant_id ||
        commit.reservation_id !== command.reservation_id
      ) throw new Error('atomic_commit_binding_mismatch');

      const reservation = await client.query(
        `SELECT state FROM ${resources}
         WHERE resource_type = 'RESERVATION' AND resource_id = $1 AND trial_id = $2 FOR UPDATE`,
        [command.reservation_id, command.trial_id]
      );
      if (reservation.rowCount !== 1 || reservation.rows[0].state !== 'EXECUTION_RESERVED') {
        throw new Error('execution_reservation_required');
      }

      const inserted = await client.query(
        `INSERT INTO ${claims}
          (trial_id, reservation_id, official_authorization_id, grant_id, command_fingerprint, confirmed_at, production_allowed)
         SELECT $1, $2, $3, $4, $5, $6::timestamptz, false
         WHERE $6::timestamptz <= CURRENT_TIMESTAMP
           AND $6::timestamptz > CURRENT_TIMESTAMP - INTERVAL '120 seconds'
         ON CONFLICT DO NOTHING
         RETURNING trial_id, claimed_at`,
        [command.trial_id, command.reservation_id, command.official_authorization_id, command.grant_id, fingerprint(command), command.confirmed_at]
      );
      if (inserted.rowCount !== 1) throw new Error('execution_claim_replay_or_stale_confirmation');

      await client.query('COMMIT');
      began = false;
      return Object.freeze({
        ok: true,
        status: 'THIRD_CANARY_DURABLE_EXECUTION_CLAIMED_NOT_STARTED_NOT_EXECUTED',
        trial_id: command.trial_id,
        reservation_id: command.reservation_id,
        command_fingerprint: fingerprint(command),
        execution_claimed: true,
        execution_started: false,
        provider_invoked: false,
        transport_invoked: false,
        external_network_called: false,
        production_allowed: false,
        next_gate: 'CONTROLLED_SINGLE_REQUEST_EXECUTION_ADAPTER'
      });
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      return blocked(error.message || 'execution_claim_failed');
    } finally {
      client.release();
    }
  }

  return Object.freeze({ claimExecution, claimTableName: claims });
}

module.exports = {
  DEFAULT_CLAIM_TABLE,
  MAX_CONFIRMATION_AGE_MS,
  createPublicWebCanaryThirdExecutionClaimPostgres
};
