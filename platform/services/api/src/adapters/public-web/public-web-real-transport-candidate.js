'use strict';

const {
  PROVIDER_ID,
  REQUEST_LIMITS,
  buildTransportEnvelope,
  sanitizeTransportResponse,
  validatePublicWebTarget,
  validateRedirectChain,
  validatePublicWebTransportRequest
} = require('../../core/public-web-transport-contract');
const {
  evaluatePublicWebPilotGate
} = require('../../core/public-web-pilot-gate');

const metadata = Object.freeze({
  transport_id: 'public_web_real_transport_candidate_v1',
  provider_id: PROVIDER_ID,
  transport_kind: 'real_candidate',
  version: '1.0.0',
  environments: ['development', 'staging'],
  supports_abort: true,
  supports_stream_limit: true,
  supports_redirect_control: true,
  max_timeout_ms: REQUEST_LIMITS.maximum_timeout_ms,
  max_response_bytes: REQUEST_LIMITS.maximum_response_bytes,
  real_network: true,
  enabled: false
});

function dependencyMissing(name, request) {
  return buildTransportEnvelope(request, {
    status: 'public_web_validation_blocked',
    error_code: 'INVALID_PUBLIC_WEB_REQUEST',
    blocked_reason: `${name}_missing`,
    canary_state: 'canary_blocked',
    executed: false
  });
}

function createPublicWebRealTransportCandidate(options = {}) {
  const enabled = options.enabled === true;
  const httpClient = options.httpClient;
  const dnsResolver = options.dnsResolver;
  const secretResolver = options.secretResolver;
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();
  const abortControllerFactory = options.abortControllerFactory;

  return Object.freeze({
    metadata: Object.freeze({ ...metadata, enabled }),
    canHandle(request) {
      if (!enabled) return false;
      return validatePublicWebTransportRequest(request, {
        transport_kind: 'real_candidate',
        dnsResolver
      }).valid;
    },
    async execute(request, context = {}) {
      if (!enabled) {
        return buildTransportEnvelope(request, {
          status: 'public_web_feature_flag_off',
          error_code: 'PUBLIC_WEB_FEATURE_FLAG_OFF',
          blocked_reason: 'real_transport_disabled',
          canary_state: 'canary_blocked'
        });
      }
      if (typeof httpClient !== 'function') return dependencyMissing('httpClient', request);
      if (typeof dnsResolver !== 'function') return dependencyMissing('dnsResolver', request);
      if (!secretResolver || typeof secretResolver.resolveReference !== 'function') return dependencyMissing('secretResolver', request);
      if (typeof abortControllerFactory !== 'function') return dependencyMissing('abortControllerFactory', request);

      const gate = evaluatePublicWebPilotGate(request, {
        ...context,
        dnsResolver,
        secretResolver,
        environment: context.environment,
        clock
      });
      if (gate.allowed !== true) {
        return buildTransportEnvelope(request, {
          status: gate.status || 'public_web_readiness_blocked',
          error_code: gate.error && gate.error.error_code || 'PUBLIC_WEB_READINESS_REQUIRED',
          blocked_reason: gate.blocking_reasons && gate.blocking_reasons[0] || 'pilot_gate_blocked',
          canary_state: 'canary_blocked',
          environment: context.environment,
          feature_flag_state: context.feature_flag === true,
          kill_switch_state: context.kill_switch === true,
          rollout_percentage: context.rollout_percentage || 0
        });
      }

      if (!context.secretReference) return dependencyMissing('secretReference', request);
      if (!context.secretAccessContext) return dependencyMissing('secretAccessContext', request);
      const secretResolution = secretResolver.resolveReference(context.secretReference, context.secretAccessContext);
      if (!secretResolution || secretResolution.resolved !== true || secretResolution.exportable !== false) {
        return buildTransportEnvelope(request, {
          status: 'public_web_configuration_blocked',
          error_code: 'PUBLIC_WEB_CONFIGURATION_NOT_READY',
          blocked_reason: secretResolution && secretResolution.blocked_reason || 'secret_access_context_invalid',
          canary_state: 'canary_blocked',
          environment: context.environment,
          feature_flag_state: context.feature_flag === true,
          kill_switch_state: context.kill_switch === true,
          rollout_percentage: context.rollout_percentage || 0
        });
      }

      const requestValidation = validatePublicWebTransportRequest(request, {
        transport_kind: 'real_candidate',
        dnsResolver
      });
      if (!requestValidation.valid) {
        return buildTransportEnvelope(request, {
          status: 'public_web_target_blocked',
          error_code: 'PUBLIC_WEB_TARGET_INVALID',
          blocked_reason: requestValidation.errors[0] || 'target_invalid',
          canary_state: 'canary_blocked',
          environment: context.environment
        });
      }

      const targetValidation = validatePublicWebTarget(request.target, {
        transport_kind: 'real_candidate',
        dnsResolver
      });
      if (!targetValidation.valid) {
        return buildTransportEnvelope(request, {
          status: 'public_web_ssrf_blocked',
          error_code: 'PUBLIC_WEB_PRIVATE_IP_BLOCKED',
          blocked_reason: targetValidation.errors[0] || 'target_blocked',
          targetValidation,
          canary_state: 'canary_blocked',
          environment: context.environment
        });
      }

      const abortController = abortControllerFactory();
      const rawResponse = await httpClient({
        target: request.target,
        timeout_ms: request.timeout_ms,
        max_response_bytes: request.max_response_bytes,
        redirect_policy: request.redirect_policy,
        abort_signal: abortController && abortController.signal
      });

      const redirectErrors = validateRedirectChain(request.target, rawResponse && rawResponse.redirects || [], {
        transport_kind: 'real_candidate',
        dnsResolver,
        max_redirects: request.redirect_policy && request.redirect_policy.max_redirects || 0
      });
      if (redirectErrors.length > 0) {
        return buildTransportEnvelope(request, {
          status: 'public_web_redirect_blocked',
          error_code: 'PUBLIC_WEB_REDIRECT_BLOCKED',
          blocked_reason: redirectErrors[0],
          redirects_followed: Array.isArray(rawResponse && rawResponse.redirects) ? rawResponse.redirects.length : 0,
          canary_state: 'canary_blocked',
          environment: context.environment
        });
      }

      return sanitizeTransportResponse(rawResponse, request, {
        executed: true,
        max_response_bytes: request.max_response_bytes,
        environment: context.environment,
        feature_flag_state: context.feature_flag === true,
        kill_switch_state: context.kill_switch === true,
        lifecycle_state: context.lifecycle_state,
        readiness_state: context.readiness_state,
        configuration_state: context.configuration_state,
        canary_state: 'canary_allowed',
        rollout_percentage: context.rollout_percentage,
        occurred_at: clock()
      });
    },
    healthCheck() {
      return {
        status: enabled ? 'candidate_enabled_for_explicit_non_production_test' : 'disabled',
        transport_id: metadata.transport_id,
        real_network: true,
        enabled,
        simulated: true,
        executed: false,
        real_provider_called: false,
        can_trigger_real_execution: false
      };
    }
  });
}

module.exports = {
  createPublicWebRealTransportCandidate,
  metadata
};
