'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STAGING_SECRET_REFERENCE_TYPE,
  validatePublicWebStagingSecretReference
} = require('../src/core/public-web-staging-secret-reference-contract');

function ref(overrides = {}) {
  return {
    reference_id: 'staging_ref_1',
    reference_type: STAGING_SECRET_REFERENCE_TYPE,
    provider_id: 'public_web',
    workspace_type: 'agent',
    tenant_id: 'tenant_1',
    environment: 'staging',
    status: 'reference_registered',
    reference_version: 1,
    synthetic: true,
    disabled: false,
    revoked: false,
    required_secret_names: ['public_web_test_handle'],
    metadata: { purpose: 'public_web_canary_execution', classification: 'opaque_synthetic_reference' },
    ...overrides
  };
}

test('accepts exact opaque synthetic staging reference without making it resolvable', () => {
  const result = validatePublicWebStagingSecretReference(ref());
  assert.equal(result.valid, true);
  assert.equal(result.environment, 'staging');
  assert.equal(result.exportable, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.can_trigger_real_execution, false);
});

test('fails closed for local_test and local-test reference type', () => {
  assert.equal(validatePublicWebStagingSecretReference(ref({ environment: 'local_test' })).valid, false);
  assert.equal(validatePublicWebStagingSecretReference(ref({ reference_type: 'local_test_double_reference' })).valid, false);
});

test('fails closed for purpose drift, disabled/revoked state, non-synthetic or forbidden material', () => {
  const cases = [
    ref({ metadata: { purpose: 'synthetic_contract_test' } }),
    ref({ disabled: true }),
    ref({ revoked: true }),
    ref({ synthetic: false }),
    { ...ref(), secret_handle: 'forbidden' }
  ];
  for (const candidate of cases) assert.equal(validatePublicWebStagingSecretReference(candidate).valid, false);
});

test('contract contains no resolver, secret material, provider, DNS or HTTP capability', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/core/public-web-staging-secret-reference-contract'), 'utf8');
  assert.equal(/resolveReference|httpClient|dnsResolver|nodeHttpsClient|fetch\s*\(/.test(source), false);
  assert.equal(/process\.env/.test(source), false);
});
