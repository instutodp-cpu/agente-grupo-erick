'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planAdapterExecution } = require('../src/core/adapter-execution');

test('planeja execucao sem habilitar adapters', () => {
  const result = planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123' },
    decision: 'approved',
    capability: { requiredAdapters: ['DataStore', 'ModelProvider'] }
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'adapter_execution_disabled',
    required_adapters_count: 2
  });
});

test('planeja execucao com zero adapters quando capability nao tem lista', () => {
  const result = planAdapterExecution({
    confirmation: { confirmation_id: 'confirm_123' },
    decision: 'approved',
    capability: {}
  });

  assert.deepEqual(result, {
    execution_allowed: false,
    executed: false,
    reason: 'adapter_execution_disabled',
    required_adapters_count: 0
  });
});
