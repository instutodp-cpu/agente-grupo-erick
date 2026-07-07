'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_EXPIRES_IN_SECONDS,
  createPendingConfirmation
} = require('../src/core/pending-confirmation');

test('cria confirmacao pendente publica minima', () => {
  const confirmation = createPendingConfirmation({
    traceId: 'trace-123',
    randomId: 'nonce-456'
  });

  assert.deepEqual(Object.keys(confirmation).sort(), ['expires_in_seconds', 'id', 'status'].sort());
  assert.match(confirmation.id, /^confirm_[a-f0-9]{32}$/);
  assert.equal(confirmation.status, 'pending');
  assert.equal(confirmation.expires_in_seconds, DEFAULT_EXPIRES_IN_SECONDS);
});

test('id nao expoe trace_id nem nonce bruto', () => {
  const confirmation = createPendingConfirmation({
    traceId: 'trace-secreto',
    randomId: 'nonce-secreto'
  });

  assert.equal(confirmation.id.includes('trace-secreto'), false);
  assert.equal(confirmation.id.includes('nonce-secreto'), false);
});
