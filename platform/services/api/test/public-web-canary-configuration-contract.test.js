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
const { loadTrialConfig } = require('../src/core/public-web-canary-configuration-loader');

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
  assert.equal(loadTrialConfig(undefined).ok, false);
});

test('PR-B configuration normalization is deterministic and does not authorize execution', () => {
  const first = normalizePublicWebCanaryControls(validConfiguration());
  const second = normalizePublicWebCanaryControls(validConfiguration());
  assert.deepEqual(first, second);
  assert.equal(first.configuration.synthetic, false);
  assert.equal(first.configuration.authorization_granted_by_default, false);

});

test('PR-B configuration loader has no direct or transitive operational capabilities', () => {
  const entry = path.join(__dirname, '..', 'src', 'core', 'public-web-canary-configuration-loader.js');
  const visited = new Set();
  const allowedBuiltins = new Set(['node:crypto', 'node:fs', 'node:net', 'node:path']);

  function visit(filePath) {
    const resolved = path.resolve(filePath);
    if (visited.has(resolved)) return;
    visited.add(resolved);

    const source = fs.readFileSync(resolved, 'utf8');
    const requireCalls = [...source.matchAll(/\brequire\s*\(/g)];
    const literalRequires = [...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
    assert.equal(literalRequires.length, requireCalls.length, `${resolved} must use only static require specifiers`);
    assert.equal(/\bimport\s*\(/.test(source), false, `${resolved} must not use dynamic import`);
    for (const forbiddenCapability of [
      /\bfetch\s*\(/,
      /\baxios\b/,
      /\bsecretResolver\b/,
      /\bauditSink\b/,
      /\b(?:database|supabase)\b/i
    ]) {
      assert.equal(forbiddenCapability.test(source), false, `${resolved} contains ${forbiddenCapability}`);
    }

    for (const match of literalRequires) {
      const specifier = match[2];
      if (specifier.startsWith('node:')) {
        assert.equal(allowedBuiltins.has(specifier), true, `unexpected Node capability ${specifier}`);
        if (specifier === 'node:net') {
          assert.equal(path.basename(resolved), 'public-web-transport-contract.js');
          const netMethods = [...source.matchAll(/\bnet\.([A-Za-z_$][\w$]*)/g)].map((netCall) => netCall[1]);
          assert.ok(netMethods.length > 0);
          assert.equal(netMethods.every((method) => method === 'isIP'), true, 'node:net may only validate IP string syntax');
        }
        if (specifier === 'node:fs') {
          const fsMethods = [...source.matchAll(/\bfs\.([A-Za-z_$][\w$]*)/g)].map((fsCall) => fsCall[1]);
          assert.ok(fsMethods.length > 0);
          assert.equal(fsMethods.every((method) => ['lstatSync', 'readFileSync'].includes(method)), true, 'configuration loader filesystem access must remain read-only');
        }
        continue;
      }
      assert.equal(specifier.startsWith('.'), true, `unexpected external dependency ${specifier}`);
      let dependency = path.resolve(path.dirname(resolved), specifier);
      if (!path.extname(dependency)) dependency += '.js';
      assert.equal(fs.existsSync(dependency), true, `unresolved static dependency ${specifier}`);
      visit(dependency);
    }
  }

  visit(entry);
  const graph = [...visited].map((filePath) => path.relative(path.join(__dirname, '..', 'src'), filePath)).sort();
  const expectedGraph = [
    path.join('core', 'public-web-canary-configuration-contract.js'),
    path.join('core', 'public-web-canary-configuration-loader.js'),
    path.join('core', 'public-web-canary-trial-contract.js'),
    path.join('core', 'public-web-transport-contract.js'),
    path.join('core', 'read-only-adapter-contract.js')
  ].sort();
  assert.deepEqual(graph, expectedGraph, 'PR-B import closure must remain limited to pure configuration/contract modules');
  assert.deepEqual(Object.keys(require('../src/core/public-web-canary-configuration-loader')).sort(), [
    'ALLOWED_CONFIG_FIELDS',
    'findUnknownConfigFields',
    'loadTrialConfig',
    'sanitizeLoadedTrialConfig',
    'validateTrialConfigPath'
  ]);
});
