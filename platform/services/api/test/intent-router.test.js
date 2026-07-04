'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyIntent,
  INTENT_MARKETING,
  INTENT_DESENVOLVIMENTO,
  INTENT_UNKNOWN
} = require('../src/core/intent-router');

test('classifica mensagem de marketing', () => {
  assert.equal(classifyIntent('Preciso lançar uma campanha de marketing'), INTENT_MARKETING);
  assert.equal(classifyIntent('ANÚNCIO novo para as vendas'), INTENT_MARKETING);
});

test('classifica mensagem de desenvolvimento', () => {
  assert.equal(classifyIntent('Encontrei um bug no deploy da API'), INTENT_DESENVOLVIMENTO);
  assert.equal(classifyIntent('preciso revisar o código antes do commit'), INTENT_DESENVOLVIMENTO);
});

test('mensagem genérica cai em desconhecido', () => {
  assert.equal(classifyIntent('Bom dia, tudo bem?'), INTENT_UNKNOWN);
  assert.equal(classifyIntent(''), INTENT_UNKNOWN);
});
