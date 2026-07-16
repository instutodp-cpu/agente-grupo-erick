'use strict';

const {
  PROVIDER_ID,
  REQUEST_LIMITS,
  buildTransportEnvelope,
  sanitizeTransportResponse,
  validatePublicWebTransportRequest
} = require('../../core/public-web-transport-contract');

const metadata = Object.freeze({
  transport_id: 'public_web_mock_transport_v1',
  provider_id: PROVIDER_ID,
  transport_kind: 'mock',
  version: '1.0.0',
  environments: ['local_test'],
  supports_abort: true,
  supports_stream_limit: true,
  supports_redirect_control: true,
  max_timeout_ms: REQUEST_LIMITS.maximum_timeout_ms,
  max_response_bytes: REQUEST_LIMITS.maximum_response_bytes,
  real_network: false,
  enabled: true
});

function createPublicWebMockTransport(options = {}) {
  const mode = options.mode || 'success';
  return Object.freeze({
    metadata,
    canHandle(request) {
      return validatePublicWebTransportRequest(request, {
        transport_kind: 'mock',
        dnsResolver: options.dnsResolver || (() => ['93.184.216.34'])
      }).valid;
    },
    execute(request) {
      if (mode === 'timeout') {
        return buildTransportEnvelope(request, {
          status: 'public_web_timeout',
          error_code: 'PUBLIC_WEB_TIMEOUT',
          blocked_reason: 'mock_timeout',
          executed: true
        });
      }
      if (mode === 'redirect_localhost') {
        return buildTransportEnvelope(request, {
          status: 'public_web_redirect_blocked',
          error_code: 'PUBLIC_WEB_REDIRECT_BLOCKED',
          blocked_reason: 'redirect_localhost_blocked',
          redirects_followed: 1,
          executed: true
        });
      }
      if (mode === 'redirect_private_ip') {
        return buildTransportEnvelope(request, {
          status: 'public_web_redirect_blocked',
          error_code: 'PUBLIC_WEB_REDIRECT_BLOCKED',
          blocked_reason: 'redirect_private_ip_blocked',
          redirects_followed: 1,
          executed: true
        });
      }
      if (mode === 'provider_error') {
        return buildTransportEnvelope(request, {
          status: 'public_web_provider_error_safe',
          error_code: 'PUBLIC_WEB_INTERNAL_ERROR',
          blocked_reason: 'mock_provider_error',
          executed: true
        });
      }
      return sanitizeTransportResponse({
        content_type: 'text/html',
        status_code: 200,
        content: '<html><head><title>Mock publico</title></head><body><p>Resultado publico sintetico R$ 10,00.</p></body></html>'
      }, request, {
        executed: true,
        environment: 'local_test',
        feature_flag_state: true,
        kill_switch_state: false,
        canary_state: 'mock_transport'
      });
    },
    healthCheck() {
      return {
        status: 'ok',
        transport_id: metadata.transport_id,
        real_network: false,
        simulated: true,
        executed: false,
        real_provider_called: false,
        can_trigger_real_execution: false
      };
    }
  });
}

module.exports = {
  createPublicWebMockTransport,
  metadata
};
