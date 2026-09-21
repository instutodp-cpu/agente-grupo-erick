'use strict';

const {
  createPublicWebThirdCanaryGrantRegistry
} = require('./public-web-canary-third-grant');

const THIRD_CANARY_GRANT_MATERIALIZER_VERSION = 'public_web_third_canary_grant_materializer_v1';

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_GRANT_MATERIALIZATION_BLOCKED',
    reason,
    grant_materialized: false,
    authorization_materialized: false,
    reservation_materialized: false,
    execution_authorized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: THIRD_CANARY_GRANT_MATERIALIZER_VERSION
  });
}

function materializePublicWebThirdCanaryGrant(input = {}, options = {}) {
  const readiness = input.materialization_contract || {};
  if (readiness.ok !== true || readiness.status !== 'THIRD_CANARY_MATERIALIZATION_CONTRACT_READY') {
    return fail('materialization_contract_ready_required');
  }
  if (readiness.trial_id !== input.trial_id) return fail('trial_binding_mismatch');

  const ids = readiness.candidate_ids || {};
  if (!ids.grant_candidate_id || !ids.authorization_candidate_id || !ids.reservation_candidate_id) {
    return fail('candidate_identity_binding_required');
  }
  if (input.grant_candidate_id !== ids.grant_candidate_id) return fail('grant_candidate_binding_mismatch');
  if (input.authorization_candidate_id !== ids.authorization_candidate_id) return fail('authorization_candidate_binding_mismatch');
  if (input.reservation_candidate_id !== ids.reservation_candidate_id) return fail('reservation_candidate_binding_mismatch');

  const scope = readiness.exact_scope || {};
  if (
    scope.environment !== 'staging' ||
    scope.target_origin !== 'https://example.com' ||
    scope.target_path !== '/' ||
    scope.method !== 'GET' ||
    scope.port !== 443 ||
    scope.maximum_requests !== 1 ||
    scope.rollout_percentage !== 1
  ) return fail('approved_materialization_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.human_authorized === true || input.explicit_human_execution_authorized === true) {
    return fail('execution_authority_forbidden_during_grant_materialization');
  }
  if (input.execute === true || input.start === true || input.consume === true || input.reserve === true) {
    return fail('execution_action_forbidden');
  }

  const registry = options.grantRegistry || createPublicWebThirdCanaryGrantRegistry({ clock: options.clock });
  const issued = registry.issueGrant({
    grant_id: ids.grant_candidate_id,
    trial_id: input.trial_id,
    environment: 'staging',
    production_allowed: false,
    target_origin: 'https://example.com',
    target_path: '/',
    method: 'GET',
    port: 443,
    maximum_requests: 1,
    rollout_percentage: 1,
    authorization_candidate_id: ids.authorization_candidate_id,
    expires_at: input.expires_at,
    human_authorized: false,
    execute: false,
    start: false,
    consume: false
  });

  if (!issued.ok) return fail(`grant_issue_failed:${issued.reason || 'unknown'}`);

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_GRANT_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION',
    trial_id: input.trial_id,
    grant: issued.grant,
    grant_materialized: true,
    authorization_materialized: false,
    reservation_materialized: false,
    execution_authorized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'SEPARATE_AUTHORIZATION_MATERIALIZATION_LAYER',
    version: THIRD_CANARY_GRANT_MATERIALIZER_VERSION
  });
}

module.exports = {
  THIRD_CANARY_GRANT_MATERIALIZER_VERSION,
  materializePublicWebThirdCanaryGrant
};
