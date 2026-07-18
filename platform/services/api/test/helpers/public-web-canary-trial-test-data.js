'use strict';

const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID
} = require('../../src/core/public-web-transport-contract');
const {
  validCanaryContext,
  fakeNodeHttpsClient
} = require('./public-web-canary-test-data');

function deterministicClock() {
  return '2026-01-01T00:00:00.000Z';
}

function validTrialConfig(overrides = {}) {
  return {
    trial_id: 'public_web_trial_test_001',
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
    reason: 'manual controlled public web canary trial',
    ...overrides
  };
}

function validPreflightContext(overrides = {}) {
  const context = validCanaryContext({
    clock: deterministicClock,
    ...overrides
  });
  return context;
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
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID,
  deterministicClock,
  validTrialConfig,
  validPreflightContext,
  fakeCanaryRunner,
  fakeNodeHttpsClient,
  fakeDryRunRunner,
  acceptedConfirmationReader,
  rejectedConfirmationReader
};
