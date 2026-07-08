'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAdapterResult,
  sanitizeAdapterResult,
  validateAdapterResult
} = require('../src/core/adapter-result-contract');
const { runMockAdapter } = require('../src/core/mock-adapter-runner');

const EXPECTED = {
  compras: 'mock-compras',
  financeiro: 'mock-financeiro',
  treinamento: 'mock-treinamento',
  marketing: 'mock-marketing',
  desenvolvimento: 'mock-desenvolvimento'
};

for (const [domain, adapterId] of Object.entries(EXPECTED)) {
  test(`mock-${domain} retorna contrato seguro`, () => {
    const result = runMockAdapter({ domain });

    assert.deepEqual(result, {
      adapter_id: adapterId,
      adapter_mode: 'mock',
      domain,
      status: 'simulated',
      simulated: true,
      executed: false,
      message: 'Mock adapter simulation completed without real execution.'
    });

    const validation = validateAdapterResult(result);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);
  });
}

test('sanitize remove requiredAdapters, payload e campos proibidos', () => {
  const { result, removed_fields_count } = sanitizeAdapterResult({
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras',
    status: 'simulated',
    simulated: true,
    executed: false,
    message: 'ok',
    requiredAdapters: ['DataStore'],
    payload: { token: 'secret' },
    rawMessage: 'mensagem crua',
    userMessage: 'usuario',
    secret: 's',
    token: 't',
    env: { SECRET: 'x' },
    internal: { nested: true },
    credentials: { apiKey: 'key' }
  });

  assert.equal(removed_fields_count >= 8, true);
  assert.deepEqual(result, {
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras',
    status: 'simulated',
    simulated: true,
    executed: false,
    message: 'ok'
  });
});

test('validate rejeita executed:true e aceita executed:false', () => {
  const invalid = validateAdapterResult({
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras',
    status: 'simulated',
    simulated: true,
    executed: true,
    message: 'ok'
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.includes('executed must be false'), true);

  const valid = validateAdapterResult({
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras',
    status: 'simulated',
    simulated: true,
    executed: false,
    message: 'ok'
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, []);
});

test('buildAdapterResult normaliza executed:true para false', () => {
  const result = buildAdapterResult({
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras',
    status: 'simulated',
    simulated: true,
    executed: true,
    message: 'ok'
  });

  assert.deepEqual(result, {
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras',
    status: 'simulated',
    simulated: true,
    executed: false,
    message: 'ok'
  });

  const validation = validateAdapterResult(result);
  assert.equal(validation.valid, true);
});
