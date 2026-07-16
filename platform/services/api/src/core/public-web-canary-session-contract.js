'use strict';

const crypto = require('node:crypto');
const {
  ADAPTER_ID,
  ALLOWED_CONTENT_TYPES,
  ALLOWED_OPERATIONS,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  FORBIDDEN_FIELDS: PUBLIC_WEB_FORBIDDEN_FIELDS,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  REQUEST_LIMITS,
  hashValue,
  isBlockedOperation,
  isNonEmptyString,
  isPlainObject,
  sanitizeObject,
  uniqueSorted
} = require('./public-web-transport-contract');

const CANARY_STATES = [
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
];

const TERMINAL_CANARY_STATES = [
  'validation_blocked',
  'completed',
  'failed_safe',
  'expired',
  'cancelled',
  'kill_switch_terminated'
];

const CANARY_OPERATIONS = [
  'request_canary',
  'validate_canary',
  'approve_canary',
  'activate_canary',
  'execute_canary_request',
  'complete_canary',
  'cancel_canary',
  'expire_canary',
  'terminate_by_kill_switch'
];

const CANARY_ERROR_CODES = [
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
];

const CANARY_FORBIDDEN_FIELDS = uniqueSorted([
  ...PUBLIC_WEB_FORBIDDEN_FIELDS,
  'url',
  'full_url',
  'query_string',
  'rawUrl',
  'raw_url',
  'rawBody',
  'body',
  'html',
  'headers',
  'remote_address',
  'remote_ip',
  'ip',
  'secret_handle',
  'stack',
  'stackTrace'
]);

const REQUIRED_SESSION_FIELDS = [
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
  'approval_id',
  'approved_by',
  'approved_at',
  'cancellation_reason',
  'terminal_reason',
  'simulated',
  'executed',
  'real_provider_called',
  'version'
];

const REQUIRED_REQUEST_FIELDS = [
  'trace_id',
  'request_id',
  'change_id',
  'canary_session_id',
  'operator_id',
  'operator_role',
  'environment',
  'target_origin',
  'target_path',
  'source_type',
  'operation',
  'reason',
  'requested_at',
  'simulated',
  'executed',
  'real_provider_called'
];

const REQUIRED_APPROVAL_FIELDS = [
  'trace_id',
  'request_id',
  'change_id',
  'canary_session_id',
  'approval_id',
  'approved_by',
  'approver_role',
  'reason',
  'scope',
  'environment',
  'target_origin',
  'operation',
  'maximum_requests',
  'expires_at',
  'evidence_snapshot_hash',
  'lifecycle_version',
  'configuration_version',
  'simulated',
  'executed',
  'real_provider_called'
];

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function findCanaryForbiddenFields(value) {
  const found = [];
  const seen = new WeakSet();
  function visit(entry) {
    if (!entry || typeof entry !== 'object') return;
    if (seen.has(entry)) {
      found.push('forbidden_cycle_detected');
      return;
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (CANARY_FORBIDDEN_FIELDS.includes(key)) {
        found.push(`forbidden_field::${key}`);
        continue;
      }
      visit(nested);
    }
  }
  visit(value);
  return uniqueSorted(found);
}

function sanitizeCanaryData(value) {
  if (Array.isArray(value)) return value.map(sanitizeCanaryData);
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (CANARY_FORBIDDEN_FIELDS.includes(key)) continue;
    output[key] = sanitizeCanaryData(nested);
  }
  return output;
}

function buildSafeCanaryError(code, message, context = {}) {
  const errorCode = CANARY_ERROR_CODES.includes(code) ? code : 'CANARY_INTERNAL_ERROR';
  return {
    error_code: errorCode,
    message: isNonEmptyString(message) ? message : 'Public web canary operation blocked safely.',
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : errorCode
  };
}

function hashCanaryEvidence(value) {
  return crypto.createHash('sha256').update(JSON.stringify(sanitizeCanaryData(value || {}))).digest('hex');
}

function validateCommonSafety(value, errors) {
  if (!value || typeof value !== 'object') {
    errors.push('value_must_be_object');
    return;
  }
  if (value.simulated !== true) errors.push('simulated_must_be_true');
  if (value.executed !== false) errors.push('executed_must_be_false');
  if (value.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  errors.push(...findCanaryForbiddenFields(value));
}

function validateCanarySession(session) {
  const errors = [];
  if (!isPlainObject(session)) return { valid: false, errors: ['session_must_be_object'] };
  for (const field of REQUIRED_SESSION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(session, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['canary_session_id', 'trace_id', 'connector_id', 'configuration_id', 'adapter_id', 'provider_id', 'readiness_candidate_id', 'workspace_type', 'tenant_id', 'user_id', 'operator_id', 'operator_role', 'environment', 'target_origin', 'target_path_hash', 'source_type', 'operation', 'feature_flag_key', 'kill_switch_key', 'started_at', 'expires_at']) {
    if (!isNonEmptyString(session[field])) errors.push(`invalid_${field}`);
  }
  if (session.connector_id !== CONNECTOR_ID) errors.push('connector_id_mismatch');
  if (session.configuration_id !== CONFIGURATION_ID) errors.push('configuration_id_mismatch');
  if (session.adapter_id !== ADAPTER_ID) errors.push('adapter_id_mismatch');
  if (session.provider_id !== PROVIDER_ID) errors.push('provider_id_mismatch');
  if (session.readiness_candidate_id !== READINESS_CANDIDATE_ID) errors.push('readiness_candidate_id_mismatch');
  if (!['development', 'staging'].includes(session.environment)) errors.push('environment_not_allowed');
  if (session.environment === 'production') errors.push('production_blocked');
  if (!ALLOWED_OPERATIONS.includes(session.operation) || isBlockedOperation(session.operation)) errors.push('operation_not_allowed');
  if (session.feature_flag_enabled !== true) errors.push('feature_flag_must_be_explicitly_enabled');
  if (session.kill_switch_active !== false) errors.push('kill_switch_must_be_inactive');
  if (!(Number(session.rollout_percentage) > 0 && Number(session.rollout_percentage) <= 1)) errors.push('rollout_percentage_out_of_bounds');
  if (!Number.isInteger(session.maximum_requests) || session.maximum_requests < 1 || session.maximum_requests > 5) errors.push('maximum_requests_out_of_bounds');
  if (!Number.isInteger(session.requests_used) || session.requests_used < 0 || session.requests_used > session.maximum_requests) errors.push('requests_used_out_of_bounds');
  if (!CANARY_STATES.includes(session.canary_state)) errors.push('canary_state_not_allowed');
  if (!Number.isInteger(session.lifecycle_version) || session.lifecycle_version < 1) errors.push('invalid_lifecycle_version');
  if (!Number.isInteger(session.configuration_version) || session.configuration_version < 1) errors.push('invalid_configuration_version');
  if (!Number.isInteger(session.version) || session.version < 1) errors.push('invalid_version');
  validateCommonSafety(session, errors);
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['request_must_be_object'] };
  for (const field of REQUIRED_REQUEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['trace_id', 'request_id', 'change_id', 'canary_session_id', 'operator_id', 'operator_role', 'environment', 'target_origin', 'target_path', 'source_type', 'operation', 'reason', 'requested_at']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (!['development', 'staging'].includes(request.environment)) errors.push('environment_not_allowed');
  if (request.environment === 'production') errors.push('production_blocked');
  if (!ALLOWED_OPERATIONS.includes(request.operation) || isBlockedOperation(request.operation)) errors.push('operation_not_allowed');
  validateCommonSafety(request, errors);
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryApproval(approval, session) {
  const errors = [];
  if (!isPlainObject(approval)) return { valid: false, errors: ['approval_must_be_object'] };
  for (const field of REQUIRED_APPROVAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(approval, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['trace_id', 'request_id', 'change_id', 'canary_session_id', 'approval_id', 'approved_by', 'approver_role', 'reason', 'environment', 'target_origin', 'operation', 'expires_at', 'evidence_snapshot_hash']) {
    if (!isNonEmptyString(approval[field])) errors.push(`invalid_${field}`);
  }
  if (session) {
    if (approval.canary_session_id !== session.canary_session_id) errors.push('approval_session_mismatch');
    if (approval.environment !== session.environment) errors.push('approval_environment_mismatch');
    if (approval.target_origin !== session.target_origin) errors.push('approval_target_origin_mismatch');
    if (approval.operation !== session.operation) errors.push('approval_operation_mismatch');
    if (approval.maximum_requests !== session.maximum_requests) errors.push('approval_request_limit_mismatch');
    if (approval.lifecycle_version !== session.lifecycle_version) errors.push('approval_lifecycle_version_mismatch');
    if (approval.configuration_version !== session.configuration_version) errors.push('approval_configuration_version_mismatch');
    if (approval.approved_by === session.operator_id) errors.push('approval_self_approval_blocked');
  }
  validateCommonSafety(approval, errors);
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryExecutionRequest(request, session) {
  const validation = validateCanaryRequest(request);
  const errors = validation.errors.slice();
  if (session) {
    if (request.canary_session_id !== session.canary_session_id) errors.push('execution_session_mismatch');
    if (session.canary_state !== 'active') errors.push('session_not_active');
    if (session.requests_used >= session.maximum_requests) errors.push('request_limit_reached');
    if (request.operation !== session.operation) errors.push('execution_operation_mismatch');
    if (request.environment !== session.environment) errors.push('execution_environment_mismatch');
    if (request.target_origin !== session.target_origin) errors.push('execution_target_origin_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCanaryExecutionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['result_must_be_object'] };
  for (const field of ['canary_session_id', 'canary_execution_id', 'trace_id', 'request_id', 'status', 'target_origin_hash', 'source_type', 'operation', 'result_count', 'safe_summary', 'structured_results', 'warnings', 'duration_ms', 'bytes_received', 'redirects_followed', 'http_status_class', 'rate_limit_metadata', 'cost_metadata', 'executed', 'real_provider_called', 'can_trigger_real_execution', 'audit_event_candidate', 'error']) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) errors.push(`missing_${field}`);
  }
  if (result.can_trigger_real_execution !== false) errors.push('can_trigger_real_execution_must_be_false');
  errors.push(...findCanaryForbiddenFields(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

const TARGET_STATES = Object.freeze({
  request_canary: { inactive: 'requested' },
  validate_canary: { requested: 'validation_pending' },
  validation_passed: { validation_pending: 'approved_pending' },
  validation_failed: { validation_pending: 'validation_blocked' },
  approve_canary: { approved_pending: 'approved' },
  activate_canary: { approved: 'active' },
  execute_canary_request: { active: 'executing' },
  execution_finished: { executing: 'active' },
  complete_canary: { active: 'completed', executing: 'completed' },
  cancel_canary: { requested: 'cancelled', validation_pending: 'cancelled', approved_pending: 'cancelled', approved: 'cancelled', active: 'cancelled' },
  expire_canary: { requested: 'expired', validation_pending: 'expired', approved_pending: 'expired', approved: 'expired', active: 'expired' },
  terminate_by_kill_switch: { approved: 'kill_switch_terminated', active: 'kill_switch_terminated', executing: 'kill_switch_terminated' }
});

function validateCanaryStateTransition(fromState, event, targetState) {
  const expected = TARGET_STATES[event] && TARGET_STATES[event][fromState];
  const errors = [];
  if (!CANARY_STATES.includes(fromState)) errors.push('from_state_invalid');
  if (!expected) errors.push('transition_not_allowed');
  if (targetState && expected && targetState !== expected) errors.push('target_state_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors), target_state: expected || null };
}

function buildCanaryAuditEventCandidate(context = {}) {
  return sanitizeCanaryData({
    event_name: context.event_name || 'public_web_canary_event',
    trace_id: context.trace_id || 'trace_not_available',
    request_id: context.request_id || 'request_not_available',
    change_id: context.change_id || 'change_not_available',
    canary_session_id: context.canary_session_id || 'session_not_available',
    connector_id: context.connector_id || CONNECTOR_ID,
    configuration_id: context.configuration_id || CONFIGURATION_ID,
    adapter_id: context.adapter_id || ADAPTER_ID,
    provider_id: context.provider_id || PROVIDER_ID,
    previous_state: context.previous_state || null,
    current_state: context.current_state || null,
    operation: context.operation || 'operation_not_available',
    status: context.status || 'canary_event_recorded',
    applied: context.applied === true,
    error_code: context.error_code || null,
    blocked_reason: context.blocked_reason || null,
    environment: context.environment || 'unknown',
    target_origin_hash: context.target_origin_hash || 'target_not_available',
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
  CANARY_STATES,
  TERMINAL_CANARY_STATES,
  CANARY_OPERATIONS,
  CANARY_ERROR_CODES,
  CANARY_FORBIDDEN_FIELDS,
  REQUIRED_SESSION_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_APPROVAL_FIELDS,
  TARGET_STATES,
  deepClone,
  validateCanarySession,
  validateCanaryRequest,
  validateCanaryApproval,
  validateCanaryExecutionRequest,
  validateCanaryExecutionResult,
  validateCanaryStateTransition,
  findCanaryForbiddenFields,
  sanitizeCanaryData,
  buildSafeCanaryError,
  buildCanaryAuditEventCandidate,
  hashCanaryEvidence,
  hashValue,
  REQUEST_LIMITS,
  ALLOWED_OPERATIONS,
  ALLOWED_CONTENT_TYPES
};

const STRICT_REQUIRED_CANARY_REQUEST_FIELDS = Object.freeze([
  ...new Set([
    ...(module.exports.REQUIRED_CANARY_REQUEST_FIELDS || module.exports.REQUIRED_REQUEST_FIELDS || []),
    'workspace_type',
    'tenant_id',
    'user_id',
    'rollout_percentage',
    'maximum_requests',
    'lifecycle_version',
    'configuration_version',
    'readiness_evidence_id',
    'feature_flag_enabled',
    'kill_switch_active',
    'expires_at'
  ])
]);

function parseCanaryTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis);
}

function getClockDate(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string') return parseCanaryTimestamp(value);
  return null;
}

function validateSessionWindow(candidate, clock) {
  const startedAt = parseCanaryTimestamp(candidate && candidate.started_at || candidate && candidate.requested_at);
  const expiresAt = parseCanaryTimestamp(candidate && candidate.expires_at);
  const now = getClockDate(clock);
  if (!startedAt || !expiresAt || !now) return { valid: false, reason: 'invalid_canary_timestamp' };
  if (startedAt.getTime() >= expiresAt.getTime()) return { valid: false, reason: 'invalid_canary_window' };
  if (expiresAt.getTime() - startedAt.getTime() > 30 * 60 * 1000) return { valid: false, reason: 'canary_window_too_long' };
  return { valid: true };
}

function isSessionExpired(session, clock) {
  const expiresAt = parseCanaryTimestamp(session && session.expires_at);
  const now = getClockDate(clock);
  if (!expiresAt || !now) return true;
  return now.getTime() >= expiresAt.getTime();
}

function validateApprovalWindow(approval, session, clock) {
  const approvedAt = parseCanaryTimestamp(approval && approval.approved_at);
  const approvalExpiresAt = parseCanaryTimestamp(approval && approval.expires_at);
  const sessionExpiresAt = parseCanaryTimestamp(session && session.expires_at);
  const now = getClockDate(clock);
  if (!approvedAt || !approvalExpiresAt || !sessionExpiresAt || !now) return { valid: false, reason: 'invalid_approval_timestamp' };
  if (approvedAt.getTime() >= approvalExpiresAt.getTime()) return { valid: false, reason: 'invalid_approval_window' };
  if (approvalExpiresAt.getTime() > sessionExpiresAt.getTime()) return { valid: false, reason: 'approval_outlives_session' };
  if (now.getTime() >= approvalExpiresAt.getTime()) return { valid: false, reason: 'approval_expired' };
  return { valid: true };
}

function hasRequiredFields(value, fields) {
  return fields.every((field) => value && Object.prototype.hasOwnProperty.call(value, field));
}

function validateStrictCanaryRequest(request) {
  const base = validateCanaryRequest(request);
  if (!base.valid) return base;
  if (!hasRequiredFields(request, STRICT_REQUIRED_CANARY_REQUEST_FIELDS)) {
    return { valid: false, errors: ['missing_required_canary_request_field'] };
  }
  if (request.feature_flag_enabled !== true || request.kill_switch_active !== false) {
    return { valid: false, errors: ['invalid_canary_flag_state'] };
  }
  if (!Number.isInteger(request.maximum_requests) || request.maximum_requests < 1 || request.maximum_requests > 5) {
    return { valid: false, errors: ['invalid_canary_maximum_requests'] };
  }
  if (typeof request.rollout_percentage !== 'number' || request.rollout_percentage <= 0 || request.rollout_percentage > 1) {
    return { valid: false, errors: ['invalid_canary_rollout'] };
  }
  const window = validateSessionWindow({
    started_at: request.requested_at,
    expires_at: request.expires_at
  });
  if (!window.valid) return { valid: false, errors: [window.reason] };
  return { valid: true, errors: [] };
}

function validateStrictCanaryApproval(approval, session, options = {}) {
  const base = validateCanaryApproval(approval, session);
  if (!base.valid) return base;
  const required = [
    'approval_id',
    'session_id',
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
    'expires_at'
  ];
  if (!hasRequiredFields(approval, required)) return { valid: false, errors: ['missing_required_canary_approval_field'] };
  const scope = approval.scope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return { valid: false, errors: ['invalid_approval_scope'] };
  const bindings = [
    ['evidence_snapshot_hash', 'readiness_evidence_id'],
    ['lifecycle_version', 'lifecycle_version'],
    ['configuration_version', 'configuration_version'],
    ['environment', 'environment'],
    ['target_origin', 'target_origin'],
    ['target_path_hash', 'target_path_hash'],
    ['operation', 'operation'],
    ['source_type', 'source_type'],
    ['maximum_requests', 'maximum_requests'],
    ['rollout_percentage', 'rollout_percentage'],
    ['tenant_id', 'tenant_id'],
    ['workspace_type', 'workspace_type'],
    ['user_id', 'user_id']
  ];
  const mismatch = bindings.find(([approvalKey, sessionKey]) => approval[approvalKey] !== session[sessionKey]);
  if (mismatch) return { valid: false, errors: [`approval_scope_mismatch::${mismatch[0]}`] };
  if (approval.feature_flag_enabled !== true || approval.kill_switch_active !== false) {
    return { valid: false, errors: ['invalid_approval_flag_state'] };
  }
  if (options.dualApproval !== false && approval.approved_by === session.operator_id) {
    return { valid: false, errors: ['self_approval_blocked'] };
  }
  const window = validateApprovalWindow(approval, session, options.clock || (() => approval.approved_at));
  if (!window.valid) return { valid: false, errors: [window.reason] };
  return { valid: true, errors: [] };
}

module.exports.REQUIRED_CANARY_REQUEST_FIELDS = STRICT_REQUIRED_CANARY_REQUEST_FIELDS;
module.exports.parseCanaryTimestamp = parseCanaryTimestamp;
module.exports.validateSessionWindow = validateSessionWindow;
module.exports.isSessionExpired = isSessionExpired;
module.exports.validateApprovalWindow = validateApprovalWindow;
module.exports.validateCanaryRequest = validateStrictCanaryRequest;
module.exports.validateCanaryApproval = validateStrictCanaryApproval;
