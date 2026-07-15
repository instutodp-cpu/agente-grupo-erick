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
  sanitizeTransportResponse,
  validatePublicWebTransportRequest,
  validatePublicWebTransportResponse
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
  if (!context.transport || typeof context.transport.execute !== 'function') {
    return sanitizeTransportResponse({
      content_type: 'text/plain',
      status: 'public_web_validation_blocked',
      status_code: 400,
      content: 'Public web transport missing.'
    }, request, {
      executed: false,
      environment: context.environment || 'local_test'
    });
  }
  return context.transport.execute(request, context);
}

function sanitizeResponse(response) {
  return response;
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
