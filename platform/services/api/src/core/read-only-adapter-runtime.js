'use strict';

const {
  buildAdapterAuditEventCandidate,
  buildSafeAdapterError,
  deepClone,
  findForbiddenFields,
  isNonEmptyString,
  isPlainObject,
  sanitizeAdapterData,
  uniqueSorted,
  validateAdapterMetadata,
  validateAdapterRequest,
  validateAdapterResponse
} = require('./read-only-adapter-contract');

function defaultClock() {
  return Date.now();
}

function defaultFeatureFlagResolver() {
  return false;
}

function defaultKillSwitchResolver() {
  return true;
}

function defaultTimeoutRunner(operation, timeoutMs) {
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((resolve) => {
      setTimeout(() => resolve({ __adapter_timeout: true }), timeoutMs);
    })
  ]);
}

function emptyRegistry() {
  return {
    getAdapter: () => null
  };
}

function baseContext(request, adapter) {
  const metadata = adapter && adapter.metadata;
  return {
    trace_id: isPlainObject(request) && isNonEmptyString(request.trace_id) ? request.trace_id : 'trace_not_available',
    request_id: isPlainObject(request) && isNonEmptyString(request.request_id) ? request.request_id : 'request_not_available',
    adapter_id: isPlainObject(request) && isNonEmptyString(request.adapter_id)
      ? request.adapter_id
      : (metadata && metadata.adapter_id) || 'adapter_not_available',
    provider_id: isPlainObject(request) && isNonEmptyString(request.provider_id)
      ? request.provider_id
      : (metadata && metadata.provider_id) || 'provider_not_available',
    workspace_type: isPlainObject(request) && isNonEmptyString(request.workspace_type) ? request.workspace_type : 'workspace_not_available',
    tenant_id: isPlainObject(request) && isNonEmptyString(request.tenant_id) ? request.tenant_id : 'tenant_not_available',
    user_id: isPlainObject(request) && isNonEmptyString(request.user_id) ? request.user_id : 'user_not_available',
    domain: isPlainObject(request) && isNonEmptyString(request.domain) ? request.domain : 'domain_not_available',
    capability: isPlainObject(request) && isNonEmptyString(request.capability) ? request.capability : 'capability_not_available',
    operation: isPlainObject(request) && isNonEmptyString(request.operation) ? request.operation : 'operation_not_available'
  };
}

function buildEnvelope({ request, adapter, status, errorCode, blockedReason, safeSummary, data, executed, startTime, endTime }) {
  const context = baseContext(request, adapter);
  const durationMs = Math.max(0, Number.isInteger(endTime) && Number.isInteger(startTime) ? endTime - startTime : 0);
  const error = errorCode
    ? buildSafeAdapterError(errorCode, 'Read-only adapter operation blocked safely.', { blocked_reason: blockedReason })
    : null;
  const audit = buildAdapterAuditEventCandidate({
    ...context,
    status,
    executed: executed === true,
    duration_ms: durationMs,
    error_code: errorCode || null,
    blocked_reason: blockedReason || null
  });

  return {
    trace_id: context.trace_id,
    request_id: context.request_id,
    adapter_id: context.adapter_id,
    provider_id: context.provider_id,
    status,
    adapter_kind: adapter && adapter.metadata ? adapter.metadata.adapter_kind : 'unregistered',
    workspace_type: context.workspace_type,
    tenant_id: context.tenant_id,
    domain: context.domain,
    capability: context.capability,
    operation: context.operation,
    simulated: true,
    executed: executed === true,
    real_provider_called: false,
    can_trigger_real_execution: false,
    data: sanitizeAdapterData(isPlainObject(data) ? data : {}),
    safe_summary: isNonEmptyString(safeSummary) ? safeSummary : 'Read-only adapter operation returned a safe envelope.',
    warnings: [],
    error,
    duration_ms: durationMs,
    audit_event_candidate: audit
  };
}

function blockedResult(args) {
  return buildEnvelope({
    ...args,
    executed: false,
    data: {}
  });
}

function validateIdentity(request, metadata) {
  const errors = [];
  const expectedProviderClass = metadata.provider_class || metadata.provider_type;

  if (request.adapter_id !== metadata.adapter_id) errors.push('adapter_id_mismatch');
  if (request.provider_id !== metadata.provider_id) errors.push('provider_id_mismatch');
  if (request.provider_class !== expectedProviderClass) errors.push('provider_class_mismatch');
  return uniqueSorted(errors);
}

function validateScopes(request, metadata) {
  const errors = [];

  if (!metadata.supported_workspace_types.includes(request.workspace_type)) errors.push('workspace_not_allowed');
  if (!metadata.supported_domains.includes(request.domain)) errors.push('domain_not_supported');
  if (!metadata.supported_capabilities.includes(request.capability)) errors.push('capability_not_supported');
  if (!metadata.supported_operations.includes(request.operation)) errors.push('operation_not_supported');

  return uniqueSorted(errors);
}

function validateTenantStrategy(request, tenantStrategy) {
  if (tenantStrategy === 'tenant_id_required') {
    return isNonEmptyString(request.tenant_id) ? [] : ['tenant_id_missing'];
  }

  if (tenantStrategy === 'personal_user_tenant') {
    return request.tenant_id === `personal::${request.user_id}` ? [] : ['personal_tenant_mismatch'];
  }

  if (tenantStrategy === 'corporate_grupo_erick') {
    return request.tenant_id === 'grupo_erick' ? [] : ['corporate_tenant_mismatch'];
  }

  if (tenantStrategy === 'external_client_tenant') {
    if (!isNonEmptyString(request.client_id)) return ['client_id_missing'];
    return request.tenant_id === `client::${request.client_id}` ? [] : ['external_client_tenant_mismatch'];
  }

  return ['tenant_strategy_not_supported'];
}

function validateReadinessResult(readiness, metadata) {
  if (!isPlainObject(readiness)) return ['readiness_missing'];

  const errors = [];
  if (readiness.candidate_id !== metadata.readiness_candidate_id) errors.push('readiness_candidate_id_mismatch');
  if (readiness.provider_id !== metadata.provider_id) errors.push('readiness_provider_id_mismatch');
  if (readiness.adapter_id !== metadata.adapter_id) errors.push('readiness_adapter_id_mismatch');
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

async function executeReadOnlyAdapter(request, options = {}) {
  const startTime = typeof options.clock === 'function' ? options.clock() : defaultClock();
  const registry = options.registry || emptyRegistry();
  const featureFlagResolver = typeof options.featureFlagResolver === 'function'
    ? options.featureFlagResolver
    : defaultFeatureFlagResolver;
  const killSwitchResolver = typeof options.killSwitchResolver === 'function'
    ? options.killSwitchResolver
    : defaultKillSwitchResolver;
  const timeoutRunner = typeof options.timeoutRunner === 'function' ? options.timeoutRunner : defaultTimeoutRunner;
  const clock = typeof options.clock === 'function' ? options.clock : defaultClock;

  try {
    const requestedAdapterId = isPlainObject(request) && isNonEmptyString(request.adapter_id) ? request.adapter_id : null;
    const adapter = requestedAdapterId && typeof registry.getAdapter === 'function'
      ? registry.getAdapter(requestedAdapterId)
      : null;

    if (!adapter) {
      return blockedResult({
        request,
        status: 'adapter_not_registered',
        errorCode: 'ADAPTER_NOT_REGISTERED',
        blockedReason: 'adapter_not_registered',
        safeSummary: 'Adapter is not registered.',
        startTime,
        endTime: clock()
      });
    }

    const metadataValidation = validateAdapterMetadata(adapter.metadata);
    if (!metadataValidation.valid) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_contract_violation',
        errorCode: 'INVALID_ADAPTER_RESPONSE',
        blockedReason: metadataValidation.errors[0] || 'adapter_metadata_invalid',
        safeSummary: 'Adapter metadata failed contract validation.',
        startTime,
        endTime: clock()
      });
    }

    const requestValidation = validateAdapterRequest(request);
    if (!requestValidation.valid) {
      const forbidden = requestValidation.errors.find((error) => error.startsWith('forbidden_field::'));
      return blockedResult({
        request,
        adapter,
        status: 'adapter_validation_failed',
        errorCode: forbidden ? 'FORBIDDEN_FIELD_DETECTED' : 'INVALID_ADAPTER_REQUEST',
        blockedReason: forbidden || requestValidation.errors[0] || 'request_invalid',
        safeSummary: 'Adapter request failed validation.',
        startTime,
        endTime: clock()
      });
    }

    const identityErrors = validateIdentity(request, adapter.metadata);
    if (identityErrors.length > 0) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_validation_failed',
        errorCode: 'INVALID_ADAPTER_REQUEST',
        blockedReason: identityErrors[0],
        safeSummary: 'Adapter request identity does not match metadata.',
        startTime,
        endTime: clock()
      });
    }

    const scopeErrors = validateScopes(request, adapter.metadata);
    if (scopeErrors.includes('workspace_not_allowed')) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_workspace_blocked',
        errorCode: 'WORKSPACE_NOT_ALLOWED',
        blockedReason: 'workspace_not_allowed',
        safeSummary: 'Workspace is not allowed for this adapter.',
        startTime,
        endTime: clock()
      });
    }
    if (scopeErrors.includes('capability_not_supported') || scopeErrors.includes('domain_not_supported')) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_operation_blocked',
        errorCode: 'CAPABILITY_NOT_SUPPORTED',
        blockedReason: scopeErrors[0],
        safeSummary: 'Domain or capability is not supported by this adapter.',
        startTime,
        endTime: clock()
      });
    }
    if (scopeErrors.includes('operation_not_supported')) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_operation_blocked',
        errorCode: 'OPERATION_NOT_SUPPORTED',
        blockedReason: 'operation_not_supported',
        safeSummary: 'Operation is not declared by this adapter.',
        startTime,
        endTime: clock()
      });
    }

    const tenantErrors = validateTenantStrategy(request, adapter.metadata.tenant_strategy);
    if (tenantErrors.length > 0) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_tenant_blocked',
        errorCode: 'TENANT_SCOPE_INVALID',
        blockedReason: tenantErrors[0],
        safeSummary: 'Tenant scope is invalid for this adapter.',
        startTime,
        endTime: clock()
      });
    }

    if (adapter.metadata.enabled !== true && adapter.metadata.adapter_kind === 'mock') {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_disabled',
        errorCode: 'ADAPTER_DISABLED',
        blockedReason: 'adapter_disabled',
        safeSummary: 'Adapter is disabled.',
        startTime,
        endTime: clock()
      });
    }

    const featureEnabled = featureFlagResolver(adapter.metadata.feature_flag_key, {
      adapter: deepClone(adapter.metadata),
      request: sanitizeAdapterData(request)
    }) === true;
    if (!featureEnabled) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_feature_flag_off',
        errorCode: 'FEATURE_FLAG_OFF',
        blockedReason: 'feature_flag_off',
        safeSummary: 'Feature flag is off.',
        startTime,
        endTime: clock()
      });
    }

    const killSwitchActive = killSwitchResolver(adapter.metadata.adapter_id, {
      adapter: deepClone(adapter.metadata),
      request: sanitizeAdapterData(request)
    }) !== false;
    if (killSwitchActive) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_kill_switch_active',
        errorCode: 'KILL_SWITCH_ACTIVE',
        blockedReason: 'kill_switch_active',
        safeSummary: 'Kill switch is active.',
        startTime,
        endTime: clock()
      });
    }

    if (adapter.metadata.adapter_kind !== 'mock') {
      const readinessEvaluator = options.readinessEvaluator;
      const readiness = typeof readinessEvaluator === 'function'
        ? await readinessEvaluator(deepClone(adapter.metadata), sanitizeAdapterData(request))
        : null;
      const readinessErrors = validateReadinessResult(readiness, adapter.metadata);
      if (readinessErrors.length > 0) {
        return blockedResult({
          request,
          adapter,
          status: 'adapter_readiness_required',
          errorCode: 'READINESS_REQUIRED',
          blockedReason: readinessErrors[0],
          safeSummary: 'Readiness evidence is required before future real adapter work.',
          startTime,
          endTime: clock()
        });
      }

      return blockedResult({
        request,
        adapter,
        status: 'adapter_kind_not_allowed',
        errorCode: 'ADAPTER_KIND_NOT_ALLOWED',
        blockedReason: 'real_adapter_execution_not_allowed_in_this_pr',
        safeSummary: 'Only local mock adapters can execute in this PR.',
        startTime,
        endTime: clock()
      });
    }

    if (typeof adapter.execute !== 'function') {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_contract_violation',
        errorCode: 'INVALID_ADAPTER_RESPONSE',
        blockedReason: 'mock_execute_missing',
        safeSummary: 'Mock adapter does not expose execute.',
        startTime,
        endTime: clock()
      });
    }

    const safeRequest = sanitizeAdapterData(deepClone(request));
    const rawResponse = await timeoutRunner(
      () => adapter.execute(safeRequest),
      adapter.metadata.timeout_ms
    );

    if (rawResponse && rawResponse.__adapter_timeout === true) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_timeout',
        errorCode: 'ADAPTER_TIMEOUT',
        blockedReason: 'adapter_timeout',
        safeSummary: 'Mock adapter timed out safely.',
        startTime,
        endTime: clock()
      });
    }

    const forbiddenResponseFields = findForbiddenFields(rawResponse);
    if (forbiddenResponseFields.length > 0) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_contract_violation',
        errorCode: 'UNSAFE_ADAPTER_RESPONSE',
        blockedReason: forbiddenResponseFields[0],
        safeSummary: 'Adapter response contained forbidden fields.',
        startTime,
        endTime: clock()
      });
    }

    const adapterSanitizedResponse = typeof adapter.sanitizeResponse === 'function'
      ? adapter.sanitizeResponse(rawResponse)
      : rawResponse;
    const sanitizedResponse = sanitizeAdapterData(adapterSanitizedResponse);
    const responseValidation = validateAdapterResponse(sanitizedResponse);
    if (!responseValidation.valid) {
      return blockedResult({
        request,
        adapter,
        status: 'adapter_contract_violation',
        errorCode: 'INVALID_ADAPTER_RESPONSE',
        blockedReason: responseValidation.errors[0] || 'invalid_adapter_response',
        safeSummary: 'Adapter response failed contract validation.',
        startTime,
        endTime: clock()
      });
    }

    return buildEnvelope({
      request,
      adapter,
      status: 'adapter_mock_success',
      safeSummary: sanitizedResponse.safe_summary,
      data: sanitizedResponse.data || sanitizedResponse.sanitized_output || {},
      executed: true,
      startTime,
      endTime: clock()
    });
  } catch (_err) {
    return blockedResult({
      request,
      status: 'adapter_internal_error_safe',
      errorCode: 'INTERNAL_ADAPTER_ERROR',
      blockedReason: 'adapter_internal_error_safe',
      safeSummary: 'Adapter runtime failed closed.',
      startTime,
      endTime: clock()
    });
  }
}

module.exports = {
  executeReadOnlyAdapter,
  validateIdentity,
  validateScopes,
  validateTenantStrategy,
  validateReadinessResult
};
