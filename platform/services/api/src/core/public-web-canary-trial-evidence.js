'use strict';

const {
  buildSafeTrialError,
  findTrialForbiddenFields,
  hashTrialEvidence,
  sanitizeTrialData
} = require('./public-web-canary-trial-contract');
const { hashValue, isNonEmptyString } = require('./public-web-transport-contract');

const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  'trial_id',
  'plan_hash',
  'preflight_evidence_hash',
  'dry_run_evidence_hash',
  'authorization_hash',
  'canary_session_id',
  'canary_execution_id',
  'request_id',
  'target_origin_hash',
  'target_path_hash',
  'environment',
  'operation',
  'started_at',
  'finished_at',
  'status',
  'executed',
  'real_provider_called',
  'result_count',
  'bytes_received',
  'duration_ms',
  'http_status_class',
  'audit_event_count',
  'report_hash'
]);

function buildTrialEvidence(input = {}) {
  return sanitizeTrialData({
    trial_id: input.trial_id,
    plan_hash: input.plan_hash,
    preflight_evidence_hash: input.preflight_evidence_hash,
    dry_run_evidence_hash: input.dry_run_evidence_hash,
    authorization_hash: input.authorization_hash || hashValue(input.authorization_id || 'authorization_absent'),
    canary_session_id: input.canary_session_id,
    canary_execution_id: input.canary_execution_id,
    request_id: input.request_id,
    target_origin_hash: input.target_origin_hash || hashValue(input.target_origin || ''),
    target_path_hash: input.target_path_hash || hashValue(input.target_path || ''),
    environment: input.environment,
    operation: input.operation,
    started_at: input.started_at,
    finished_at: input.finished_at,
    status: input.status,
    executed: input.executed === true,
    real_provider_called: input.real_provider_called === true,
    result_count: Number.isInteger(input.result_count) ? input.result_count : 0,
    bytes_received: Number.isInteger(input.bytes_received) ? input.bytes_received : 0,
    duration_ms: Number.isInteger(input.duration_ms) ? input.duration_ms : 0,
    http_status_class: input.http_status_class || null,
    audit_event_count: Number.isInteger(input.audit_event_count) ? input.audit_event_count : 0,
    report_hash: input.report_hash || null,
    warnings: Array.isArray(input.warnings) ? input.warnings.slice(0, 10).map(String) : [],
    error_code: input.error_code || null,
    blocked_reason: input.blocked_reason || null
  });
}

function validateTrialEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object') errors.push('evidence_object_required');
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    const value = evidence ? evidence[field] : undefined;
    if (!isNonEmptyString(String(value ?? '')) && typeof value !== 'boolean' && typeof value !== 'number') {
      errors.push(`${field}_required`);
    }
  }
  if (findTrialForbiddenFields(evidence).length > 0) errors.push('forbidden_field_detected');
  if (evidence && evidence.executed === false && evidence.real_provider_called === true) errors.push('execution_flags_invalid');
  return {
    valid: errors.length === 0,
    errors,
    error: errors.length > 0 ? buildSafeTrialError('INVALID_TRIAL_EVIDENCE', errors[0]) : null
  };
}

function sanitizeTrialEvidence(evidence) {
  return sanitizeTrialData(buildTrialEvidence(evidence || {}));
}

module.exports = {
  REQUIRED_EVIDENCE_FIELDS,
  buildTrialEvidence,
  validateTrialEvidence,
  hashTrialEvidence,
  sanitizeTrialEvidence
};
