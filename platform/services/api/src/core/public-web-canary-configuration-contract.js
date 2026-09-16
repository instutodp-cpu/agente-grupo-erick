'use strict';

const {
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');
const { validateTrialConfiguration } = require('./public-web-canary-trial-contract');

const FEATURE_FLAG_KEY = 'HERMES_PUBLIC_WEB_READ_ONLY_ENABLED';
const KILL_SWITCH_KEY = 'HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH';
const DEFAULT_FEATURE_FLAG_ENABLED = false;
const DEFAULT_KILL_SWITCH_ACTIVE = true;

const CONFIGURATION_SOURCES = Object.freeze([
  'explicit_non_production_document',
  'synthetic_test_context'
]);

const CONTROL_FIELDS = Object.freeze([
  FEATURE_FLAG_KEY,
  KILL_SWITCH_KEY
]);

const REQUIRED_TRIAL_CONFIGURATION_FIELDS = Object.freeze([
  'trial_id',
  'environment',
  'target_policy_id',
  'target_origin',
  'target_path',
  'source_type',
  'operation',
  'requested_content_types',
  'maximum_requests',
  'rollout_percentage',
  'timeout_ms',
  'maximum_response_bytes',
  'workspace_type',
  'tenant_id',
  'user_id',
  'operator_id',
  'operator_role',
  'approver_id',
  'approver_role',
  'reason'
]);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function validateControlFields(input) {
  const errors = [];
  for (const field of Object.keys(input)) {
    if (field.startsWith('HERMES_PUBLIC_WEB_READ_ONLY_') && !CONTROL_FIELDS.includes(field)) {
      errors.push(`unknown_control::${field}`);
    }
  }
  for (const field of CONTROL_FIELDS) {
    if (hasOwn(input, field) && typeof input[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  return uniqueSorted(errors);
}

function stripControlFields(config) {
  const copy = { ...config };
  for (const field of CONTROL_FIELDS) delete copy[field];
  return copy;
}

function normalizePublicWebCanaryControls(input = {}, context = {}) {
  if (!isPlainObject(input)) return { valid: false, errors: ['configuration_must_be_object'] };
  if (!isPlainObject(context)) return { valid: false, errors: ['configuration_context_must_be_object'] };
  const source = hasOwn(context, 'source')
    ? context.source
    : 'explicit_non_production_document';
  const syntheticTestContext = context.syntheticTestContext === true;
  const errors = validateControlFields(input);

  if (!CONFIGURATION_SOURCES.includes(source)) errors.push('unknown_configuration_source');
  if (source === 'synthetic_test_context' && !syntheticTestContext) errors.push('synthetic_context_not_authorized');

  const featureFlagEnabled = hasOwn(input, FEATURE_FLAG_KEY)
    ? input[FEATURE_FLAG_KEY]
    : DEFAULT_FEATURE_FLAG_ENABLED;
  const killSwitchActive = hasOwn(input, KILL_SWITCH_KEY)
    ? input[KILL_SWITCH_KEY]
    : DEFAULT_KILL_SWITCH_ACTIVE;

  if (typeof featureFlagEnabled !== 'boolean') errors.push(`${FEATURE_FLAG_KEY}_must_be_boolean`);
  if (typeof killSwitchActive !== 'boolean') errors.push(`${KILL_SWITCH_KEY}_must_be_boolean`);
  if (featureFlagEnabled === true && !(source === 'synthetic_test_context' && syntheticTestContext)) {
    errors.push('feature_flag_enable_requires_synthetic_context');
  }
  if (killSwitchActive === false && !(source === 'synthetic_test_context' && syntheticTestContext)) {
    errors.push('kill_switch_disable_requires_synthetic_context');
  }

  if (errors.length > 0) return { valid: false, errors: uniqueSorted(errors) };
  return {
    valid: true,
    errors: [],
    configuration: Object.freeze({
      feature_flag_key: FEATURE_FLAG_KEY,
      feature_flag_enabled: featureFlagEnabled,
      feature_flag_default: DEFAULT_FEATURE_FLAG_ENABLED,
      kill_switch_key: KILL_SWITCH_KEY,
      kill_switch_active: killSwitchActive,
      kill_switch_default: DEFAULT_KILL_SWITCH_ACTIVE,
      kill_switch_required: true,
      source,
      synthetic: syntheticTestContext,
      authorization_granted_by_default: false
    })
  };
}

function validatePublicWebCanaryConfiguration(config, context = {}) {
  if (!isPlainObject(config)) return { valid: false, errors: ['configuration_must_be_object'] };
  if (!isPlainObject(context)) return { valid: false, errors: ['configuration_context_must_be_object'] };
  const errors = [];
  for (const field of REQUIRED_TRIAL_CONFIGURATION_FIELDS) {
    if (!hasOwn(config, field) || config[field] === undefined || config[field] === null) errors.push(`missing_${field}`);
  }
  const trialValidation = validateTrialConfiguration(stripControlFields(config));
  errors.push(...trialValidation.errors);
  const controls = normalizePublicWebCanaryControls(config, context);
  errors.push(...controls.errors);
  return {
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    configuration: controls.configuration
  };
}

module.exports = {
  CONFIGURATION_SOURCES,
  CONTROL_FIELDS,
  DEFAULT_FEATURE_FLAG_ENABLED,
  DEFAULT_KILL_SWITCH_ACTIVE,
  FEATURE_FLAG_KEY,
  KILL_SWITCH_KEY,
  REQUIRED_TRIAL_CONFIGURATION_FIELDS,
  normalizePublicWebCanaryControls,
  stripControlFields,
  validatePublicWebCanaryConfiguration
};
