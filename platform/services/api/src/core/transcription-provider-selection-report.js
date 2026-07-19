'use strict';

const { findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const { TRANSCRIPTION_PROVIDER_SELECTION_DECISIONS } = require('./transcription-provider-selection-policy');

const NEXT_ALLOWED_STEPS = Object.freeze([
  'collect_missing_evidence',
  'legal_review',
  'security_review',
  'cost_review',
  'provider_contract_pr',
  'no_next_step'
]);

const PROHIBITED_STEPS = Object.freeze([
  'enable_provider',
  'add_real_secret',
  'call_provider',
  'accept_real_audio',
  'enable_network',
  'enable_production',
  'increase_rollout',
  'integrate_runtime'
]);

function nextStepFor(selection) {
  if (!selection || selection.selection_decision === 'NO_PROVIDER_ELIGIBLE') return 'no_next_step';
  if (selection.selection_decision === 'EVIDENCE_INCOMPLETE') return 'collect_missing_evidence';
  if (selection.selection_decision === 'MANUAL_REVIEW_REQUIRED') return 'security_review';
  return 'provider_contract_pr';
}

function buildTranscriptionProviderSelectionReport(input = {}, context = {}) {
  const matrix = input.matrix || {};
  const selection = input.selection || {};
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const forbidden = findTranscriptionForbiddenFields(input);
  const nextAllowedStep = NEXT_ALLOWED_STEPS.includes(input.next_allowed_step) ? input.next_allowed_step : nextStepFor(selection);
  return Object.freeze(sanitizeTranscriptionData({
    report_id: input.report_id || 'report_transcription_provider_selection_matrix_v1',
    report_version: input.report_version || 1,
    dataset_version: input.dataset_version || 'dataset_not_available',
    criteria_version: input.criteria_version || 'criteria_not_available',
    generated_at: context.now || input.generated_at || new Date(0).toISOString(),
    evaluation_expires_at: input.evaluation_expires_at || 'evaluation_not_available',
    candidates_evaluated: rows.length,
    eligible_candidates: rows.filter((row) => ['RECOMMENDED_FOR_CONTRACT_REVIEW', 'FALLBACK_CANDIDATE', 'COMPATIBLE_FOR_DOCUMENT_REVIEW'].includes(row.compatibility_status)).map((row) => row.provider_slug),
    ineligible_candidates: rows.filter((row) => ['INELIGIBLE', 'REJECTED'].includes(row.compatibility_status)).map((row) => row.provider_slug),
    incomplete_candidates: rows.filter((row) => row.compatibility_status === 'INCOMPLETE').map((row) => row.provider_slug),
    recommended_primary_for_contract_review: selection.recommended_primary_for_contract_review || null,
    recommended_fallback_for_contract_review: selection.recommended_fallback_for_contract_review || null,
    selection_decision: TRANSCRIPTION_PROVIDER_SELECTION_DECISIONS.includes(selection.selection_decision) ? selection.selection_decision : 'MANUAL_REVIEW_REQUIRED',
    mandatory_failures: uniqueSorted(rows.flatMap((row) => row.mandatory_requirements_failed || [])),
    missing_evidence: uniqueSorted(rows.flatMap((row) => row.missing_evidence || [])),
    risk_summary: rows.map((row) => ({ provider_slug: row.provider_slug, risks: row.risks || [] })),
    cost_summary: rows.map((row) => ({ provider_slug: row.provider_slug, cost_score: row.cost_score })),
    quality_summary: rows.map((row) => ({ provider_slug: row.provider_slug, quality_score: row.quality_score })),
    privacy_summary: rows.map((row) => ({ provider_slug: row.provider_slug, privacy_score: row.privacy_score })),
    rationale: uniqueSorted(['documentary_recommendation_only', ...(selection.blockers || []), ...forbidden]),
    human_review_required: true,
    next_allowed_step: nextAllowedStep,
    prohibited_steps: PROHIBITED_STEPS,
    safety_flags: {
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      rollout_percentage: 0,
      production_blocked: true,
      provider_runtime_enabled: false,
      provider_selected_for_execution: false
    },
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
  NEXT_ALLOWED_STEPS,
  PROHIBITED_STEPS,
  buildTranscriptionProviderSelectionReport
};
