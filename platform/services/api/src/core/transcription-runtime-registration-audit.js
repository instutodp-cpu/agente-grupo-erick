'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { cloneFrozen } = require('./transcription-runtime-registration-result');

const TRANSCRIPTION_RUNTIME_REGISTRATION_AUDIT_VERSION = 'transcription_runtime_registration_audit_v1';
const RUNTIME_REGISTRATION_AUDIT_FIELDS = Object.freeze([
  'audit_id',
  'registration_request_id',
  'request_fingerprint',
  'component_descriptor_fingerprint',
  'dependency_graph_fingerprint',
  'policy_context_fingerprint',
  'tenant_binding',
  'environment_binding',
  'component_binding',
  'component_type',
  'blockers',
  'decision',
  'logical_sequence',
  'versions',
  'simulation',
  'runtime_mutated',
  'components_registered',
  'components_initialized',
  'components_activated',
  'executed',
  'validator_version'
]);

function validateRuntimeRegistrationAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_registration_audit_must_be_object'] };
  const allowed = new Set(RUNTIME_REGISTRATION_AUDIT_FIELDS);
  for (const field of RUNTIME_REGISTRATION_AUDIT_FIELDS) if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`audit_missing_${field}`);
  for (const field of Object.keys(audit)) if (!allowed.has(field)) errors.push(`audit_unexpected_field::${field}`);
  for (const field of ['audit_id', 'registration_request_id', 'request_fingerprint', 'component_descriptor_fingerprint', 'dependency_graph_fingerprint', 'policy_context_fingerprint', 'component_type', 'decision', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['tenant_binding', 'environment_binding', 'component_binding', 'versions']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  for (const field of ['runtime_mutated', 'components_registered', 'components_initialized', 'components_activated', 'executed']) {
    if (audit[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (audit.validator_version !== TRANSCRIPTION_RUNTIME_REGISTRATION_AUDIT_VERSION) errors.push('validator_version_invalid');
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

function buildRuntimeRegistrationAudit(input = {}) {
  const request = input.request || {};
  const descriptor = request.component_descriptor || {};
  const graph = request.dependency_graph || {};
  const policy = input.policy || {};
  const audit = {
    audit_id: `runtime_registration_audit_${request.registration_request_id || 'missing'}`,
    registration_request_id: request.registration_request_id || 'registration_request_not_available',
    request_fingerprint: fingerprint(request),
    component_descriptor_fingerprint: fingerprint(descriptor),
    dependency_graph_fingerprint: fingerprint(graph),
    policy_context_fingerprint: fingerprint(request.policy_context),
    tenant_binding: {
      request_tenant_id: request.tenant_id || 'tenant_not_available',
      descriptor_tenant_id: descriptor.tenant_id || 'tenant_not_available',
      policy_tenant_id: request.policy_context && request.policy_context.tenant_id ? request.policy_context.tenant_id : 'tenant_not_available'
    },
    environment_binding: {
      request_environment: request.environment || 'environment_not_available',
      descriptor_environment: descriptor.environment || 'environment_not_available'
    },
    component_binding: {
      component_ref_id: descriptor.component_ref_id || 'component_not_available',
      component_type: descriptor.component_type || 'component_type_not_available'
    },
    component_type: descriptor.component_type || 'component_type_not_available',
    blockers: uniqueSorted([...(input.blockers || []), ...(policy.blocking_reasons || [])]),
    decision: input.decision || policy.status || 'REGISTRATION_VALIDATION_FAILED',
    logical_sequence: input.logical_sequence || 1,
    versions: {
      request_version: request.registration_request_version || 0,
      component_ref_version: descriptor.component_ref_version || 0,
      dependency_graph_version: graph.graph_version || 0,
      policy_version: request.policy_context && request.policy_context.policy_version ? request.policy_context.policy_version : 'policy_version_not_available'
    },
    simulation: true,
    runtime_mutated: false,
    components_registered: false,
    components_initialized: false,
    components_activated: false,
    executed: false,
    validator_version: TRANSCRIPTION_RUNTIME_REGISTRATION_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  RUNTIME_REGISTRATION_AUDIT_FIELDS,
  TRANSCRIPTION_RUNTIME_REGISTRATION_AUDIT_VERSION,
  buildRuntimeRegistrationAudit,
  validateRuntimeRegistrationAudit
};
