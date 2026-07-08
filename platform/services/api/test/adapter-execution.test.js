'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planAdapterExecution } = require('../src/core/adapter-execution');
const { runMockAdapter } = require('../src/core/mock-adapter-runner');

function captureLogs(fn) {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    return { result: fn(), logs };
  } finally {
    console.log = originalLog;
  }
}

test('planeja execucao sem habilitar adapters', () => {
  const { result, logs } = captureLogs(() => planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123', trace_id: 'trace-123' },
    decision: 'approved',
    capability: { domain: 'compras', intent: 'registrar_compra', requiredAdapters: ['DataStore', 'ModelProvider'] },
    env: {}
  }));

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
  assert.equal(result.mock_adapter, null);
  assert.equal(logs.some((log) => log.event === 'adapter_audit_event_created' && log.event_type === 'adapter_execution_blocked'), true);
  assert.equal(logs.some((log) => log.event === 'adapter_audit_event_created'), true);
});

test('planeja execucao com mock de dominio conhecido', () => {
  const { result, logs } = captureLogs(() => planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123', trace_id: 'trace-123' },
    decision: 'approved',
    capability: { domain: 'financeiro', intent: 'consultar_financeiro', requiredAdapters: ['DataStore'] },
    env: { HERMES_EXECUTION_ENABLED: 'true' }
  }));

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
  assert.equal(logs.some((log) => log.event === 'adapter_audit_event_created' && log.event_type === 'adapter_execution_blocked'), false);
  assert.equal(logs.filter((log) => log.event === 'adapter_audit_event_created').length, 2);
});

test('kill switch bloqueia tudo', () => {
  const { result, logs } = captureLogs(() => planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123', trace_id: 'trace-123' },
    decision: 'approved',
    capability: { domain: 'desconhecido', intent: 'desconhecido', requiredAdapters: [] },
    env: { HERMES_EXECUTION_ENABLED: 'true', HERMES_EXECUTION_KILL_SWITCH: 'true' }
  }));

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
  assert.equal(result.mock_adapter, null);
  assert.equal(logs.some((log) => log.event === 'adapter_audit_event_created' && log.event_type === 'adapter_execution_blocked'), true);
});

test('planeja not_available para dominio desconhecido', () => {
  const { result, logs } = captureLogs(() => planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123', trace_id: 'trace-123' },
    decision: 'approved',
    capability: { domain: 'desconhecido', intent: 'desconhecido', requiredAdapters: [] },
    env: { HERMES_EXECUTION_ENABLED: 'true' }
  }));

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
  assert.equal(result.mock_adapter.status, 'not_available');
  assert.equal(logs.some((log) => log.event === 'adapter_audit_event_created' && log.event_type === 'adapter_execution_blocked'), true);
});
