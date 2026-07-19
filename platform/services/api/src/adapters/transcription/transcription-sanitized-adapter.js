'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

const {
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  buildSafeTranscriptionError,
  buildTranscriptionAuditEvent,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData,
  validateTranscriptionRequest,
  validateTranscriptionResult
} = require('../../core/transcription-contract');

const TRANSCRIPTION_NETWORK_ACCESS_BLOCKED = 'TRANSCRIPTION_NETWORK_ACCESS_BLOCKED';

let networkHarnessLock = Promise.resolve();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const metadata = Object.freeze({
  adapter_id: TRANSCRIPTION_ADAPTER_ID,
  provider_id: TRANSCRIPTION_PROVIDER_ID,
  provider_type: 'transcription',
  adapter_kind: 'real_read_only_candidate',
  version: '0.1.0-pilot',
  supported_workspace_types: ['corporate', 'personal', 'external_client'],
  supported_domains: ['treinamento', 'atendimento', 'desenvolvimento'],
  supported_capabilities: ['sanitized_transcription_summary'],
  supported_operations: ['summarize_transcription', 'analyze_transcription'],
  readiness_candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
  feature_flag_key: 'transcription.sanitized_adapter.enabled',
  timeout_ms: 5000,
  retry_policy: { strategy: 'none', max_attempts: 0, unbounded: false },
  cost_risk: 'low',
  rate_limit_risk: 'low',
  data_classification: 'synthetic_transcription_metadata',
  deprecated: false,
  enabled: false,
  tenant_strategy: 'tenant_id_required'
});

function createFakeTranscriptionProvider(result = {}) {
  let calls = 0;
  const provider = {
    metadata: Object.freeze({
      provider_kind: 'synthetic_test_double',
      network_capable: false,
      real_provider: false
    }),
    async summarize(request) {
      calls += 1;
      return {
        segments: [
          { start_ms: 0, end_ms: Math.min(request.duration_ms, 1500), text: 'Resumo sintetico de audio sanitizado.', confidence: 0.91, speaker_label: 'synthetic_speaker' }
        ],
        text: 'Resumo sintetico de audio sanitizado.',
        confidence: 0.91,
        language_detected: request.language === 'auto' ? 'pt-BR' : request.language,
        duration_ms: request.duration_ms,
        ...result
      };
    },
    calls() {
      return calls;
    }
  };
  return Object.freeze(provider);
}

function blocked(request, reason, fields = {}) {
  return sanitizeTranscriptionData({
    status: fields.status || 'transcription_mock_blocked',
    safe_summary: 'Transcription pilot blocked before provider simulation.',
    data: {},
    sanitized_output: {},
    simulated: true,
    executed: fields.executed === true,
    fake_provider_called: fields.fake_provider_called === true,
    fake_provider_calls: Number.isInteger(fields.fake_provider_calls) ? fields.fake_provider_calls : 0,
    provider_call_count: Number.isInteger(fields.provider_call_count) ? fields.provider_call_count : 0,
    real_provider_called: false,
    external_network_called: fields.external_network_called === true,
    network_attempts: Number.isInteger(fields.network_attempts) ? fields.network_attempts : 0,
    can_trigger_real_execution: false,
    blocking_reasons: [reason],
    error: buildSafeTranscriptionError(fields.error_code || 'INVALID_ADAPTER_REQUEST', reason),
    audit_event_candidate: buildTranscriptionAuditEvent({
      ...request,
      status: 'transcription_mock_blocked',
      blocked_reason: reason
    })
  });
}

function buildNetworkAccessBlockedError(api) {
  const error = new Error('NETWORK_ACCESS_BLOCKED');
  error.code = TRANSCRIPTION_NETWORK_ACCESS_BLOCKED;
  error.blocked_reason = 'NETWORK_ACCESS_BLOCKED';
  error.network_api = api;
  return error;
}

function validateSyntheticProvider(provider) {
  const errors = [];
  if (!isPlainObject(provider)) errors.push('provider_must_be_object');
  if (isPlainObject(provider)) {
    if (typeof provider.summarize !== 'function') errors.push('provider_summarize_required');
    if (!isPlainObject(provider.metadata)) {
      errors.push('provider_metadata_required');
    } else {
      if (provider.metadata.provider_kind !== 'synthetic_test_double') errors.push('provider_kind_must_be_synthetic_test_double');
      if (provider.metadata.network_capable !== false) errors.push('provider_network_capable_must_be_false');
      if (provider.metadata.real_provider !== false) errors.push('provider_real_provider_must_be_false');
    }
    if (typeof provider.calls !== 'function') errors.push('provider_call_probe_required');
    const forbidden = findTranscriptionForbiddenFields(provider);
    if (forbidden.length > 0) errors.push(...forbidden);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function createNetworkDenyProbe() {
  let attempts = 0;
  function recordAttempt(api = 'network') {
    attempts += 1;
    return {
      allowed: false,
      blocked_reason: 'external_network_blocked',
      error_code: TRANSCRIPTION_NETWORK_ACCESS_BLOCKED,
      network_api: api
    };
  }
  return Object.freeze({
    block(api = 'network') {
      recordAttempt(api);
      throw buildNetworkAccessBlockedError(api);
    },
    recordAttempt(api = 'network') {
      return recordAttempt(api);
    },
    attempts() {
      return attempts;
    }
  });
}

function replaceNetworkMethod(target, key, apiName, restoreFns, networkProbe) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  restoreFns.push(() => {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    } else {
      delete target[key];
    }
  });
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value: function blockedNetworkAccess() {
      return networkProbe.block(apiName);
    }
  });
}

function installNetworkDenyHarness(networkProbe) {
  const restoreFns = [];
  replaceNetworkMethod(globalThis, 'fetch', 'globalThis.fetch', restoreFns, networkProbe);
  replaceNetworkMethod(http, 'request', 'http.request', restoreFns, networkProbe);
  replaceNetworkMethod(http, 'get', 'http.get', restoreFns, networkProbe);
  replaceNetworkMethod(https, 'request', 'https.request', restoreFns, networkProbe);
  replaceNetworkMethod(https, 'get', 'https.get', restoreFns, networkProbe);
  replaceNetworkMethod(net, 'connect', 'net.connect', restoreFns, networkProbe);
  replaceNetworkMethod(net, 'createConnection', 'net.createConnection', restoreFns, networkProbe);
  replaceNetworkMethod(tls, 'connect', 'tls.connect', restoreFns, networkProbe);
  replaceNetworkMethod(dns, 'lookup', 'dns.lookup', restoreFns, networkProbe);
  replaceNetworkMethod(dns, 'resolve', 'dns.resolve', restoreFns, networkProbe);
  replaceNetworkMethod(dns, 'resolve4', 'dns.resolve4', restoreFns, networkProbe);
  replaceNetworkMethod(dns, 'resolve6', 'dns.resolve6', restoreFns, networkProbe);
  return function restoreNetworkDenyHarness() {
    for (const restore of restoreFns.reverse()) restore();
  };
}

async function runWithNetworkBlocked(networkProbe, callback) {
  let releaseLock;
  const previousLock = networkHarnessLock;
  networkHarnessLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  await previousLock;
  let restore = () => {};
  try {
    restore = installNetworkDenyHarness(networkProbe);
    return await callback();
  } finally {
    try {
      restore();
    } finally {
      releaseLock();
    }
  }
}

function createTranscriptionSanitizedAdapter(options = {}) {
  const state = { lifecycle_state: 'created' };
  const provider = options.provider || createFakeTranscriptionProvider(options.fakeResult);
  const networkProbe = options.networkProbe || createNetworkDenyProbe();

  function initialize() {
    if (state.lifecycle_state === 'shutdown') {
      return { ok: false, initialized: false, status: 'transcription_adapter_shutdown', simulated: true, executed: false, real_provider_called: false };
    }
    state.lifecycle_state = 'initialized';
    return { ok: true, initialized: true, lifecycle_state: state.lifecycle_state, simulated: true, executed: false, real_provider_called: false };
  }

  function validate(request = {}) {
    const validation = validateTranscriptionRequest(request);
    return {
      ok: validation.valid,
      valid: validation.valid,
      errors: validation.errors,
      simulated: true,
      executed: false,
      real_provider_called: false
    };
  }

  async function dryRun(request = {}) {
    if (state.lifecycle_state === 'shutdown') return blocked(request, 'transcription_adapter_shutdown', { status: 'transcription_request_blocked' });
    if (state.lifecycle_state === 'running') return blocked(request, 'transcription_adapter_already_running', { status: 'transcription_request_blocked' });
    if (state.lifecycle_state !== 'initialized') return blocked(request, 'transcription_adapter_not_initialized', { status: 'transcription_request_blocked' });
    const providerValidation = validateSyntheticProvider(provider);
    if (!providerValidation.valid) {
      return blocked(request, 'transcription_provider_not_synthetic', {
        status: 'transcription_request_blocked',
        network_attempts: networkProbe.attempts(),
        external_network_called: networkProbe.attempts() > 0
      });
    }
    const validation = validate(request);
    const requestForbidden = findTranscriptionForbiddenFields(request);
    if (!validation.valid || requestForbidden.length > 0) {
      return blocked(request, requestForbidden[0] || validation.errors[0] || 'transcription_request_invalid', {
        status: 'transcription_request_blocked',
        network_attempts: networkProbe.attempts(),
        external_network_called: networkProbe.attempts() > 0
      });
    }
    const safeRequest = sanitizeTranscriptionData(request);
    const beforeCalls = typeof provider.calls === 'function' ? provider.calls() : 0;
    let rawResult;
    state.lifecycle_state = 'running';
    try {
      rawResult = await runWithNetworkBlocked(networkProbe, async () => {
        if (typeof options.provider_call_probe === 'function') options.provider_call_probe({ transcription_id: request.transcription_id });
        return provider.summarize(safeRequest);
      });
    } catch (error) {
      state.lifecycle_state = 'initialized';
      const afterErrorCalls = typeof provider.calls === 'function' ? provider.calls() : beforeCalls;
      const networkBlocked = error && error.code === TRANSCRIPTION_NETWORK_ACCESS_BLOCKED;
      return sanitizeTranscriptionData({
        status: networkBlocked ? 'transcription_network_blocked' : 'transcription_mock_error_safe',
        safe_summary: networkBlocked ? 'Transcription dry-run network access blocked.' : 'Transcription fake provider failed safely.',
        data: {},
        sanitized_output: {},
        simulated: true,
        executed: true,
        fake_provider_called: afterErrorCalls > beforeCalls,
        fake_provider_calls: Math.max(0, afterErrorCalls - beforeCalls),
        provider_call_count: afterErrorCalls,
        real_provider_called: false,
        external_network_called: networkProbe.attempts() > 0,
        network_attempts: networkProbe.attempts(),
        can_trigger_real_execution: false,
        error: buildSafeTranscriptionError(
          networkBlocked ? TRANSCRIPTION_NETWORK_ACCESS_BLOCKED : 'INTERNAL_ADAPTER_ERROR',
          networkBlocked ? 'NETWORK_ACCESS_BLOCKED' : 'fake_provider_failed_safe'
        ),
        audit_event_candidate: buildTranscriptionAuditEvent({
          ...request,
          status: networkBlocked ? 'transcription_network_blocked' : 'transcription_mock_error_safe',
          executed: true,
          blocked_reason: networkBlocked ? 'NETWORK_ACCESS_BLOCKED' : 'fake_provider_failed_safe'
        })
      });
    }
    state.lifecycle_state = 'initialized';
    const afterCalls = typeof provider.calls === 'function' ? provider.calls() : beforeCalls;
    const resultValidation = validateTranscriptionResult(rawResult);
    const resultForbidden = findTranscriptionForbiddenFields(rawResult);
    if (networkProbe.attempts() > 0) {
      return blocked(request, 'NETWORK_ACCESS_BLOCKED', {
        status: 'transcription_network_blocked',
        error_code: TRANSCRIPTION_NETWORK_ACCESS_BLOCKED,
        executed: true,
        fake_provider_called: afterCalls > beforeCalls,
        fake_provider_calls: Math.max(0, afterCalls - beforeCalls),
        provider_call_count: afterCalls,
        network_attempts: networkProbe.attempts(),
        external_network_called: true
      });
    }
    if (!resultValidation.valid || resultForbidden.length > 0) {
      return blocked(request, resultForbidden[0] || resultValidation.errors[0] || 'transcription_result_invalid', {
        status: 'transcription_result_blocked',
        executed: true,
        fake_provider_called: afterCalls > beforeCalls,
        fake_provider_calls: Math.max(0, afterCalls - beforeCalls),
        provider_call_count: afterCalls,
        network_attempts: networkProbe.attempts(),
        external_network_called: networkProbe.attempts() > 0
      });
    }
    const sanitized = sanitizeTranscriptionData(rawResult);
    return sanitizeTranscriptionData({
      status: 'transcription_mock_success',
      safe_summary: sanitized.text,
      data: sanitized,
      sanitized_output: sanitized,
      simulated: true,
      executed: true,
      real_provider_called: false,
      external_network_called: networkProbe.attempts() > 0,
      network_attempts: networkProbe.attempts(),
      can_trigger_real_execution: false,
      fake_provider_called: true,
      fake_provider_calls: Math.max(0, afterCalls - beforeCalls),
      provider_call_count: afterCalls,
      audit_event_candidate: buildTranscriptionAuditEvent({ ...request, status: 'transcription_mock_success', executed: true })
    });
  }

  async function simulate(request = {}) {
    return dryRun(request);
  }

  function shutdown() {
    state.lifecycle_state = 'shutdown';
    return { ok: true, shutdown: true, lifecycle_state: state.lifecycle_state, simulated: true, executed: false, real_provider_called: false };
  }

  return Object.freeze({
    metadata,
    initialize,
    validate,
    dryRun,
    simulate,
    shutdown
  });
}

module.exports = {
  TRANSCRIPTION_NETWORK_ACCESS_BLOCKED,
  createNetworkDenyProbe,
  createFakeTranscriptionProvider,
  createTranscriptionSanitizedAdapter,
  runWithNetworkBlocked,
  validateSyntheticProvider,
  metadata
};
