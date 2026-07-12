'use strict';

function metadata(overrides = {}) {
  return {
    adapter_id: 'mock_success_adapter',
    provider_id: 'manual_fixture_provider',
    provider_type: 'public_web',
    adapter_kind: 'mock',
    version: '1.0.0',
    supported_workspace_types: ['corporate'],
    supported_domains: ['marketing'],
    supported_capabilities: ['public_web_summary'],
    supported_operations: ['read_summary', 'list_summary', 'health_check_mock'],
    readiness_candidate_id: 'candidate_mock_success',
    feature_flag_key: 'read_only_adapter.mock_success',
    timeout_ms: 1000,
    retry_policy: {
      strategy: 'none',
      max_attempts: 0
    },
    cost_risk: 'low',
    rate_limit_risk: 'low',
    data_classification: 'synthetic',
    deprecated: false,
    enabled: true,
    tenant_strategy: 'corporate_grupo_erick',
    ...overrides
  };
}

function mockResponse(overrides = {}) {
  return {
    status: 'adapter_mock_success',
    safe_summary: 'Synthetic mock adapter response.',
    data: {
      summary: 'Synthetic sanitized result.'
    },
    simulated: true,
    executed: true,
    real_provider_called: false,
    can_trigger_real_execution: false,
    ...overrides
  };
}

const mock_success_adapter = {
  metadata: metadata(),
  execute: () => mockResponse()
};

const mock_timeout_adapter = {
  metadata: metadata({
    adapter_id: 'mock_timeout_adapter',
    readiness_candidate_id: 'candidate_mock_timeout',
    feature_flag_key: 'read_only_adapter.mock_timeout',
    timeout_ms: 25
  }),
  execute: () => new Promise(() => {})
};

const mock_throw_adapter = {
  metadata: metadata({
    adapter_id: 'mock_throw_adapter',
    readiness_candidate_id: 'candidate_mock_throw',
    feature_flag_key: 'read_only_adapter.mock_throw'
  }),
  execute: () => {
    throw new Error('synthetic adapter failure');
  }
};

const mock_unsafe_response_adapter = {
  metadata: metadata({
    adapter_id: 'mock_unsafe_response_adapter',
    readiness_candidate_id: 'candidate_mock_unsafe',
    feature_flag_key: 'read_only_adapter.mock_unsafe'
  }),
  execute: () => mockResponse({
    data: {
      safe: 'value',
      accessToken: 'never-return-this'
    }
  })
};

const real_candidate_adapter = {
  metadata: metadata({
    adapter_id: 'real_candidate_adapter',
    provider_id: 'future_provider_candidate',
    adapter_kind: 'real_read_only_candidate',
    readiness_candidate_id: 'candidate_real_read_only',
    feature_flag_key: 'read_only_adapter.real_candidate',
    enabled: false,
    retry_policy: {
      strategy: 'none',
      max_attempts: 0
    }
  }),
  execute: () => mockResponse()
};

const real_adapter_forbidden_test = {
  metadata: metadata({
    adapter_id: 'real_adapter_forbidden_test',
    provider_id: 'future_provider_real',
    adapter_kind: 'real_read_only',
    readiness_candidate_id: 'candidate_real_forbidden',
    feature_flag_key: 'read_only_adapter.real_forbidden',
    enabled: false
  }),
  execute: () => mockResponse()
};

module.exports = {
  metadata,
  mockResponse,
  mock_success_adapter,
  mock_timeout_adapter,
  mock_throw_adapter,
  mock_unsafe_response_adapter,
  real_candidate_adapter,
  real_adapter_forbidden_test
};
