'use strict';

const {
  buildCanaryAuditEventCandidate,
  findCanaryForbiddenFields,
  hashCanaryEvidence,
  sanitizeCanaryData
} = require('./public-web-canary-session-contract');

const PERSISTENT_AUDIT_CONTRACT_VERSION = 'public_web_canary_durable_audit_v1';
const PERSISTENT_AUDIT_TABLE = 'hermes.public_web_canary_audit_events';
const MAX_PERSISTED_EVENT_BYTES = 16 * 1024;

const CANARY_AUDIT_EVENTS = Object.freeze([
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
]);

function isSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeEvent(input = {}) {
  const event = sanitizeCanaryData(buildCanaryAuditEventCandidate(input));
  if (!CANARY_AUDIT_EVENTS.includes(event.event_name)) {
    event.event_name = 'public_web_canary_request_failed_safe';
    event.blocked_reason = event.blocked_reason || 'audit_event_name_not_allowed';
  }
  if (!isSafeInteger(input.event_sequence)) event.event_sequence = 0;
  else event.event_sequence = input.event_sequence;
  return event;
}

function validateDurableAuditEvent(input = {}) {
  const event = normalizeEvent(input);
  const errors = [];
  const required = [
    'trace_id', 'request_id', 'change_id', 'canary_session_id',
    'tenant_id', 'workspace_type', 'operator_id', 'event_name', 'occurred_at'
  ];
  for (const field of required) {
    if (!isNonEmptyString(event[field])) errors.push(`${field}_required`);
  }
  if (event.approved_by !== null && !isNonEmptyString(event.approved_by)) errors.push('approved_by_invalid');
  if (!isSafeInteger(event.event_sequence)) errors.push('event_sequence_invalid');
  if (Number.isNaN(Date.parse(event.occurred_at))) errors.push('occurred_at_invalid');
  if (findCanaryForbiddenFields(event).length > 0) errors.push('forbidden_field_detected');

  let serialized = '';
  try {
    serialized = JSON.stringify(event);
  } catch {
    errors.push('event_not_serializable');
  }
  if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_PERSISTED_EVENT_BYTES) {
    errors.push('event_payload_too_large');
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(),
    event,
    serialized
  };
}

function buildDurableAuditRecord(input = {}) {
  const validation = validateDurableAuditEvent(input);
  if (!validation.valid) return { valid: false, errors: validation.errors };
  const material = {
    contract_version: PERSISTENT_AUDIT_CONTRACT_VERSION,
    event: validation.event
  };
  const eventDigest = hashCanaryEvidence(material);
  return {
    valid: true,
    event: validation.event,
    event_id: `public-web-canary-audit::${eventDigest.slice('sha256:'.length)}`,
    event_digest: eventDigest,
    contract_version: PERSISTENT_AUDIT_CONTRACT_VERSION,
    serialized: validation.serialized
  };
}

function createDurableAuditReceipt(record, status) {
  return Object.freeze({
    contract_version: record.contract_version,
    event_id: record.event_id,
    event_digest: record.event_digest,
    status,
    append_only: true,
    execution_performed: false,
    production_effect: 'ZERO'
  });
}

module.exports = {
  CANARY_AUDIT_EVENTS,
  MAX_PERSISTED_EVENT_BYTES,
  PERSISTENT_AUDIT_CONTRACT_VERSION,
  PERSISTENT_AUDIT_TABLE,
  buildDurableAuditRecord,
  createDurableAuditReceipt,
  normalizeEvent,
  validateDurableAuditEvent
};
