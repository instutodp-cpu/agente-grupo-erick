'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const AGENT_SESSION_AUDIT_VERSION = 'agent_session_audit_v1';
const AGENT_SESSION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'request_fingerprint', 'session_fingerprint', 'state_fingerprint', 'transition_fingerprint',
  'expiration_fingerprint', 'policy_decision_fingerprint', 'agent_contract_fingerprint', 'tenant_binding',
  'organization_binding', 'agent_id', 'actor_type', 'actor_role', 'channel', 'session_type', 'previous_status',
  'proposed_status', 'decision_status', 'blockers', 'reason_codes', 'logical_sequence', 'registry_version',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

function fingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function validateAgentSessionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['agent_session_audit_must_be_object'] };
  exactFields(audit, AGENT_SESSION_AUDIT_FIELDS, 'agent_session_audit', errors);
  for (const field of ['audit_id', 'request_fingerprint', 'session_fingerprint', 'state_fingerprint', 'transition_fingerprint', 'expiration_fingerprint', 'policy_decision_fingerprint', 'agent_contract_fingerprint', 'agent_id', 'actor_type', 'actor_role', 'channel', 'session_type', 'previous_status', 'proposed_status', 'decision_status', 'registry_version', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['tenant_binding', 'organization_binding']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Array.isArray(audit.reason_codes)) errors.push('reason_codes_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== AGENT_SESSION_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentSessionAudit(input = {}) {
  const request = input.request || {};
  const decision = input.decision || {};
  const actor = request.actor_context || {};
  const contractRef = request.agent_contract_reference || {};
  const audit = {
    audit_id: `agent_session_audit_${decision.decision_id || request.session_request_id || 'missing'}`,
    request_fingerprint: decision.request_fingerprint || fingerprint(request),
    session_fingerprint: decision.session_fingerprint || 'session_fingerprint_not_available',
    state_fingerprint: decision.state_fingerprint || 'state_fingerprint_not_available',
    transition_fingerprint: decision.transition_fingerprint || 'transition_fingerprint_not_available',
    expiration_fingerprint: decision.expiration_fingerprint || 'expiration_fingerprint_not_available',
    policy_decision_fingerprint: decision.policy_decision_fingerprint || 'policy_decision_fingerprint_not_available',
    agent_contract_fingerprint: contractRef.contract_fingerprint || 'contract_fingerprint_not_available',
    tenant_binding: {
      request_tenant_id: request.tenant_id || 'tenant_not_available',
      decision_tenant_id: decision.tenant_id || 'tenant_not_available'
    },
    organization_binding: {
      request_organization_id: request.organization_id || 'organization_not_available',
      decision_organization_id: decision.organization_id || 'organization_not_available'
    },
    agent_id: decision.agent_id || contractRef.agent_id || 'agent_not_available',
    actor_type: actor.actor_type || 'actor_type_not_available',
    actor_role: actor.actor_role || 'actor_role_not_available',
    channel: request.channel || 'channel_not_available',
    session_type: request.requested_session_type || 'session_type_not_available',
    previous_status: decision.current_status || 'previous_status_not_available',
    proposed_status: decision.proposed_status || 'proposed_status_not_available',
    decision_status: decision.status || 'VALIDATION_FAILED',
    blockers: uniqueSorted(decision.blockers || []),
    reason_codes: uniqueSorted(decision.reason_codes || []),
    logical_sequence: Number.isInteger(input.logical_sequence) && input.logical_sequence >= 0 ? input.logical_sequence : 0,
    registry_version: decision.registry_version || 'registry_version_not_available',
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: AGENT_SESSION_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  AGENT_SESSION_AUDIT_FIELDS,
  AGENT_SESSION_AUDIT_VERSION,
  buildAgentSessionAudit,
  validateAgentSessionAudit
};
