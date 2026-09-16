'use strict';

const { computeCanonicalContentDigest } = require('./canonical-content-digest');

const PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS = Object.freeze({
  NOT_READY: 'NOT_READY',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW'
});

const REQUIRED_BOOLEAN_FIELDS = Object.freeze([
  'pr_b_configuration_present',
  'operational_trial_historical',
  'operational_trial_synthetic',
  'pr_c_authorized',
  'real_execution_enabled',
  'real_network_present',
  'real_provider_present',
  'real_secret_resolution_present',
  'database_write_present',
  'migration_present',
  'scheduler_worker_queue_real_present',
  'operational_runner_reachable',
  'external_side_effect_present',
  'simulated',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution'
]);

const ALLOWED_INPUT_FIELDS = Object.freeze([...REQUIRED_BOOLEAN_FIELDS]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeReasons(reasons) {
  return [...new Set(reasons)].sort();
}

function normalizePublicWebCanaryOperationalTrialReadinessInput(input) {
  const blockedReasons = [];
  if (!isPlainObject(input)) {
    return { valid: false, normalized: null, blocked_reasons: ['input_must_be_plain_object'] };
  }

  if (Object.keys(input).some((field) => !ALLOWED_INPUT_FIELDS.includes(field))) {
    blockedReasons.push('unknown_input_field');
  }

  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      blockedReasons.push(`missing_required_field::${field}`);
    } else if (typeof input[field] !== 'boolean') {
      blockedReasons.push(`strict_boolean_required::${field}`);
    }
  }

  if (blockedReasons.length > 0) {
    return { valid: false, normalized: null, blocked_reasons: safeReasons(blockedReasons) };
  }

  const normalized = Object.freeze(Object.fromEntries(
    REQUIRED_BOOLEAN_FIELDS.map((field) => [field, input[field]])
  ));
  return { valid: true, normalized, blocked_reasons: [] };
}

function evaluatePublicWebCanaryOperationalTrialReadiness(input) {
  const normalizedResult = normalizePublicWebCanaryOperationalTrialReadinessInput(input);
  const blockedReasons = [...normalizedResult.blocked_reasons];
  const normalized = normalizedResult.normalized;

  if (normalized) {
    if (normalized.pr_b_configuration_present !== true) blockedReasons.push('pr_b_configuration_missing');
    if (normalized.operational_trial_historical !== true) blockedReasons.push('operational_trial_history_required');
    if (normalized.operational_trial_synthetic !== true) blockedReasons.push('operational_trial_synthetic_required');
    if (normalized.pr_c_authorized !== false) blockedReasons.push('pr_c_authorization_forbidden');
    if (normalized.real_execution_enabled !== false) blockedReasons.push('real_execution_forbidden');
    if (normalized.real_network_present !== false) blockedReasons.push('real_network_forbidden');
    if (normalized.real_provider_present !== false) blockedReasons.push('real_provider_forbidden');
    if (normalized.real_secret_resolution_present !== false) blockedReasons.push('real_secret_resolution_forbidden');
    if (normalized.database_write_present !== false) blockedReasons.push('database_write_forbidden');
    if (normalized.migration_present !== false) blockedReasons.push('migration_forbidden');
    if (normalized.scheduler_worker_queue_real_present !== false) blockedReasons.push('scheduler_worker_queue_forbidden');
    if (normalized.operational_runner_reachable !== false) blockedReasons.push('operational_runner_reachable');
    if (normalized.external_side_effect_present !== false) blockedReasons.push('external_side_effect_forbidden');
    if (normalized.simulated !== true) blockedReasons.push('synthetic_simulation_required');
    if (normalized.executed !== false) blockedReasons.push('executed_must_be_false');
    if (normalized.real_provider_called !== false) blockedReasons.push('real_provider_called_must_be_false');
    if (normalized.can_trigger_real_execution !== false) blockedReasons.push('real_execution_trigger_forbidden');
  }

  const reasons = safeReasons(blockedReasons);
  const readyForReview = reasons.length === 0;
  const evidence = Object.freeze({
    pr_b_configuration_present: normalized ? normalized.pr_b_configuration_present : false,
    operational_trial_historical: normalized ? normalized.operational_trial_historical : false,
    operational_trial_synthetic: normalized ? normalized.operational_trial_synthetic : false,
    real_execution_enabled: false,
    real_network_present: false,
    real_provider_present: false,
    real_secret_resolution_present: false,
    database_write_present: false,
    migration_present: false,
    scheduler_worker_queue_real_present: false,
    operational_runner_reachable: false,
    external_side_effect_present: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  });

  return Object.freeze({
    status: readyForReview
      ? PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS.READY_FOR_REVIEW
      : PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS.NOT_READY,
    ready_for_review: readyForReview,
    ready_for_real_execution: false,
    blocked_reasons: reasons,
    evidence,
    evidence_fingerprint: computeCanonicalContentDigest({ reasons, evidence })
  });
}

module.exports = {
  ALLOWED_INPUT_FIELDS,
  PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS,
  REQUIRED_BOOLEAN_FIELDS,
  evaluatePublicWebCanaryOperationalTrialReadiness,
  normalizePublicWebCanaryOperationalTrialReadinessInput
};
