'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildSafeTrialError,
  findTrialForbiddenFields,
  sanitizeTrialData
} = require('./public-web-canary-trial-contract');
const {
  CONTROL_FIELDS,
  validatePublicWebCanaryConfiguration
} = require('./public-web-canary-configuration-contract');

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
  'approval_expires_at',
  ...CONTROL_FIELDS
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

function findUnknownConfigFields(config) {
  return Object.keys(config || {}).filter((field) => !ALLOWED_CONFIG_FIELDS.includes(field));
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
  const unknown = findUnknownConfigFields(parsed);
  if (unknown.length > 0) return fail('INVALID_TRIAL_CONFIGURATION', 'unknown_field_blocked');
  if (findTrialForbiddenFields(parsed).length > 0) return fail('TRIAL_FORBIDDEN_FIELD_DETECTED', 'forbidden_field_detected');
  const config = sanitizeLoadedTrialConfig(parsed);
  const validation = validatePublicWebCanaryConfiguration(config, {
    source: options.configurationSource === undefined
      ? 'explicit_non_production_document'
      : options.configurationSource,
    syntheticTestContext: options.syntheticTestContext === true
  });
  if (!validation.valid) return fail('INVALID_TRIAL_CONFIGURATION', validation.errors[0]);
  return { ok: true, config, configuration_controls: validation.configuration };
}

module.exports = {
  ALLOWED_CONFIG_FIELDS,
  findUnknownConfigFields,
  loadTrialConfig,
  sanitizeLoadedTrialConfig,
  validateTrialConfigPath
};
