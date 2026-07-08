'use strict';

const ALLOWED_EVENT_TYPES = new Set([
  'adapter_simulation_started',
  'adapter_simulation_completed',
  'adapter_execution_blocked',
  'adapter_result_sanitized',
  'adapter_result_validated'
]);

const FORBIDDEN_FIELDS = new Set([
  'rawMessage',
  'userMessage',
  'requiredAdapters',
  'payload',
  'internal',
  'env',
  'token',
  'secret',
  'credentials',
  'headers',
  'authorization',
  'cookie',
  'stack',
  'request_body',
  'requestBody',
  'body'
]);

const ALLOWED_STATUSES = new Set(['simulated', 'disabled', 'not_available', 'failed']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pruneForbiddenFields(value, stats) {
  if (Array.isArray(value)) {
    return value.map((entry) => pruneForbiddenFields(entry, stats));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      stats.removed_fields_count += 1;
      continue;
    }

    next[key] = pruneForbiddenFields(entry, stats);
  }

  return next;
}

function buildAdapterAuditEvent(input = {}) {
  const timestamp = typeof input.timestamp === 'string' && input.timestamp.trim()
    ? input.timestamp
    : new Date().toISOString();
  const eventType = ALLOWED_EVENT_TYPES.has(input.event_type) ? input.event_type : null;
  const status = ALLOWED_STATUSES.has(input.status) ? input.status : 'failed';

  return {
    event_type: eventType,
    trace_id: typeof input.trace_id === 'string' && input.trace_id.trim() ? input.trace_id : null,
    confirmation_id: typeof input.confirmation_id === 'string' && input.confirmation_id.trim()
      ? input.confirmation_id
      : null,
    domain: typeof input.domain === 'string' && input.domain.trim() ? input.domain : 'desconhecido',
    intent: typeof input.intent === 'string' && input.intent.trim() ? input.intent : 'desconhecido',
    adapter_id: typeof input.adapter_id === 'string' && input.adapter_id.trim() ? input.adapter_id : null,
    adapter_mode: 'mock',
    status,
    executed: false,
    simulated: status === 'simulated',
    timestamp
  };
}

function sanitizeAdapterAuditEvent(event) {
  const stats = { removed_fields_count: 0 };

  if (!isPlainObject(event)) {
    return { event: null, removed_fields_count: stats.removed_fields_count };
  }

  const pruned = pruneForbiddenFields(event, stats);
  const sanitized = {};

  for (const [key, value] of Object.entries(pruned)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      stats.removed_fields_count += 1;
      continue;
    }

    sanitized[key] = value;
  }

  return { event: sanitized, removed_fields_count: stats.removed_fields_count };
}

function validateAdapterAuditEvent(event) {
  const errors = [];

  if (!isPlainObject(event)) {
    errors.push('adapter audit event must be a plain object');
  } else {
    if (!ALLOWED_EVENT_TYPES.has(event.event_type)) {
      errors.push('event_type is required and must be allowed');
    }

    if (typeof event.trace_id !== 'string' || event.trace_id.trim() === '') {
      errors.push('trace_id is required');
    }

    if (typeof event.confirmation_id !== 'string' || event.confirmation_id.trim() === '') {
      errors.push('confirmation_id is required');
    }

    if (typeof event.adapter_mode !== 'string' || event.adapter_mode !== 'mock') {
      errors.push('adapter_mode must be mock');
    }

    if (!ALLOWED_STATUSES.has(event.status)) {
      errors.push('status must be allowed');
    }

    if (event.executed !== false) {
      errors.push('executed must be false');
    }

    if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
      errors.push('timestamp must be ISO-8601');
    }

    for (const forbiddenField of FORBIDDEN_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(event, forbiddenField)) {
        errors.push(`forbidden field present: ${forbiddenField}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  buildAdapterAuditEvent,
  sanitizeAdapterAuditEvent,
  validateAdapterAuditEvent
};
