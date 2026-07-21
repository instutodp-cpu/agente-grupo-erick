'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateAgentSessionContract } = require('./agent-session-contract');

const AGENT_SESSION_REGISTRY_VALIDATOR_VERSION = 'agent_session_registry_validator_v1';
const AGENT_SESSION_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'SESSION_CONFLICT'
]);
const FORBIDDEN_AGENT_SESSION_REGISTRY_STATUSES = Object.freeze(['CREATED_REAL', 'ACTIVE_REAL']);
const AGENT_SESSION_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...AGENT_SESSION_REGISTRY_SAFE_FLAGS });
}

function createAgentSessionRegistry() {
  const sessionsById = new Map();

  function registerSession(session, options = {}) {
    const validation = validateAgentSessionContract(session);
    if (!validation.valid) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    }
    let payload;
    try {
      payload = stablePayload(session);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const sessionId = session.session_id;
    const tenantId = session.tenant_id;
    const organizationId = session.organization_id;
    const sessionVersion = session.session_version;
    const existing = sessionsById.get(sessionId);

    if (existing) {
      if (existing.tenant_id !== tenantId) {
        return safe({ ok: false, status: 'TENANT_BLOCKED', errors: ['session_tenant_reassignment_blocked'] });
      }
      if (existing.organization_id !== organizationId) {
        return safe({ ok: false, status: 'ORGANIZATION_BLOCKED', errors: ['session_organization_reassignment_blocked'] });
      }
      if (existing.agent_id !== session.agent_id) {
        return safe({ ok: false, status: 'SESSION_CONFLICT', errors: ['session_agent_identity_conflict'] });
      }
      if (existing.fingerprint === payload) {
        return safe({ ok: true, status: 'REPLAY_ACCEPTED', session_id: sessionId, session_version: existing.session_version, fingerprint: payload });
      }
      if (sessionVersion === existing.session_version) {
        return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: ['session_payload_mismatch'] });
      }
      if (options.expected_version !== undefined && options.expected_version !== existing.session_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['session_optimistic_conflict'] });
      }
      if (options.expected_fingerprint !== undefined && options.expected_fingerprint !== existing.fingerprint) {
        return safe({ ok: false, status: 'FINGERPRINT_CONFLICT', errors: ['session_fingerprint_conflict'] });
      }
      if (sessionVersion < existing.session_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['session_version_downgrade'] });
      }
      const stored = cloneFrozen(session);
      sessionsById.set(sessionId, { record: stored, fingerprint: payload, tenant_id: tenantId, organization_id: organizationId, agent_id: session.agent_id, session_version: sessionVersion });
      return safe({ ok: true, status: 'REGISTERED_SIMULATION', session_id: sessionId, session_version: sessionVersion, fingerprint: payload });
    }

    if (options.expected_version !== undefined && options.expected_version !== 0) {
      return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['session_optimistic_conflict'] });
    }
    const stored = cloneFrozen(session);
    sessionsById.set(sessionId, { record: stored, fingerprint: payload, tenant_id: tenantId, organization_id: organizationId, agent_id: session.agent_id, session_version: sessionVersion });
    return safe({ ok: true, status: 'REGISTERED_SIMULATION', session_id: sessionId, session_version: sessionVersion, fingerprint: payload });
  }

  function getBySessionId(sessionId) {
    if (!isNonEmptyString(sessionId)) return null;
    const entry = sessionsById.get(sessionId);
    return entry ? cloneFrozen(entry.record) : null;
  }

  function getBySessionIdAndTenant(sessionId, tenantId) {
    if (!isNonEmptyString(sessionId) || !isNonEmptyString(tenantId)) return null;
    const entry = sessionsById.get(sessionId);
    if (!entry || entry.tenant_id !== tenantId) return null;
    return cloneFrozen(entry.record);
  }

  function listByTenant(tenantId, filters = {}) {
    if (!isNonEmptyString(tenantId)) return [];
    const organizationId = isPlainObject(filters) && isNonEmptyString(filters.organization_id) ? filters.organization_id : null;
    const agentId = isPlainObject(filters) && isNonEmptyString(filters.agent_id) ? filters.agent_id : null;
    const actorId = isPlainObject(filters) && isNonEmptyString(filters.actor_id) ? filters.actor_id : null;
    const status = isPlainObject(filters) && isNonEmptyString(filters.status) ? filters.status : null;
    const sessionType = isPlainObject(filters) && isNonEmptyString(filters.session_type) ? filters.session_type : null;
    const results = [];
    for (const entry of sessionsById.values()) {
      if (entry.tenant_id !== tenantId) continue;
      if (organizationId && entry.record.organization_id !== organizationId) continue;
      if (agentId && entry.record.agent_id !== agentId) continue;
      if (actorId && entry.record.actor_id !== actorId) continue;
      if (status && entry.record.session_status !== status) continue;
      if (sessionType && entry.record.session_type !== sessionType) continue;
      results.push(cloneFrozen(entry.record));
      if (results.length >= MAX_LIST_RESULTS) break;
    }
    return results.sort((a, b) => (a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0));
  }

  return Object.freeze({
    registerSession,
    getBySessionId,
    getBySessionIdAndTenant,
    listByTenant
  });
}

module.exports = {
  AGENT_SESSION_REGISTRY_SAFE_FLAGS,
  AGENT_SESSION_REGISTRY_STATUSES,
  AGENT_SESSION_REGISTRY_VALIDATOR_VERSION,
  FORBIDDEN_AGENT_SESSION_REGISTRY_STATUSES,
  MAX_LIST_RESULTS,
  createAgentSessionRegistry
};
