'use strict';

const {
  buildSafeTranscriptionError,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  buildTranscriptionCanaryAuditEvent,
  nowIso
} = require('./transcription-canary-session-contract');

function buildCleanupResult(session, fields = {}, context = {}) {
  const ok = fields.ok === true;
  return sanitizeTranscriptionData({
    ok,
    cleanup_status: fields.cleanup_status || (ok ? 'cleanup_completed' : 'cleanup_blocked'),
    session_id: session && session.session_id || fields.session_id || 'session_not_available',
    authorization_invalidated: fields.authorization_invalidated === true,
    transient_state_cleared: fields.transient_state_cleared === true,
    history_preserved: true,
    external_effects: false,
    blocking_reasons: fields.blocking_reasons || [],
    audit_event_candidate: buildTranscriptionCanaryAuditEvent({
      session,
      event_name: ok ? 'cleanup_completed' : 'cleanup_started',
      status: fields.cleanup_status || (ok ? 'cleanup_completed' : 'cleanup_blocked'),
      blocked_reason: fields.blocked_reason || null,
      occurred_at: nowIso(context)
    }),
    error: ok ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', fields.blocked_reason || 'cleanup_blocked'),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  });
}

function cleanupTranscriptionCanarySession(input = {}, deps = {}, context = {}) {
  const registry = deps.sessionRegistry;
  if (!registry || typeof registry.getSession !== 'function' || typeof registry.transitionSession !== 'function') {
    return buildCleanupResult(null, { ok: false, blocked_reason: 'session_registry_missing', blocking_reasons: ['session_registry_missing'] }, context);
  }
  const session = registry.getSession(input.session_id);
  if (!session) return buildCleanupResult(null, { ok: false, session_id: input.session_id, blocked_reason: 'session_not_found', blocking_reasons: ['session_not_found'] }, context);
  if (session.session_status === 'cleaned_up') {
    return buildCleanupResult(session, { ok: true, cleanup_status: 'cleanup_completed', authorization_invalidated: true, transient_state_cleared: true }, context);
  }
  if (deps.authorizationRegistry && typeof deps.authorizationRegistry.revokeAuthorization === 'function' && input.authorization_id) {
    deps.authorizationRegistry.revokeAuthorization(input.authorization_id);
  }
  const transitioned = registry.transitionSession({
    session_id: session.session_id,
    expected_version: session.session_version,
    transition_id: input.transition_id,
    next_status: 'cleaned_up',
    event_name: 'cleanup_completed'
  }, {
    cleanup_status: 'cleanup_completed'
  }, context);
  if (transitioned.applied !== true) {
    return buildCleanupResult(session, {
      ok: false,
      cleanup_status: 'cleanup_blocked',
      blocked_reason: transitioned.blocking_reasons && transitioned.blocking_reasons[0] || 'cleanup_transition_blocked',
      blocking_reasons: transitioned.blocking_reasons || ['cleanup_transition_blocked']
    }, context);
  }
  return buildCleanupResult(transitioned.session, { ok: true, cleanup_status: 'cleanup_completed', authorization_invalidated: true, transient_state_cleared: true }, context);
}

function rollbackTranscriptionCanarySession(input = {}, deps = {}, context = {}) {
  const registry = deps.sessionRegistry;
  if (!registry || typeof registry.getSession !== 'function' || typeof registry.transitionSession !== 'function') {
    return buildCleanupResult(null, { ok: false, cleanup_status: 'rollback_blocked', blocked_reason: 'session_registry_missing', blocking_reasons: ['session_registry_missing'] }, context);
  }
  const session = registry.getSession(input.session_id);
  if (!session) return buildCleanupResult(null, { ok: false, session_id: input.session_id, cleanup_status: 'rollback_blocked', blocked_reason: 'session_not_found', blocking_reasons: ['session_not_found'] }, context);
  if (session.session_status === 'rolled_back') {
    return sanitizeTranscriptionData({
      ok: true,
      rollback_status: 'rollback_completed',
      session,
      audit_event_candidate: buildTranscriptionCanaryAuditEvent({ session, event_name: 'rollback_completed', status: 'rollback_completed', occurred_at: nowIso(context) }),
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true
    });
  }
  const transitioned = registry.transitionSession({
    session_id: session.session_id,
    expected_version: session.session_version,
    transition_id: input.transition_id,
    next_status: 'rolled_back',
    event_name: 'rollback_completed'
  }, {
    rollback_status: 'rollback_completed',
    rollback_reason: input.reason || 'synthetic_rollback'
  }, context);
  return sanitizeTranscriptionData({
    ok: transitioned.applied === true,
    rollback_status: transitioned.applied === true ? 'rollback_completed' : 'rollback_blocked',
    session: transitioned.session || session,
    blocking_reasons: transitioned.blocking_reasons || [],
    audit_event_candidate: buildTranscriptionCanaryAuditEvent({
      session: transitioned.session || session,
      event_name: transitioned.applied === true ? 'rollback_completed' : 'rollback_started',
      status: transitioned.applied === true ? 'rollback_completed' : 'rollback_blocked',
      blocked_reason: transitioned.blocking_reasons && transitioned.blocking_reasons[0] || null,
      occurred_at: nowIso(context)
    }),
    error: transitioned.applied === true ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', transitioned.blocking_reasons && transitioned.blocking_reasons[0] || 'rollback_blocked'),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  });
}

module.exports = {
  cleanupTranscriptionCanarySession,
  rollbackTranscriptionCanarySession
};
