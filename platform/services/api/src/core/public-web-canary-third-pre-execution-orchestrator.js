'use strict';

const {
  preparePublicWebThirdCanaryAtomicResourceTransactionReservation
} = require('./public-web-canary-third-atomic-resource-transaction-reservation');
const {
  preparePublicWebThirdCanaryFinalExecutionEntry
} = require('./public-web-canary-third-final-execution-entry-gate');

const VERSION = 'public_web_third_canary_pre_execution_orchestrator_v1';

function blocked(reason, stage, detail) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_PRE_EXECUTION_ORCHESTRATION_BLOCKED',
    reason,
    stage,
    detail: detail || null,
    durable_resources_materialized: false,
    resources_consumed: false,
    execution_reserved: false,
    execution_entry_ready: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: VERSION
  });
}

function exactScope(scope = {}) {
  return scope.environment === 'staging'
    && scope.target_origin === 'https://example.com'
    && scope.target_path === '/'
    && scope.method === 'GET'
    && scope.port === 443
    && scope.maximum_requests === 1
    && scope.rollout_percentage === 1;
}

function ids(input) {
  return {
    trial_id: input.trial_id,
    official_authorization_id: input.official_authorization_id,
    preparatory_authorization_id: input.preparatory_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id
  };
}

async function preparePublicWebThirdCanaryPreExecution(input = {}, dependencies = {}, options = {}) {
  if (
    input.production_allowed !== false ||
    input.execute === true ||
    input.start_execution === true ||
    input.provider_invoked === true ||
    input.transport_invoked === true ||
    input.external_network_called === true
  ) return blocked('execution_or_network_forbidden', 'INPUT');

  const identity = ids(input);
  if (Object.values(identity).some((value) => typeof value !== 'string' || value.length === 0)) {
    return blocked('resource_identity_required', 'INPUT');
  }
  if (!exactScope(input.execution_scope)) return blocked('approved_execution_scope_required', 'INPUT');

  const materializer = dependencies.durableResourceMaterializer;
  const committer = dependencies.atomicResourceCommitter;
  if (!materializer || typeof materializer.materializeDurableResources !== 'function') {
    return blocked('durable_resource_materializer_required', 'DEPENDENCIES');
  }
  if (!committer || typeof committer.commitAtomicResources !== 'function') {
    return blocked('atomic_resource_committer_required', 'DEPENDENCIES');
  }

  const materialized = await materializer.materializeDurableResources({
    trial_id: identity.trial_id,
    official_authorization_issuance: input.official_authorization_issuance,
    grant_materialization: input.grant_materialization,
    reservation_materialization: input.reservation_materialization,
    production_allowed: false
  });
  if (
    !materialized ||
    materialized.ok !== true ||
    materialized.status !== 'THIRD_CANARY_DURABLE_SINGLE_USE_RESOURCES_MATERIALIZED_AVAILABLE_NOT_EXECUTED' ||
    materialized.trial_id !== identity.trial_id ||
    materialized.official_authorization_id !== identity.official_authorization_id ||
    materialized.grant_id !== identity.grant_id ||
    materialized.reservation_id !== identity.reservation_id ||
    materialized.execution_started !== false ||
    materialized.external_network_called !== false
  ) return blocked('durable_resource_materialization_failed', 'MATERIALIZATION', materialized);

  const transactionPlan = preparePublicWebThirdCanaryAtomicResourceTransactionReservation({
    ...identity,
    durable_atomic_resource_state: input.durable_atomic_resource_state,
    production_allowed: false
  });
  if (!transactionPlan.ok) return blocked('atomic_transaction_plan_failed', 'TRANSACTION_PLAN', transactionPlan);

  const committed = await committer.commitAtomicResources({
    transaction_plan_result: transactionPlan,
    production_allowed: false
  });
  if (
    !committed ||
    committed.ok !== true ||
    committed.status !== 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_COMMITTED_EXECUTION_RESERVED_NOT_EXECUTED' ||
    committed.trial_id !== identity.trial_id ||
    committed.official_authorization_id !== identity.official_authorization_id ||
    committed.grant_id !== identity.grant_id ||
    committed.reservation_id !== identity.reservation_id ||
    committed.execution_started !== false ||
    committed.external_network_called !== false
  ) return blocked('atomic_resource_commit_failed', 'ATOMIC_COMMIT', committed);

  const official = input.official_authorization_issuance &&
    input.official_authorization_issuance.official_execution_authorization;
  const finalEntry = preparePublicWebThirdCanaryFinalExecutionEntry({
    atomic_commit: committed,
    trial_id: identity.trial_id,
    official_authorization_id: identity.official_authorization_id,
    grant_id: identity.grant_id,
    reservation_id: identity.reservation_id,
    execution_scope: input.execution_scope,
    official_execution_authorization: official,
    production_allowed: false
  }, options);

  if (!finalEntry.ok) return blocked('final_execution_entry_gate_failed', 'FINAL_ENTRY_GATE', finalEntry);

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_PRE_EXECUTION_ORCHESTRATION_READY_NOT_STARTED',
    ...identity,
    durable_resources_materialized: true,
    resources_consumed: true,
    execution_reserved: true,
    execution_entry_ready: true,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    requires_fresh_explicit_human_execution_authorization_at_side_effect_boundary: true,
    required_confirmation: 'EXECUTAR CANARY PUBLIC WEB',
    next_gate: 'EXPLICIT_HUMAN_AUTHORIZATION_AT_REAL_EXECUTION_BOUNDARY',
    final_execution_entry: finalEntry,
    version: VERSION
  });
}

module.exports = {
  VERSION,
  preparePublicWebThirdCanaryPreExecution
};
