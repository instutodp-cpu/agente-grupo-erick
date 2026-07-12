'use strict';

const {
  ADAPTER_LIFECYCLE_STATUSES,
  EXECUTION_STATUSES,
  FORBIDDEN_FIELDS,
  REQUIRED_ADAPTER_METADATA_FIELDS,
  validateAdapterMetadata,
  validateAdapterRequest,
  findForbiddenFields,
  sanitizeAdapterData,
  uniqueSorted
} = require('./read-only-adapter-contract');

const ADAPTER_INTERFACE_STATUSES = [
  'interface_not_evaluated',
  'interface_valid',
  'interface_invalid',
  'runtime_plan_created',
  'runtime_blocked',
  'runtime_error_safe'
];

const RUNTIME_MODES = [
  'disabled',
  'contract_only',
  'mock_only',
  'read_only_candidate',
  'readiness_required',
  'blocked_by_readiness',
  'blocked_by_runtime_policy',
  'blocked_by_input_contract',
  'safe_runtime_plan'
];

const PROVIDER_CLASSES = [
  'public_web',
  'transcription',
  'internal_business_api',
  'personal_connector',
  'corporate_connector',
  'external_client_connector',
  'development_connector',
  'other_read_only'
];

const REQUIRED_ADAPTER_FIELDS = [
  'adapter_id',
  'provider_id',
  'provider_type',
  'provider_class',
  'runtime_mode',
  'workspace_types',
  'tenant_strategy',
  'domains',
  'capabilities',
  'operations',
  'output_contract',
  'error_contract'
];

const REQUIRED_REQUEST_FIELDS = [
  'trace_id',
  'workspace_type',
  'tenant_id',
  'user_id',
  'adapter_id',
  'provider_id',
  'provider_class',
  'domain',
  'capability',
  'operation',
  'sanitized_input',
  'simulated',
  'executed',
  'real_provider_called'
];

const REQUIRED_RESPONSE_FIELDS = [
  'trace_id',
  'workspace_type',
  'tenant_id',
  'user_id',
  'adapter_id',
  'provider_id',
  'provider_class',
  'domain',
  'capability',
  'operation',
  'status',
  'safe_summary',
  'sanitized_output',
  'simulated',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution'
];

const DEFAULT_RULES = Object.freeze({
  contract_only: true,
  read_only_only: true,
  runtime_registration_allowed: false,
  adapter_invocation_allowed: false,
  real_provider_calls_allowed: false,
  write_allowed: false,
  action_allowed: false,
  send_allowed: false,
  publish_allowed: false,
  delete_allowed: false,
  simulated: true,
  executed: false,
  real_provider_called: false,
  can_trigger_real_execution: false
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function collectForbiddenFields(value) {
  return findForbiddenFields(value);
}

function hasWriteLikeOperation(operation) {
  return require('./read-only-adapter-contract').isBlockedOperation(operation);
}

function validateReadOnlyAdapterDescriptor(adapter) {
  const errors = [];

  if (!isPlainObject(adapter)) {
    return {
      valid: false,
      status: 'interface_invalid',
      errors: ['adapter_descriptor_must_be_object']
    };
  }

  for (const field of REQUIRED_ADAPTER_FIELDS) {
    const value = adapter[field];
    if (Array.isArray(value) ? !isNonEmptyStringArray(value) : !isNonEmptyString(value)) {
      errors.push(`missing_${field}`);
    }
  }

  if (isNonEmptyString(adapter.provider_class) && !PROVIDER_CLASSES.includes(adapter.provider_class)) {
    errors.push('provider_class_not_allowed');
  }

  if (isNonEmptyString(adapter.runtime_mode) && !RUNTIME_MODES.includes(adapter.runtime_mode)) {
    errors.push('runtime_mode_not_allowed');
  }

  if (Array.isArray(adapter.operations)) {
    for (const operation of adapter.operations) {
      if (hasWriteLikeOperation(operation)) errors.push(`write_like_operation::${operation}`);
    }
  }

  for (const flag of ['write_allowed', 'action_allowed', 'send_allowed', 'publish_allowed', 'delete_allowed']) {
    if (adapter[flag] === true) errors.push(`${flag}_true`);
  }
  if (adapter.executed === true) errors.push('executed_true');
  if (adapter.real_provider_called === true) errors.push('real_provider_called_true');
  if (adapter.can_trigger_real_execution === true) errors.push('can_trigger_real_execution_true');

  errors.push(...collectForbiddenFields(adapter));
  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? 'interface_valid' : 'interface_invalid',
    errors: uniqueSorted(errors)
  };
}

function validateReadOnlyAdapterRequest(request) {
  const errors = [];

  if (!isPlainObject(request)) {
    return {
      valid: false,
      status: 'interface_invalid',
      errors: ['adapter_request_must_be_object']
    };
  }

  for (const field of [
    'trace_id',
    'workspace_type',
    'tenant_id',
    'user_id',
    'adapter_id',
    'provider_id',
    'provider_class',
    'domain',
    'capability',
    'operation'
  ]) {
    if (!isNonEmptyString(request[field])) errors.push(`missing_${field}`);
  }

  if (!isPlainObject(request.sanitized_input)) errors.push('missing_sanitized_input');
  if (hasWriteLikeOperation(request.operation)) errors.push(`write_like_operation::${request.operation}`);
  if (request.simulated !== true) errors.push('simulated_not_true');
  if (request.executed !== false) errors.push('executed_not_false');
  if (request.real_provider_called !== false) errors.push('real_provider_called_not_false');

  errors.push(...collectForbiddenFields(request));
  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? 'interface_valid' : 'interface_invalid',
    errors: uniqueSorted(errors)
  };
}

function buildReadOnlyAdapterResponse(input = {}) {
  const response = {
    trace_id: isNonEmptyString(input.trace_id) ? input.trace_id : 'trace_not_available',
    workspace_type: isNonEmptyString(input.workspace_type) ? input.workspace_type : 'unknown',
    tenant_id: isNonEmptyString(input.tenant_id) ? input.tenant_id : 'unknown',
    user_id: isNonEmptyString(input.user_id) ? input.user_id : 'unknown',
    adapter_id: isNonEmptyString(input.adapter_id) ? input.adapter_id : 'adapter_not_available',
    provider_id: isNonEmptyString(input.provider_id) ? input.provider_id : 'provider_not_available',
    provider_class: isNonEmptyString(input.provider_class) ? input.provider_class : 'other_read_only',
    domain: isNonEmptyString(input.domain) ? input.domain : 'unknown',
    capability: isNonEmptyString(input.capability) ? input.capability : 'unknown',
    operation: isNonEmptyString(input.operation) ? input.operation : 'unknown',
    status: isNonEmptyString(input.status) ? input.status : 'runtime_blocked',
    safe_summary: isNonEmptyString(input.safe_summary)
      ? input.safe_summary
      : 'Read-only adapter runtime returned a safe envelope.',
    sanitized_output: sanitizeAdapterData(isPlainObject(input.sanitized_output) ? input.sanitized_output : {}),
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };

  if (collectForbiddenFields(response).length > 0) {
    return {
      ...response,
      status: 'runtime_error_safe',
      sanitized_output: {},
      safe_summary: 'Read-only adapter response contained forbidden fields and was blocked.'
    };
  }

  return response;
}

function planReadOnlyAdapterRuntime({ adapter, request, readiness } = {}) {
  const adapterValidation = validateReadOnlyAdapterDescriptor(adapter);
  const requestValidation = validateReadOnlyAdapterRequest(request);
  const blockingReasons = [
    ...adapterValidation.errors.map((error) => `adapter::${error}`),
    ...requestValidation.errors.map((error) => `request::${error}`)
  ];

  const readinessReady = readiness &&
    readiness.status === 'ready_for_real_read_only_pr' &&
    readiness.verdict === 'allow_future_read_only_pr' &&
    readiness.ready === true &&
    readiness.simulated === true &&
    readiness.executed === false &&
    readiness.real_provider_called === false &&
    readiness.can_trigger_real_execution === false &&
    Array.isArray(readiness.blocking_requirements) &&
    readiness.blocking_requirements.length === 0 &&
    Array.isArray(readiness.blocking_reasons) &&
    readiness.blocking_reasons.length === 0;

  if (!readinessReady) blockingReasons.push('readiness_not_ready_for_future_pr');

  const readyForInterface = adapterValidation.valid && requestValidation.valid && readinessReady;
  return {
    status: readyForInterface ? 'safe_runtime_plan' : 'runtime_blocked',
    interface_ready: readyForInterface,
    execution_allowed: false,
    adapter_invocation_allowed: false,
    real_provider_calls_allowed: false,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    adapter_id: isPlainObject(adapter) && isNonEmptyString(adapter.adapter_id) ? adapter.adapter_id : null,
    provider_id: isPlainObject(adapter) && isNonEmptyString(adapter.provider_id) ? adapter.provider_id : null,
    blocking_reasons: uniqueSorted(blockingReasons),
    response_contract: buildReadOnlyAdapterResponse({
      ...(isPlainObject(request) ? request : {}),
      adapter_id: isPlainObject(adapter) && isNonEmptyString(adapter.adapter_id) ? adapter.adapter_id : undefined,
      provider_id: isPlainObject(adapter) && isNonEmptyString(adapter.provider_id) ? adapter.provider_id : undefined,
      provider_class: isPlainObject(adapter) && isNonEmptyString(adapter.provider_class) ? adapter.provider_class : undefined,
      status: readyForInterface ? 'runtime_plan_created' : 'runtime_blocked'
    })
  };
}

module.exports = {
  ADAPTER_INTERFACE_STATUSES,
  ADAPTER_LIFECYCLE_STATUSES,
  RUNTIME_MODES,
  EXECUTION_STATUSES,
  PROVIDER_CLASSES,
  REQUIRED_ADAPTER_FIELDS,
  REQUIRED_ADAPTER_METADATA_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_RESPONSE_FIELDS,
  FORBIDDEN_FIELDS,
  DEFAULT_RULES,
  validateReadOnlyAdapterDescriptor,
  validateReadOnlyAdapterRequest,
  validateAdapterMetadata,
  validateAdapterRequest,
  buildReadOnlyAdapterResponse,
  planReadOnlyAdapterRuntime,
  collectForbiddenFields
};
