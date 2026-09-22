'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preparePublicWebThirdCanaryAtomicResourceTransactionReservation
} = require('../src/core/public-web-canary-third-atomic-resource-transaction-reservation');

function prior() {
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
      trial_id: 'trial-3',
      official_authorization_id: 'official-3',
      preparatory_authorization_id: 'prep-3',
      grant_id: 'grant-3',
      reservation_id: 'reservation-3',
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

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    official_authorization_id: 'official-3',
    preparatory_authorization_id: 'prep-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    durable_atomic_resource_state: prior(),
    production_allowed: false,
    ...patch
  };
}

test('prepares an atomic transaction/reservation plan without committing it', () => {
  const result = preparePublicWebThirdCanaryAtomicResourceTransactionReservation(input());
  assert.equal(result.ok, true);
  assert.equal(result.transaction_plan_ready, true);
  assert.equal(result.transaction_started, false);
  assert.equal(result.state_written, false);
  assert.equal(result.resources_consumed, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.deepEqual(result.atomic_resource_transaction_plan.atomic_mutations, [
    'MARK_OFFICIAL_AUTHORIZATION_CONSUMED',
    'MARK_GRANT_CONSUMED',
    'MARK_RESERVATION_EXECUTION_RESERVED',
    'WRITE_DURABLE_REPLAY_COMMIT'
  ]);
});

test('fails closed on resource identity mismatch', () => {
  for (const key of ['trial_id', 'official_authorization_id', 'preparatory_authorization_id', 'grant_id', 'reservation_id']) {
    assert.equal(preparePublicWebThirdCanaryAtomicResourceTransactionReservation(input({ [key]: 'other' })).ok, false);
  }
});

test('rejects weakened durable-state guarantees', () => {
  for (const key of [
    'atomic_compare_and_set_required',
    'transactional_rollback_required',
    'durable_replay_protection_required',
    'unique_resource_constraints_required',
    'shared_across_runtime_instances_required',
    'production_backed_store_required'
  ]) {
    const p = prior();
    p.durable_state_contract = { ...p.durable_state_contract, [key]: false };
    assert.equal(preparePublicWebThirdCanaryAtomicResourceTransactionReservation(input({
      durable_atomic_resource_state: p
    })).ok, false);
  }
});

test('forbids clients, registries, mutation, execution and network in planning layer', () => {
  for (const patch of [
    { production_allowed: true },
    { transaction_client: {} },
    { authorization_registry: {} },
    { grant_registry: {} },
    { reservation_registry: {} },
    { begin_transaction: true },
    { write_state: true },
    { commit_transaction: true },
    { consume_authorization: true },
    { consume_grant: true },
    { consume_reservation: true },
    { reserve_execution: true },
    { start_execution: true },
    { execute: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) {
    assert.equal(preparePublicWebThirdCanaryAtomicResourceTransactionReservation(input(patch)).ok, false);
  }
});
