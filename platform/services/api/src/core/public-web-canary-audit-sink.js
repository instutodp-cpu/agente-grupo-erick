'use strict';

const {
  buildCanaryAuditEventCandidate,
  deepClone,
  sanitizeCanaryData
} = require('./public-web-canary-session-contract');

const CANARY_AUDIT_EVENTS = [
  'public_web_canary_requested',
  'public_web_canary_validation_passed',
  'public_web_canary_validation_blocked',
  'public_web_canary_approved',
  'public_web_canary_activated',
  'public_web_canary_request_started',
  'public_web_canary_request_succeeded',
  'public_web_canary_request_failed_safe',
  'public_web_canary_completed',
  'public_web_canary_expired',
  'public_web_canary_cancelled',
  'public_web_canary_kill_switch_terminated',
  'public_web_canary_trial_cleanup'
];

function createPublicWebCanaryAuditSink(options = {}) {
  const events = [];
  const maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents > 0 ? Math.min(options.maxEvents, 1000) : 200;

  function append(event = {}) {
    const sanitized = sanitizeCanaryData(buildCanaryAuditEventCandidate(event));
    if (!CANARY_AUDIT_EVENTS.includes(sanitized.event_name)) {
      sanitized.event_name = 'public_web_canary_request_failed_safe';
      sanitized.blocked_reason = sanitized.blocked_reason || 'audit_event_name_not_allowed';
    }
    events.push(sanitized);
    while (events.length > maxEvents) events.shift();
    return deepClone(sanitized);
  }

  function list(filters = {}) {
    return events
      .filter((event) => !filters.event_name || event.event_name === filters.event_name)
      .filter((event) => !filters.canary_session_id || event.canary_session_id === filters.canary_session_id)
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
    append,
    list,
    getBySession,
    clearForTest
  });
}

module.exports = {
  CANARY_AUDIT_EVENTS,
  createPublicWebCanaryAuditSink
};
