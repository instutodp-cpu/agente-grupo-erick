'use strict';

const {
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');

const TRANSCRIPTION_PROVIDER_CANDIDATE_SLUGS = Object.freeze([
  'assemblyai',
  'aws_transcribe',
  'deepgram',
  'google_cloud_speech',
  'microsoft_azure_speech',
  'openai'
]);

const TRANSCRIPTION_PROVIDER_EVALUATION_STATUSES = Object.freeze([
  'draft',
  'incomplete',
  'evaluable',
  'rejected',
  'recommended_for_contract_review'
]);

const TRANSCRIPTION_PROVIDER_TYPES = Object.freeze([
  'managed_api',
  'cloud_service',
  'self_hosted_candidate'
]);

const REQUIRED_PROVIDER_CANDIDATE_FIELDS = Object.freeze([
  'provider_candidate_id',
  'provider_slug',
  'provider_display_name',
  'candidate_version',
  'evaluation_version',
  'data_source_version',
  'evaluated_at',
  'evaluation_expires_at',
  'evaluation_status',
  'provider_type',
  'deployment_model',
  'supported_regions',
  'data_processing_regions',
  'data_residency_options',
  'supported_languages',
  'supports_pt_br',
  'supports_pt_pt',
  'supported_audio_formats',
  'max_audio_duration_seconds',
  'max_file_size_bytes',
  'streaming_supported',
  'batch_supported',
  'diarization_supported',
  'timestamps_supported',
  'word_timestamps_supported',
  'punctuation_supported',
  'language_detection_supported',
  'custom_vocabulary_supported',
  'redaction_supported',
  'speaker_labels_supported',
  'confidence_scores_supported',
  'webhook_supported',
  'synchronous_supported',
  'asynchronous_supported',
  'retention_policy_documented',
  'configurable_retention_supported',
  'zero_retention_option_supported',
  'training_on_customer_data_default',
  'training_opt_out_supported',
  'encryption_in_transit',
  'encryption_at_rest',
  'customer_managed_keys_supported',
  'private_network_option_supported',
  'audit_logs_supported',
  'access_controls_supported',
  'subprocessors_documented',
  'dpa_available',
  'lgpd_support_status',
  'gdpr_support_status',
  'hipaa_support_status',
  'soc2_status',
  'iso27001_status',
  'sla_documented',
  'status_page_available',
  'rate_limits_documented',
  'quota_controls_supported',
  'timeout_controls_supported',
  'idempotency_supported',
  'retry_guidance_documented',
  'deletion_api_supported',
  'deletion_evidence_supported',
  'price_currency',
  'price_unit',
  'estimated_cost_per_minute_minor',
  'minimum_charge_minor',
  'free_tier_available',
  'billing_limits_supported',
  'budget_alerts_supported',
  'source_references',
  'evidence_completeness',
  'simulated',
  'executed',
  'real_provider_called',
  'external_network_called',
  'can_trigger_real_execution',
  'production_blocked',
  'provider_runtime_enabled',
  'provider_selected_for_execution',
  'rollout_percentage'
]);

const BOOLEAN_PROVIDER_CANDIDATE_FIELDS = Object.freeze([
  'supports_pt_br',
  'supports_pt_pt',
  'streaming_supported',
  'batch_supported',
  'diarization_supported',
  'timestamps_supported',
  'word_timestamps_supported',
  'punctuation_supported',
  'language_detection_supported',
  'custom_vocabulary_supported',
  'redaction_supported',
  'speaker_labels_supported',
  'confidence_scores_supported',
  'webhook_supported',
  'synchronous_supported',
  'asynchronous_supported',
  'retention_policy_documented',
  'configurable_retention_supported',
  'zero_retention_option_supported',
  'training_opt_out_supported',
  'encryption_in_transit',
  'encryption_at_rest',
  'customer_managed_keys_supported',
  'private_network_option_supported',
  'audit_logs_supported',
  'access_controls_supported',
  'subprocessors_documented',
  'dpa_available',
  'sla_documented',
  'status_page_available',
  'rate_limits_documented',
  'quota_controls_supported',
  'timeout_controls_supported',
  'idempotency_supported',
  'retry_guidance_documented',
  'deletion_api_supported',
  'deletion_evidence_supported',
  'free_tier_available',
  'billing_limits_supported',
  'budget_alerts_supported',
  'simulated',
  'executed',
  'real_provider_called',
  'external_network_called',
  'can_trigger_real_execution',
  'production_blocked',
  'provider_runtime_enabled',
  'provider_selected_for_execution'
]);

const ARRAY_PROVIDER_CANDIDATE_FIELDS = Object.freeze([
  'supported_regions',
  'data_processing_regions',
  'data_residency_options',
  'supported_languages',
  'supported_audio_formats',
  'source_references'
]);

function isIso(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function nowMs(context = {}) {
  const value = typeof context.clock === 'function' ? context.clock() : context.now;
  return Date.parse(value instanceof Date ? value.toISOString() : String(value || new Date(0).toISOString()));
}

function sortedUniqueStrings(values) {
  return uniqueSorted((Array.isArray(values) ? values : []).filter(isNonEmptyString));
}

function normalizeProviderCandidate(candidate) {
  const copy = deepClone(candidate || {});
  for (const field of ARRAY_PROVIDER_CANDIDATE_FIELDS) {
    if (Array.isArray(copy[field])) copy[field] = sortedUniqueStrings(copy[field]);
  }
  return Object.freeze(sanitizeTranscriptionData(copy));
}

function validateProviderCandidate(candidate, context = {}) {
  const errors = [];
  if (!isPlainObject(candidate)) return { valid: false, errors: ['provider_candidate_missing'] };
  for (const field of REQUIRED_PROVIDER_CANDIDATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(candidate, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['provider_candidate_id', 'provider_slug', 'provider_display_name', 'data_source_version', 'evaluated_at', 'evaluation_expires_at', 'evaluation_status', 'provider_type', 'deployment_model', 'price_currency', 'price_unit', 'evidence_completeness']) {
    if (!isNonEmptyString(candidate[field])) errors.push(`invalid_${field}`);
  }
  if (!TRANSCRIPTION_PROVIDER_CANDIDATE_SLUGS.includes(candidate.provider_slug)) errors.push(`provider_slug_not_allowed::${candidate.provider_slug}`);
  if (!Number.isInteger(candidate.candidate_version) || candidate.candidate_version < 1) errors.push('candidate_version_invalid');
  if (!Number.isInteger(candidate.evaluation_version) || candidate.evaluation_version < 1) errors.push('evaluation_version_invalid');
  if (!TRANSCRIPTION_PROVIDER_EVALUATION_STATUSES.includes(candidate.evaluation_status)) errors.push(`evaluation_status_not_allowed::${candidate.evaluation_status}`);
  if (!TRANSCRIPTION_PROVIDER_TYPES.includes(candidate.provider_type)) errors.push(`provider_type_not_allowed::${candidate.provider_type}`);
  if (!isIso(candidate.evaluated_at)) errors.push('evaluated_at_invalid');
  if (!isIso(candidate.evaluation_expires_at)) errors.push('evaluation_expires_at_invalid');
  if (isIso(candidate.evaluation_expires_at) && Date.parse(candidate.evaluation_expires_at) <= nowMs(context)) errors.push('evaluation_expired');
  for (const field of ARRAY_PROVIDER_CANDIDATE_FIELDS) {
    if (!Array.isArray(candidate[field]) || candidate[field].length === 0) errors.push(`${field}_required`);
    if (Array.isArray(candidate[field])) {
      const normalized = sortedUniqueStrings(candidate[field]);
      if (normalized.length !== candidate[field].length || normalized.some((value, index) => value !== candidate[field][index])) {
        errors.push(`${field}_must_be_sorted_unique`);
      }
    }
  }
  for (const field of BOOLEAN_PROVIDER_CANDIDATE_FIELDS) {
    if (typeof candidate[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of ['max_audio_duration_seconds', 'max_file_size_bytes', 'estimated_cost_per_minute_minor', 'minimum_charge_minor', 'rollout_percentage']) {
    if (!Number.isInteger(candidate[field]) || candidate[field] < 0) errors.push(`${field}_must_be_non_negative_integer`);
  }
  if (candidate.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (candidate.price_currency !== 'BRL') errors.push('price_currency_must_be_brl');
  if (candidate.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution', 'provider_runtime_enabled', 'provider_selected_for_execution']) {
    if (candidate[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (candidate.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (candidate.environment === 'production') errors.push('production_blocked');
  if (candidate.endpoint_configured === true || candidate.provider_endpoint || candidate.operational_endpoint) errors.push('operational_endpoint_blocked');
  errors.push(...findTranscriptionForbiddenFields(candidate));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildProviderCandidateAuditEvent(input = {}) {
  const candidate = input.candidate || {};
  return sanitizeTranscriptionData({
    event_name: input.event_name || 'provider_candidate_registered',
    provider_candidate_id: candidate.provider_candidate_id || input.provider_candidate_id || 'candidate_not_available',
    provider_slug: candidate.provider_slug || input.provider_slug || 'provider_not_available',
    candidate_version: candidate.candidate_version || null,
    evaluation_version: candidate.evaluation_version || null,
    status: input.status || candidate.evaluation_status || 'status_not_available',
    decision: input.decision || null,
    score: Number.isFinite(input.score) ? input.score : null,
    blockers: uniqueSorted(input.blockers || []),
    occurred_at: input.occurred_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    provider_runtime_enabled: false,
    provider_selected_for_execution: false
  });
}

module.exports = {
  ARRAY_PROVIDER_CANDIDATE_FIELDS,
  BOOLEAN_PROVIDER_CANDIDATE_FIELDS,
  REQUIRED_PROVIDER_CANDIDATE_FIELDS,
  TRANSCRIPTION_PROVIDER_CANDIDATE_SLUGS,
  TRANSCRIPTION_PROVIDER_EVALUATION_STATUSES,
  TRANSCRIPTION_PROVIDER_TYPES,
  buildProviderCandidateAuditEvent,
  normalizeProviderCandidate,
  validateProviderCandidate
};
