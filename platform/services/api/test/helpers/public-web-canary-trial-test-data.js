'use strict';

const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  hashValue
} = require('../../src/core/public-web-transport-contract');

function deterministicClock() {
  return '2026-01-01T00:00:00.000Z';
}

function validTrialConfig(overrides = {}) {
  return {
    trial_id: 'public_web_trial_test_001',
    environment: 'development',
    target_policy_id: 'target_policy_public_web_trial',
    target_origin: 'https://public-canary.test',
    target_path: '/docs',
    source_type: 'public_documentation_page',
    operation: 'fetch_public_page_summary',
    requested_content_types: ['text/html'],
    maximum_requests: 1,
    rollout_percentage: 1,
    timeout_ms: 3000,
    maximum_response_bytes: 100000,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_public_web_trial_operator',
    operator_id: 'operator_local',
    operator_role: 'integration_operator',
    approver_id: 'security_approver_local',
    approver_role: 'security_operator',
    reason: 'manual controlled public web canary trial',
    ...overrides
  };
}

function validTargetAllowlist() {
  return {
    isTargetAllowed(origin, path) {
      return {
        allowed: origin === 'https://public-canary.test' && path === '/docs',
        target_policy: {
          target_policy_id: 'target_policy_public_web_trial',
          enabled: true,
          revoked: false,
          timeout_ms: 3000,
          maximum_response_bytes: 100000,
          maximum_requests: 1,
          allowed_content_types: ['text/html'],
          redirects_allowed: false
        }
      };
    },
    disableTargetPolicy() {
      return { ok: true, applied: true };
    }
  };
}

function fakeAuditSink() {
  const events = [];
  return {
    append(event) {
      events.push(JSON.parse(JSON.stringify(event)));
      return { ok: true };
    },
    list() {
      return events.map((event) => JSON.parse(JSON.stringify(event)));
    }
  };
}

function validPreflightContext(overrides = {}) {
  return {
    clock: deterministicClock,
    featureFlagResolver: () => true,
    killSwitchResolver: () => false,
    adapterRegistry: {
      getAdapter: () => ({ metadata: { adapter_id: ADAPTER_ID, provider_id: PROVIDER_ID, readiness_candidate_id: READINESS_CANDIDATE_ID } })
    },
    lifecycleRegistry: {
      getConnector: () => ({
        connector_id: CONNECTOR_ID,
        provider_id: PROVIDER_ID,
        adapter_id: ADAPTER_ID,
        lifecycle_version: 1,
        lifecycle_state: 'readiness_passed'
      })
    },
    configurationRegistry: {
      getConfiguration: () => ({
        configuration_id: CONFIGURATION_ID,
        provider_id: PROVIDER_ID,
        adapter_id: ADAPTER_ID,
        configuration_status: 'structurally_ready',
        configuration_version: 1,
        secret_reference_id: 'secret_ref_local_test'
      })
    },
    secretReferenceRegistry: {
      getSecretReference: () => ({
        reference_id: 'secret_ref_local_test',
        provider_id: PROVIDER_ID,
        tenant_id: 'grupo_erick',
        workspace_type: 'corporate',
        environment: 'local_test',
        reference_type: 'local_test_double_reference',
        status: 'reference_registered',
        revoked: false,
        disabled: false,
        synthetic: true
      })
    },
    secretResolver: {
      canResolve: () => true
    },
    readinessResult: {
      ready: true,
      status: 'configuration_structurally_ready',
      readiness_candidate_id: READINESS_CANDIDATE_ID,
      evidence_hash: hashValue('readiness')
    },
    targetAllowlist: validTargetAllowlist(),
    tenantAllowlist: ['grupo_erick'],
    workspaceAllowlist: ['corporate'],
    userAllowlist: ['user_public_web_trial_operator'],
    operatorPolicy: {
      canRequest: () => true,
      canApprove: () => true
    },
    rateLimitBudget: {
      check: () => ({ allowed: true }),
      release: () => ({ ok: true })
    },
    costBudget: {
      check: () => ({ allowed: true }),
      release: () => ({ ok: true })
    },
    auditSink: fakeAuditSink(),
    dnsResolver: {
      resolve: async () => ({ allowed: true, approved_ip: '93.184.216.34', approved_ips: ['93.184.216.34'] })
    },
    nodeHttpsClient: {
      execute: async () => ({ status_code: 200 })
    },
    ...overrides
  };
}

function fakeCanaryRunner(result = {}) {
  let calls = 0;
  return {
    async runCanaryRequest(input) {
      calls += 1;
      if (typeof input.onFakeProviderCall === 'function') input.onFakeProviderCall();
      return {
        status: 'public_web_candidate_success',
        fake_provider_calls: 1,
        executed: true,
        real_provider_called: true,
        result_count: 1,
        bytes_received: 512,
        duration_ms: 42,
        http_status_class: '2xx',
        audit_event_candidate: { event_name: 'public_web_canary_request_succeeded' },
        ...result
      };
    },
    get calls() {
      return calls;
    }
  };
}

function fakeDryRunRunner() {
  return fakeCanaryRunner({ real_provider_called: false, fake_provider_calls: 1, session_state: 'completed' });
}

function acceptedConfirmationReader() {
  return 'EXECUTAR CANARY PUBLIC WEB';
}

function rejectedConfirmationReader() {
  return 'sim';
}

module.exports = {
  deterministicClock,
  validTrialConfig,
  validPreflightContext,
  fakeCanaryRunner,
  fakeDryRunRunner,
  acceptedConfirmationReader,
  rejectedConfirmationReader
};
