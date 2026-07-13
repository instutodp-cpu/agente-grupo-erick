'use strict';

const {
  FORBIDDEN_FIELDS: ADAPTER_FORBIDDEN_FIELDS,
  TENANT_STRATEGIES,
  deepClone,
  isBlockedOperation,
  isNonEmptyString,
  isNonEmptyStringArray,
  isPlainObject,
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
  'REPLAYED_TRANSITION',
  'INITIAL_STATE_NOT_ALLOWED',
  'INVALID_INITIAL_CONNECTOR_STATE',
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
  'transition_id',
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
  'transition_id',
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
  'error',
  'lifecycle_record',
  'transition_audit_event'
];

const REQUIRED_HISTORY_FIELDS = [
  'event_id',
  'trace_id',
  'transition_id',
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
  const forbidden = new Set(FORBIDDEN_FIELDS);
  const seen = new WeakSet();

  function sanitize(entry) {
    if (entry === null || entry === undefined) return entry;
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') return entry;
    if (Array.isArray(entry)) return entry.map(sanitize);
    if (!isPlainObject(entry)) return undefined;
    if (seen.has(entry)) {
      return {
        blocked_reason: 'cycle_removed'
      };
    }
    seen.add(entry);

    const output = {};
    for (const [key, nested] of Object.entries(entry)) {
      if (forbidden.has(key)) continue;
      const sanitized = sanitize(nested);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    seen.delete(entry);
    return output;
  }

  return sanitize(value);
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
  errors.push(...validateStateConsistency(record));
  errors.push(...findLifecycleForbiddenFields(record));

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateStateConsistency(record) {
  const errors = [];
  if (!isPlainObject(record)) return errors;
  const state = record.lifecycle_state;

  if (record.real_provider_enabled !== false) errors.push('real_provider_enabled_must_be_false');
  if (record.runtime_enabled === true && state !== 'mock_only') errors.push('runtime_enabled_only_allowed_for_mock_only');
  if (record.execution_mode === 'mock_only' && state !== 'mock_only') errors.push('mock_only_execution_mode_requires_mock_only_state');
  if (record.rollout_stage === 'mock' && state !== 'mock_only') errors.push('mock_rollout_stage_requires_mock_only_state');
  if (record.retired === true && state !== 'retired') errors.push('retired_true_only_allowed_for_retired_state');
  if (record.deprecated === true && !['deprecated', 'retired'].includes(state)) {
    errors.push('deprecated_true_only_allowed_for_deprecated_or_retired_state');
  }

  if (state === 'registered') {
    if (record.runtime_enabled !== false) errors.push('registered_runtime_enabled_must_be_false');
    if (!['disabled', 'contract_only'].includes(record.execution_mode)) errors.push('registered_execution_mode_must_be_disabled_or_contract_only');
    if (!['none', 'contract'].includes(record.rollout_stage)) errors.push('registered_rollout_stage_must_be_none_or_contract');
    if (record.deprecated !== false) errors.push('registered_deprecated_must_be_false');
    if (record.retired !== false) errors.push('registered_retired_must_be_false');
  }

  if (state === 'candidate') {
    if (record.runtime_enabled !== false) errors.push('candidate_runtime_enabled_must_be_false');
    if (record.execution_mode !== 'contract_only') errors.push('candidate_execution_mode_must_be_contract_only');
    if (record.rollout_stage !== 'contract') errors.push('candidate_rollout_stage_must_be_contract');
    if (record.deprecated !== false) errors.push('candidate_deprecated_must_be_false');
    if (record.retired !== false) errors.push('candidate_retired_must_be_false');
  }

  if (state === 'mock_only') {
    if (record.adapter_kind !== 'mock') errors.push('mock_only_adapter_kind_must_be_mock');
    if (record.runtime_enabled !== true) errors.push('mock_only_runtime_enabled_must_be_true');
    if (record.execution_mode !== 'mock_only') errors.push('mock_only_execution_mode_required');
    if (record.rollout_stage !== 'mock') errors.push('mock_only_rollout_stage_required');
    if (record.deprecated !== false) errors.push('mock_only_deprecated_must_be_false');
    if (record.retired !== false) errors.push('mock_only_retired_must_be_false');
  }

  if (['readiness_pending', 'readiness_blocked', 'readiness_passed', 'configuration_pending', 'feature_flag_off'].includes(state)) {
    if (record.runtime_enabled !== false) errors.push(`${state}_runtime_enabled_must_be_false`);
    if (record.execution_mode === 'mock_only') errors.push(`${state}_execution_mode_must_not_be_mock_only`);
    if (record.rollout_stage === 'mock') errors.push(`${state}_rollout_stage_must_not_be_mock`);
    if (record.deprecated !== false) errors.push(`${state}_deprecated_must_be_false`);
    if (record.retired !== false) errors.push(`${state}_retired_must_be_false`);
  }

  if (state === 'paused' && record.runtime_enabled !== false) errors.push('paused_runtime_enabled_must_be_false');
  if (state === 'blocked') {
    if (record.runtime_enabled !== false) errors.push('blocked_runtime_enabled_must_be_false');
    if (record.real_provider_enabled !== false) errors.push('blocked_real_provider_enabled_must_be_false');
  }
  if (state === 'deprecated') {
    if (record.deprecated !== true) errors.push('deprecated_state_requires_deprecated_true');
    if (record.retired !== false) errors.push('deprecated_state_retired_must_be_false');
    if (record.runtime_enabled !== false) errors.push('deprecated_runtime_enabled_must_be_false');
  }
  if (state === 'retired') {
    if (record.deprecated !== true) errors.push('retired_state_requires_deprecated_true');
    if (record.retired !== true) errors.push('retired_state_requires_retired_true');
    if (record.runtime_enabled !== false) errors.push('retired_runtime_enabled_must_be_false');
    if (record.real_provider_enabled !== false) errors.push('retired_real_provider_enabled_must_be_false');
  }

  return errors;
}

function validateInitialConnectorState(record) {
  const errors = [];
  if (!isPlainObject(record)) return ['record_must_be_object'];
  if (record.lifecycle_state !== 'registered') errors.push('initial_lifecycle_state_must_be_registered');
  if (record.lifecycle_version !== 1) errors.push('initial_lifecycle_version_must_be_1');
  if (record.runtime_enabled !== false) errors.push('initial_runtime_enabled_must_be_false');
  if (record.real_provider_enabled !== false) errors.push('initial_real_provider_enabled_must_be_false');
  if (!['disabled', 'contract_only'].includes(record.execution_mode)) errors.push('initial_execution_mode_must_be_disabled_or_contract_only');
  if (!['none', 'contract'].includes(record.rollout_stage)) errors.push('initial_rollout_stage_must_be_none_or_contract');
  if (record.deprecated !== false) errors.push('initial_deprecated_must_be_false');
  if (record.retired !== false) errors.push('initial_retired_must_be_false');
  if (record.feature_flag_default !== false) errors.push('initial_feature_flag_default_must_be_false');
  return uniqueSorted(errors);
}

function validateTransitionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['transition_request_must_be_object'] };

  for (const field of REQUIRED_TRANSITION_REQUEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }

  for (const field of ['trace_id', 'transition_id', 'connector_id', 'transition_event', 'actor_id', 'actor_role', 'reason', 'requested_at']) {
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
  for (const field of ['event_id', 'trace_id', 'transition_id', 'connector_id', 'previous_state', 'new_state', 'transition_event', 'actor_id', 'actor_role', 'reason_code', 'status', 'created_at']) {
    if (!isNonEmptyString(event[field])) errors.push(`invalid_${field}`);
  }
  if (!LIFECYCLE_STATES.includes(event.previous_state)) errors.push('history_previous_state_not_allowed');
  if (!LIFECYCLE_STATES.includes(event.new_state)) errors.push('history_new_state_not_allowed');
  if (!TRANSITION_EVENTS.includes(event.transition_event)) errors.push('history_transition_event_not_allowed');
  if (!TRANSITION_STATUSES.includes(event.status)) errors.push('history_status_not_allowed');
  if (typeof event.applied !== 'boolean') errors.push('history_applied_must_be_boolean');
  if (!Number.isInteger(event.previous_version)) errors.push('history_previous_version_must_be_integer');
  if (!Number.isInteger(event.new_version)) errors.push('history_new_version_must_be_integer');
  if (event.simulated !== true) errors.push('simulated_must_be_true');
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
    transition_id: isNonEmptyString(context.transition_id) ? context.transition_id : 'transition_not_available',
    connector_id: isNonEmptyString(context.connector_id) ? context.connector_id : 'connector_not_available',
    provider_id: isNonEmptyString(context.provider_id) ? context.provider_id : 'provider_not_available',
    adapter_id: isNonEmptyString(context.adapter_id) ? context.adapter_id : 'adapter_not_available',
    previous_state: isNonEmptyString(context.previous_state) ? context.previous_state : 'unknown',
    new_state: isNonEmptyString(context.new_state) ? context.new_state : 'unknown',
    previous_version: Number.isInteger(context.previous_version) ? context.previous_version : 0,
    new_version: Number.isInteger(context.new_version) ? context.new_version : 0,
    transition_event: isNonEmptyString(context.transition_event) ? context.transition_event : 'unknown',
    actor_id: isNonEmptyString(context.actor_id) ? context.actor_id : 'actor_not_available',
    actor_role: isNonEmptyString(context.actor_role) ? context.actor_role : 'actor_role_not_available',
    status: isNonEmptyString(context.status) ? context.status : 'lifecycle_internal_error_safe',
    applied: context.applied === true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    error_code: isNonEmptyString(context.error_code) ? context.error_code : null,
    occurred_at: isNonEmptyString(context.occurred_at) ? context.occurred_at : new Date(0).toISOString(),
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
  validateInitialConnectorState,
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
