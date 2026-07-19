'use strict';

const { findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateProviderCandidate } = require('./transcription-provider-candidate-contract');
const {
  REQUIRED_MANDATORY_FIELDS,
  TRANSCRIPTION_PROVIDER_CRITERIA,
  TRANSCRIPTION_PROVIDER_CRITERIA_VERSION,
  validateProviderEvaluationCriteria
} = require('./transcription-provider-evaluation-criteria');

const TRANSCRIPTION_PROVIDER_SCORING_VERSION = 'scoring_transcription_provider_selection_v1';

function valueKnown(value) {
  return value !== null && value !== undefined && value !== 'unknown';
}

function fieldPass(candidate, field) {
  const value = candidate[field];
  if (!valueKnown(value)) return null;
  if (field === 'rollout_percentage') return value === 0;
  if (field === 'estimated_cost_per_minute_minor') return Number.isInteger(value) && value >= 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'string') return value.trim() !== '' && value !== 'blocked';
  if (Number.isFinite(value)) return value >= 0;
  return false;
}

function criterionScore(candidate, criterion) {
  const results = criterion.fields.map((field) => fieldPass(candidate, field));
  const known = results.filter((value) => value !== null);
  if (known.length === 0) return { score: 0, missing: criterion.fields, failures: [] };
  const passed = known.filter(Boolean).length;
  return {
    score: Math.round((passed / results.length) * 100),
    missing: criterion.fields.filter((field, index) => results[index] === null),
    failures: criterion.fields.filter((field, index) => results[index] === false)
  };
}

function validateScoreValue(score, id, errors) {
  if (!Number.isFinite(score)) errors.push(`score_not_finite::${id}`);
  if (score < 0 || score > 100) errors.push(`score_out_of_bounds::${id}`);
}

function scoreTranscriptionProviderCandidate(candidate, criteria = TRANSCRIPTION_PROVIDER_CRITERIA, context = {}) {
  const errors = [];
  const candidateValidation = validateProviderCandidate(candidate, context);
  if (!candidateValidation.valid) errors.push(...candidateValidation.errors);
  const criteriaValidation = validateProviderEvaluationCriteria(criteria);
  if (!criteriaValidation.valid) errors.push(...criteriaValidation.errors);
  if (!isPlainObject(candidate)) {
    return Object.freeze({ valid: false, errors: uniqueSorted(errors.length ? errors : ['provider_candidate_missing']), simulated: true, executed: false, real_provider_called: false, external_network_called: false });
  }
  const categoryScores = {};
  const missingEvidence = [];
  const mandatoryFailures = [];
  const penalties = [];
  let weighted = 0;
  for (const criterion of criteria) {
    const scored = criterionScore(candidate, criterion);
    validateScoreValue(scored.score, criterion.criterion_id, errors);
    categoryScores[criterion.group] = scored.score;
    weighted += (scored.score * criterion.weight) / 100;
    missingEvidence.push(...scored.missing.map((field) => `${criterion.criterion_id}::${field}`));
    if (criterion.mandatory === true) {
      mandatoryFailures.push(...scored.failures.map((field) => `${criterion.criterion_id}::${field}`));
      mandatoryFailures.push(...scored.missing.map((field) => `${criterion.criterion_id}::${field}_missing`));
    }
  }
  for (const field of REQUIRED_MANDATORY_FIELDS) {
    const pass = fieldPass(candidate, field);
    if (pass === false) mandatoryFailures.push(`mandatory::${field}`);
    if (pass === null) {
      mandatoryFailures.push(`mandatory::${field}_missing`);
      missingEvidence.push(`mandatory::${field}`);
    }
  }
  if (candidate.training_on_customer_data_default === true) {
    penalties.push('training_on_customer_data_default');
    weighted -= 10;
  }
  if (candidate.evidence_completeness !== 'complete') missingEvidence.push('candidate_evidence_incomplete');
  weighted = Math.max(0, Math.min(100, Math.round(weighted)));
  const normalized = weighted;
  errors.push(...findTranscriptionForbiddenFields(candidate));
  const valid = errors.length === 0;
  return Object.freeze(sanitizeTranscriptionData({
    valid,
    errors: uniqueSorted(errors),
    scoring_version: TRANSCRIPTION_PROVIDER_SCORING_VERSION,
    criteria_version: TRANSCRIPTION_PROVIDER_CRITERIA_VERSION,
    provider_candidate_id: candidate.provider_candidate_id || 'candidate_not_available',
    provider_slug: candidate.provider_slug || 'provider_not_available',
    category_scores: categoryScores,
    weighted_score: weighted,
    normalized_score: normalized,
    mandatory_pass: mandatoryFailures.length === 0,
    mandatory_failures: uniqueSorted(mandatoryFailures),
    missing_evidence: uniqueSorted(missingEvidence),
    penalties: uniqueSorted(penalties),
    explanation: uniqueSorted([
      mandatoryFailures.length === 0 ? 'mandatory_requirements_passed' : 'mandatory_requirements_failed',
      missingEvidence.length === 0 ? 'evidence_complete' : 'evidence_missing',
      'documentary_score_only'
    ]),
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
  TRANSCRIPTION_PROVIDER_SCORING_VERSION,
  scoreTranscriptionProviderCandidate
};
