'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const AGENT_CORE_AUDIT_VERSION = 'agent_core_audit_v1';
const AGENT_CORE_AUDIT_FIELDS = Object.freeze([
  'audit_id',
  'contract_id',
  'contract_fingerprint',
  'identity_fingerprint',
  'metadata_fingerprint',
  'context_fingerprint',
  'lifecycle_fingerprint',
  'capability_fingerprints',
  'tenant_binding',
  'organization_binding',
  'version_bindings',
  'lifecycle_state',
  'registry_decision',
  'blockers',
  'logical_sequence',
  'simulation',
  'production_blocked',
  'executed',
  'validator_version'
]);

function fingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function validateAgentCoreAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['agent_core_audit_must_be_object'] };
  exactFields(audit, AGENT_CORE_AUDIT_FIELDS, 'agent_core_audit', errors);
  for (const field of ['audit_id', 'contract_id', 'contract_fingerprint', 'identity_fingerprint', 'metadata_fingerprint', 'context_fingerprint', 'lifecycle_fingerprint', 'lifecycle_state', 'registry_decision', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(audit.capability_fingerprints) || !audit.capability_fingerprints.every(isNonEmptyString)) errors.push('capability_fingerprints_invalid');
  for (const field of ['tenant_binding', 'organization_binding', 'version_bindings']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== AGENT_CORE_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentCoreAudit(input = {}) {
  const contract = input.contract || {};
  const identity = contract.identity || {};
  const metadata = contract.metadata || {};
  const context = contract.context || {};
  const lifecycle = contract.lifecycle || {};
  const capabilities = Array.isArray(contract.capabilities) ? contract.capabilities : [];
  const audit = {
    audit_id: `agent_core_audit_${contract.contract_id || 'missing'}`,
    contract_id: contract.contract_id || 'contract_not_available',
    contract_fingerprint: input.contract_fingerprint || fingerprint(contract),
    identity_fingerprint: fingerprint(identity),
    metadata_fingerprint: fingerprint(metadata),
    context_fingerprint: input.context_fingerprint || fingerprint(context),
    lifecycle_fingerprint: fingerprint(lifecycle),
    capability_fingerprints: uniqueSorted(Array.isArray(input.capability_fingerprints) ? input.capability_fingerprints : capabilities.map((capability) => fingerprint(capability))),
    tenant_binding: {
      identity_tenant_id: identity.tenant_id || 'tenant_not_available',
      metadata_tenant_id: metadata.tenant_id || 'tenant_not_available',
      context_tenant_id: context.tenant_id || 'tenant_not_available',
      lifecycle_tenant_id: lifecycle.tenant_id || 'tenant_not_available'
    },
    organization_binding: {
      identity_organization_id: identity.organization_id || 'organization_not_available',
      context_organization_id: context.organization_id || 'organization_not_available'
    },
    version_bindings: {
      contract_version: contract.contract_version || 0,
      identity_version: identity.identity_version || 0,
      metadata_version: metadata.metadata_version || 0,
      context_version: context.context_version || 0,
      lifecycle_version: lifecycle.lifecycle_version || 0
    },
    lifecycle_state: lifecycle.current_state || 'lifecycle_state_not_available',
    registry_decision: input.registry_decision || contract.contract_status || 'REGISTRY_DECISION_NOT_AVAILABLE',
    blockers: uniqueSorted(input.blockers || []),
    logical_sequence: Number.isInteger(input.logical_sequence) && input.logical_sequence >= 1 ? input.logical_sequence : 1,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: AGENT_CORE_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  AGENT_CORE_AUDIT_FIELDS,
  AGENT_CORE_AUDIT_VERSION,
  buildAgentCoreAudit,
  validateAgentCoreAudit
};
