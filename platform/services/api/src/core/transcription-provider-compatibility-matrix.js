'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  TRANSCRIPTION_PROVIDER_CANDIDATE_SLUGS
} = require('./transcription-provider-candidate-contract');
const {
  TRANSCRIPTION_PROVIDER_CRITERIA_VERSION
} = require('./transcription-provider-evaluation-criteria');
const {
  TRANSCRIPTION_PROVIDER_SCORING_VERSION,
  scoreTranscriptionProviderCandidate
} = require('./transcription-provider-scoring');
const { summarizeProviderRisks } = require('./transcription-provider-risk-register');

const TRANSCRIPTION_PROVIDER_MATRIX_VERSION = 1;
const TRANSCRIPTION_PROVIDER_MATRIX_ID = 'matrix_transcription_provider_selection_v1';
const TRANSCRIPTION_PROVIDER_MATRIX_TIEBREAKERS = Object.freeze([
  'normalized_score_desc',
  'privacy_score_desc',
  'provider_slug_asc'
]);

const TRANSCRIPTION_PROVIDER_COMPATIBILITY_STATUSES = Object.freeze([
  'INELIGIBLE',
  'INCOMPLETE',
  'COMPATIBLE_FOR_DOCUMENT_REVIEW',
  'RECOMMENDED_FOR_CONTRACT_REVIEW',
  'FALLBACK_CANDIDATE',
  'REJECTED'
]);

const RANKING_ELIGIBLE_EVALUATION_STATUSES = Object.freeze([
  'evaluable',
  'recommended_for_contract_review'
]);

const INCOMPLETE_VALIDATION_ERRORS = Object.freeze([
  'candidate_evidence_incomplete',
  'missing_evidence'
]);

function nowIso(context = {}) {
  if (typeof context.clock === 'function') return context.clock();
  return context.now || new Date(0).toISOString();
}

function isIso(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isExpired(expiresAt, context = {}) {
  if (!isIso(expiresAt)) return true;
  const now = Date.parse(nowIso(context));
  return Number.isNaN(now) || Date.parse(expiresAt) <= now;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deterministicDigest(value) {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function matrixFingerprintPayload(matrix) {
  return {
    matrix_id: matrix.matrix_id,
    matrix_version: matrix.matrix_version,
    dataset_version: matrix.dataset_version,
    criteria_version: matrix.criteria_version,
    scoring_version: matrix.scoring_version,
    generated_at: matrix.generated_at,
    evaluation_expires_at: matrix.evaluation_expires_at,
    candidate_count: matrix.candidate_count,
    candidate_ids: matrix.candidate_ids,
    ranking_tiebreakers: matrix.ranking_tiebreakers,
    rows: matrix.rows,
    simulated: matrix.simulated,
    executed: matrix.executed,
    real_provider_called: matrix.real_provider_called,
    external_network_called: matrix.external_network_called,
    can_trigger_real_execution: matrix.can_trigger_real_execution,
    production_blocked: matrix.production_blocked,
    provider_runtime_enabled: matrix.provider_runtime_enabled,
    provider_selected_for_execution: matrix.provider_selected_for_execution,
    rollout_percentage: matrix.rollout_percentage
  };
}

function validationErrorsAreOnlyIncomplete(errors = []) {
  return errors.length > 0 && errors.every((error) =>
    INCOMPLETE_VALIDATION_ERRORS.some((prefix) => String(error).includes(prefix))
  );
}

function statusFor(candidate, score, riskSummary) {
  if (candidate.evaluation_status === 'rejected') return 'REJECTED';
  if (candidate.evaluation_status === 'draft' || candidate.evaluation_status === 'incomplete') return 'INCOMPLETE';
  if (score.valid !== true) return validationErrorsAreOnlyIncomplete(score.errors) ? 'INCOMPLETE' : 'INELIGIBLE';
  if (!RANKING_ELIGIBLE_EVALUATION_STATUSES.includes(candidate.evaluation_status)) return 'INCOMPLETE';
  if (score.mandatory_failures.length > 0 || riskSummary.blockers.length > 0) return 'INELIGIBLE';
  if (score.missing_evidence.length > 0) return 'INCOMPLETE';
  return 'COMPATIBLE_FOR_DOCUMENT_REVIEW';
}

function recommendationStatus(compatibilityStatus, validationErrors) {
  if (!validationErrors.length) return compatibilityStatus;
  return `${compatibilityStatus}::${validationErrors.join('|')}`;
}

function canParticipateInRanking(row) {
  return row.compatibility_status === 'COMPATIBLE_FOR_DOCUMENT_REVIEW' &&
    row.candidate_contract_valid === true &&
    row.scoring_valid === true &&
    row.mandatory_requirements_passed === true &&
    row.blockers.length === 0 &&
    row.missing_evidence.length === 0 &&
    RANKING_ELIGIBLE_EVALUATION_STATUSES.includes(row.support_status);
}

function buildCompatibilityMatrix({ candidates = [], criteria, risks = [], context = {} } = {}) {
  const rows = candidates.map((candidate) => {
    const providerRisks = risks.filter((risk) => risk.provider_candidate_id === candidate.provider_candidate_id);
    const riskSummary = summarizeProviderRisks(providerRisks);
    const score = scoreTranscriptionProviderCandidate(candidate, criteria, context);
    const compatibilityStatus = statusFor(candidate, score, riskSummary);
    const validationErrors = uniqueSorted(score.errors || []);
    const blockers = uniqueSorted([
      ...validationErrors,
      ...score.mandatory_failures,
      ...riskSummary.blockers
    ]);
    return sanitizeTranscriptionData({
      provider_candidate_id: candidate.provider_candidate_id,
      provider_slug: candidate.provider_slug,
      support_status: candidate.evaluation_status,
      compatibility_status: compatibilityStatus,
      candidate_contract_valid: score.valid === true,
      candidate_validation_errors: validationErrors,
      scoring_valid: score.valid === true,
      validation_errors: validationErrors,
      mandatory_requirements_passed: score.mandatory_failures.length === 0,
      mandatory_requirements_failed: score.mandatory_failures,
      missing_evidence: score.missing_evidence,
      weighted_score: score.weighted_score,
      normalized_score: score.normalized_score,
      quality_score: score.category_scores.quality_language || 0,
      privacy_score: score.category_scores.privacy_lgpd || 0,
      security_score: score.category_scores.security || 0,
      retention_score: score.category_scores.retention_deletion || 0,
      cost_score: score.category_scores.cost || 0,
      reliability_score: score.category_scores.reliability || 0,
      technical_score: score.category_scores.technical_compatibility || 0,
      operational_score: score.category_scores.operation_observability || 0,
      governance_score: score.category_scores.governance || 0,
      portability_score: score.category_scores.fallback_portability || 0,
      blockers,
      warnings: uniqueSorted([...score.penalties, ...riskSummary.incomplete]),
      risks: riskSummary.risks.map((risk) => ({ risk_id: risk.risk_id, severity: risk.severity, blocks_recommendation: risk.blocks_recommendation })),
      recommendation_status: recommendationStatus(compatibilityStatus, validationErrors),
      ranking_tiebreakers: [...TRANSCRIPTION_PROVIDER_MATRIX_TIEBREAKERS],
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true,
      provider_runtime_enabled: false,
      provider_selected_for_execution: false,
      rollout_percentage: 0
    });
  });
  const ranked = rows.slice().sort((a, b) =>
    b.normalized_score - a.normalized_score ||
    b.privacy_score - a.privacy_score ||
    a.provider_slug.localeCompare(b.provider_slug)
  );
  let assigned = 0;
  for (const row of ranked) {
    if (canParticipateInRanking(row)) {
      assigned += 1;
      row.compatibility_status = assigned === 1 ? 'RECOMMENDED_FOR_CONTRACT_REVIEW' : assigned === 2 ? 'FALLBACK_CANDIDATE' : 'COMPATIBLE_FOR_DOCUMENT_REVIEW';
      row.recommendation_status = row.compatibility_status;
    }
  }
  const rawMatrix = {
    matrix_id: TRANSCRIPTION_PROVIDER_MATRIX_ID,
    matrix_version: TRANSCRIPTION_PROVIDER_MATRIX_VERSION,
    dataset_version: context.dataset_version || 'dataset_version_not_declared',
    criteria_version: context.criteria_version || TRANSCRIPTION_PROVIDER_CRITERIA_VERSION,
    scoring_version: TRANSCRIPTION_PROVIDER_SCORING_VERSION,
    generated_at: context.generated_at || nowIso(context),
    evaluation_expires_at: context.evaluation_expires_at || 'evaluation_expires_at_not_declared',
    matrix_status: 'transcription_provider_compatibility_matrix_generated',
    compatibility_statuses: TRANSCRIPTION_PROVIDER_COMPATIBILITY_STATUSES,
    candidates_evaluated: ranked.length,
    candidate_count: ranked.length,
    candidate_ids: ranked.map((row) => row.provider_candidate_id),
    rows: ranked,
    ranking_tiebreakers: [...TRANSCRIPTION_PROVIDER_MATRIX_TIEBREAKERS],
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    provider_runtime_enabled: false,
    provider_selected_for_execution: false,
    rollout_percentage: 0
  };
  rawMatrix.deterministic_digest = deterministicDigest(matrixFingerprintPayload(rawMatrix));
  return Object.freeze(sanitizeTranscriptionData(rawMatrix));
}

function validateScore(row, field, errors) {
  if (!Number.isFinite(row[field])) errors.push(`${field}_not_finite`);
  else if (row[field] < 0 || row[field] > 100) errors.push(`${field}_out_of_bounds`);
}

function validateSafetyFlags(subject, prefix, errors) {
  if (subject.simulated !== true) errors.push(`${prefix}_simulated_must_be_true`);
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution', 'provider_runtime_enabled', 'provider_selected_for_execution']) {
    if (subject[field] !== false) errors.push(`${prefix}_${field}_must_be_false`);
  }
  if (subject.production_blocked !== true) errors.push(`${prefix}_production_blocked_must_be_true`);
  if (subject.rollout_percentage !== 0) errors.push(`${prefix}_rollout_percentage_must_be_zero`);
}

function validateRecommendedRow(row, errors) {
  if (row.candidate_contract_valid !== true) errors.push(`recommended_candidate_contract_invalid::${row.provider_slug}`);
  if (row.scoring_valid !== true) errors.push(`recommended_scoring_invalid::${row.provider_slug}`);
  if (row.mandatory_requirements_passed !== true) errors.push(`recommended_mandatory_not_passed::${row.provider_slug}`);
  if (Array.isArray(row.mandatory_requirements_failed) && row.mandatory_requirements_failed.length > 0) errors.push(`recommended_mandatory_failures_present::${row.provider_slug}`);
  if (Array.isArray(row.missing_evidence) && row.missing_evidence.length > 0) errors.push(`recommended_missing_evidence_present::${row.provider_slug}`);
  if (Array.isArray(row.blockers) && row.blockers.length > 0) errors.push(`recommended_blockers_present::${row.provider_slug}`);
}

function validateTranscriptionProviderCompatibilityMatrix(matrix, context = {}) {
  const errors = [];
  if (!isPlainObject(matrix)) return { valid: false, errors: ['matrix_invalid'] };
  if (!isNonEmptyString(matrix.matrix_id)) errors.push('matrix_id_invalid');
  if (!Number.isInteger(matrix.matrix_version) || matrix.matrix_version < 1) errors.push('matrix_version_invalid');
  if (!isNonEmptyString(matrix.dataset_version)) errors.push('matrix_dataset_version_invalid');
  if (!isNonEmptyString(matrix.criteria_version)) errors.push('matrix_criteria_version_invalid');
  if (!isNonEmptyString(matrix.scoring_version)) errors.push('matrix_scoring_version_invalid');
  if (!isIso(matrix.generated_at)) errors.push('matrix_generated_at_invalid');
  if (!isIso(matrix.evaluation_expires_at)) errors.push('matrix_evaluation_expires_at_invalid');
  if (isExpired(matrix.evaluation_expires_at, context)) errors.push('matrix_expired');
  if (context.dataset_version && matrix.dataset_version !== context.dataset_version) errors.push('matrix_dataset_version_mismatch');
  if (context.criteria_version && matrix.criteria_version !== context.criteria_version) errors.push('matrix_criteria_version_mismatch');
  if (!Array.isArray(matrix.rows)) errors.push('matrix_rows_invalid');
  if (!Array.isArray(matrix.candidate_ids)) errors.push('matrix_candidate_ids_invalid');
  if (!Array.isArray(matrix.ranking_tiebreakers) || matrix.ranking_tiebreakers.join('|') !== TRANSCRIPTION_PROVIDER_MATRIX_TIEBREAKERS.join('|')) errors.push('matrix_ranking_tiebreakers_invalid');
  if (!Number.isInteger(matrix.candidate_count) || matrix.candidate_count < 0) errors.push('matrix_candidate_count_invalid');
  if (!Number.isInteger(matrix.candidates_evaluated) || matrix.candidates_evaluated < 0) errors.push('matrix_candidates_evaluated_invalid');
  validateSafetyFlags(matrix, 'matrix', errors);

  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  if (rows.length === 0) errors.push('matrix_rows_empty');
  if (Number.isInteger(matrix.candidate_count) && matrix.candidate_count !== rows.length) errors.push('matrix_candidate_count_mismatch');
  if (Number.isInteger(matrix.candidates_evaluated) && matrix.candidates_evaluated !== rows.length) errors.push('matrix_candidates_evaluated_mismatch');
  if (Array.isArray(matrix.candidate_ids) && matrix.candidate_ids.length !== rows.length) errors.push('matrix_candidate_ids_mismatch');

  const candidateIds = new Set();
  const providerSlugs = new Set();
  let primaryCount = 0;
  let fallbackCount = 0;
  for (const row of rows) {
    if (!isPlainObject(row)) {
      errors.push('matrix_row_invalid');
      continue;
    }
    if (!isNonEmptyString(row.provider_candidate_id)) errors.push('row_provider_candidate_id_invalid');
    if (candidateIds.has(row.provider_candidate_id)) errors.push(`duplicate_provider_candidate_id::${row.provider_candidate_id}`);
    candidateIds.add(row.provider_candidate_id);
    if (!TRANSCRIPTION_PROVIDER_CANDIDATE_SLUGS.includes(row.provider_slug)) errors.push(`row_provider_slug_unknown::${row.provider_slug}`);
    if (providerSlugs.has(row.provider_slug)) errors.push(`duplicate_provider_slug::${row.provider_slug}`);
    providerSlugs.add(row.provider_slug);
    if (!TRANSCRIPTION_PROVIDER_COMPATIBILITY_STATUSES.includes(row.compatibility_status)) errors.push(`row_compatibility_status_unknown::${row.compatibility_status}`);
    if (!Array.isArray(row.mandatory_requirements_failed)) errors.push(`row_mandatory_requirements_failed_invalid::${row.provider_slug}`);
    if (!Array.isArray(row.missing_evidence)) errors.push(`row_missing_evidence_invalid::${row.provider_slug}`);
    if (!Array.isArray(row.blockers)) errors.push(`row_blockers_invalid::${row.provider_slug}`);
    if (!Array.isArray(row.validation_errors)) errors.push(`row_validation_errors_invalid::${row.provider_slug}`);
    if (!Array.isArray(row.candidate_validation_errors)) errors.push(`row_candidate_validation_errors_invalid::${row.provider_slug}`);
    if (typeof row.candidate_contract_valid !== 'boolean') errors.push(`row_candidate_contract_valid_invalid::${row.provider_slug}`);
    if (typeof row.scoring_valid !== 'boolean') errors.push(`row_scoring_valid_invalid::${row.provider_slug}`);
    if (typeof row.mandatory_requirements_passed !== 'boolean') errors.push(`row_mandatory_requirements_passed_invalid::${row.provider_slug}`);
    for (const field of ['weighted_score', 'normalized_score', 'quality_score', 'privacy_score', 'security_score', 'retention_score', 'cost_score', 'reliability_score', 'technical_score', 'operational_score', 'governance_score', 'portability_score']) {
      validateScore(row, field, errors);
    }
    validateSafetyFlags(row, `row_${row.provider_slug || 'provider'}`, errors);
    if (row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW') {
      primaryCount += 1;
      validateRecommendedRow(row, errors);
    }
    if (row.compatibility_status === 'FALLBACK_CANDIDATE') {
      fallbackCount += 1;
      validateRecommendedRow(row, errors);
    }
  }
  if (primaryCount > 1) errors.push('multiple_primary_recommendations');
  if (fallbackCount > 1) errors.push('multiple_fallback_recommendations');
  if (fallbackCount > 0 && primaryCount === 0) errors.push('fallback_without_primary');
  if (Array.isArray(matrix.candidate_ids)) {
    const rowIds = rows.map((row) => row.provider_candidate_id);
    if (stableStringify(matrix.candidate_ids) !== stableStringify(rowIds)) errors.push('matrix_candidate_ids_do_not_match_rows');
  }
  if (!isNonEmptyString(matrix.deterministic_digest)) {
    errors.push('matrix_deterministic_digest_missing');
  } else if (deterministicDigest(matrixFingerprintPayload(matrix)) !== matrix.deterministic_digest) {
    errors.push('matrix_deterministic_digest_mismatch');
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  TRANSCRIPTION_PROVIDER_COMPATIBILITY_STATUSES,
  TRANSCRIPTION_PROVIDER_MATRIX_ID,
  TRANSCRIPTION_PROVIDER_MATRIX_TIEBREAKERS,
  TRANSCRIPTION_PROVIDER_MATRIX_VERSION,
  buildCompatibilityMatrix,
  deterministicDigest,
  validateTranscriptionProviderCompatibilityMatrix
};
