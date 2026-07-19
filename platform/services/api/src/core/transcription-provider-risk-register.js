'use strict';

const { findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');

const RISK_CATEGORIES = Object.freeze([
  'privacy',
  'lgpd',
  'retention',
  'vendor_lock_in',
  'cost_volatility',
  'service_availability',
  'language_quality',
  'model_change',
  'data_residency',
  'subprocessors',
  'deletion_verifiability',
  'rate_limits',
  'support_dependency',
  'contractual_risk',
  'migration_complexity'
]);
const RISK_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const RISK_LIKELIHOODS = Object.freeze(['unlikely', 'possible', 'likely', 'almost_certain']);
const SCORE = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4, unlikely: 1, possible: 2, likely: 3, almost_certain: 4 });

function validateProviderRisk(risk) {
  const errors = [];
  if (!isPlainObject(risk)) return { valid: false, errors: ['risk_missing'] };
  for (const field of ['risk_id', 'provider_candidate_id', 'category', 'severity', 'likelihood', 'description', 'evidence', 'mitigation', 'residual_risk', 'owner_role', 'review_required', 'blocks_recommendation', 'simulated']) {
    if (!Object.prototype.hasOwnProperty.call(risk, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['risk_id', 'provider_candidate_id', 'category', 'severity', 'likelihood', 'description', 'owner_role']) {
    if (!isNonEmptyString(risk[field])) errors.push(`invalid_${field}`);
  }
  if (!RISK_CATEGORIES.includes(risk.category)) errors.push(`risk_category_not_allowed::${risk.category}`);
  if (!RISK_SEVERITIES.includes(risk.severity)) errors.push(`risk_severity_not_allowed::${risk.severity}`);
  if (!RISK_LIKELIHOODS.includes(risk.likelihood)) errors.push(`risk_likelihood_not_allowed::${risk.likelihood}`);
  if (!Array.isArray(risk.evidence) || risk.evidence.length === 0) errors.push('risk_evidence_incomplete');
  if (risk.severity === 'critical' && risk.blocks_recommendation !== true) errors.push('critical_risk_must_block');
  if (risk.severity === 'high' && !isNonEmptyString(risk.mitigation)) errors.push('high_risk_mitigation_required');
  if (typeof risk.review_required !== 'boolean') errors.push('review_required_must_be_boolean');
  if (typeof risk.blocks_recommendation !== 'boolean') errors.push('blocks_recommendation_must_be_boolean');
  if (risk.simulated !== true) errors.push('simulated_must_be_true');
  errors.push(...findTranscriptionForbiddenFields(risk));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRiskRecord(risk) {
  const validation = validateProviderRisk(risk);
  const riskScore = SCORE[risk && risk.severity] && SCORE[risk && risk.likelihood] ? SCORE[risk.severity] * SCORE[risk.likelihood] : 0;
  return Object.freeze(sanitizeTranscriptionData({
    ...(risk || {}),
    risk_score: riskScore,
    status: validation.valid ? 'risk_registered' : 'risk_incomplete',
    blocking_reasons: validation.errors,
    blocks_recommendation: risk && (risk.blocks_recommendation === true || risk.severity === 'critical' || risk.severity === 'high' && !isNonEmptyString(risk.mitigation)),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  }));
}

function summarizeProviderRisks(risks = []) {
  const records = risks.map(buildRiskRecord);
  return Object.freeze(sanitizeTranscriptionData({
    risks: records,
    blockers: uniqueSorted(records.filter((risk) => risk.blocks_recommendation === true).map((risk) => risk.risk_id)),
    incomplete: uniqueSorted(records.filter((risk) => risk.status === 'risk_incomplete').map((risk) => risk.risk_id)),
    critical_count: records.filter((risk) => risk.severity === 'critical').length,
    high_count: records.filter((risk) => risk.severity === 'high').length,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  }));
}

module.exports = {
  RISK_CATEGORIES,
  RISK_LIKELIHOODS,
  RISK_SEVERITIES,
  buildRiskRecord,
  summarizeProviderRisks,
  validateProviderRisk
};
