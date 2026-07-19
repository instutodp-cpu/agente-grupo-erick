'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields,
  validateSafetyFlags
} = require('./transcription-provider-contract');

const CONFIGURATION_LIFECYCLE_STATUSES = Object.freeze(['draft', 'structurally_valid', 'blocked', 'ready_for_mock_parity_review']);
const NETWORK_POLICY_STATUSES = Object.freeze(['network_blocked', 'allowlist_not_configured']);
const TRANSPORT_STATUSES = Object.freeze(['absent', 'disabled']);

function validateTranscriptionProviderConfiguration(config, context = {}) {
  const errors = [];
  if (!isPlainObject(config)) return { valid: false, errors: ['configuration_must_be_object'] };
  for (const field of ['configuration_id', 'provider_contract_id', 'provider_slug', 'configuration_version', 'environment', 'tenant_id', 'workspace_type', 'model_reference', 'language', 'feature_options', 'timeout_ms', 'max_retries', 'retry_backoff_ms', 'concurrency_limit', 'max_duration_ms', 'max_size_bytes', 'budget_policy_id', 'retention_policy_id', 'secret_reference_id', 'lifecycle_status', 'network_policy_status', 'transport_status', 'rollout_percentage', 'production_blocked', 'simulated', 'provider_runtime_enabled', 'provider_selected_for_execution', 'transport_enabled', 'secret_resolved']) {
    if (!Object.prototype.hasOwnProperty.call(config, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['configuration_id', 'provider_contract_id', 'provider_slug', 'environment', 'tenant_id', 'workspace_type', 'model_reference', 'language', 'budget_policy_id', 'retention_policy_id', 'secret_reference_id', 'lifecycle_status', 'network_policy_status', 'transport_status']) {
    if (!isNonEmptyString(config[field])) errors.push(`invalid_${field}`);
  }
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(config.provider_slug)) errors.push(`provider_slug_not_allowed::${config.provider_slug}`);
  if (context.contract && config.provider_contract_id !== context.contract.provider_contract_id) errors.push('provider_contract_id_mismatch');
  if (context.contract && config.provider_slug !== context.contract.provider_slug) errors.push('provider_slug_mismatch');
  if (!Number.isInteger(config.configuration_version) || config.configuration_version < 1) errors.push('configuration_version_invalid');
  if (!['local_test', 'non_production'].includes(config.environment)) errors.push('environment_not_allowed');
  if (!isPlainObject(config.feature_options)) errors.push('feature_options_must_be_object');
  if (!Number.isInteger(config.timeout_ms) || config.timeout_ms <= 0 || config.timeout_ms > (context.contract ? context.contract.timeout_limit_ms : 30000)) errors.push('timeout_ms_out_of_bounds');
  if (!Number.isInteger(config.max_retries) || config.max_retries < 0 || config.max_retries > 2) errors.push('max_retries_out_of_bounds');
  if (!Number.isInteger(config.retry_backoff_ms) || config.retry_backoff_ms < 0) errors.push('retry_backoff_ms_invalid');
  if (config.concurrency_limit !== 1) errors.push('concurrency_limit_must_be_one');
  if (!Number.isInteger(config.max_duration_ms) || config.max_duration_ms < 0 || (context.contract && config.max_duration_ms > context.contract.max_duration_ms)) errors.push('max_duration_ms_out_of_bounds');
  if (!Number.isInteger(config.max_size_bytes) || config.max_size_bytes < 0 || (context.contract && config.max_size_bytes > context.contract.max_size_bytes)) errors.push('max_size_bytes_out_of_bounds');
  if (!CONFIGURATION_LIFECYCLE_STATUSES.includes(config.lifecycle_status)) errors.push(`lifecycle_status_not_allowed::${config.lifecycle_status}`);
  if (!NETWORK_POLICY_STATUSES.includes(config.network_policy_status)) errors.push(`network_policy_status_not_allowed::${config.network_policy_status}`);
  if (config.network_policy_status !== 'network_blocked') errors.push('network_must_remain_blocked');
  if (!TRANSPORT_STATUSES.includes(config.transport_status)) errors.push(`transport_status_not_allowed::${config.transport_status}`);
  if (!['absent', 'disabled'].includes(config.transport_status)) errors.push('transport_must_be_absent_or_disabled');
  validateSafetyFlags({ ...config, executed: false, real_provider_called: false, external_network_called: false, can_trigger_real_execution: false }, errors);
  errors.push(...findProviderBoundaryForbiddenFields(config));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeProviderConfiguration(config) {
  return Object.freeze(sanitizeTranscriptionData(deepClone(config)));
}

module.exports = {
  CONFIGURATION_LIFECYCLE_STATUSES,
  NETWORK_POLICY_STATUSES,
  TRANSPORT_STATUSES,
  normalizeProviderConfiguration,
  validateTranscriptionProviderConfiguration
};
