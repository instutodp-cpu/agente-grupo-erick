'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runMockAdapter } = require('../src/core/mock-adapter-runner');

test('mock runner simula compras sem side effects', () => {
  assert.deepEqual(runMockAdapter({ domain: 'compras' }), {
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras',
    simulated: true,
    executed: false,
    status: 'simulated',
    message: 'Mock adapter simulation completed without real execution.'
  });
});

test('mock runner retorna not_available para dominio desconhecido', () => {
  assert.deepEqual(runMockAdapter({ domain: 'desconhecido' }), {
    adapter_mode: 'mock',
    simulated: false,
    executed: false,
    status: 'not_available',
    message: 'Mock adapter not available for this domain.'
  });
});
