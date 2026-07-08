'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planAdapterExecution } = require('../src/core/adapter-execution');
const { runMockAdapter } = require('../src/core/mock-adapter-runner');

test('planeja execucao sem habilitar adapters', () => {
  const result = planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123' },
    decision: 'approved',
    capability: { requiredAdapters: ['DataStore', 'ModelProvider'] },
    env: {}
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'execution_disabled_by_policy',
    required_adapters_count: 2,
    execution_policy: 'disabled',
    execution_status: 'disabled',
    simulated: false,
    mock_adapter: null,
    adapter_id: null,
    adapter_mode: null,
    execution_policy_evaluation: {
      execution_enabled: false,
      kill_switch_active: false,
      reason: 'execution_disabled_by_default'
    }
  });
});

test('planeja execucao com mock de dominio conhecido', () => {
  const result = planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123' },
    decision: 'approved',
    capability: { domain: 'financeiro', requiredAdapters: ['DataStore'] },
    env: { HERMES_EXECUTION_ENABLED: 'true' }
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'adapter_execution_simulated',
    required_adapters_count: 1,
    execution_policy: 'not_implemented',
    execution_status: 'simulated',
    simulated: true,
    mock_adapter: {
      adapter_id: 'mock-financeiro',
      adapter_mode: 'mock',
      domain: 'financeiro',
      simulated: true,
      executed: false,
      status: 'simulated',
      message: 'Mock adapter simulation completed without real execution.'
    },
    adapter_id: 'mock-financeiro',
    adapter_mode: 'mock',
    execution_policy_evaluation: {
      execution_enabled: true,
      kill_switch_active: false,
      reason: 'execution_enabled_by_env'
    }
  });
});

test('kill switch bloqueia tudo', () => {
  const result = planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123' },
    decision: 'approved',
    capability: { domain: 'desconhecido', requiredAdapters: [] },
    env: { HERMES_EXECUTION_ENABLED: 'true', HERMES_EXECUTION_KILL_SWITCH: 'true' }
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'execution_kill_switch_active',
    required_adapters_count: 0,
    execution_policy: 'kill_switch_active',
    execution_status: 'disabled',
    simulated: false,
    mock_adapter: null,
    adapter_id: null,
    adapter_mode: null,
    execution_policy_evaluation: {
      execution_enabled: false,
      kill_switch_active: true,
      reason: 'execution_kill_switch_active'
    }
  });
});

test('planeja not_available para dominio desconhecido', () => {
  const result = planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123' },
    decision: 'approved',
    capability: { domain: 'desconhecido', requiredAdapters: [] },
    env: { HERMES_EXECUTION_ENABLED: 'true' }
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'adapter_execution_not_available',
    required_adapters_count: 0,
    execution_policy: 'not_implemented',
    execution_status: 'not_available',
    simulated: false,
    mock_adapter: {
      adapter_id: null,
      adapter_mode: 'mock',
      domain: 'desconhecido',
      simulated: false,
      executed: false,
      status: 'not_available',
      message: 'Mock adapter not available for this domain.'
    },
    adapter_id: null,
    adapter_mode: null,
    execution_policy_evaluation: {
      execution_enabled: true,
      kill_switch_active: false,
      reason: 'execution_enabled_by_env'
    }
  });
});
