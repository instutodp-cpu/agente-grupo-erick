'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONFIGURATION_SOURCES,
  DEFAULT_FEATURE_FLAG_ENABLED,
  DEFAULT_KILL_SWITCH_ACTIVE,
  FEATURE_FLAG_KEY,
  KILL_SWITCH_KEY,
  normalizePublicWebCanaryControls,
  validatePublicWebCanaryConfiguration
} = require('../src/core/public-web-canary-configuration-contract');
const { buildTrialPlanFromConfig } = require('../src/pilots/public-web-canary-trial-config-loader');

function validConfiguration(overrides = {}) {
  return {
    trial_id: 'public_web_configuration_contract_test',
    environment: 'development',
    target_policy_id: 'target_policy_public_canary',
    target_origin: 'https://public-canary.test',
    target_path: '/allowed/page',
    source_type: 'public_product_page',
    operation: 'fetch_public_page_summary',
    requested_content_types: ['text/html'],
    maximum_requests: 1,
    rollout_percentage: 1,
    timeout_ms: 3000,
    maximum_response_bytes: 100000,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_public_web_synthetic',
    operator_id: 'operator_public_web',
    operator_role: 'integration_operator',
    approver_id: 'security_approver',
    approver_role: 'security_operator',
    reason: 'configuration contract validation',
    ...overrides
  };
}

test('PR-B configuration exposes the official safe defaults and types', () => {
  const result = normalizePublicWebCanaryControls({});
  assert.equal(result.valid, true);
  assert.equal(result.configuration.feature_flag_key, FEATURE_FLAG_KEY);
  assert.equal(result.configuration.feature_flag_enabled, DEFAULT_FEATURE_FLAG_ENABLED);
  assert.equal(result.configuration.feature_flag_default, false);
  assert.equal(result.configuration.kill_switch_key, KILL_SWITCH_KEY);
  assert.equal(result.configuration.kill_switch_active, DEFAULT_KILL_SWITCH_ACTIVE);
  assert.equal(result.configuration.kill_switch_default, true);
  assert.equal(result.configuration.kill_switch_required, true);
  assert.equal(result.configuration.authorization_granted_by_default, false);
  assert.deepEqual(CONFIGURATION_SOURCES, ['explicit_non_production_document', 'synthetic_test_context']);
});

test('PR-B configuration accepts only strict booleans', () => {
  for (const value of ['true', 'false', 1, 0, 'yes', 'no', null, undefined, [], {}]) {
    assert.equal(normalizePublicWebCanaryControls({ [FEATURE_FLAG_KEY]: value }).valid, false, `feature flag: ${String(value)}`);
    assert.equal(normalizePublicWebCanaryControls({ [KILL_SWITCH_KEY]: value }).valid, false, `kill switch: ${String(value)}`);
  }
});

test('PR-B configuration rejects unsafe enablement outside a synthetic test context', () => {
  assert.equal(normalizePublicWebCanaryControls({ [FEATURE_FLAG_KEY]: true }).valid, false);
  assert.equal(normalizePublicWebCanaryControls({ [KILL_SWITCH_KEY]: false }).valid, false);
  assert.equal(normalizePublicWebCanaryControls({
    [FEATURE_FLAG_KEY]: true,
    [KILL_SWITCH_KEY]: false
  }, { source: 'synthetic_test_context', syntheticTestContext: true }).valid, true);
  assert.equal(normalizePublicWebCanaryControls({}, { source: 'unknown_source' }).valid, false);
  assert.equal(normalizePublicWebCanaryControls({}, { source: null }).valid, false);
  assert.equal(normalizePublicWebCanaryControls({}, null).valid, false);
  assert.equal(normalizePublicWebCanaryControls({ HERMES_PUBLIC_WEB_READ_ONLY_UNKNOWN: false }).valid, false);
});

test('PR-B configuration fails closed for missing, malformed, unknown and inconsistent input', () => {
  const complete = validConfiguration();
  assert.equal(validatePublicWebCanaryConfiguration(complete).valid, true);
  assert.equal(validatePublicWebCanaryConfiguration({ ...complete, trial_id: undefined }).valid, false);
  assert.equal(validatePublicWebCanaryConfiguration({ ...complete, target_path: '/../secret' }).valid, false);
  assert.equal(validatePublicWebCanaryConfiguration({ ...complete, unknown_field: true }).valid, false);
  assert.equal(validatePublicWebCanaryConfiguration({ ...complete, [FEATURE_FLAG_KEY]: 'true' }).valid, false);
  assert.equal(validatePublicWebCanaryConfiguration({ ...complete, [KILL_SWITCH_KEY]: false }).valid, false);
  const missing = { ...complete };
  delete missing.tenant_id;
  assert.equal(validatePublicWebCanaryConfiguration(missing).valid, false);
});

test('PR-B configuration normalization is deterministic and does not authorize execution', () => {
  const first = normalizePublicWebCanaryControls(validConfiguration());
  const second = normalizePublicWebCanaryControls(validConfiguration());
  assert.deepEqual(first, second);
  assert.equal(first.configuration.synthetic, false);
  assert.equal(first.configuration.authorization_granted_by_default, false);

  const built = buildTrialPlanFromConfig(validConfiguration());
  assert.equal(built.ok, true, built.blocked_reason);
  assert.equal(built.plan.production_allowed, false);
  assert.equal(built.plan.automatic_execution_allowed, false);
  assert.equal(built.plan.message_integration_allowed, false);
  assert.equal(built.plan.confirm_integration_allowed, false);
});

test('PR-B configuration boundary has no operational capability imports', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'core', 'public-web-canary-configuration-contract.js'),
    'utf8'
  );
  for (const forbidden of [
    'public-web-canary-runner',
    'fetch(',
    'axios',
    "require('node:http')",
    "require('node:https')",
    "require('node:dns')",
    "require('node:net')",
    "require('node:tls')",
    'process.env',
    'secretResolver',
    'database'
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
