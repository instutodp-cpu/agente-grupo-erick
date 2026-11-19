'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createChatAccessGuard, MIN_TOKEN_LENGTH } = require('../src/hermes/http/chat-access');

const token = 't'.repeat(MIN_TOKEN_LENGTH);

function requestWithToken(value, ip = '127.0.0.1') {
  return {
    ip,
    headers: value ? { authorization: `Bearer ${value}` } : {},
    socket: { remoteAddress: ip }
  };
}

test('chat fails closed when the shared token is not configured', () => {
  const guard = createChatAccessGuard({ token: '' });
  assert.deepEqual(guard.check(requestWithToken(token)), {
    allowed: false,
    status: 503,
    code: 'chat_auth_not_configured'
  });
});

test('chat rejects missing or invalid bearer tokens', () => {
  const guard = createChatAccessGuard({ token });
  assert.equal(guard.check(requestWithToken('')).status, 401);
  assert.equal(guard.check(requestWithToken('x'.repeat(MIN_TOKEN_LENGTH))).status, 401);
});

test('chat accepts the configured token and rate-limits each client', () => {
  const guard = createChatAccessGuard({ token, maxRequests: 2, windowMs: 1_000 });
  assert.deepEqual(guard.check(requestWithToken(token, 'client-a', )), { allowed: true });
  assert.deepEqual(guard.check(requestWithToken(token, 'client-a')), { allowed: true });
  const limited = guard.check(requestWithToken(token, 'client-a'));
  assert.equal(limited.status, 429);
  assert.equal(limited.code, 'chat_rate_limited');
  assert.ok(limited.retryAfterSeconds >= 1);
  assert.deepEqual(guard.check(requestWithToken(token, 'client-b')), { allowed: true });
});
