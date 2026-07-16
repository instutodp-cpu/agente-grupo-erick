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

function releaseBudget(budget, fields = {}) {
  if (budget && typeof budget.release === 'function') {
    try {
      budget.release(fields);
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function reserveBudget(name, budget, request, reserved) {
  if (!budget || typeof budget.reserve !== 'function') {
    return {
      ok: false,
      response: buildTransportEnvelope(request, {
        status: 'public_web_validation_blocked',
        error_code: 'INVALID_PUBLIC_WEB_REQUEST',
        blocked_reason: `${name}_budget_missing`,
        canary_state: 'canary_blocked'
      })
    };
  }
  const result = budget.reserve();
  if (!result || result.allowed !== true) {
    for (const item of reserved) releaseBudget(item.budget, { provider_error: false });
    return {
      ok: false,
      response: buildTransportEnvelope(request, {
        status: name === 'rate_limit' ? 'public_web_rate_limited' : 'public_web_validation_blocked',
        error_code: name === 'rate_limit' ? 'PUBLIC_WEB_RATE_LIMITED' : 'INVALID_PUBLIC_WEB_REQUEST',
        blocked_reason: result && result.reason || `${name}_budget_blocked`,
        canary_state: 'canary_blocked'
      })
    };
  }
  reserved.push({ name, budget });
  return { ok: true };
}

function getRedirectLocation(rawResponse) {
  if (typeof (rawResponse && rawResponse.redirect_location) === 'string') return rawResponse.redirect_location;
  return '';
}

async function readBoundedBodyStream(rawResponse, request, abortController) {
  const limit = request.max_response_bytes || REQUEST_LIMITS.default_response_bytes;
  if (!rawResponse || typeof rawResponse !== 'object') {
    return { ok: false, error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID', blocked_reason: 'provider_response_invalid' };
  }
  if (Number.isInteger(rawResponse.content_length) && rawResponse.content_length > limit) {
    if (abortController && typeof abortController.abort === 'function') abortController.abort();
    return { ok: false, error_code: 'PUBLIC_WEB_RESPONSE_TOO_LARGE', blocked_reason: 'content_length_exceeded', bytes_received: 0 };
  }
  if (!rawResponse.body_stream || typeof rawResponse.body_stream[Symbol.asyncIterator] !== 'function') {
    return { ok: false, error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID', blocked_reason: 'body_stream_required_for_real_candidate' };
  }
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of rawResponse.body_stream) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      bytes += Buffer.byteLength(text, 'utf8');
      if (bytes > limit) {
        if (abortController && typeof abortController.abort === 'function') abortController.abort();
        return { ok: false, error_code: 'PUBLIC_WEB_RESPONSE_TOO_LARGE', blocked_reason: 'stream_limit_exceeded', bytes_received: limit };
      }
      chunks.push(text);
    }
  } catch (_error) {
    return { ok: false, error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID', blocked_reason: 'body_stream_error', bytes_received: bytes };
  }
  return { ok: true, content: chunks.join(''), bytes_received: bytes };
}

async function withTimeout(task, timeoutMs, abortController) {
  let timerCleared = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (abortController && typeof abortController.abort === 'function') abortController.abort();
      const error = new Error('PUBLIC_WEB_TIMEOUT');
      error.code = 'PUBLIC_WEB_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(), timeout]);
  } finally {
    clearTimeout(timer);
    timerCleared = true;
    if (abortController && abortController.signal) abortController.signal.timer_cleared = timerCleared;
  }
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

      const connectionValidation = validatePublicWebTarget(request.target, {
        transport_kind: 'real_candidate',
        dnsResolver
      });
      if (!connectionValidation.valid || connectionValidation.approved_ip !== targetValidation.approved_ip) {
        return buildTransportEnvelope(request, {
          status: 'public_web_ssrf_blocked',
          error_code: 'PUBLIC_WEB_DNS_REBINDING_BLOCKED',
          blocked_reason: connectionValidation.valid ? 'approved_ip_changed_before_request' : 'target_revalidation_failed',
          canary_state: 'canary_blocked',
          environment: context.environment
        });
      }

      const reserved = [];
      const rateReserve = reserveBudget('rate_limit', context.rateLimitBudget, request, reserved);
      if (!rateReserve.ok) return rateReserve.response;
      const costReserve = reserveBudget('cost', context.costBudget, request, reserved);
      if (!costReserve.ok) return costReserve.response;

      const abortController = abortControllerFactory();
      let rawResponse;
      let providerError = false;
      try {
        rawResponse = await withTimeout(() => httpClient({
          url: request.target,
          approved_ip: targetValidation.approved_ip,
          approved_ips: targetValidation.approved_ips,
          hostname: targetValidation.hostname,
          port: targetValidation.port,
          protocol: targetValidation.protocol,
          server_name: targetValidation.server_name,
          host_header: targetValidation.host_header,
          redirect_mode: 'manual',
          follow_redirects: false,
          timeout_ms: request.timeout_ms,
          max_response_bytes: request.max_response_bytes,
          abort_signal: abortController && abortController.signal
        }), request.timeout_ms, abortController);

        if (rawResponse && rawResponse.remote_address !== targetValidation.approved_ip) {
          providerError = true;
          return buildTransportEnvelope(request, {
            status: 'public_web_ssrf_blocked',
            error_code: 'PUBLIC_WEB_DNS_REBINDING_BLOCKED',
            blocked_reason: 'remote_address_mismatch',
            executed: true,
            real_provider_called: true,
            canary_state: 'canary_blocked',
            environment: context.environment
          });
        }

        if (rawResponse && rawResponse.status_code >= 300 && rawResponse.status_code < 400) {
          const redirectLocation = getRedirectLocation(rawResponse);
          const redirectTarget = redirectLocation ? new URL(redirectLocation, request.target).toString() : '';
          const redirectErrors = validateRedirectChain(request.target, redirectTarget ? [redirectTarget] : [''], {
            transport_kind: 'real_candidate',
            dnsResolver,
            max_redirects: 0
          });
          providerError = true;
          return buildTransportEnvelope(request, {
            status: 'public_web_redirect_blocked',
            error_code: 'PUBLIC_WEB_REDIRECT_BLOCKED',
            blocked_reason: redirectErrors[0] || 'redirect_blocked_in_current_phase',
            redirects_followed: 0,
            executed: true,
            real_provider_called: true,
            canary_state: 'canary_blocked',
            environment: context.environment
          });
        }

        const body = await readBoundedBodyStream(rawResponse, request, abortController);
        if (!body.ok) {
          providerError = true;
          return buildTransportEnvelope(request, {
            status: body.error_code === 'PUBLIC_WEB_RESPONSE_TOO_LARGE' ? 'public_web_response_too_large' : 'public_web_provider_error_safe',
            error_code: body.error_code,
            blocked_reason: body.blocked_reason,
            bytes_received: body.bytes_received || 0,
            executed: true,
            real_provider_called: true,
            canary_state: 'canary_blocked',
            environment: context.environment
          });
        }

        const response = sanitizeTransportResponse({
          status_code: rawResponse.status_code,
          content_type: rawResponse.content_type,
          content_length: body.bytes_received,
          content: body.content
        }, request, {
          executed: true,
          real_provider_called: true,
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
        providerError = response.status !== 'public_web_candidate_success';
        return response;
      } catch (error) {
        providerError = true;
        const timedOut = error && error.code === 'PUBLIC_WEB_TIMEOUT';
        return buildTransportEnvelope(request, {
          status: timedOut ? 'public_web_timeout' : 'public_web_provider_error_safe',
          error_code: timedOut ? 'PUBLIC_WEB_TIMEOUT' : 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID',
          blocked_reason: timedOut ? 'timeout_after_network_start' : 'provider_error_after_network_start',
          executed: true,
          real_provider_called: true,
          canary_state: 'canary_blocked',
          environment: context.environment
        });
      } finally {
        for (const item of reserved) releaseBudget(item.budget, { provider_error: providerError });
      }
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
