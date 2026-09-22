'use strict';

const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_RESOURCE_TABLE = 'hermes.public_web_canary_single_use_resources';
const DEFAULT_COMMIT_TABLE = 'hermes.public_web_canary_atomic_commits';

function requireTableName(value) {
  const parts = typeof value === 'string' ? value.split('.') : [];
  if (parts.length !== 2 || !parts.every((part) => SIMPLE_IDENTIFIER.test(part))) {
    throw new TypeError('public_web_canary_atomic_commit_table_name_invalid');
  }
  return value;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('public_web_canary_atomic_commit_pool_invalid');
}

function blocked(reason, errors = []) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_COMMIT_BLOCKED',
    reason,
    errors: Object.freeze([...errors]),
    transaction_committed: false,
    resources_consumed: false,
    execution_reserved: false,
    execution_started: false,
    external_network_called: false,
    production_allowed: false
  });
}

function createPublicWebCanaryThirdAtomicResourceCommitPostgres({
  pool,
  resourceTableName = DEFAULT_RESOURCE_TABLE,
  commitTableName = DEFAULT_COMMIT_TABLE
} = {}) {
  requirePool(pool);
  const resources = requireTableName(resourceTableName);
  const commits = requireTableName(commitTableName);

  async function commitAtomicResources(input = {}) {
    const planResult = input.transaction_plan_result || {};
    const plan = planResult.atomic_resource_transaction_plan || {};
    if (
      planResult.ok !== true ||
      planResult.status !== 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_RESERVATION_PLAN_READY_NOT_COMMITTED_NOT_EXECUTED' ||
      planResult.transaction_plan_ready !== true ||
      planResult.transaction_started !== false ||
      planResult.state_written !== false ||
      planResult.resources_consumed !== false ||
      planResult.execution_reserved !== false ||
      planResult.execution_started !== false ||
      planResult.external_network_called !== false ||
      planResult.production_allowed !== false ||
      input.production_allowed !== false
    ) return blocked('atomic_transaction_plan_required');

    const ids = {
      trial_id: plan.trial_id,
      official_authorization_id: plan.official_authorization_id,
      grant_id: plan.grant_id,
      reservation_id: plan.reservation_id
    };
    if (Object.values(ids).some((value) => typeof value !== 'string' || value.length === 0)) {
      return blocked('resource_identity_invalid');
    }

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;

      const replay = await client.query(
        `SELECT trial_id, official_authorization_id, grant_id, reservation_id FROM ${commits} WHERE trial_id = $1 FOR UPDATE`,
        [ids.trial_id]
      );
      if (replay.rowCount === 1) {
        const row = replay.rows[0];
        const identical = row.official_authorization_id === ids.official_authorization_id
          && row.grant_id === ids.grant_id
          && row.reservation_id === ids.reservation_id;
        await client.query('ROLLBACK');
        began = false;
        return blocked(identical ? 'replay_forbidden' : 'trial_commit_conflict');
      }

      const locked = await client.query(
        `SELECT resource_type, resource_id, trial_id, state, expires_at
         FROM ${resources}
         WHERE (resource_type = 'OFFICIAL_AUTHORIZATION' AND resource_id = $1)
            OR (resource_type = 'GRANT' AND resource_id = $2)
            OR (resource_type = 'RESERVATION' AND resource_id = $3)
         FOR UPDATE`,
        [ids.official_authorization_id, ids.grant_id, ids.reservation_id]
      );
      if (locked.rowCount !== 3) throw new Error('single_use_resource_set_incomplete');

      const byType = new Map(locked.rows.map((row) => [row.resource_type, row]));
      for (const type of ['OFFICIAL_AUTHORIZATION', 'GRANT', 'RESERVATION']) {
        const row = byType.get(type);
        if (!row || row.trial_id !== ids.trial_id || row.state !== 'AVAILABLE') {
          throw new Error(`single_use_resource_unavailable::${type}`);
        }
        if (type !== 'RESERVATION' && (!row.expires_at || new Date(row.expires_at).getTime() <= Date.now())) {
          throw new Error(`single_use_resource_expired::${type}`);
        }
      }

      const consumed = await client.query(
        `UPDATE ${resources}
         SET state = 'CONSUMED', updated_at = CURRENT_TIMESTAMP
         WHERE trial_id = $1
           AND ((resource_type = 'OFFICIAL_AUTHORIZATION' AND resource_id = $2)
             OR (resource_type = 'GRANT' AND resource_id = $3))
           AND state = 'AVAILABLE'
           AND expires_at > CURRENT_TIMESTAMP`,
        [ids.trial_id, ids.official_authorization_id, ids.grant_id]
      );
      if (consumed.rowCount !== 2) throw new Error('single_use_consumption_cas_failed');

      const reserved = await client.query(
        `UPDATE ${resources}
         SET state = 'EXECUTION_RESERVED', updated_at = CURRENT_TIMESTAMP
         WHERE resource_type = 'RESERVATION' AND resource_id = $1 AND trial_id = $2 AND state = 'AVAILABLE'`,
        [ids.reservation_id, ids.trial_id]
      );
      if (reserved.rowCount !== 1) throw new Error('execution_reservation_cas_failed');

      const inserted = await client.query(
        `INSERT INTO ${commits} (trial_id, official_authorization_id, grant_id, reservation_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING trial_id`,
        [ids.trial_id, ids.official_authorization_id, ids.grant_id, ids.reservation_id]
      );
      if (inserted.rowCount !== 1) throw new Error('durable_replay_commit_conflict');

      await client.query('COMMIT');
      began = false;
      return Object.freeze({
        ok: true,
        status: 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_COMMITTED_EXECUTION_RESERVED_NOT_EXECUTED',
        ...ids,
        transaction_committed: true,
        resources_consumed: true,
        execution_reserved: true,
        execution_started: false,
        external_network_called: false,
        production_allowed: false,
        next_gate: 'FINAL_EXECUTION_ENTRY_GATE'
      });
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return blocked('atomic_transaction_failed', [error.message]);
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    commitAtomicResources,
    resourceTableName: resources,
    commitTableName: commits
  });
}

module.exports = {
  DEFAULT_RESOURCE_TABLE,
  DEFAULT_COMMIT_TABLE,
  createPublicWebCanaryThirdAtomicResourceCommitPostgres
};
