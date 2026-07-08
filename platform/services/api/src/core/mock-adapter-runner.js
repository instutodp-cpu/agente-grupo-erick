'use strict';

const { getDomainMockAdapter } = require('./domain-mock-adapter-registry');
const {
  buildAdapterResult,
  sanitizeAdapterResult,
  validateAdapterResult
} = require('./adapter-result-contract');
const {
  buildAdapterAuditEvent,
  sanitizeAdapterAuditEvent,
  validateAdapterAuditEvent
} = require('./adapter-audit-event');

function emitAdapterAuditTrail(event) {
  const sanitized = sanitizeAdapterAuditEvent(event);
  const validation = validateAdapterAuditEvent(sanitized.event);

  console.log(JSON.stringify({
    level: 'info',
    event: 'adapter_audit_event_created',
    event_type: event.event_type,
    trace_id: event.trace_id,
    confirmation_id: event.confirmation_id,
    domain: event.domain,
    intent: event.intent,
    adapter_id: event.adapter_id,
    adapter_mode: event.adapter_mode,
    status: event.status,
    executed: event.executed,
    simulated: event.simulated,
    timestamp: event.timestamp
  }));
  console.log(JSON.stringify({
    level: 'info',
    event: 'adapter_audit_event_sanitized',
    event_type: sanitized.event && sanitized.event.event_type,
    trace_id: sanitized.event && sanitized.event.trace_id,
    confirmation_id: sanitized.event && sanitized.event.confirmation_id,
    domain: sanitized.event && sanitized.event.domain,
    intent: sanitized.event && sanitized.event.intent,
    adapter_id: sanitized.event && sanitized.event.adapter_id,
    adapter_mode: sanitized.event && sanitized.event.adapter_mode,
    status: sanitized.event && sanitized.event.status,
    executed: sanitized.event && sanitized.event.executed,
    simulated: sanitized.event && sanitized.event.simulated,
    removed_fields_count: sanitized.removed_fields_count
  }));
  console.log(JSON.stringify({
    level: 'info',
    event: 'adapter_audit_event_validated',
    event_type: sanitized.event && sanitized.event.event_type,
    trace_id: sanitized.event && sanitized.event.trace_id,
    confirmation_id: sanitized.event && sanitized.event.confirmation_id,
    domain: sanitized.event && sanitized.event.domain,
    intent: sanitized.event && sanitized.event.intent,
    adapter_id: sanitized.event && sanitized.event.adapter_id,
    adapter_mode: sanitized.event && sanitized.event.adapter_mode,
    status: sanitized.event && sanitized.event.status,
    executed: sanitized.event && sanitized.event.executed,
    simulated: sanitized.event && sanitized.event.simulated,
    valid: validation.valid
  }));

  return {
    sanitized,
    validation
  };
}

function runMockAdapter({ domain, trace_id, confirmation_id, intent } = {}) {
  const adapter = getDomainMockAdapter(domain);
  const auditTraceId = typeof trace_id === 'string' && trace_id.trim()
    ? trace_id
    : `trace_mock_${typeof domain === 'string' && domain.trim() ? domain : 'desconhecido'}`;
  const auditConfirmationId = typeof confirmation_id === 'string' && confirmation_id.trim()
    ? confirmation_id
    : `confirm_mock_${typeof domain === 'string' && domain.trim() ? domain : 'desconhecido'}`;
  const auditIntent = typeof intent === 'string' && intent.trim()
    ? intent
    : (typeof domain === 'string' && domain.trim() ? domain : 'desconhecido');

  if (!adapter) {
    const rawResult = {
      adapter_mode: 'mock',
      domain: typeof domain === 'string' && domain.trim() ? domain : 'desconhecido',
      status: 'not_available',
      simulated: false,
      executed: false,
      message: 'Mock adapter not available for this domain.'
    };

    const sanitized = sanitizeAdapterResult(rawResult);
    const validation = validateAdapterResult(sanitized.result);
    console.log(JSON.stringify({
      level: 'info',
      event: 'adapter_result_sanitized',
      adapter_id: null,
      domain: rawResult.domain,
      removed_fields_count: sanitized.removed_fields_count
    }));
    console.log(JSON.stringify({
      level: 'info',
      event: 'adapter_result_validated',
      adapter_id: null,
      domain: rawResult.domain,
      status: rawResult.status,
      executed: rawResult.executed
    }));
    if (!validation.valid) {
      return buildAdapterResult(rawResult);
    }

    return buildAdapterResult(rawResult);
  }

  const startedAuditEvent = buildAdapterAuditEvent({
    event_type: 'adapter_simulation_started',
    trace_id: auditTraceId,
    confirmation_id: auditConfirmationId,
    domain: adapter.domain,
    intent: auditIntent,
    adapter_id: adapter.adapter_id,
    status: 'simulated',
    simulated: true,
    executed: false
  });
  emitAdapterAuditTrail(startedAuditEvent);

  const rawResult = {
    adapter_id: adapter.adapter_id,
    adapter_mode: adapter.adapter_mode,
    domain: adapter.domain,
    status: 'simulated',
    simulated: true,
    executed: false,
    message: 'Mock adapter simulation completed without real execution.'
  };
  const sanitized = sanitizeAdapterResult(rawResult);
  const validation = validateAdapterResult(sanitized.result);

  console.log(JSON.stringify({
    level: 'info',
    event: 'adapter_result_sanitized',
    adapter_id: adapter.adapter_id,
    domain: adapter.domain,
    removed_fields_count: sanitized.removed_fields_count
  }));
  console.log(JSON.stringify({
    level: 'info',
    event: 'adapter_result_validated',
    adapter_id: adapter.adapter_id,
    domain: adapter.domain,
    status: rawResult.status,
    executed: rawResult.executed
  }));
  const completedAuditEvent = buildAdapterAuditEvent({
    event_type: 'adapter_simulation_completed',
    trace_id: auditTraceId,
    confirmation_id: auditConfirmationId,
    domain: adapter.domain,
    intent: auditIntent,
    adapter_id: adapter.adapter_id,
    status: 'simulated',
    simulated: true,
    executed: false
  });
  emitAdapterAuditTrail(completedAuditEvent);

  if (!validation.valid) {
    return buildAdapterResult(rawResult);
  }

  return buildAdapterResult(rawResult);
}

module.exports = { runMockAdapter };
