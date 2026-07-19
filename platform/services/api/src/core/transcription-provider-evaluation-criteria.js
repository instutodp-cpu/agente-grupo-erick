'use strict';

const { findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');

const TRANSCRIPTION_PROVIDER_CRITERIA_VERSION = 'criteria_transcription_provider_selection_v1';

const TRANSCRIPTION_PROVIDER_CRITERIA = Object.freeze([
  { criterion_id: 'quality_pt_br', group: 'quality_language', weight: 20, mandatory: true, fields: ['supports_pt_br', 'confidence_scores_supported', 'timestamps_supported', 'batch_supported'] },
  { criterion_id: 'privacy_lgpd', group: 'privacy_lgpd', weight: 20, mandatory: true, fields: ['training_opt_out_supported', 'dpa_available', 'subprocessors_documented', 'data_processing_regions'] },
  { criterion_id: 'security', group: 'security', weight: 15, mandatory: true, fields: ['encryption_in_transit', 'encryption_at_rest'] },
  { criterion_id: 'retention_deletion', group: 'retention_deletion', weight: 10, mandatory: true, fields: ['retention_policy_documented', 'deletion_api_supported'] },
  { criterion_id: 'cost', group: 'cost', weight: 10, mandatory: true, fields: ['estimated_cost_per_minute_minor', 'billing_limits_supported'] },
  { criterion_id: 'reliability', group: 'reliability', weight: 10, mandatory: true, fields: ['sla_documented', 'rate_limits_documented'] },
  { criterion_id: 'technical_compatibility', group: 'technical_compatibility', weight: 5, mandatory: false, fields: ['supported_audio_formats', 'language_detection_supported', 'synchronous_supported', 'asynchronous_supported'] },
  { criterion_id: 'operation_observability', group: 'operation_observability', weight: 5, mandatory: false, fields: ['audit_logs_supported', 'quota_controls_supported', 'timeout_controls_supported'] },
  { criterion_id: 'governance', group: 'governance', weight: 3, mandatory: true, fields: ['source_references', 'production_blocked', 'rollout_percentage'] },
  { criterion_id: 'fallback_portability', group: 'fallback_portability', weight: 2, mandatory: false, fields: ['idempotency_supported', 'retry_guidance_documented'] }
]);

const REQUIRED_MANDATORY_FIELDS = Object.freeze([
  'supports_pt_br',
  'confidence_scores_supported',
  'timestamps_supported',
  'batch_supported',
  'encryption_in_transit',
  'retention_policy_documented',
  'training_opt_out_supported',
  'dpa_available',
  'subprocessors_documented',
  'deletion_api_supported',
  'rate_limits_documented',
  'billing_limits_supported',
  'data_processing_regions',
  'estimated_cost_per_minute_minor',
  'sla_documented',
  'production_blocked',
  'rollout_percentage'
]);

function validateProviderEvaluationCriteria(criteria = TRANSCRIPTION_PROVIDER_CRITERIA) {
  const errors = [];
  if (!Array.isArray(criteria) || criteria.length === 0) return { valid: false, errors: ['criteria_missing'] };
  const ids = new Set();
  let total = 0;
  const mandatoryFields = new Set();
  for (const criterion of criteria) {
    if (!isPlainObject(criterion)) {
      errors.push('criterion_must_be_object');
      continue;
    }
    if (!isNonEmptyString(criterion.criterion_id)) errors.push('criterion_id_invalid');
    if (ids.has(criterion.criterion_id)) errors.push(`criterion_duplicate::${criterion.criterion_id}`);
    ids.add(criterion.criterion_id);
    if (!isNonEmptyString(criterion.group)) errors.push(`criterion_group_invalid::${criterion.criterion_id}`);
    if (!Number.isInteger(criterion.weight)) errors.push(`criterion_weight_invalid::${criterion.criterion_id}`);
    else {
      if (criterion.weight < 0) errors.push(`criterion_weight_negative::${criterion.criterion_id}`);
      total += criterion.weight;
    }
    if (typeof criterion.mandatory !== 'boolean') errors.push(`criterion_mandatory_invalid::${criterion.criterion_id}`);
    if (!Array.isArray(criterion.fields) || criterion.fields.length === 0) errors.push(`criterion_fields_missing::${criterion.criterion_id}`);
    else if (criterion.mandatory === true) criterion.fields.forEach((field) => mandatoryFields.add(field));
    errors.push(...findTranscriptionForbiddenFields(criterion));
  }
  if (total !== 100) errors.push(`criteria_weight_total_invalid::${total}`);
  for (const field of REQUIRED_MANDATORY_FIELDS) {
    if (!mandatoryFields.has(field)) errors.push(`mandatory_requirement_missing::${field}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildCriteriaSummary(criteria = TRANSCRIPTION_PROVIDER_CRITERIA) {
  return Object.freeze(sanitizeTranscriptionData({
    criteria_version: TRANSCRIPTION_PROVIDER_CRITERIA_VERSION,
    total_weight: criteria.reduce((sum, criterion) => sum + (Number.isInteger(criterion.weight) ? criterion.weight : 0), 0),
    criteria_count: criteria.length,
    mandatory_fields: [...REQUIRED_MANDATORY_FIELDS],
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    provider_runtime_enabled: false,
    provider_selected_for_execution: false
  }));
}

module.exports = {
  REQUIRED_MANDATORY_FIELDS,
  TRANSCRIPTION_PROVIDER_CRITERIA,
  TRANSCRIPTION_PROVIDER_CRITERIA_VERSION,
  buildCriteriaSummary,
  validateProviderEvaluationCriteria
};
