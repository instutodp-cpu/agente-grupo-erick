'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STAGING_ENVIRONMENT,
  STAGING_PURPOSE,
  validatePublicWebStagingSecretAccessContract
} = require('../src/core/public-web-staging-secret-access-contract');

function validContract(overrides = {}) {
  return {
    environment: STAGING_ENVIRONMENT,
    purpose: STAGING_PURPOSE,
    production_allowed: false,
    exportable: false,
    single_request: true,
    ...overrides
  };
}

test('staging secret access contract accepts only the exact non-production single-request shape', () => {
  const result = validatePublicWebStagingSecretAccessContract(validContract());
  assert.equal(result.valid, true);
  assert.equal(result.environment, 'staging');
  assert.equal(result.purpose, 'public_web_canary_execution');
  assert.equal(result.production_allowed, false);
  assert.equal(result.exportable, false);
  assert.equal(result.single_request, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.external_network_called, false);
});

test('staging secret access contract fails closed on missing or drifting fields', () => {
  const invalid = [
    null,
    {},
    validContract({ environment: 'local_test' }),
    validContract({ purpose: 'local_test_readiness_validation' }),
    validContract({ purpose: 'other' }),
    validContract({ production_allowed: true }),
    validContract({ exportable: true }),
    validContract({ single_request: false })
  ];
  for (const candidate of invalid) {
    const result = validatePublicWebStagingSecretAccessContract(candidate);
    assert.equal(result.valid, false);
    assert.equal(result.blocked_reason, 'staging_secret_access_contract_invalid');
    assert.equal(result.executed, false);
    assert.equal(result.real_provider_called, false);
    assert.equal(result.external_network_called, false);
  }
});

test('staging secret access contract is validation-only and exposes no secret material or resolver capability', () => {
  const source = require('node:fs').readFileSync(
    require.resolve('../src/core/public-web-staging-secret-access-contract'),
    'utf8'
  );
  assert.equal(/resolveReference|httpClient|dnsResolver|nodeHttpsClient|fetch\s*\(/.test(source), false);
  assert.equal(/secret[_-]?(value|material|token|key)\s*[:=]/i.test(source), false);
});
