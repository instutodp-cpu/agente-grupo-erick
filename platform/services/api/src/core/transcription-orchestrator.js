'use strict';

const {
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const { evaluateTranscriptionConsent } = require('./transcription-consent-policy');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateProviderContract } = require('./transcription-provider-contract');
const {
  PROVIDER_ADAPTER_SAFE_FLAGS,
  cloneFrozen,
  validateProviderAdapterImplementation,
  validateProviderAdapterMetadata,
  validateProviderAdapterMethodResult
} = require('./transcription-provider-adapter-interface');
const { createTranscriptionProviderAdapterMock } = require('../adapters/transcription/transcription-provider-adapter-mock');
const { validateTranscriptionTransportContract } = require('./transcription-transport-contract');
const { validateTranscriptionTransportBoundary } = require('./transcription-transport-validator');
const { validateTranscriptionTransportPolicy } = require('./transcription-transport-policy');
const { buildTranscriptionOrchestratorAudit } = require('./transcription-orchestrator-audit');
const { buildTranscriptionResponse } = require('./transcription-response-contract');
const { createTranscriptionExecutionContext } = require('./transcription-execution-context');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { selectTranscriptionProvider } = require('./transcription-provider-selection-engine');

const TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION = 'transcription_orchestrator_validator_v1';
const ORCHESTRATOR_REQUEST_FIELDS = Object.freeze([
  'request_id',
  'request_version',
  'tenant_id',
  'conversation_id',
  'provider_slug',
  'requested_language',
  'requested_format',
  'requested_features',
  'consent_context',
  'simulation_context',
  'transport_context',
  'adapter_context',
  'metadata',
  'validator_version'
]);
const ORCHESTRATOR_STATUSES = Object.freeze([
  'BLOCKED',
  'SIMULATED_SUCCESS',
  'SIMULATED_FAILURE',
  'VALIDATION_FAILED',
  'CONSENT_DENIED',
  'PROVIDER_BLOCKED',
  'TRANSPORT_BLOCKED'
]);
const PIPELINE_STEPS = Object.freeze([
  'validateRequest',
  'selectProvider',
  'validateConsent',
  'validateProvider',
  'validateAdapter',
  'validateTransport',
  'validateLifecycle',
  'executeMock',
  'sanitizeResult',
  'buildAudit',
  'buildResponse'
]);

function exactFields(value, fields, prefix, errors) {
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
  }
}

function validateTranscriptionOrchestratorRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['orchestrator_request_must_be_object'] };
  exactFields(request, ORCHESTRATOR_REQUEST_FIELDS, 'request', errors);
  for (const field of ['request_id', 'tenant_id', 'conversation_id', 'provider_slug', 'requested_language', 'requested_format', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.request_version) || request.request_version < 1) errors.push('request_version_invalid');
  if (!Array.isArray(request.requested_features) || request.requested_features.length === 0 || !request.requested_features.every(isNonEmptyString)) errors.push('requested_features_invalid');
  for (const field of ['consent_context', 'simulation_context', 'transport_context', 'adapter_context', 'metadata']) {
    if (!isPlainObject(request[field])) errors.push(`${field}_must_be_object`);
  }
  if (request.validator_version !== TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (isPlainObject(request.metadata)) {
    if (!isNonEmptyString(request.metadata.transcription_id)) errors.push('metadata_transcription_id_invalid');
    if (request.metadata.rollout_percentage !== 0) errors.push('metadata_rollout_percentage_must_be_zero');
    if (request.metadata.production_blocked !== true) errors.push('metadata_production_blocked_must_be_true');
    if (request.metadata.simulation !== true) errors.push('metadata_simulation_must_be_true');
    for (const field of ['network_used', 'provider_called', 'executed']) {
      if (request.metadata[field] !== false) errors.push(`metadata_${field}_must_be_false`);
    }
  }
  if (isPlainObject(request.simulation_context)) {
    if (request.simulation_context.simulation !== true) errors.push('simulation_context_simulation_must_be_true');
    if (request.simulation_context.production_blocked !== true) errors.push('simulation_context_production_blocked_must_be_true');
    if (request.simulation_context.rollout_percentage !== 0) errors.push('simulation_context_rollout_percentage_must_be_zero');
    for (const field of ['network_used', 'provider_called', 'executed']) {
      if (request.simulation_context[field] !== false) errors.push(`simulation_context_${field}_must_be_false`);
    }
  }
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findTranscriptionForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function appendStep(context, step, additions = {}) {
  return Object.freeze({
    ...context,
    ...additions,
    steps: [...(context.steps || []), step],
    logical_time: (context.logical_time || 0) + 1,
    sequence: (context.sequence || 0) + 1
  });
}

function block(context, step, status, errors) {
  return appendStep(context, step, {
    status,
    blockers: uniqueSorted([...(context.blockers || []), ...(errors || [])])
  });
}

function validateRequest(context) {
  const validation = validateTranscriptionOrchestratorRequest(context.request);
  if (!validation.valid) return block(context, 'validateRequest', 'VALIDATION_FAILED', validation.errors);
  return appendStep(context, 'validateRequest', { request_validation: validation });
}

function selectProvider(context) {
  if (context.blockers.length > 0) return context;
  if (context.request.provider_slug !== 'AUTO') return appendStep(context, 'selectProvider', { selection: null });
  const selection = selectTranscriptionProvider({
    request: context.selection_request || {},
    profiles: context.selection_profiles || []
  });
  if (!selection.result || selection.result.status !== 'SELECTED_SIMULATION') {
    const reason = selection.result ? selection.result.decision_reason : 'provider_selection_failed';
    return block(context, 'selectProvider', 'PROVIDER_BLOCKED', selection.errors && selection.errors.length > 0 ? selection.errors : [reason]);
  }
  return appendStep(context, 'selectProvider', { selection });
}

function validateConsent(context) {
  if (context.blockers.length > 0) return context;
  const consent = context.request.consent_context.consent;
  const evaluation = evaluateTranscriptionConsent(consent, {
    tenant_id: context.request.tenant_id,
    transcription_id: context.request.metadata.transcription_id,
    operation: 'summarize_transcription',
    now: context.request.metadata.evaluated_at || new Date(0).toISOString()
  });
  if (evaluation.allowed !== true) return block(context, 'validateConsent', 'CONSENT_DENIED', evaluation.blocking_reasons || ['consent_denied']);
  return appendStep(context, 'validateConsent', { consent: evaluation });
}

function validateProvider(context) {
  if (context.blockers.length > 0) return context;
  if (context.request.provider_slug === 'AUTO') {
    return appendStep(context, 'validateProvider', { provider: context.selection.result });
  }
  const providerContract = context.provider_contract;
  const validation = validateProviderContract(providerContract);
  const errors = [...validation.errors];
  if (providerContract && providerContract.provider_slug !== context.request.provider_slug) errors.push('provider_slug_mismatch');
  if (!validation.valid || errors.length > 0) return block(context, 'validateProvider', 'PROVIDER_BLOCKED', errors);
  return appendStep(context, 'validateProvider', { provider: providerContract });
}

function validateAdapter(context) {
  if (context.blockers.length > 0) return context;
  const adapter = context.adapter || createTranscriptionProviderAdapterMock();
  const implementationValidation = validateProviderAdapterImplementation(adapter);
  const metadata = implementationValidation.valid ? adapter.metadata() : {};
  const metadataValidation = validateProviderAdapterMetadata(metadata);
  const errors = [...implementationValidation.errors, ...metadataValidation.errors];
  if (context.request.provider_slug !== 'AUTO' && metadata.provider_slug && metadata.provider_slug !== context.request.provider_slug) errors.push('adapter_provider_slug_mismatch');
  if (context.request.adapter_context && context.request.adapter_context.adapter_id && metadata.adapter_id !== context.request.adapter_context.adapter_id) {
    errors.push('adapter_id_mismatch');
  }
  if (!implementationValidation.valid || !metadataValidation.valid || errors.length > 0) return block(context, 'validateAdapter', 'PROVIDER_BLOCKED', errors);
  return appendStep(context, 'validateAdapter', { adapter, adapter_metadata: metadata });
}

function validateTransport(context) {
  if (context.blockers.length > 0) return context;
  const contractValidation = validateTranscriptionTransportContract(context.transport_contract);
  const boundaryValidation = validateTranscriptionTransportBoundary(context.transport_contract, {
    rollout_percentage: 0,
    runtime_enabled: false,
    provider_enabled: false,
    transport_blocked: true,
    secret_resolved: false,
    production_blocked: true,
    network_enabled: false
  });
  const policyValidation = validateTranscriptionTransportPolicy(context.transport_contract && context.transport_contract.transport_policy);
  const errors = [
    ...contractValidation.errors,
    ...boundaryValidation.errors,
    ...policyValidation.errors
  ];
  if (context.request.provider_slug !== 'AUTO' && context.transport_contract && context.transport_contract.provider_slug !== context.request.provider_slug) errors.push('transport_provider_slug_mismatch');
  if (!contractValidation.valid || !boundaryValidation.valid || !policyValidation.valid || errors.length > 0) {
    return block(context, 'validateTransport', 'TRANSPORT_BLOCKED', errors);
  }
  return appendStep(context, 'validateTransport', { transport: context.transport_contract });
}

function validateLifecycle(context) {
  if (context.blockers.length > 0) return context;
  const lifecycle = context.transport_lifecycle || {};
  const errors = [];
  if (lifecycle.transport_state !== 'BLOCKED') errors.push('lifecycle_transport_state_must_be_BLOCKED');
  if (context.request.provider_slug !== 'AUTO' && lifecycle.provider_slug !== context.request.provider_slug) errors.push('lifecycle_provider_slug_mismatch');
  if (lifecycle.transport_contract_id !== context.transport_contract.transport_contract_id) errors.push('lifecycle_transport_contract_id_mismatch');
  if (lifecycle.runtime_enabled !== false) errors.push('lifecycle_runtime_enabled_must_be_false');
  if (lifecycle.provider_enabled !== false) errors.push('lifecycle_provider_enabled_must_be_false');
  if (lifecycle.network_enabled !== false) errors.push('lifecycle_network_enabled_must_be_false');
  if (lifecycle.production_blocked !== true) errors.push('lifecycle_production_blocked_must_be_true');
  if (errors.length > 0) return block(context, 'validateLifecycle', 'TRANSPORT_BLOCKED', errors);
  return appendStep(context, 'validateLifecycle', { lifecycle });
}

function executeMock(context) {
  if (context.blockers.length > 0) return context;
  const adapter = context.adapter || createTranscriptionProviderAdapterMock();
  const input = {
    adapter_id: context.adapter_metadata.adapter_id,
    provider_slug: context.request.provider_slug === 'AUTO' ? context.adapter_metadata.provider_slug : context.request.provider_slug,
    operation: 'validate',
    request_id: context.request.request_id,
    simulated: true
  };
  const mockResult = adapter.validate(input);
  const validation = validateProviderAdapterMethodResult('validate', mockResult, context.adapter_metadata);
  if (!validation.valid || mockResult.executed !== false || mockResult.provider_enabled !== false || mockResult.network_enabled !== false) {
    return block(context, 'executeMock', 'SIMULATED_FAILURE', validation.errors.length ? validation.errors : ['mock_invalid']);
  }
  return appendStep(context, 'executeMock', {
    mock: mockResult,
    result: {
      text: 'synthetic transcript placeholder',
      confidence: 1
    },
    status: 'SIMULATED_SUCCESS'
  });
}

function sanitizeResult(context) {
  if (context.blockers.length > 0) return context;
  return appendStep(context, 'sanitizeResult', {
    result: cloneFrozen(sanitizeTranscriptionData(context.result))
  });
}

function buildAudit(context) {
  const audit = buildTranscriptionOrchestratorAudit(context);
  return appendStep(context, 'buildAudit', { audit });
}

function buildResponse(context) {
  const response = buildTranscriptionResponse(context);
  return appendStep(context, 'buildResponse', {
    response,
    execution_context: createTranscriptionExecutionContext({
      state: context.status || 'BLOCKED',
      provider: context.provider || null,
      adapter: context.adapter_metadata || null,
      transport: context.transport || null,
      consent: context.consent || null,
      readiness: context.readiness || null,
      selection: context.selection || null,
      mock: context.mock || null,
      audit: context.audit || null,
      result: response
    })
  });
}

function runMockTranscriptionOrchestrator(input = {}) {
  const initial = Object.freeze({
    request: input.request || {},
    provider_contract: input.provider_contract || null,
    adapter: input.adapter || createTranscriptionProviderAdapterMock(),
    transport_contract: input.transport_contract || null,
    transport_lifecycle: input.transport_lifecycle || null,
    selection_request: input.selection_request || null,
    selection_profiles: input.selection_profiles || [],
    readiness: input.readiness || null,
    status: 'BLOCKED',
    blockers: [],
    warnings: [],
    steps: [],
    logical_time: 0,
    sequence: 0,
    ...PROVIDER_ADAPTER_SAFE_FLAGS
  });
  return PIPELINE_STEPS.reduce((context, step) => {
    const handlers = {
      validateRequest,
      selectProvider,
      validateConsent,
      validateProvider,
      validateAdapter,
      validateTransport,
      validateLifecycle,
      executeMock,
      sanitizeResult,
      buildAudit,
      buildResponse
    };
    return handlers[step](context);
  }, initial);
}

module.exports = {
  ORCHESTRATOR_REQUEST_FIELDS,
  ORCHESTRATOR_STATUSES,
  PIPELINE_STEPS,
  TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION,
  buildAudit,
  buildResponse,
  executeMock,
  runMockTranscriptionOrchestrator,
  sanitizeResult,
  selectProvider,
  validateAdapter,
  validateConsent,
  validateLifecycle,
  validateProvider,
  validateRequest,
  validateTranscriptionOrchestratorRequest,
  validateTransport
};
