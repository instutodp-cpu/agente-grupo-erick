'use strict';

const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID
} = require('../../src/core/public-web-transport-contract');
const {
  createPublicWebCanarySessionRegistry
} = require('../../src/core/public-web-canary-session-registry');
const {
  createPublicWebCanaryTargetAllowlist
} = require('../../src/core/public-web-canary-target-allowlist');
const {
  createPublicWebCanaryOperatorPolicy
} = require('../../src/core/public-web-canary-operator-policy');
const {
  createPublicWebCanaryAuditSink
} = require('../../src/core/public-web-canary-audit-sink');
const {
  createPublicWebSafeDnsResolver
} = require('../../src/adapters/public-web/public-web-safe-dns-resolver');
const {
  createPublicWebPilotBudget,
  evaluatePublicWebPilotGate
} = require('../../src/core/public-web-pilot-gate');
const {
  validAdapterRegistry,
  validLifecycleRegistry,
  validConfigurationRegistry,
  validSecretReference,
  validSecretReferenceRegistry,
  validLocalSecretResolver,
  validReadinessEvidence
} = require('./public-web-pilot-test-data');

function deterministicClock() {
  return '2026-07-16T12:00:00.000Z';
}

function fakeDnsResolver(overrides = {}) {
  return (hostname) => {
    if (Object.prototype.hasOwnProperty.call(overrides, hostname)) return overrides[hostname];
    return ['93.184.216.34'];
  };
}

function fakeBodyStream(text = '<html><title>Canary</title><p>Conteudo publico sintetico.</p></html>') {
  return (async function* stream() {
    yield text;
  }());
}

function fakeNodeHttpsClient(response = {}) {
  let calls = 0;
  const client = {
    async execute(request) {
      calls += 1;
      if (response.throw_error) throw new Error('synthetic provider error');
      return {
        status_code: 200,
        content_type: 'text/html',
        content_length: 72,
        remote_address: request.approved_ip,
        redirect_location: '',
        body_stream: fakeBodyStream(),
        ...response
      };
    },
    calls() {
      return calls;
    }
  };
  return client;
}

function validCanaryRequest(overrides = {}) {
  return {
    trace_id: 'trace_canary',
    request_id: 'request_canary',
    change_id: 'change_request_canary',
    canary_session_id: 'canary_public_web_session',
    operator_id: 'operator_public_web',
    operator_role: 'integration_operator',
    environment: 'development',
    target_origin: 'https://public-canary.test',
    target_path: '/allowed/page',
    source_type: 'public_product_page',
    operation: 'fetch_public_page_summary',
    reason: 'synthetic canary validation',
    requested_at: '2026-07-16T12:00:00.000Z',
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_public_web_synthetic',
    feature_flag_enabled: true,
    kill_switch_active: false,
    rollout_percentage: 1,
    maximum_requests: 1,
    lifecycle_version: 4,
    configuration_version: 3,
    readiness_evidence: validReadinessEvidence(),
    expires_at: '2026-07-16T12:30:00.000Z',
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function validApproval(session, overrides = {}) {
  return {
    trace_id: 'trace_canary_approval',
    request_id: 'request_canary_approval',
    change_id: 'change_approve_canary',
    canary_session_id: session.canary_session_id,
    approval_id: 'approval_public_web_canary',
    approved_by: 'security_approver',
    approver_role: 'security_operator',
    reason: 'bounded synthetic canary approval',
    scope: 'one tenant one workspace one user one request',
    environment: session.environment,
    target_origin: session.target_origin,
    operation: session.operation,
    maximum_requests: session.maximum_requests,
    expires_at: session.expires_at,
    evidence_snapshot_hash: session.readiness_evidence_id,
    lifecycle_version: session.lifecycle_version,
    configuration_version: session.configuration_version,
    approved_at: '2026-07-16T12:01:00.000Z',
    expected_version: session.version,
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function validTargetPolicy(overrides = {}) {
  return {
    target_policy_id: 'target_policy_public_canary',
    environment: 'development',
    origin: 'https://public-canary.test',
    allowed_path_prefixes: ['/allowed'],
    allowed_operations: ['fetch_public_page_summary'],
    allowed_source_types: ['public_product_page'],
    allowed_content_types: ['text/html', 'text/plain', 'application/json'],
    maximum_requests: 1,
    maximum_response_bytes: 1048576,
    timeout_ms: 8000,
    redirects_allowed: false,
    enabled: true,
    revoked: false,
    expires_at: '2026-07-16T12:30:00.000Z',
    approved_by: 'security_approver',
    created_at: '2026-07-16T12:00:00.000Z',
    version: 1,
    ...overrides
  };
}

function validTargetAllowlist() {
  const allowlist = createPublicWebCanaryTargetAllowlist({
    dnsResolver: fakeDnsResolver(),
    clock: deterministicClock
  });
  const result = allowlist.registerTargetPolicy(validTargetPolicy());
  if (!result.ok) throw new Error(`target allowlist setup failed: ${JSON.stringify(result)}`);
  return allowlist;
}

function validDnsResolver(overrides = {}) {
  return createPublicWebSafeDnsResolver({
    resolver: async (hostname) => fakeDnsResolver(overrides)(hostname),
    syncResolver: fakeDnsResolver(overrides),
    ttlMs: 30000
  });
}

function validCanaryRegistry() {
  return createPublicWebCanarySessionRegistry({
    clock: deterministicClock,
    maxHistoryPerSession: 20
  });
}

function validCanaryContext(overrides = {}) {
  const secretReference = validSecretReference({
    reference_id: 'public_web_local_reference',
    environment: 'local_test'
  });
  return {
    canarySessionRegistry: validCanaryRegistry(),
    targetAllowlist: validTargetAllowlist(),
    adapterRegistry: validAdapterRegistry(),
    lifecycleRegistry: validLifecycleRegistry(),
    configurationRegistry: validConfigurationRegistry(),
    secretReferenceRegistry: validSecretReferenceRegistry(secretReference),
    secretResolver: validLocalSecretResolver(),
    readinessResult: validReadinessEvidence(),
    publicWebPilotGate: evaluatePublicWebPilotGate,
    nodeHttpsClient: fakeNodeHttpsClient(),
    dnsResolver: validDnsResolver(),
    rateLimitBudget: createPublicWebPilotBudget({ clock: deterministicClock }),
    costBudget: createPublicWebPilotBudget({ clock: deterministicClock }),
    featureFlagResolver: () => true,
    killSwitchResolver: () => false,
    tenantAllowlist: ['grupo_erick'],
    workspaceAllowlist: ['corporate'],
    userAllowlist: ['user_public_web_synthetic'],
    operatorPolicy: createPublicWebCanaryOperatorPolicy(),
    auditSink: createPublicWebCanaryAuditSink(),
    clock: deterministicClock,
    secretReference,
    secretAccessContext: {
      trace_id: 'trace_secret_access',
      request_id: 'request_secret_access',
      configuration_id: CONFIGURATION_ID,
      connector_id: CONNECTOR_ID,
      provider_id: PROVIDER_ID,
      adapter_id: ADAPTER_ID,
      workspace_type: 'corporate',
      tenant_id: 'grupo_erick',
      environment: 'local_test',
      purpose: 'local_test_readiness_validation',
      requested_by: 'operator_public_web',
      simulated: true,
      executed: false,
      real_provider_called: false
    },
    ...overrides
  };
}

module.exports = {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  deterministicClock,
  fakeDnsResolver,
  fakeBodyStream,
  fakeNodeHttpsClient,
  validCanaryRequest,
  validApproval,
  validTargetPolicy,
  validTargetAllowlist,
  validDnsResolver,
  validCanaryRegistry,
  validCanaryContext
};
