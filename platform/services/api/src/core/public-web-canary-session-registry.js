'use strict';

const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  buildCanaryAuditEventCandidate,
  buildSafeCanaryError,
  deepClone,
  hashCanaryEvidence,
  hashValue,
  sanitizeCanaryData,
  validateCanaryApproval,
  validateCanaryExecutionRequest,
  validateCanaryRequest,
  validateCanarySession,
  validateCanaryStateTransition
} = require('./public-web-canary-session-contract');

function createBaseSession(request, clock) {
  const now = typeof clock === 'function' ? clock() : new Date(0).toISOString();
  const expiresAt = request.expires_at || new Date(new Date(now).getTime() + 30 * 60 * 1000).toISOString();
  return sanitizeCanaryData({
    canary_session_id: request.canary_session_id,
    trace_id: request.trace_id,
    connector_id: CONNECTOR_ID,
    configuration_id: CONFIGURATION_ID,
    adapter_id: ADAPTER_ID,
    provider_id: PROVIDER_ID,
    readiness_candidate_id: READINESS_CANDIDATE_ID,
    workspace_type: request.workspace_type || 'corporate',
    tenant_id: request.tenant_id || 'grupo_erick',
    user_id: request.user_id || 'user_public_web_synthetic',
    operator_id: request.operator_id,
    operator_role: request.operator_role,
    environment: request.environment,
    target_origin: request.target_origin,
    target_path_hash: hashValue(request.target_path || '/'),
    source_type: request.source_type,
    operation: request.operation,
    feature_flag_key: request.feature_flag_key || 'HERMES_PUBLIC_WEB_READ_ONLY_ENABLED',
    feature_flag_enabled: request.feature_flag_enabled === true,
    kill_switch_key: request.kill_switch_key || 'HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH',
    kill_switch_active: request.kill_switch_active === true,
    rollout_percentage: request.rollout_percentage || 1,
    maximum_requests: request.maximum_requests || 1,
    requests_used: 0,
    started_at: now,
    expires_at: expiresAt,
    canary_state: 'requested',
    lifecycle_version: request.lifecycle_version || 1,
    configuration_version: request.configuration_version || 1,
    readiness_evidence_id: request.readiness_evidence_id || hashCanaryEvidence(request.readiness_evidence || {}),
    approval_id: '',
    approved_by: '',
    approved_at: '',
    cancellation_reason: '',
    terminal_reason: '',
    simulated: true,
    executed: false,
    real_provider_called: false,
    version: 1
  });
}

function createPublicWebCanarySessionRegistry(options = {}) {
  const sessions = new Map();
  const history = new Map();
  const processed = new Set();
  const maxHistory = Number.isInteger(options.maxHistoryPerSession) && options.maxHistoryPerSession > 0
    ? Math.min(options.maxHistoryPerSession, 1000)
    : 100;
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();

  function appendHistory(sessionId, event) {
    const list = history.get(sessionId) || [];
    list.push(sanitizeCanaryData(event));
    while (list.length > maxHistory) list.shift();
    history.set(sessionId, list);
  }

  function processedCheck(changeId, sessionId, eventName) {
    if (!changeId) {
      return { ok: false, replay: false, error: buildSafeCanaryError('INVALID_CANARY_REQUEST', 'Missing change id.', { blocked_reason: 'change_id_missing' }) };
    }
    if (processed.has(changeId)) {
      appendHistory(sessionId || 'session_not_available', buildCanaryAuditEventCandidate({
        event_name: eventName || 'public_web_canary_request_failed_safe',
        change_id: changeId,
        canary_session_id: sessionId,
        applied: false,
        error_code: 'CANARY_REPLAY_DETECTED',
        blocked_reason: 'replay_detected',
        occurred_at: clock()
      }));
      return { ok: false, replay: true, error: buildSafeCanaryError('CANARY_REPLAY_DETECTED', 'Replay blocked.', { blocked_reason: 'replay_detected' }) };
    }
    processed.add(changeId);
    return { ok: true };
  }

  function transition(session, event, targetState, fields = {}) {
    const transition = validateCanaryStateTransition(session.canary_state, event, targetState);
    if (!transition.valid) {
      return {
        ok: false,
        session: deepClone(session),
        error: buildSafeCanaryError('CANARY_STATE_TRANSITION_INVALID', 'Canary transition blocked.', {
          blocked_reason: transition.errors[0]
        })
      };
    }
    const {
      event_name: _eventName,
      request_id: _requestId,
      change_id: _changeId,
      trace_id: _traceId,
      ...sessionFields
    } = fields;
    const next = sanitizeCanaryData({
      ...session,
      ...sessionFields,
      canary_state: transition.target_state,
      version: session.version + 1,
      executed: false,
      real_provider_called: false
    });
    sessions.set(next.canary_session_id, deepClone(next));
    appendHistory(next.canary_session_id, buildCanaryAuditEventCandidate({
      event_name: fields.event_name,
      trace_id: fields.trace_id || next.trace_id,
      request_id: fields.request_id,
      change_id: fields.change_id,
      canary_session_id: next.canary_session_id,
      previous_state: session.canary_state,
      current_state: next.canary_state,
      operation: event,
      status: 'applied',
      applied: true,
      environment: next.environment,
      target_origin_hash: hashValue(next.target_origin),
      operator_id: next.operator_id,
      approved_by: next.approved_by,
      occurred_at: clock()
    }));
    return { ok: true, session: deepClone(next) };
  }

  function getCanarySession(sessionId) {
    return sessions.has(sessionId) ? deepClone(sessions.get(sessionId)) : null;
  }

  function requestCanary(request) {
    const replay = processedCheck(request && request.change_id, request && request.canary_session_id, 'public_web_canary_requested');
    if (!replay.ok) return { ok: false, error: replay.error };
    const validation = validateCanaryRequest(request);
    if (!validation.valid) {
      appendHistory(request && request.canary_session_id || 'session_not_available', buildCanaryAuditEventCandidate({
        event_name: 'public_web_canary_requested',
        canary_session_id: request && request.canary_session_id,
        change_id: request && request.change_id,
        applied: false,
        error_code: 'INVALID_CANARY_REQUEST',
        blocked_reason: validation.errors[0],
        occurred_at: clock()
      }));
      return { ok: false, errors: validation.errors, error: buildSafeCanaryError('INVALID_CANARY_REQUEST', 'Invalid canary request.', { blocked_reason: validation.errors[0] }) };
    }
    if (sessions.has(request.canary_session_id)) {
      return { ok: false, error: buildSafeCanaryError('INVALID_CANARY_SESSION', 'Duplicate canary session.', { blocked_reason: 'duplicate_canary_session' }) };
    }
    const session = createBaseSession(request, clock);
    const sessionValidation = validateCanarySession(session);
    if (!sessionValidation.valid) {
      return { ok: false, errors: sessionValidation.errors, error: buildSafeCanaryError('INVALID_CANARY_SESSION', 'Invalid canary session.', { blocked_reason: sessionValidation.errors[0] }) };
    }
    sessions.set(session.canary_session_id, deepClone(session));
    appendHistory(session.canary_session_id, buildCanaryAuditEventCandidate({
      event_name: 'public_web_canary_requested',
      trace_id: request.trace_id,
      request_id: request.request_id,
      change_id: request.change_id,
      canary_session_id: session.canary_session_id,
      previous_state: 'inactive',
      current_state: 'requested',
      operation: 'request_canary',
      applied: true,
      environment: session.environment,
      target_origin_hash: hashValue(session.target_origin),
      operator_id: session.operator_id,
      occurred_at: clock()
    }));
    return { ok: true, session: deepClone(session) };
  }

  function validateCanary(request, context = {}) {
    const replay = processedCheck(request && request.change_id, request && request.canary_session_id, 'public_web_canary_validation_blocked');
    if (!replay.ok) return { ok: false, error: replay.error };
    const session = getCanarySession(request && request.canary_session_id);
    if (!session) return { ok: false, error: buildSafeCanaryError('CANARY_SESSION_NOT_FOUND', 'Canary session missing.') };
    if (request.expected_version !== session.version) return { ok: false, error: buildSafeCanaryError('CANARY_VERSION_CONFLICT', 'Canary version conflict.', { blocked_reason: 'version_conflict' }) };
    const first = transition(session, 'validate_canary', 'validation_pending', {
      event_name: 'public_web_canary_validation_passed',
      request_id: request.request_id,
      change_id: request.change_id
    });
    if (!first.ok) return first;
    const missing = ['adapterRegistry', 'lifecycleRegistry', 'configurationRegistry', 'secretReferenceRegistry', 'secretResolver', 'readinessResult', 'publicWebPilotGate', 'featureFlagResolver', 'killSwitchResolver', 'targetAllowlist', 'tenantAllowlist', 'workspaceAllowlist', 'userAllowlist', 'operatorPolicy', 'rateLimitBudget', 'costBudget', 'auditSink', 'clock']
      .filter((key) => !context[key]);
    if (missing.length > 0) {
      return transition(first.session, 'validation_failed', 'validation_blocked', {
        event_name: 'public_web_canary_validation_blocked',
        request_id: request.request_id,
        change_id: request.change_id,
        terminal_reason: `missing_context::${missing[0]}`
      });
    }
    const second = transition(first.session, 'validation_passed', 'approved_pending', {
      event_name: 'public_web_canary_validation_passed',
      request_id: request.request_id,
      change_id: request.change_id
    });
    return second;
  }

  function approveCanary(approval) {
    const replay = processedCheck(approval && approval.change_id, approval && approval.canary_session_id, 'public_web_canary_approved');
    if (!replay.ok) return { ok: false, error: replay.error };
    const session = getCanarySession(approval && approval.canary_session_id);
    if (!session) return { ok: false, error: buildSafeCanaryError('CANARY_SESSION_NOT_FOUND', 'Canary session missing.') };
    const validation = validateCanaryApproval(approval, session);
    if (!validation.valid) return { ok: false, errors: validation.errors, error: buildSafeCanaryError('INVALID_CANARY_APPROVAL', 'Invalid canary approval.', { blocked_reason: validation.errors[0] }) };
    if (approval.expected_version !== session.version) return { ok: false, error: buildSafeCanaryError('CANARY_VERSION_CONFLICT', 'Canary version conflict.', { blocked_reason: 'version_conflict' }) };
    return transition(session, 'approve_canary', 'approved', {
      event_name: 'public_web_canary_approved',
      request_id: approval.request_id,
      change_id: approval.change_id,
      approval_id: approval.approval_id,
      approved_by: approval.approved_by,
      approved_at: approval.approved_at || clock()
    });
  }

  function activateCanary(request, context = {}) {
    const replay = processedCheck(request && request.change_id, request && request.canary_session_id, 'public_web_canary_activated');
    if (!replay.ok) return { ok: false, error: replay.error };
    const session = getCanarySession(request && request.canary_session_id);
    if (!session) return { ok: false, error: buildSafeCanaryError('CANARY_SESSION_NOT_FOUND', 'Canary session missing.') };
    if (request.expected_version !== session.version) return { ok: false, error: buildSafeCanaryError('CANARY_VERSION_CONFLICT', 'Canary version conflict.', { blocked_reason: 'version_conflict' }) };
    if (context.kill_switch_active === true) return transition(session, 'terminate_by_kill_switch', 'kill_switch_terminated', { event_name: 'public_web_canary_kill_switch_terminated', request_id: request.request_id, change_id: request.change_id, terminal_reason: 'kill_switch_active' });
    if (context.feature_flag_enabled !== true) return { ok: false, error: buildSafeCanaryError('CANARY_FEATURE_FLAG_OFF', 'Feature flag is off.', { blocked_reason: 'feature_flag_off' }) };
    return transition(session, 'activate_canary', 'active', {
      event_name: 'public_web_canary_activated',
      request_id: request.request_id,
      change_id: request.change_id
    });
  }

  function executeCanaryRequest(request, context = {}) {
    const replay = processedCheck(request && request.change_id, request && request.canary_session_id, 'public_web_canary_request_failed_safe');
    if (!replay.ok) return { ok: false, error: replay.error };
    const session = getCanarySession(request && request.canary_session_id);
    if (!session) return { ok: false, error: buildSafeCanaryError('CANARY_SESSION_NOT_FOUND', 'Canary session missing.') };
    const validation = validateCanaryExecutionRequest(request, session);
    if (!validation.valid) return { ok: false, errors: validation.errors, error: buildSafeCanaryError('INVALID_CANARY_REQUEST', 'Invalid canary execution request.', { blocked_reason: validation.errors[0] }) };
    if (request.expected_version !== session.version) return { ok: false, error: buildSafeCanaryError('CANARY_VERSION_CONFLICT', 'Canary version conflict.', { blocked_reason: 'version_conflict' }) };
    const executing = transition(session, 'execute_canary_request', 'executing', {
      event_name: 'public_web_canary_request_started',
      request_id: request.request_id,
      change_id: request.change_id
    });
    if (!executing.ok) return executing;
    const succeeded = context.succeeded === true;
    const updated = sanitizeCanaryData({
      ...executing.session,
      canary_state: executing.session.requests_used + 1 >= executing.session.maximum_requests ? 'completed' : 'active',
      requests_used: executing.session.requests_used + 1,
      version: executing.session.version + 1,
      executed: false,
      real_provider_called: false
    });
    sessions.set(updated.canary_session_id, deepClone(updated));
    appendHistory(updated.canary_session_id, buildCanaryAuditEventCandidate({
      event_name: succeeded ? 'public_web_canary_request_succeeded' : 'public_web_canary_request_failed_safe',
      request_id: request.request_id,
      change_id: request.change_id,
      canary_session_id: updated.canary_session_id,
      previous_state: 'executing',
      current_state: updated.canary_state,
      operation: 'execute_canary_request',
      applied: true,
      executed: context.executed === true,
      real_provider_called: context.real_provider_called === true,
      environment: updated.environment,
      target_origin_hash: hashValue(updated.target_origin),
      occurred_at: clock()
    }));
    return { ok: true, session: deepClone(updated) };
  }

  function terminalChange(request, event, targetState, eventName) {
    const replay = processedCheck(request && request.change_id, request && request.canary_session_id, eventName);
    if (!replay.ok) return { ok: false, error: replay.error };
    const session = getCanarySession(request && request.canary_session_id);
    if (!session) return { ok: false, error: buildSafeCanaryError('CANARY_SESSION_NOT_FOUND', 'Canary session missing.') };
    return transition(session, event, targetState, {
      event_name: eventName,
      request_id: request.request_id,
      change_id: request.change_id,
      terminal_reason: request.reason || event
    });
  }

  function unregisterUnsafe() {
    return { ok: false, error: buildSafeCanaryError('CANARY_INTERNAL_ERROR', 'Direct deletion is not supported.') };
  }

  return Object.freeze({
    requestCanary,
    validateCanary,
    approveCanary,
    activateCanary,
    getCanarySession,
    listCanarySessions: (filters = {}) => [...sessions.values()]
      .filter((session) => !filters.environment || session.environment === filters.environment)
      .map(deepClone)
      .sort((a, b) => a.canary_session_id.localeCompare(b.canary_session_id)),
    executeCanaryRequest,
    completeCanary: (request) => terminalChange(request, 'complete_canary', 'completed', 'public_web_canary_completed'),
    cancelCanary: (request) => terminalChange(request, 'cancel_canary', 'cancelled', 'public_web_canary_cancelled'),
    expireCanary: (request) => terminalChange(request, 'expire_canary', 'expired', 'public_web_canary_expired'),
    terminateByKillSwitch: (request) => terminalChange(request, 'terminate_by_kill_switch', 'kill_switch_terminated', 'public_web_canary_kill_switch_terminated'),
    getCanaryHistory: (sessionId) => (history.get(sessionId) || []).map(deepClone),
    unregisterCanary: unregisterUnsafe
  });
}

module.exports = {
  createPublicWebCanarySessionRegistry
};

function createHardenedPublicWebCanarySessionRegistry(options = {}) {
  const contract = require('./public-web-canary-session-contract');
  const sessions = new Map();
  const history = new Map();
  const processed = new Set();
  const maxHistory = Number.isInteger(options.maxHistoryPerSession) ? options.maxHistoryPerSession : 100;
  const clock = options.clock || (() => new Date());

  function nowDate() {
    const value = clock();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
    return new Date(NaN);
  }

  function nowIso() {
    const value = nowDate();
    return Number.isFinite(value.getTime()) ? value.toISOString() : 'invalid_clock';
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function safeError(code, reason) {
    return contract.buildSafeCanaryError(code, reason || code);
  }

  function audit(session, request, status, applied, errorCode, blockedReason, extra = {}) {
    return contract.buildCanaryAuditEventCandidate({
      event_name: extra.event_name || 'public_web_canary_transition',
      trace_id: request && request.trace_id,
      request_id: request && (request.request_id || request.change_id),
      canary_session_id: session && session.canary_session_id || request && request.canary_session_id,
      connector_id: session && session.connector_id || request && request.connector_id,
      configuration_id: session && session.configuration_id || request && request.configuration_id,
      adapter_id: session && session.adapter_id || request && request.adapter_id,
      provider_id: session && session.provider_id || request && request.provider_id,
      workspace_type: session && session.workspace_type || request && request.workspace_type,
      tenant_id: session && session.tenant_id || request && request.tenant_id,
      user_id: session && session.user_id || request && request.user_id,
      operation: session && session.operation || request && request.operation,
      status,
      applied,
      error_code: errorCode || null,
      blocked_reason: blockedReason || null,
      previous_state: extra.previous_state,
      current_state: extra.current_state || session && session.canary_state,
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false,
      occurred_at: nowIso()
    });
  }

  function appendHistory(sessionId, event) {
    const events = history.get(sessionId) || [];
    events.push(Object.freeze(clone(event)));
    while (events.length > maxHistory) events.shift();
    history.set(sessionId, events);
  }

  function blocked(session, request, code, reason, status = 'canary_transition_blocked') {
    const event = audit(session, request, status, false, code, reason);
    if (session && session.canary_session_id) appendHistory(session.canary_session_id, event);
    return {
      ok: false,
      status,
      applied: false,
      session: clone(session),
      audit_event_candidate: event,
      error: safeError(code, reason),
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false
    };
  }

  function idOf(request) {
    return request && (request.change_id || request.request_id || request.approval_id);
  }

  function consumeRequestId(request) {
    const id = idOf(request);
    if (typeof id !== 'string' || id.trim() === '') return { ok: false, code: 'INVALID_CANARY_REQUEST', reason: 'request_id_required' };
    if (processed.has(id)) return { ok: false, code: 'CANARY_REPLAY_DETECTED', reason: 'canary_replay_detected' };
    processed.add(id);
    return { ok: true };
  }

  function getSessionOrBlocked(request) {
    const session = sessions.get(request && request.canary_session_id);
    if (!session) return { blocked: blocked(null, request, 'CANARY_SESSION_NOT_FOUND', 'canary_session_not_found') };
    return { session };
  }

  function checkVersion(session, request) {
    if (!Number.isInteger(request.expected_version) || request.expected_version !== session.version) {
      return blocked(session, request, 'CANARY_VERSION_CONFLICT', 'canary_version_conflict');
    }
    return null;
  }

  function isListed(authority, value, payload) {
    if (!authority) return false;
    if (Array.isArray(authority)) return authority.includes(value);
    if (typeof authority.has === 'function') return authority.has(value);
    if (typeof authority.includes === 'function') return authority.includes(value);
    if (typeof authority.isAllowed === 'function') return authority.isAllowed(value, payload) === true;
    if (typeof authority.isTenantAllowed === 'function') return authority.isTenantAllowed(value, payload) === true;
    if (typeof authority.isWorkspaceAllowed === 'function') return authority.isWorkspaceAllowed(value, payload) === true;
    if (typeof authority.isUserAllowed === 'function') return authority.isUserAllowed(value, payload) === true;
    return false;
  }

  function resolveFlag(resolver, session) {
    return typeof resolver === 'function' ? resolver(session) === true : false;
  }

  function resolveKillSwitch(resolver, session) {
    return typeof resolver === 'function' ? resolver(session) === true : true;
  }

  function getRegistryValue(registry, method, id) {
    return registry && typeof registry[method] === 'function' ? registry[method](id) : null;
  }

  function validateBindings(session, context = {}) {
    const operatorPolicy = context.operatorPolicy;
    const requestPermission = operatorPolicy && typeof operatorPolicy.canRequest === 'function'
      ? operatorPolicy.canRequest(session)
      : { allowed: false };
    if (!operatorPolicy || requestPermission.allowed !== true) {
      return { valid: false, code: 'CANARY_OPERATOR_NOT_AUTHORIZED', reason: 'operator_not_authorized' };
    }
    const adapter = getRegistryValue(context.adapterRegistry, 'getAdapter', session.adapter_id);
    if (!adapter || !adapter.metadata || adapter.metadata.provider_id !== session.provider_id || adapter.metadata.adapter_id !== session.adapter_id || adapter.metadata.readiness_candidate_id !== session.readiness_candidate_id) {
      return { valid: false, code: 'CANARY_ADAPTER_BLOCKED', reason: 'adapter_binding_invalid' };
    }
    const connector = getRegistryValue(context.lifecycleRegistry, 'getConnector', session.connector_id);
    if (!connector || connector.provider_id !== session.provider_id || connector.adapter_id !== session.adapter_id || connector.lifecycle_version !== session.lifecycle_version || !Array.isArray(connector.workspace_types) || !connector.workspace_types.includes(session.workspace_type)) {
      return { valid: false, code: 'CANARY_LIFECYCLE_BLOCKED', reason: 'lifecycle_binding_invalid' };
    }
    const configuration = getRegistryValue(context.configurationRegistry, 'getConfiguration', session.configuration_id);
    if (!configuration || configuration.provider_id !== session.provider_id || configuration.adapter_id !== session.adapter_id || configuration.configuration_version !== session.configuration_version || configuration.readiness_candidate_id !== session.readiness_candidate_id || configuration.tenant_id !== session.tenant_id || configuration.workspace_type !== session.workspace_type) {
      return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'configuration_binding_invalid' };
    }
    if (!context.secretReferenceRegistry || !context.secretResolver || !context.readinessResult) {
      return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_or_readiness_binding_missing' };
    }
    const readinessHash = contract.hashCanaryEvidence(context.readinessResult);
    if (readinessHash !== session.readiness_evidence_id) {
      return { valid: false, code: 'CANARY_READINESS_BLOCKED', reason: 'readiness_hash_mismatch' };
    }
    if (!context.targetAllowlist || typeof context.targetAllowlist.isTargetAllowed !== 'function') {
      return { valid: false, code: 'CANARY_TARGET_NOT_ALLOWLISTED', reason: 'target_allowlist_missing' };
    }
    const target = context.targetAllowlist.isTargetAllowed({
      environment: session.environment,
      target_origin: session.target_origin,
      target_path: session.target_path || '/',
      operation: session.operation,
      source_type: session.source_type
    });
    if (!target || target.allowed !== true) return { valid: false, code: 'CANARY_TARGET_NOT_ALLOWLISTED', reason: target && target.blocked_reason || 'target_not_allowlisted' };
    if (!isListed(context.tenantAllowlist, session.tenant_id, session)) return { valid: false, code: 'CANARY_TENANT_NOT_ALLOWLISTED', reason: 'tenant_not_allowlisted' };
    if (!isListed(context.workspaceAllowlist, session.workspace_type, session)) return { valid: false, code: 'CANARY_WORKSPACE_NOT_ALLOWLISTED', reason: 'workspace_not_allowlisted' };
    if (!isListed(context.userAllowlist, session.user_id, session)) return { valid: false, code: 'CANARY_USER_NOT_ALLOWLISTED', reason: 'user_not_allowlisted' };
    if (!resolveFlag(context.featureFlagResolver, session)) return { valid: false, code: 'CANARY_FEATURE_FLAG_OFF', reason: 'feature_flag_off' };
    if (resolveKillSwitch(context.killSwitchResolver, session)) return { valid: false, code: 'CANARY_KILL_SWITCH_ACTIVE', reason: 'kill_switch_active' };
    if (!context.publicWebPilotGate || typeof context.publicWebPilotGate !== 'function') return { valid: false, code: 'CANARY_INTERNAL_ERROR', reason: 'pilot_gate_missing' };
    const gateRequest = {
      ...session,
      target_path: target.target_path || session.target_path || '/',
      target: `${session.target_origin}${target.target_path || session.target_path || '/'}`,
      feature_flag_enabled: true,
      kill_switch_active: false
    };
    const gateContext = {
      ...context,
      environment: session.environment,
      production: false,
      feature_flag: true,
      kill_switch: false,
      canary_authorized: true,
      rollout_percentage: session.rollout_percentage,
      allowed_tenants: Array.isArray(context.tenantAllowlist) ? context.tenantAllowlist : undefined,
      allowed_workspaces: Array.isArray(context.workspaceAllowlist) ? context.workspaceAllowlist : undefined,
      allowed_users: Array.isArray(context.userAllowlist) ? context.userAllowlist : undefined,
      audit_available: true,
      dnsResolver: context.dnsResolver && typeof context.dnsResolver.resolveSyncForPolicy === 'function'
        ? context.dnsResolver.resolveSyncForPolicy
        : context.dnsResolver
    };
    const gate = context.publicWebPilotGate(gateRequest, gateContext);
    if (!gate || gate.allowed !== true) return { valid: false, code: 'CANARY_READINESS_BLOCKED', reason: gate && gate.blocking_reasons && gate.blocking_reasons[0] || 'pilot_gate_blocked' };
    if (!context.rateLimitBudget || typeof context.rateLimitBudget.check !== 'function' || context.rateLimitBudget.check(session).allowed !== true) {
      return { valid: false, code: 'CANARY_BUDGET_BLOCKED', reason: 'rate_limit_budget_blocked' };
    }
    if (!context.costBudget || typeof context.costBudget.check !== 'function' || context.costBudget.check(session).allowed !== true) {
      return { valid: false, code: 'CANARY_BUDGET_BLOCKED', reason: 'cost_budget_blocked' };
    }
    if (!context.auditSink || typeof context.auditSink.append !== 'function') return { valid: false, code: 'CANARY_INTERNAL_ERROR', reason: 'audit_sink_missing' };
    return { valid: true };
  }

  function apply(session, request, nextState, eventName, patch = {}) {
    const previous = clone(session);
    const next = Object.freeze({
      ...clone(session),
      ...patch,
      canary_state: nextState,
      version: session.version + 1,
      updated_at: nowIso()
    });
    sessions.set(next.canary_session_id, next);
    const event = audit(next, request, eventName, true, null, null, {
      event_name: eventName,
      previous_state: previous.canary_state,
      current_state: next.canary_state
    });
    appendHistory(next.canary_session_id, event);
    return {
      ok: true,
      status: eventName,
      applied: true,
      session: clone(next),
      audit_event_candidate: event,
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false,
      error: null
    };
  }

  function createBaseSession(request) {
    const validation = contract.validateCanaryRequest(request);
    if (!validation.valid) return { error: validation.errors[0] || 'invalid_canary_request' };
    return {
      canary_session_id: request.canary_session_id,
      trace_id: request.trace_id,
      connector_id: request.connector_id,
      configuration_id: request.configuration_id,
      adapter_id: request.adapter_id,
      provider_id: request.provider_id,
      readiness_candidate_id: request.readiness_candidate_id,
      workspace_type: request.workspace_type,
      tenant_id: request.tenant_id,
      user_id: request.user_id,
      operator_id: request.operator_id,
      operator_role: request.operator_role,
      environment: request.environment,
      target_origin: request.target_origin,
      target_path: request.target_path || '/',
      target_path_hash: request.target_path_hash || contract.hashCanaryEvidence({ target_path: request.target_path || '/' }),
      source_type: request.source_type,
      operation: request.operation,
      feature_flag_key: request.feature_flag_key,
      feature_flag_enabled: request.feature_flag_enabled,
      kill_switch_key: request.kill_switch_key,
      kill_switch_active: request.kill_switch_active,
      rollout_percentage: request.rollout_percentage,
      maximum_requests: request.maximum_requests,
      requests_used: 0,
      started_at: request.requested_at,
      expires_at: request.expires_at,
      canary_state: 'requested',
      lifecycle_version: request.lifecycle_version,
      configuration_version: request.configuration_version,
      readiness_evidence_id: request.readiness_evidence_id,
      approval_id: '',
      approved_by: '',
      approved_at: '',
      cancellation_reason: '',
      terminal_reason: '',
      simulated: true,
      executed: false,
      real_provider_called: false,
      version: 1
    };
  }

  function requestCanary(request) {
    const consumed = consumeRequestId(request);
    if (!consumed.ok) return blocked(null, request, consumed.code, consumed.reason);
    const base = createBaseSession(request);
    if (base.error) return blocked(null, request, 'INVALID_CANARY_REQUEST', base.error);
    if (sessions.has(base.canary_session_id)) return blocked(base, request, 'CANARY_REPLAY_DETECTED', 'duplicate_canary_session');
    const session = Object.freeze(base);
    sessions.set(session.canary_session_id, session);
    const event = audit(session, request, 'public_web_canary_requested', true, null, null, { current_state: 'requested' });
    appendHistory(session.canary_session_id, event);
    return { ok: true, status: 'public_web_canary_requested', applied: true, session: clone(session), audit_event_candidate: event, error: null, simulated: true, executed: false, real_provider_called: false, can_trigger_real_execution: false };
  }

  function validateCanary(request, context = {}) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    if (session.canary_state !== 'requested') return blocked(session, request, 'CANARY_STATE_TRANSITION_INVALID', 'canary_state_transition_invalid');
    const validationPending = apply(session, request, 'validation_pending', 'public_web_canary_validation_pending');
    const current = sessions.get(session.canary_session_id);
    const validation = validateBindings(current, context);
    if (!validation.valid) {
      return apply(current, request, 'validation_blocked', 'public_web_canary_validation_blocked', {
        terminal_reason: validation.reason,
        error_code: validation.code
      });
    }
    return apply(current, request, 'approved_pending', 'public_web_canary_validation_passed');
  }

  function approveCanary(request, context = {}) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    if (session.canary_state !== 'approved_pending') return blocked(session, request, 'CANARY_STATE_TRANSITION_INVALID', 'canary_state_transition_invalid');
    const policy = context.operatorPolicy;
    if (!policy || typeof policy.validateApproval !== 'function' || typeof policy.consumeApproval !== 'function') {
      return blocked(session, request, 'CANARY_APPROVAL_REQUIRED', 'operator_policy_required');
    }
    const approvalValidation = contract.validateCanaryApproval(request, session, { clock, dualApproval: true });
    if (!approvalValidation.valid) return blocked(session, request, 'INVALID_CANARY_APPROVAL', approvalValidation.errors[0]);
    const policyValidation = policy.validateApproval(request, session);
    if (!policyValidation.valid) return blocked(session, request, policyValidation.error_code || 'CANARY_APPROVAL_REQUIRED', policyValidation.reason || 'approval_policy_blocked');
    const consumedApproval = policy.consumeApproval(request, session);
    if (!consumedApproval.consumed) return blocked(session, request, consumedApproval.error_code || 'CANARY_APPROVAL_REQUIRED', consumedApproval.reason || 'approval_not_consumed');
    return apply(session, request, 'approved', 'public_web_canary_approved', {
      approval_id: request.approval_id,
      approved_by: request.approved_by,
      approved_at: request.approved_at
    });
  }

  function activateCanary(request, context = {}) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    if (session.canary_state !== 'approved') return blocked(session, request, 'CANARY_STATE_TRANSITION_INVALID', 'canary_state_transition_invalid');
    if (contract.isSessionExpired(session, clock)) return apply(session, request, 'expired', 'public_web_canary_expired', { terminal_reason: 'canary_session_expired' });
    const policy = context.operatorPolicy;
    if (!policy || typeof policy.isApprovalActive !== 'function' || !policy.isApprovalActive(session.approval_id, session) || policy.isApprovalRevoked(session.approval_id)) {
      return blocked(session, request, 'CANARY_APPROVAL_REQUIRED', 'approval_not_active');
    }
    const validation = validateBindings(session, context);
    if (!validation.valid) return blocked(session, request, validation.code, validation.reason);
    return apply(session, request, 'active', 'public_web_canary_activated');
  }

  function executeCanaryRequest(request, result = {}) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    if (session.canary_state !== 'active') return blocked(session, request, 'CANARY_SESSION_NOT_ACTIVE', 'canary_session_not_active');
    const executing = apply(session, request, 'executing', 'public_web_canary_request_started');
    const current = sessions.get(session.canary_session_id);
    const success = result.status === 'public_web_candidate_success';
    const used = current.requests_used + 1;
    const exhausted = used >= current.maximum_requests;
    const nextState = success ? (exhausted ? 'completed' : 'active') : 'failed_safe';
    const eventName = success ? 'public_web_canary_request_succeeded' : 'public_web_canary_request_failed_safe';
    return apply(current, request, nextState, eventName, {
      requests_used: used,
      terminal_reason: success && exhausted ? 'request_limit_reached' : (!success ? 'safe_failure' : null)
    });
  }

  function completeCanary(request) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    return apply(session, request, 'completed', 'public_web_canary_completed', { terminal_reason: request.reason || 'completed' });
  }

  function cancelCanary(request) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    return apply(session, request, 'cancelled', 'public_web_canary_cancelled', { terminal_reason: request.reason || 'cancelled' });
  }

  function expireCanary(request) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    return apply(session, request, 'expired', 'public_web_canary_expired', { terminal_reason: request.reason || 'expired' });
  }

  function terminateByKillSwitch(request) {
    const consumed = consumeRequestId(request);
    const { session, blocked: missing } = getSessionOrBlocked(request);
    if (missing) return missing;
    if (!consumed.ok) return blocked(session, request, consumed.code, consumed.reason);
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    return apply(session, request, 'kill_switch_terminated', 'public_web_canary_kill_switch_terminated', { terminal_reason: 'kill_switch_active' });
  }

  return Object.freeze({
    requestCanary,
    validateCanary,
    approveCanary,
    activateCanary,
    executeCanaryRequest,
    completeCanary,
    cancelCanary,
    expireCanary,
    terminateByKillSwitch,
    getCanarySession(sessionId) { return clone(sessions.get(sessionId)) || null; },
    listCanarySessions(filters = {}) {
      return [...sessions.values()]
        .filter((session) => !filters.state || session.canary_state === filters.state)
        .map(clone)
        .sort((a, b) => a.canary_session_id.localeCompare(b.canary_session_id));
    },
    getCanaryHistory(sessionId) { return (history.get(sessionId) || []).map(clone); },
    unregisterCanary(request) { return blocked(sessions.get(request && request.canary_session_id), request, 'CANARY_STATE_TRANSITION_INVALID', 'canary_unregister_blocked'); }
  });
}

module.exports.createPublicWebCanarySessionRegistry = createHardenedPublicWebCanarySessionRegistry;
