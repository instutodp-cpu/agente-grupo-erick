'use strict';

const ADAPTER_LIFECYCLE_STATUSES = [
  'unregistered',
  'registered_mock',
  'registered_candidate',
  'readiness_blocked',
  'readiness_passed',
  'runtime_disabled',
  'runtime_mock_only',
  'runtime_read_only_candidate',
  'deprecated',
  'blocked'
];

const ADAPTER_KINDS = [
  'mock',
  'real_read_only_candidate',
  'real_read_only',
  'draft_only',
  'blocked'
];

const EXECUTION_STATUSES = [
  'adapter_mock_success',
  'adapter_mock_blocked',
  'adapter_mock_error_safe',
  'adapter_validation_failed',
  'adapter_not_registered',
  'adapter_disabled',
  'adapter_kind_not_allowed',
  'adapter_readiness_required',
  'adapter_feature_flag_off',
  'adapter_kill_switch_active',
  'adapter_workspace_blocked',
  'adapter_tenant_blocked',
  'adapter_permission_blocked',
  'adapter_operation_blocked',
  'adapter_timeout',
  'adapter_contract_violation',
  'adapter_internal_error_safe'
];

const ERROR_CODES = [
  'INVALID_ADAPTER_REQUEST',
  'ADAPTER_NOT_REGISTERED',
  'ADAPTER_DISABLED',
  'ADAPTER_KIND_NOT_ALLOWED',
  'READINESS_REQUIRED',
  'FEATURE_FLAG_OFF',
  'KILL_SWITCH_ACTIVE',
  'WORKSPACE_NOT_ALLOWED',
  'TENANT_SCOPE_INVALID',
  'CAPABILITY_NOT_SUPPORTED',
  'OPERATION_NOT_SUPPORTED',
  'WRITE_OPERATION_BLOCKED',
  'FORBIDDEN_FIELD_DETECTED',
  'ADAPTER_TIMEOUT',
  'INVALID_ADAPTER_RESPONSE',
  'UNSAFE_ADAPTER_RESPONSE',
  'INTERNAL_ADAPTER_ERROR'
];

const REQUIRED_ADAPTER_METADATA_FIELDS = [
  'adapter_id',
  'provider_id',
  'provider_type',
  'adapter_kind',
  'version',
  'supported_workspace_types',
  'supported_domains',
  'supported_capabilities',
  'supported_operations',
  'readiness_candidate_id',
  'feature_flag_key',
  'timeout_ms',
  'retry_policy',
  'cost_risk',
  'rate_limit_risk',
  'data_classification',
  'deprecated',
  'enabled',
  'tenant_strategy'
];

const REQUIRED_REQUEST_FIELDS = [
  'trace_id',
  'request_id',
  'adapter_id',
  'provider_id',
  'provider_class',
  'workspace_type',
  'tenant_id',
  'user_id',
  'role',
  'company_id',
  'store_id',
  'client_id',
  'domain',
  'capability',
  'operation',
  'input',
  'input_classification',
  'requested_at',
  'simulated',
  'executed',
  'real_provider_called',
  'write_allowed',
  'action_allowed',
  'send_allowed',
  'publish_allowed',
  'delete_allowed'
];

const REQUIRED_RESPONSE_FIELDS = [
  'status',
  'safe_summary',
  'simulated',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution'
];

const ALLOWED_OPERATION_PREFIXES = [
  'get',
  'list',
  'search',
  'read',
  'summarize',
  'inspect',
  'lookup',
  'compare',
  'analyze',
  'fetch_metadata',
  'generate_summary',
  'generate_draft_candidate',
  'health_check_mock'
];

const BLOCKED_OPERATION_TERMS = [
  'create',
  'update',
  'delete',
  'insert',
  'upsert',
  'write',
  'send',
  'publish',
  'merge',
  'approve',
  'reject',
  'pay',
  'payment',
  'purchase',
  'cancel',
  'upload',
  'share',
  'modify',
  'execute',
  'commit',
  'push',
  'close',
  'archive',
  'invite',
  'provision',
  'deploy'
];

const FORBIDDEN_FIELDS = [
  'token',
  'secret',
  'env',
  'headers',
  'cookies',
  'credentials',
  'authorization',
  'password',
  'apiKey',
  'accessToken',
  'refreshToken',
  'payload',
  'requiredAdapters',
  'rawPayload',
  'rawMessage',
  'userMessage',
  'requestBody',
  'responseBody',
  'rawSql',
  'rawQuery',
  'rawDatabasePayload',
  'rawSocialPayload',
  'rawTranscript',
  'rawAudio',
  'privateUrl',
  'stackTrace',
  'webhookSecret'
];

const TENANT_STRATEGIES = [
  'tenant_id_required',
  'personal_user_tenant',
  'corporate_grupo_erick',
  'external_client_tenant'
];

const MAX_TIMEOUT_MS = 30000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(isNonEmptyString))].sort();
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function findForbiddenFields(value) {
  const forbidden = new Set(FORBIDDEN_FIELDS);
  const found = [];

  function visit(entry) {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }

    if (!isPlainObject(entry)) return;

    for (const [key, nested] of Object.entries(entry)) {
      if (forbidden.has(key)) {
        found.push(`forbidden_field::${key}`);
        continue;
      }

      visit(nested);
    }
  }

  visit(value);
  return uniqueSorted(found);
}

function sanitizeAdapterData(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeAdapterData);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.includes(key)) continue;
    sanitized[key] = sanitizeAdapterData(nested);
  }

  return sanitized;
}

function isBlockedOperation(operation) {
  const normalized = String(operation || '').toLowerCase();
  return BLOCKED_OPERATION_TERMS.some((term) => normalized.includes(term));
}

function isAllowedOperation(operation) {
  const normalized = String(operation || '').toLowerCase();
  return ALLOWED_OPERATION_PREFIXES.some((prefix) => (
    normalized === prefix || normalized.startsWith(`${prefix}_`)
  ));
}

function validateRetryPolicy(retryPolicy, adapterKind) {
  if (!isPlainObject(retryPolicy)) return ['retry_policy_must_be_object'];
  if (retryPolicy.unbounded === true || retryPolicy.strategy === 'unbounded') {
    return ['retry_policy_unbounded'];
  }

  const maxAttempts = Number.isInteger(retryPolicy.max_attempts) ? retryPolicy.max_attempts : 0;
  if (adapterKind === 'mock' && maxAttempts > 1) return ['retry_policy_mock_too_high'];
  if (adapterKind !== 'mock' && maxAttempts !== 0) return ['retry_policy_real_must_be_disabled'];
  return [];
}

function validateAdapterMetadata(metadata) {
  const errors = [];

  if (!isPlainObject(metadata)) {
    return { valid: false, errors: ['metadata_must_be_object'] };
  }

  for (const field of REQUIRED_ADAPTER_METADATA_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, field)) {
      errors.push(`missing_${field}`);
    }
  }

  for (const field of [
    'adapter_id',
    'provider_id',
    'provider_type',
    'version',
    'readiness_candidate_id',
    'feature_flag_key',
    'cost_risk',
    'rate_limit_risk',
    'data_classification',
    'tenant_strategy'
  ]) {
    if (!isNonEmptyString(metadata[field])) errors.push(`invalid_${field}`);
  }

  for (const field of [
    'supported_workspace_types',
    'supported_domains',
    'supported_capabilities',
    'supported_operations'
  ]) {
    if (!isNonEmptyStringArray(metadata[field])) errors.push(`invalid_${field}`);
  }

  if (!ADAPTER_KINDS.includes(metadata.adapter_kind)) errors.push('adapter_kind_not_allowed');
  if (metadata.adapter_kind === 'real_read_only') errors.push('real_read_only_not_allowed_in_this_pr');
  if (metadata.adapter_kind === 'real_read_only_candidate' && metadata.enabled !== false) {
    errors.push('real_candidate_must_be_disabled');
  }
  if (typeof metadata.deprecated !== 'boolean') errors.push('invalid_deprecated');
  if (typeof metadata.enabled !== 'boolean') errors.push('invalid_enabled');
  if (!TENANT_STRATEGIES.includes(metadata.tenant_strategy)) errors.push('tenant_strategy_not_allowed');
  if (!Number.isInteger(metadata.timeout_ms) || metadata.timeout_ms <= 0 || metadata.timeout_ms > MAX_TIMEOUT_MS) {
    errors.push('timeout_ms_out_of_bounds');
  }

  if (Array.isArray(metadata.supported_operations)) {
    for (const operation of metadata.supported_operations) {
      if (isBlockedOperation(operation)) errors.push(`blocked_operation::${operation}`);
      if (isNonEmptyString(operation) && !isAllowedOperation(operation)) {
        errors.push(`operation_prefix_not_allowed::${operation}`);
      }
    }
  }

  if (metadata.cost_risk === 'unknown') errors.push('cost_risk_unknown');
  if (metadata.rate_limit_risk === 'unknown') errors.push('rate_limit_risk_unknown');
  errors.push(...validateRetryPolicy(metadata.retry_policy, metadata.adapter_kind));
  errors.push(...findForbiddenFields(metadata));

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAdapterRequest(request) {
  const errors = [];

  if (!isPlainObject(request)) {
    return { valid: false, errors: ['request_must_be_object'] };
  }

  for (const field of REQUIRED_REQUEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }

  for (const field of [
    'trace_id',
    'request_id',
    'adapter_id',
    'provider_id',
    'provider_class',
    'workspace_type',
    'tenant_id',
    'user_id',
    'role',
    'domain',
    'capability',
    'operation',
    'input_classification',
    'requested_at'
  ]) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }

  if (!isPlainObject(request.input)) errors.push('input_must_be_object');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  if (request.executed !== false) errors.push('executed_must_be_false_before_runtime');
  if (request.real_provider_called !== false) errors.push('real_provider_called_must_be_false');

  for (const field of ['write_allowed', 'action_allowed', 'send_allowed', 'publish_allowed', 'delete_allowed']) {
    if (request[field] !== false) errors.push(`${field}_must_be_false`);
  }

  if (isBlockedOperation(request.operation)) errors.push(`blocked_operation::${request.operation}`);
  if (isNonEmptyString(request.operation) && !isAllowedOperation(request.operation)) {
    errors.push(`operation_prefix_not_allowed::${request.operation}`);
  }

  errors.push(...findForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAdapterResponse(response) {
  const errors = [];

  if (!isPlainObject(response)) {
    return { valid: false, errors: ['response_must_be_object'] };
  }

  for (const field of REQUIRED_RESPONSE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(response, field)) errors.push(`missing_${field}`);
  }

  if (!EXECUTION_STATUSES.includes(response.status)) errors.push('status_not_allowed');
  if (!isNonEmptyString(response.safe_summary)) errors.push('invalid_safe_summary');
  if (!isPlainObject(response.data) && !isPlainObject(response.sanitized_output)) {
    errors.push('data_or_sanitized_output_required');
  }
  if (response.simulated !== true) errors.push('simulated_must_be_true');
  if (typeof response.executed !== 'boolean') errors.push('executed_must_be_boolean');
  if (response.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  if (response.can_trigger_real_execution !== false) errors.push('can_trigger_real_execution_must_be_false');

  errors.push(...findForbiddenFields(response));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSafeAdapterError(code, message, context = {}) {
  const safeCode = ERROR_CODES.includes(code) ? code : 'INTERNAL_ADAPTER_ERROR';
  return {
    error_code: safeCode,
    message: isNonEmptyString(message) ? message : 'Adapter operation blocked safely.',
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : safeCode
  };
}

function buildAdapterAuditEventCandidate(context = {}) {
  return {
    event_name: 'read_only_adapter_runtime_evaluated',
    trace_id: isNonEmptyString(context.trace_id) ? context.trace_id : 'trace_not_available',
    request_id: isNonEmptyString(context.request_id) ? context.request_id : 'request_not_available',
    adapter_id: isNonEmptyString(context.adapter_id) ? context.adapter_id : 'adapter_not_available',
    provider_id: isNonEmptyString(context.provider_id) ? context.provider_id : 'provider_not_available',
    workspace_type: isNonEmptyString(context.workspace_type) ? context.workspace_type : 'workspace_not_available',
    tenant_id: isNonEmptyString(context.tenant_id) ? context.tenant_id : 'tenant_not_available',
    user_id: isNonEmptyString(context.user_id) ? context.user_id : 'user_not_available',
    domain: isNonEmptyString(context.domain) ? context.domain : 'domain_not_available',
    capability: isNonEmptyString(context.capability) ? context.capability : 'capability_not_available',
    operation: isNonEmptyString(context.operation) ? context.operation : 'operation_not_available',
    status: isNonEmptyString(context.status) ? context.status : 'adapter_internal_error_safe',
    simulated: true,
    executed: context.executed === true,
    real_provider_called: false,
    duration_ms: Number.isInteger(context.duration_ms) && context.duration_ms >= 0 ? context.duration_ms : 0,
    error_code: isNonEmptyString(context.error_code) ? context.error_code : null,
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : null
  };
}

module.exports = {
  ADAPTER_LIFECYCLE_STATUSES,
  ADAPTER_KINDS,
  EXECUTION_STATUSES,
  ERROR_CODES,
  REQUIRED_ADAPTER_METADATA_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_RESPONSE_FIELDS,
  ALLOWED_OPERATION_PREFIXES,
  BLOCKED_OPERATION_TERMS,
  FORBIDDEN_FIELDS,
  TENANT_STRATEGIES,
  MAX_TIMEOUT_MS,
  isPlainObject,
  isNonEmptyString,
  isNonEmptyStringArray,
  uniqueSorted,
  deepClone,
  validateAdapterMetadata,
  validateAdapterRequest,
  validateAdapterResponse,
  findForbiddenFields,
  isBlockedOperation,
  buildSafeAdapterError,
  sanitizeAdapterData,
  buildAdapterAuditEventCandidate
};
