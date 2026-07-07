'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDomainMockAdapter,
  listDomainMockAdapters
} = require('../src/core/domain-mock-adapter-registry');

test('registry cobre os cinco dominios conhecidos', () => {
  assert.deepEqual(listDomainMockAdapters().map((adapter) => adapter.adapter_id).sort(), [
    'mock-compras',
    'mock-desenvolvimento',
    'mock-financeiro',
    'mock-marketing',
    'mock-treinamento'
  ]);
});

test('registry retorna adapter seguro por dominio conhecido', () => {
  assert.deepEqual(getDomainMockAdapter('compras'), {
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras'
  });
  assert.deepEqual(getDomainMockAdapter('financeiro'), {
    adapter_id: 'mock-financeiro',
    adapter_mode: 'mock',
    domain: 'financeiro'
  });
  assert.deepEqual(getDomainMockAdapter('treinamento'), {
    adapter_id: 'mock-treinamento',
    adapter_mode: 'mock',
    domain: 'treinamento'
  });
  assert.deepEqual(getDomainMockAdapter('marketing'), {
    adapter_id: 'mock-marketing',
    adapter_mode: 'mock',
    domain: 'marketing'
  });
  assert.deepEqual(getDomainMockAdapter('desenvolvimento'), {
    adapter_id: 'mock-desenvolvimento',
    adapter_mode: 'mock',
    domain: 'desenvolvimento'
  });
});

test('registry retorna null para dominio desconhecido', () => {
  assert.equal(getDomainMockAdapter('desconhecido'), null);
  assert.equal(getDomainMockAdapter('qualquer-coisa'), null);
});
