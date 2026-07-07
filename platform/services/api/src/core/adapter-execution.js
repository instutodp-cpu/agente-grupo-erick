'use strict';

function planAdapterExecution({ confirmation, decision, capability }) {
  const requiredAdaptersCount = Array.isArray(capability && capability.requiredAdapters)
    ? capability.requiredAdapters.length
    : 0;

  return {
    execution_allowed: false,
    executed: false,
    reason: 'adapter_execution_disabled',
    required_adapters_count: requiredAdaptersCount,
  };
}

module.exports = { planAdapterExecution };
