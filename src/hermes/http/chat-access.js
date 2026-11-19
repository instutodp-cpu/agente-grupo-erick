'use strict';

const crypto = require('crypto');

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 20;
const MIN_TOKEN_LENGTH = 24;

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function getBearerToken(request) {
  const authorization = request && request.headers && request.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer\s+/i.test(authorization)) {
    return '';
  }
  return authorization.slice(7).trim();
}

function tokensMatch(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);
  if (presentedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(presentedBuffer, expectedBuffer);
}

function createChatAccessGuard(options = {}) {
  const token = options.token ?? process.env.HERMES_CHAT_AUTH_TOKEN ?? '';
  const windowMs = positiveInteger(
    options.windowMs ?? process.env.HERMES_CHAT_RATE_LIMIT_WINDOW_MS,
    DEFAULT_WINDOW_MS
  );
  const maxRequests = positiveInteger(
    options.maxRequests ?? process.env.HERMES_CHAT_RATE_LIMIT_MAX,
    DEFAULT_MAX_REQUESTS
  );
  const requestsByClient = new Map();

  function check(request, now = Date.now()) {
    if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
      return { allowed: false, status: 503, code: 'chat_auth_not_configured' };
    }

    if (!tokensMatch(getBearerToken(request), token)) {
      return { allowed: false, status: 401, code: 'chat_unauthorized' };
    }

    const clientId =
      (request && (request.ip || (request.socket && request.socket.remoteAddress))) ||
      'unknown';
    const current = requestsByClient.get(clientId);
    if (!current || now - current.startedAt >= windowMs) {
      requestsByClient.set(clientId, { startedAt: now, count: 1 });
      return { allowed: true };
    }

    if (current.count >= maxRequests) {
      return {
        allowed: false,
        status: 429,
        code: 'chat_rate_limited',
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000))
      };
    }

    current.count += 1;
    return { allowed: true };
  }

  return {
    check,
    reset() {
      requestsByClient.clear();
    }
  };
}

module.exports = {
  createChatAccessGuard,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_REQUESTS,
  MIN_TOKEN_LENGTH
};
