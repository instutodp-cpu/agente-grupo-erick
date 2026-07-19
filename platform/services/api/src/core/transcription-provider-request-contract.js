'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields,
  isIso
} = require('./transcription-provider-contract');

const PROVIDER_REQUEST_OPERATIONS = Object.freeze(['simulate_provider_request', 'validate_provider_request']);

function validateTranscriptionProviderRequest(request, context = {}) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['provider_request_must_be_object'] };
  for (const field of ['request_id', 'provider_contract_id', 'provider_slug', 'configuration_id', 'tenant_id', 'workspace_type', 'transcription_id', 'session_id', 'candidate_id', 'operation', 'language', 'duration_ms', 'size_bytes', 'synthetic_segments_count', 'synthetic_payload_reference', 'idempotency_key', 'timeout_ms', 'requested_at', 'simulated', 'executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution']) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['request_id', 'provider_contract_id', 'provider_slug', 'configuration_id', 'tenant_id', 'workspace_type', 'transcription_id', 'session_id', 'candidate_id', 'operation', 'language', 'synthetic_payload_reference', 'idempotency_key', 'requested_at']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(request.provider_slug)) errors.push(`provider_slug_not_allowed::${request.provider_slug}`);
  if (!PROVIDER_REQUEST_OPERATIONS.includes(request.operation)) errors.push(`operation_not_allowed::${request.operation}`);
  if (!Number.isInteger(request.duration_ms) || request.duration_ms < 0 || request.duration_ms > (context.contract ? context.contract.max_duration_ms : 30 * 60 * 1000)) errors.push('duration_ms_out_of_bounds');
  if (!Number.isInteger(request.size_bytes) || request.size_bytes < 0 || request.size_bytes > (context.contract ? context.contract.max_size_bytes : 25 * 1024 * 1024)) errors.push('size_bytes_out_of_bounds');
  if (!Number.isInteger(request.synthetic_segments_count) || request.synthetic_segments_count < 0 || request.synthetic_segments_count > 20) errors.push('synthetic_segments_count_out_of_bounds');
  if (!Number.isInteger(request.timeout_ms) || request.timeout_ms <= 0 || request.timeout_ms > (context.contract ? context.contract.timeout_limit_ms : 30000)) errors.push('timeout_ms_out_of_bounds');
  if (!isIso(request.requested_at)) errors.push('requested_at_invalid');
  if (context.contract && request.provider_contract_id !== context.contract.provider_contract_id) errors.push('provider_contract_id_mismatch');
  if (context.contract && request.provider_slug !== context.contract.provider_slug) errors.push('provider_slug_mismatch');
  if (context.configuration && request.configuration_id !== context.configuration.configuration_id) errors.push('configuration_id_mismatch');
  if (context.tenant_id && request.tenant_id !== context.tenant_id) errors.push('tenant_id_mismatch');
  if (context.workspace_type && request.workspace_type !== context.workspace_type) errors.push('workspace_type_mismatch');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution']) {
    if (request[field] !== false) errors.push(`${field}_must_be_false`);
  }
  errors.push(...findProviderBoundaryForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeProviderRequest(request) {
  return Object.freeze(sanitizeTranscriptionData(deepClone(request)));
}

module.exports = {
  PROVIDER_REQUEST_OPERATIONS,
  normalizeProviderRequest,
  validateTranscriptionProviderRequest
};
