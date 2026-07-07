'use strict';

const { getDomainMockAdapter } = require('./domain-mock-adapter-registry');

function runMockAdapter({ domain } = {}) {
  const adapter = getDomainMockAdapter(domain);

  if (!adapter) {
    return {
      adapter_mode: 'mock',
      simulated: false,
      executed: false,
      status: 'not_available',
      message: 'Mock adapter not available for this domain.'
    };
  }

  return {
    ...adapter,
    simulated: true,
    executed: false,
    status: 'simulated',
    message: 'Mock adapter simulation completed without real execution.'
  };
}

module.exports = { runMockAdapter };
