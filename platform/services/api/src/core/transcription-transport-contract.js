'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields
} = require('./transcription-provider-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION = 'transcription_transport_contract_v1';
const TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION = 'transcription_transport_validator_v1';
const TRANSCRIPTION_TRANSPORT_MOCK_VERSION = 'transcription_transport_mock_v1';
const TRANSCRIPTION_TRANSPORT_MOCK_GENERATOR = 'hermes_core_transcription_transport_mock';
const TRANSPORT_TYPES = Object.freeze(['http_future', 'grpc_future', 'websocket_future']);
const TRANSPORT_STATES = Object.freeze(['BLOCKED']);
const TRANSPORT_REVIEW_PHASES = Object.freeze(['draft_review', 'mock_review', 'contract_review', 'validation_review']);
const TRANSPORT_PROVIDER_STATES = Object.freeze(['provider_disabled', 'provider_documentary_review']);
const TRANSPORT_ENVIRONMENTS = Object.freeze(['local_test', 'non_production']);
const REQUIRED_TRANSPORT_FIELDS = Object.freeze([
  'transport_contract_id',
  'contract_version',
  'transport_version',
  'validator_version',
  'provider_slug',
  'transport_type',
  'transport_state',
  'review_phase',
  'transport_policy',
  'transport_readiness',
  'environment',
  'rollout_percentage',
  'runtime_enabled',
  'provider_enabled',
  'network_enabled',
  'secret_resolved',
  'simulated',
  'executed',
  'real_provider_called',
  'external_network_called',
  'can_trigger_real_execution',
  'production_blocked',
  'provider_runtime_enabled',
  'provider_selected_for_execution',
  'transport_enabled'
]);
const REQUIRED_TRANSPORT_MOCK_RESULT_FIELDS = Object.freeze([
  'transport_contract_id',
  'provider_slug',
  'contract_version',
  'transport_version',
  'mock_version',
  'validator_version',
  'transport_state',
  'provider_state',
  'readiness_context',
  'safety_flags',
  'transport_signature',
  'generated_by',
  'generated_at',
  'validation_status',
  'simulated',
  'executed',
  'external_network_called',
  'production_blocked'
]);

const TRANSPORT_SAFE_FLAGS = Object.freeze({
  simulated: true,
  executed: false,
  real_provider_called: false,
  external_network_called: false,
  can_trigger_real_execution: false,
  rollout_percentage: 0,
  production_blocked: true,
  provider_runtime_enabled: false,
  provider_selected_for_execution: false,
  transport_enabled: false,
  secret_resolved: false,
  runtime_enabled: false,
  provider_enabled: false,
  network_enabled: false
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

function safeTransportResult(payload) {
  return deepFreeze(sanitizeTranscriptionData({ ...payload, ...TRANSPORT_SAFE_FLAGS }));
}

function validateTransportSafetyFlags(value, errors, prefix = '') {
  const tag = prefix ? `${prefix}_` : '';
  for (const [field, expected] of Object.entries(TRANSPORT_SAFE_FLAGS)) {
    if (value[field] !== expected) errors.push(`${tag}${field}_must_be_${String(expected)}`);
  }
}

function validateTranscriptionTransportContract(contract) {
  const errors = [];
  if (!isPlainObject(contract)) return { valid: false, errors: ['transport_contract_must_be_object'] };
  for (const field of REQUIRED_TRANSPORT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(contract, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['transport_contract_id', 'contract_version', 'validator_version', 'provider_slug', 'transport_type', 'transport_state', 'review_phase', 'environment']) {
    if (!isNonEmptyString(contract[field])) errors.push(`invalid_${field}`);
  }
  if (contract.contract_version !== TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (contract.validator_version !== TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (!Number.isInteger(contract.transport_version) || contract.transport_version < 1) errors.push('transport_version_invalid');
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(contract.provider_slug)) errors.push(`provider_slug_not_allowed::${contract.provider_slug}`);
  if (!TRANSPORT_TYPES.includes(contract.transport_type)) errors.push(`transport_type_not_allowed::${contract.transport_type}`);
  if (!TRANSPORT_STATES.includes(contract.transport_state)) errors.push(`transport_state_not_allowed::${contract.transport_state}`);
  if (contract.transport_state !== 'BLOCKED') errors.push('transport_state_must_be_BLOCKED');
  if (!TRANSPORT_REVIEW_PHASES.includes(contract.review_phase)) errors.push(`review_phase_not_allowed::${contract.review_phase}`);
  if (!TRANSPORT_ENVIRONMENTS.includes(contract.environment)) errors.push('environment_not_allowed');
  if (!isPlainObject(contract.transport_policy)) errors.push('transport_policy_must_be_object');
  if (!isPlainObject(contract.transport_readiness)) errors.push('transport_readiness_must_be_object');
  validateTransportSafetyFlags(contract, errors);
  errors.push(...findProviderBoundaryForbiddenFields(contract));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function mockSignaturePayload(result) {
  const {
    transport_signature: ignored,
    ...payload
  } = result;
  return payload;
}

function signTransportMockResult(result) {
  return `transport_mock_signature:${stablePayload(mockSignaturePayload(result))}`;
}

function buildTranscriptionTransportMockResult(contract, overrides = {}) {
  const result = {
    transport_contract_id: contract.transport_contract_id,
    provider_slug: contract.provider_slug,
    contract_version: contract.contract_version,
    transport_version: contract.transport_version,
    mock_version: TRANSCRIPTION_TRANSPORT_MOCK_VERSION,
    validator_version: contract.validator_version,
    transport_state: contract.transport_state,
    provider_state: 'provider_disabled',
    readiness_context: {
      review_phase: contract.review_phase,
      transport_type: contract.transport_type,
      network: false,
      connected: false
    },
    safety_flags: { ...TRANSPORT_SAFE_FLAGS },
    transport_signature: '',
    generated_by: TRANSCRIPTION_TRANSPORT_MOCK_GENERATOR,
    generated_at: new Date(0).toISOString(),
    validation_status: 'VALID',
    simulated: true,
    executed: false,
    external_network_called: false,
    production_blocked: true,
    ...overrides
  };
  result.transport_signature = signTransportMockResult(result);
  return deepFreeze(sanitizeTranscriptionData(result));
}

function validateTranscriptionTransportMockResult(result, contract) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['transport_mock_result_must_be_object'] };
  const allowed = new Set(REQUIRED_TRANSPORT_MOCK_RESULT_FIELDS);
  for (const field of REQUIRED_TRANSPORT_MOCK_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) errors.push(`missing_${field}`);
  }
  for (const field of Object.keys(result)) {
    if (!allowed.has(field)) errors.push(`unexpected_mock_result_field::${field}`);
  }
  for (const field of ['transport_contract_id', 'provider_slug', 'contract_version', 'mock_version', 'validator_version', 'transport_state', 'provider_state', 'transport_signature', 'generated_by', 'generated_at', 'validation_status']) {
    if (!isNonEmptyString(result[field])) errors.push(`invalid_${field}`);
  }
  if (!Number.isInteger(result.transport_version) || result.transport_version < 1) errors.push('transport_version_invalid');
  if (result.generated_by !== TRANSCRIPTION_TRANSPORT_MOCK_GENERATOR) errors.push('generated_by_invalid');
  if (result.validation_status !== 'VALID') errors.push('validation_status_invalid');
  if (result.mock_version !== TRANSCRIPTION_TRANSPORT_MOCK_VERSION) errors.push('mock_version_invalid');
  if (result.validator_version !== TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (result.contract_version !== TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (result.transport_state !== 'BLOCKED') errors.push('transport_state_must_be_BLOCKED');
  if (!TRANSPORT_PROVIDER_STATES.includes(result.provider_state)) errors.push(`provider_state_not_allowed::${result.provider_state}`);
  if (!isPlainObject(result.readiness_context)) errors.push('readiness_context_must_be_object');
  if (!isPlainObject(result.safety_flags)) errors.push('safety_flags_must_be_object');
  if (result.simulated !== true) errors.push('simulated_must_be_true');
  if (result.executed !== false) errors.push('executed_must_be_false');
  if (result.external_network_called !== false) errors.push('external_network_called_must_be_false');
  if (result.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (isPlainObject(result.safety_flags)) validateTransportSafetyFlags(result.safety_flags, errors, 'safety_flags');
  if (contract) {
    if (result.transport_contract_id !== contract.transport_contract_id) errors.push('transport_contract_id_mismatch');
    if (result.provider_slug !== contract.provider_slug) errors.push('provider_slug_mismatch');
    if (result.contract_version !== contract.contract_version) errors.push('contract_version_mismatch');
    if (result.transport_version !== contract.transport_version) errors.push('transport_version_mismatch');
    if (result.validator_version !== contract.validator_version) errors.push('validator_version_mismatch');
  }
  if (isNonEmptyString(result.transport_signature)) {
    try {
      if (result.transport_signature !== signTransportMockResult(result)) errors.push('transport_signature_invalid');
    } catch (error) {
      errors.push(`transport_signature_invalid::${error.message}`);
    }
  }
  errors.push(...findProviderBoundaryForbiddenFields(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeTranscriptionTransportContract(contract) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(contract)));
}

module.exports = {
  REQUIRED_TRANSPORT_FIELDS,
  REQUIRED_TRANSPORT_MOCK_RESULT_FIELDS,
  TRANSPORT_ENVIRONMENTS,
  TRANSPORT_PROVIDER_STATES,
  TRANSPORT_REVIEW_PHASES,
  TRANSPORT_SAFE_FLAGS,
  TRANSPORT_STATES,
  TRANSPORT_TYPES,
  TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION,
  TRANSCRIPTION_TRANSPORT_MOCK_GENERATOR,
  TRANSCRIPTION_TRANSPORT_MOCK_VERSION,
  TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION,
  buildTranscriptionTransportMockResult,
  deepFreeze,
  normalizeTranscriptionTransportContract,
  safeTransportResult,
  signTransportMockResult,
  validateTranscriptionTransportContract,
  validateTranscriptionTransportMockResult,
  validateTransportSafetyFlags
};
