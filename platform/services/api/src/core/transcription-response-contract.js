'use strict';

const { deepClone, findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_RESPONSE_VALIDATOR_VERSION = 'transcription_response_validator_v1';
const TRANSCRIPTION_RESPONSE_STATUSES = Object.freeze([
  'BLOCKED',
  'SIMULATED_SUCCESS',
  'SIMULATED_FAILURE',
  'VALIDATION_FAILED',
  'CONSENT_DENIED',
  'PROVIDER_BLOCKED',
  'TRANSPORT_BLOCKED'
]);
const FORBIDDEN_TRANSCRIPTION_RESPONSE_STATUSES = Object.freeze([
  'SUCCESS_REAL',
  'EXECUTED',
  'CONNECTED'
]);
const REQUIRED_TRANSCRIPTION_RESPONSE_FIELDS = Object.freeze([
  'response_id',
  'request_id',
  'provider_slug',
  'provider_version',
  'adapter_version',
  'transport_version',
  'execution_mode',
  'simulation',
  'status',
  'transcript',
  'confidence',
  'audit_id',
  'warnings',
  'validator_version',
  'production_blocked',
  'network_used',
  'provider_called',
  'executed',
  'rollout_percentage'
]);

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function validateTranscriptionResponse(response) {
  const errors = [];
  if (!isPlainObject(response)) return { valid: false, errors: ['transcription_response_must_be_object'] };
  const allowed = new Set(REQUIRED_TRANSCRIPTION_RESPONSE_FIELDS);
  for (const field of REQUIRED_TRANSCRIPTION_RESPONSE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(response, field)) errors.push(`missing_${field}`);
  }
  for (const field of Object.keys(response)) {
    if (!allowed.has(field)) errors.push(`unexpected_response_field::${field}`);
  }
  for (const field of ['response_id', 'request_id', 'provider_slug', 'provider_version', 'execution_mode', 'status', 'transcript', 'audit_id', 'validator_version']) {
    if (!isNonEmptyString(response[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(response.adapter_version) || response.adapter_version < 1) errors.push('adapter_version_invalid');
  if (!Number.isInteger(response.transport_version) || response.transport_version < 1) errors.push('transport_version_invalid');
  if (!TRANSCRIPTION_RESPONSE_STATUSES.includes(response.status)) errors.push(`response_status_not_allowed::${response.status}`);
  if (FORBIDDEN_TRANSCRIPTION_RESPONSE_STATUSES.includes(response.status)) errors.push(`response_status_forbidden::${response.status}`);
  if (typeof response.confidence !== 'number' || response.confidence < 0 || response.confidence > 1 || !Number.isFinite(response.confidence)) errors.push('confidence_invalid');
  if (!Array.isArray(response.warnings)) errors.push('warnings_must_be_array');
  if (response.validator_version !== TRANSCRIPTION_RESPONSE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (response.simulation !== true) errors.push('simulation_must_be_true');
  if (response.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (response.network_used !== false) errors.push('network_used_must_be_false');
  if (response.provider_called !== false) errors.push('provider_called_must_be_false');
  if (response.executed !== false) errors.push('executed_must_be_false');
  if (response.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  try {
    stablePayload(response);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findTranscriptionForbiddenFields(response));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildTranscriptionResponse(context = {}) {
  const request = context.request || {};
  const adapterMetadata = context.adapter_metadata || {};
  const transportContract = context.transport_contract || {};
  const audit = context.audit || {};
  const status = context.status || (context.blockers && context.blockers.length > 0 ? 'BLOCKED' : 'SIMULATED_SUCCESS');
  const response = {
    response_id: `response_${request.request_id || 'missing'}`,
    request_id: request.request_id || 'request_not_available',
    provider_slug: request.provider_slug || adapterMetadata.provider_slug || 'provider_not_available',
    provider_version: adapterMetadata.provider_version || 'provider_version_not_available',
    adapter_version: Number.isInteger(adapterMetadata.adapter_version) ? adapterMetadata.adapter_version : 0,
    transport_version: Number.isInteger(transportContract.transport_version) ? transportContract.transport_version : 0,
    execution_mode: 'mock_transcription_orchestrator',
    simulation: true,
    status,
    transcript: status === 'SIMULATED_SUCCESS' ? 'synthetic transcript placeholder' : 'synthetic transcript blocked',
    confidence: status === 'SIMULATED_SUCCESS' ? 1 : 0,
    audit_id: audit.audit_id || `audit_${request.request_id || 'missing'}`,
    warnings: uniqueSorted(context.warnings || []),
    validator_version: TRANSCRIPTION_RESPONSE_VALIDATOR_VERSION,
    production_blocked: true,
    network_used: false,
    provider_called: false,
    executed: false,
    rollout_percentage: 0
  };
  const validation = validateTranscriptionResponse(response);
  if (!validation.valid) {
    return cloneFrozen({
      ...response,
      status: 'SIMULATED_FAILURE',
      transcript: 'synthetic transcript blocked',
      confidence: 0,
      warnings: uniqueSorted([...response.warnings, ...validation.errors])
    });
  }
  return cloneFrozen(response);
}

module.exports = {
  FORBIDDEN_TRANSCRIPTION_RESPONSE_STATUSES,
  REQUIRED_TRANSCRIPTION_RESPONSE_FIELDS,
  TRANSCRIPTION_RESPONSE_STATUSES,
  TRANSCRIPTION_RESPONSE_VALIDATOR_VERSION,
  buildTranscriptionResponse,
  validateTranscriptionResponse
};
