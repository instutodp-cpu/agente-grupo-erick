'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CANARY_ERROR_CODES,
  CANARY_STATES,
  REQUIRED_APPROVAL_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_SESSION_FIELDS,
  buildSafeCanaryError,
  findCanaryForbiddenFields,
  hashCanaryEvidence,
  validateCanaryApproval,
  validateCanaryExecutionResult,
  validateCanaryRequest,
  validateCanarySession,
  validateCanaryStateTransition
} = require('../src/core/public-web-canary-session-contract');
const {
  createPublicWebCanarySessionRegistry
} = require('../src/core/public-web-canary-session-registry');
const {
  createPublicWebCanaryOperatorPolicy
} = require('../src/core/public-web-canary-operator-policy');
const {
  createPublicWebCanaryTargetAllowlist
} = require('../src/core/public-web-canary-target-allowlist');
const {
  createPublicWebCanaryAuditSink
} = require('../src/core/public-web-canary-audit-sink');
const {
  buildPublicWebCanaryReport
} = require('../src/core/public-web-canary-report');
const {
  createPublicWebSafeDnsResolver
} = require('../src/adapters/public-web/public-web-safe-dns-resolver');
const {
  createPublicWebNodeHttpsClient
} = require('../src/adapters/public-web/public-web-node-https-client');
const {
  createPublicWebCanaryRunner
} = require('../src/pilots/public-web-canary-runner');
const {
  createPublicWebPilotBudget
} = require('../src/core/public-web-pilot-gate');
const {
  validCanaryRequest,
  validApproval,
  validTargetPolicy,
  validTargetAllowlist,
  validCanaryRegistry,
  validCanaryContext,
  validDnsResolver,
  fakeDnsResolver,
  fakeNodeHttpsClient,
  fakeBodyStream,
  deterministicClock
} = require('./helpers/public-web-canary-test-data');

const docPath = path.resolve(__dirname, '../../../docs/PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md');
const fixturePath = path.resolve(__dirname, 'fixtures/hermes-public-web-non-production-canary.json');
const indexPath = path.resolve(__dirname, '../src/index.js');
const intentRouterPath = path.resolve(__dirname, '../src/core/intent-router.js');
const confirmationPath = path.resolve(__dirname, '../src/core/confirmation-response.js');

function assertIncludesAll(actual, expected) {
  for (const item of expected) assert.ok(actual.includes(item), `missing ${item}`);
}

function assertSafe(value) {
  const json = JSON.stringify(value);
  for (const forbidden of ['rawBody', 'body', 'html', 'headers', 'cookies', 'remote_address', 'secret_handle', 'token', 'secret', 'stackTrace']) {
    assert.equal(json.includes(`"${forbidden}"`), false, `leaked ${forbidden}`);
  }
}

function createApprovedActiveSession(context = validCanaryContext()) {
  const registry = context.canarySessionRegistry;
  const request = validCanaryRequest();
  const created = registry.requestCanary(request);
  assert.equal(created.ok, true);
  const validated = registry.validateCanary({
    canary_session_id: request.canary_session_id,
    change_id: 'change_validate_canary',
    request_id: 'request_validate_canary',
    expected_version: created.session.version
  }, context);
  assert.equal(validated.ok, true);
  const approval = validApproval(validated.session);
  const approved = registry.approveCanary(approval, context);
  assert.equal(approved.ok, true);
  const active = registry.activateCanary({
    canary_session_id: request.canary_session_id,
    change_id: 'change_activate_canary',
    request_id: 'request_activate_canary',
    expected_version: approved.session.version
  }, context);
  assert.equal(active.ok, true);
  return { context, request, session: active.session };
}

test('public web non-production canary document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('fixture exposes required canary contract terms', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assertIncludesAll(fixture.canary_states, CANARY_STATES);
  assertIncludesAll(fixture.error_codes, CANARY_ERROR_CODES);
  assertIncludesAll(fixture.required_session_fields, REQUIRED_SESSION_FIELDS);
  assertIncludesAll(fixture.required_request_fields, REQUIRED_REQUEST_FIELDS);
  assertIncludesAll(fixture.required_approval_fields, REQUIRED_APPROVAL_FIELDS);
  assert.equal(fixture.default_rules.production_allowed, false);
  assert.equal(fixture.default_rules.automatic_execution_allowed, false);
  assert.equal(fixture.default_rules.maximum_rollout_percentage, 1);
  assert.equal(fixture.default_rules.redirects_allowed, false);
  assert.ok(fixture.required_contract_references.includes('PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md'));
});

test('canary contract validates requests sessions approvals transitions and forbidden fields', () => {
  const requestValidation = validateCanaryRequest(validCanaryRequest());
  assert.equal(requestValidation.valid, true);
  assert.equal(validateCanaryRequest(validCanaryRequest({ environment: 'production' })).valid, false);
  assert.equal(validateCanaryRequest(validCanaryRequest({ operation: 'checkout' })).valid, false);
  const registry = validCanaryRegistry();
  const created = registry.requestCanary(validCanaryRequest());
  assert.equal(created.ok, true);
  assert.equal(validateCanarySession(created.session).valid, true);
  assert.equal(validateCanaryApproval(validApproval(created.session), created.session).valid, true);
  assert.equal(validateCanaryStateTransition('inactive', 'request_canary', 'requested').valid, true);
  assert.equal(validateCanaryStateTransition('active', 'activate_canary', 'active').valid, false);
  assert.ok(findCanaryForbiddenFields({ nested: { rawBody: 'x' } }).includes('forbidden_field::rawBody'));
  assert.match(hashCanaryEvidence({ ok: true }), /^[a-f0-9]{64}$/);
  assert.equal(buildSafeCanaryError('CANARY_PRODUCTION_BLOCKED').error_code, 'CANARY_PRODUCTION_BLOCKED');
});

test('canary session registry is private frozen replay-protected and versioned', () => {
  const registry = validCanaryRegistry();
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(registry._sessions, undefined);
  const request = validCanaryRequest();
  const created = registry.requestCanary(request);
  assert.equal(created.ok, true);
  assert.equal(registry.requestCanary(request).error.error_code, 'CANARY_REPLAY_DETECTED');
  const clone = registry.getCanarySession(request.canary_session_id);
  clone.canary_state = 'active';
  assert.equal(registry.getCanarySession(request.canary_session_id).canary_state, 'requested');
  const conflict = registry.validateCanary({
    canary_session_id: request.canary_session_id,
    change_id: 'change_conflict',
    request_id: 'request_conflict',
    expected_version: 999
  }, validCanaryContext({ canarySessionRegistry: registry }));
  assert.equal(conflict.error.error_code, 'CANARY_VERSION_CONFLICT');
});

test('operator policy blocks common roles self-approval and approval replay', () => {
  const policy = createPublicWebCanaryOperatorPolicy();
  assert.equal(policy.canRequest({ operator_id: 'user', operator_role: 'viewer' }).allowed, false);
  assert.equal(policy.canRequest({ operator_id: 'operator', operator_role: 'integration_operator' }).allowed, true);
  const session = validCanaryRegistry().requestCanary(validCanaryRequest()).session;
  const selfApproval = validApproval(session, { approved_by: session.operator_id });
  assert.equal(policy.validateApproval(selfApproval, session).allowed, false);
  const approval = validApproval(session, { expected_version: session.version });
  assert.equal(policy.consumeApproval(approval, session).allowed, true);
  assert.equal(policy.consumeApproval(approval, session).allowed, false);
});

test('target allowlist enforces exact HTTPS origins and scoped paths', () => {
  const allowlist = validTargetAllowlist();
  assert.equal(Object.isFrozen(allowlist), true);
  assert.equal(allowlist.isTargetAllowed({
    environment: 'development',
    target_origin: 'https://public-canary.test',
    target_path: '/allowed/page',
    operation: 'fetch_public_page_summary',
    source_type: 'public_product_page'
  }).allowed, true);
  assert.equal(allowlist.isTargetAllowed({
    environment: 'development',
    target_origin: 'https://public-canary.test',
    target_path: '/allowed/page?blocked=true',
    operation: 'fetch_public_page_summary',
    source_type: 'public_product_page'
  }).allowed, false);
  assert.equal(allowlist.isTargetAllowed({
    environment: 'development',
    target_origin: 'https://public-canary.test',
    target_path: '/private',
    operation: 'fetch_public_page_summary',
    source_type: 'public_product_page'
  }).allowed, false);
  const invalid = createPublicWebCanaryTargetAllowlist({ dnsResolver: fakeDnsResolver() });
  assert.equal(invalid.registerTargetPolicy(validTargetPolicy({ origin: 'http://public-canary.test' })).ok, false);
  assert.equal(invalid.registerTargetPolicy(validTargetPolicy({ origin: 'https://localhost' })).ok, false);
  assert.equal(invalid.registerTargetPolicy(validTargetPolicy({ origin: 'https://public-canary.test:8443' })).ok, false);
});

test('safe DNS resolver blocks private or changing results and fixes approved IP', async () => {
  const ok = await validDnsResolver().resolve('public-canary.test');
  assert.equal(ok.allowed, true);
  assert.equal(ok.approved_ip, '93.184.216.34');
  assert.equal((await validDnsResolver({ 'public-canary.test': [] }).resolve('public-canary.test')).allowed, false);
  assert.equal((await validDnsResolver({ 'public-canary.test': ['10.0.0.1'] }).resolve('public-canary.test')).allowed, false);
  let count = 0;
  const changing = createPublicWebSafeDnsResolver({
    resolver: async () => {
      count += 1;
      return count === 1 ? ['93.184.216.34'] : ['93.184.216.35'];
    }
  });
  assert.equal((await changing.resolve('public-canary.test')).reason, 'dns_rebinding_detected');
});

test('node https client is isolated and passes approved IP lookup contract to request factory', async () => {
  let requestOptions;
  const client = createPublicWebNodeHttpsClient({
    requestFactory(options, callback) {
      requestOptions = options;
      options.lookup(options.hostname, {}, (error, address) => {
        assert.equal(error, null);
        assert.equal(address, '93.184.216.34');
      });
      const handlers = {};
      const req = {
        on(event, handler) { handlers[event] = handler; return req; },
        end() {
          const responseHandlers = {};
          const res = {
            statusCode: 200,
            headers: { 'content-type': 'text/plain', 'content-length': '2' },
            socket: { remoteAddress: '93.184.216.34' },
            on(event, handler) { responseHandlers[event] = handler; return res; }
          };
          callback(res);
          responseHandlers.data(Buffer.from('ok'));
          responseHandlers.end();
        },
        destroy() {},
        setTimeout() {}
      };
      return req;
    }
  });
  const response = await client.execute({
    url: 'https://public-canary.test/allowed',
    approved_ip: '93.184.216.34',
    approved_ips: ['93.184.216.34'],
    hostname: 'public-canary.test',
    port: 443,
    protocol: 'https',
    server_name: 'public-canary.test',
    host_header: 'public-canary.test',
    redirect_mode: 'manual',
    timeout_ms: 8000,
    max_response_bytes: 1048576,
    abort_signal: undefined
  });
  assert.equal(requestOptions.method, 'GET');
  assert.equal(requestOptions.headers.Host, 'public-canary.test');
  assert.equal(response.remote_address, '93.184.216.34');
  assert.equal(response.content_type, 'text/plain');
});

test('node https client blocks non read-only methods and request bodies before request factory', async () => {
  let calls = 0;
  const client = createPublicWebNodeHttpsClient({
    requestFactory() {
      calls += 1;
      throw new Error('request factory should not run');
    }
  });
  const base = {
    url: 'https://public-canary.test/allowed',
    approved_ip: '93.184.216.34',
    approved_ips: ['93.184.216.34'],
    hostname: 'public-canary.test',
    port: 443,
    protocol: 'https',
    server_name: 'public-canary.test',
    host_header: 'public-canary.test',
    redirect_mode: 'manual',
    timeout_ms: 8000,
    max_response_bytes: 1048576
  };

  await assert.rejects(() => client.execute({ ...base, method: 'POST' }), /PUBLIC_WEB_METHOD_BLOCKED/);
  await assert.rejects(() => client.execute({ ...base, body: 'unsafe' }), /PUBLIC_WEB_REQUEST_BODY_BLOCKED/);
  assert.equal(calls, 0);
});

test('runner blocks missing dependencies and executes one approved canary request safely', async () => {
  const context = validCanaryContext();
  const { session } = createApprovedActiveSession(context);
  const runner = createPublicWebCanaryRunner(context);
  const missing = await createPublicWebCanaryRunner({}).runCanaryRequest({
    canary_session_id: session.canary_session_id
  });
  assert.equal(missing.error.error_code, 'CANARY_INTERNAL_ERROR');
  const result = await runner.runCanaryRequest({
    trace_id: 'trace_canary_execution',
    request_id: 'request_canary_execution',
    change_id: 'change_execute_canary',
    canary_execution_id: 'execution_canary',
    canary_session_id: session.canary_session_id,
    operator_id: session.operator_id,
    operator_role: session.operator_role,
    environment: session.environment,
    target_origin: session.target_origin,
    target_path: '/allowed/page',
    source_type: session.source_type,
    operation: session.operation,
    reason: 'execute one canary',
    requested_at: '2026-07-16T12:02:00.000Z',
    expected_version: session.version,
    secretReference: context.secretReference,
    secretAccessContext: context.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(result.status, 'public_web_candidate_success');
  assert.equal(result.executed, true);
  assert.equal(result.real_provider_called, true);
  assert.equal(context.nodeHttpsClient.calls(), 1);
  assert.equal(context.canarySessionRegistry.getCanarySession(session.canary_session_id).canary_state, 'completed');
  assertSafe(result);
});

test('runner blocks before network for feature flag kill switch inactive session and target policy', async () => {
  const context = validCanaryContext();
  const { session } = createApprovedActiveSession(context);
  context.featureFlagResolver = () => false;
  const result = await createPublicWebCanaryRunner(context).runCanaryRequest({
    trace_id: 'trace_blocked',
    request_id: 'request_blocked',
    change_id: 'change_blocked',
    canary_session_id: session.canary_session_id,
    target_origin: session.target_origin,
    target_path: '/allowed/page',
    source_type: session.source_type,
    operation: session.operation,
    environment: session.environment,
    expected_version: session.version,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(result.error.error_code, 'CANARY_FEATURE_FLAG_OFF');
  assert.equal(result.real_provider_called, false);
  assert.equal(context.nodeHttpsClient.calls(), 0);
  const killContext = validCanaryContext();
  const killSession = createApprovedActiveSession(killContext).session;
  killContext.killSwitchResolver = () => true;
  const killed = await createPublicWebCanaryRunner(killContext).runCanaryRequest({
    trace_id: 'trace_kill',
    request_id: 'request_kill',
    change_id: 'change_kill',
    canary_session_id: killSession.canary_session_id,
    target_origin: killSession.target_origin,
    target_path: '/allowed/page',
    source_type: killSession.source_type,
    operation: killSession.operation,
    environment: killSession.environment,
    expected_version: killSession.version,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(killed.error.error_code, 'CANARY_KILL_SWITCH_ACTIVE');
  assert.equal(killContext.canarySessionRegistry.getCanarySession(killSession.canary_session_id).canary_state, 'kill_switch_terminated');
});

test('runner handles provider HTTP statuses and report remains sanitized', async () => {
  const context = validCanaryContext({ nodeHttpsClient: fakeNodeHttpsClient({ status_code: 429 }) });
  const { session } = createApprovedActiveSession(context);
  const runner = createPublicWebCanaryRunner(context);
  const result = await runner.runCanaryRequest({
    trace_id: 'trace_429',
    request_id: 'request_429',
    change_id: 'change_429',
    canary_execution_id: 'execution_429',
    canary_session_id: session.canary_session_id,
    environment: session.environment,
    target_origin: session.target_origin,
    target_path: '/allowed/page',
    source_type: session.source_type,
    operation: session.operation,
    reason: 'synthetic 429',
    requested_at: '2026-07-16T12:03:00.000Z',
    expected_version: session.version,
    secretReference: context.secretReference,
    secretAccessContext: context.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(result.status, 'public_web_rate_limited');
  assert.equal(result.real_provider_called, true);
  const report = runner.getCanaryReport(session.canary_session_id);
  assert.equal(report.provider_calls, 1);
  assert.ok(['fix_before_next_canary', 'remain_disabled'].includes(report.recommendation));
  assertSafe(report);
});

test('runner distinguishes blocked before network from failed after network', async () => {
  const dnsContext = validCanaryContext({
    dnsResolver: {
      async resolve() { return { allowed: false, blocked_reason: 'dns_policy_blocked' }; },
      resolveSyncForPolicy: () => ['93.184.216.34']
    }
  });
  const dnsSession = createApprovedActiveSession(dnsContext).session;
  const dnsBlocked = await createPublicWebCanaryRunner(dnsContext).runCanaryRequest({
    trace_id: 'trace_dns_block',
    request_id: 'request_dns_block',
    change_id: 'change_dns_block',
    canary_session_id: dnsSession.canary_session_id,
    target_path: dnsSession.target_path,
    expected_version: dnsSession.version,
    secretReference: dnsContext.secretReference,
    secretAccessContext: dnsContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(dnsBlocked.executed, false);
  assert.equal(dnsBlocked.real_provider_called, false);
  assert.equal(dnsContext.nodeHttpsClient.calls(), 0);

  const throwContext = validCanaryContext({ nodeHttpsClient: fakeNodeHttpsClient({ throw_error: true }) });
  const throwSession = createApprovedActiveSession(throwContext).session;
  const thrown = await createPublicWebCanaryRunner(throwContext).runCanaryRequest({
    trace_id: 'trace_network_throw',
    request_id: 'request_network_throw',
    change_id: 'change_network_throw',
    canary_session_id: throwSession.canary_session_id,
    target_path: throwSession.target_path,
    expected_version: throwSession.version,
    secretReference: throwContext.secretReference,
    secretAccessContext: throwContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(thrown.executed, true);
  assert.equal(thrown.real_provider_called, true);
  assert.equal(throwContext.nodeHttpsClient.calls(), 1);
  assert.equal(throwContext.canarySessionRegistry.getCanarySession(throwSession.canary_session_id).canary_state, 'failed_safe');

  const streamContext = validCanaryContext({
    nodeHttpsClient: fakeNodeHttpsClient({
      body_stream: (async function* stream() {
        throw new Error('synthetic stream error');
      }())
    })
  });
  const streamSession = createApprovedActiveSession(streamContext).session;
  const streamFailure = await createPublicWebCanaryRunner(streamContext).runCanaryRequest({
    trace_id: 'trace_stream_throw',
    request_id: 'request_stream_throw',
    change_id: 'change_stream_throw',
    canary_session_id: streamSession.canary_session_id,
    target_path: streamSession.target_path,
    expected_version: streamSession.version,
    secretReference: streamContext.secretReference,
    secretAccessContext: streamContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(streamFailure.executed, true);
  assert.equal(streamFailure.real_provider_called, true);
});

test('runner revalidates authorities after activation before network', async () => {
  const adapterContext = validCanaryContext();
  const adapterSession = createApprovedActiveSession(adapterContext).session;
  adapterContext.adapterRegistry = { getAdapter() { return null; } };
  const adapterBlocked = await createPublicWebCanaryRunner(adapterContext).runCanaryRequest({
    trace_id: 'trace_adapter_removed',
    request_id: 'request_adapter_removed',
    change_id: 'change_adapter_removed',
    canary_session_id: adapterSession.canary_session_id,
    target_path: adapterSession.target_path,
    expected_version: adapterSession.version,
    secretReference: adapterContext.secretReference,
    secretAccessContext: adapterContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(adapterBlocked.error.error_code, 'CANARY_ADAPTER_BLOCKED');
  assert.equal(adapterContext.nodeHttpsClient.calls(), 0);

  const lifecycleContext = validCanaryContext();
  const lifecycleSession = createApprovedActiveSession(lifecycleContext).session;
  const originalConnector = lifecycleContext.lifecycleRegistry.getConnector(lifecycleSession.connector_id);
  lifecycleContext.lifecycleRegistry = { getConnector() { return { ...originalConnector, lifecycle_version: 999 }; } };
  const lifecycleBlocked = await createPublicWebCanaryRunner(lifecycleContext).runCanaryRequest({
    trace_id: 'trace_lifecycle_changed',
    request_id: 'request_lifecycle_changed',
    change_id: 'change_lifecycle_changed',
    canary_session_id: lifecycleSession.canary_session_id,
    target_path: lifecycleSession.target_path,
    expected_version: lifecycleSession.version,
    secretReference: lifecycleContext.secretReference,
    secretAccessContext: lifecycleContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(lifecycleBlocked.error.error_code, 'CANARY_LIFECYCLE_BLOCKED');
  assert.equal(lifecycleContext.nodeHttpsClient.calls(), 0);

  const readinessContext = validCanaryContext();
  const readinessSession = createApprovedActiveSession(readinessContext).session;
  readinessContext.readinessResult = { changed: true };
  const readinessBlocked = await createPublicWebCanaryRunner(readinessContext).runCanaryRequest({
    trace_id: 'trace_readiness_changed',
    request_id: 'request_readiness_changed',
    change_id: 'change_readiness_changed',
    canary_session_id: readinessSession.canary_session_id,
    target_path: readinessSession.target_path,
    expected_version: readinessSession.version,
    secretReference: readinessContext.secretReference,
    secretAccessContext: readinessContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(readinessBlocked.error.error_code, 'CANARY_READINESS_BLOCKED');
  assert.equal(readinessContext.nodeHttpsClient.calls(), 0);
});

test('runner enforces exact approved path and target policy limits', async () => {
  const pathContext = validCanaryContext();
  const pathSession = createApprovedActiveSession(pathContext).session;
  const pathBlocked = await createPublicWebCanaryRunner(pathContext).runCanaryRequest({
    trace_id: 'trace_path_mismatch',
    request_id: 'request_path_mismatch',
    change_id: 'change_path_mismatch',
    canary_session_id: pathSession.canary_session_id,
    target_path: '/allowed/other',
    expected_version: pathSession.version,
    secretReference: pathContext.secretReference,
    secretAccessContext: pathContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(pathBlocked.error.error_code, 'CANARY_TARGET_NOT_ALLOWLISTED');
  assert.equal(pathContext.nodeHttpsClient.calls(), 0);

  const calls = [];
  const limitedAllowlist = createPublicWebCanaryTargetAllowlist({
    dnsResolver: fakeDnsResolver(),
    clock: deterministicClock
  });
  assert.equal(limitedAllowlist.registerTargetPolicy(validTargetPolicy({
    timeout_ms: 3000,
    maximum_response_bytes: 100000
  })).ok, true);
  const limitedContext = validCanaryContext({
    targetAllowlist: limitedAllowlist,
    nodeHttpsClient: {
      async execute(request) {
        calls.push(request);
        return fakeNodeHttpsClient().execute(request);
      },
      calls() { return calls.length; }
    }
  });
  const limitedSession = createApprovedActiveSession(limitedContext).session;
  const limitedResult = await createPublicWebCanaryRunner(limitedContext).runCanaryRequest({
    trace_id: 'trace_policy_limits',
    request_id: 'request_policy_limits',
    change_id: 'change_policy_limits',
    canary_session_id: limitedSession.canary_session_id,
    target_path: limitedSession.target_path,
    expected_version: limitedSession.version,
    requested_content_types: ['text/html'],
    secretReference: limitedContext.secretReference,
    secretAccessContext: limitedContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(limitedResult.status, 'public_web_candidate_success');
  assert.ok(calls[0].timeout_ms <= 3000);
  assert.ok(calls[0].max_response_bytes <= 100000);
});

test('runner revalidates secret reference before network', async () => {
  const revokedContext = validCanaryContext();
  const revokedSession = createApprovedActiveSession(revokedContext).session;
  const original = revokedContext.secretReferenceRegistry.getSecretReference(revokedSession.secret_reference_id);
  revokedContext.secretReferenceRegistry = { getSecretReference() { return { ...original, status: 'revoked', revoked: true }; } };
  const revoked = await createPublicWebCanaryRunner(revokedContext).runCanaryRequest({
    trace_id: 'trace_secret_revoked',
    request_id: 'request_secret_revoked',
    change_id: 'change_secret_revoked',
    canary_session_id: revokedSession.canary_session_id,
    target_path: revokedSession.target_path,
    expected_version: revokedSession.version,
    secretReference: revokedContext.secretReference,
    secretAccessContext: revokedContext.secretAccessContext,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  assert.equal(revoked.error.error_code, 'CANARY_CONFIGURATION_BLOCKED');
  assert.equal(revoked.real_provider_called, false);
  assert.equal(revokedContext.nodeHttpsClient.calls(), 0);
});

test('budgets block sixth hourly request and release concurrency', () => {
  const budget = createPublicWebPilotBudget({ clock: deterministicClock });
  for (let index = 0; index < 5; index += 1) {
    assert.equal(budget.reserve().allowed, true);
    budget.release();
  }
  assert.equal(budget.reserve().allowed, false);
  const concurrent = createPublicWebPilotBudget({ clock: deterministicClock });
  assert.equal(concurrent.reserve().allowed, true);
  assert.equal(concurrent.reserve().reason, 'concurrency_limit_exceeded');
  concurrent.release();
  assert.equal(concurrent.check().allowed, true);
});

test('canary modules stay isolated from main runtime and unsafe APIs', () => {
  for (const filePath of [
    path.resolve(__dirname, '../src/index.js'),
    path.resolve(__dirname, '../src/core/intent-router.js'),
    path.resolve(__dirname, '../src/core/confirmation-response.js')
  ]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.equal(source.includes('public-web-canary'), false);
    assert.equal(source.includes('public-web-node-https-client'), false);
  }
  for (const filePath of [
    path.resolve(__dirname, '../src/core/public-web-canary-session-contract.js'),
    path.resolve(__dirname, '../src/core/public-web-canary-session-registry.js'),
    path.resolve(__dirname, '../src/core/public-web-canary-target-allowlist.js'),
    path.resolve(__dirname, '../src/pilots/public-web-canary-runner.js')
  ]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('puppeteer'), false);
    assert.equal(source.includes('playwright'), false);
  }
});
