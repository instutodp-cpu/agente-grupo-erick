'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateProviderEvaluationCriteria } = require('./transcription-provider-evaluation-criteria');

const TRANSCRIPTION_PROVIDER_SELECTION_DECISIONS = Object.freeze([
  'NO_PROVIDER_ELIGIBLE',
  'EVIDENCE_INCOMPLETE',
  'READY_FOR_PROVIDER_CONTRACT_REVIEW',
  'PRIMARY_AND_FALLBACK_IDENTIFIED',
  'MANUAL_REVIEW_REQUIRED'
]);

function isExpired(expiresAt, context = {}) {
  const now = Date.parse(typeof context.clock === 'function' ? context.clock() : context.now || new Date(0).toISOString());
  return !expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now;
}

function evaluateTranscriptionProviderSelection(input = {}, context = {}) {
  const criteriaValidation = validateProviderEvaluationCriteria(input.criteria);
  const matrix = input.matrix || {};
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const errors = [];
  if (!criteriaValidation.valid) errors.push(...criteriaValidation.errors);
  if (!isPlainObject(matrix) || !Array.isArray(matrix.rows)) errors.push('matrix_invalid');
  if (isExpired(input.evaluation_expires_at, context)) errors.push('dataset_expired');
  if (input.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (input.production_blocked !== true) errors.push('production_blocked_must_be_true');

  const incomplete = rows.filter((row) => row.compatibility_status === 'INCOMPLETE');
  const ineligible = rows.filter((row) => row.compatibility_status === 'INELIGIBLE' || row.compatibility_status === 'REJECTED');
  const recommended = rows.filter((row) => row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW');
  const fallback = rows.filter((row) => row.compatibility_status === 'FALLBACK_CANDIDATE');
  const criticalRisk = rows.some((row) => Array.isArray(row.risks) && row.risks.some((risk) => risk.severity === 'critical' && risk.blocks_recommendation === true));
  const minimumScore = Number.isInteger(input.minimum_score) ? input.minimum_score : 70;
  const primary = recommended[0] || null;
  const fallbackCandidate = fallback[0] || null;
  if (primary && primary.normalized_score < minimumScore) errors.push('primary_score_below_minimum');
  if (fallbackCandidate && fallbackCandidate.normalized_score < minimumScore) errors.push('fallback_score_below_minimum');
  if (criticalRisk) errors.push('critical_risk_blocks_selection');

  let decision = 'NO_PROVIDER_ELIGIBLE';
  if (errors.includes('dataset_expired') || incomplete.length > 0) decision = 'EVIDENCE_INCOMPLETE';
  else if (criticalRisk || errors.length > 0) decision = 'MANUAL_REVIEW_REQUIRED';
  else if (primary && fallbackCandidate) decision = 'PRIMARY_AND_FALLBACK_IDENTIFIED';
  else if (primary) decision = 'READY_FOR_PROVIDER_CONTRACT_REVIEW';
  else if (ineligible.length === rows.length) decision = 'NO_PROVIDER_ELIGIBLE';

  return Object.freeze(sanitizeTranscriptionData({
    selection_status: 'transcription_provider_selection_evaluated',
    selection_decision: decision,
    recommended_primary_for_contract_review: primary ? primary.provider_slug : null,
    recommended_fallback_for_contract_review: fallbackCandidate ? fallbackCandidate.provider_slug : null,
    rejected_candidates: ineligible.map((row) => row.provider_slug),
    incomplete_candidates: incomplete.map((row) => row.provider_slug),
    blockers: uniqueSorted(errors),
    human_review_required: true,
    decision_human_only: true,
    minimum_score: minimumScore,
    rollout_percentage: 0,
    production_blocked: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    provider_runtime_enabled: false,
    provider_selected_for_execution: false
  }));
}

module.exports = {
  TRANSCRIPTION_PROVIDER_SELECTION_DECISIONS,
  evaluateTranscriptionProviderSelection
};
