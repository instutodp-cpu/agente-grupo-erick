'use strict';

const crypto = require('node:crypto');
const {
  ADAPTER_ID,
  ALLOWED_CONTENT_TYPES,
  ALLOWED_OPERATIONS,
  ALLOWED_SOURCE_TYPES,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  FORBIDDEN_FIELDS,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  REQUEST_LIMITS,
  hashValue,
  isBlockedOperation,
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./public-web-transport-contract');

const TRIAL_STATES = Object.freeze([
  'not_started',
  'configuration_pending',
  'preflight_pending',
  'preflight_blocked',
  'preflight_passed',
  'dry_run_pending',
  'dry_run_blocked',
  'dry_run_passed',
  'operator_confirmation_pending',
  'execution_reserved',
  'execution_started',
  'execution_succeeded',
  'execution_failed_safe',
  'report_pending',
  'report_completed',
  'decision_pending',
  'eligible_for_second_trial',
  'remediation_required',
  'terminated',
  'cancelled',
  'expired'
]);

const TRIAL_RESULTS = Object.freeze([
  'trial_success',
  'trial_failed_safe',
  'trial_blocked_preflight',
  'trial_blocked_dry_run',
  'trial_cancelled',
  'trial_expired',
  'trial_kill_switch_terminated'
]);

const TRIAL_DECISIONS = Object.freeze([
  'remain_disabled',
  'remediation_required',
  'eligible_for_second_trial',
  'terminate_candidate'
]);

const TRIAL_ERROR_CODES = Object.freeze([
  'INVALID_TRIAL_PLAN',
  'INVALID_TRIAL_CONFIGURATION',
  'INVALID_TRIAL_PREFLIGHT',
  'INVALID_TRIAL_DRY_RUN',
  'INVALID_TRIAL_EVIDENCE',
  'INVALID_TRIAL_DECISION',
  'TRIAL_REPLAY_DETECTED',
  'TRIAL_VERSION_CONFLICT',
  'TRIAL_STATE_BLOCKED',
  'TRIAL_PREFLIGHT_BLOCKED',
  'TRIAL_DRY_RUN_BLOCKED',
  'TRIAL_CONFIRMATION_REQUIRED',
  'TRIAL_AUTHORIZATION_BLOCKED',
  'TRIAL_OPERATIONAL_BOOTSTRAP_NOT_CONFIGURED',
  'TRIAL_CLEANUP_REQUIRED',
  'TRIAL_FORBIDDEN_FIELD_DETECTED',
  'TRIAL_INTERNAL_ERROR'
]);

const TRIAL_FORBIDDEN_FIELDS = Object.freeze(uniqueSorted([
  ...FORBIDDEN_FIELDS,
  'url',
  'full_url',
  'query',
  'query_string',
  'headers',
  'cookies',
  'authorization',
  'token',
  'secret',
  'secretReference',
  'secret_handle',
  'body',
  'html',
  'rawBody',
  'raw_body',
  'remote_address',
  'ip',
  'stack',
  'stackTrace'
]));

const REQUIRED_TRIAL_PLAN_FIELDS = Object.freeze([
  'trial_id',
  'trial_version',
  'trial_name',
  'environment',
  'connector_id',
  'configuration_id',
  'adapter_id',
  'provider_id',
  'readiness_candidate_id',
  'target_policy_id',
  'canary_session_id',
  'workspace_type',
  'tenant_id',
  'user_id',
  'operator_id',
  'operator_role',
  'approver_id',
  'approver_role',
  'target_origin',
  'target_path',
  'target_path_hash',
  'source_type',
  'operation',
  'requested_content_types',
  'maximum_requests',
  'rollout_percentage',
  'timeout_ms',
  'maximum_response_bytes',
  'session_expires_at',
  'approval_expires_at',
  'feature_flag_key',
  'kill_switch_key',
  'production_allowed',
  'automatic_execution_allowed',
  'message_integration_allowed',
  'confirm_integration_allowed',
  'created_at',
  'created_by',
  'reason',
  'plan_hash',
  'status'
]);

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonical(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value || {}))).digest('hex');
}

function hashTrialPlan(plan) {
  const copy = clone(plan || {});
  delete copy.plan_hash;
  return hashObject(copy);
}

function hashTrialEvidence(evidence) {
  return hashObject(evidence || {});
}

function findTrialForbiddenFields(value, seen = new WeakSet()) {
  const findings = [];
  if (!value || typeof value !== 'object') return findings;
  if (seen.has(value)) return ['forbidden_field::cycle'];
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => findings.push(...findTrialForbiddenFields(item, seen)));
    return uniqueSorted(findings);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (TRIAL_FORBIDDEN_FIELDS.includes(key)) findings.push(`forbidden_field::${key}`);
    findings.push(...findTrialForbiddenFields(nested, seen));
  }
  return uniqueSorted(findings);
}

function sanitizeTrialData(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[blocked_cycle]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeTrialData(item, seen));
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (TRIAL_FORBIDDEN_FIELDS.includes(key)) continue;
    output[key] = sanitizeTrialData(nested, seen);
  }
  return output;
}

function buildSafeTrialError(code, message, context = {}) {
  const safeCode = TRIAL_ERROR_CODES.includes(code) ? code : 'TRIAL_INTERNAL_ERROR';
  return {
    error_code: safeCode,
    message: isNonEmptyString(message) ? message : safeCode,
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : safeCode
  };
}

function buildTrialAuditEvent(fields = {}) {
  return sanitizeTrialData({
    event_name: fields.event_name || 'public_web_canary_trial_event',
    trace_id: fields.trace_id || 'trace_not_available',
    request_id: fields.request_id || 'request_not_available',
    trial_id: fields.trial_id || 'trial_not_available',
    canary_session_id: fields.canary_session_id || null,
    status: fields.status || 'trial_status_unknown',
    applied: fields.applied === true,
    error_code: fields.error_code || null,
    blocked_reason: fields.blocked_reason || null,
    simulated: true,
    executed: fields.executed === true,
    real_provider_called: fields.real_provider_called === true,
    occurred_at: fields.occurred_at || new Date(0).toISOString()
  });
}

function hasRequired(value, fields) {
  return fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function validateTarget(origin, targetPath) {
  const errors = [];
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_error) {
    return ['target_origin_invalid'];
  }
  if (parsed.protocol !== 'https:') errors.push('target_origin_not_https');
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) errors.push('target_origin_not_exact_origin');
  if (parsed.hostname === 'example.com') errors.push('target_origin_placeholder');
  if (/localhost|^\d+\.\d+\.\d+\.\d+$|\[.*\]/i.test(parsed.hostname)) errors.push('target_origin_blocked');
  if (!isNonEmptyString(targetPath) || !targetPath.startsWith('/') || targetPath.includes('?') || targetPath.includes('#') || targetPath.includes('\\')) errors.push('target_path_invalid');
  if (/%2e|%2f|%5c/i.test(targetPath) || targetPath.includes('..')) errors.push('target_path_traversal');
  return uniqueSorted(errors);
}

function validateTrialPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['plan_must_be_object'] };
  if (!hasRequired(plan, REQUIRED_TRIAL_PLAN_FIELDS)) errors.push('missing_required_trial_plan_field');
  if (findTrialForbiddenFields(plan).length > 0) errors.push('forbidden_field_detected');
  if (!['development', 'staging'].includes(plan.environment)) errors.push('environment_blocked');
  if (plan.production_allowed !== false || plan.automatic_execution_allowed !== false || plan.message_integration_allowed !== false || plan.confirm_integration_allowed !== false) errors.push('unsafe_execution_flags');
  if (plan.connector_id !== CONNECTOR_ID || plan.configuration_id !== CONFIGURATION_ID || plan.adapter_id !== ADAPTER_ID || plan.provider_id !== PROVIDER_ID || plan.readiness_candidate_id !== READINESS_CANDIDATE_ID) errors.push('identity_mismatch');
  if (!ALLOWED_OPERATIONS.includes(plan.operation) || isBlockedOperation(plan.operation)) errors.push('operation_blocked');
  if (!ALLOWED_SOURCE_TYPES.includes(plan.source_type)) errors.push('source_type_blocked');
  if (!Array.isArray(plan.requested_content_types) || plan.requested_content_types.length === 0 || plan.requested_content_types.some((type) => !ALLOWED_CONTENT_TYPES.includes(type))) errors.push('content_types_invalid');
  if (plan.maximum_requests !== 1) errors.push('maximum_requests_must_be_one');
  if (!(plan.rollout_percentage > 0 && plan.rollout_percentage <= 1)) errors.push('rollout_blocked');
  if (!Number.isInteger(plan.timeout_ms) || plan.timeout_ms < 1 || plan.timeout_ms > REQUEST_LIMITS.maximum_timeout_ms) errors.push('timeout_invalid');
  if (!Number.isInteger(plan.maximum_response_bytes) || plan.maximum_response_bytes < 1 || plan.maximum_response_bytes > REQUEST_LIMITS.maximum_response_bytes) errors.push('response_limit_invalid');
  errors.push(...validateTarget(plan.target_origin, plan.target_path));
  if (plan.target_path_hash !== hashValue(plan.target_path)) errors.push('target_path_hash_mismatch');
  if (plan.plan_hash !== hashTrialPlan(plan)) errors.push('plan_hash_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTrialConfiguration(config) {
  const allowed = [
    'trial_id',
    'environment',
    'target_policy_id',
    'target_origin',
    'target_path',
    'source_type',
    'operation',
    'requested_content_types',
    'maximum_requests',
    'rollout_percentage',
    'timeout_ms',
    'maximum_response_bytes',
    'workspace_type',
    'tenant_id',
    'user_id',
    'operator_id',
    'operator_role',
    'approver_id',
    'approver_role',
    'session_expires_at',
    'approval_expires_at',
    'reason'
  ];
  const errors = [];
  if (!isPlainObject(config)) return { valid: false, errors: ['configuration_must_be_object'] };
  for (const key of Object.keys(config)) if (!allowed.includes(key)) errors.push(`unknown_field::${key}`);
  if (findTrialForbiddenFields(config).length > 0) errors.push('forbidden_field_detected');
  if (config.target_origin === 'https://example.com') errors.push('example_config_placeholder');
  if (!['development', 'staging'].includes(config.environment)) errors.push('environment_blocked');
  errors.push(...validateTarget(config.target_origin, config.target_path));
  if (!ALLOWED_OPERATIONS.includes(config.operation) || isBlockedOperation(config.operation)) errors.push('operation_blocked');
  if (config.maximum_requests !== 1) errors.push('maximum_requests_must_be_one');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTrialPreflightResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['preflight_must_be_object'] };
  for (const field of ['status', 'passed', 'blocking_reasons', 'plan_hash', 'evidence_hash', 'executed', 'real_provider_called']) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) errors.push(`missing_${field}`);
  }
  if (result.executed !== false || result.real_provider_called !== false) errors.push('preflight_must_not_execute');
  if (findTrialForbiddenFields(result).length > 0) errors.push('forbidden_field_detected');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTrialDryRunResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['dry_run_must_be_object'] };
  if (result.status !== 'dry_run_passed') errors.push('dry_run_not_passed');
  if (result.fake_provider_calls !== 1) errors.push('fake_provider_calls_must_equal_one');
  if (result.simulated !== true || result.real_provider_called !== false) errors.push('dry_run_safety_flags_invalid');
  if (findTrialForbiddenFields(result).length > 0) errors.push('forbidden_field_detected');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTrialExecutionEvidence(evidence) {
  const errors = [];
  if (!isPlainObject(evidence)) return { valid: false, errors: ['evidence_must_be_object'] };
  for (const field of ['trial_id', 'plan_hash', 'canary_session_id', 'canary_execution_id', 'status', 'executed', 'real_provider_called', 'report_hash']) {
    if (!Object.prototype.hasOwnProperty.call(evidence, field)) errors.push(`missing_${field}`);
  }
  if (findTrialForbiddenFields(evidence).length > 0) errors.push('forbidden_field_detected');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTrialDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['decision_must_be_object'] };
  if (!TRIAL_DECISIONS.includes(decision.decision)) errors.push('decision_not_allowed');
  if (String(decision.decision || '').includes('production')) errors.push('production_decision_blocked');
  if (findTrialForbiddenFields(decision).length > 0) errors.push('forbidden_field_detected');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  REQUIRED_TRIAL_PLAN_FIELDS,
  TRIAL_DECISIONS,
  TRIAL_ERROR_CODES,
  TRIAL_FORBIDDEN_FIELDS,
  TRIAL_RESULTS,
  TRIAL_STATES,
  buildSafeTrialError,
  buildTrialAuditEvent,
  clone,
  findTrialForbiddenFields,
  hashTrialEvidence,
  hashTrialPlan,
  sanitizeTrialData,
  validateTrialConfiguration,
  validateTrialDecision,
  validateTrialDryRunResult,
  validateTrialExecutionEvidence,
  validateTrialPlan,
  validateTrialPreflightResult
};
