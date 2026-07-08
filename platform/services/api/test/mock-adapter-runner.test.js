'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runMockAdapter } = require('../src/core/mock-adapter-runner');

test('mock runner simula compras sem side effects', () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    assert.deepEqual(runMockAdapter({ domain: 'compras' }), {
      adapter_id: 'mock-compras',
      adapter_mode: 'mock',
      domain: 'compras',
      simulated: true,
      executed: false,
      status: 'simulated',
      message: 'Mock adapter simulation completed without real execution.'
    });
    assert.equal(logs.filter((log) => log.event === 'adapter_audit_event_created').length, 2);
    assert.equal(logs.filter((log) => log.event === 'adapter_audit_event_sanitized').length, 2);
    assert.equal(logs.filter((log) => log.event === 'adapter_audit_event_validated').length, 2);
    assert.equal(logs.some((log) => log.event === 'adapter_result_sanitized'), true);
    assert.equal(logs.some((log) => log.event === 'adapter_result_validated'), true);
    assert.equal(JSON.stringify(logs).includes('mensagem'), false);
  } finally {
    console.log = originalLog;
  }
});

test('mock runner retorna not_available para dominio desconhecido', () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    assert.deepEqual(runMockAdapter({ domain: 'desconhecido' }), {
      adapter_id: null,
      adapter_mode: 'mock',
      domain: 'desconhecido',
      simulated: false,
      executed: false,
      status: 'not_available',
      message: 'Mock adapter not available for this domain.'
    });
    assert.equal(logs.some((log) => log.event === 'adapter_result_sanitized'), true);
    assert.equal(logs.some((log) => log.event === 'adapter_result_validated'), true);
  } finally {
    console.log = originalLog;
  }
});
