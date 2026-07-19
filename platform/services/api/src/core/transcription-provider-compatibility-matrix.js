'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const { scoreTranscriptionProviderCandidate } = require('./transcription-provider-scoring');
const { summarizeProviderRisks } = require('./transcription-provider-risk-register');

const TRANSCRIPTION_PROVIDER_COMPATIBILITY_STATUSES = Object.freeze([
  'INELIGIBLE',
  'INCOMPLETE',
  'COMPATIBLE_FOR_DOCUMENT_REVIEW',
  'RECOMMENDED_FOR_CONTRACT_REVIEW',
  'FALLBACK_CANDIDATE',
  'REJECTED'
]);

function statusFor(candidate, score, riskSummary) {
  if (candidate.evaluation_status === 'rejected') return 'REJECTED';
  if (score.mandatory_failures.length > 0 || riskSummary.blockers.length > 0) return 'INELIGIBLE';
  if (score.missing_evidence.length > 0 || candidate.evaluation_status === 'incomplete') return 'INCOMPLETE';
  return 'COMPATIBLE_FOR_DOCUMENT_REVIEW';
}

function buildCompatibilityMatrix({ candidates = [], criteria, risks = [], context = {} } = {}) {
  const rows = candidates.map((candidate) => {
    const providerRisks = risks.filter((risk) => risk.provider_candidate_id === candidate.provider_candidate_id);
    const riskSummary = summarizeProviderRisks(providerRisks);
    const score = scoreTranscriptionProviderCandidate(candidate, criteria, context);
    const compatibilityStatus = statusFor(candidate, score, riskSummary);
    return sanitizeTranscriptionData({
      provider_candidate_id: candidate.provider_candidate_id,
      provider_slug: candidate.provider_slug,
      support_status: candidate.evaluation_status,
      compatibility_status: compatibilityStatus,
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
      blockers: uniqueSorted([...score.mandatory_failures, ...riskSummary.blockers]),
      warnings: uniqueSorted([...score.penalties, ...riskSummary.incomplete]),
      risks: riskSummary.risks.map((risk) => ({ risk_id: risk.risk_id, severity: risk.severity, blocks_recommendation: risk.blocks_recommendation })),
      recommendation_status: compatibilityStatus,
      ranking_tiebreakers: ['normalized_score_desc', 'privacy_score_desc', 'provider_slug_asc'],
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true,
      provider_runtime_enabled: false,
      provider_selected_for_execution: false
    });
  });
  const ranked = rows.slice().sort((a, b) =>
    b.normalized_score - a.normalized_score ||
    b.privacy_score - a.privacy_score ||
    a.provider_slug.localeCompare(b.provider_slug)
  );
  let assigned = 0;
  for (const row of ranked) {
    if (row.compatibility_status === 'COMPATIBLE_FOR_DOCUMENT_REVIEW') {
      assigned += 1;
      row.compatibility_status = assigned === 1 ? 'RECOMMENDED_FOR_CONTRACT_REVIEW' : assigned === 2 ? 'FALLBACK_CANDIDATE' : 'COMPATIBLE_FOR_DOCUMENT_REVIEW';
      row.recommendation_status = row.compatibility_status;
    }
  }
  return Object.freeze(sanitizeTranscriptionData({
    matrix_status: 'transcription_provider_compatibility_matrix_generated',
    compatibility_statuses: TRANSCRIPTION_PROVIDER_COMPATIBILITY_STATUSES,
    candidates_evaluated: ranked.length,
    rows: ranked,
    ranking_tiebreakers: ['normalized_score_desc', 'privacy_score_desc', 'provider_slug_asc'],
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
  TRANSCRIPTION_PROVIDER_COMPATIBILITY_STATUSES,
  buildCompatibilityMatrix
};
