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
