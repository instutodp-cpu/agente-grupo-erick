'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields
} = require('./transcription-provider-contract');

const TRANSPORT_TYPES = Object.freeze(['http_future', 'grpc_future', 'websocket_future']);
const TRANSPORT_STATES = Object.freeze(['absent', 'mocked', 'structurally_valid', 'blocked']);
const TRANSPORT_ENVIRONMENTS = Object.freeze(['local_test', 'non_production']);
const REQUIRED_TRANSPORT_FIELDS = Object.freeze([
  'transport_contract_id',
  'transport_version',
  'provider_slug',
  'transport_type',
  'transport_state',
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
  for (const field of ['transport_contract_id', 'provider_slug', 'transport_type', 'transport_state', 'environment']) {
    if (!isNonEmptyString(contract[field])) errors.push(`invalid_${field}`);
  }
  if (!Number.isInteger(contract.transport_version) || contract.transport_version < 1) errors.push('transport_version_invalid');
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(contract.provider_slug)) errors.push(`provider_slug_not_allowed::${contract.provider_slug}`);
  if (!TRANSPORT_TYPES.includes(contract.transport_type)) errors.push(`transport_type_not_allowed::${contract.transport_type}`);
  if (!TRANSPORT_STATES.includes(contract.transport_state)) errors.push(`transport_state_not_allowed::${contract.transport_state}`);
  if (contract.transport_state !== 'blocked') errors.push('transport_state_must_be_blocked');
  if (!TRANSPORT_ENVIRONMENTS.includes(contract.environment)) errors.push('environment_not_allowed');
  if (!isPlainObject(contract.transport_policy)) errors.push('transport_policy_must_be_object');
  if (!isPlainObject(contract.transport_readiness)) errors.push('transport_readiness_must_be_object');
  validateTransportSafetyFlags(contract, errors);
  errors.push(...findProviderBoundaryForbiddenFields(contract));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeTranscriptionTransportContract(contract) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(contract)));
}

module.exports = {
  REQUIRED_TRANSPORT_FIELDS,
  TRANSPORT_ENVIRONMENTS,
  TRANSPORT_SAFE_FLAGS,
  TRANSPORT_STATES,
  TRANSPORT_TYPES,
  deepFreeze,
  normalizeTranscriptionTransportContract,
  safeTransportResult,
  validateTranscriptionTransportContract,
  validateTransportSafetyFlags
};
