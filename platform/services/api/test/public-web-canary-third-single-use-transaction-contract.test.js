'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REQUIRED_STEPS,
  preparePublicWebThirdCanarySingleUseTransactionContract
} = require('../src/core/public-web-canary-third-single-use-transaction-contract');

function gate(patch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_GATE_READY_NOT_CONSUMED_NOT_RESERVED_NOT_EXECUTED',
    trial_id: 'trial-3',
    atomic_resource_plan: {
      trial_id: 'trial-3',
      official_authorization_id: 'official-auth-3',
      preparatory_authorization_id: 'prep-auth-3',
      grant_id: 'grant-3',
      reservation_id: 'reservation-3',
      required_order: [...REQUIRED_STEPS],
      rollback_required_on_any_failure: true,
      same_runtime_registry_lifecycle_required: true,
      durable_replay_state_required_before_external_execution: true,
      start_execution_in_this_gate: false,
      external_network_in_this_gate: false
    },
    official_authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    ...patch
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    official_authorization_id: 'official-auth-3',
    preparatory_authorization_id: 'prep-auth-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    atomic_resource_gate: gate(),
    production_allowed: false,
    ...patch
  };
}

test('prepares immutable transaction contract without starting a transaction', () => {
  const result = preparePublicWebThirdCanarySingleUseTransactionContract(input());
  assert.equal(result.ok, true);
  assert.equal(result.transaction_contract_ready, true);
  assert.equal(result.transaction_started, false);
  assert.deepEqual(result.transaction_contract.required_steps, REQUIRED_STEPS);
  assert.equal(result.transaction_contract.single_atomic_boundary_required, true);
  assert.equal(result.transaction_contract.rollback_on_any_mutation_failure, true);
  assert.equal(result.transaction_contract.commit_only_after_all_mutations_succeed, true);
  assert.equal(result.transaction_contract.durable_replay_state_required, true);
  assert.equal(result.transaction_contract.partial_commit_forbidden, true);
  assert.equal(result.official_authorization_consumed, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
});

test('fails closed when identities or transaction order differ', () => {
  for (const patch of [
    { trial_id: 'other' },
    { official_authorization_id: 'other' },
    { preparatory_authorization_id: 'other' },
    { grant_id: 'other' },
    { reservation_id: 'other' }
  ]) assert.equal(preparePublicWebThirdCanarySingleUseTransactionContract(input(patch)).ok, false);

  const bad = gate();
  bad.atomic_resource_plan = {
    ...bad.atomic_resource_plan,
    required_order: [...REQUIRED_STEPS].reverse()
  };
  assert.equal(preparePublicWebThirdCanarySingleUseTransactionContract(input({
    atomic_resource_gate: bad
  })).ok, false);
});

test('requires rollback, durable replay and same-runtime lifecycle guarantees', () => {
  for (const key of [
    'rollback_required_on_any_failure',
    'same_runtime_registry_lifecycle_required',
    'durable_replay_state_required_before_external_execution'
  ]) {
    const bad = gate();
    bad.atomic_resource_plan = { ...bad.atomic_resource_plan, [key]: false };
    assert.equal(preparePublicWebThirdCanarySingleUseTransactionContract(input({
      atomic_resource_gate: bad
    })).ok, false);
  }
});

test('forbids transaction mutation, mutable dependencies, execution and network', () => {
  for (const patch of [
    { production_allowed: true },
    { begin_transaction: true },
    { commit_transaction: true },
    { rollback_transaction: true },
    { consume_authorization: true },
    { consume_grant: true },
    { consume_reservation: true },
    { reserve_execution: true },
    { start_execution: true },
    { execute: true },
    { authorization_registry: {} },
    { grant_registry: {} },
    { reservation_registry: {} },
    { persistence_client: {} },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) assert.equal(preparePublicWebThirdCanarySingleUseTransactionContract(input(patch)).ok, false);
});
