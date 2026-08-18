'use strict';

const CALLER_OBSERVABILITY_EVENT_NAME = 'hermes.caller_observation';
const CALLER_OBSERVABILITY_EVENT_VERSION = 'hermes-caller-observability-v1';

function routeIdFor(method, url) {
  const path = typeof url === 'string' ? url.split('?')[0] : '';
  if (method === 'POST' && path === '/message') return 'message.post';
  if (method === 'POST' && path === '/confirm') return 'confirm.post';
  if (method === 'GET' && /^\/confirm\/[^/]+$/.test(path)) return 'confirm.get';
  return null;
}

function safeLabel(value, maxLength = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : 'present';
}

function confirmationMetadata(value) {
  return {
    confirmation_id_present: typeof value === 'string' && value.trim().length > 0
  };
}

function headerValue(headers, name) {
  const value = headers && headers[name];
  return typeof value === 'string' ? value : null;
}

function hasHeader(headers, name) {
  return Boolean(headers && Object.prototype.hasOwnProperty.call(headers, name));
}

function hasPrefixedHeader(headers, prefix) {
  return Object.keys(headers || {}).some((name) => name.startsWith(prefix));
}

function authorizationMetadata(headers) {
  const authorization = headerValue(headers, 'authorization');
  if (!authorization || authorization.trim() === '') {
    return {
      authorization_present: false,
      auth_scheme: 'none',
      credential_value_logged: false
    };
  }

  const scheme = authorization.trim().split(/\s+/, 1)[0].toLowerCase();
  return {
    authorization_present: true,
    auth_scheme: ['bearer', 'basic'].includes(scheme) ? scheme : 'unknown',
    credential_value_logged: false
  };
}

function userAgentFamily(headers) {
  const userAgent = headerValue(headers, 'user-agent');
  if (!userAgent) return 'absent';
  const family = userAgent.trim().split(/[\s/]/, 1)[0].toLowerCase();
  if (family === 'curl') return 'curl';
  if (family === 'node' || family === 'undici') return 'node';
  if (family === 'mozilla') return 'browser';
  if (family === 'postmanruntime') return 'postman';
  if (family === 'python-requests') return 'python';
  return 'other';
}

function providerHeaderHints(headers) {
  return {
    twilio_signature_present: hasHeader(headers, 'x-twilio-signature'),
    elevenlabs_signature_present: hasHeader(headers, 'x-elevenlabs-signature') || hasHeader(headers, 'elevenlabs-signature'),
    base44_header_present: hasPrefixedHeader(headers, 'x-base44-')
  };
}

function gatewayHeaderHints(headers) {
  return {
    forwarded_present: hasHeader(headers, 'forwarded'),
    x_forwarded_for_present: hasHeader(headers, 'x-forwarded-for'),
    x_forwarded_host_present: hasHeader(headers, 'x-forwarded-host'),
    x_forwarded_proto_present: hasHeader(headers, 'x-forwarded-proto'),
    cloudflare_present: hasHeader(headers, 'cf-connecting-ip') || hasHeader(headers, 'cf-ray'),
    request_id_header_present: hasHeader(headers, 'x-request-id') || hasHeader(headers, 'x-correlation-id'),
    trusted_caddy_ingress_present: headerValue(headers, 'x-hermes-observation-ingress') === 'caddy-public-v1'
  };
}

function identityMetadata(req) {
  const identity = req && req.context && req.context.identity;
  if (!identity) {
    return {
      present: false,
      principal_type: null,
      principal_id: null,
      principal_id_present: false,
      tenant_id: null,
      tenant_id_present: false,
      key_id: null
    };
  }

  const principal = identity.principal || {};
  return {
    present: true,
    principal_type: safeLabel(principal.type) || 'unknown',
    principal_id: safeLabel(principal.id),
    principal_id_present: typeof principal.id === 'string' && principal.id.length > 0,
    tenant_id: safeLabel(identity.tenant_id),
    tenant_id_present: typeof identity.tenant_id === 'string' && identity.tenant_id.length > 0,
    key_id: safeLabel(identity.key_id)
  };
}

function classificationFor({ user_agent_family, provider_header_hints, gateway_header_hints }) {
  if (Object.values(provider_header_hints).some(Boolean)) {
    return { classification_candidate: 'PROVIDER_LIKE', confidence: 'LOW' };
  }
  if (Object.values(gateway_header_hints).some(Boolean)) {
    return { classification_candidate: 'INTERNAL_SERVER_LIKE', confidence: 'LOW' };
  }
  if (user_agent_family === 'curl') {
    return { classification_candidate: 'LOCAL_SMOKE', confidence: 'MEDIUM' };
  }
  if (user_agent_family === 'node' || user_agent_family === 'postman' || user_agent_family === 'python') {
    return { classification_candidate: 'TEST_ONLY', confidence: 'LOW' };
  }
  if (user_agent_family === 'browser') {
    return { classification_candidate: 'BROWSER_LIKE', confidence: 'LOW' };
  }
  return { classification_candidate: 'UNKNOWN', confidence: 'LOW' };
}

function safeCorrelationId(headers, names) {
  for (const name of names) {
    const value = safeLabel(headerValue(headers, name), 128);
    if (value) return value;
  }
  return null;
}

function beginCallerObservation(req, res, { logger = console.log, now = () => Date.now(), requestIdFactory = () => 'request_id_not_available' } = {}) {
  const route_id = routeIdFor(req && req.method, req && req.url);
  if (!route_id) return () => {};

  const startedAt = process.hrtime.bigint();
  const headers = req && req.headers ? req.headers : {};
  const request_id = safeCorrelationId(headers, ['x-request-id', 'x-correlation-id']) || requestIdFactory();
  const trace_id = safeCorrelationId(headers, ['x-trace-id', 'x-correlation-id']) || request_id;
  let emitted = false;

  const emit = () => {
    if (emitted) return;
    emitted = true;
    const user_agent_family = userAgentFamily(headers);
    const provider_header_hints = providerHeaderHints(headers);
    const gateway_header_hints = gatewayHeaderHints(headers);
    const classification = classificationFor({ user_agent_family, provider_header_hints, gateway_header_hints });
    const duration_ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const event = {
      event_name: CALLER_OBSERVABILITY_EVENT_NAME,
      event_version: CALLER_OBSERVABILITY_EVENT_VERSION,
      route_id,
      method: req.method,
      request_id,
      trace_id,
      timestamp: new Date(now()).toISOString(),
      auth: authorizationMetadata(headers),
      identity: identityMetadata(req),
      caller: {
        user_agent_family,
        provider_header_hints,
        gateway_header_hints,
        ...classification
      },
      outcome: {
        status_code: Number.isInteger(res.statusCode) ? res.statusCode : null,
        duration_ms: Number(duration_ms.toFixed(3))
      },
      safety: {
        payload_logged: false,
        secrets_logged: false
      }
    };

    try {
      logger(JSON.stringify(event));
    } catch (_error) {
      // Observability must never change the request outcome.
    }
  };

  res.once('finish', emit);
  res.once('close', emit);
  return emit;
}

module.exports = {
  CALLER_OBSERVABILITY_EVENT_NAME,
  CALLER_OBSERVABILITY_EVENT_VERSION,
  routeIdFor,
  beginCallerObservation,
  authorizationMetadata,
  classificationFor,
  confirmationMetadata
};
