'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields
} = require('./transcription-provider-contract');

const REQUIRED_CAPABILITY_IDS = Object.freeze([
  'batch',
  'timestamps',
  'confidence_scores',
  'deletion_api',
  'retention_control',
  'rate_limit_documentation',
  'pt_br'
]);
const TRANSCRIPTION_PROVIDER_CAPABILITIES = Object.freeze([
  'batch',
  'streaming',
  'timestamps',
  'word_timestamps',
  'confidence_scores',
  'diarization',
  'punctuation',
  'language_detection',
  'custom_vocabulary',
  'redaction',
  'speaker_labels',
  'synchronous',
  'asynchronous',
  'deletion_api',
  'retention_control',
  'audit_logs',
  'budget_limits',
  'rate_limit_documentation',
  'pt_br',
  'pt_pt'
]);
const CAPABILITY_SUPPORT_STATUSES = Object.freeze(['supported_documentally', 'unsupported', 'unknown', 'conditional']);
const CAPABILITY_EVIDENCE_STATUSES = Object.freeze(['documented', 'incomplete', 'missing', 'requires_human_review']);

function validateProviderCapability(capability) {
  const errors = [];
  if (!isPlainObject(capability)) return { valid: false, errors: ['capability_must_be_object'] };
  for (const field of ['capability_id', 'provider_slug', 'support_status', 'evidence_status', 'contract_required', 'runtime_enabled', 'verified_for_execution', 'notes', 'simulated']) {
    if (!Object.prototype.hasOwnProperty.call(capability, field)) errors.push(`missing_${field}`);
  }
  if (!TRANSCRIPTION_PROVIDER_CAPABILITIES.includes(capability.capability_id)) errors.push(`capability_id_not_allowed::${capability.capability_id}`);
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(capability.provider_slug)) errors.push(`provider_slug_not_allowed::${capability.provider_slug}`);
  if (!CAPABILITY_SUPPORT_STATUSES.includes(capability.support_status)) errors.push(`support_status_not_allowed::${capability.support_status}`);
  if (!CAPABILITY_EVIDENCE_STATUSES.includes(capability.evidence_status)) errors.push(`evidence_status_not_allowed::${capability.evidence_status}`);
  if (typeof capability.contract_required !== 'boolean') errors.push('contract_required_must_be_boolean');
  if (capability.runtime_enabled !== false) errors.push('runtime_enabled_must_be_false');
  if (capability.verified_for_execution !== false) errors.push('verified_for_execution_must_be_false');
  if (!isNonEmptyString(capability.notes)) errors.push('notes_required');
  if (capability.simulated !== true) errors.push('simulated_must_be_true');
  if (capability.contract_required === true && capability.support_status !== 'supported_documentally') errors.push(`required_capability_not_supported::${capability.capability_id}`);
  if (capability.contract_required === true && capability.evidence_status !== 'documented') errors.push(`required_capability_evidence_not_documented::${capability.capability_id}`);
  errors.push(...findProviderBoundaryForbiddenFields(capability));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateProviderCapabilitiesSet(capabilities = [], context = {}) {
  const errors = [];
  if (!Array.isArray(capabilities) || capabilities.length === 0) return { valid: false, errors: ['capabilities_required'] };
  const ids = new Set();
  for (const capability of capabilities) {
    const validation = validateProviderCapability(capability);
    if (!validation.valid) errors.push(...validation.errors);
    if (ids.has(capability.capability_id)) errors.push(`capability_duplicate::${capability.capability_id}`);
    ids.add(capability.capability_id);
    if (context.provider_slug && capability.provider_slug !== context.provider_slug) errors.push(`capability_provider_mismatch::${capability.capability_id}`);
  }
  for (const id of REQUIRED_CAPABILITY_IDS) {
    if (!ids.has(id)) errors.push(`required_capability_missing::${id}`);
  }
  return {
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    required_capabilities: [...REQUIRED_CAPABILITY_IDS]
  };
}

function buildCapabilitiesAuditEvent(input = {}) {
  return Object.freeze(sanitizeTranscriptionData({
    event_name: input.event_name || 'capabilities_registered',
    provider_slug: input.provider_slug || 'provider_not_available',
    capabilities_version: input.capabilities_version || 'capabilities_version_not_available',
    status: input.status || 'evaluated',
    blockers: uniqueSorted(input.blockers || []),
    occurred_at: input.occurred_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    provider_runtime_enabled: false,
    provider_selected_for_execution: false
  }));
}

module.exports = {
  CAPABILITY_EVIDENCE_STATUSES,
  CAPABILITY_SUPPORT_STATUSES,
  REQUIRED_CAPABILITY_IDS,
  TRANSCRIPTION_PROVIDER_CAPABILITIES,
  buildCapabilitiesAuditEvent,
  validateProviderCapabilitiesSet,
  validateProviderCapability
};
