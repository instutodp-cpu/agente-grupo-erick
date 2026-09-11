'use strict';

const {
  buildCanaryAuditEventCandidate,
  deepClone,
  sanitizeCanaryData
} = require('./public-web-canary-session-contract');
const { CANARY_AUDIT_EVENTS } = require('./public-web-canary-durable-audit-contract');

function createPublicWebCanaryPersistentAuditSink({ persistence, maxEvents = 200 } = {}) {
  if (!persistence || typeof persistence.append !== 'function' || typeof persistence.ensureReady !== 'function') {
    throw new TypeError('public_web_canary_persistent_audit_persistence_invalid');
  }
  const events = [];
  const boundedMaxEvents = Number.isInteger(maxEvents) && maxEvents > 0 ? Math.min(maxEvents, 1000) : 200;

  function normalize(event = {}) {
    const sanitized = sanitizeCanaryData(buildCanaryAuditEventCandidate(event));
    if (!CANARY_AUDIT_EVENTS.includes(sanitized.event_name)) {
      sanitized.event_name = 'public_web_canary_request_failed_safe';
      sanitized.blocked_reason = sanitized.blocked_reason || 'audit_event_name_not_allowed';
    }
    if (Number.isSafeInteger(event.event_sequence) && event.event_sequence >= 0) {
      sanitized.event_sequence = event.event_sequence;
    }
    return sanitized;
  }

  function cache(event) {
    events.push(deepClone(event));
    while (events.length > boundedMaxEvents) events.shift();
  }

  function append(event = {}) {
    const sanitized = normalize(event);
    cache(sanitized);
    return deepClone(sanitized);
  }

  async function appendDurably(event = {}) {
    const sanitized = normalize(event);
    const result = await persistence.append(sanitized);
    if (result && result.ok === true && result.event) cache(result.event);
    return result;
  }

  function list(filters = {}) {
    return events
      .filter((event) => !filters.event_name || event.event_name === filters.event_name)
      .filter((event) => !filters.canary_session_id || event.canary_session_id === filters.canary_session_id)
      .filter((event) => !filters.tenant_id || event.tenant_id === filters.tenant_id)
      .map(deepClone);
  }

  function getBySession(sessionId) {
    return list({ canary_session_id: sessionId });
  }

  function clearForTest() {
    events.splice(0, events.length);
    return { cleared: true };
  }

  return Object.freeze({
    durable: true,
    append,
    appendDurably,
    ensureReady: persistence.ensureReady,
    list,
    getBySession,
    clearForTest
  });
}

module.exports = {
  createPublicWebCanaryPersistentAuditSink
};
