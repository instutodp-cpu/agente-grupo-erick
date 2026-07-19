'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  TRANSCRIPTION_PROVIDER_CRITERIA_VERSION,
  validateProviderEvaluationCriteria
} = require('./transcription-provider-evaluation-criteria');
const {
  buildCompatibilityMatrix,
  validateTranscriptionProviderCompatibilityMatrix
} = require('./transcription-provider-compatibility-matrix');

const TRANSCRIPTION_PROVIDER_SELECTION_DECISIONS = Object.freeze([
  'NO_PROVIDER_ELIGIBLE',
  'EVIDENCE_INCOMPLETE',
  'READY_FOR_PROVIDER_CONTRACT_REVIEW',
  'PRIMARY_AND_FALLBACK_IDENTIFIED',
  'MANUAL_REVIEW_REQUIRED'
]);

const DEFAULT_MINIMUM_SCORE = 70;
const DEFAULT_MINIMUM_PRIMARY_FALLBACK_SCORE_DELTA = 1;

function isExpired(expiresAt, context = {}) {
  const now = Date.parse(typeof context.clock === 'function' ? context.clock() : context.now || new Date(0).toISOString());
  return !expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now;
}

function finiteRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function selectMatrix(input, context, errors) {
  if (Array.isArray(input.candidates)) {
    return buildCompatibilityMatrix({
      candidates: input.candidates,
      criteria: input.criteria,
      risks: input.risks || [],
      context: {
        ...context,
        dataset_version: input.dataset_version,
        criteria_version: input.criteria_version || TRANSCRIPTION_PROVIDER_CRITERIA_VERSION,
        evaluation_expires_at: input.evaluation_expires_at
      }
    });
  }
  if (!isPlainObject(input.matrix)) errors.push('matrix_invalid');
  return input.matrix || {};
}

function recommendedRows(rows) {
  return {
    primary: rows.filter((row) => row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW'),
    fallback: rows.filter((row) => row.compatibility_status === 'FALLBACK_CANDIDATE')
  };
}

function validateRecommendedRows(rows, errors) {
  const { primary, fallback } = recommendedRows(rows);
  if (primary.length > 1) errors.push('multiple_primary_recommendations');
  if (fallback.length > 1) errors.push('multiple_fallback_recommendations');
  if (fallback.length > 0 && primary.length === 0) errors.push('fallback_without_primary');
  if (primary[0] && fallback[0] && primary[0].provider_candidate_id === fallback[0].provider_candidate_id) {
    errors.push('same_provider_primary_and_fallback');
  }
  for (const row of [...primary, ...fallback]) {
    if (row.candidate_contract_valid !== true) errors.push(`recommended_candidate_contract_invalid::${row.provider_slug}`);
    if (row.scoring_valid !== true) errors.push(`recommended_scoring_invalid::${row.provider_slug}`);
    if (row.mandatory_requirements_passed !== true) errors.push(`recommended_mandatory_not_passed::${row.provider_slug}`);
    if (Array.isArray(row.mandatory_requirements_failed) && row.mandatory_requirements_failed.length > 0) errors.push(`recommended_mandatory_failures_present::${row.provider_slug}`);
    if (Array.isArray(row.missing_evidence) && row.missing_evidence.length > 0) errors.push(`recommended_missing_evidence_present::${row.provider_slug}`);
    if (Array.isArray(row.blockers) && row.blockers.length > 0) errors.push(`recommended_blockers_present::${row.provider_slug}`);
    if (row.normalized_score < 0 || row.normalized_score > 100 || !Number.isFinite(row.normalized_score)) errors.push(`recommended_score_invalid::${row.provider_slug}`);
  }
  return { primary, fallback };
}

function evaluateTranscriptionProviderSelection(input = {}, context = {}) {
  const criteriaValidation = validateProviderEvaluationCriteria(input.criteria);
  const errors = [];
  if (!criteriaValidation.valid) errors.push(...criteriaValidation.errors);
  if (isExpired(input.evaluation_expires_at, context)) errors.push('dataset_expired');
  if (input.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (input.production_blocked !== true) errors.push('production_blocked_must_be_true');

  const minimumScore = input.minimum_score === undefined ? DEFAULT_MINIMUM_SCORE : input.minimum_score;
  if (!finiteRange(minimumScore, 0, 100)) errors.push('minimum_score_invalid');
  const requiredScoreDelta = input.minimum_primary_fallback_score_delta === undefined
    ? DEFAULT_MINIMUM_PRIMARY_FALLBACK_SCORE_DELTA
    : input.minimum_primary_fallback_score_delta;
  if (!finiteRange(requiredScoreDelta, 0, 100)) errors.push('minimum_primary_fallback_score_delta_invalid');

  const matrix = selectMatrix(input, context, errors);
  const expectedDatasetVersion = input.dataset_version || matrix.dataset_version;
  const expectedCriteriaVersion = input.criteria_version || TRANSCRIPTION_PROVIDER_CRITERIA_VERSION;
  const matrixValidation = validateTranscriptionProviderCompatibilityMatrix(matrix, {
    ...context,
    dataset_version: expectedDatasetVersion,
    criteria_version: expectedCriteriaVersion
  });
  if (!matrixValidation.valid) errors.push(...matrixValidation.errors);

  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const incomplete = rows.filter((row) => row.compatibility_status === 'INCOMPLETE');
  const ineligible = rows.filter((row) => row.compatibility_status === 'INELIGIBLE' || row.compatibility_status === 'REJECTED');
  const { primary, fallback } = validateRecommendedRows(rows, errors);
  const primaryRow = primary[0] || null;
  const fallbackRow = fallback[0] || null;
  const criticalRisk = rows.some((row) => Array.isArray(row.risks) && row.risks.some((risk) => risk.severity === 'critical' && risk.blocks_recommendation === true));
  if (criticalRisk) errors.push('critical_risk_blocks_selection');
  if (primaryRow && finiteRange(minimumScore, 0, 100) && primaryRow.normalized_score < minimumScore) errors.push('primary_score_below_minimum');
  if (fallbackRow && finiteRange(minimumScore, 0, 100) && fallbackRow.normalized_score < minimumScore) errors.push('fallback_score_below_minimum');

  const primaryScore = primaryRow ? primaryRow.normalized_score : null;
  const fallbackScore = fallbackRow ? fallbackRow.normalized_score : null;
  const scoreDelta = primaryRow && fallbackRow ? primaryRow.normalized_score - fallbackRow.normalized_score : null;
  const scoreDeltaSatisfied = scoreDelta !== null && finiteRange(requiredScoreDelta, 0, 100) && scoreDelta >= requiredScoreDelta && scoreDelta > 0;
  if (primaryRow && fallbackRow && scoreDeltaSatisfied !== true) errors.push('primary_fallback_score_delta_insufficient');

  const structuralErrors = errors.filter((error) =>
    !['dataset_expired'].includes(error) &&
    !String(error).startsWith('matrix_expired')
  );
  let decision = 'NO_PROVIDER_ELIGIBLE';
  if (structuralErrors.length > 0 || criticalRisk) decision = 'MANUAL_REVIEW_REQUIRED';
  else if (errors.includes('dataset_expired') || errors.includes('matrix_expired')) decision = 'EVIDENCE_INCOMPLETE';
  else if (primaryRow && fallbackRow && scoreDeltaSatisfied) decision = 'PRIMARY_AND_FALLBACK_IDENTIFIED';
  else if (primaryRow && !fallbackRow) decision = 'READY_FOR_PROVIDER_CONTRACT_REVIEW';
  else if (incomplete.length > 0) decision = 'EVIDENCE_INCOMPLETE';
  else if (ineligible.length === rows.length && rows.length > 0) decision = 'NO_PROVIDER_ELIGIBLE';

  return Object.freeze(sanitizeTranscriptionData({
    selection_status: 'transcription_provider_selection_evaluated',
    selection_decision: decision,
    recommended_primary_for_contract_review: primaryRow ? primaryRow.provider_slug : null,
    recommended_fallback_for_contract_review: fallbackRow ? fallbackRow.provider_slug : null,
    rejected_candidates: ineligible.map((row) => row.provider_slug),
    incomplete_candidates: incomplete.map((row) => row.provider_slug),
    blockers: uniqueSorted(errors),
    human_review_required: true,
    decision_human_only: true,
    minimum_score: finiteRange(minimumScore, 0, 100) ? minimumScore : null,
    minimum_primary_fallback_score_delta: finiteRange(requiredScoreDelta, 0, 100) ? requiredScoreDelta : null,
    primary_score: primaryScore,
    fallback_score: fallbackScore,
    primary_fallback_score_delta: scoreDelta,
    required_score_delta: finiteRange(requiredScoreDelta, 0, 100) ? requiredScoreDelta : null,
    score_delta_satisfied: scoreDeltaSatisfied,
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
  DEFAULT_MINIMUM_PRIMARY_FALLBACK_SCORE_DELTA,
  TRANSCRIPTION_PROVIDER_SELECTION_DECISIONS,
  evaluateTranscriptionProviderSelection
};
