'use strict';

const {
  CONFIGURATION_ID,
  ADAPTER_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  CONNECTOR_ID,
  hashValue
} = require('../core/public-web-transport-contract');
const {
  REQUIRED_TRIAL_PLAN_FIELDS,
  buildSafeTrialError,
  hashTrialPlan,
  sanitizeTrialData,
  validateTrialPlan
} = require('../core/public-web-canary-trial-contract');
const {
  ALLOWED_CONFIG_FIELDS,
  findUnknownConfigFields,
  loadTrialConfig,
  sanitizeLoadedTrialConfig,
  validateTrialConfigPath
} = require('../core/public-web-canary-configuration-loader');
const {
  stripControlFields,
  validatePublicWebCanaryConfiguration
} = require('../core/public-web-canary-configuration-contract');

function buildTrialPlanFromConfig(config, context = {}) {
  const unknown = findUnknownConfigFields(config);
  if (unknown.length > 0) return { ok: false, error: buildSafeTrialError('INVALID_TRIAL_CONFIGURATION', 'unknown_field_blocked'), blocked_reason: 'unknown_field_blocked' };
  const configurationValidation = validatePublicWebCanaryConfiguration(config, {
    source: context.configurationSource === undefined
      ? 'explicit_non_production_document'
      : context.configurationSource,
    syntheticTestContext: context.syntheticTestContext === true
  });
  if (!configurationValidation.valid) return { ok: false, error: buildSafeTrialError('INVALID_TRIAL_CONFIGURATION', configurationValidation.errors[0]), blocked_reason: configurationValidation.errors[0] };
  const normalizedConfig = stripControlFields(config);
  const now = context.now || (typeof context.clock === 'function' ? context.clock() : new Date(0).toISOString());
  const sessionExpiresAt = normalizedConfig.session_expires_at || new Date(Date.parse(now) + 30 * 60 * 1000).toISOString();
  const approvalExpiresAt = normalizedConfig.approval_expires_at || sessionExpiresAt;
  const plan = {
    trial_id: normalizedConfig.trial_id,
    trial_version: normalizedConfig.trial_version || 1,
    trial_name: normalizedConfig.trial_name || 'Public Web Canary Operational Trial',
    environment: normalizedConfig.environment,
    connector_id: context.connector_id || CONNECTOR_ID,
    configuration_id: context.configuration_id || CONFIGURATION_ID,
    adapter_id: context.adapter_id || ADAPTER_ID,
    provider_id: context.provider_id || PROVIDER_ID,
    readiness_candidate_id: context.readiness_candidate_id || READINESS_CANDIDATE_ID,
    target_policy_id: normalizedConfig.target_policy_id,
    canary_session_id: context.canary_session_id || `${normalizedConfig.trial_id}_session`,
    workspace_type: normalizedConfig.workspace_type,
    tenant_id: normalizedConfig.tenant_id,
    user_id: normalizedConfig.user_id,
    operator_id: normalizedConfig.operator_id,
    operator_role: normalizedConfig.operator_role || 'integration_operator',
    approver_id: normalizedConfig.approver_id,
    approver_role: normalizedConfig.approver_role || 'security_operator',
    target_origin: normalizedConfig.target_origin,
    target_path: normalizedConfig.target_path,
    target_path_hash: hashValue(normalizedConfig.target_path),
    source_type: normalizedConfig.source_type,
    operation: normalizedConfig.operation,
    requested_content_types: normalizedConfig.requested_content_types,
    maximum_requests: normalizedConfig.maximum_requests,
    rollout_percentage: normalizedConfig.rollout_percentage,
    timeout_ms: normalizedConfig.timeout_ms,
    maximum_response_bytes: normalizedConfig.maximum_response_bytes,
    session_expires_at: sessionExpiresAt,
    approval_expires_at: approvalExpiresAt,
    feature_flag_key: context.feature_flag_key || 'HERMES_PUBLIC_WEB_READ_ONLY_ENABLED',
    kill_switch_key: context.kill_switch_key || 'HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH',
    production_allowed: false,
    automatic_execution_allowed: false,
    message_integration_allowed: false,
    confirm_integration_allowed: false,
    created_at: now,
    created_by: normalizedConfig.operator_id,
    reason: normalizedConfig.reason,
    status: 'not_started'
  };
  for (const field of REQUIRED_TRIAL_PLAN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(plan, field)) plan[field] = null;
  }
  plan.plan_hash = hashTrialPlan(plan);
  const validation = validateTrialPlan(plan);
  if (!validation.valid) return { ok: false, error: buildSafeTrialError('INVALID_TRIAL_PLAN', validation.errors[0]), blocked_reason: validation.errors[0] };
  return { ok: true, plan: sanitizeTrialData(plan) };
}

module.exports = {
  ALLOWED_CONFIG_FIELDS,
  loadTrialConfig,
  validateTrialConfigPath,
  sanitizeLoadedTrialConfig,
  buildTrialPlanFromConfig
};
