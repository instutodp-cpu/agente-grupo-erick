'use strict';

const {
  ADAPTER_ID,
  ALLOWED_OPERATIONS,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  REQUEST_LIMITS,
  buildPublicWebAuditEvent,
  buildTransportEnvelope,
  findForbiddenFields,
  sanitizeTransportResponse,
  sanitizeObject,
  validatePublicWebTransportRequest,
  validatePublicWebTransportResponse,
  validateTransportCapabilities
} = require('../../core/public-web-transport-contract');

const metadata = Object.freeze({
  adapter_id: ADAPTER_ID,
  provider_id: PROVIDER_ID,
  provider_type: 'public_web',
  adapter_kind: 'real_read_only_candidate',
  version: '1.0.0',
  supported_workspace_types: ['personal', 'corporate', 'external_client'],
  supported_domains: ['compras', 'marketing', 'viagens', 'pesquisa', 'desenvolvimento', 'atendimento', 'treinamento'],
  supported_capabilities: [
    'public_web_search',
    'public_web_read',
    'public_web_compare',
    'public_web_summarize',
    'public_web_price_inspection',
    'public_web_promotion_inspection'
  ],
  supported_operations: ALLOWED_OPERATIONS,
  readiness_candidate_id: READINESS_CANDIDATE_ID,
  feature_flag_key: 'HERMES_PUBLIC_WEB_READ_ONLY_ENABLED',
  kill_switch_key: 'HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH',
  timeout_ms: REQUEST_LIMITS.default_timeout_ms,
  retry_policy: {
    strategy: 'none',
    max_attempts: 0
  },
  cost_risk: 'known_low_bounded',
  rate_limit_risk: 'known_low_bounded',
  data_classification: 'public_external_untrusted',
  deprecated: false,
  enabled: false,
  tenant_strategy: 'tenant_id_required'
});

function validateRequest(request, context = {}) {
  return validatePublicWebTransportRequest(request, {
    transport_kind: context.transport_kind || 'real_candidate',
    dnsResolver: context.dnsResolver
  });
}

async function execute(request, context = {}) {
  const requestValidation = validateRequest(request, context);
  if (!requestValidation.valid) {
    return sanitizeResponse(buildTransportEnvelope(request, {
      status: 'public_web_validation_blocked',
      error_code: 'INVALID_PUBLIC_WEB_REQUEST',
      blocked_reason: requestValidation.errors[0] || 'request_invalid',
      executed: false,
      environment: context.environment || 'local_test'
    }));
  }
  if (!context.transport || typeof context.transport.execute !== 'function') {
    return sanitizeResponse(buildTransportEnvelope(request, {
      status: 'public_web_validation_blocked',
      error_code: 'INVALID_PUBLIC_WEB_REQUEST',
      blocked_reason: 'transport_missing',
      executed: false,
      environment: context.environment || 'local_test'
    }));
  }
  const metadataValidation = validateTransportCapabilities(context.transport.metadata);
  if (!metadataValidation.valid) {
    return sanitizeResponse(buildTransportEnvelope(request, {
      status: 'public_web_validation_blocked',
      error_code: 'INVALID_PUBLIC_WEB_REQUEST',
      blocked_reason: metadataValidation.errors[0] || 'transport_metadata_invalid',
      executed: false,
      environment: context.environment || 'local_test'
    }));
  }
  if (typeof context.transport.canHandle === 'function' && context.transport.canHandle(request) !== true) {
    return sanitizeResponse(buildTransportEnvelope(request, {
      status: 'public_web_validation_blocked',
      error_code: 'INVALID_PUBLIC_WEB_REQUEST',
      blocked_reason: 'transport_cannot_handle_request',
      executed: false,
      environment: context.environment || 'local_test'
    }));
  }
  try {
    const response = await context.transport.execute(request, context);
    return sanitizeResponse(response, request, context);
  } catch (_error) {
    return sanitizeResponse(buildTransportEnvelope(request, {
      status: 'public_web_provider_error_safe',
      error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID',
      blocked_reason: 'transport_throw_safe',
      executed: false,
      environment: context.environment || 'local_test'
    }));
  }
}

function sanitizeResponse(response, request = {}, context = {}) {
  if (!response || typeof response !== 'object') {
    return buildTransportEnvelope(request, {
      status: 'public_web_provider_error_safe',
      error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID',
      blocked_reason: 'response_invalid',
      environment: context.environment || 'local_test'
    });
  }
  if (findForbiddenFields(response).length > 0) {
    return buildTransportEnvelope(request, {
      status: 'public_web_provider_error_safe',
      error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID',
      blocked_reason: 'unsafe_response_field_detected',
      executed: response.executed === true,
      real_provider_called: response.real_provider_called === true,
      environment: context.environment || response.audit_event_candidate && response.audit_event_candidate.environment || 'local_test'
    });
  }
  const validation = validatePublicWebTransportResponse(response);
  if (!validation.valid) {
    return buildTransportEnvelope(request, {
      status: 'public_web_provider_error_safe',
      error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID',
      blocked_reason: validation.errors[0] || 'response_contract_invalid',
      executed: response.executed === true,
      real_provider_called: response.real_provider_called === true,
      environment: context.environment || response.audit_event_candidate && response.audit_event_candidate.environment || 'local_test'
    });
  }
  return sanitizeObject({
    trace_id: response.trace_id,
    request_id: response.request_id,
    connector_id: response.connector_id,
    configuration_id: response.configuration_id,
    adapter_id: response.adapter_id,
    provider_id: response.provider_id,
    status: response.status,
    source_type: response.source_type,
    requested_target_hash: response.requested_target_hash,
    final_target_origin: response.final_target_origin,
    content_type: response.content_type,
    http_status_class: response.http_status_class,
    result_count: response.result_count,
    safe_summary: String(response.safe_summary || '').slice(0, REQUEST_LIMITS.maximum_summary_chars),
    structured_results: Array.isArray(response.structured_results)
      ? response.structured_results.map((item) => sanitizeObject(item)).slice(0, REQUEST_LIMITS.maximum_results)
      : [],
    freshness_hint: response.freshness_hint,
    confidence_hint: response.confidence_hint,
    warnings: Array.isArray(response.warnings) ? response.warnings.slice(0, 20).sort() : [],
    duration_ms: response.duration_ms,
    bytes_received: response.bytes_received,
    redirects_followed: response.redirects_followed,
    rate_limit_metadata: sanitizeObject(response.rate_limit_metadata),
    cost_metadata: sanitizeObject(response.cost_metadata),
    simulated: true,
    executed: response.executed === true,
    real_provider_called: response.real_provider_called === true,
    can_trigger_real_execution: false,
    error: sanitizeObject(response.error),
    audit_event_candidate: sanitizeObject(response.audit_event_candidate)
  });
}

function buildAuditEvent(context = {}) {
  return buildPublicWebAuditEvent({
    connector_id: CONNECTOR_ID,
    configuration_id: CONFIGURATION_ID,
    adapter_id: ADAPTER_ID,
    provider_id: PROVIDER_ID,
    ...context
  });
}

module.exports = {
  metadata,
  validateRequest,
  execute,
  sanitizeResponse,
  buildAuditEvent,
  validatePublicWebTransportResponse
};
