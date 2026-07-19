'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields
} = require('./transcription-provider-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT_VERSION = 'transcription_provider_adapter_contract_v1';
const TRANSCRIPTION_PROVIDER_ADAPTER_VALIDATOR_VERSION = 'transcription_provider_adapter_validator_v1';
const REQUIRED_PROVIDER_ADAPTER_METHODS = Object.freeze([
  'metadata',
  'validate',
  'health',
  'transcribe',
  'cancel',
  'capabilities',
  'supportedFormats',
  'supportedLanguages',
  'estimateCost',
  'estimateLatency'
]);
const REQUIRED_PROVIDER_ADAPTER_FIELDS = Object.freeze([
  'adapter_id',
  'adapter_version',
  'provider_slug',
  'provider_version',
  'contract_version',
  'validator_version',
  'supported_features',
  'supported_languages',
  'supported_formats',
  'cost_model',
  'latency_profile',
  'transport_contract_version',
  'provider_contract_version',
  'simulated',
  'executed',
  'runtime_enabled',
  'provider_enabled',
  'network_enabled',
  'production_blocked',
  'rollout_percentage'
]);
const PROVIDER_ADAPTER_METHOD_INPUT_FIELDS = Object.freeze([
  'adapter_id',
  'provider_slug',
  'operation',
  'request_id',
  'simulated'
]);
const PROVIDER_ADAPTER_METHOD_RESULT_FIELDS = Object.freeze([
  'adapter_id',
  'provider_slug',
  'method',
  'status',
  'result',
  'errors',
  'simulated',
  'executed',
  'runtime_enabled',
  'provider_enabled',
  'network_enabled',
  'production_blocked',
  'rollout_percentage'
]);
const PROVIDER_ADAPTER_ALLOWED_FEATURES = Object.freeze([
  'metadata',
  'validate',
  'health',
  'transcribe_blocked',
  'cancel_blocked',
  'capabilities',
  'supported_formats',
  'supported_languages',
  'cost_estimation_synthetic',
  'latency_estimation_synthetic'
]);
const PROVIDER_ADAPTER_METHODS = Object.freeze([...REQUIRED_PROVIDER_ADAPTER_METHODS]);
const PROVIDER_ADAPTER_SAFE_FLAGS = Object.freeze({
  simulated: true,
  executed: false,
  runtime_enabled: false,
  provider_enabled: false,
  network_enabled: false,
  production_blocked: true,
  rollout_percentage: 0
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

function cloneFrozen(value) {
  return deepFreeze(deepClone(sanitizeTranscriptionData(value)));
}

function safeAdapterResult(payload) {
  return cloneFrozen({ ...payload, ...PROVIDER_ADAPTER_SAFE_FLAGS });
}

function assertSerializable(value, errors) {
  try {
    stablePayload(value);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
}

function validateExactFields(value, allowedFields, errors, prefix) {
  const allowed = new Set(allowedFields);
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
  }
}

function validateStringArray(value, field, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    errors.push(`${field}_invalid`);
    return;
  }
  if (new Set(value).size !== value.length) errors.push(`${field}_duplicate`);
  const sorted = [...value].sort();
  if (value.some((entry, index) => entry !== sorted[index])) errors.push(`${field}_must_be_sorted`);
}

function validateProviderAdapterMetadata(metadata) {
  const errors = [];
  if (!isPlainObject(metadata)) return { valid: false, errors: ['adapter_metadata_must_be_object'] };
  validateExactFields(metadata, REQUIRED_PROVIDER_ADAPTER_FIELDS, errors, 'adapter');
  assertSerializable(metadata, errors);
  for (const field of ['adapter_id', 'provider_slug', 'provider_version', 'contract_version', 'validator_version', 'transport_contract_version', 'provider_contract_version']) {
    if (!isNonEmptyString(metadata[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(metadata.adapter_version) || metadata.adapter_version < 1) errors.push('adapter_version_invalid');
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(metadata.provider_slug)) errors.push(`provider_slug_not_allowed::${metadata.provider_slug}`);
  if (metadata.contract_version !== TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (metadata.validator_version !== TRANSCRIPTION_PROVIDER_ADAPTER_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  validateStringArray(metadata.supported_features, 'supported_features', errors);
  validateStringArray(metadata.supported_languages, 'supported_languages', errors);
  validateStringArray(metadata.supported_formats, 'supported_formats', errors);
  if (Array.isArray(metadata.supported_features)) {
    for (const feature of metadata.supported_features) {
      if (!PROVIDER_ADAPTER_ALLOWED_FEATURES.includes(feature)) errors.push(`supported_feature_not_allowed::${feature}`);
    }
  }
  if (!isPlainObject(metadata.cost_model)) errors.push('cost_model_invalid');
  if (!isPlainObject(metadata.latency_profile)) errors.push('latency_profile_invalid');
  for (const [field, expected] of Object.entries(PROVIDER_ADAPTER_SAFE_FLAGS)) {
    if (metadata[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  errors.push(...findProviderBoundaryForbiddenFields(metadata));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateProviderAdapterMethodInput(method, input = {}, metadata = {}) {
  const errors = [];
  if (!PROVIDER_ADAPTER_METHODS.includes(method)) errors.push(`method_not_allowed::${method}`);
  if (!isPlainObject(input)) return { valid: false, errors: ['method_input_must_be_object'] };
  validateExactFields(input, PROVIDER_ADAPTER_METHOD_INPUT_FIELDS, errors, 'input');
  assertSerializable(input, errors);
  for (const field of ['adapter_id', 'provider_slug', 'operation', 'request_id']) {
    if (!isNonEmptyString(input[field])) errors.push(`${field}_invalid`);
  }
  if (metadata.adapter_id && input.adapter_id !== metadata.adapter_id) errors.push('adapter_id_mismatch');
  if (metadata.provider_slug && input.provider_slug !== metadata.provider_slug) errors.push('provider_slug_mismatch');
  if (input.operation !== method) errors.push('operation_mismatch');
  if (input.simulated !== true) errors.push('simulated_must_be_true');
  errors.push(...findProviderBoundaryForbiddenFields(input));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateProviderAdapterMethodResult(method, result = {}, metadata = {}) {
  const errors = [];
  if (!PROVIDER_ADAPTER_METHODS.includes(method)) errors.push(`method_not_allowed::${method}`);
  if (!isPlainObject(result)) return { valid: false, errors: ['method_result_must_be_object'] };
  validateExactFields(result, PROVIDER_ADAPTER_METHOD_RESULT_FIELDS, errors, 'result');
  assertSerializable(result, errors);
  for (const field of ['adapter_id', 'provider_slug', 'method', 'status']) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (metadata.adapter_id && result.adapter_id !== metadata.adapter_id) errors.push('adapter_id_mismatch');
  if (metadata.provider_slug && result.provider_slug !== metadata.provider_slug) errors.push('provider_slug_mismatch');
  if (result.method !== method) errors.push('method_mismatch');
  if (!Array.isArray(result.errors)) errors.push('errors_must_be_array');
  if (!isPlainObject(result.result)) errors.push('result_payload_must_be_object');
  for (const [field, expected] of Object.entries(PROVIDER_ADAPTER_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  errors.push(...findProviderBoundaryForbiddenFields(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildProviderAdapterMethodResult(method, metadata, payload = {}) {
  const result = {
    adapter_id: metadata.adapter_id,
    provider_slug: metadata.provider_slug,
    method,
    status: payload.status || `${method}_simulated`,
    result: payload.result || {},
    errors: payload.errors || [],
    ...PROVIDER_ADAPTER_SAFE_FLAGS
  };
  return safeAdapterResult(result);
}

function validateProviderAdapterImplementation(adapter) {
  const errors = [];
  if (!isPlainObject(adapter)) return { valid: false, errors: ['adapter_must_be_object'] };
  for (const method of REQUIRED_PROVIDER_ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') errors.push(`missing_method::${method}`);
  }
  for (const key of Object.keys(adapter)) {
    if (!REQUIRED_PROVIDER_ADAPTER_METHODS.includes(key)) errors.push(`unexpected_method::${key}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeProviderAdapterMetadata(metadata) {
  return cloneFrozen(metadata);
}

module.exports = {
  PROVIDER_ADAPTER_ALLOWED_FEATURES,
  PROVIDER_ADAPTER_METHOD_INPUT_FIELDS,
  PROVIDER_ADAPTER_METHOD_RESULT_FIELDS,
  PROVIDER_ADAPTER_METHODS,
  PROVIDER_ADAPTER_SAFE_FLAGS,
  REQUIRED_PROVIDER_ADAPTER_FIELDS,
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT_VERSION,
  TRANSCRIPTION_PROVIDER_ADAPTER_VALIDATOR_VERSION,
  buildProviderAdapterMethodResult,
  cloneFrozen,
  deepFreeze,
  normalizeProviderAdapterMetadata,
  safeAdapterResult,
  validateProviderAdapterImplementation,
  validateProviderAdapterMetadata,
  validateProviderAdapterMethodInput,
  validateProviderAdapterMethodResult
};
