'use strict';

const { sanitizeTrialData } = require('./public-web-canary-trial-contract');

function evaluateTrialDecision(trial = {}, report = {}, evidence = {}) {
  const terminateSignals = [
    evidence.ssrf_blocks,
    evidence.dns_rebinding_blocks,
    evidence.private_ip_blocks,
    evidence.metadata_target_blocks,
    evidence.secret_leak,
    evidence.raw_content_leak,
    evidence.approval_bypass,
    evidence.replay_bypass,
    evidence.production_enabled,
    evidence.provider_calls > 1,
    evidence.audit_event_count === 0
  ];
  const remediationSignals = [
    evidence.timeouts,
    evidence.status === 'public_web_rate_limited',
    evidence.http_status_class === '4xx',
    evidence.http_status_class === '5xx',
    evidence.sanitization_failed,
    evidence.response_invalid,
    evidence.policy_mismatch,
    report.cleanup_status && report.cleanup_status !== 'cleanup_completed'
  ];
  let decision = 'remain_disabled';
  let reason = 'trial_not_successful';
  if (terminateSignals.some(Boolean)) {
    decision = 'terminate_candidate';
    reason = 'critical_safety_signal';
  } else if (remediationSignals.some(Boolean)) {
    decision = 'remediation_required';
    reason = 'remediation_signal';
  } else if (
    evidence.status === 'trial_success' &&
    evidence.real_provider_called === true &&
    evidence.executed === true &&
    (evidence.provider_calls || report.provider_calls) === 1 &&
    (report.production_blocked !== false) &&
    (report.target_policy_enabled !== true) &&
    (report.session_terminal !== false) &&
    Number(evidence.duration_ms || 0) <= Number(trial.timeout_ms || report.timeout_ms || 15000) &&
    Number(evidence.bytes_received || 0) <= Number(trial.maximum_response_bytes || report.maximum_response_bytes || 2097152)
  ) {
    decision = 'eligible_for_second_trial';
    reason = 'single_clean_trial';
  } else if (evidence.status === 'trial_failed_safe') {
    decision = 'remediation_required';
    reason = 'failed_safe';
  }
  return sanitizeTrialData({
    trial_id: trial.trial_id || evidence.trial_id,
    decision,
    reason,
    production_approved: false,
    runtime_enabled: false,
    unrestricted_rollout: false,
    automatic_activation: false,
    decided_at: report.completed_at || evidence.finished_at || null
  });
}

module.exports = {
  evaluateTrialDecision
};
