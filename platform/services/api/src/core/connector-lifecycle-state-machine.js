'use strict';

const {
  BLOCKED_TRANSITIONS_THIS_PHASE,
  FUTURE_BLOCKED_STATES,
  buildTransitionAuditEvent,
  deepClone,
  isNonEmptyString,
  isPlainObject,
  isTransitionBlockedInCurrentPhase,
  sanitizeLifecycleData,
  uniqueSorted,
  validateConnectorRecord,
  validateReadinessBinding,
  validateTransitionRequest
} = require('./connector-lifecycle-contract');
const {
  validateAdapterMetadata
} = require('./read-only-adapter-contract');

const TRANSITION_TARGETS = Object.freeze({
  unregistered: Object.freeze({
    register_connector: 'registered'
  }),
  registered: Object.freeze({
    nominate_candidate: 'candidate',
    block_connector: 'blocked'
  }),
  candidate: Object.freeze({
    enable_mock_only: 'mock_only',
    request_readiness_review: 'readiness_pending',
    block_connector: 'blocked'
  }),
  readiness_pending: Object.freeze({
    block_readiness: 'readiness_blocked',
    pass_readiness: 'readiness_passed',
    block_connector: 'blocked',
    pause_connector: 'paused'
  }),
  readiness_blocked: Object.freeze({
    request_readiness_review: 'readiness_pending',
    block_connector: 'blocked',
    pause_connector: 'paused'
  }),
  readiness_passed: Object.freeze({
    request_configuration: 'configuration_pending',
    block_connector: 'blocked',
    pause_connector: 'paused'
  }),
  configuration_pending: Object.freeze({
    mark_feature_flag_off: 'feature_flag_off',
    block_connector: 'blocked',
    pause_connector: 'paused'
  }),
  feature_flag_off: Object.freeze({
    block_connector: 'blocked',
    pause_connector: 'paused'
  }),
  mock_only: Object.freeze({
    pause_connector: 'paused',
    block_connector: 'blocked',
    deprecate_connector: 'deprecated'
  }),
  runtime_disabled: Object.freeze({
    pause_connector: 'paused',
    block_connector: 'blocked'
  }),
  paused: Object.freeze({
    deprecate_connector: 'deprecated',
    block_connector: 'blocked'
  }),
  blocked: Object.freeze({
    deprecate_connector: 'deprecated'
  }),
  deprecated: Object.freeze({
    retire_connector: 'retired'
  }),
  retired: Object.freeze({})
});

function getAllowedTransitions(state) {
  return Object.keys(TRANSITION_TARGETS[state] || {}).sort();
}

function resolveTargetState(fromState, event) {
  const target = TRANSITION_TARGETS[fromState] && TRANSITION_TARGETS[fromState][event];
  return target || null;
}

function hasAdapter(adapterRegistry, adapterId) {
  return Boolean(adapterRegistry && typeof adapterRegistry.hasAdapter === 'function' && adapterRegistry.hasAdapter(adapterId));
}

function getAdapter(adapterRegistry, adapterId) {
  return adapterRegistry && typeof adapterRegistry.getAdapter === 'function'
    ? adapterRegistry.getAdapter(adapterId)
    : null;
}

function validateMockAdapterBinding(record, context = {}) {
  const errors = [];
  if (!hasAdapter(context.adapterRegistry, record.adapter_id)) {
    errors.push('adapter_not_registered');
    return errors;
  }
  const adapter = getAdapter(context.adapterRegistry, record.adapter_id);
  const metadataValidation = validateAdapterMetadata(adapter && adapter.metadata);
  if (!metadataValidation.valid) {
    errors.push('adapter_metadata_invalid');
    return errors;
  }
  if (adapter.metadata.adapter_kind !== 'mock') errors.push('adapter_kind_not_mock');
  if (record.adapter_kind !== 'mock') errors.push('record_adapter_kind_not_mock');
  if (adapter.metadata.provider_id !== record.provider_id) errors.push('adapter_provider_id_mismatch');
  if (adapter.metadata.adapter_id !== record.adapter_id) errors.push('adapter_id_mismatch');
  if (!isNonEmptyString(record.feature_flag_key)) errors.push('feature_flag_key_missing');
  if (!isNonEmptyString(record.kill_switch_key)) errors.push('kill_switch_key_missing');
  return uniqueSorted(errors);
}

function validateReadinessPending(record) {
  const errors = [];
  if (!isNonEmptyString(record.readiness_candidate_id)) errors.push('readiness_candidate_id_missing');
  if (!Array.isArray(record.contract_refs) || record.contract_refs.length === 0) errors.push('contract_refs_missing');
  if (record.metadata && record.metadata.mock_parity_declared !== true) errors.push('mock_parity_not_declared');
  if (!isNonEmptyString(record.owner_id)) errors.push('owner_id_missing');
  if (!Array.isArray(record.reviewer_ids) || record.reviewer_ids.length === 0) errors.push('reviewer_ids_missing');
  return errors;
}

function validateReadinessPassed(record, request) {
  const readiness = request && request.evidence && request.evidence.readiness_result;
  return validateReadinessBinding(readiness, record);
}

function validateConfigurationPending(record) {
  const errors = [];
  if (!isNonEmptyString(record.feature_flag_key)) errors.push('feature_flag_key_missing');
  if (!isNonEmptyString(record.kill_switch_key)) errors.push('kill_switch_key_missing');
  if (record.feature_flag_default !== false) errors.push('feature_flag_default_must_be_false');
  return errors;
}

function validateTransitionGuards(record, request, context = {}) {
  const errors = [];
  const recordValidation = validateConnectorRecord(record);
  const requestValidation = validateTransitionRequest(request);
  if (!recordValidation.valid) errors.push(...recordValidation.errors);
  if (!requestValidation.valid) errors.push(...requestValidation.errors);
  if (errors.length > 0) return uniqueSorted(errors);

  if (request.expected_version !== record.lifecycle_version) {
    errors.push('version_conflict');
  }
  if (BLOCKED_TRANSITIONS_THIS_PHASE.includes(request.transition_event)) {
    errors.push('transition_blocked_this_phase');
  }

  const targetState = resolveTargetState(record.lifecycle_state, request.transition_event);
  if (!targetState) errors.push('transition_not_allowed_from_state');
  if (targetState && (FUTURE_BLOCKED_STATES.includes(targetState) || isTransitionBlockedInCurrentPhase(targetState))) {
    errors.push('target_state_blocked_this_phase');
  }

  if (targetState === 'mock_only') errors.push(...validateMockAdapterBinding(record, context));
  if (targetState === 'readiness_pending') errors.push(...validateReadinessPending(record));
  if (targetState === 'readiness_passed') errors.push(...validateReadinessPassed(record, request));
  if (targetState === 'feature_flag_off') errors.push(...validateConfigurationPending(record));
  if (record.real_provider_enabled !== false) errors.push('real_provider_enabled_must_be_false');
  if (record.feature_flag_default !== false) errors.push('feature_flag_default_must_be_false');
  if (!isNonEmptyString(record.kill_switch_key)) errors.push('kill_switch_key_missing');

  return uniqueSorted(errors);
}

function canTransition(fromState, event, context = {}) {
  const targetState = resolveTargetState(fromState, event);
  if (!targetState) return false;
  if (BLOCKED_TRANSITIONS_THIS_PHASE.includes(event)) return false;
  if (FUTURE_BLOCKED_STATES.includes(targetState)) return false;
  if (context && context.blocked === true) return false;
  return true;
}

function now(context) {
  if (context && typeof context.clock === 'function') return context.clock();
  return new Date().toISOString();
}

function nextEventId(context, connectorId, nextVersion) {
  if (context && typeof context.idGenerator === 'function') return context.idGenerator();
  return `lifecycle_event_${connectorId}_${nextVersion}`;
}

function buildHistoryEvent(record, request, status, applied, targetState, timestamp, eventId, reason) {
  const previousVersion = Number.isInteger(record && record.lifecycle_version) ? record.lifecycle_version : 0;
  const newVersion = applied ? previousVersion + 1 : previousVersion;
  return {
    event_id: eventId,
    trace_id: request && request.trace_id,
    connector_id: request && request.connector_id,
    previous_state: record && record.lifecycle_state ? record.lifecycle_state : 'unknown',
    new_state: targetState || (record && record.lifecycle_state) || 'unknown',
    previous_version: previousVersion,
    new_version: newVersion,
    transition_event: request && request.transition_event,
    actor_id: request && request.actor_id,
    actor_role: request && request.actor_role,
    reason_code: isNonEmptyString(reason) ? reason : 'not_applicable',
    applied: applied === true,
    status,
    created_at: timestamp,
    simulated: true,
    executed: false,
    real_provider_called: false
  };
}

function buildTransitionResponse(record, request, fields) {
  const applied = fields.applied === true;
  const previousVersion = Number.isInteger(record && record.lifecycle_version) ? record.lifecycle_version : 0;
  const newVersion = applied ? previousVersion + 1 : previousVersion;
  const previousState = record && record.lifecycle_state ? record.lifecycle_state : 'unknown';
  const newState = fields.targetState || previousState;
  return {
    trace_id: request && request.trace_id ? request.trace_id : 'trace_not_available',
    connector_id: request && request.connector_id ? request.connector_id : 'connector_not_available',
    previous_state: previousState,
    new_state: newState,
    previous_version: previousVersion,
    new_version: newVersion,
    transition_event: request && request.transition_event ? request.transition_event : 'unknown',
    status: fields.status,
    applied,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_reasons: uniqueSorted(fields.blockingReasons || []),
    warnings: [],
    lifecycle_record: fields.lifecycleRecord ? sanitizeLifecycleData(fields.lifecycleRecord) : null,
    transition_audit_event: buildTransitionAuditEvent({
      trace_id: request && request.trace_id,
      connector_id: request && request.connector_id,
      previous_state: previousState,
      new_state: newState,
      previous_version: previousVersion,
      new_version: newVersion,
      transition_event: request && request.transition_event,
      status: fields.status,
      applied,
      blocked_reason: fields.blockingReasons && fields.blockingReasons[0]
    }),
    history_event: fields.historyEvent ? sanitizeLifecycleData(fields.historyEvent) : null
  };
}

function applyLifecycleTransition(record, request, context = {}) {
  try {
    const targetState = isPlainObject(record) && isPlainObject(request)
      ? resolveTargetState(record.lifecycle_state, request.transition_event)
      : null;
    const guardErrors = validateTransitionGuards(record, request, context);
    const status = guardErrors.includes('version_conflict')
      ? 'lifecycle_version_conflict'
      : guardErrors.length > 0
        ? 'lifecycle_transition_blocked'
        : 'lifecycle_transition_applied';
    const applied = guardErrors.length === 0;
    const timestamp = now(context);
    const eventId = nextEventId(context, request && request.connector_id, applied ? record.lifecycle_version + 1 : record && record.lifecycle_version);
    const nextRecord = applied
      ? {
        ...deepClone(record),
        lifecycle_state: targetState,
        lifecycle_version: record.lifecycle_version + 1,
        updated_at: timestamp,
        runtime_enabled: targetState === 'mock_only',
        execution_mode: targetState === 'mock_only' ? 'mock_only' : record.execution_mode,
        rollout_stage: targetState === 'mock_only' ? 'mock' : record.rollout_stage,
        deprecated: targetState === 'deprecated' ? true : record.deprecated,
        retired: targetState === 'retired' ? true : record.retired
      }
      : deepClone(record);
    const historyEvent = buildHistoryEvent(record || {}, request || {}, status, applied, targetState, timestamp, eventId, guardErrors[0] || request && request.reason);

    return buildTransitionResponse(record || {}, request || {}, {
      status,
      applied,
      targetState,
      blockingReasons: guardErrors,
      lifecycleRecord: nextRecord,
      historyEvent
    });
  } catch (_err) {
    return buildTransitionResponse(record || {}, request || {}, {
      status: 'lifecycle_internal_error_safe',
      applied: false,
      targetState: record && record.lifecycle_state,
      blockingReasons: ['internal_lifecycle_error']
    });
  }
}

module.exports = {
  getAllowedTransitions,
  canTransition,
  resolveTargetState,
  applyLifecycleTransition,
  validateTransitionGuards
};
