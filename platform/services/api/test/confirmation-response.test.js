'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyConfirmationResponse } = require('../src/core/confirmation-response');

test('classifica respostas aprovadas', () => {
  assert.equal(classifyConfirmationResponse('sim'), 'approved');
  assert.equal(classifyConfirmationResponse('confirmar'), 'approved');
  assert.equal(classifyConfirmationResponse('pode executar'), 'approved');
  assert.equal(classifyConfirmationResponse('SIM'), 'approved');
  assert.equal(classifyConfirmationResponse(' ok '), 'approved');
  assert.equal(classifyConfirmationResponse('yes'), 'approved');
});

test('classifica respostas rejeitadas', () => {
  assert.equal(classifyConfirmationResponse('não'), 'rejected');
  assert.equal(classifyConfirmationResponse('cancelar'), 'rejected');
  assert.equal(classifyConfirmationResponse('nao executar'), 'rejected');
  assert.equal(classifyConfirmationResponse('NO'), 'rejected');
});

test('classifica texto ambiguo como unknown', () => {
  assert.equal(classifyConfirmationResponse('talvez depois'), 'unknown');
  assert.equal(classifyConfirmationResponse('pode ser'), 'unknown');
  assert.equal(classifyConfirmationResponse(''), 'unknown');
  assert.equal(classifyConfirmationResponse(null), 'unknown');
});
