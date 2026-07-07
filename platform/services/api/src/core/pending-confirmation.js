'use strict';

const { createHash } = require('crypto');

const DEFAULT_EXPIRES_IN_SECONDS = 900;

function createPendingConfirmation({ traceId, randomId, expiresInSeconds = DEFAULT_EXPIRES_IN_SECONDS }) {
  const sourceId = typeof traceId === 'string' && traceId.trim() ? traceId.trim() : '';
  const nonce = typeof randomId === 'string' && randomId.trim() ? randomId.trim() : '';
  const digest = createHash('sha256').update(`${sourceId}:${nonce}`).digest('hex').slice(0, 32);

  return {
    id: `confirm_${digest}`,
    status: 'pending',
    expires_in_seconds: expiresInSeconds
  };
}

module.exports = { DEFAULT_EXPIRES_IN_SECONDS, createPendingConfirmation };
