'use strict';

const { getExecutionPolicy } = require('./execution-policy');
const { runMockAdapter } = require('./mock-adapter-runner');

function planAdapterExecution({ confirmation, decision, capability, env = process.env }) {
  const policy = getExecutionPolicy(env);
  const requiredAdaptersCount = Array.isArray(capability && capability.requiredAdapters)
    ? capability.requiredAdapters.length
    : 0;
  const canSimulate = Boolean(
    policy.execution_enabled &&
    !policy.kill_switch_active &&
    decision === 'approved' &&
    confirmation
  );
  const simulation = canSimulate ? runMockAdapter({ confirmation, capability }) : null;
  const reason = policy.kill_switch_active
    ? 'execution_kill_switch_active'
    : policy.execution_enabled
      ? (canSimulate ? 'adapter_execution_simulated' : 'adapter_execution_not_implemented')
      : 'execution_disabled_by_policy';
  const executionStatus = policy.kill_switch_active || !policy.execution_enabled
    ? 'disabled'
    : canSimulate
      ? 'simulated'
      : 'not_requested';

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
    execution_status: executionStatus,
    simulated: Boolean(simulation),
    mock_adapter: simulation,
    execution_policy_evaluation: policy
  };
}

module.exports = { planAdapterExecution };
