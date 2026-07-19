'use strict';

const {
  deepClone,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');
const {
  TRANSCRIPTION_CANARY_TERMINAL_STATUSES,
  buildTranscriptionCanaryAuditEvent,
  freezeSanitized,
  isTranscriptionCanarySessionExpired,
  nowIso,
  safeTranscriptionCanaryResponse,
  validateTranscriptionCanarySession
} = require('./transcription-canary-session-contract');

const REGISTRY_STORAGE = new WeakMap();

const ALLOWED_TRANSITIONS = Object.freeze({
  created: Object.freeze(['preflight_passed', 'blocked', 'cancelled']),
  preflight_passed: Object.freeze(['authorized', 'blocked', 'expired']),
  authorized: Object.freeze(['running_simulation', 'expired', 'cancelled']),
  running_simulation: Object.freeze(['completed', 'blocked', 'rolled_back']),
  completed: Object.freeze(['cleaned_up']),
  blocked: Object.freeze(['cleaned_up']),
  expired: Object.freeze(['cleaned_up']),
  cancelled: Object.freeze(['cleaned_up']),
  rolled_back: Object.freeze(['cleaned_up']),
  cleaned_up: Object.freeze([])
});

const IMMUTABLE_SESSION_FIELDS = Object.freeze([
  'session_id',
  'candidate_id',
  'readiness_evaluation_id',
  'transcription_id',
  'consent_id',
  'approval_id',
  'retention_policy_id',
  'budget_policy_id',
  'provider_id',
  'adapter_id',
  'connector_id',
  'configuration_id',
  'secret_reference_id',
  'tenant_id',
  'workspace_type',
  'environment',
  'operation',
  'rollout_percentage',
  'production_blocked'
]);

function createTranscriptionCanarySessionRegistry(options = {}) {
  const sessions = new Map();
  const history = new Map();
  const transitionIds = new Set();
  const maxHistory = Number.isInteger(options.maxHistoryPerSession) ? options.maxHistoryPerSession : 100;

  function now(context = {}) {
    return nowIso({ ...options.context, ...context, clock: context.clock || options.clock });
  }

  function append(sessionId, event) {
    const events = history.get(sessionId) || [];
    events.push(Object.freeze(deepClone(sanitizeTranscriptionData(event))));
    while (events.length > maxHistory) events.shift();
    history.set(sessionId, events);
  }

  function buildEvent(session, request = {}, fields = {}) {
    return buildTranscriptionCanaryAuditEvent({
      session,
      event_name: fields.event_name || 'transcription_canary_session_transition',
      status: fields.status || session && session.session_status,
      transition_id: request.transition_id || fields.transition_id || null,
      blocked_reason: fields.blocked_reason || null,
      occurred_at: now(fields)
    });
  }

  function response(session, request = {}, fields = {}) {
    const event = buildEvent(session, request, fields);
    if (fields.appendHistory === true && session && session.session_id) append(session.session_id, event);
    return safeTranscriptionCanaryResponse({
      ok: fields.ok === true,
      allowed: fields.allowed === true,
      applied: fields.applied === true,
      status: fields.status || fields.event_name || 'transcription_canary_session_blocked',
      session,
      audit_event_candidate: event,
      blocked_reason: fields.blocked_reason,
      blocking_reasons: fields.blocking_reasons,
      error_code: fields.error_code,
      transition_id: request.transition_id
    });
  }

  function validateTransitionRequest(request = {}, options = {}) {
    const errors = [];
    if (!isPlainObject(request)) return ['transition_request_missing'];
    if (!isNonEmptyString(request.transition_id)) errors.push('transition_id_required');
    if (!isNonEmptyString(request.session_id)) errors.push('session_id_required');
    if (!Number.isInteger(request.expected_version) || request.expected_version < 1) errors.push('expected_version_invalid');
    if (options.nextStatusRequired !== false && !isNonEmptyString(request.next_status)) errors.push('next_status_required');
    return uniqueSorted(errors);
  }

  function transitionBlocked(session, request, reason, errors = [reason]) {
    return response(session, request, {
      error_code: reason === 'transition_replay_detected' ? 'TRANSCRIPTION_CANARY_REPLAY_DETECTED' : 'TRANSCRIPTION_CANARY_STATE_BLOCKED',
      blocked_reason: reason,
      blocking_reasons: errors,
      status: 'transcription_canary_session_blocked'
    });
  }

  function validateImmutableFields(current, patch = {}) {
    const errors = [];
    for (const field of IMMUTABLE_SESSION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== current[field]) errors.push(`${field}_immutable`);
    }
    return errors;
  }

  function createSession(session, context = {}) {
    const validation = validateTranscriptionCanarySession(session, { ...options.context, ...context, clock: context.clock || options.clock });
    if (!validation.valid) return response(null, session, { error_code: 'INVALID_TRANSCRIPTION_CANARY_SESSION', blocked_reason: validation.errors[0], blocking_reasons: validation.errors });
    if (sessions.has(session.session_id)) return response(null, session, { error_code: 'TRANSCRIPTION_CANARY_REPLAY_DETECTED', blocked_reason: 'session_replay_duplicate' });
    const stored = freezeSanitized({ ...session, session_status: 'created' });
    sessions.set(stored.session_id, stored);
    append(stored.session_id, buildTranscriptionCanaryAuditEvent({
      session: stored,
      event_name: 'transcription_canary_session_created',
      status: 'created',
      occurred_at: now(context)
    }));
    return response(stored, session, { ok: true, applied: true, status: 'transcription_canary_session_created', event_name: 'session_created' });
  }

  function transitionSession(request = {}, patch = {}, context = {}) {
    const requestErrors = validateTransitionRequest(request);
    if (requestErrors.length > 0) return transitionBlocked(null, request, requestErrors[0], requestErrors);
    const session = sessions.get(request.session_id);
    if (!session) return transitionBlocked(null, request, 'session_not_found');
    if (transitionIds.has(request.transition_id)) return transitionBlocked(session, request, 'transition_replay_detected');
    if (request.expected_version !== session.session_version) return transitionBlocked(session, request, 'session_version_conflict');
    if (TRANSCRIPTION_CANARY_TERMINAL_STATUSES.includes(session.session_status) && session.session_status !== 'completed' && request.next_status !== 'cleaned_up') {
      return transitionBlocked(session, request, 'terminal_session_cannot_restart');
    }
    if (!ALLOWED_TRANSITIONS[session.session_status] || !ALLOWED_TRANSITIONS[session.session_status].includes(request.next_status)) {
      return transitionBlocked(session, request, 'session_transition_not_allowed');
    }
    if (request.next_status === 'running_simulation' && isTranscriptionCanarySessionExpired(session, { ...options.context, ...context, clock: context.clock || options.clock })) {
      return transitionBlocked(session, request, 'session_expired');
    }
    const immutableErrors = validateImmutableFields(session, patch);
    if (immutableErrors.length > 0) return transitionBlocked(session, request, immutableErrors[0], immutableErrors);
    const next = freezeSanitized({
      ...deepClone(session),
      ...sanitizeTranscriptionData(patch || {}),
      session_status: request.next_status,
      session_version: session.session_version + 1,
      updated_at: now(context),
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true
    });
    transitionIds.add(request.transition_id);
    sessions.set(next.session_id, next);
    return response(next, request, {
      ok: true,
      applied: true,
      status: `transcription_canary_session_${request.next_status}`,
      event_name: request.event_name || `session_${request.next_status}`,
      appendHistory: true
    });
  }

  function getSession(sessionId) {
    return sessions.has(sessionId) ? deepClone(sessions.get(sessionId)) : null;
  }

  function getHistory(sessionId) {
    return (history.get(sessionId) || []).map(deepClone);
  }

  const registry = Object.freeze({
    createSession,
    transitionSession,
    getSession,
    getHistory,
    listSessions() {
      return [...sessions.values()].map(deepClone).sort((a, b) => a.session_id.localeCompare(b.session_id));
    }
  });
  REGISTRY_STORAGE.set(registry, { sessions, history, transitionIds });
  return registry;
}

module.exports = {
  ALLOWED_TRANSITIONS,
  createTranscriptionCanarySessionRegistry
};
