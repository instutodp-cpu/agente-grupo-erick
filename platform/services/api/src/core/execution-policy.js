'use strict';

function parseStrictBoolean(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function getExecutionPolicy(env = process.env) {
  const killSwitchActive = parseStrictBoolean(env && env.HERMES_EXECUTION_KILL_SWITCH);
  const executionEnabledRequested = parseStrictBoolean(env && env.HERMES_EXECUTION_ENABLED);

  if (killSwitchActive) {
    return {
      execution_enabled: false,
      kill_switch_active: true,
      reason: 'execution_kill_switch_active'
    };
  }

  if (executionEnabledRequested) {
    return {
      execution_enabled: true,
      kill_switch_active: false,
      reason: 'execution_enabled_by_env'
    };
  }

  return {
    execution_enabled: false,
    kill_switch_active: false,
    reason: 'execution_disabled_by_default'
  };
}

module.exports = { getExecutionPolicy };
