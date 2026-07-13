'use strict';

const {
  createReadOnlyAdapterRegistry
} = require('../../src/core/read-only-adapter-registry');
const {
  metadata,
  mockResponse
} = require('./read-only-test-adapters');

function validConnectorRecord(overrides = {}) {
  return {
    connector_id: 'connector_public_web_fixture',
    connector_type: 'public_web',
    provider_id: 'manual_fixture_provider',
    provider_type: 'public_web',
    adapter_id: 'mock_lifecycle_adapter',
    adapter_kind: 'mock',
    readiness_candidate_id: 'candidate_lifecycle_public_web',
    lifecycle_state: 'registered',
    lifecycle_version: 1,
    workspace_types: ['corporate'],
    tenant_strategy: 'corporate_grupo_erick',
    domains: ['marketing'],
    capabilities: ['public_web_summary'],
    operations: ['read_summary', 'list_summary'],
    owner_id: 'owner_synthetic',
    reviewer_ids: ['reviewer_synthetic'],
    feature_flag_key: 'connector.lifecycle.public_web',
    feature_flag_default: false,
    kill_switch_key: 'kill.connector.lifecycle.public_web',
    runtime_enabled: false,
    real_provider_enabled: false,
    execution_mode: 'contract_only',
    rollout_stage: 'contract',
    risk_level: 'low',
    cost_risk: 'low',
    rate_limit_risk: 'low',
    data_classification: 'synthetic',
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
    deprecated: false,
    retired: false,
    metadata: {
      mock_parity_declared: true,
      no_write_guarantee: true
    },
    contract_refs: [
      'READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md',
      'REAL_READ_ONLY_ADAPTER_READINESS_GATE.md'
    ],
    ...overrides
  };
}

function validTransitionRequest(overrides = {}) {
  return {
    trace_id: 'trace_lifecycle_fixture',
    transition_id: `transition_lifecycle_fixture_${overrides.transition_event || 'nominate_candidate'}_${overrides.expected_version || 1}`,
    connector_id: 'connector_public_web_fixture',
    transition_event: 'nominate_candidate',
    expected_version: 1,
    actor_id: 'actor_synthetic',
    actor_role: 'operator',
    reason: 'synthetic_contract_transition',
    requested_at: '2026-07-12T00:01:00.000Z',
    evidence: {},
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function readyReadinessResult(overrides = {}) {
  return {
    trace_id: 'trace_readiness_fixture',
    candidate_id: 'candidate_lifecycle_public_web',
    provider_id: 'manual_fixture_provider',
    adapter_id: 'mock_lifecycle_adapter',
    status: 'ready_for_real_read_only_pr',
    verdict: 'allow_future_read_only_pr',
    ready: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    evaluated_requirements: ['synthetic_requirement'],
    satisfied_requirements: ['synthetic_requirement'],
    blocking_requirements: [],
    warning_requirements: [],
    blocking_reasons: [],
    next_steps: ['future_pr_required'],
    audit_event_candidate: {
      event_name: 'readiness_gate_evaluated',
      simulated: true,
      executed: false,
      real_provider_called: false
    },
    ...overrides
  };
}

function mockLifecycleAdapter(overrides = {}) {
  return {
    metadata: metadata({
      adapter_id: 'mock_lifecycle_adapter',
      provider_id: 'manual_fixture_provider',
      provider_type: 'public_web',
      adapter_kind: 'mock',
      supported_workspace_types: ['corporate'],
      supported_domains: ['marketing'],
      supported_capabilities: ['public_web_summary'],
      supported_operations: ['read_summary', 'list_summary'],
      readiness_candidate_id: 'candidate_lifecycle_public_web',
      feature_flag_key: 'connector.lifecycle.public_web',
      tenant_strategy: 'corporate_grupo_erick',
      ...overrides.metadata
    }),
    execute: () => mockResponse({
      safe_summary: 'Synthetic lifecycle mock response.'
    }),
    ...overrides.adapter
  };
}

function createMockAdapterRegistry(...adapters) {
  return createReadOnlyAdapterRegistry(adapters.length > 0 ? adapters : [mockLifecycleAdapter()]);
}

function registeredConnector(overrides = {}) {
  return validConnectorRecord({
    lifecycle_state: 'registered',
    lifecycle_version: 1,
    execution_mode: 'contract_only',
    rollout_stage: 'contract',
    runtime_enabled: false,
    ...overrides
  });
}

function candidateConnector(overrides = {}) {
  return validConnectorRecord({
    lifecycle_state: 'candidate',
    lifecycle_version: 2,
    execution_mode: 'contract_only',
    rollout_stage: 'contract',
    runtime_enabled: false,
    ...overrides
  });
}

function mockOnlyConnector(overrides = {}) {
  return validConnectorRecord({
    lifecycle_state: 'mock_only',
    lifecycle_version: 3,
    execution_mode: 'mock_only',
    rollout_stage: 'mock',
    runtime_enabled: true,
    ...overrides
  });
}

function blockedConnector(overrides = {}) {
  return validConnectorRecord({
    lifecycle_state: 'blocked',
    lifecycle_version: 3,
    execution_mode: 'contract_only',
    rollout_stage: 'contract',
    runtime_enabled: false,
    ...overrides
  });
}

function deprecatedConnector(overrides = {}) {
  return validConnectorRecord({
    lifecycle_state: 'deprecated',
    lifecycle_version: 4,
    execution_mode: 'contract_only',
    rollout_stage: 'contract',
    runtime_enabled: false,
    deprecated: true,
    ...overrides
  });
}

module.exports = {
  validConnectorRecord,
  validTransitionRequest,
  readyReadinessResult,
  mockLifecycleAdapter,
  createMockAdapterRegistry,
  registeredConnector,
  candidateConnector,
  mockOnlyConnector,
  blockedConnector,
  deprecatedConnector
};
