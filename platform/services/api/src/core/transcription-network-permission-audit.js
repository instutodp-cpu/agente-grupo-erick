'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { cloneFrozen } = require('./transcription-network-permission-result');

const TRANSCRIPTION_NETWORK_PERMISSION_AUDIT_VERSION = 'transcription_network_permission_audit_v1';
const NETWORK_PERMISSION_AUDIT_FIELDS = Object.freeze([
  'audit_id',
  'network_request_id',
  'request_fingerprint',
  'destination_reference_fingerprint',
  'policy_context_fingerprint',
  'secret_context_fingerprint',
  'provider_binding',
  'adapter_binding',
  'transport_binding',
  'tenant_binding',
  'protocol',
  'operation',
  'data_classification',
  'blockers',
  'decision',
  'logical_sequence',
  'versions',
  'simulation',
  'network',
  'provider_execution',
  'executed',
  'validator_version'
]);

function validateNetworkPermissionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['network_permission_audit_must_be_object'] };
  const allowed = new Set(NETWORK_PERMISSION_AUDIT_FIELDS);
  for (const field of NETWORK_PERMISSION_AUDIT_FIELDS) if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`audit_missing_${field}`);
  for (const field of Object.keys(audit)) if (!allowed.has(field)) errors.push(`audit_unexpected_field::${field}`);
  for (const field of ['audit_id', 'network_request_id', 'request_fingerprint', 'destination_reference_fingerprint', 'policy_context_fingerprint', 'secret_context_fingerprint', 'protocol', 'operation', 'data_classification', 'decision', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['provider_binding', 'adapter_binding', 'transport_binding', 'tenant_binding', 'versions']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  for (const field of ['network', 'provider_execution', 'executed']) if (audit[field] !== false) errors.push(`${field}_must_be_false`);
  if (audit.validator_version !== TRANSCRIPTION_NETWORK_PERMISSION_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function fingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function buildNetworkPermissionAudit(input = {}) {
  const request = input.request || {};
  const destination = request.destination_reference || {};
  const policy = input.policy || {};
  const audit = {
    audit_id: `network_permission_audit_${request.network_request_id || 'missing'}`,
    network_request_id: request.network_request_id || 'network_request_not_available',
    request_fingerprint: fingerprint(request),
    destination_reference_fingerprint: fingerprint(destination),
    policy_context_fingerprint: fingerprint(request.policy_context),
    secret_context_fingerprint: fingerprint(request.secret_resolution_context),
    provider_binding: {
      request_provider_slug: request.provider_slug || 'provider_not_available',
      destination_provider_slug: destination.provider_slug || 'provider_not_available'
    },
    adapter_binding: {
      request_adapter_id: request.adapter_id || 'adapter_not_available',
      metadata_adapter_id: request.metadata && request.metadata.adapter_id ? request.metadata.adapter_id : 'adapter_not_available'
    },
    transport_binding: {
      request_transport_id: request.transport_id || 'transport_not_available',
      destination_transport_id: destination.transport_id || 'transport_not_available'
    },
    tenant_binding: {
      request_tenant_id: request.tenant_id || 'tenant_not_available',
      policy_tenant_id: request.policy_context && request.policy_context.tenant_id ? request.policy_context.tenant_id : 'tenant_not_available'
    },
    protocol: request.protocol || 'protocol_not_available',
    operation: request.operation || 'operation_not_available',
    data_classification: request.data_classification || 'classification_not_available',
    blockers: uniqueSorted([...(input.blockers || []), ...(policy.blocking_reasons || [])]),
    decision: input.decision || policy.status || 'NETWORK_VALIDATION_FAILED',
    logical_sequence: input.logical_sequence || 1,
    versions: {
      request_version: request.network_request_version || 0,
      destination_version: destination.destination_ref_version || 0,
      policy_version: request.policy_context && request.policy_context.policy_version ? request.policy_context.policy_version : 'policy_version_not_available'
    },
    simulation: true,
    network: false,
    provider_execution: false,
    executed: false,
    validator_version: TRANSCRIPTION_NETWORK_PERMISSION_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  NETWORK_PERMISSION_AUDIT_FIELDS,
  TRANSCRIPTION_NETWORK_PERMISSION_AUDIT_VERSION,
  buildNetworkPermissionAudit,
  validateNetworkPermissionAudit
};
