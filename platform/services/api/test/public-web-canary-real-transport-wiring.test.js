'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPublicWebNodeHttpsClient } = require('../src/adapters/public-web/public-web-node-https-client');
const { normalizeCanaryTelemetry, validateCanaryTelemetry } = require('../src/core/public-web-canary-telemetry');
const { createPublicWebCanaryRunner } = require('../src/pilots/public-web-canary-runner');
const { createPublicWebCanaryStagingBootstrap } = require('../src/pilots/public-web-canary-staging-bootstrap');
const {
  validCanaryContext,
  validCanaryRequest,
  validApproval,
  fakeNodeHttpsClient
} = require('./helpers/public-web-canary-test-data');
const { validPreflightContext } = require('./helpers/public-web-canary-trial-test-data');

function createApprovedActiveSession(context) {
  const request = validCanaryRequest();
  const created = context.canarySessionRegistry.requestCanary(request);
  assert.equal(created.ok, true);
  const validated = context.canarySessionRegistry.validateCanary({
    canary_session_id: request.canary_session_id,
    change_id: 'wiring_validate',
    request_id: 'wiring_validate',
    expected_version: created.session.version
  }, context);
  assert.equal(validated.ok, true);
  const approved = context.canarySessionRegistry.approveCanary(validApproval(validated.session), context);
  assert.equal(approved.ok, true);
  const active = context.canarySessionRegistry.activateCanary({
    canary_session_id: request.canary_session_id,
    change_id: 'wiring_activate',
    request_id: 'wiring_activate',
    expected_version: approved.session.version
  }, context);
  assert.equal(active.ok, true);
  return active.session;
}

function runnerInput(session, id = 'wiring_execution') {
  return {
    trace_id: `${id}_trace`,
    request_id: `${id}_request`,
    change_id: `${id}_change`,
    canary_execution_id: id,
    canary_session_id: session.canary_session_id,
    target_path: session.target_path,
    expected_version: session.version,
    simulated: true,
    executed: false,
    real_provider_called: false
  };
}

test('local context remains synthetic and does not select the staging factory', () => {
  const context = validPreflightContext();
  assert.equal(typeof context.nodeHttpsClient.calls, 'function');
  assert.deepEqual(context.dnsResolver.resolveSyncForPolicy(), ['93.184.216.34']);
  assert.equal(createPublicWebCanaryStagingBootstrap({}).ok, false);
});

test('staging real transport wiring is explicit, bounded, and fail-closed', () => {
  const base = validPreflightContext();
  const incompleteBase = { ...base, auditSink: undefined };
  const incomplete = createPublicWebCanaryStagingBootstrap({
    ...incompleteBase,
    operationalBootstrapConfigured: true,
    stagingRealTransportOptIn: true,
    environment: 'staging',
    maximum_requests: 1,
    rollout_percentage: 1
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.blocked_reason, 'staging_context_dependency_missing');

  const production = createPublicWebCanaryStagingBootstrap({
    ...base,
    operationalBootstrapConfigured: true,
    stagingRealTransportOptIn: true,
    environment: 'staging',
    production_allowed: true,
    maximum_requests: 1,
    rollout_percentage: 1
  });
  assert.equal(production.ok, false);
  assert.equal(production.blocked_reason, 'production_blocked');

  let dnsCalls = 0;
  let httpCalls = 0;
  const bootstrap = createPublicWebCanaryStagingBootstrap({
    ...base,
    operationalBootstrapConfigured: true,
    stagingRealTransportOptIn: true,
    environment: 'staging',
    maximum_requests: 1,
    rollout_percentage: 1,
    dnsResolver: { async resolve() { dnsCalls += 1; return null; } },
    nodeHttpsClient: { async execute() { httpCalls += 1; return null; } }
  });
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.production_allowed, false);
  assert.equal(bootstrap.nodeHttpsClient.execute !== base.nodeHttpsClient.execute, true);
  assert.equal(dnsCalls, 0);
  assert.equal(httpCalls, 0);
});

test('real node HTTPS client can be injected with an offline request factory', async () => {
  let requestCalls = 0;
  const client = createPublicWebNodeHttpsClient({
    requestFactory(options, callback) {
      requestCalls += 1;
      const response = {
        statusCode: 200,
        headers: { 'content-type': 'text/plain', 'content-length': '2' },
        socket: { remoteAddress: '93.184.216.34' },
        on(event, handler) { if (event === 'data') handler('ok'); if (event === 'end') handler(); },
        destroy() {}
      };
      const request = {
        on() { return request; },
        end() { callback(response); },
        destroy() {}
      };
      return request;
    }
  });
  const response = await client.execute({
    url: 'https://public-canary.test/allowed/page',
    hostname: 'public-canary.test',
    server_name: 'public-canary.test',
    host_header: 'public-canary.test',
    approved_ip: '93.184.216.34',
    approved_ips: ['93.184.216.34'],
    protocol: 'https',
    port: 443,
    redirect_mode: 'manual'
  });
  assert.equal(requestCalls, 1);
  assert.equal(response.external_network_called, false);
});

test('telemetry separates provider invocation, transport invocation, and network evidence', async () => {
  const blockedContext = validCanaryContext();
  const blockedSession = createApprovedActiveSession(blockedContext);
  blockedContext.secretResolver = {
    canResolve() { return true; },
    resolveReference() { return { resolved: false, exportable: false, blocked_reason: 'offline_test_secret_block' }; }
  };
  const blocked = await createPublicWebCanaryRunner(blockedContext).runCanaryRequest(runnerInput(blockedSession, 'provider_only'));
  assert.equal(blocked.provider_invoked, true);
  assert.equal(blocked.transport_invoked, false);
  assert.equal(blocked.external_network_called, false);
  assert.equal(blockedContext.nodeHttpsClient.calls(), 0);

  const fakeContext = validCanaryContext({ nodeHttpsClient: fakeNodeHttpsClient() });
  const fakeSession = createApprovedActiveSession(fakeContext);
  const fake = await createPublicWebCanaryRunner(fakeContext).runCanaryRequest(runnerInput(fakeSession, 'transport_stub'));
  assert.equal(fake.provider_invoked, true);
  assert.equal(fake.transport_invoked, true);
  assert.equal(fake.external_network_called, false);

  const evidencedContext = validCanaryContext({ nodeHttpsClient: fakeNodeHttpsClient({ external_network_called: true }) });
  const evidencedSession = createApprovedActiveSession(evidencedContext);
  const evidenced = await createPublicWebCanaryRunner(evidencedContext).runCanaryRequest(runnerInput(evidencedSession, 'transport_evidence'));
  assert.equal(evidenced.transport_invoked, true);
  assert.equal(evidenced.external_network_called, true);

  assert.deepEqual(normalizeCanaryTelemetry({ provider_invoked: true }), {
    provider_invoked: true,
    transport_invoked: false,
    external_network_called: false
  });
  assert.equal(validateCanaryTelemetry({ provider_invoked: true, transport_invoked: false }).valid, true);
  assert.equal(validateCanaryTelemetry({ provider_invoked: false, transport_invoked: true }).valid, false);
});
