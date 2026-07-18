'use strict';

const {
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  buildSafeTranscriptionError,
  buildTranscriptionAuditEvent,
  sanitizeTranscriptionData,
  validateTranscriptionRequest,
  validateTranscriptionResult
} = require('../../core/transcription-contract');

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
  return Object.freeze({
    async summarize(request) {
      calls += 1;
      return sanitizeTranscriptionData({
        segments: [
          { start_ms: 0, end_ms: Math.min(request.duration_ms, 1500), text: 'Resumo sintetico de audio sanitizado.' }
        ],
        text: 'Resumo sintetico de audio sanitizado.',
        confidence: 0.91,
        language_detected: request.language === 'auto' ? 'pt-BR' : request.language,
        duration_ms: request.duration_ms,
        ...result
      });
    },
    calls() {
      return calls;
    }
  });
}

function blocked(request, reason) {
  return sanitizeTranscriptionData({
    status: 'transcription_mock_blocked',
    safe_summary: 'Transcription pilot blocked before provider simulation.',
    data: {},
    sanitized_output: {},
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_reasons: [reason],
    error: buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', reason),
    audit_event_candidate: buildTranscriptionAuditEvent({
      ...request,
      status: 'transcription_mock_blocked',
      blocked_reason: reason
    })
  });
}

function createTranscriptionSanitizedAdapter(options = {}) {
  const state = { initialized: false, shutdown: false };
  const provider = options.provider || createFakeTranscriptionProvider(options.fakeResult);

  function initialize() {
    state.initialized = true;
    state.shutdown = false;
    return { ok: true, initialized: true, simulated: true, executed: false, real_provider_called: false };
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
    if (!state.initialized) initialize();
    const validation = validate(request);
    if (!validation.valid) return blocked(request, validation.errors[0] || 'transcription_request_invalid');
    let result;
    try {
      result = await provider.summarize(sanitizeTranscriptionData(request));
    } catch (_error) {
      return sanitizeTranscriptionData({
        status: 'transcription_mock_error_safe',
        safe_summary: 'Transcription fake provider failed safely.',
        data: {},
        sanitized_output: {},
        simulated: true,
        executed: true,
        real_provider_called: false,
        can_trigger_real_execution: false,
        error: buildSafeTranscriptionError('INTERNAL_ADAPTER_ERROR', 'fake_provider_failed_safe'),
        audit_event_candidate: buildTranscriptionAuditEvent({ ...request, status: 'transcription_mock_error_safe', executed: true })
      });
    }
    const resultValidation = validateTranscriptionResult(result);
    if (!resultValidation.valid) return blocked(request, resultValidation.errors[0] || 'transcription_result_invalid');
    const sanitized = sanitizeTranscriptionData(result);
    return sanitizeTranscriptionData({
      status: 'transcription_mock_success',
      safe_summary: sanitized.text,
      data: sanitized,
      sanitized_output: sanitized,
      simulated: true,
      executed: true,
      real_provider_called: false,
      can_trigger_real_execution: false,
      fake_provider_called: true,
      provider_call_count: typeof provider.calls === 'function' ? provider.calls() : 1,
      audit_event_candidate: buildTranscriptionAuditEvent({ ...request, status: 'transcription_mock_success', executed: true })
    });
  }

  async function simulate(request = {}) {
    return dryRun(request);
  }

  function shutdown() {
    state.shutdown = true;
    return { ok: true, shutdown: true, simulated: true, executed: false, real_provider_called: false };
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
  createFakeTranscriptionProvider,
  createTranscriptionSanitizedAdapter,
  metadata
};
