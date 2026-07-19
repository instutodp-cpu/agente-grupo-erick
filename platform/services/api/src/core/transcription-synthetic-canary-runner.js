'use strict';

const {
  MAX_DURATION_MS,
  buildSafeTranscriptionError,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');
const {
  buildTranscriptionCanaryAuditEvent,
  nowIso,
  safeTranscriptionCanaryResponse
} = require('./transcription-canary-session-contract');
const { buildTranscriptionCanaryEvidenceBundle } = require('./transcription-canary-evidence');
const { validateAuthorizationRecord } = require('./transcription-canary-authorization');
const {
  evaluateTranscriptionCanaryPreflight,
  validateTranscriptionCanaryPreflightResult
} = require('./transcription-canary-preflight');

const EXTRA_FORBIDDEN_RUNNER_FIELDS = Object.freeze([
  'bytes',
  'file',
  'filepath',
  'file_path',
  'path',
  'stream',
  'upload',
  'upload_payload',
  'provider_payload'
]);

function findRunnerForbiddenFields(value) {
  const found = [...findTranscriptionForbiddenFields(value)];
  const seen = new WeakSet();
  function visit(entry, path = '') {
    if (!entry || typeof entry !== 'object') return;
    if (seen.has(entry)) return;
    seen.add(entry);
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (EXTRA_FORBIDDEN_RUNNER_FIELDS.includes(key)) found.push(`forbidden_field::${key}`);
      visit(nested, path ? `${path}.${key}` : key);
    }
  }
  visit(value);
  return uniqueSorted(found);
}

function blocked(input, reason, fields = {}) {
  return sanitizeTranscriptionData({
    status: fields.status || 'transcription_canary_simulation_blocked',
    session_id: input && input.session_id || 'session_not_available',
    synthetic_summary: '',
    synthetic_segments_count: 0,
    confidence_band: 'not_available',
    evidence_bundle: null,
    blocking_reasons: uniqueSorted(fields.blocking_reasons || [reason]),
    audit_event_candidate: buildTranscriptionCanaryAuditEvent({
      ...input,
      event_name: fields.event_name || 'simulation_blocked',
      status: fields.status || 'simulation_blocked',
      blocked_reason: reason,
      occurred_at: fields.occurred_at || new Date(0).toISOString()
    }),
    error: buildSafeTranscriptionError(fields.error_code || 'INVALID_ADAPTER_REQUEST', reason),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  });
}

function validateRunnerInput(input = {}) {
  const errors = [];
  if (!isPlainObject(input)) return ['runner_input_missing'];
  for (const field of ['session_id', 'candidate_id', 'transcription_id', 'language', 'synthetic_text_placeholder']) {
    if (!isNonEmptyString(input[field])) errors.push(`invalid_${field}`);
  }
  if (!Number.isInteger(input.duration_ms) || input.duration_ms < 0 || input.duration_ms > MAX_DURATION_MS) errors.push('duration_ms_out_of_bounds');
  if (!Number.isInteger(input.synthetic_segments_count) || input.synthetic_segments_count < 1 || input.synthetic_segments_count > 20) errors.push('synthetic_segments_count_out_of_bounds');
  if (typeof input.synthetic_confidence !== 'number' || input.synthetic_confidence < 0 || input.synthetic_confidence > 1) errors.push('synthetic_confidence_out_of_bounds');
  if (input.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution']) {
    if (input[field] !== false) errors.push(`${field}_must_be_false`);
  }
  errors.push(...findRunnerForbiddenFields(input));
  return uniqueSorted(errors);
}

function confidenceBand(confidence) {
  if (confidence >= 0.9) return 'high_synthetic';
  if (confidence >= 0.7) return 'medium_synthetic';
  return 'low_synthetic';
}

async function runTranscriptionSyntheticCanary(input = {}, deps = {}, context = {}) {
  const validation = validateRunnerInput(input);
  const now = nowIso(context);
  if (validation.length > 0) return blocked(input, validation[0], { blocking_reasons: validation, occurred_at: now });
  const sessionRegistry = deps.sessionRegistry;
  const authorizationRegistry = deps.authorizationRegistry;
  if (!sessionRegistry || typeof sessionRegistry.getSession !== 'function' || typeof sessionRegistry.transitionSession !== 'function') {
    return blocked(input, 'session_registry_missing', { occurred_at: now });
  }
  if (!authorizationRegistry || typeof authorizationRegistry.consumeAuthorization !== 'function') {
    return blocked(input, 'authorization_registry_missing', { occurred_at: now });
  }
  if (typeof authorizationRegistry.getAuthorization !== 'function') {
    return blocked(input, 'authorization_registry_missing_get_authorization', { occurred_at: now });
  }
  const session = sessionRegistry.getSession(input.session_id);
  if (!session) return blocked(input, 'session_not_found', { occurred_at: now });
  if (session.candidate_id !== input.candidate_id || session.transcription_id !== input.transcription_id) {
    return blocked(input, 'session_binding_mismatch', { occurred_at: now });
  }
  if (session.session_status !== 'authorized') return blocked(input, 'session_not_authorized', { occurred_at: now });
  const preflight = deps.preflightResult;
  if (!preflight) return blocked(input, 'preflight_required', { occurred_at: now });
  const preflightValidation = validateTranscriptionCanaryPreflightResult(preflight, session, context);
  if (!preflightValidation.valid) {
    return blocked(input, preflightValidation.errors[0] || 'preflight_result_invalid', {
      blocking_reasons: preflightValidation.errors,
      occurred_at: now
    });
  }
  if (typeof deps.evaluatePreflight !== 'function' && deps.evaluatePreflight !== undefined) {
    return blocked(input, 'preflight_revalidation_invalid', { occurred_at: now });
  }
  const revalidated = typeof deps.evaluatePreflight === 'function'
    ? deps.evaluatePreflight(session, { ...(deps.preflightContext || {}), ...context, now })
    : evaluateTranscriptionCanaryPreflight(session, { ...(deps.preflightContext || {}), ...context, now });
  const revalidation = validateTranscriptionCanaryPreflightResult(revalidated, session, context);
  if (!revalidation.valid) {
    const revalidationReasons = revalidated && Array.isArray(revalidated.blocking_requirements) && revalidated.blocking_requirements.length > 0
      ? revalidated.blocking_requirements
      : revalidation.errors;
    return blocked(input, revalidationReasons[0] || 'preflight_revalidation_blocked', {
      blocking_reasons: revalidationReasons,
      occurred_at: now
    });
  }
  const currentAuthorization = authorizationRegistry.getAuthorization(input.authorization_id);
  if (!currentAuthorization) return blocked(input, 'authorization_not_found', { occurred_at: now });
  const authorizationValidation = validateAuthorizationRecord(currentAuthorization, {
    ...context,
    session_id: session.session_id,
    candidate_id: session.candidate_id,
    tenant_id: session.tenant_id,
    environment: session.environment
  });
  if (!authorizationValidation.valid) {
    return blocked(input, authorizationValidation.errors[0] || 'authorization_blocked', {
      blocking_reasons: authorizationValidation.errors,
      occurred_at: now
    });
  }
  const running = sessionRegistry.transitionSession({
    session_id: session.session_id,
    expected_version: session.session_version,
    transition_id: input.start_transition_id,
    next_status: 'running_simulation',
    event_name: 'simulation_started'
  }, {}, context);
  if (running.applied !== true) return blocked(input, running.blocking_reasons && running.blocking_reasons[0] || 'simulation_start_blocked', { occurred_at: now });
  const consumed = authorizationRegistry.consumeAuthorization({
    authorization_id: input.authorization_id,
    session_id: session.session_id,
    candidate_id: session.candidate_id,
    tenant_id: session.tenant_id,
    consumed_at: now
  }, context);
  if (!consumed || consumed.consumed !== true) {
    if (running.session && running.session.session_status === 'running_simulation') {
      sessionRegistry.transitionSession({
        session_id: running.session.session_id,
        expected_version: running.session.session_version,
        transition_id: `${input.start_transition_id}_authorization_blocked`,
        next_status: 'blocked',
        event_name: 'simulation_blocked'
      }, {}, context);
    }
    return blocked(input, consumed && consumed.blocking_reasons && consumed.blocking_reasons[0] || 'authorization_blocked', { occurred_at: now });
  }
  const runningSession = running.session;
  const syntheticSummary = input.synthetic_text_placeholder.slice(0, 240);
  const completed = sessionRegistry.transitionSession({
    session_id: runningSession.session_id,
    expected_version: runningSession.session_version,
    transition_id: input.complete_transition_id,
    next_status: 'completed',
    event_name: 'simulation_completed'
  }, {
    synthetic_result_status: 'completed',
    synthetic_segments_count: input.synthetic_segments_count,
    confidence_band: confidenceBand(input.synthetic_confidence)
  }, context);
  if (completed.applied !== true) return blocked(input, completed.blocking_reasons && completed.blocking_reasons[0] || 'simulation_complete_blocked', { occurred_at: now });
  const history = typeof sessionRegistry.getHistory === 'function' ? sessionRegistry.getHistory(session.session_id) : [];
  const evidence = buildTranscriptionCanaryEvidenceBundle({
    session: completed.session,
    authorization_id: input.authorization_id,
    started_at: now,
    completed_at: now,
    preflight_decision: 'preflight_passed',
    authorization_decision: 'authorization_consumed',
    state_transitions: history.map((event) => ({ event_name: event.event_name, status: event.status, transition_id: event.transition_id || null })),
    synthetic_result_metadata: {
      language: input.language,
      duration_ms: input.duration_ms,
      synthetic_segments_count: input.synthetic_segments_count,
      confidence_band: confidenceBand(input.synthetic_confidence)
    },
    blocking_reasons: [],
    cleanup_status: 'cleanup_not_started',
    rollback_status: 'rollback_not_started'
  }, context);
  if (evidence.ok !== true) return blocked(input, evidence.validation.errors[0] || 'evidence_bundle_invalid', { occurred_at: now });
  return sanitizeTranscriptionData({
    status: 'transcription_canary_simulation_completed',
    session_id: session.session_id,
    synthetic_summary: syntheticSummary,
    synthetic_segments_count: input.synthetic_segments_count,
    confidence_band: confidenceBand(input.synthetic_confidence),
    evidence_bundle: evidence.evidence_bundle,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    audit_event_candidate: buildTranscriptionCanaryAuditEvent({
      session: completed.session,
      event_name: 'simulation_completed',
      status: 'simulation_completed',
      occurred_at: now
    })
  });
}

module.exports = {
  EXTRA_FORBIDDEN_RUNNER_FIELDS,
  findRunnerForbiddenFields,
  runTranscriptionSyntheticCanary,
  validateRunnerInput
};
