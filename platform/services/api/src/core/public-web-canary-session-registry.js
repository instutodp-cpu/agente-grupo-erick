'use strict';

const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  buildCanaryAuditEventCandidate,
  buildSafeCanaryError,
  clone,
  hashCanaryEvidence,
  isSessionExpired,
  parseCanaryTimestamp,
  sanitizeCanaryData,
  validateCanaryApproval,
  validateCanaryRequest,
  validateCanarySession
} = require('./public-web-canary-session-contract');

const ELIGIBLE_LIFECYCLE_STATES = Object.freeze([
  'readiness_passed',
  'configuration_pending',
  'feature_flag_off',
  'runtime_disabled'
]);

function safeError(code, reason) {
  return buildSafeCanaryError(code, reason || code, { blocked_reason: reason || code });
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

function getFromRegistry(registry, method, id) {
  return registry && typeof registry[method] === 'function' ? registry[method](id) : null;
}

function resolveFlag(resolver, session) {
  return typeof resolver === 'function' ? resolver(session) === true : false;
}

function resolveKillSwitch(resolver, session) {
  return typeof resolver === 'function' ? resolver(session) === true : true;
}

function validateSecretReferenceBinding(session, deps) {
  const configuration = getFromRegistry(deps.configurationRegistry, 'getConfiguration', session.configuration_id);
  const reference = getFromRegistry(deps.secretReferenceRegistry, 'getSecretReference', session.secret_reference_id);
  if (!configuration) return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'configuration_missing' };
  if (!reference) return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_reference_missing' };
  const descriptorIds = Array.isArray(configuration.secret_reference_descriptors)
    ? configuration.secret_reference_descriptors.map((descriptor) => descriptor.reference_id)
    : [];
  if (!descriptorIds.includes(session.secret_reference_id)) return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_reference_descriptor_mismatch' };
  if (reference.provider_id !== session.provider_id) return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_reference_provider_mismatch' };
  if (reference.tenant_id !== session.tenant_id) return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_reference_tenant_mismatch' };
  if (reference.workspace_type !== session.workspace_type) return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_reference_workspace_mismatch' };
  if (reference.revoked === true || reference.disabled === true || ['revoked', 'disabled', 'expired', 'rotation_required', 'reference_pending'].includes(reference.status)) {
    return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_reference_not_resolvable' };
  }
  if (!deps.secretResolver || typeof deps.secretResolver.canResolve !== 'function' || deps.secretResolver.canResolve(reference) !== true) {
    return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'secret_resolver_blocked' };
  }
  return { valid: true, reference, configuration };
}

function validateCanaryExecutionBindings(session, deps = {}, input = {}, options = {}) {
  if (!session) return { valid: false, code: 'CANARY_SESSION_NOT_FOUND', reason: 'canary_session_not_found' };
  if (options.requireApproval !== false) {
    const policy = deps.operatorPolicy;
    if (!policy || typeof policy.isApprovalActive !== 'function' || typeof policy.isApprovalRevoked !== 'function') {
      return { valid: false, code: 'CANARY_APPROVAL_REQUIRED', reason: 'operator_policy_missing' };
    }
    if (!policy.isApprovalActive(session.approval_id, session, deps.clock) || policy.isApprovalRevoked(session.approval_id)) {
      return { valid: false, code: 'CANARY_APPROVAL_REQUIRED', reason: 'approval_not_active' };
    }
  } else if (!deps.operatorPolicy || typeof deps.operatorPolicy.canRequest !== 'function' || deps.operatorPolicy.canRequest(session).allowed !== true) {
    return { valid: false, code: 'CANARY_OPERATOR_NOT_AUTHORIZED', reason: 'operator_not_authorized' };
  }

  const adapter = getFromRegistry(deps.adapterRegistry, 'getAdapter', session.adapter_id);
  const metadata = adapter && adapter.metadata;
  if (!metadata || metadata.adapter_id !== session.adapter_id || metadata.provider_id !== session.provider_id || metadata.readiness_candidate_id !== session.readiness_candidate_id) {
    return { valid: false, code: 'CANARY_ADAPTER_BLOCKED', reason: 'adapter_binding_invalid' };
  }

  const connector = getFromRegistry(deps.lifecycleRegistry, 'getConnector', session.connector_id);
  if (!connector || connector.connector_id !== session.connector_id || connector.provider_id !== session.provider_id || connector.adapter_id !== session.adapter_id) {
    return { valid: false, code: 'CANARY_LIFECYCLE_BLOCKED', reason: 'lifecycle_binding_invalid' };
  }
  if (connector.lifecycle_version !== session.lifecycle_version || !ELIGIBLE_LIFECYCLE_STATES.includes(connector.lifecycle_state)) {
    return { valid: false, code: 'CANARY_LIFECYCLE_BLOCKED', reason: 'lifecycle_state_or_version_invalid' };
  }

  const configuration = getFromRegistry(deps.configurationRegistry, 'getConfiguration', session.configuration_id);
  if (!configuration || configuration.configuration_id !== session.configuration_id || configuration.provider_id !== session.provider_id || configuration.adapter_id !== session.adapter_id) {
    return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'configuration_binding_invalid' };
  }
  if (configuration.configuration_version !== session.configuration_version || configuration.configuration_status !== 'structurally_ready' || configuration.readiness_candidate_id !== session.readiness_candidate_id) {
    return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'configuration_state_or_version_invalid' };
  }
  if (configuration.tenant_id !== session.tenant_id || configuration.workspace_type !== session.workspace_type) {
    return { valid: false, code: 'CANARY_CONFIGURATION_BLOCKED', reason: 'configuration_scope_mismatch' };
  }

  if (!deps.readinessResult || hashCanaryEvidence(deps.readinessResult) !== session.readiness_evidence_id) {
    return { valid: false, code: 'CANARY_READINESS_BLOCKED', reason: 'readiness_hash_mismatch' };
  }

  const secret = validateSecretReferenceBinding(session, deps);
  if (!secret.valid) return secret;

  if (!isListed(deps.tenantAllowlist, session.tenant_id, session)) return { valid: false, code: 'CANARY_TENANT_NOT_ALLOWLISTED', reason: 'tenant_not_allowlisted' };
  if (!isListed(deps.workspaceAllowlist, session.workspace_type, session)) return { valid: false, code: 'CANARY_WORKSPACE_NOT_ALLOWLISTED', reason: 'workspace_not_allowlisted' };
  if (!isListed(deps.userAllowlist, session.user_id, session)) return { valid: false, code: 'CANARY_USER_NOT_ALLOWLISTED', reason: 'user_not_allowlisted' };
  if (resolveFlag(deps.featureFlagResolver, session) !== true) return { valid: false, code: 'CANARY_FEATURE_FLAG_OFF', reason: 'feature_flag_off' };
  if (resolveKillSwitch(deps.killSwitchResolver, session) === true) return { valid: false, code: 'CANARY_KILL_SWITCH_ACTIVE', reason: 'kill_switch_active' };
  if (session.environment === 'production' || !['development', 'staging'].includes(session.environment)) return { valid: false, code: 'CANARY_PRODUCTION_BLOCKED', reason: 'environment_blocked' };
  if (!(session.rollout_percentage > 0 && session.rollout_percentage <= 1)) return { valid: false, code: 'CANARY_ROLLOUT_BLOCKED', reason: 'rollout_blocked' };

  if (!deps.targetAllowlist || typeof deps.targetAllowlist.isTargetAllowed !== 'function') return { valid: false, code: 'CANARY_TARGET_NOT_ALLOWLISTED', reason: 'target_allowlist_missing' };
  const target = deps.targetAllowlist.isTargetAllowed({
    environment: session.environment,
    target_origin: session.target_origin,
    target_path: session.target_path,
    operation: session.operation,
    source_type: session.source_type
  });
  if (!target || target.allowed !== true) return { valid: false, code: 'CANARY_TARGET_NOT_ALLOWLISTED', reason: target && target.blocked_reason || 'target_not_allowlisted' };
  if (target.target_path !== session.target_path) return { valid: false, code: 'CANARY_TARGET_NOT_ALLOWLISTED', reason: 'target_path_mismatch' };
  if (session.maximum_requests > target.target_policy.maximum_requests) return { valid: false, code: 'CANARY_TARGET_POLICY_BLOCKED', reason: 'session_requests_exceed_policy' };

  if (deps.rateLimitBudget && typeof deps.rateLimitBudget.check === 'function' && deps.rateLimitBudget.check(session).allowed !== true) {
    return { valid: false, code: 'CANARY_BUDGET_BLOCKED', reason: 'rate_limit_budget_blocked' };
  }
  if (deps.costBudget && typeof deps.costBudget.check === 'function' && deps.costBudget.check(session).allowed !== true) {
    return { valid: false, code: 'CANARY_BUDGET_BLOCKED', reason: 'cost_budget_blocked' };
  }
  if (!deps.auditSink || typeof deps.auditSink.append !== 'function') return { valid: false, code: 'CANARY_INTERNAL_ERROR', reason: 'audit_sink_missing' };

  return { valid: true, adapter, connector, configuration, secret_reference: secret.reference, target_policy: target.target_policy, target_path: target.target_path, target_url: target.target_url };
}

function createPublicWebCanarySessionRegistry(options = {}) {
  const sessions = new Map();
  const history = new Map();
  const processed = new Set();
  const maxHistory = Number.isInteger(options.maxHistoryPerSession) ? options.maxHistoryPerSession : 100;
  const clock = options.clock || (() => new Date().toISOString());

  function nowIso() {
    const value = clock();
    return value instanceof Date ? value.toISOString() : String(value);
  }

  function appendHistory(sessionId, event) {
    const events = history.get(sessionId) || [];
    events.push(Object.freeze(clone(event)));
    while (events.length > maxHistory) events.shift();
    history.set(sessionId, events);
  }

  function audit(session, request, fields = {}) {
    return buildCanaryAuditEventCandidate({
      ...(session || {}),
      ...(request || {}),
      event_name: fields.event_name || 'public_web_canary_event',
      current_state: fields.current_state || session && session.canary_state,
      previous_state: fields.previous_state || null,
      status: fields.status || fields.event_name || 'public_web_canary_event',
      applied: fields.applied === true,
      error_code: fields.error_code || null,
      blocked_reason: fields.blocked_reason || null,
      executed: fields.executed === true,
      real_provider_called: fields.real_provider_called === true,
      occurred_at: nowIso()
    });
  }

  function response(session, request, fields = {}) {
    const event = audit(session, request, fields);
    if (fields.appendHistory === true && session && session.canary_session_id) appendHistory(session.canary_session_id, event);
    return {
      ok: fields.ok === true,
      status: fields.status || fields.event_name || 'canary_transition_blocked',
      applied: fields.applied === true,
      session: clone(session),
      audit_event_candidate: event,
      error: fields.error_code ? safeError(fields.error_code, fields.blocked_reason) : null,
      simulated: true,
      executed: fields.executed === true,
      real_provider_called: fields.real_provider_called === true,
      can_trigger_real_execution: false
    };
  }

  function consumeId(request) {
    const id = request && (request.change_id || request.request_id || request.approval_id);
    if (typeof id !== 'string' || id.trim() === '') return { ok: false, code: 'INVALID_CANARY_REQUEST', reason: 'request_id_required' };
    if (processed.has(id)) return { ok: false, code: 'CANARY_REPLAY_DETECTED', reason: 'canary_replay_detected' };
    processed.add(id);
    return { ok: true };
  }

  function checkVersion(session, request) {
    if (!Number.isInteger(request && request.expected_version) || request.expected_version !== session.version) {
      return response(session, request, { ok: false, applied: false, error_code: 'CANARY_VERSION_CONFLICT', blocked_reason: 'canary_version_conflict' });
    }
    return null;
  }

  function storeTransition(session, request, nextState, eventName, patch = {}, resultFlags = {}) {
    const previous = clone(session);
    const next = Object.freeze({
      ...clone(session),
      ...patch,
      canary_state: nextState,
      version: session.version + 1,
      updated_at: nowIso(),
      simulated: true,
      executed: false,
      real_provider_called: false
    });
    sessions.set(next.canary_session_id, next);
    return response(next, request, {
      ok: true,
      applied: true,
      event_name: eventName,
      status: eventName,
      previous_state: previous.canary_state,
      current_state: nextState,
      appendHistory: true,
      executed: resultFlags.executed === true,
      real_provider_called: resultFlags.real_provider_called === true
    });
  }

  function requestCanary(request) {
    const id = consumeId(request);
    if (!id.ok) return response(null, request, { error_code: id.code, blocked_reason: id.reason });
    const validation = validateCanaryRequest(request);
    if (!validation.valid) return response(null, request, { error_code: 'INVALID_CANARY_REQUEST', blocked_reason: validation.errors[0] });
    if (sessions.has(request.canary_session_id)) return response(null, request, { error_code: 'CANARY_REPLAY_DETECTED', blocked_reason: 'duplicate_canary_session' });
    const session = Object.freeze({
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
      target_path: request.target_path,
      target_path_hash: hashCanaryEvidence({ target_path: request.target_path }),
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
      secret_reference_id: request.secret_reference_id,
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
    const sessionValidation = validateCanarySession(session);
    if (!sessionValidation.valid) return response(null, request, { error_code: 'INVALID_CANARY_SESSION', blocked_reason: sessionValidation.errors[0] });
    sessions.set(session.canary_session_id, session);
    return response(session, request, { ok: true, applied: true, event_name: 'public_web_canary_requested', status: 'public_web_canary_requested', current_state: 'requested', appendHistory: true });
  }

  function requireSession(request) {
    const session = sessions.get(request && request.canary_session_id);
    return session || null;
  }

  function validateCanary(request, deps = {}) {
    const id = consumeId(request);
    const session = requireSession(request);
    if (!session) return response(null, request, { error_code: 'CANARY_SESSION_NOT_FOUND', blocked_reason: 'canary_session_not_found' });
    if (!id.ok) return response(session, request, { error_code: id.code, blocked_reason: id.reason });
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    if (session.canary_state !== 'requested') return response(session, request, { error_code: 'CANARY_STATE_TRANSITION_INVALID', blocked_reason: 'canary_state_transition_invalid' });
    const pending = storeTransition(session, request, 'validation_pending', 'public_web_canary_validation_pending');
    const current = sessions.get(session.canary_session_id);
    const binding = validateCanaryExecutionBindings(current, deps, request, { requireApproval: false });
    if (!binding.valid) {
      return storeTransition(current, request, 'validation_blocked', 'public_web_canary_validation_blocked', {
        terminal_reason: binding.reason,
        error_code: binding.code
      });
    }
    return storeTransition(current, request, 'approved_pending', 'public_web_canary_validation_passed');
  }

  function approveCanary(approval, deps = {}) {
    const id = consumeId(approval);
    const session = requireSession(approval);
    if (!session) return response(null, approval, { error_code: 'CANARY_SESSION_NOT_FOUND', blocked_reason: 'canary_session_not_found' });
    if (!id.ok) return response(session, approval, { error_code: id.code, blocked_reason: id.reason });
    const conflict = checkVersion(session, approval);
    if (conflict) return conflict;
    if (session.canary_state !== 'approved_pending') return response(session, approval, { error_code: 'CANARY_STATE_TRANSITION_INVALID', blocked_reason: 'canary_state_transition_invalid' });
    const approvalValidation = validateCanaryApproval(approval, session, { clock: deps.clock, dualApproval: true });
    if (!approvalValidation.valid) return response(session, approval, { error_code: 'INVALID_CANARY_APPROVAL', blocked_reason: approvalValidation.errors[0] });
    if (!deps.operatorPolicy || typeof deps.operatorPolicy.validateApproval !== 'function' || typeof deps.operatorPolicy.consumeApproval !== 'function') {
      return response(session, approval, { error_code: 'CANARY_APPROVAL_REQUIRED', blocked_reason: 'operator_policy_required' });
    }
    const policyValidation = deps.operatorPolicy.validateApproval(approval, session);
    if (!policyValidation.valid) return response(session, approval, { error_code: policyValidation.error_code || 'CANARY_APPROVAL_REQUIRED', blocked_reason: policyValidation.reason || 'approval_policy_blocked' });
    const consumed = deps.operatorPolicy.consumeApproval(approval, session);
    if (!consumed.consumed) return response(session, approval, { error_code: consumed.error_code || 'CANARY_APPROVAL_REQUIRED', blocked_reason: consumed.reason || 'approval_not_consumed' });
    return storeTransition(session, approval, 'approved', 'public_web_canary_approved', {
      approval_id: approval.approval_id,
      approved_by: approval.approved_by,
      approved_at: approval.approved_at
    });
  }

  function activateCanary(request, deps = {}) {
    const id = consumeId(request);
    const session = requireSession(request);
    if (!session) return response(null, request, { error_code: 'CANARY_SESSION_NOT_FOUND', blocked_reason: 'canary_session_not_found' });
    if (!id.ok) return response(session, request, { error_code: id.code, blocked_reason: id.reason });
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    if (session.canary_state !== 'approved') return response(session, request, { error_code: 'CANARY_STATE_TRANSITION_INVALID', blocked_reason: 'canary_state_transition_invalid' });
    if (isSessionExpired(session, deps.clock || clock)) return storeTransition(session, request, 'expired', 'public_web_canary_expired', { terminal_reason: 'canary_session_expired' });
    const binding = validateCanaryExecutionBindings(session, deps, request, { requireApproval: true });
    if (!binding.valid) return response(session, request, { error_code: binding.code, blocked_reason: binding.reason });
    return storeTransition(session, request, 'active', 'public_web_canary_activated');
  }

  function executeCanaryRequest(request, result = {}) {
    const id = consumeId(request);
    const session = requireSession(request);
    if (!session) return response(null, request, { error_code: 'CANARY_SESSION_NOT_FOUND', blocked_reason: 'canary_session_not_found' });
    if (!id.ok) return response(session, request, { error_code: id.code, blocked_reason: id.reason });
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    if (session.canary_state !== 'active') return response(session, request, { error_code: 'CANARY_SESSION_NOT_ACTIVE', blocked_reason: 'canary_session_not_active' });
    const executing = storeTransition(session, request, 'executing', 'public_web_canary_request_started');
    const current = sessions.get(session.canary_session_id);
    const success = result.status === 'public_web_candidate_success';
    const requestsUsed = current.requests_used + 1;
    const exhausted = requestsUsed >= current.maximum_requests;
    const nextState = success ? (exhausted ? 'completed' : 'active') : 'failed_safe';
    return storeTransition(current, request, nextState, success ? 'public_web_canary_request_succeeded' : 'public_web_canary_request_failed_safe', {
      requests_used: requestsUsed,
      terminal_reason: success && exhausted ? 'request_limit_reached' : (!success ? 'safe_failure' : '')
    }, {
      executed: result.executed === true,
      real_provider_called: result.real_provider_called === true
    });
  }

  function terminalTransition(request, nextState, eventName, reason) {
    const id = consumeId(request);
    const session = requireSession(request);
    if (!session) return response(null, request, { error_code: 'CANARY_SESSION_NOT_FOUND', blocked_reason: 'canary_session_not_found' });
    if (!id.ok) return response(session, request, { error_code: id.code, blocked_reason: id.reason });
    const conflict = checkVersion(session, request);
    if (conflict) return conflict;
    return storeTransition(session, request, nextState, eventName, { terminal_reason: request.reason || reason });
  }

  return Object.freeze({
    requestCanary,
    validateCanary,
    approveCanary,
    activateCanary,
    executeCanaryRequest,
    completeCanary(request) { return terminalTransition(request, 'completed', 'public_web_canary_completed', 'completed'); },
    cancelCanary(request) { return terminalTransition(request, 'cancelled', 'public_web_canary_cancelled', 'cancelled'); },
    expireCanary(request) { return terminalTransition(request, 'expired', 'public_web_canary_expired', 'expired'); },
    terminateByKillSwitch(request) { return terminalTransition(request, 'kill_switch_terminated', 'public_web_canary_kill_switch_terminated', 'kill_switch_active'); },
    getCanarySession(sessionId) { return clone(sessions.get(sessionId)) || null; },
    listCanarySessions(filters = {}) {
      return [...sessions.values()]
        .filter((session) => !filters.state || session.canary_state === filters.state)
        .map(clone)
        .sort((a, b) => a.canary_session_id.localeCompare(b.canary_session_id));
    },
    getCanaryHistory(sessionId) { return (history.get(sessionId) || []).map(clone); },
    unregisterCanary(request) { return response(requireSession(request), request, { error_code: 'CANARY_STATE_TRANSITION_INVALID', blocked_reason: 'canary_unregister_blocked' }); }
  });
}

module.exports = {
  ELIGIBLE_LIFECYCLE_STATES,
  createPublicWebCanarySessionRegistry,
  validateCanaryExecutionBindings
};
