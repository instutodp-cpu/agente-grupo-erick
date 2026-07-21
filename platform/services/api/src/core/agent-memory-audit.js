'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const AGENT_MEMORY_AUDIT_VERSION = 'agent_memory_audit_v1';
const AGENT_MEMORY_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'contract_fingerprint', 'item_fingerprint', 'request_fingerprint', 'retrieval_fingerprint',
  'policy_decision_fingerprint', 'tenant_binding', 'organization_binding', 'agent_id', 'session_reference_id',
  'memory_type', 'classification', 'retention_class', 'decision_status', 'blockers', 'reason_codes',
  'logical_sequence', 'registry_version', 'simulation', 'production_blocked', 'executed', 'validator_version'
]);

function fingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function validateAgentMemoryAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['agent_memory_audit_must_be_object'] };
  exactFields(audit, AGENT_MEMORY_AUDIT_FIELDS, 'agent_memory_audit', errors);
  for (const field of ['audit_id', 'contract_fingerprint', 'item_fingerprint', 'request_fingerprint', 'retrieval_fingerprint', 'policy_decision_fingerprint', 'agent_id', 'session_reference_id', 'memory_type', 'classification', 'retention_class', 'decision_status', 'registry_version', 'validator_version']) {
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
  if (audit.validator_version !== AGENT_MEMORY_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentMemoryAudit(input = {}) {
  const request = input.request || {};
  const decision = input.decision || {};
  const context = input.context || {};
  const audit = {
    audit_id: `agent_memory_audit_${decision.decision_id || request.memory_request_id || 'missing'}`,
    contract_fingerprint: decision.memory_contract_fingerprint || fingerprint(request.memory_contract_reference),
    item_fingerprint: decision.memory_item_fingerprint || fingerprint(request.memory_item_reference),
    request_fingerprint: decision.request_fingerprint || fingerprint(request),
    retrieval_fingerprint: decision.retrieval_fingerprint || fingerprint(request.retrieval_reference),
    policy_decision_fingerprint: decision.policy_decision_fingerprint || fingerprint(request.policy_reference),
    tenant_binding: {
      request_tenant_id: request.tenant_id || 'tenant_not_available',
      decision_tenant_id: decision.tenant_id || 'tenant_not_available'
    },
    organization_binding: {
      request_organization_id: request.organization_id || 'organization_not_available',
      decision_organization_id: decision.organization_id || 'organization_not_available'
    },
    agent_id: decision.agent_id || 'agent_not_available',
    session_reference_id: isPlainObject(request.session_reference) ? (request.session_reference.session_id || 'session_not_available') : 'session_not_available',
    memory_type: Array.isArray(context.memory_types) && context.memory_types.length > 0 ? context.memory_types[0] : 'memory_type_not_available',
    classification: context.classification || 'classification_not_available',
    retention_class: context.retention_class || 'retention_class_not_available',
    decision_status: decision.status || 'VALIDATION_FAILED',
    blockers: uniqueSorted(decision.blockers || []),
    reason_codes: uniqueSorted(decision.reason_codes || []),
    logical_sequence: Number.isInteger(input.logical_sequence) && input.logical_sequence >= 0 ? input.logical_sequence : 0,
    registry_version: decision.registry_version || 'registry_version_not_available',
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: AGENT_MEMORY_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  AGENT_MEMORY_AUDIT_FIELDS,
  AGENT_MEMORY_AUDIT_VERSION,
  buildAgentMemoryAudit,
  validateAgentMemoryAudit
};
