'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightOperationalCanary, executeOperationalCanary } = require('../scripts/public-web-canary-real-non-production');
const { FLAG, KILL } = require('../src/pilots/public-web-canary-operational-controls');

function bootstrap({ enabled = false, killed = true } = {}) {
  const queried = [];
  const runtime = {
    ok: true, operationalBootstrapConfigured: true, stagingRealTransportOptIn: true,
    environment: 'staging', production: false, production_allowed: false, realTransport: true,
    featureFlagResolver: async key => { queried.push(key); return enabled && key === FLAG; },
    killSwitchResolver: async key => { queried.push(key); return killed || key !== KILL; },
    requireDurableAudit: true,
    auditSink: { durable: true, appendDurably: async () => {}, ensureReady: async () => ({ ok: true }) },
    secretReferenceRegistry: { getSecretReference() { return null; } },
    secretResolver: { resolveReference() { throw new Error('must not resolve during preflight'); } }
  };
  return { bootstrap: { runtime }, queried };
}

test('preflight queries official flag and kill switch and remains fail-closed', async () => {
  const { bootstrap: b, queried } = bootstrap();
  const result = await preflightOperationalCanary({ bootstrap: b });
  assert.equal(result.ready, false);
  assert.equal(result.network_called, false);
  assert.equal(result.secret_resolved, false);
  assert.deepEqual(queried, [FLAG, KILL]);
});
test('preflight reports ready controls without resolving secrets or making external calls', async () => {
  const { bootstrap: b } = bootstrap({ enabled: true, killed: false });
  const result = await preflightOperationalCanary({ bootstrap: b });
  assert.equal(result.ready, true);
  assert.equal(result.network_called, false);
  assert.equal(result.secret_resolved, false);
  assert.equal(result.execution_started, false);
});
test('execution rejects disabled flag before confirmation and without external calls', async () => {
  const { bootstrap: b, queried } = bootstrap();
  let confirmationRead = false;
  const result = await executeOperationalCanary({ bootstrap: b, confirmationReader: async () => { confirmationRead = true; return ''; } });
  assert.equal(result.status, 'feature_flag_disabled');
  assert.equal(result.real_provider_called, false);
  assert.equal(confirmationRead, false);
  assert.deepEqual(queried, [FLAG]);
});
