'use strict';

const {
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');

const TRANSCRIPTION_PROVIDER_CONTRACT_VERSION = 'transcription_provider_contract_boundary_v1';
const ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS = Object.freeze(['deepgram', 'google_cloud_speech']);
const PRIMARY_PROVIDER_SLUG = 'deepgram';
const FALLBACK_PROVIDER_SLUG = 'google_cloud_speech';
const PROVIDER_ROLES = Object.freeze(['primary_contract_candidate', 'fallback_contract_candidate']);
const CONTRACT_STATUSES = Object.freeze(['draft', 'incomplete', 'structurally_valid', 'ready_for_mock_parity_review', 'rejected']);
const CONTRACT_ENVIRONMENTS = Object.freeze(['local_test', 'non_production']);
const SUPPORTED_PROVIDER_OPERATIONS = Object.freeze([
  'simulate_provider_request',
  'validate_provider_request',
  'normalize_provider_response',
  'classify_provider_error'
]);
const BLOCKED_PROVIDER_OPERATIONS = Object.freeze([
  'transcribe_real_audio',
  'call_provider',
  'execute_provider',
  'production_transcription'
]);
const PROVIDER_BOUNDARY_FORBIDDEN_FIELDS = Object.freeze(uniqueSorted([
  'secret',
  'secret_value',
  'api_key',
  'apiKey',
  'token',
  'access_token',
  'refresh_token',
  'private_key',
  'client_secret',
  'credentials',
  'authorization',
  'headers',
  'cookie',
  'bearer',
  'password',
  'endpoint',
  'provider_endpoint',
  'url',
  'provider_url',
  'hostname',
  'host',
  'audio',
  'raw_audio',
  'audio_bytes',
  'bytes',
  'buffer',
  'blob',
  'binary',
  'base64',
  'file',
  'filepath',
  'path',
  'stream',
  'upload',
  'provider_payload',
  'raw_transcript',
  'raw_provider_response',
  'provider_response',
  ...findTranscriptionForbiddenFields({}).map((entry) => entry.replace('forbidden_field::', ''))
]));

const REQUIRED_PROVIDER_CONTRACT_FIELDS = Object.freeze([
  'provider_contract_id',
  'provider_slug',
  'contract_version',
  'schema_version',
  'capabilities_version',
  'selection_report_id',
  'selection_dataset_version',
  'selection_criteria_version',
  'provider_role',
  'contract_status',
  'deployment_model',
  'supported_operations',
  'supported_languages',
  'supported_audio_formats',
  'max_duration_ms',
  'max_size_bytes',
  'timeout_limit_ms',
  'concurrency_limit',
  'rate_limit_policy_required',
  'budget_policy_required',
  'consent_required',
  'retention_policy_required',
  'deletion_required',
  'raw_media_retention_days',
  'network_allowlist_required',
  'secret_reference_required',
  'transport_required',
  'runtime_registration_allowed',
  'environment',
  'rollout_percentage',
  'simulated',
  'executed',
  'real_provider_called',
  'external_network_called',
  'can_trigger_real_execution',
  'production_blocked',
  'provider_runtime_enabled',
  'provider_selected_for_execution',
  'transport_enabled',
  'secret_resolved'
]);

function isIso(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function findProviderBoundaryForbiddenFields(value) {
  const found = [];
  const seen = new WeakSet();
  const forbidden = new Set(PROVIDER_BOUNDARY_FORBIDDEN_FIELDS);
  function visit(entry, path) {
    if (Buffer.isBuffer(entry) || entry instanceof ArrayBuffer || ArrayBuffer.isView(entry)) {
      found.push(`forbidden_binary::${path || 'value'}`);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(entry)) {
      if (typeof entry === 'string' && /^https?:\/\//i.test(entry)) found.push(`unexpected_url::${path || 'value'}`);
      if (typeof entry === 'string' && entry.length > 2048 && /^[A-Za-z0-9+/=\r\n]+$/.test(entry)) found.push(`base64_payload_too_large::${path || 'value'}`);
      return;
    }
    if (seen.has(entry)) {
      found.push('forbidden_field::cyclic_reference');
      return;
    }
    seen.add(entry);
    for (const [key, nested] of Object.entries(entry)) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) {
        found.push(`forbidden_field::${key}`);
        continue;
      }
      visit(nested, nestedPath);
    }
    seen.delete(entry);
  }
  visit(value, '');
  return uniqueSorted([...found, ...findTranscriptionForbiddenFields(value)]);
}

function validateSafetyFlags(value, errors, prefix = '') {
  const tag = prefix ? `${prefix}_` : '';
  if (value.simulated !== true) errors.push(`${tag}simulated_must_be_true`);
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution', 'provider_runtime_enabled', 'provider_selected_for_execution']) {
    if (value[field] !== false) errors.push(`${tag}${field}_must_be_false`);
  }
  if (value.production_blocked !== true) errors.push(`${tag}production_blocked_must_be_true`);
  if (value.rollout_percentage !== 0) errors.push(`${tag}rollout_percentage_must_be_zero`);
  if (Object.prototype.hasOwnProperty.call(value, 'transport_enabled') && value.transport_enabled !== false) errors.push(`${tag}transport_enabled_must_be_false`);
  if (Object.prototype.hasOwnProperty.call(value, 'secret_resolved') && value.secret_resolved !== false) errors.push(`${tag}secret_resolved_must_be_false`);
}

function validateProviderContract(contract) {
  const errors = [];
  if (!isPlainObject(contract)) return { valid: false, errors: ['provider_contract_must_be_object'] };
  for (const field of REQUIRED_PROVIDER_CONTRACT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(contract, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['provider_contract_id', 'provider_slug', 'schema_version', 'capabilities_version', 'selection_report_id', 'selection_dataset_version', 'selection_criteria_version', 'provider_role', 'contract_status', 'deployment_model', 'environment']) {
    if (!isNonEmptyString(contract[field])) errors.push(`invalid_${field}`);
  }
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(contract.provider_slug)) errors.push(`provider_slug_not_allowed::${contract.provider_slug}`);
  if (!PROVIDER_ROLES.includes(contract.provider_role)) errors.push(`provider_role_not_allowed::${contract.provider_role}`);
  if (contract.provider_slug === PRIMARY_PROVIDER_SLUG && contract.provider_role !== 'primary_contract_candidate') errors.push('deepgram_role_mismatch');
  if (contract.provider_slug === FALLBACK_PROVIDER_SLUG && contract.provider_role !== 'fallback_contract_candidate') errors.push('google_cloud_speech_role_mismatch');
  if (!CONTRACT_STATUSES.includes(contract.contract_status)) errors.push(`contract_status_not_allowed::${contract.contract_status}`);
  if (!Number.isInteger(contract.contract_version) || contract.contract_version < 1) errors.push('contract_version_invalid');
  if (!Array.isArray(contract.supported_operations) || contract.supported_operations.length === 0) errors.push('supported_operations_required');
  if (Array.isArray(contract.supported_operations)) {
    for (const operation of contract.supported_operations) {
      if (!SUPPORTED_PROVIDER_OPERATIONS.includes(operation)) errors.push(`supported_operation_not_allowed::${operation}`);
      if (BLOCKED_PROVIDER_OPERATIONS.includes(operation)) errors.push(`blocked_operation::${operation}`);
    }
  }
  for (const field of ['supported_languages', 'supported_audio_formats']) {
    if (!Array.isArray(contract[field]) || contract[field].length === 0 || !contract[field].every(isNonEmptyString)) errors.push(`${field}_required`);
  }
  for (const field of ['max_duration_ms', 'max_size_bytes', 'timeout_limit_ms', 'concurrency_limit', 'raw_media_retention_days', 'rollout_percentage']) {
    if (!Number.isInteger(contract[field]) || contract[field] < 0) errors.push(`${field}_must_be_non_negative_integer`);
  }
  if (contract.max_duration_ms > 30 * 60 * 1000) errors.push('max_duration_ms_out_of_bounds');
  if (contract.max_size_bytes > 25 * 1024 * 1024) errors.push('max_size_bytes_out_of_bounds');
  if (contract.timeout_limit_ms <= 0 || contract.timeout_limit_ms > 30000) errors.push('timeout_limit_ms_out_of_bounds');
  if (contract.concurrency_limit !== 1) errors.push('concurrency_limit_must_be_one');
  for (const field of ['rate_limit_policy_required', 'budget_policy_required', 'consent_required', 'retention_policy_required', 'deletion_required', 'network_allowlist_required', 'secret_reference_required', 'transport_required']) {
    if (contract[field] !== true) errors.push(`${field}_must_be_true`);
  }
  if (contract.raw_media_retention_days !== 0) errors.push('raw_media_retention_days_must_be_zero');
  if (contract.runtime_registration_allowed !== false) errors.push('runtime_registration_allowed_must_be_false');
  if (!CONTRACT_ENVIRONMENTS.includes(contract.environment)) errors.push('environment_not_allowed');
  if (contract.environment === 'production') errors.push('production_blocked');
  validateSafetyFlags(contract, errors);
  errors.push(...findProviderBoundaryForbiddenFields(contract));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeProviderContract(contract) {
  return Object.freeze(sanitizeTranscriptionData(deepClone(contract)));
}

function buildProviderContractAuditEvent(event = {}) {
  return Object.freeze(sanitizeTranscriptionData({
    event_name: event.event_name || 'provider_contract_registered',
    provider_contract_id: event.provider_contract_id || (event.contract && event.contract.provider_contract_id) || 'provider_contract_not_available',
    provider_slug: event.provider_slug || (event.contract && event.contract.provider_slug) || 'provider_not_available',
    contract_version: event.contract_version || (event.contract && event.contract.contract_version) || null,
    status: event.status || (event.contract && event.contract.contract_status) || 'status_not_available',
    decision: event.decision || null,
    blockers: uniqueSorted(event.blockers || []),
    occurred_at: event.occurred_at || new Date(0).toISOString(),
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
    secret_resolved: false
  }));
}

module.exports = {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  BLOCKED_PROVIDER_OPERATIONS,
  CONTRACT_ENVIRONMENTS,
  CONTRACT_STATUSES,
  FALLBACK_PROVIDER_SLUG,
  PRIMARY_PROVIDER_SLUG,
  PROVIDER_BOUNDARY_FORBIDDEN_FIELDS,
  PROVIDER_ROLES,
  REQUIRED_PROVIDER_CONTRACT_FIELDS,
  SUPPORTED_PROVIDER_OPERATIONS,
  TRANSCRIPTION_PROVIDER_CONTRACT_VERSION,
  buildProviderContractAuditEvent,
  findProviderBoundaryForbiddenFields,
  isIso,
  normalizeProviderContract,
  validateProviderContract,
  validateSafetyFlags
};
