'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planAdapterExecution } = require('../src/core/adapter-execution');
const { runMockAdapter } = require('../src/core/mock-adapter-runner');

test('mock adapter simula sem executar nada real', () => {
  assert.deepEqual(runMockAdapter(), {
    adapter_mode: 'mock',
    simulated: true,
    executed: false,
    status: 'simulated',
    message: 'Mock adapter simulation completed without real execution.'
  });
});

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
    execution_policy_evaluation: {
      execution_enabled: false,
      kill_switch_active: false,
      reason: 'execution_disabled_by_default'
    }
  });
});

test('planeja execucao com zero adapters quando capability nao tem lista', () => {
  const result = planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123' },
    decision: 'approved',
    capability: {},
    env: { HERMES_EXECUTION_ENABLED: 'true' }
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'adapter_execution_simulated',
    required_adapters_count: 0,
    execution_policy: 'not_implemented',
    execution_status: 'simulated',
    simulated: true,
    mock_adapter: {
      adapter_mode: 'mock',
      simulated: true,
      executed: false,
      status: 'simulated',
      message: 'Mock adapter simulation completed without real execution.'
    },
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
    capability: { requiredAdapters: ['DataStore'] },
    env: { HERMES_EXECUTION_ENABLED: 'true', HERMES_EXECUTION_KILL_SWITCH: 'true' }
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'execution_kill_switch_active',
    required_adapters_count: 1,
    execution_policy: 'kill_switch_active',
    execution_status: 'disabled',
    simulated: false,
    mock_adapter: null,
    execution_policy_evaluation: {
      execution_enabled: false,
      kill_switch_active: true,
      reason: 'execution_kill_switch_active'
    }
  });
});
