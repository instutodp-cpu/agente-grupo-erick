'use strict';

const crypto = require('node:crypto');

const RESOURCE_PREPARATION_VERSION = 'public_web_third_canary_resource_preparation_v1';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function stableId(kind, trialId, nonce) {
  return `third_canary_${kind}_${crypto.createHash('sha256').update(`${trialId}:${kind}:${nonce}`).digest('hex').slice(0, 24)}`;
}

function fail(reasonCodes) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_RESOURCE_PREPARATION_BLOCKED',
    phase: 'RESOURCE_PREPARATION_OFFLINE',
    reason_codes: [...new Set(reasonCodes)].sort(),
    human_authorized: false,
    resources_materialized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: RESOURCE_PREPARATION_VERSION
  });
}

function preparePublicWebThirdCanarySingleUseResources(input = {}) {
  const failures = [];
  const trialId = input.trial_id;
  const nonce = input.preparation_nonce;
  const previousIds = Array.isArray(input.previous_resource_ids) ? input.previous_resource_ids.map(String) : [];

  if (!isNonEmptyString(trialId)) failures.push('trial_id_required');
  if (!isNonEmptyString(nonce)) failures.push('preparation_nonce_required');
  if (!Array.isArray(input.previous_resource_ids)) failures.push('previous_resource_snapshot_required');
  if (input.environment !== 'staging') failures.push('staging_environment_required');
  if (input.production_allowed !== false) failures.push('production_must_remain_blocked');
  if (input.maximum_requests !== 1) failures.push('maximum_requests_must_be_one');
  if (input.rollout_percentage !== 1) failures.push('rollout_percentage_must_equal_one');
  if (input.target_origin !== 'https://example.com') failures.push('approved_target_origin_required');
  if (input.target_path !== '/') failures.push('approved_target_path_required');
  if (input.target_method !== 'GET') failures.push('approved_target_method_required');
  if (input.target_port !== 443) failures.push('approved_target_port_required');

  // This phase deliberately cannot carry execution authority.
  if (input.human_authorized === true) failures.push('human_authorization_forbidden_during_preparation');
  if (input.execute === true || input.start === true || input.consume === true) failures.push('execution_action_forbidden');
  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    failures.push('network_activity_forbidden');
  }

  if (failures.length > 0) return fail(failures);

  const resources = Object.freeze({
    human_authorization: Object.freeze({
      id: stableId('authorization_candidate', trialId, nonce),
      trial_id: trialId,
      fresh: true,
      single_use: true,
      consumed: false,
      reused: false,
      human_authorized: false,
      state: 'candidate_pending_explicit_human_authorization'
    }),
    grant: Object.freeze({
      id: stableId('grant_candidate', trialId, nonce),
      trial_id: trialId,
      fresh: true,
      single_use: true,
      consumed: false,
      reused: false,
      state: 'candidate_not_materialized'
    }),
    reservation: Object.freeze({
      id: stableId('reservation_candidate', trialId, nonce),
      trial_id: trialId,
      fresh: true,
      single_use: true,
      consumed: false,
      reused: false,
      state: 'candidate_not_materialized'
    })
  });

  const ids = Object.values(resources).map((resource) => resource.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => previousIds.includes(id))) {
    return fail(['resource_identity_collision']);
  }

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_RESOURCE_CANDIDATES_PREPARED',
    phase: 'RESOURCE_PREPARATION_OFFLINE',
    trial_id: trialId,
    resources,
    human_authorized: false,
    resources_materialized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'EXPLICIT_HUMAN_AUTHORIZATION_BEFORE_MATERIALIZATION_OR_EXECUTION',
    version: RESOURCE_PREPARATION_VERSION
  });
}

module.exports = {
  RESOURCE_PREPARATION_VERSION,
  preparePublicWebThirdCanarySingleUseResources
};
