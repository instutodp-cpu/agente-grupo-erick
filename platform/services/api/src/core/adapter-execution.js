'use strict';

const { getExecutionPolicy } = require('./execution-policy');
const { runMockAdapter } = require('./mock-adapter-runner');
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
}

function planAdapterExecution({ confirmation, decision, capability, env = process.env }) {
  const policy = getExecutionPolicy(env);
  const requiredAdaptersCount = Array.isArray(capability && capability.requiredAdapters)
    ? capability.requiredAdapters.length
    : 0;
  const canSimulate = Boolean(
    policy.execution_enabled &&
    !policy.kill_switch_active &&
    decision === 'approved' &&
    confirmation
  );
  const simulation = canSimulate
    ? runMockAdapter({
      domain: capability && capability.domain,
      trace_id: confirmation && confirmation.trace_id,
      confirmation_id: confirmation && confirmation.confirmation_id,
      intent: confirmation && confirmation.intent
    })
    : null;
  const reason = policy.kill_switch_active
    ? 'execution_kill_switch_active'
    : policy.execution_enabled
      ? (simulation && simulation.status === 'simulated' ? 'adapter_execution_simulated' : 'adapter_execution_not_available')
      : 'execution_disabled_by_policy';
  const executionStatus = policy.kill_switch_active || !policy.execution_enabled
    ? 'disabled'
    : simulation && simulation.status === 'simulated'
      ? 'simulated'
      : simulation && simulation.status === 'not_available'
        ? 'not_available'
      : 'not_requested';
  const executionPolicy = policy.kill_switch_active
    ? 'kill_switch_active'
    : policy.execution_enabled
      ? 'not_implemented'
      : 'disabled';
  const auditTraceId = confirmation && typeof confirmation.trace_id === 'string'
    ? confirmation.trace_id
    : 'trace_not_available';
  const auditConfirmationId = confirmation && typeof confirmation.confirmation_id === 'string'
    ? confirmation.confirmation_id
    : 'confirm_not_available';
  const auditIntent = capability && typeof capability.intent === 'string'
    ? capability.intent
    : (confirmation && typeof confirmation.intent === 'string' ? confirmation.intent : 'desconhecido');
  const auditDomain = capability && typeof capability.domain === 'string'
    ? capability.domain
    : 'desconhecido';

  if (decision === 'approved' && confirmation && executionStatus !== 'simulated') {
    emitAdapterAuditTrail(buildAdapterAuditEvent({
      event_type: 'adapter_execution_blocked',
      trace_id: auditTraceId,
      confirmation_id: auditConfirmationId,
      domain: auditDomain,
      intent: auditIntent,
      adapter_id: null,
      status: executionStatus,
      simulated: false,
      executed: false
    }));
  }

  return {
    execution_allowed: false,
    executed: false,
    reason,
    required_adapters_count: requiredAdaptersCount,
    execution_policy: executionPolicy,
    execution_status: executionStatus,
    simulated: Boolean(simulation && simulation.status === 'simulated'),
    adapter_id: simulation && simulation.status === 'simulated' ? simulation.adapter_id : null,
    adapter_mode: simulation && simulation.status === 'simulated' ? simulation.adapter_mode : null,
    mock_adapter: simulation,
    execution_policy_evaluation: policy
  };
}

module.exports = { planAdapterExecution };
