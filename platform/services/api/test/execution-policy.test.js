'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getExecutionPolicy } = require('../src/core/execution-policy');

test('sem env, execution_enabled=false', () => {
  assert.deepEqual(getExecutionPolicy({}), {
    execution_enabled: false,
    kill_switch_active: false,
    reason: 'execution_disabled_by_default'
  });
});

test('HERMES_EXECUTION_ENABLED=true habilita a policy, mas nao executa nada ainda', () => {
  assert.deepEqual(getExecutionPolicy({ HERMES_EXECUTION_ENABLED: 'true' }), {
    execution_enabled: true,
    kill_switch_active: false,
    reason: 'execution_enabled_by_env'
  });
});

test('HERMES_EXECUTION_KILL_SWITCH=true bloqueia tudo', () => {
  assert.deepEqual(getExecutionPolicy({
    HERMES_EXECUTION_ENABLED: 'true',
    HERMES_EXECUTION_KILL_SWITCH: 'true'
  }), {
    execution_enabled: false,
    kill_switch_active: true,
    reason: 'execution_kill_switch_active'
  });
});

test('valores invalidos caem para disabled', () => {
  assert.deepEqual(getExecutionPolicy({
    HERMES_EXECUTION_ENABLED: 'maybe',
    HERMES_EXECUTION_KILL_SWITCH: 'nope'
  }), {
    execution_enabled: false,
    kill_switch_active: false,
    reason: 'execution_disabled_by_default'
  });
});
