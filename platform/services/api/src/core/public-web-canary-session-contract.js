'use strict';

const crypto = require('node:crypto');
const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  FORBIDDEN_FIELDS: PUBLIC_WEB_FORBIDDEN_FIELDS,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  hashValue,
  isBlockedOperation,
  uniqueSorted
} = require('./public-web-transport-contract');

const CANARY_STATES = Object.freeze([
  'inactive',
  'requested',
  'validation_pending',
  'approved_pending',
  'validation_blocked',
  'approved',
  'active',
  'executing',
  'completed',
  'failed_safe',
  'expired',
  'cancelled',
  'kill_switch_terminated'
]);

const TERMINAL_CANARY_STATES = Object.freeze([
  'validation_blocked',
  'completed',
  'failed_safe',
  'expired',
  'cancelled',
  'kill_switch_terminated'
]);

const CANARY_ERROR_CODES = Object.freeze([
  'INVALID_CANARY_SESSION',
  'INVALID_CANARY_REQUEST',
  'INVALID_CANARY_APPROVAL',
  'CANARY_SESSION_NOT_FOUND',
  'CANARY_SESSION_EXPIRED',
  'CANARY_SESSION_NOT_ACTIVE',
  'CANARY_STATE_TRANSITION_INVALID',
  'CANARY_REPLAY_DETECTED',
  'CANARY_VERSION_CONFLICT',
  'CANARY_ENVIRONMENT_BLOCKED',
  'CANARY_PRODUCTION_BLOCKED',
  'CANARY_TARGET_NOT_ALLOWLISTED',
  'CANARY_TENANT_NOT_ALLOWLISTED',
  'CANARY_WORKSPACE_NOT_ALLOWLISTED',
  'CANARY_USER_NOT_ALLOWLISTED',
  'CANARY_OPERATOR_NOT_AUTHORIZED',
  'CANARY_APPROVAL_REQUIRED',
  'CANARY_APPROVAL_SCOPE_MISMATCH',
  'CANARY_FEATURE_FLAG_OFF',
  'CANARY_KILL_SWITCH_ACTIVE',
  'CANARY_ROLLOUT_BLOCKED',
  'CANARY_REQUEST_LIMIT_REACHED',
  'CANARY_BUDGET_BLOCKED',
  'CANARY_READINESS_BLOCKED',
  'CANARY_CONFIGURATION_BLOCKED',
  'CANARY_LIFECYCLE_BLOCKED',
  'CANARY_ADAPTER_BLOCKED',
  'CANARY_TARGET_POLICY_BLOCKED',
  'CANARY_FORBIDDEN_FIELD_DETECTED',
  'CANARY_INTERNAL_ERROR'
]);

const CANARY_FORBIDDEN_FIELDS = Object.freeze(uniqueSorted([
  ...PUBLIC_WEB_FORBIDDEN_FIELDS,
  'url',
  'full_url',
  'query_string',
  'rawUrl',
  'raw_url',
  'rawBody',
  'raw_body',
  'body',
  'html',
  'headers',
  'remote_address',
  'remote_ip',
  'ip',
  'secret_handle',
  'stack',
  'stackTrace'
]));

const REQUIRED_REQUEST_FIELDS = Object.freeze([
  'trace_id',
  'request_id',
  'change_id',
  'canary_session_id',
  'connector_id',
  'configuration_id',
  'adapter_id',
  'provider_id',
  'readiness_candidate_id',
  'workspace_type',
  'tenant_id',
  'user_id',
  'operator_id',
  'operator_role',
  'environment',
  'target_origin',
  'target_path',
  'source_type',
  'operation',
  'feature_flag_key',
  'feature_flag_enabled',
  'kill_switch_key',
  'kill_switch_active',
  'rollout_percentage',
  'maximum_requests',
  'lifecycle_version',
  'configuration_version',
  'readiness_evidence_id',
  'secret_reference_id',
  'reason',
  'requested_at',
  'expires_at',
  'simulated',
  'executed',
  'real_provider_called'
]);

const REQUIRED_SESSION_FIELDS = Object.freeze([
  'canary_session_id',
  'trace_id',
  'connector_id',
  'configuration_id',
  'adapter_id',
  'provider_id',
  'readiness_candidate_id',
  'workspace_type',
  'tenant_id',
  'user_id',
  'operator_id',
  'operator_role',
  'environment',
  'target_origin',
  'target_path',
  'target_path_hash',
  'source_type',
  'operation',
  'feature_flag_key',
  'feature_flag_enabled',
  'kill_switch_key',
  'kill_switch_active',
  'rollout_percentage',
  'maximum_requests',
  'requests_used',
  'started_at',
  'expires_at',
  'canary_state',
  'lifecycle_version',
  'configuration_version',
  'readiness_evidence_id',
  'secret_reference_id',
  'approval_id',
  'approved_by',
  'approved_at',
  'cancellation_reason',
  'terminal_reason',
  'simulated',
  'executed',
  'real_provider_called',
  'version'
]);

const REQUIRED_APPROVAL_FIELDS = Object.freeze([
  'trace_id',
  'request_id',
  'change_id',
  'canary_session_id',
  'session_id',
  'approval_id',
  'approved_by',
  'approver_role',
  'reason',
  'scope',
  'environment',
  'target_origin',
  'target_path_hash',
  'operation',
  'source_type',
  'maximum_requests',
  'rollout_percentage',
  'tenant_id',
  'workspace_type',
  'user_id',
  'feature_flag_enabled',
  'kill_switch_active',
  'evidence_snapshot_hash',
  'lifecycle_version',
  'configuration_version',
  'approved_at',
  'expires_at',
  'expected_version',
  'simulated',
  'executed',
  'real_provider_called'
]);

const REQUIRED_EXECUTION_RESULT_FIELDS = Object.freeze([
  'canary_session_id',
  'canary_execution_id',
  'trace_id',
  'request_id',
  'status',
  'target_origin_hash',
  'source_type',
  'operation',
  'result_count',
  'safe_summary',
  'structured_results',
  'warnings',
  'duration_ms',
  'bytes_received',
  'redirects_followed',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution',
  'audit_event_candidate',
  'error'
]);

const ALLOWED_ENVIRONMENTS = Object.freeze(['development', 'staging']);
const MAX_SESSION_MS = 30 * 60 * 1000;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parseCanaryTimestamp(value) {
  if (!isNonEmptyString(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis);
}

function getClockDate(clock, fallback) {
  const value = typeof clock === 'function' ? clock() : fallback;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string') return parseCanaryTimestamp(value);
  return null;
}

function validateSessionWindow(candidate, clock) {
  const startedAt = parseCanaryTimestamp(candidate && (candidate.started_at || candidate.requested_at));
  const expiresAt = parseCanaryTimestamp(candidate && candidate.expires_at);
  const now = getClockDate(clock, candidate && (candidate.started_at || candidate.requested_at));
  if (!startedAt || !expiresAt || !now) return { valid: false, reason: 'invalid_canary_timestamp' };
  if (startedAt.getTime() >= expiresAt.getTime()) return { valid: false, reason: 'invalid_canary_window' };
  if (expiresAt.getTime() - startedAt.getTime() > MAX_SESSION_MS) return { valid: false, reason: 'canary_window_too_long' };
  return { valid: true };
}

function isSessionExpired(session, clock) {
  const expiresAt = parseCanaryTimestamp(session && session.expires_at);
  const now = getClockDate(clock, new Date().toISOString());
  if (!expiresAt || !now) return true;
  return now.getTime() >= expiresAt.getTime();
}

function validateApprovalWindow(approval, session, clock) {
  const approvedAt = parseCanaryTimestamp(approval && approval.approved_at);
  const approvalExpiresAt = parseCanaryTimestamp(approval && approval.expires_at);
  const sessionExpiresAt = parseCanaryTimestamp(session && session.expires_at);
  const now = getClockDate(clock, approval && approval.approved_at);
  if (!approvedAt || !approvalExpiresAt || !sessionExpiresAt || !now) return { valid: false, reason: 'invalid_approval_timestamp' };
  if (approvedAt.getTime() >= approvalExpiresAt.getTime()) return { valid: false, reason: 'invalid_approval_window' };
  if (approvalExpiresAt.getTime() > sessionExpiresAt.getTime()) return { valid: false, reason: 'approval_outlives_session' };
  if (now.getTime() >= approvalExpiresAt.getTime()) return { valid: false, reason: 'approval_expired' };
  return { valid: true };
}

function hashCanaryEvidence(value) {
  return crypto.createHash('sha256').update(stableStringify(value || {})).digest('hex');
}

function hasFields(value, fields) {
  return fields.every((field) => Object.prototype.hasOwnProperty.call(value || {}, field));
}

function findCanaryForbiddenFields(value, path = '', seen = new WeakSet()) {
  const findings = [];
  if (!value || typeof value !== 'object') return findings;
  if (seen.has(value)) return ['forbidden_field::cycle'];
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...findCanaryForbiddenFields(item, `${path}[${index}]`, seen)));
    return uniqueSorted(findings);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (CANARY_FORBIDDEN_FIELDS.includes(key)) findings.push(`forbidden_field::${key}`);
    findings.push(...findCanaryForbiddenFields(nested, path ? `${path}.${key}` : key, seen));
  }
  return uniqueSorted(findings);
}

function sanitizeCanaryData(value, seen = new WeakSet()) {
  if (!(seen instanceof WeakSet)) seen = new WeakSet();
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[blocked_cycle]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeCanaryData(item, seen));
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (CANARY_FORBIDDEN_FIELDS.includes(key)) continue;
    output[key] = sanitizeCanaryData(nested, seen);
  }
  return output;
}

function buildSafeCanaryError(code, message, context = {}) {
  const safeCode = CANARY_ERROR_CODES.includes(code) ? code : 'CANARY_INTERNAL_ERROR';
  return {
    error_code: safeCode,
    message: isNonEmptyString(message) ? message : safeCode,
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : safeCode
  };
}

function validateCanaryRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['request_must_be_object'] };
  if (!hasFields(request, REQUIRED_REQUEST_FIELDS)) errors.push('missing_required_canary_request_field');
  if (findCanaryForbiddenFields(request).length > 0) errors.push('forbidden_field_detected');
  if (!ALLOWED_ENVIRONMENTS.includes(request.environment)) errors.push('environment_blocked');
  if (request.provider_id !== PROVIDER_ID || request.adapter_id !== ADAPTER_ID || request.connector_id !== CONNECTOR_ID || request.configuration_id !== CONFIGURATION_ID || request.readiness_candidate_id !== READINESS_CANDIDATE_ID) {
    errors.push('identity_mismatch');
  }
  if (isBlockedOperation(request.operation)) errors.push('operation_blocked');
  if (request.feature_flag_enabled !== true || request.kill_switch_active !== false) errors.push('invalid_canary_flag_state');
  if (request.simulated !== true || request.executed !== false || request.real_provider_called !== false) errors.push('invalid_safety_flags');
  if (!Number.isInteger(request.maximum_requests) || request.maximum_requests < 1 || request.maximum_requests > 5) errors.push('invalid_maximum_requests');
  if (typeof request.rollout_percentage !== 'number' || request.rollout_percentage <= 0 || request.rollout_percentage > 1) errors.push('invalid_rollout_percentage');
  if (validateSessionWindow({ requested_at: request.requested_at, expires_at: request.expires_at }).valid !== true) errors.push('invalid_session_window');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanarySession(session) {
  const errors = [];
  if (!isPlainObject(session)) return { valid: false, errors: ['session_must_be_object'] };
  if (!hasFields(session, REQUIRED_SESSION_FIELDS)) errors.push('missing_required_canary_session_field');
  if (!CANARY_STATES.includes(session.canary_state)) errors.push('invalid_canary_state');
  if (!Number.isInteger(session.version) || session.version < 1) errors.push('invalid_canary_version');
  if (session.simulated !== true || session.executed !== false || session.real_provider_called !== false) errors.push('invalid_session_safety_flags');
  if (session.feature_flag_enabled !== true || session.kill_switch_active !== false) errors.push('invalid_session_flag_state');
  if (validateSessionWindow(session).valid !== true) errors.push('invalid_session_window');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryApproval(approval, session, options = {}) {
  const errors = [];
  if (!isPlainObject(approval) || !isPlainObject(session)) return { valid: false, errors: ['approval_and_session_required'] };
  if (!hasFields(approval, REQUIRED_APPROVAL_FIELDS)) errors.push('missing_required_canary_approval_field');
  if (!isPlainObject(approval.scope)) errors.push('invalid_approval_scope');
  if (approval.canary_session_id !== session.canary_session_id || approval.session_id !== session.canary_session_id) errors.push('approval_session_mismatch');
  if (approval.evidence_snapshot_hash !== session.readiness_evidence_id) errors.push('approval_evidence_mismatch');
  for (const field of ['lifecycle_version', 'configuration_version', 'environment', 'target_origin', 'target_path_hash', 'operation', 'source_type', 'maximum_requests', 'rollout_percentage', 'tenant_id', 'workspace_type', 'user_id']) {
    if (approval[field] !== session[field]) errors.push(`approval_scope_mismatch::${field}`);
  }
  if (approval.feature_flag_enabled !== true || approval.kill_switch_active !== false) errors.push('invalid_approval_flag_state');
  if (options.dualApproval !== false && approval.approved_by === session.operator_id) errors.push('self_approval_blocked');
  const window = validateApprovalWindow(approval, session, options.clock);
  if (!window.valid) errors.push(window.reason);
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryExecutionRequest(request) {
  if (!isPlainObject(request)) return { valid: false, errors: ['execution_request_must_be_object'] };
  const required = ['trace_id', 'request_id', 'change_id', 'canary_session_id', 'expected_version', 'simulated', 'executed', 'real_provider_called'];
  const errors = [];
  if (!hasFields(request, required)) errors.push('missing_required_execution_request_field');
  if (request.simulated !== true || request.executed !== false || request.real_provider_called !== false) errors.push('invalid_execution_request_flags');
  if (findCanaryForbiddenFields(request).length > 0) errors.push('forbidden_field_detected');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryExecutionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['execution_result_must_be_object'] };
  if (!hasFields(result, REQUIRED_EXECUTION_RESULT_FIELDS)) errors.push('missing_required_execution_result_field');
  if (result.can_trigger_real_execution !== false) errors.push('can_trigger_real_execution_must_be_false');
  if (findCanaryForbiddenFields(result).length > 0) errors.push('forbidden_field_detected');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryStateTransition(fromState, event, toState) {
  const matrix = {
    inactive: { request_canary: 'requested' },
    requested: { validate_canary: 'validation_pending', cancel_canary: 'cancelled' },
    validation_pending: { validation_passed: 'approved_pending', validation_failed: 'validation_blocked', cancel_canary: 'cancelled', expire_canary: 'expired' },
    approved_pending: { approve_canary: 'approved', cancel_canary: 'cancelled', expire_canary: 'expired' },
    approved: { activate_canary: 'active', cancel_canary: 'cancelled', expire_canary: 'expired', terminate_by_kill_switch: 'kill_switch_terminated' },
    active: { execute_canary_request: 'executing', complete_canary: 'completed', cancel_canary: 'cancelled', expire_canary: 'expired', terminate_by_kill_switch: 'kill_switch_terminated' },
    executing: { request_success: 'active', request_success_exhausted: 'completed', request_failure_safe: 'failed_safe', terminate_by_kill_switch: 'kill_switch_terminated' }
  };
  const expected = matrix[fromState] && matrix[fromState][event];
  return { valid: expected === toState, expected: expected || null };
}

function buildCanaryAuditEventCandidate(context = {}) {
  return sanitizeCanaryData({
    event_name: context.event_name || 'public_web_canary_event',
    trace_id: context.trace_id || 'trace_not_available',
    request_id: context.request_id || context.change_id || 'request_not_available',
    change_id: context.change_id || 'change_not_available',
    canary_session_id: context.canary_session_id || context.session_id || 'session_not_available',
    connector_id: context.connector_id || 'connector_not_available',
    configuration_id: context.configuration_id || 'configuration_not_available',
    adapter_id: context.adapter_id || 'adapter_not_available',
    provider_id: context.provider_id || 'provider_not_available',
    previous_state: context.previous_state || null,
    current_state: context.current_state || context.canary_state || null,
    operation: context.operation || 'operation_not_available',
    status: context.status || 'canary_event',
    applied: context.applied === true,
    error_code: context.error_code || null,
    blocked_reason: context.blocked_reason || null,
    environment: context.environment || 'unknown',
    target_origin_hash: context.target_origin_hash || (context.target_origin ? hashValue(context.target_origin) : 'target_not_available'),
    operator_id: context.operator_id || 'operator_not_available',
    approved_by: context.approved_by || null,
    simulated: true,
    executed: context.executed === true,
    real_provider_called: context.real_provider_called === true,
    can_trigger_real_execution: false,
    occurred_at: context.occurred_at || new Date(0).toISOString()
  });
}

module.exports = {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  CANARY_ERROR_CODES,
  CANARY_FORBIDDEN_FIELDS,
  CANARY_STATES,
  TERMINAL_CANARY_STATES,
  REQUIRED_APPROVAL_FIELDS,
  REQUIRED_EXECUTION_RESULT_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_SESSION_FIELDS,
  buildCanaryAuditEventCandidate,
  buildSafeCanaryError,
  clone,
  deepClone: clone,
  findCanaryForbiddenFields,
  hashCanaryEvidence,
  hashValue,
  parseCanaryTimestamp,
  sanitizeCanaryData,
  validateApprovalWindow,
  validateCanaryApproval,
  validateCanaryExecutionRequest,
  validateCanaryExecutionResult,
  validateCanaryRequest,
  validateCanarySession,
  validateCanaryStateTransition,
  validateSessionWindow,
  isSessionExpired
};
