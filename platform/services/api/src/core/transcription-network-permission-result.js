'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stableCanonicalize, stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_NETWORK_PERMISSION_RESULT_VALIDATOR_VERSION = 'transcription_network_permission_result_validator_v1';
const NETWORK_PERMISSION_SAFE_FLAGS = Object.freeze({
  network_allowed: false,
  dns_attempted: false,
  socket_created: false,
  connection_opened: false,
  tls_attempted: false,
  request_sent: false,
  stream_opened: false,
  response_received: false,
  network_used: false,
  provider_called: false,
  executed: false,
  simulation: true,
  production_blocked: true,
  runtime_enabled: false,
  rollout_percentage: 0
});
const NETWORK_PERMISSION_STATUSES = Object.freeze([
  'NETWORK_REVIEWED_SIMULATION',
  'NETWORK_DENIED',
  'INVALID_DESTINATION_REFERENCE',
  'TENANT_MISMATCH',
  'PROVIDER_MISMATCH',
  'ADAPTER_MISMATCH',
  'TRANSPORT_MISMATCH',
  'PROTOCOL_MISMATCH',
  'SCOPE_MISMATCH',
  'SECRET_CONTEXT_INVALID',
  'POLICY_BLOCKED',
  'VALIDATION_FAILED'
]);
const FORBIDDEN_NETWORK_PERMISSION_STATUSES = Object.freeze([
  'NETWORK_ALLOWED',
  'CONNECTED',
  'REQUEST_SENT',
  'STREAM_OPENED',
  'RESPONSE_RECEIVED',
  'PROVIDER_CALLED',
  'EXECUTED',
  'PRODUCTION_READY'
]);
const NETWORK_PERMISSION_RESULT_FIELDS = Object.freeze([
  'network_decision_id',
  'network_request_id',
  'provider_slug',
  'adapter_id',
  'transport_id',
  'destination_ref_id',
  'operation',
  'protocol',
  'status',
  'decision',
  'decision_reason',
  'policy_status',
  'destination_valid',
  'provider_binding_valid',
  'transport_binding_valid',
  'tenant_binding_valid',
  'secret_context_valid',
  'network_allowed',
  'dns_attempted',
  'socket_created',
  'connection_opened',
  'tls_attempted',
  'request_sent',
  'stream_opened',
  'response_received',
  'network_used',
  'provider_called',
  'executed',
  'simulation',
  'production_blocked',
  'runtime_enabled',
  'rollout_percentage',
  'validator_version'
]);

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(JSON.parse(JSON.stringify(stableCanonicalize(value)))));
}

function validateNetworkPermissionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['network_permission_result_must_be_object'] };
  const allowed = new Set(NETWORK_PERMISSION_RESULT_FIELDS);
  for (const field of NETWORK_PERMISSION_RESULT_FIELDS) if (!Object.prototype.hasOwnProperty.call(result, field)) errors.push(`result_missing_${field}`);
  for (const field of Object.keys(result)) if (!allowed.has(field)) errors.push(`result_unexpected_field::${field}`);
  for (const field of ['network_decision_id', 'network_request_id', 'provider_slug', 'adapter_id', 'transport_id', 'destination_ref_id', 'operation', 'protocol', 'status', 'decision', 'decision_reason', 'policy_status', 'validator_version']) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!NETWORK_PERMISSION_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (FORBIDDEN_NETWORK_PERMISSION_STATUSES.includes(result.status)) errors.push(`status_forbidden::${result.status}`);
  for (const field of ['destination_valid', 'provider_binding_valid', 'transport_binding_valid', 'tenant_binding_valid', 'secret_context_valid']) {
    if (typeof result[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(NETWORK_PERMISSION_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.validator_version !== TRANSCRIPTION_NETWORK_PERMISSION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildNetworkPermissionResult(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const result = {
    network_decision_id: overrides.network_decision_id || `network_permission_${overrides.network_request_id || 'missing'}`,
    network_request_id: overrides.network_request_id || 'network_request_not_available',
    provider_slug: overrides.provider_slug || 'provider_not_available',
    adapter_id: overrides.adapter_id || 'adapter_not_available',
    transport_id: overrides.transport_id || 'transport_not_available',
    destination_ref_id: overrides.destination_ref_id || 'destination_ref_not_available',
    operation: overrides.operation || 'INTERNAL_SERVICE_REQUEST',
    protocol: overrides.protocol || 'INTERNAL_REFERENCE',
    status,
    decision: overrides.decision || status,
    decision_reason: overrides.decision_reason || 'fail_closed',
    policy_status: overrides.policy_status || 'NETWORK_VALIDATION_FAILED',
    destination_valid: overrides.destination_valid === true,
    provider_binding_valid: overrides.provider_binding_valid === true,
    transport_binding_valid: overrides.transport_binding_valid === true,
    tenant_binding_valid: overrides.tenant_binding_valid === true,
    secret_context_valid: overrides.secret_context_valid === true,
    validator_version: TRANSCRIPTION_NETWORK_PERMISSION_RESULT_VALIDATOR_VERSION,
    ...NETWORK_PERMISSION_SAFE_FLAGS
  };
  const validation = validateNetworkPermissionResult(result);
  if (!validation.valid) {
    return cloneFrozen({
      ...result,
      status: 'VALIDATION_FAILED',
      decision: 'VALIDATION_FAILED',
      decision_reason: validation.errors[0] || 'network_permission_result_invalid',
      destination_valid: false,
      provider_binding_valid: false,
      transport_binding_valid: false,
      tenant_binding_valid: false,
      secret_context_valid: false,
      ...NETWORK_PERMISSION_SAFE_FLAGS
    });
  }
  return cloneFrozen(result);
}

module.exports = {
  FORBIDDEN_NETWORK_PERMISSION_STATUSES,
  NETWORK_PERMISSION_RESULT_FIELDS,
  NETWORK_PERMISSION_SAFE_FLAGS,
  NETWORK_PERMISSION_STATUSES,
  TRANSCRIPTION_NETWORK_PERMISSION_RESULT_VALIDATOR_VERSION,
  buildNetworkPermissionResult,
  cloneFrozen,
  validateNetworkPermissionResult
};
