'use strict';

const {
  FORBIDDEN_FIELDS: ADAPTER_FORBIDDEN_FIELDS,
  TENANT_STRATEGIES,
  deepClone,
  isBlockedOperation,
  isNonEmptyString,
  isNonEmptyStringArray,
  isPlainObject,
  sanitizeAdapterData,
  uniqueSorted
} = require('./read-only-adapter-contract');

const LIFECYCLE_STATES = [
  'unregistered',
  'registered',
  'candidate',
  'mock_only',
  'readiness_pending',
  'readiness_blocked',
  'readiness_passed',
  'configuration_pending',
  'feature_flag_off',
  'runtime_disabled',
  'canary_ready',
  'canary_active',
  'read_only_ready',
  'read_only_active',
  'paused',
  'blocked',
  'deprecated',
  'retired'
];

const FUTURE_BLOCKED_STATES = [
  'canary_ready',
  'canary_active',
  'read_only_ready',
  'read_only_active'
];

const TRANSITION_EVENTS = [
  'register_connector',
  'nominate_candidate',
  'enable_mock_only',
  'request_readiness_review',
  'block_readiness',
  'pass_readiness',
  'request_configuration',
  'mark_feature_flag_off',
  'disable_runtime',
  'prepare_canary',
  'activate_canary',
  'mark_read_only_ready',
  'activate_read_only',
  'pause_connector',
  'block_connector',
  'resume_connector',
  'deprecate_connector',
  'retire_connector'
];

const BLOCKED_TRANSITIONS_THIS_PHASE = [
  'prepare_canary',
  'activate_canary',
  'mark_read_only_ready',
  'activate_read_only'
];

const TRANSITION_STATUSES = [
  'lifecycle_transition_applied',
  'lifecycle_transition_blocked',
  'lifecycle_transition_invalid',
  'lifecycle_version_conflict',
  'lifecycle_connector_not_found',
  'lifecycle_duplicate_connector',
  'lifecycle_contract_violation',
  'lifecycle_internal_error_safe'
];

const ERROR_CODES = [
  'INVALID_CONNECTOR_RECORD',
  'CONNECTOR_NOT_FOUND',
  'DUPLICATE_CONNECTOR',
  'INVALID_TRANSITION',
  'TRANSITION_NOT_ALLOWED_IN_THIS_PHASE',
  'VERSION_CONFLICT',
  'READINESS_EVIDENCE_REQUIRED',
  'ADAPTER_NOT_REGISTERED',
  'ADAPTER_KIND_NOT_ALLOWED',
  'FEATURE_FLAG_POLICY_INVALID',
  'KILL_SWITCH_POLICY_INVALID',
  'TENANT_STRATEGY_INVALID',
  'FORBIDDEN_FIELD_DETECTED',
  'UNSAFE_OPERATION',
  'INTERNAL_LIFECYCLE_ERROR'
];

const EXECUTION_MODES = ['disabled', 'contract_only', 'mock_only'];
const ROLLOUT_STAGES = ['none', 'contract', 'mock'];

const REQUIRED_CONNECTOR_RECORD_FIELDS = [
  'connector_id',
  'connector_type',
  'provider_id',
  'provider_type',
  'adapter_id',
  'adapter_kind',
  'readiness_candidate_id',
  'lifecycle_state',
  'lifecycle_version',
  'workspace_types',
  'tenant_strategy',
  'domains',
  'capabilities',
  'operations',
  'owner_id',
  'reviewer_ids',
  'feature_flag_key',
  'feature_flag_default',
  'kill_switch_key',
  'runtime_enabled',
  'real_provider_enabled',
  'execution_mode',
  'rollout_stage',
  'risk_level',
  'cost_risk',
  'rate_limit_risk',
  'data_classification',
  'created_at',
  'updated_at',
  'deprecated',
  'retired',
  'metadata',
  'contract_refs'
];

const REQUIRED_TRANSITION_REQUEST_FIELDS = [
  'trace_id',
  'connector_id',
  'transition_event',
  'expected_version',
  'actor_id',
  'actor_role',
  'reason',
  'requested_at',
  'evidence',
  'simulated',
  'executed',
  'real_provider_called'
];

const REQUIRED_TRANSITION_RESPONSE_FIELDS = [
  'trace_id',
  'connector_id',
  'previous_state',
  'new_state',
  'previous_version',
  'new_version',
  'transition_event',
  'status',
  'applied',
  'simulated',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution',
  'blocking_reasons',
  'warnings',
  'lifecycle_record',
  'transition_audit_event'
];

const REQUIRED_HISTORY_FIELDS = [
  'event_id',
  'trace_id',
  'connector_id',
  'previous_state',
  'new_state',
  'previous_version',
  'new_version',
  'transition_event',
  'actor_id',
  'actor_role',
  'reason_code',
  'applied',
  'status',
  'created_at',
  'simulated',
  'executed',
  'real_provider_called'
];

const FORBIDDEN_FIELDS = uniqueSorted([
  ...ADAPTER_FORBIDDEN_FIELDS,
  'input',
  'output',
  'evidence_raw',
  'rawEvidence',
  'headers',
  'cookies',
  'credentials'
]);

function findLifecycleForbiddenFields(value) {
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

function sanitizeLifecycleData(value) {
  return sanitizeAdapterData(value);
}

function validateReadOnlyOperations(operations) {
  const errors = [];
  if (!isNonEmptyStringArray(operations)) {
    errors.push('operations_must_be_non_empty_string_array');
    return errors;
  }
  for (const operation of operations) {
    if (isBlockedOperation(operation)) errors.push(`unsafe_operation::${operation}`);
  }
  return errors;
}

function validateConnectorRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['record_must_be_object'] };

  for (const field of REQUIRED_CONNECTOR_RECORD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) errors.push(`missing_${field}`);
  }

  for (const field of [
    'connector_id',
    'connector_type',
    'provider_id',
    'provider_type',
    'adapter_id',
    'adapter_kind',
    'readiness_candidate_id',
    'lifecycle_state',
    'tenant_strategy',
    'owner_id',
    'feature_flag_key',
    'kill_switch_key',
    'execution_mode',
    'rollout_stage',
    'risk_level',
    'cost_risk',
    'rate_limit_risk',
    'data_classification',
    'created_at',
    'updated_at'
  ]) {
    if (!isNonEmptyString(record[field])) errors.push(`invalid_${field}`);
  }

  for (const field of ['workspace_types', 'domains', 'capabilities', 'reviewer_ids', 'contract_refs']) {
    if (!isNonEmptyStringArray(record[field])) errors.push(`invalid_${field}`);
  }

  if (!Number.isInteger(record.lifecycle_version) || record.lifecycle_version < 1) {
    errors.push('invalid_lifecycle_version');
  }
  if (!LIFECYCLE_STATES.includes(record.lifecycle_state)) errors.push('lifecycle_state_not_allowed');
  if (FUTURE_BLOCKED_STATES.includes(record.lifecycle_state)) errors.push('future_lifecycle_state_blocked_this_phase');
  if (!TENANT_STRATEGIES.includes(record.tenant_strategy)) errors.push('tenant_strategy_not_allowed');
  if (!EXECUTION_MODES.includes(record.execution_mode)) errors.push('execution_mode_not_allowed');
  if (!ROLLOUT_STAGES.includes(record.rollout_stage)) errors.push('rollout_stage_not_allowed');
  if (record.adapter_kind === 'real_read_only') errors.push('real_read_only_adapter_kind_blocked');
  if (record.feature_flag_default !== false) errors.push('feature_flag_default_must_be_false');
  if (record.real_provider_enabled !== false) errors.push('real_provider_enabled_must_be_false');
  if (typeof record.runtime_enabled !== 'boolean') errors.push('invalid_runtime_enabled');
  if (typeof record.deprecated !== 'boolean') errors.push('invalid_deprecated');
  if (typeof record.retired !== 'boolean') errors.push('invalid_retired');
  if (!isPlainObject(record.metadata)) errors.push('metadata_must_be_object');
  errors.push(...validateReadOnlyOperations(record.operations));
  errors.push(...findLifecycleForbiddenFields(record));

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTransitionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['transition_request_must_be_object'] };

  for (const field of REQUIRED_TRANSITION_REQUEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }

  for (const field of ['trace_id', 'connector_id', 'transition_event', 'actor_id', 'actor_role', 'reason', 'requested_at']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (!TRANSITION_EVENTS.includes(request.transition_event)) errors.push('transition_event_not_allowed');
  if (!Number.isInteger(request.expected_version) || request.expected_version < 1) errors.push('invalid_expected_version');
  if (!isPlainObject(request.evidence)) errors.push('evidence_must_be_object');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  if (request.executed !== false) errors.push('executed_must_be_false');
  if (request.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  errors.push(...findLifecycleForbiddenFields(request));

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateLifecycleHistoryEvent(event) {
  const errors = [];
  if (!isPlainObject(event)) return { valid: false, errors: ['history_event_must_be_object'] };
  for (const field of REQUIRED_HISTORY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(event, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['event_id', 'trace_id', 'connector_id', 'previous_state', 'new_state', 'transition_event', 'actor_id', 'actor_role', 'reason_code', 'status', 'created_at']) {
    if (!isNonEmptyString(event[field])) errors.push(`invalid_${field}`);
  }
  if (event.executed !== false) errors.push('executed_must_be_false');
  if (event.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  errors.push(...findLifecycleForbiddenFields(event));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateReadinessBinding(readiness, record) {
  const errors = [];
  if (!isPlainObject(readiness)) return ['readiness_missing'];
  if (!isPlainObject(record)) return ['record_missing'];
  if (readiness.candidate_id !== record.readiness_candidate_id) errors.push('readiness_candidate_id_mismatch');
  if (readiness.provider_id !== record.provider_id) errors.push('readiness_provider_id_mismatch');
  if (readiness.adapter_id !== record.adapter_id) errors.push('readiness_adapter_id_mismatch');
  if (readiness.status !== 'ready_for_real_read_only_pr') errors.push('readiness_status_not_ready');
  if (readiness.verdict !== 'allow_future_read_only_pr') errors.push('readiness_verdict_not_allow');
  if (readiness.ready !== true) errors.push('readiness_ready_not_true');
  if (readiness.simulated !== true) errors.push('readiness_simulated_not_true');
  if (readiness.executed !== false) errors.push('readiness_executed_not_false');
  if (readiness.real_provider_called !== false) errors.push('readiness_real_provider_called_not_false');
  if (readiness.can_trigger_real_execution !== false) errors.push('readiness_can_trigger_real_execution_not_false');
  if (!Array.isArray(readiness.blocking_requirements) || readiness.blocking_requirements.length !== 0) {
    errors.push('readiness_blocking_requirements_present');
  }
  if (!Array.isArray(readiness.blocking_reasons) || readiness.blocking_reasons.length !== 0) {
    errors.push('readiness_blocking_reasons_present');
  }
  return uniqueSorted(errors);
}

function isTransitionBlockedInCurrentPhase(eventOrState) {
  return BLOCKED_TRANSITIONS_THIS_PHASE.includes(eventOrState) || FUTURE_BLOCKED_STATES.includes(eventOrState);
}

function buildSafeLifecycleError(code, message, context = {}) {
  const safeCode = ERROR_CODES.includes(code) ? code : 'INTERNAL_LIFECYCLE_ERROR';
  return {
    error_code: safeCode,
    message: isNonEmptyString(message) ? message : 'Connector lifecycle operation blocked safely.',
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : safeCode
  };
}

function buildTransitionAuditEvent(context = {}) {
  return {
    event_name: 'connector_lifecycle_transition_evaluated',
    trace_id: isNonEmptyString(context.trace_id) ? context.trace_id : 'trace_not_available',
    connector_id: isNonEmptyString(context.connector_id) ? context.connector_id : 'connector_not_available',
    previous_state: isNonEmptyString(context.previous_state) ? context.previous_state : 'unknown',
    new_state: isNonEmptyString(context.new_state) ? context.new_state : 'unknown',
    previous_version: Number.isInteger(context.previous_version) ? context.previous_version : 0,
    new_version: Number.isInteger(context.new_version) ? context.new_version : 0,
    transition_event: isNonEmptyString(context.transition_event) ? context.transition_event : 'unknown',
    status: isNonEmptyString(context.status) ? context.status : 'lifecycle_internal_error_safe',
    applied: context.applied === true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : null
  };
}

module.exports = {
  LIFECYCLE_STATES,
  FUTURE_BLOCKED_STATES,
  TRANSITION_EVENTS,
  BLOCKED_TRANSITIONS_THIS_PHASE,
  TRANSITION_STATUSES,
  ERROR_CODES,
  EXECUTION_MODES,
  ROLLOUT_STAGES,
  REQUIRED_CONNECTOR_RECORD_FIELDS,
  REQUIRED_TRANSITION_REQUEST_FIELDS,
  REQUIRED_TRANSITION_RESPONSE_FIELDS,
  REQUIRED_HISTORY_FIELDS,
  FORBIDDEN_FIELDS,
  validateConnectorRecord,
  validateTransitionRequest,
  validateLifecycleHistoryEvent,
  findLifecycleForbiddenFields,
  validateReadinessBinding,
  buildSafeLifecycleError,
  sanitizeLifecycleData,
  buildTransitionAuditEvent,
  isTransitionBlockedInCurrentPhase,
  deepClone,
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
};
