'use strict';

const MATERIALIZATION_CONTRACT_VERSION = 'public_web_third_canary_materialization_contract_v1';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_MATERIALIZATION_BLOCKED',
    reason,
    resources_materialized: false,
    execution_authorized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: MATERIALIZATION_CONTRACT_VERSION
  });
}

function validatePublicWebThirdCanaryMaterialization(input = {}) {
  if (!isNonEmptyString(input.trial_id)) return fail('trial_id_required');
  if (input.environment !== 'staging' || input.production_allowed !== false) return fail('staging_only');
  if (
    input.target_origin !== 'https://example.com' ||
    input.target_path !== '/' ||
    input.method !== 'GET' ||
    input.port !== 443
  ) return fail('approved_target_scope_required');
  if (input.maximum_requests !== 1 || input.rollout_percentage !== 1) return fail('single_request_scope_required');

  const authorization = input.authorization_candidate || {};
  const grant = input.grant_candidate || {};
  const reservation = input.reservation_candidate || {};

  for (const [kind, resource] of Object.entries({ authorization, grant, reservation })) {
    if (!isNonEmptyString(resource.id)) return fail(`${kind}_candidate_id_required`);
    if (resource.trial_id !== input.trial_id) return fail(`${kind}_trial_binding_mismatch`);
    if (resource.fresh !== true || resource.single_use !== true) return fail(`${kind}_must_be_fresh_single_use`);
    if (resource.consumed === true || resource.reused === true) return fail(`${kind}_replay_forbidden`);
  }

  const ids = [authorization.id, grant.id, reservation.id];
  if (new Set(ids).size !== ids.length) return fail('resource_identity_collision');
  const previousIds = Array.isArray(input.previous_resource_ids) ? input.previous_resource_ids.map(String) : null;
  if (!previousIds) return fail('previous_resource_snapshot_required');
  if (ids.some((id) => previousIds.includes(id))) return fail('previous_resource_reuse_forbidden');

  // This contract may validate readiness for a later materialization step, but it
  // cannot itself carry execution authority or invoke materialization/runtime.
  if (input.explicit_human_execution_authorized === true || input.human_authorized === true) {
    return fail('execution_authority_forbidden_in_materialization_contract');
  }
  if (input.materialize === true || input.execute === true || input.start === true || input.consume === true) {
    return fail('side_effect_action_forbidden');
  }
  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden');
  }

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_MATERIALIZATION_CONTRACT_READY',
    trial_id: input.trial_id,
    candidate_ids: Object.freeze({
      authorization_candidate_id: authorization.id,
      grant_candidate_id: grant.id,
      reservation_candidate_id: reservation.id
    }),
    exact_scope: Object.freeze({
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1
    }),
    resources_materialized: false,
    execution_authorized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'EXPLICIT_HUMAN_AUTHORIZATION_BEFORE_RESOURCE_MATERIALIZATION',
    version: MATERIALIZATION_CONTRACT_VERSION
  });
}

module.exports = {
  MATERIALIZATION_CONTRACT_VERSION,
  validatePublicWebThirdCanaryMaterialization
};
