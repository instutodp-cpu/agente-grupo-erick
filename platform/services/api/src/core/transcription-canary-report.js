'use strict';

const {
  buildSafeTranscriptionError,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const {
  buildTranscriptionCanaryAuditEvent,
  nowIso
} = require('./transcription-canary-session-contract');

const TRANSCRIPTION_CANARY_REPORT_DECISIONS = Object.freeze([
  'NO_GO',
  'READY_FOR_NEXT_SYNTHETIC_REVIEW',
  'CLEANUP_REQUIRED',
  'ROLLBACK_REQUIRED'
]);

function buildTranscriptionCanaryReport(input = {}, context = {}) {
  const session = input.session || {};
  const evidence = input.evidence_bundle || {};
  const preflightPassed = input.preflight && input.preflight.allowed === true;
  const authorizationConsumed = input.authorization && input.authorization.consumed === true;
  const sessionCompleted = session.session_status === 'completed';
  const cleanupCompleted = input.cleanup && input.cleanup.cleanup_status === 'cleanup_completed';
  const rollbackRequired = input.rollback_required === true || session.session_status === 'rolled_back';
  const unsafeReasons = [];
  if (!preflightPassed) unsafeReasons.push('preflight_required');
  if (!authorizationConsumed) unsafeReasons.push('authorization_consumed_once_required');
  if (!sessionCompleted) unsafeReasons.push('session_completed_required');
  if (!cleanupCompleted) unsafeReasons.push('cleanup_completed_required');
  if (evidence.real_provider_called !== false || evidence.executed !== false || evidence.external_network_called !== false) unsafeReasons.push('safety_flags_invalid');
  if (evidence.safety_flags && evidence.safety_flags.production_blocked !== true) unsafeReasons.push('production_blocked_required');
  if (evidence.safety_flags && evidence.safety_flags.rollout_percentage !== 0) unsafeReasons.push('rollout_zero_required');
  const forbidden = findTranscriptionForbiddenFields({
    evidence_bundle: evidence,
    cleanup: input.cleanup,
    rollback: input.rollback
  });
  unsafeReasons.push(...forbidden);

  let decision = 'NO_GO';
  if (rollbackRequired) decision = 'ROLLBACK_REQUIRED';
  else if (!cleanupCompleted) decision = 'CLEANUP_REQUIRED';
  else if (unsafeReasons.length === 0) decision = 'READY_FOR_NEXT_SYNTHETIC_REVIEW';

  const report = sanitizeTranscriptionData({
    report_status: 'transcription_canary_report_generated',
    decision,
    session_id: session.session_id || evidence.session_id || 'session_not_available',
    candidate_id: session.candidate_id || evidence.candidate_id || 'candidate_not_available',
    readiness_evaluation_id: session.readiness_evaluation_id || evidence.readiness_evaluation_id || 'readiness_not_available',
    blocking_reasons: uniqueSorted(unsafeReasons),
    cleanup_status: input.cleanup && input.cleanup.cleanup_status || 'cleanup_not_started',
    rollback_status: input.rollback && input.rollback.rollback_status || 'rollback_not_started',
    ready_for_next_synthetic_review: decision === 'READY_FOR_NEXT_SYNTHETIC_REVIEW',
    ready_for_real_execution: false,
    ready_for_real_provider: false,
    ready_for_production: false,
    rollout_percentage: 0,
    production_blocked: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    audit_event_candidate: buildTranscriptionCanaryAuditEvent({
      session,
      event_name: 'report_generated',
      status: 'report_generated',
      decision,
      blocked_reason: unsafeReasons[0] || null,
      occurred_at: nowIso(context)
    }),
    error: decision === 'READY_FOR_NEXT_SYNTHETIC_REVIEW' ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', unsafeReasons[0] || decision)
  });

  return report;
}

module.exports = {
  TRANSCRIPTION_CANARY_REPORT_DECISIONS,
  buildTranscriptionCanaryReport
};
