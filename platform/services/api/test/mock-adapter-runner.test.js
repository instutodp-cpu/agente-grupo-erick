'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runMockAdapter } = require('../src/core/mock-adapter-runner');

test('mock runner simula sem side effects', () => {
  assert.deepEqual(runMockAdapter(), {
    adapter_mode: 'mock',
    simulated: true,
    executed: false,
    status: 'simulated',
    message: 'Mock adapter simulation completed without real execution.'
  });
});
