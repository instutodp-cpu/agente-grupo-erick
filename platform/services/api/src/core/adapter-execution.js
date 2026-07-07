'use strict';

const { getExecutionPolicy } = require('./execution-policy');

function planAdapterExecution({ confirmation, decision, capability, env = process.env }) {
  const policy = getExecutionPolicy(env);
  const requiredAdaptersCount = Array.isArray(capability && capability.requiredAdapters)
    ? capability.requiredAdapters.length
    : 0;
  const reason = policy.kill_switch_active
    ? 'execution_kill_switch_active'
    : policy.execution_enabled
      ? 'adapter_execution_not_implemented'
      : 'execution_disabled_by_policy';

  return {
    execution_allowed: false,
    executed: false,
    reason,
    required_adapters_count: requiredAdaptersCount,
    execution_policy: policy.kill_switch_active
      ? 'kill_switch_active'
      : policy.execution_enabled
        ? 'not_implemented'
        : 'disabled',
    execution_policy_evaluation: policy
  };
}

module.exports = { planAdapterExecution };
