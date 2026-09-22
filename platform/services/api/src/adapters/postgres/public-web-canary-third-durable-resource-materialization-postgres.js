'use strict';

const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_RESOURCE_TABLE = 'hermes.public_web_canary_single_use_resources';

function requireTableName(value) {
  const parts = typeof value === 'string' ? value.split('.') : [];
  if (parts.length !== 2 || !parts.every((part) => SIMPLE_IDENTIFIER.test(part))) {
    throw new TypeError('public_web_canary_resource_materialization_table_name_invalid');
  }
  return value;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('public_web_canary_resource_materialization_pool_invalid');
  }
}

function blocked(reason, errors = []) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_DURABLE_RESOURCE_MATERIALIZATION_BLOCKED',
    reason,
    errors: Object.freeze([...errors]),
    durable_resources_materialized: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false
  });
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function createPublicWebCanaryThirdDurableResourceMaterializationPostgres({
  pool,
  resourceTableName = DEFAULT_RESOURCE_TABLE
} = {}) {
  requirePool(pool);
  const resources = requireTableName(resourceTableName);

  async function materializeDurableResources(input = {}) {
    const officialStep = input.official_authorization_issuance || {};
    const grantStep = input.grant_materialization || {};
    const reservationStep = input.reservation_materialization || {};
    const official = officialStep.official_execution_authorization || {};
    const grant = grantStep.grant || {};
    const reservation = reservationStep.reservation || {};

    if (
      officialStep.ok !== true ||
      officialStep.status !== 'THIRD_CANARY_OFFICIAL_EXECUTION_AUTHORIZATION_ISSUED_NOT_CONSUMED_NOT_EXECUTED' ||
      officialStep.official_execution_authorization_issued !== true ||
      officialStep.execution_started !== false ||
      officialStep.external_network_called !== false
    ) return blocked('official_authorization_issuance_required');

    if (
      grantStep.ok !== true ||
      grantStep.status !== 'THIRD_CANARY_GRANT_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION' ||
      grantStep.grant_materialized !== true ||
      grantStep.execution_started !== false ||
      grantStep.external_network_called !== false
    ) return blocked('grant_materialization_required');

    if (
      reservationStep.ok !== true ||
      reservationStep.status !== 'THIRD_CANARY_RESERVATION_MATERIALIZED_NOT_RESERVED_FOR_EXECUTION' ||
      reservationStep.reservation_materialized !== true ||
      reservationStep.execution_reserved !== false ||
      reservationStep.execution_started !== false ||
      reservationStep.external_network_called !== false
    ) return blocked('reservation_materialization_required');

    const ids = {
      trial_id: input.trial_id,
      official_authorization_id: official.authorization_id,
      grant_id: grant.grant_id,
      reservation_id: reservation.reservation_id
    };
    if (Object.values(ids).some((value) => !nonEmpty(value))) return blocked('resource_identity_invalid');

    if (
      officialStep.trial_id !== ids.trial_id ||
      grantStep.trial_id !== ids.trial_id ||
      reservationStep.trial_id !== ids.trial_id ||
      official.trial_id !== ids.trial_id ||
      grant.trial_id !== ids.trial_id ||
      reservation.trial_id !== ids.trial_id ||
      officialStep.grant_id !== ids.grant_id ||
      officialStep.reservation_id !== ids.reservation_id ||
      reservation.grant_id !== ids.grant_id
    ) return blocked('resource_binding_mismatch');

    if (
      grant.environment !== 'staging' ||
      grant.target_origin !== 'https://example.com' ||
      grant.target_path !== '/' ||
      grant.method !== 'GET' ||
      grant.port !== 443 ||
      grant.maximum_requests !== 1 ||
      grant.rollout_percentage !== 1 ||
      grant.single_use !== true ||
      grant.used !== false ||
      grant.revoked !== false ||
      reservation.environment !== 'staging' ||
      reservation.target_origin !== 'https://example.com' ||
      reservation.target_path !== '/' ||
      reservation.method !== 'GET' ||
      reservation.port !== 443 ||
      reservation.maximum_requests !== 1 ||
      reservation.rollout_percentage !== 1 ||
      reservation.single_use !== true ||
      reservation.used !== false ||
      reservation.execution_reserved !== false
    ) return blocked('approved_resource_scope_required');

    const officialExpiry = Date.parse(String(official.expires_at || ''));
    const grantExpiry = Date.parse(String(grant.expires_at || ''));
    if (!Number.isFinite(officialExpiry) || !Number.isFinite(grantExpiry)) return blocked('resource_expiry_required');

    if (
      input.production_allowed !== false ||
      input.execute === true ||
      input.start_execution === true ||
      input.reserve_execution === true ||
      input.provider_invoked === true ||
      input.transport_invoked === true ||
      input.external_network_called === true
    ) return blocked('runtime_action_forbidden');

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;

      const inserted = await client.query(
        `INSERT INTO ${resources} (resource_type, resource_id, trial_id, state, expires_at)
         VALUES
           ('OFFICIAL_AUTHORIZATION', $1, $4, 'AVAILABLE', $5),
           ('GRANT', $2, $4, 'AVAILABLE', $6),
           ('RESERVATION', $3, $4, 'AVAILABLE', NULL)
         ON CONFLICT DO NOTHING
         RETURNING resource_type, resource_id`,
        [ids.official_authorization_id, ids.grant_id, ids.reservation_id, ids.trial_id, official.expires_at, grant.expires_at]
      );
      if (inserted.rowCount !== 3) throw new Error('durable_resource_replay_or_conflict');

      const verified = await client.query(
        `SELECT resource_type, resource_id, trial_id, state, expires_at
         FROM ${resources}
         WHERE (resource_type = 'OFFICIAL_AUTHORIZATION' AND resource_id = $1)
            OR (resource_type = 'GRANT' AND resource_id = $2)
            OR (resource_type = 'RESERVATION' AND resource_id = $3)
         FOR UPDATE`,
        [ids.official_authorization_id, ids.grant_id, ids.reservation_id]
      );
      if (verified.rowCount !== 3 || verified.rows.some((row) => row.trial_id !== ids.trial_id || row.state !== 'AVAILABLE')) {
        throw new Error('durable_resource_verification_failed');
      }

      const now = Date.now();
      if (officialExpiry <= now || grantExpiry <= now) throw new Error('durable_resource_expired');

      await client.query('COMMIT');
      began = false;
      return Object.freeze({
        ok: true,
        status: 'THIRD_CANARY_DURABLE_SINGLE_USE_RESOURCES_MATERIALIZED_AVAILABLE_NOT_EXECUTED',
        ...ids,
        durable_resources_materialized: true,
        resource_state: 'AVAILABLE',
        execution_reserved: false,
        execution_started: false,
        provider_invoked: false,
        transport_invoked: false,
        external_network_called: false,
        production_allowed: false,
        next_gate: 'ATOMIC_RESOURCE_TRANSACTION_COMMIT'
      });
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return blocked('durable_resource_materialization_failed', [error.message]);
    } finally {
      client.release();
    }
  }

  return Object.freeze({ materializeDurableResources, resourceTableName: resources });
}

module.exports = {
  DEFAULT_RESOURCE_TABLE,
  createPublicWebCanaryThirdDurableResourceMaterializationPostgres
};
