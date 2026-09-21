'use strict';

const crypto = require('node:crypto');

const GRANT_CONTRACT_VERSION = 'public_web_third_canary_single_use_grant_v1';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function createPublicWebThirdCanaryGrantRegistry(options = {}) {
  const grants = new Map();
  const consumed = new Set();
  const revoked = new Set();
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();

  function fail(reason) {
    return Object.freeze({
      ok: false,
      status: 'THIRD_CANARY_GRANT_BLOCKED',
      reason,
      executed: false,
      provider_invoked: false,
      transport_invoked: false,
      external_network_called: false,
      production_allowed: false
    });
  }

  function issueGrant(input = {}) {
    const now = Date.parse(String(clock()));
    const expiresAt = Date.parse(String(input.expires_at || ''));
    const grantId = input.grant_id;

    if (!isNonEmptyString(grantId)) return fail('grant_id_required');
    if (grants.has(grantId) || consumed.has(grantId) || revoked.has(grantId)) return fail('grant_id_replayed');
    if (!isNonEmptyString(input.trial_id)) return fail('trial_id_required');
    if (input.environment !== 'staging' || input.production_allowed !== false) return fail('staging_only');
    if (input.target_origin !== 'https://example.com' || input.target_path !== '/' || input.method !== 'GET' || input.port !== 443) {
      return fail('approved_target_scope_required');
    }
    if (input.maximum_requests !== 1 || input.rollout_percentage !== 1) return fail('single_request_scope_required');
    if (!isNonEmptyString(input.authorization_candidate_id)) return fail('authorization_candidate_binding_required');
    if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > 120000) {
      return fail('grant_window_invalid');
    }
    if (input.human_authorized === true || input.execute === true || input.start === true || input.consume === true) {
      return fail('execution_authority_forbidden_during_grant_issue');
    }

    const grant = Object.freeze({
      grant_id: grantId,
      trial_id: input.trial_id,
      environment: 'staging',
      target_origin_hash: hash(input.target_origin),
      target_path_hash: hash(input.target_path),
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1,
      authorization_candidate_id_hash: hash(input.authorization_candidate_id),
      single_use: true,
      used: false,
      revoked: false,
      expires_at: new Date(expiresAt).toISOString(),
      version: 1,
      contract_version: GRANT_CONTRACT_VERSION
    });
    grants.set(grantId, grant);
    return Object.freeze({
      ok: true,
      status: 'THIRD_CANARY_GRANT_ISSUED_NOT_AUTHORIZED_FOR_EXECUTION',
      grant: clone(grant),
      executed: false,
      provider_invoked: false,
      transport_invoked: false,
      external_network_called: false,
      production_allowed: false
    });
  }

  function consumeGrant(grantId, context = {}) {
    const grant = grants.get(grantId);
    if (!grant) return fail('grant_not_found');
    if (consumed.has(grantId) || grant.used === true) return fail('grant_replayed');
    if (revoked.has(grantId) || grant.revoked === true) return fail('grant_revoked');
    const now = Date.parse(String(clock()));
    if (!Number.isFinite(now) || Date.parse(grant.expires_at) <= now) return fail('grant_expired');
    if (context.explicit_human_authorized !== true) return fail('explicit_human_authorization_required');
    if (
      context.trial_id !== grant.trial_id ||
      context.environment !== grant.environment ||
      hash(context.target_origin) !== grant.target_origin_hash ||
      hash(context.target_path) !== grant.target_path_hash ||
      context.method !== grant.method ||
      context.port !== grant.port ||
      hash(context.authorization_candidate_id) !== grant.authorization_candidate_id_hash
    ) return fail('grant_scope_mismatch');

    consumed.add(grantId);
    const next = Object.freeze({ ...grant, used: true, version: grant.version + 1 });
    grants.set(grantId, next);
    return Object.freeze({
      ok: true,
      status: 'THIRD_CANARY_GRANT_CONSUMED',
      grant: clone(next),
      executed: false,
      provider_invoked: false,
      transport_invoked: false,
      external_network_called: false,
      production_allowed: false
    });
  }

  function revokeGrant(grantId) {
    if (!isNonEmptyString(grantId)) return fail('grant_id_required');
    revoked.add(grantId);
    const grant = grants.get(grantId);
    if (grant) grants.set(grantId, Object.freeze({ ...grant, revoked: true, version: grant.version + 1 }));
    return Object.freeze({ ok: true, revoked: true, grant_id: grantId });
  }

  function getGrant(grantId) {
    return clone(grants.get(grantId)) || null;
  }

  return Object.freeze({ issueGrant, consumeGrant, revokeGrant, getGrant });
}

module.exports = {
  GRANT_CONTRACT_VERSION,
  createPublicWebThirdCanaryGrantRegistry
};
