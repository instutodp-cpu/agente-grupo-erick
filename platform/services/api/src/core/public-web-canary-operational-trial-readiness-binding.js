'use strict';

const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const {
  evaluatePublicWebCanaryOperationalTrialReadiness,
  PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS
} = require('./public-web-canary-operational-trial-readiness-boundary');

const SECTION_FIELDS = Object.freeze({
  configuration: Object.freeze(['present', 'valid', 'feature_flag_enabled', 'kill_switch_active']),
  trial: Object.freeze(['present', 'historical', 'synthetic', 'simulated', 'executed', 'real_provider_called', 'can_trigger_real_execution']),
  authorization: Object.freeze(['pr_c_authorized', 'real_execution_enabled']),
  capabilities: Object.freeze([
    'real_network_present',
    'real_provider_present',
    'real_secret_resolution_present',
    'database_write_present',
    'migration_present',
    'scheduler_worker_queue_real_present',
    'operational_runner_reachable',
    'runner_real_present',
    'external_side_effect_present'
  ])
});

const BINDING_SECTIONS = Object.freeze(Object.keys(SECTION_FIELDS));

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function readBoolean(section, field) {
  return isPlainObject(section) && typeof section[field] === 'boolean'
    ? section[field]
    : undefined;
}

function collectBindingReasons(input) {
  if (!isPlainObject(input)) return ['input_must_be_plain_object'];
  const reasons = [];
  for (const sectionName of BINDING_SECTIONS) {
    const section = input[sectionName];
    if (!isPlainObject(section)) {
      reasons.push(`missing_${sectionName}_evidence`);
      continue;
    }
    for (const field of SECTION_FIELDS[sectionName]) {
      if (typeof section[field] !== 'boolean') reasons.push(`strict_boolean_required::${sectionName}.${field}`);
    }
    for (const field of Object.keys(section)) {
      if (!SECTION_FIELDS[sectionName].includes(field)) reasons.push('unknown_evidence_field');
    }
  }
  for (const field of Object.keys(input)) {
    if (!BINDING_SECTIONS.includes(field)) reasons.push('unknown_binding_section');
  }
  return uniqueSorted(reasons);
}

function buildBoundaryInput(input) {
  const configuration = input.configuration;
  const trial = input.trial;
  const authorization = input.authorization;
  const capabilities = input.capabilities;
  const boundaryInput = {};
  const values = {
    pr_b_configuration_present: readBoolean(configuration, 'present'),
    operational_trial_historical: readBoolean(trial, 'historical'),
    operational_trial_synthetic: readBoolean(trial, 'synthetic'),
    pr_c_authorized: readBoolean(authorization, 'pr_c_authorized'),
    real_execution_enabled: readBoolean(authorization, 'real_execution_enabled'),
    real_network_present: readBoolean(capabilities, 'real_network_present'),
    real_provider_present: readBoolean(capabilities, 'real_provider_present'),
    real_secret_resolution_present: readBoolean(capabilities, 'real_secret_resolution_present'),
    database_write_present: readBoolean(capabilities, 'database_write_present'),
    migration_present: readBoolean(capabilities, 'migration_present'),
    scheduler_worker_queue_real_present: readBoolean(capabilities, 'scheduler_worker_queue_real_present'),
    operational_runner_reachable: readBoolean(capabilities, 'operational_runner_reachable')
      || readBoolean(capabilities, 'runner_real_present'),
    external_side_effect_present: readBoolean(capabilities, 'external_side_effect_present'),
    simulated: readBoolean(trial, 'simulated'),
    executed: readBoolean(trial, 'executed'),
    real_provider_called: readBoolean(trial, 'real_provider_called'),
    can_trigger_real_execution: readBoolean(trial, 'can_trigger_real_execution')
  };
  for (const [field, value] of Object.entries(values)) {
    if (typeof value === 'boolean') boundaryInput[field] = value;
  }
  return boundaryInput;
}

function collectSemanticReasons(input) {
  const reasons = [];
  const configuration = input.configuration;
  const trial = input.trial;
  if (isPlainObject(configuration)) {
    if (configuration.present !== true) reasons.push('pr_b_configuration_missing');
    if (configuration.valid !== true) reasons.push('pr_b_configuration_invalid');
    if (configuration.feature_flag_enabled !== false) reasons.push('feature_flag_must_remain_disabled');
    if (configuration.kill_switch_active !== true) reasons.push('kill_switch_must_remain_active');
  }
  if (isPlainObject(trial) && trial.present !== true) reasons.push('operational_trial_evidence_missing');
  return reasons;
}

function buildEvidenceSummary(input) {
  const configuration = input.configuration;
  const trial = input.trial;
  const authorization = input.authorization;
  const capabilities = input.capabilities;
  return Object.freeze({
    configuration_present: readBoolean(configuration, 'present') === true,
    configuration_valid: readBoolean(configuration, 'valid') === true,
    feature_flag_enabled: readBoolean(configuration, 'feature_flag_enabled') === true,
    kill_switch_active: readBoolean(configuration, 'kill_switch_active') === true,
    operational_trial_historical: readBoolean(trial, 'historical') === true,
    operational_trial_synthetic: readBoolean(trial, 'synthetic') === true,
    pr_c_authorized: readBoolean(authorization, 'pr_c_authorized') === true,
    real_execution_enabled: readBoolean(authorization, 'real_execution_enabled') === true,
    real_network_present: readBoolean(capabilities, 'real_network_present') === true,
    real_provider_present: readBoolean(capabilities, 'real_provider_present') === true,
    real_secret_resolution_present: readBoolean(capabilities, 'real_secret_resolution_present') === true,
    database_write_present: readBoolean(capabilities, 'database_write_present') === true,
    migration_present: readBoolean(capabilities, 'migration_present') === true,
    scheduler_worker_queue_real_present: readBoolean(capabilities, 'scheduler_worker_queue_real_present') === true,
    operational_runner_reachable: readBoolean(capabilities, 'operational_runner_reachable') === true
      || readBoolean(capabilities, 'runner_real_present') === true,
    external_side_effect_present: readBoolean(capabilities, 'external_side_effect_present') === true,
    simulated: readBoolean(trial, 'simulated') === true,
    executed: readBoolean(trial, 'executed') === true,
    real_provider_called: readBoolean(trial, 'real_provider_called') === true,
    can_trigger_real_execution: readBoolean(trial, 'can_trigger_real_execution') === true
  });
}

function evaluatePublicWebCanaryOperationalTrialReadinessBinding(input) {
  const structuralReasons = collectBindingReasons(input);
  const semanticReasons = isPlainObject(input) ? collectSemanticReasons(input) : [];
  const boundary = evaluatePublicWebCanaryOperationalTrialReadiness(
    isPlainObject(input) ? buildBoundaryInput(input) : input
  );
  const blockedReasons = uniqueSorted([
    ...structuralReasons,
    ...semanticReasons,
    ...boundary.blocked_reasons
  ]);
  const readyForReview = blockedReasons.length === 0;
  const evidence = buildEvidenceSummary(isPlainObject(input) ? input : {});
  return Object.freeze({
    status: readyForReview
      ? PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS.READY_FOR_REVIEW
      : PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS.NOT_READY,
    can_continue_to_review: readyForReview,
    can_trigger_real_execution: false,
    pr_c_authorized: false,
    blocked_reasons: blockedReasons,
    evidence_summary: evidence,
    evidence_fingerprint: computeCanonicalContentDigest({ blockedReasons, evidence })
  });
}

module.exports = {
  BINDING_SECTIONS,
  SECTION_FIELDS,
  evaluatePublicWebCanaryOperationalTrialReadinessBinding
};
