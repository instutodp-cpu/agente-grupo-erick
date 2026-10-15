'use strict';

const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { buildOperationalMissionTrialConfig } = require('./public-web-operational-mission-envelope');

const VERSION = 'public_web_operational_mission_ingress_v1';
const INBOX_CONTRACT_VERSION = 'public_web_operational_mission_inbox_v1';

function fail(status, reason, httpStatus = 400) {
  return Object.freeze({ ok:false, status, reason, http_status:httpStatus, execution_authorized:false, execution_started:false, external_network_called:false, production_allowed:false });
}

function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }

function normalizePolicy(policy = {}) {
  const required = ['principal_id','tenant_id','workspace_type','user_id','operator_id','approver_id'];
  for (const field of required) if (!nonEmpty(policy[field])) throw new TypeError(`mission_ingress_policy_${field}_required`);
  if (!Array.isArray(policy.workspace_ids) || policy.workspace_ids.length < 1 || policy.workspace_ids.some((v)=>!nonEmpty(v))) throw new TypeError('mission_ingress_policy_workspace_ids_required');
  if (policy.workspace_type !== 'corporate') throw new TypeError('mission_ingress_policy_workspace_type_unsupported');
  if (policy.environment !== 'staging' || policy.production_allowed !== false) throw new TypeError('mission_ingress_policy_staging_only');
  return Object.freeze({
    principal_id: policy.principal_id,
    tenant_id: policy.tenant_id,
    workspace_type: policy.workspace_type,
    workspace_ids: Object.freeze([...new Set(policy.workspace_ids)]),
    user_id: policy.user_id,
    operator_id: policy.operator_id,
    approver_id: policy.approver_id,
    environment: 'staging',
    production_allowed: false
  });
}

function createOperationalMissionIngress({ inbox, policy, clock = () => new Date().toISOString() } = {}) {
  if (!inbox || typeof inbox.admit !== 'function') throw new TypeError('mission_ingress_inbox_required');
  const trusted = normalizePolicy(policy);

  async function admit({ envelope, identity } = {}) {
    if (!identity || identity.principal?.type !== 'machine' || !nonEmpty(identity.principal?.id) || !nonEmpty(identity.tenant_id)) {
      return fail('PUBLIC_WEB_OPERATIONAL_MISSION_INGRESS_BLOCKED', 'machine_identity_required', 401);
    }
    if (identity.principal.id !== trusted.principal_id || identity.tenant_id !== trusted.tenant_id) {
      return fail('PUBLIC_WEB_OPERATIONAL_MISSION_INGRESS_BLOCKED', 'machine_identity_scope_mismatch', 403);
    }
    const workspaceId = envelope?.contract?.workspace_id;
    if (!trusted.workspace_ids.includes(workspaceId)) {
      return fail('PUBLIC_WEB_OPERATIONAL_MISSION_INGRESS_BLOCKED', 'workspace_not_allowed', 403);
    }

    const bound = buildOperationalMissionTrialConfig(envelope, {
      tenant_id: trusted.tenant_id,
      workspace_type: trusted.workspace_type,
      workspace_id: workspaceId,
      user_id: trusted.user_id,
      operator_id: trusted.operator_id,
      approver_id: trusted.approver_id,
      production_allowed: false
    });
    if (!bound.ok) return fail('PUBLIC_WEB_OPERATIONAL_MISSION_INGRESS_BLOCKED', bound.errors?.[0] || 'mission_binding_invalid', 400);

    const receivedAt = String(clock());
    if (Number.isNaN(Date.parse(receivedAt))) return fail('PUBLIC_WEB_OPERATIONAL_MISSION_INGRESS_BLOCKED', 'clock_invalid', 500);
    const dispatchTokenDigest = computeCanonicalContentDigest(['dispatch-token', envelope.dispatch_token]);
    const inboxId = `public_web_operational_mission_inbox:${computeCanonicalContentDigest([
      VERSION, trusted.tenant_id, workspaceId, bound.mission_id, bound.mission_run_id, envelope.contract_hash, envelope.idempotency_key
    ])}`;
    const missionPayload = Object.freeze({
      version: envelope.version,
      provider: envelope.provider,
      environment: envelope.environment,
      production_allowed: false,
      dispatch_simulated: false,
      mission_run_id: envelope.mission_run_id,
      idempotency_key: envelope.idempotency_key,
      correlation_id: envelope.correlation_id,
      contract_hash: envelope.contract_hash,
      contract: envelope.contract
    });
    const record = Object.freeze({
      inbox_id: inboxId,
      contract_version: INBOX_CONTRACT_VERSION,
      mission_id: bound.mission_id,
      mission_run_id: bound.mission_run_id,
      tenant_id: trusted.tenant_id,
      workspace_id: workspaceId,
      workspace_type: trusted.workspace_type,
      principal_id: identity.principal.id,
      idempotency_key: envelope.idempotency_key,
      correlation_id: envelope.correlation_id,
      contract_hash: envelope.contract_hash,
      dispatch_token_digest: dispatchTokenDigest,
      target_origin: bound.config.target_origin,
      target_path: bound.config.target_path,
      mission_payload: missionPayload,
      trial_config: bound.config,
      status: 'accepted',
      received_at: new Date(Date.parse(receivedAt)).toISOString()
    });
    const persisted = await inbox.admit(record);
    if (!persisted || persisted.ok !== true) {
      if (persisted?.status === 'CONFLICT') return fail('PUBLIC_WEB_OPERATIONAL_MISSION_INGRESS_CONFLICT', persisted.reason || 'mission_replay_conflict', 409);
      return fail('PUBLIC_WEB_OPERATIONAL_MISSION_INGRESS_BLOCKED', 'durable_inbox_required', 503);
    }
    return Object.freeze({
      ok:true,
      status: persisted.status === 'IDEMPOTENT_REPLAY' ? 'PUBLIC_WEB_OPERATIONAL_MISSION_ALREADY_ADMITTED' : 'PUBLIC_WEB_OPERATIONAL_MISSION_ADMITTED',
      inbox_id: inboxId,
      mission_id: bound.mission_id,
      mission_run_id: bound.mission_run_id,
      contract_hash: envelope.contract_hash,
      idempotent: persisted.status === 'IDEMPOTENT_REPLAY',
      execution_authorized:false,
      execution_started:false,
      external_network_called:false,
      production_allowed:false
    });
  }

  return Object.freeze({ version: VERSION, policy: trusted, admit });
}

module.exports = { VERSION, INBOX_CONTRACT_VERSION, createOperationalMissionIngress };
