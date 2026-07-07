'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCapability } = require('../src/capabilities/registry');
const { evaluateConfirmationGate } = require('../src/core/confirmation-gate');

const CONFIRMATION_DOMAINS = [
  'compras',
  'financeiro',
  'treinamento',
  'marketing',
  'desenvolvimento'
];

test('dominios com capacidade futura exigem confirmacao', () => {
  for (const domain of CONFIRMATION_DOMAINS) {
    assert.deepEqual(
      evaluateConfirmationGate({ domain, capability: getCapability(domain) }),
      { confirmationRequired: true }
    );
  }
});

test('desconhecido nao exige confirmacao nem permite execucao futura', () => {
  assert.deepEqual(
    evaluateConfirmationGate({ domain: 'desconhecido', capability: getCapability('desconhecido') }),
    { confirmationRequired: false }
  );
});

test('capacidade ausente nao exige confirmacao', () => {
  assert.deepEqual(
    evaluateConfirmationGate({ domain: 'nao-existe', capability: null }),
    { confirmationRequired: false }
  );
});
