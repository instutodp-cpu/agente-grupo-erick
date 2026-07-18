'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
  findTrialForbiddenFields,
  hashTrialPlan,
  sanitizeTrialData,
  validateTrialConfiguration,
  validateTrialPlan
} = require('../core/public-web-canary-trial-contract');

const ALLOWED_CONFIG_FIELDS = Object.freeze([
  'trial_id',
  'trial_version',
  'trial_name',
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
  'operator_id',
  'operator_role',
  'approver_id',
  'approver_role',
  'workspace_type',
  'tenant_id',
  'user_id',
  'reason',
  'session_expires_at',
  'approval_expires_at'
]);

function fail(code, reason) {
  return { ok: false, error: buildSafeTrialError(code, reason), blocked_reason: reason };
}

function validateTrialConfigPath(filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return fail('INVALID_TRIAL_CONFIGURATION', 'config_path_required');
  if (/^[a-z]+:\/\//i.test(filePath)) return fail('INVALID_TRIAL_CONFIGURATION', 'remote_config_blocked');
  if (!filePath.endsWith('.json')) return fail('INVALID_TRIAL_CONFIGURATION', 'json_extension_required');
  const resolved = path.resolve(options.baseDir || process.cwd(), filePath);
  if (resolved.includes(`..${path.sep}`) || /(^|[\\/])\.\.([\\/]|$)/.test(filePath)) return fail('INVALID_TRIAL_CONFIGURATION', 'path_traversal_blocked');
  if (resolved.endsWith('.example.json')) return fail('INVALID_TRIAL_CONFIGURATION', 'example_config_blocked');
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    return fail('INVALID_TRIAL_CONFIGURATION', 'config_not_found');
  }
  if (stat.isSymbolicLink()) return fail('INVALID_TRIAL_CONFIGURATION', 'symlink_blocked');
  if (!stat.isFile()) return fail('INVALID_TRIAL_CONFIGURATION', 'config_file_required');
  if (stat.size > 65536) return fail('INVALID_TRIAL_CONFIGURATION', 'config_too_large');
  return { ok: true, path: resolved };
}

function sanitizeLoadedTrialConfig(config) {
  const sanitized = sanitizeTrialData(config || {});
  const result = {};
  for (const field of ALLOWED_CONFIG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(sanitized, field)) result[field] = sanitized[field];
  }
  return result;
}

function loadTrialConfig(filePath, options = {}) {
  const pathValidation = validateTrialConfigPath(filePath, options);
  if (!pathValidation.ok) return pathValidation;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(pathValidation.path, 'utf8'));
  } catch (error) {
    return fail('INVALID_TRIAL_CONFIGURATION', 'config_json_invalid');
  }
  const unknown = Object.keys(parsed || {}).filter((field) => !ALLOWED_CONFIG_FIELDS.includes(field));
  if (unknown.length > 0) return fail('INVALID_TRIAL_CONFIGURATION', 'unknown_field_blocked');
  if (findTrialForbiddenFields(parsed).length > 0) return fail('TRIAL_FORBIDDEN_FIELD_DETECTED', 'forbidden_field_detected');
  const config = sanitizeLoadedTrialConfig(parsed);
  const validation = validateTrialConfiguration(config);
  if (!validation.valid) return fail('INVALID_TRIAL_CONFIGURATION', validation.errors[0]);
  return { ok: true, config };
}

function buildTrialPlanFromConfig(config, context = {}) {
  const now = context.now || (typeof context.clock === 'function' ? context.clock() : new Date(0).toISOString());
  const sessionExpiresAt = config.session_expires_at || new Date(Date.parse(now) + 30 * 60 * 1000).toISOString();
  const approvalExpiresAt = config.approval_expires_at || sessionExpiresAt;
  const plan = {
    trial_id: config.trial_id,
    trial_version: config.trial_version || 1,
    trial_name: config.trial_name || 'Public Web Canary Operational Trial',
    environment: config.environment,
    connector_id: context.connector_id || CONNECTOR_ID,
    configuration_id: context.configuration_id || CONFIGURATION_ID,
    adapter_id: context.adapter_id || ADAPTER_ID,
    provider_id: context.provider_id || PROVIDER_ID,
    readiness_candidate_id: context.readiness_candidate_id || READINESS_CANDIDATE_ID,
    target_policy_id: config.target_policy_id,
    canary_session_id: context.canary_session_id || `${config.trial_id}_session`,
    workspace_type: config.workspace_type,
    tenant_id: config.tenant_id,
    user_id: config.user_id,
    operator_id: config.operator_id,
    operator_role: config.operator_role || 'integration_operator',
    approver_id: config.approver_id,
    approver_role: config.approver_role || 'security_operator',
    target_origin: config.target_origin,
    target_path: config.target_path,
    target_path_hash: hashValue(config.target_path),
    source_type: config.source_type,
    operation: config.operation,
    requested_content_types: config.requested_content_types,
    maximum_requests: config.maximum_requests,
    rollout_percentage: config.rollout_percentage,
    timeout_ms: config.timeout_ms,
    maximum_response_bytes: config.maximum_response_bytes,
    session_expires_at: sessionExpiresAt,
    approval_expires_at: approvalExpiresAt,
    feature_flag_key: context.feature_flag_key || 'HERMES_PUBLIC_WEB_READ_ONLY_ENABLED',
    kill_switch_key: context.kill_switch_key || 'HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH',
    production_allowed: false,
    automatic_execution_allowed: false,
    message_integration_allowed: false,
    confirm_integration_allowed: false,
    created_at: now,
    created_by: config.operator_id,
    reason: config.reason,
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
