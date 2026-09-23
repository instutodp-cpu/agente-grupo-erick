'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPublicWebCanaryThirdExecutionClaimPostgres } =
  require('../src/adapters/postgres/public-web-canary-third-execution-claim-postgres');

function boundary() {
  return {
    ok: true,
    status: 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED',
    side_effect_boundary_ready: true,
    execution_command_prepared: true,
    execution_started: false,
    external_network_called: false,
    production_allowed: false,
    execution_command: {
      trial_id: 'trial-3', official_authorization_id: 'official-3',
      preparatory_authorization_id: 'prep-3', grant_id: 'grant-3', reservation_id: 'reservation-3',
      environment: 'staging', target_origin: 'https://example.com', target_path: '/',
      method: 'GET', port: 443, maximum_requests: 1, rollout_percentage: 1,
      redirects_allowed: false, production_allowed: false,
      confirmed_at: '2026-09-22T23:59:30.000Z', confirmation_maximum_age_ms: 120000,
      single_use: true, execution_started: false, external_network_called: false
    }
  };
}

function pool({ claimRows = 1, reservationState = 'EXECUTION_RESERVED' } = {}) {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: null, rows: [] };
      if (sql.includes('FROM hermes.public_web_canary_atomic_commits')) return {
        rowCount: 1, rows: [{ trial_id: 'trial-3', official_authorization_id: 'official-3', grant_id: 'grant-3', reservation_id: 'reservation-3' }]
      };
      if (sql.includes('FROM hermes.public_web_canary_single_use_resources')) return { rowCount: 1, rows: [{ state: reservationState }] };
      if (sql.includes('INSERT INTO hermes.public_web_canary_execution_claims')) return {
        rowCount: claimRows, rows: claimRows ? [{ trial_id: 'trial-3', claimed_at: '2026-09-23T00:00:00Z' }] : []
      };
      throw new Error('unexpected_query');
    },
    release() {}
  };
  return { connect: async () => client, queries };
}

test('atomically claims an already committed and reserved execution without network', async () => {
  const db = pool();
  const adapter = createPublicWebCanaryThirdExecutionClaimPostgres({ pool: db });
  const result = await adapter.claimExecution({ side_effect_boundary: boundary(), production_allowed: false });
  assert.equal(result.ok, true);
  assert.equal(result.execution_claimed, true);
  assert.equal(result.execution_started, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(db.queries.filter((q) => q === 'COMMIT').length, 1);
});

test('replay/conflict fails closed and rolls back', async () => {
  const db = pool({ claimRows: 0 });
  const result = await createPublicWebCanaryThirdExecutionClaimPostgres({ pool: db })
    .claimExecution({ side_effect_boundary: boundary(), production_allowed: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'execution_claim_replay_or_stale_confirmation');
  assert.equal(result.external_network_called, false);
  assert.equal(db.queries.includes('ROLLBACK'), true);
});

test('requires durable execution reservation and exact approved command', async () => {
  const db = pool({ reservationState: 'AVAILABLE' });
  const adapter = createPublicWebCanaryThirdExecutionClaimPostgres({ pool: db });
  assert.equal((await adapter.claimExecution({ side_effect_boundary: boundary(), production_allowed: false })).ok, false);
  const drift = boundary();
  drift.execution_command.maximum_requests = 2;
  assert.equal((await adapter.claimExecution({ side_effect_boundary: drift, production_allowed: false })).ok, false);
});

test('production and runtime activity remain impossible in this layer', async () => {
  const db = pool();
  const adapter = createPublicWebCanaryThirdExecutionClaimPostgres({ pool: db });
  assert.equal((await adapter.claimExecution({ side_effect_boundary: boundary(), production_allowed: true })).ok, false);
  const b = boundary();
  b.execution_started = true;
  assert.equal((await adapter.claimExecution({ side_effect_boundary: b, production_allowed: false })).ok, false);
  assert.equal(db.queries.length, 0);
});
