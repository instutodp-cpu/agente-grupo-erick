'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REQUIRED_CAPABILITIES,
  preparePublicWebThirdCanaryDurableAtomicResourceState
} = require('../src/core/public-web-canary-third-durable-atomic-resource-state');

function prior() {
  return {
    ok: true,
    status: 'THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_READY_NOT_STARTED_NOT_EXECUTED',
    transaction_contract_ready: true,
    transaction_started: false,
    execution_started: false,
    external_network_called: false,
    transaction_contract: {
      trial_id: 'trial-3',
      official_authorization_id: 'official-3',
      preparatory_authorization_id: 'prep-3',
      grant_id: 'grant-3',
      reservation_id: 'reservation-3',
      single_atomic_boundary_required: true,
      rollback_on_any_mutation_failure: true,
      commit_only_after_all_mutations_succeed: true,
      durable_replay_state_required: true,
      partial_commit_forbidden: true,
      retry_after_partial_failure_forbidden: true,
      execution_start_forbidden: true,
      external_network_forbidden: true
    }
  };
}

function adapter(patch = {}) {
  return {
    kind: 'durable_transactional_store',
    durable: true,
    shared_across_runtime_instances: true,
    production_backed: true,
    capabilities: [...REQUIRED_CAPABILITIES],
    ...patch
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    official_authorization_id: 'official-3',
    preparatory_authorization_id: 'prep-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    single_use_transaction_contract: prior(),
    durable_store_adapter: adapter(),
    production_allowed: false,
    ...patch
  };
}

test('accepts only a durable transactional store contract without writing state', () => {
  const result = preparePublicWebThirdCanaryDurableAtomicResourceState(input());
  assert.equal(result.ok, true);
  assert.equal(result.durable_state_ready, true);
  assert.equal(result.transaction_started, false);
  assert.equal(result.state_written, false);
  assert.equal(result.resources_consumed, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.deepEqual(result.durable_state_contract.required_capabilities, REQUIRED_CAPABILITIES);
});

test('fails closed on resource identity mismatch', () => {
  for (const key of ['trial_id', 'official_authorization_id', 'preparatory_authorization_id', 'grant_id', 'reservation_id']) {
    assert.equal(preparePublicWebThirdCanaryDurableAtomicResourceState(input({ [key]: 'other' })).ok, false);
  }
});

test('rejects non-durable, process-local, non-production-backed or incomplete stores', () => {
  for (const store of [
    adapter({ durable: false }),
    adapter({ shared_across_runtime_instances: false }),
    adapter({ production_backed: false }),
    adapter({ capabilities: REQUIRED_CAPABILITIES.slice(1) }),
    { kind: 'in_memory', durable: true, shared_across_runtime_instances: true, production_backed: true, capabilities: [...REQUIRED_CAPABILITIES] }
  ]) {
    assert.equal(preparePublicWebThirdCanaryDurableAtomicResourceState(input({ durable_store_adapter: store })).ok, false);
  }
});

test('rejects weakened transaction guarantees', () => {
  for (const key of [
    'single_atomic_boundary_required',
    'rollback_on_any_mutation_failure',
    'commit_only_after_all_mutations_succeed',
    'durable_replay_state_required',
    'partial_commit_forbidden',
    'retry_after_partial_failure_forbidden',
    'execution_start_forbidden',
    'external_network_forbidden'
  ]) {
    const p = prior();
    p.transaction_contract = { ...p.transaction_contract, [key]: false };
    assert.equal(preparePublicWebThirdCanaryDurableAtomicResourceState(input({
      single_use_transaction_contract: p
    })).ok, false);
  }
});

test('forbids writes, transaction start, resource consumption, execution and network', () => {
  for (const patch of [
    { production_allowed: true },
    { begin_transaction: true },
    { write_state: true },
    { commit_transaction: true },
    { consume_resources: true },
    { reserve_execution: true },
    { start_execution: true },
    { execute: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) {
    assert.equal(preparePublicWebThirdCanaryDurableAtomicResourceState(input(patch)).ok, false);
  }
});
