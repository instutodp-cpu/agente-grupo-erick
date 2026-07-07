'use strict';

function runMockAdapter() {
  return {
    adapter_mode: 'mock',
    simulated: true,
    executed: false,
    status: 'simulated',
    message: 'Mock adapter simulation completed without real execution.'
  };
}

module.exports = { runMockAdapter };
