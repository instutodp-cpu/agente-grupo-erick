'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { findTranscriptionForbiddenFields, deepClone } = require('../src/core/transcription-contract');
const {
  TRANSCRIPTION_PROVIDER_CANDIDATE_SLUGS,
  buildProviderCandidateAuditEvent,
  normalizeProviderCandidate,
  validateProviderCandidate
} = require('../src/core/transcription-provider-candidate-contract');
const {
  TRANSCRIPTION_PROVIDER_CRITERIA,
  buildCriteriaSummary,
  validateProviderEvaluationCriteria
} = require('../src/core/transcription-provider-evaluation-criteria');
const { scoreTranscriptionProviderCandidate } = require('../src/core/transcription-provider-scoring');
const {
  buildCompatibilityMatrix,
  validateTranscriptionProviderCompatibilityMatrix
} = require('../src/core/transcription-provider-compatibility-matrix');
const { buildRiskRecord, summarizeProviderRisks, validateProviderRisk } = require('../src/core/transcription-provider-risk-register');
const { evaluateTranscriptionProviderSelection } = require('../src/core/transcription-provider-selection-policy');
const { buildTranscriptionProviderSelectionReport, PROHIBITED_STEPS } = require('../src/core/transcription-provider-selection-report');
const { createTranscriptionProviderEvaluationRegistry } = require('../src/core/transcription-provider-evaluation-registry');

const repoRoot = path.resolve(__dirname, '../../..');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-transcription-provider-selection-matrix.json');
const docPath = path.join(repoRoot, 'docs', 'TRANSCRIPTION_PROVIDER_SELECTION_MATRIX.md');
const now = '2026-07-19T00:00:00.000Z';
const expired = '2026-01-01T00:00:00.000Z';
const dataset = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function candidate(slug = 'openai', overrides = {}) {
  const found = dataset.candidates.find((item) => item.provider_slug === slug);
  return { ...deepClone(found), ...overrides };
}

function risk(overrides = {}) {
  return {
    risk_id: 'risk_fixture_privacy_low',
    provider_candidate_id: candidate().provider_candidate_id,
    category: 'privacy',
    severity: 'low',
    likelihood: 'unlikely',
    description: 'Synthetic documentary risk.',
    evidence: ['document_snapshot_fixture'],
    mitigation: 'Review during provider contract PR.',
    residual_risk: 'low_after_review',
    owner_role: 'security_reviewer',
    review_required: true,
    blocks_recommendation: false,
    simulated: true,
    ...overrides
  };
}

function matrix(overrides = {}) {
  return buildCompatibilityMatrix({
    candidates: dataset.candidates,
    criteria: TRANSCRIPTION_PROVIDER_CRITERIA,
    risks: dataset.risks,
    context: { now, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version, evaluation_expires_at: dataset.evaluation_expires_at },
    ...overrides
  });
}

function selection(overrides = {}) {
  const builtMatrix = overrides.matrix || matrix();
  return evaluateTranscriptionProviderSelection({
    criteria: TRANSCRIPTION_PROVIDER_CRITERIA,
    matrix: builtMatrix,
    evaluation_expires_at: dataset.evaluation_expires_at,
    minimum_score: 70,
    rollout_percentage: 0,
    production_blocked: true,
    ...overrides
  }, { now });
}

function assertNotRecommendedForInvalidCandidate(overrides, reason, expectedStatus = 'INELIGIBLE') {
  const built = matrix({ candidates: [candidate('openai', overrides)], risks: [] });
  const row = built.rows[0];
  assert.equal(row.compatibility_status, expectedStatus);
  assert.equal(row.candidate_contract_valid, false);
  assert.equal(row.scoring_valid, false);
  assertBlocks(row.candidate_validation_errors, reason);
  assertBlocks(row.blockers, reason);
  assert.notEqual(row.compatibility_status, 'RECOMMENDED_FOR_CONTRACT_REVIEW');
  assert.notEqual(row.compatibility_status, 'FALLBACK_CANDIDATE');
}

function assertSafe(result) {
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.production_blocked, true);
  if (Object.prototype.hasOwnProperty.call(result, 'provider_runtime_enabled')) assert.equal(result.provider_runtime_enabled, false);
  if (Object.prototype.hasOwnProperty.call(result, 'provider_selected_for_execution')) assert.equal(result.provider_selected_for_execution, false);
}

function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => error.includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

test('provider selection docs and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('fixture is synthetic static and contains all initial providers', () => {
  assertSafe(dataset);
  assert.deepEqual(dataset.candidates.map((item) => item.provider_slug).sort(), TRANSCRIPTION_PROVIDER_CANDIDATE_SLUGS);
  assert.equal(/https?:\/\//i.test(JSON.stringify(dataset)), false);
});

test('candidate contract accepts a valid documented candidate', () => {
  const validation = validateProviderCandidate(candidate('openai'), { now });
  assert.equal(validation.valid, true);
});

test('candidate audit event is sanitized and non-executable', () => {
  const event = buildProviderCandidateAuditEvent({ candidate: candidate('openai'), event_name: 'provider_candidate_registered', score: 90, occurred_at: now });
  assert.equal(event.event_name, 'provider_candidate_registered');
  assert.equal(event.provider_slug, 'openai');
  assertSafe(event);
});

test('candidate contract validates every fixture candidate structurally', () => {
  for (const item of dataset.candidates) assert.equal(validateProviderCandidate(item, { now }).valid, true, item.provider_slug);
});

test('candidate contract blocks missing fields', () => {
  const item = candidate();
  delete item.provider_candidate_id;
  assertBlocks(validateProviderCandidate(item, { now }).errors, 'missing_provider_candidate_id');
});

test('candidate contract blocks invalid versions', () => {
  assertBlocks(validateProviderCandidate(candidate('openai', { candidate_version: 0 }), { now }).errors, 'candidate_version_invalid');
  assertBlocks(validateProviderCandidate(candidate('openai', { evaluation_version: 0 }), { now }).errors, 'evaluation_version_invalid');
});

test('candidate contract blocks unknown provider slug', () => {
  assertBlocks(validateProviderCandidate(candidate('openai', { provider_slug: 'unknown_provider' }), { now }).errors, 'provider_slug_not_allowed::unknown_provider');
});

test('candidate contract blocks invalid boolean values', () => {
  assertBlocks(validateProviderCandidate(candidate('openai', { supports_pt_br: 'yes' }), { now }).errors, 'supports_pt_br_must_be_boolean');
});

test('candidate contract blocks duplicate or unsorted arrays', () => {
  assertBlocks(validateProviderCandidate(candidate('openai', { supported_languages: ['pt-BR', 'en-US', 'pt-BR'] }), { now }).errors, 'supported_languages_must_be_sorted_unique');
});

test('candidate normalization sorts and deduplicates arrays without mutating input', () => {
  const raw = candidate('openai', { supported_languages: ['pt-BR', 'en-US', 'pt-BR'] });
  const normalized = normalizeProviderCandidate(raw);
  assert.deepEqual(normalized.supported_languages, ['en-US', 'pt-BR']);
  assert.deepEqual(raw.supported_languages, ['pt-BR', 'en-US', 'pt-BR']);
});

test('candidate contract blocks expired evaluation', () => {
  assertBlocks(validateProviderCandidate(candidate('openai', { evaluation_expires_at: expired }), { now }).errors, 'evaluation_expired');
});

test('candidate contract blocks secrets tokens endpoints and unsafe urls', () => {
  assertBlocks(validateProviderCandidate(candidate('openai', { secret_value: 'never' }), { now }).errors, 'forbidden_field::secret_value');
  assertBlocks(validateProviderCandidate(candidate('openai', { token: 'never' }), { now }).errors, 'forbidden_field::token');
  assertBlocks(validateProviderCandidate(candidate('openai', { operational_endpoint: 'provider-runtime' }), { now }).errors, 'operational_endpoint_blocked');
  assertBlocks(validateProviderCandidate(candidate('openai', { source_references: ['https://example.invalid/path'] }), { now }).errors, 'unexpected_url::source_references[0]');
});

test('candidate contract blocks safety flag drift production and rollout', () => {
  assertBlocks(validateProviderCandidate(candidate('openai', { executed: true }), { now }).errors, 'executed_must_be_false');
  assertBlocks(validateProviderCandidate(candidate('openai', { provider_runtime_enabled: true }), { now }).errors, 'provider_runtime_enabled_must_be_false');
  assertBlocks(validateProviderCandidate(candidate('openai', { provider_selected_for_execution: true }), { now }).errors, 'provider_selected_for_execution_must_be_false');
  assertBlocks(validateProviderCandidate(candidate('openai', { production_blocked: false }), { now }).errors, 'production_blocked_must_be_true');
  assertBlocks(validateProviderCandidate(candidate('openai', { rollout_percentage: 1 }), { now }).errors, 'rollout_percentage_must_be_zero');
});

test('criteria weights sum to 100', () => {
  assert.equal(validateProviderEvaluationCriteria(TRANSCRIPTION_PROVIDER_CRITERIA).valid, true);
  assert.equal(buildCriteriaSummary().total_weight, 100);
});

test('criteria summary is non-executable and production blocked', () => {
  const summary = buildCriteriaSummary();
  assert.equal(summary.criteria_count, 10);
  assertSafe(summary);
});

test('criteria block weights below and above 100', () => {
  assertBlocks(validateProviderEvaluationCriteria(TRANSCRIPTION_PROVIDER_CRITERIA.map((item) => item.criterion_id === 'cost' ? { ...item, weight: 1 } : item)).errors, 'criteria_weight_total_invalid::91');
  assertBlocks(validateProviderEvaluationCriteria(TRANSCRIPTION_PROVIDER_CRITERIA.map((item) => item.criterion_id === 'cost' ? { ...item, weight: 20 } : item)).errors, 'criteria_weight_total_invalid::110');
});

test('criteria block negative weight duplicate criterion and missing mandatory requirement', () => {
  assertBlocks(validateProviderEvaluationCriteria(TRANSCRIPTION_PROVIDER_CRITERIA.map((item) => item.criterion_id === 'cost' ? { ...item, weight: -1 } : item)).errors, 'criterion_weight_negative::cost');
  assertBlocks(validateProviderEvaluationCriteria([TRANSCRIPTION_PROVIDER_CRITERIA[0], TRANSCRIPTION_PROVIDER_CRITERIA[0], ...TRANSCRIPTION_PROVIDER_CRITERIA.slice(1)]).errors, 'criterion_duplicate::quality_pt_br');
  assertBlocks(validateProviderEvaluationCriteria(TRANSCRIPTION_PROVIDER_CRITERIA.map((item) => item.criterion_id === 'quality_pt_br' ? { ...item, fields: ['supports_pt_br'] } : item)).errors, 'mandatory_requirement_missing::confidence_scores_supported');
});

test('criteria enforce that cost cannot compensate privacy and quality cannot compensate retention', () => {
  const lowPrivacy = scoreTranscriptionProviderCandidate(candidate('openai', { dpa_available: false, subprocessors_documented: false, estimated_cost_per_minute_minor: 0 }), TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  assert.equal(lowPrivacy.mandatory_pass, false);
  assertBlocks(lowPrivacy.mandatory_failures, 'mandatory::dpa_available');
  const lowRetention = scoreTranscriptionProviderCandidate(candidate('openai', { retention_policy_documented: false, supports_pt_br: true }), TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  assert.equal(lowRetention.mandatory_pass, false);
  assertBlocks(lowRetention.mandatory_failures, 'mandatory::retention_policy_documented');
});

test('scoring is deterministic and bounded', () => {
  const first = scoreTranscriptionProviderCandidate(candidate('openai'), TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  const second = scoreTranscriptionProviderCandidate(candidate('openai'), TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  assert.deepEqual(first, second);
  assert.ok(first.normalized_score >= 0 && first.normalized_score <= 100);
  assertSafe(first);
});

test('scoring blocks NaN Infinity and invalid candidate values', () => {
  assertBlocks(scoreTranscriptionProviderCandidate(candidate('openai', { estimated_cost_per_minute_minor: NaN }), TRANSCRIPTION_PROVIDER_CRITERIA, { now }).errors, 'estimated_cost_per_minute_minor_must_be_non_negative_integer');
  assertBlocks(scoreTranscriptionProviderCandidate(candidate('openai', { minimum_charge_minor: Infinity }), TRANSCRIPTION_PROVIDER_CRITERIA, { now }).errors, 'minimum_charge_minor_must_be_non_negative_integer');
});

test('scoring records missing evidence mandatory failures and penalties', () => {
  const missing = scoreTranscriptionProviderCandidate(candidate('openai', { data_processing_regions: ['unknown'], evidence_completeness: 'incomplete' }), TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  assertBlocks(missing.missing_evidence, 'candidate_evidence_incomplete');
  const failed = scoreTranscriptionProviderCandidate(candidate('openai', { supports_pt_br: false }), TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  assertBlocks(failed.mandatory_failures, 'mandatory::supports_pt_br');
  const penalized = scoreTranscriptionProviderCandidate(candidate('openai', { training_on_customer_data_default: true }), TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  assertBlocks(penalized.penalties, 'training_on_customer_data_default');
});

test('scoring does not mutate input and returns immutable result', () => {
  const input = candidate('openai');
  const before = JSON.stringify(input);
  const scored = scoreTranscriptionProviderCandidate(input, TRANSCRIPTION_PROVIDER_CRITERIA, { now });
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(scored), true);
});

test('compatibility matrix generates deterministic ranking and statuses', () => {
  const first = matrix();
  const second = matrix();
  assert.deepEqual(first, second);
  assert.equal(first.candidates_evaluated, 6);
  assert.ok(first.rows.some((row) => row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW'));
  assert.ok(first.rows.some((row) => row.compatibility_status === 'FALLBACK_CANDIDATE'));
  assertSafe(first);
});

test('compatibility matrix marks ineligible mandatory failures', () => {
  const built = matrix({ candidates: [candidate('openai', { supports_pt_br: false })], risks: [] });
  assert.equal(built.rows[0].compatibility_status, 'INELIGIBLE');
  assertBlocks(built.rows[0].blockers, 'mandatory::supports_pt_br');
});

test('compatibility matrix marks incomplete evidence', () => {
  const built = matrix({ candidates: [candidate('openai', { evidence_completeness: 'incomplete' })], risks: [] });
  assert.equal(built.rows[0].compatibility_status, 'INCOMPLETE');
  assertBlocks(built.rows[0].missing_evidence, 'candidate_evidence_incomplete');
});

test('compatibility matrix includes compatible document review rows', () => {
  assert.ok(matrix().rows.some((row) => row.compatibility_status === 'COMPATIBLE_FOR_DOCUMENT_REVIEW'));
});

test('compatibility matrix records blockers warnings risks and missing evidence', () => {
  const built = matrix();
  const assembly = built.rows.find((row) => row.provider_slug === 'assemblyai');
  assert.ok(assembly.blockers.length > 0);
  assert.ok(assembly.risks.length > 0);
  assert.ok(Array.isArray(assembly.warnings));
});

test('compatibility matrix never emits execution statuses', () => {
  const forbidden = ['READY_FOR_EXECUTION', 'READY_FOR_PROVIDER_CALL', 'READY_FOR_PRODUCTION', 'PRODUCTION_APPROVED', 'ENABLED', 'ACTIVE'];
  for (const row of matrix().rows) assert.equal(forbidden.includes(row.compatibility_status), false);
});

test('compatibility matrix propagates invalid candidate contract errors fail closed', () => {
  assertNotRecommendedForInvalidCandidate({ evaluation_expires_at: expired }, 'evaluation_expired');
  assertNotRecommendedForInvalidCandidate({ candidate_version: 0 }, 'candidate_version_invalid');
  assertNotRecommendedForInvalidCandidate({ evaluation_version: 0 }, 'evaluation_version_invalid');
  assertNotRecommendedForInvalidCandidate({ rollout_percentage: 1 }, 'rollout_percentage_must_be_zero');
  assertNotRecommendedForInvalidCandidate({ production_blocked: false }, 'production_blocked_must_be_true');
  assertNotRecommendedForInvalidCandidate({ provider_runtime_enabled: true }, 'provider_runtime_enabled_must_be_false');
  assertNotRecommendedForInvalidCandidate({ provider_selected_for_execution: true }, 'provider_selected_for_execution_must_be_false');
  assertNotRecommendedForInvalidCandidate({ external_network_called: true }, 'external_network_called_must_be_false');
  assertNotRecommendedForInvalidCandidate({ operational_endpoint: 'provider-runtime' }, 'operational_endpoint_blocked');
  assertNotRecommendedForInvalidCandidate({ supported_languages: ['pt-BR', 'en-US', 'pt-BR'] }, 'supported_languages_must_be_sorted_unique');
  assertNotRecommendedForInvalidCandidate({ source_references: ['https://example.invalid/document'] }, 'unexpected_url::source_references[0]');
});

test('compatibility matrix keeps draft incomplete and rejected candidates out of eligible ranking', () => {
  const draft = matrix({ candidates: [candidate('openai', { evaluation_status: 'draft', estimated_cost_per_minute_minor: 0 }), candidate('aws_transcribe')], risks: [] });
  const draftRow = draft.rows.find((row) => row.provider_slug === 'openai');
  assert.equal(draftRow.compatibility_status, 'INCOMPLETE');
  assert.equal(draft.rows.some((row) => row.provider_slug === 'openai' && ['RECOMMENDED_FOR_CONTRACT_REVIEW', 'FALLBACK_CANDIDATE'].includes(row.compatibility_status)), false);

  const incomplete = matrix({ candidates: [candidate('openai', { evaluation_status: 'incomplete' }), candidate('aws_transcribe')], risks: [] });
  assert.notEqual(incomplete.rows.find((row) => row.provider_slug === 'openai').compatibility_status, 'FALLBACK_CANDIDATE');

  const rejected = matrix({ candidates: [candidate('openai', { evaluation_status: 'rejected' }), candidate('aws_transcribe')], risks: [] });
  assert.equal(rejected.rows.find((row) => row.provider_slug === 'openai').compatibility_status, 'REJECTED');
  assert.notEqual(rejected.rows.find((row) => row.provider_slug === 'openai').compatibility_status, 'FALLBACK_CANDIDATE');

  const recommended = draft.rows.filter((row) => ['RECOMMENDED_FOR_CONTRACT_REVIEW', 'FALLBACK_CANDIDATE'].includes(row.compatibility_status));
  assert.ok(recommended.every((row) => row.candidate_contract_valid === true && row.scoring_valid === true && ['evaluable', 'recommended_for_contract_review'].includes(row.support_status)));
});

test('compatibility matrix validator blocks partial and forged snapshots', () => {
  assertBlocks(validateTranscriptionProviderCompatibilityMatrix({ rows: [] }, { now, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version }).errors, 'matrix_id_invalid');
  const forged = deepClone(matrix());
  forged.rows[0].normalized_score = 100;
  forged.rows[0].provider_slug = 'unknown_provider';
  forged.rows[0].compatibility_status = 'READY_FOR_EXECUTION';
  assertBlocks(validateTranscriptionProviderCompatibilityMatrix(forged, { now, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version }).errors, 'row_provider_slug_unknown::unknown_provider');
  assertBlocks(validateTranscriptionProviderCompatibilityMatrix(forged, { now, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version }).errors, 'row_compatibility_status_unknown::READY_FOR_EXECUTION');
});

test('risk register accepts low medium high and critical risk records', () => {
  for (const severity of ['low', 'medium', 'high', 'critical']) {
    const record = buildRiskRecord(risk({ severity, mitigation: severity === 'high' ? 'Mitigated in review.' : 'Documented mitigation.', blocks_recommendation: severity === 'critical' }));
    assert.equal(record.status, 'risk_registered');
    assert.ok(record.risk_score >= 1);
  }
});

test('risk register critical always blocks recommendation', () => {
  const record = buildRiskRecord(risk({ severity: 'critical', likelihood: 'likely', blocks_recommendation: false }));
  assert.equal(record.blocks_recommendation, true);
  assertBlocks(record.blocking_reasons, 'critical_risk_must_block');
});

test('risk register high without mitigation blocks recommendation', () => {
  const record = buildRiskRecord(risk({ severity: 'high', mitigation: '', blocks_recommendation: false }));
  assert.equal(record.blocks_recommendation, true);
  assertBlocks(record.blocking_reasons, 'high_risk_mitigation_required');
});

test('risk register marks incomplete evidence and blocks forbidden fields', () => {
  assertBlocks(validateProviderRisk(risk({ evidence: [] })).errors, 'risk_evidence_incomplete');
  assertBlocks(validateProviderRisk(risk({ token: 'never' })).errors, 'forbidden_field::token');
});

test('risk summary aggregates blockers and incomplete risks', () => {
  const summary = summarizeProviderRisks([risk({ risk_id: 'critical', severity: 'critical', blocks_recommendation: true }), risk({ risk_id: 'incomplete', evidence: [] })]);
  assertBlocks(summary.blockers, 'critical');
  assertBlocks(summary.incomplete, 'incomplete');
});

test('selection policy identifies primary and fallback only for contract review', () => {
  const selected = selection();
  assert.equal(selected.selection_decision, 'PRIMARY_AND_FALLBACK_IDENTIFIED');
  assert.ok(selected.recommended_primary_for_contract_review);
  assert.ok(selected.recommended_fallback_for_contract_review);
  assert.equal(selected.score_delta_satisfied, true);
  assert.equal(selected.provider_selected_for_execution, false);
  assertSafe(selected);
});

test('selection policy returns no provider eligible when all rows are ineligible', () => {
  const selected = selection({ matrix: matrix({ candidates: [candidate('openai', { supports_pt_br: false })], risks: [] }) });
  assert.equal(selected.selection_decision, 'NO_PROVIDER_ELIGIBLE');
});

test('selection policy returns evidence incomplete for incomplete rows or expired dataset', () => {
  assert.equal(selection({ matrix: matrix({ candidates: [candidate('assemblyai')], risks: [] }) }).selection_decision, 'EVIDENCE_INCOMPLETE');
  assert.equal(selection({ evaluation_expires_at: expired }).selection_decision, 'EVIDENCE_INCOMPLETE');
});

test('selection policy requires manual review for low score critical risk and bad rollout', () => {
  assert.equal(selection({ minimum_score: 101 }).selection_decision, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(selection({ matrix: matrix({ risks: [risk({ risk_id: 'risk_deepgram_critical', provider_candidate_id: candidate('deepgram').provider_candidate_id, severity: 'critical', blocks_recommendation: true })] }) }).selection_decision, 'MANUAL_REVIEW_REQUIRED');
  assertBlocks(selection({ rollout_percentage: 1 }).blockers, 'rollout_percentage_must_be_zero');
});

test('selection policy blocks partial and forged matrices before trusting recommendations', () => {
  assertBlocks(selection({ matrix: { rows: [{ provider_slug: 'openai', compatibility_status: 'RECOMMENDED_FOR_CONTRACT_REVIEW', normalized_score: 100 }] } }).blockers, 'matrix_id_invalid');
  const forged = deepClone(matrix());
  const primaryIndex = forged.rows.findIndex((row) => row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW');
  forged.rows[primaryIndex].candidate_contract_valid = false;
  forged.rows[primaryIndex].blockers = [];
  assert.equal(selection({ matrix: forged }).selection_decision, 'MANUAL_REVIEW_REQUIRED');
  assertBlocks(selection({ matrix: forged }).blockers, 'recommended_candidate_contract_invalid');
});

test('selection policy validates forged status provider scores duplicates versions and safety flags', () => {
  const unknownStatus = deepClone(matrix());
  unknownStatus.rows[0].compatibility_status = 'READY_FOR_EXECUTION';
  assertBlocks(selection({ matrix: unknownStatus }).blockers, 'row_compatibility_status_unknown::READY_FOR_EXECUTION');

  const unknownProvider = deepClone(matrix());
  unknownProvider.rows[0].provider_slug = 'unknown_provider';
  assertBlocks(selection({ matrix: unknownProvider }).blockers, 'row_provider_slug_unknown::unknown_provider');

  const badScore = deepClone(matrix());
  badScore.rows[0].normalized_score = NaN;
  assertBlocks(selection({ matrix: badScore }).blockers, 'normalized_score_not_finite');
  badScore.rows[0].normalized_score = Infinity;
  assertBlocks(selection({ matrix: badScore }).blockers, 'normalized_score_not_finite');

  const duplicate = deepClone(matrix());
  duplicate.rows[1].provider_slug = duplicate.rows[0].provider_slug;
  assertBlocks(selection({ matrix: duplicate }).blockers, 'duplicate_provider_slug');

  const versionMismatch = deepClone(matrix());
  versionMismatch.criteria_version = 'criteria_other';
  assertBlocks(selection({ matrix: versionMismatch, criteria_version: dataset.criteria_version }).blockers, 'matrix_criteria_version_mismatch');
  versionMismatch.criteria_version = dataset.criteria_version;
  versionMismatch.dataset_version = 'dataset_other';
  assertBlocks(selection({ matrix: versionMismatch, dataset_version: dataset.dataset_version }).blockers, 'matrix_dataset_version_mismatch');

  const unsafe = deepClone(matrix());
  unsafe.external_network_called = true;
  assertBlocks(selection({ matrix: unsafe }).blockers, 'matrix_external_network_called_must_be_false');
});

test('selection policy blocks duplicate recommendations and malformed primary fallback rows', () => {
  const twoPrimary = deepClone(matrix());
  const fallbackIndex = twoPrimary.rows.findIndex((row) => row.compatibility_status === 'FALLBACK_CANDIDATE');
  twoPrimary.rows[fallbackIndex].compatibility_status = 'RECOMMENDED_FOR_CONTRACT_REVIEW';
  assertBlocks(selection({ matrix: twoPrimary }).blockers, 'multiple_primary_recommendations');

  const fallbackOnly = deepClone(matrix());
  const primaryIndex = fallbackOnly.rows.findIndex((row) => row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW');
  fallbackOnly.rows[primaryIndex].compatibility_status = 'COMPATIBLE_FOR_DOCUMENT_REVIEW';
  assertBlocks(selection({ matrix: fallbackOnly }).blockers, 'fallback_without_primary');

  const mandatoryFailure = deepClone(matrix());
  const mandatoryPrimaryIndex = mandatoryFailure.rows.findIndex((row) => row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW');
  mandatoryFailure.rows[mandatoryPrimaryIndex].mandatory_requirements_failed = ['mandatory::supports_pt_br'];
  assertBlocks(selection({ matrix: mandatoryFailure }).blockers, 'recommended_mandatory_failures_present');

  const missingEvidence = deepClone(matrix());
  const missingPrimaryIndex = missingEvidence.rows.findIndex((row) => row.compatibility_status === 'RECOMMENDED_FOR_CONTRACT_REVIEW');
  missingEvidence.rows[missingPrimaryIndex].missing_evidence = ['candidate_evidence_incomplete'];
  assertBlocks(selection({ matrix: missingEvidence }).blockers, 'recommended_missing_evidence_present');
});

test('selection policy applies deterministic minimum primary fallback score delta', () => {
  assert.equal(selection({ minimum_primary_fallback_score_delta: 1 }).selection_decision, 'PRIMARY_AND_FALLBACK_IDENTIFIED');
  const insufficient = selection({ minimum_primary_fallback_score_delta: 2 });
  assert.equal(insufficient.selection_decision, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(insufficient.score_delta_satisfied, false);
  assertBlocks(insufficient.blockers, 'primary_fallback_score_delta_insufficient');

  const tied = selection({ matrix: matrix({ candidates: [candidate('deepgram'), candidate('google_cloud_speech', { idempotency_supported: true })], risks: [] }) });
  assert.equal(tied.selection_decision, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(tied.primary_fallback_score_delta, 0);

  for (const value of [-1, NaN, Infinity, 101]) {
    assertBlocks(selection({ minimum_primary_fallback_score_delta: value }).blockers, 'minimum_primary_fallback_score_delta_invalid');
  }
});

test('selection policy handles ties deterministically through matrix ranking', () => {
  const tied = matrix({ candidates: [candidate('deepgram'), candidate('openai')], risks: [] });
  assert.deepEqual(tied.rows.map((row) => row.provider_slug), tied.rows.map((row) => row.provider_slug).slice().sort((a, b) => tied.rows.find((row) => row.provider_slug === b).normalized_score - tied.rows.find((row) => row.provider_slug === a).normalized_score || a.localeCompare(b)));
});

test('selection policy never returns execution decisions', () => {
  const forbidden = ['PROVIDER_ENABLED', 'EXECUTION_ALLOWED', 'PRODUCTION_READY', 'READY_FOR_REAL_AUDIO', 'READY_FOR_NETWORK', 'PROVIDER_SELECTED_FOR_EXECUTION'];
  assert.equal(forbidden.includes(selection().selection_decision), false);
});

test('selection report has required structure and documentary primary fallback', () => {
  const selected = selection();
  const report = buildTranscriptionProviderSelectionReport({
    dataset_version: dataset.dataset_version,
    criteria_version: dataset.criteria_version,
    evaluation_expires_at: dataset.evaluation_expires_at,
    matrix: matrix(),
    selection: selected
  }, { now });
  assert.equal(report.selection_decision, selected.selection_decision);
  assert.equal(report.human_review_required, true);
  assert.ok(PROHIBITED_STEPS.every((step) => report.prohibited_steps.includes(step)));
  assertSafe(report);
});

test('selection report supports allowed next steps and blocks forbidden data', () => {
  assert.equal(buildTranscriptionProviderSelectionReport({ selection: selection(), matrix: matrix(), next_allowed_step: 'legal_review' }, { now }).next_allowed_step, 'legal_review');
  assertBlocks(buildTranscriptionProviderSelectionReport({ selection: selection(), matrix: matrix(), token: 'never' }, { now }).rationale, 'forbidden_field::token');
});

test('selection report preserves absence of provider runtime network and production', () => {
  const report = buildTranscriptionProviderSelectionReport({ selection: selection(), matrix: matrix() }, { now });
  assert.equal(report.safety_flags.provider_runtime_enabled, false);
  assert.equal(report.safety_flags.provider_selected_for_execution, false);
  assert.equal(report.safety_flags.external_network_called, false);
  assert.equal(report.safety_flags.production_blocked, true);
});

test('selection report defaults to no next step when no provider is eligible', () => {
  const ineligibleMatrix = matrix({ candidates: [candidate('openai', { supports_pt_br: false })], risks: [] });
  const selected = evaluateTranscriptionProviderSelection({ criteria: TRANSCRIPTION_PROVIDER_CRITERIA, matrix: ineligibleMatrix, evaluation_expires_at: dataset.evaluation_expires_at, rollout_percentage: 0, production_blocked: true }, { now });
  const report = buildTranscriptionProviderSelectionReport({ selection: selected, matrix: ineligibleMatrix }, { now });
  assert.equal(report.next_allowed_step, 'no_next_step');
});

test('evaluation registry stores private immutable evaluations', () => {
  const registry = createTranscriptionProviderEvaluationRegistry();
  const result = registry.registerEvaluation({
    evaluation_id: 'evaluation_openai_v1',
    provider_candidate_id: candidate().provider_candidate_id,
    candidate_version: 1,
    evaluation_version: 1,
    dataset_version: dataset.dataset_version,
    criteria_version: dataset.criteria_version,
    evaluation_expires_at: dataset.evaluation_expires_at,
    now,
    payload: { provider_slug: 'openai', score: 90 }
  });
  assert.equal(result.ok, true);
  const stored = registry.getEvaluation('evaluation_openai_v1');
  stored.provider_candidate_id = 'mutated';
  assert.equal(registry.getEvaluation('evaluation_openai_v1').provider_candidate_id, candidate().provider_candidate_id);
});

test('evaluation registry blocks duplicate and payload mismatch', () => {
  const registry = createTranscriptionProviderEvaluationRegistry();
  const record = { evaluation_id: 'evaluation_replay', provider_candidate_id: candidate().provider_candidate_id, candidate_version: 1, evaluation_version: 1, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version, evaluation_expires_at: dataset.evaluation_expires_at, now, payload: { provider_slug: 'openai' } };
  assert.equal(registry.registerEvaluation(record).ok, true);
  assertBlocks(registry.registerEvaluation(record).errors, 'evaluation_replay_duplicate');
  assertBlocks(registry.registerEvaluation({ ...record, payload: { provider_slug: 'deepgram' } }).errors, 'evaluation_replay_payload_mismatch');
});

test('evaluation registry blocks optimistic conflict version downgrade and expired dataset', () => {
  const registry = createTranscriptionProviderEvaluationRegistry();
  const base = { provider_candidate_id: candidate().provider_candidate_id, candidate_version: 2, evaluation_version: 2, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version, evaluation_expires_at: dataset.evaluation_expires_at, now, payload: { provider_slug: 'openai' } };
  assert.equal(registry.registerEvaluation({ ...base, evaluation_id: 'evaluation_v2' }).ok, true);
  assertBlocks(registry.registerEvaluation({ ...base, evaluation_id: 'evaluation_v1', evaluation_version: 1 }).errors, 'evaluation_version_downgrade');
  assertBlocks(registry.registerEvaluation({ ...base, evaluation_id: 'evaluation_conflict', candidate_version: 3 }).errors, 'optimistic_version_conflict');
  assertBlocks(registry.registerEvaluation({ ...base, evaluation_id: 'evaluation_expired', evaluation_version: 3, evaluation_expires_at: expired }).errors, 'dataset_expired');
});

test('evaluation registry blocks forbidden fields inside documentary payload', () => {
  const registry = createTranscriptionProviderEvaluationRegistry();
  const result = registry.registerEvaluation({ evaluation_id: 'evaluation_payload_forbidden', provider_candidate_id: candidate().provider_candidate_id, candidate_version: 1, evaluation_version: 1, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version, evaluation_expires_at: dataset.evaluation_expires_at, now, payload: { token: 'never' } });
  assertBlocks(result.errors, 'forbidden_field::token');
});

test('evaluation registry history is sanitized and defensive', () => {
  const registry = createTranscriptionProviderEvaluationRegistry();
  registry.registerEvaluation({ evaluation_id: 'evaluation_history', provider_candidate_id: candidate().provider_candidate_id, candidate_version: 1, evaluation_version: 1, dataset_version: dataset.dataset_version, criteria_version: dataset.criteria_version, evaluation_expires_at: dataset.evaluation_expires_at, now, payload: { provider_slug: 'openai' } });
  const history = registry.getHistory(candidate().provider_candidate_id);
  history[0].dataset_version = 'mutated';
  assert.equal(registry.getHistory(candidate().provider_candidate_id)[0].dataset_version, dataset.dataset_version);
});

test('regression keeps provider selection modules out of runtime message confirm endpoint scheduler worker surfaces', () => {
  const runtimeFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-provider-selection'), false);
    assert.equal(source.includes('transcription-provider-compatibility'), false);
  }
});

test('regression provider selection modules do not call network env filesystem timers or provider APIs', () => {
  const files = [
    'transcription-provider-candidate-contract.js',
    'transcription-provider-evaluation-criteria.js',
    'transcription-provider-scoring.js',
    'transcription-provider-compatibility-matrix.js',
    'transcription-provider-risk-register.js',
    'transcription-provider-selection-policy.js',
    'transcription-provider-selection-report.js',
    'transcription-provider-evaluation-registry.js'
  ].map((file) => path.join(repoRoot, 'services', 'api', 'src', 'core', file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes("require('node:http')"), false);
    assert.equal(source.includes("require('node:https')"), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('http.request'), false);
    assert.equal(source.includes('https.request'), false);
    assert.equal(source.includes('net.connect'), false);
    assert.equal(source.includes('tls.connect'), false);
    assert.equal(source.includes('dns.'), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('.summarize('), false);
  }
});

test('regression fixture and docs do not contain secrets endpoints uploads or runtime activation', () => {
  const combined = `${fs.readFileSync(fixturePath, 'utf8')}\n${fs.readFileSync(docPath, 'utf8')}`;
  assert.equal(/api[_ -]?key|secret[_ -]?value|access[_ -]?token|refresh[_ -]?token/i.test(combined), false);
  assert.equal(/https?:\/\//i.test(combined), false);
  assert.equal(/provider_selected_for_execution": true/.test(combined), false);
  assert.equal(findTranscriptionForbiddenFields(dataset).length, 0);
});
