'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyIntent,
  DOMAIN_MARKETING,
  DOMAIN_DESENVOLVIMENTO,
  DOMAIN_COMPRAS,
  DOMAIN_FINANCEIRO,
  DOMAIN_TREINAMENTO,
  DOMAIN_UNKNOWN,
  INTENT_PLANEJAR_MARKETING,
  INTENT_DESENVOLVIMENTO,
  INTENT_CONSULTAR_COMPRAS,
  INTENT_CONSULTAR_VENCIMENTOS,
  INTENT_CONSULTAR_FINANCEIRO,
  INTENT_CONSULTAR_TREINAMENTO,
  INTENT_UNKNOWN
} = require('../src/core/intent-router');

test('classifica mensagem de marketing', () => {
  assert.deepEqual(
    classifyIntent('Preciso lançar uma campanha de marketing'),
    { domain: DOMAIN_MARKETING, intent: INTENT_PLANEJAR_MARKETING }
  );
  assert.deepEqual(
    classifyIntent('ANÚNCIO novo para as vendas'),
    { domain: DOMAIN_MARKETING, intent: INTENT_PLANEJAR_MARKETING }
  );
});

test('classifica mensagem de desenvolvimento', () => {
  assert.deepEqual(
    classifyIntent('Encontrei um bug no deploy da API'),
    { domain: DOMAIN_DESENVOLVIMENTO, intent: INTENT_DESENVOLVIMENTO }
  );
  assert.deepEqual(
    classifyIntent('preciso revisar o código antes do commit'),
    { domain: DOMAIN_DESENVOLVIMENTO, intent: INTENT_DESENVOLVIMENTO }
  );
});

test('classifica mensagem de compras (consultar_compras)', () => {
  assert.deepEqual(
    classifyIntent('abrir pedido de compra do material'),
    { domain: DOMAIN_COMPRAS, intent: INTENT_CONSULTAR_COMPRAS }
  );
  assert.deepEqual(
    classifyIntent('preciso de uma cotação com o fornecedor'),
    { domain: DOMAIN_COMPRAS, intent: INTENT_CONSULTAR_COMPRAS }
  );
});

test('classifica mensagem de compras (consultar_vencimentos)', () => {
  assert.deepEqual(
    classifyIntent('qual o vencimento dessa duplicata?'),
    { domain: DOMAIN_COMPRAS, intent: INTENT_CONSULTAR_VENCIMENTOS }
  );
  assert.deepEqual(
    classifyIntent('quando vence o boleto do fornecedor?'),
    { domain: DOMAIN_COMPRAS, intent: INTENT_CONSULTAR_VENCIMENTOS }
  );
  assert.deepEqual(
    classifyIntent('a nota fiscal chegou?'),
    { domain: DOMAIN_COMPRAS, intent: INTENT_CONSULTAR_VENCIMENTOS }
  );
});

test('classifica mensagem de financeiro', () => {
  assert.deepEqual(
    classifyIntent('como está o caixa e o faturamento do mês?'),
    { domain: DOMAIN_FINANCEIRO, intent: INTENT_CONSULTAR_FINANCEIRO }
  );
  assert.deepEqual(
    classifyIntent('preciso ver as despesas e a DRE'),
    { domain: DOMAIN_FINANCEIRO, intent: INTENT_CONSULTAR_FINANCEIRO }
  );
});

test('classifica mensagem de treinamento', () => {
  assert.deepEqual(
    classifyIntent('quero fazer o curso e tirar o certificado'),
    { domain: DOMAIN_TREINAMENTO, intent: INTENT_CONSULTAR_TREINAMENTO }
  );
  assert.deepEqual(
    classifyIntent('o colaborador terminou o módulo do quiz?'),
    { domain: DOMAIN_TREINAMENTO, intent: INTENT_CONSULTAR_TREINAMENTO }
  );
});

test('mensagem genérica cai em desconhecido', () => {
  assert.deepEqual(
    classifyIntent('Bom dia, tudo bem?'),
    { domain: DOMAIN_UNKNOWN, intent: INTENT_UNKNOWN }
  );
  assert.deepEqual(
    classifyIntent(''),
    { domain: DOMAIN_UNKNOWN, intent: INTENT_UNKNOWN }
  );
});
