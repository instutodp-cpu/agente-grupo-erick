'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preparePublicWebThirdCanaryPreExecution
} = require('../src/core/public-web-canary-third-pre-execution-orchestrator');

const NOW = '2026-09-22T20:00:00.000Z';
const ids = {
  trial_id: 'trial-3',
  official_authorization_id: 'official-3',
  preparatory_authorization_id: 'prep-3',
  grant_id: 'grant-3',
  reservation_id: 'reservation-3'
};

function durableState() {
  return {
    ok: true,
    status: 'THIRD_CANARY_DURABLE_ATOMIC_RESOURCE_STATE_READY_NOT_WRITTEN_NOT_EXECUTED',
    durable_state_ready: true,
    transaction_started: false,
    state_written: false,
    resources_consumed: false,
    execution_reserved: false,
    execution_started: false,
    external_network_called: false,
    durable_state_contract: {
      ...ids,
      atomic_compare_and_set_required: true,
      transactional_rollback_required: true,
      durable_replay_protection_required: true,
      unique_resource_constraints_required: true,
      shared_across_runtime_instances_required: true,
      production_backed_store_required: true,
      mutation_in_this_layer: false,
      execution_in_this_layer: false,
      external_network_in_this_layer: false
    }
  };
}

function input() {
  return {
    ...ids,
    execution_scope: {
      environment: 'staging', target_origin: 'https://example.com', target_path: '/',
      method: 'GET', port: 443, maximum_requests: 1, rollout_percentage: 1
    },
    official_authorization_issuance: {
      official_execution_authorization: {
        authorization_id: 'official-3', trial_id: 'trial-3', environment: 'staging',
        issued_at: '2026-09-22T19:59:30.000Z', expires_at: '2026-09-22T20:01:30.000Z', used: false
      }
    },
    grant_materialization: {},
    reservation_materialization: {},
    durable_atomic_resource_state: durableState(),
    production_allowed: false
  };
}

function deps(overrides = {}) {
  return {
    durableResourceMaterializer: {
      async materializeDurableResources() {
        return {
          ok: true,
          status: 'THIRD_CANARY_DURABLE_SINGLE_USE_RESOURCES_MATERIALIZED_AVAILABLE_NOT_EXECUTED',
          trial_id: 'trial-3', official_authorization_id: 'official-3', grant_id: 'grant-3', reservation_id: 'reservation-3',
          execution_started: false, external_network_called: false
        };
      }
    },
    atomicResourceCommitter: {
      async commitAtomicResources() {
        return {
          ok: true,
          status: 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_COMMITTED_EXECUTION_RESERVED_NOT_EXECUTED',
          trial_id: 'trial-3', official_authorization_id: 'official-3', grant_id: 'grant-3', reservation_id: 'reservation-3',
          transaction_committed: true, resources_consumed: true, execution_reserved: true,
          execution_started: false, external_network_called: false, production_allowed: false
        };
      }
    },
    ...overrides
  };
}

test('orchestrates durable materialization, atomic commit and final entry without network execution', async () => {
  const calls = [];
  const d = deps();
  const m = d.durableResourceMaterializer.materializeDurableResources;
  const c = d.atomicResourceCommitter.commitAtomicResources;
  d.durableResourceMaterializer.materializeDurableResources = async (x) => { calls.push('materialize'); return m(x); };
  d.atomicResourceCommitter.commitAtomicResources = async (x) => { calls.push('commit'); return c(x); };
  const result = await preparePublicWebThirdCanaryPreExecution(input(), d, { clock: () => NOW });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'THIRD_CANARY_PRE_EXECUTION_ORCHESTRATION_READY_NOT_STARTED');
  assert.deepEqual(calls, ['materialize', 'commit']);
  assert.equal(result.durable_resources_materialized, true);
  assert.equal(result.resources_consumed, true);
  assert.equal(result.execution_reserved, true);
  assert.equal(result.execution_entry_ready, true);
  assert.equal(result.execution_started, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.required_confirmation, 'EXECUTAR CANARY PUBLIC WEB');
});

test('fails closed before dependencies on execution, network or scope drift', async () => {
  const unreachable = { durableResourceMaterializer: { materializeDurableResources() { throw new Error('unreachable'); } } };
  for (const patch of [
    { execute: true }, { start_execution: true }, { provider_invoked: true },
    { transport_invoked: true }, { external_network_called: true }, { production_allowed: true },
    { execution_scope: { ...input().execution_scope, target_origin: 'https://other.example' } }
  ]) {
    const result = await preparePublicWebThirdCanaryPreExecution({ ...input(), ...patch }, unreachable);
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});

test('stops immediately when materialization or atomic commit fails', async () => {
  let commitCalled = false;
  const materializationFailure = deps({
    durableResourceMaterializer: { async materializeDurableResources() { return { ok: false }; } },
    atomicResourceCommitter: { async commitAtomicResources() { commitCalled = true; return { ok: true }; } }
  });
  assert.equal((await preparePublicWebThirdCanaryPreExecution(input(), materializationFailure)).ok, false);
  assert.equal(commitCalled, false);

  const commitFailure = deps({
    atomicResourceCommitter: { async commitAtomicResources() { return { ok: false }; } }
  });
  const result = await preparePublicWebThirdCanaryPreExecution(input(), commitFailure);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'ATOMIC_COMMIT');
});

test('final gate freshness remains mandatory and no side-effect authorization is accepted here', async () => {
  const stale = input();
  stale.official_authorization_issuance.official_execution_authorization.expires_at = '2026-09-22T19:59:59.000Z';
  const result = await preparePublicWebThirdCanaryPreExecution(stale, deps(), { clock: () => NOW });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'FINAL_ENTRY_GATE');
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
});
