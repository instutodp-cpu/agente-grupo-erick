'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TARGET_CONFIG_PATH = path.resolve(__dirname, '../../config/public-web-canary-third-target.json');

const REQUIRED_FIELDS = Object.freeze([
  'target_policy_id',
  'environment',
  'target_origin',
  'target_path',
  'method',
  'port',
  'source',
  'synthetic',
  'path_allowlist_mode',
  'redirects_allowed',
  'operation',
  'source_type',
  'maximum_requests',
  'rollout_percentage'
]);

const EXACT_TARGET = Object.freeze({
  environment: 'staging',
  target_origin: 'https://example.com',
  target_path: '/',
  method: 'GET',
  port: 443,
  source: 'human_approved_staging_external',
  synthetic: false,
  path_allowlist_mode: 'exact',
  redirects_allowed: false,
  operation: 'fetch_public_page_summary',
  source_type: 'public_documentation_page',
  maximum_requests: 1,
  rollout_percentage: 1
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validatePublicWebThirdCanaryTargetConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { valid: false, errors: ['target_config_must_be_object'] };
  for (const field of Object.keys(config)) {
    if (!REQUIRED_FIELDS.includes(field)) errors.push(`unknown_field::${field}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(config, field)) errors.push(`missing_${field}`);
  }
  for (const [field, expected] of Object.entries(EXACT_TARGET)) {
    if (config[field] !== expected) errors.push(`${field}_must_match_approved_target`);
  }

  let parsed;
  try {
    parsed = new URL(config.target_origin);
  } catch (_error) {
    errors.push('target_origin_invalid');
  }
  if (parsed && (parsed.protocol !== 'https:' || parsed.hostname !== 'example.com' || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password)) {
    errors.push('target_origin_not_exact');
  }
  if (typeof config.target_path === 'string' && (config.target_path !== '/' || config.target_path.includes('?') || config.target_path.includes('#') || config.target_path.includes('\\'))) {
    errors.push('target_path_not_exact');
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function loadPublicWebThirdCanaryTargetConfig(filePath = TARGET_CONFIG_PATH) {
  if (filePath !== TARGET_CONFIG_PATH) return { ok: false, blocked_reason: 'target_config_path_fixed' };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(TARGET_CONFIG_PATH, 'utf8'));
  } catch (_error) {
    return { ok: false, blocked_reason: 'target_config_unreadable' };
  }
  const validation = validatePublicWebThirdCanaryTargetConfig(parsed);
  if (!validation.valid) return { ok: false, blocked_reason: validation.errors[0], errors: validation.errors };
  return { ok: true, config: clone(parsed) };
}

module.exports = {
  EXACT_TARGET,
  REQUIRED_FIELDS,
  TARGET_CONFIG_PATH,
  loadPublicWebThirdCanaryTargetConfig,
  validatePublicWebThirdCanaryTargetConfig
};
