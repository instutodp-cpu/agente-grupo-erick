'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CAPABILITIES, getCapability, listCapabilities } = require('../src/capabilities/registry');

const EXPECTED_DOMAINS = [
  'compras', 'financeiro', 'treinamento', 'marketing', 'desenvolvimento', 'desconhecido'
];

test('registro cobre exatamente os domínios já classificados pelo intent-router', () => {
  assert.deepEqual(Object.keys(CAPABILITIES).sort(), [...EXPECTED_DOMAINS].sort());
});

test('cada capacidade está em status "planned" com metadados válidos', () => {
  for (const domain of EXPECTED_DOMAINS) {
    const capability = getCapability(domain);
    assert.ok(capability, `capacidade ausente para domínio "${domain}"`);
    assert.equal(capability.domain, domain);
    assert.equal(capability.status, 'planned');
    assert.ok(typeof capability.description === 'string' && capability.description.length > 0);
    assert.ok(Array.isArray(capability.requiredAdapters));
  }
});

test('getCapability retorna null para domínio fora do registro', () => {
  assert.equal(getCapability('nao-existe'), null);
});

test('listCapabilities retorna todas as capacidades cadastradas', () => {
  assert.equal(listCapabilities().length, EXPECTED_DOMAINS.length);
});
