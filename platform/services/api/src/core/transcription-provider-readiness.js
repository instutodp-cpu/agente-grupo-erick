'use strict';

const {
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_CONFIGURATION_ID,
  TRANSCRIPTION_CONNECTOR_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  TRANSCRIPTION_SECRET_REFERENCE_ID,
  buildSafeTranscriptionError,
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionBlockedReason,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isBlockedOperation,
  isNonEmptyString,
  isPlainObject,
  uniqueSorted,
  validateAdapterMetadata
} = require('./read-only-adapter-contract');
const { validateProviderConfiguration, validateSecretReference } = require('./provider-configuration-contract');
const { validateTranscriptionBudgetPolicy } = require('./transcription-budget-policy');
const { validateTranscriptionConsent } = require('./transcription-consent-policy');
const { validateTranscriptionOperatorApproval } = require('./transcription-operator-approval-policy');
const { validateTranscriptionRetentionPolicy } = require('./transcription-retention-policy');

const TRANSCRIPTION_READINESS_REQUIREMENTS = Object.freeze([
  'candidate_identity_bound',
  'adapter_registered',
  'adapter_runtime_disabled',
  'provider_real_disabled',
  'lifecycle_eligible_for_evaluation',
  'configuration_valid',
  'secret_reference_described_only',
  'consent_valid',
  'retention_policy_valid',
  'budget_policy_valid',
  'operator_approval_valid',
  'tenant_workspace_policy_valid',
  'feature_flag_off',
  'kill_switch_available',
  'rollout_zero',
  'production_blocked',
  'network_blocked',
  'raw_media_blocked',
  'storage_blocked',
  'automatic_execution_blocked',
  'write_actions_blocked',
  'endpoint_absent',
  'scheduler_absent',
  'worker_absent',
  'queue_absent',
  'safety_flags_false'
]);

const REQUIRED_CANDIDATE_FIELDS = Object.freeze([
  'readiness_evaluation_id',
  'readiness_evaluation_version',
  'candidate_id',
  'transcription_id',
  'provider_id',
  'adapter_id',
  'connector_id',
  'configuration_id',
  'secret_reference_id',
  'tenant_id',
  'workspace_type',
  'environment',
  'operation',
  'requested_at',
  'rollout_percentage',
  'policy_versions',
  'simulated',
  'executed',
  'real_provider_called',
  'external_network_called',
  'can_trigger_real_execution',
  'write_allowed',
  'action_allowed',
  'send_allowed',
  'publish_allowed',
  'delete_allowed',
  'production_blocked',
  'network_blocked',
  'raw_media_allowed',
  'storage_enabled',
  'automatic_execution_enabled',
  'endpoint_configured',
  'scheduler_configured',
  'worker_configured',
  'queue_configured'
]);

const ELIGIBLE_LIFECYCLE_STATES = Object.freeze(['readiness_passed', 'runtime_disabled', 'feature_flag_off']);
const REGISTRY_STORAGE = new WeakMap();

function isIso(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function getFromRegistry(registry, method, id) {
  return registry && typeof registry[method] === 'function' ? registry[method](id) : null;
}

function pushRequirement(status, requirement, errors) {
  if (errors.length === 0) {
    status.satisfied.push(requirement);
  } else {
    status.blocking.push(...errors.map((reason) => `${requirement}::${reason}`));
  }
}

function validateCandidateDescriptor(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) return ['candidate_descriptor_missing'];
  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(candidate, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['readiness_evaluation_id', 'candidate_id', 'transcription_id', 'provider_id', 'adapter_id', 'connector_id', 'configuration_id', 'secret_reference_id', 'tenant_id', 'workspace_type', 'environment', 'operation', 'requested_at']) {
    if (!isNonEmptyString(candidate[field])) errors.push(`invalid_${field}`);
  }
  if (candidate.candidate_id !== TRANSCRIPTION_READINESS_CANDIDATE_ID) errors.push('candidate_id_mismatch');
  if (candidate.provider_id !== TRANSCRIPTION_PROVIDER_ID) errors.push('provider_id_mismatch');
  if (candidate.adapter_id !== TRANSCRIPTION_ADAPTER_ID) errors.push('adapter_id_mismatch');
  if (candidate.connector_id !== TRANSCRIPTION_CONNECTOR_ID) errors.push('connector_id_mismatch');
  if (candidate.configuration_id !== TRANSCRIPTION_CONFIGURATION_ID) errors.push('configuration_id_mismatch');
  if (candidate.secret_reference_id !== TRANSCRIPTION_SECRET_REFERENCE_ID) errors.push('secret_reference_id_mismatch');
  if (!Number.isInteger(candidate.readiness_evaluation_version) || candidate.readiness_evaluation_version < 1) errors.push('readiness_evaluation_version_invalid');
  if (!isPlainObject(candidate.policy_versions)) errors.push('policy_versions_required');
  if (!['local_test', 'non_production'].includes(candidate.environment)) errors.push('environment_not_allowed');
  if (candidate.environment === 'production') errors.push('production_blocked');
  if (!isIso(candidate.requested_at)) errors.push('requested_at_invalid');
  if (candidate.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (candidate.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution', 'write_allowed', 'action_allowed', 'send_allowed', 'publish_allowed', 'delete_allowed']) {
    if (candidate[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (candidate.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (candidate.network_blocked !== true) errors.push('network_blocked_must_be_true');
  if (candidate.raw_media_allowed !== false) errors.push('raw_media_must_be_blocked');
  if (candidate.storage_enabled !== false) errors.push('storage_must_be_disabled');
  if (candidate.automatic_execution_enabled !== false) errors.push('automatic_execution_must_be_disabled');
  for (const field of ['endpoint_configured', 'scheduler_configured', 'worker_configured', 'queue_configured']) {
    if (candidate[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (isBlockedOperation(candidate.operation) || candidate.operation === 'transcribe_real_audio') errors.push(`blocked_operation::${candidate.operation}`);
  errors.push(...findTranscriptionForbiddenFields(candidate));
  return uniqueSorted(errors);
}

function validateIdentityBindings(candidate, context = {}) {
  const errors = [];
  const bindings = [
    ['adapter_metadata', context.adapterMetadata],
    ['lifecycle', context.lifecycleRecord],
    ['configuration', context.providerConfiguration],
    ['secret_reference', context.secretReference],
    ['consent', context.consentRecord],
    ['retention_policy', context.retentionPolicy],
    ['budget_policy', context.budgetPolicy],
    ['operator_approval', context.operatorApproval]
  ];
  for (const [name, record] of bindings) {
    if (!record) continue;
    for (const field of ['candidate_id', 'provider_id', 'adapter_id', 'connector_id', 'configuration_id', 'tenant_id', 'workspace_type']) {
      if (candidate[field] && record[field] && candidate[field] !== record[field]) errors.push(`${name}_${field}_mismatch`);
    }
    if (name === 'secret_reference' && record.reference_id && candidate.secret_reference_id !== record.reference_id) errors.push('secret_reference_id_mismatch');
    if (name === 'operator_approval' && record.candidate_id !== candidate.candidate_id) errors.push('operator_approval_candidate_id_mismatch');
    if (name === 'consent' && record.transcription_id !== candidate.transcription_id) errors.push('consent_transcription_id_mismatch');
  }
  return uniqueSorted(errors);
}

function validateTenantWorkspacePolicy(candidate, policy) {
  const errors = [];
  if (!isPlainObject(policy)) return ['tenant_workspace_policy_missing'];
  if (policy.allowed !== true) errors.push('tenant_workspace_policy_not_allowed');
  if (policy.tenant_id !== candidate.tenant_id) errors.push('tenant_workspace_policy_tenant_mismatch');
  if (policy.workspace_type !== candidate.workspace_type) errors.push('tenant_workspace_policy_workspace_mismatch');
  for (const field of ['write_allowed', 'action_allowed', 'send_allowed', 'publish_allowed', 'delete_allowed']) {
    if (policy[field] !== false) errors.push(`tenant_workspace_policy_${field}_must_be_false`);
  }
  return uniqueSorted(errors);
}

function validateSyntheticEvidence(evidence = {}) {
  const errors = [];
  if (!isPlainObject(evidence)) return ['synthetic_evidence_missing'];
  if (evidence.provider_called === true || evidence.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  if (evidence.external_network_called !== false || evidence.network_attempts !== 0) errors.push('external_network_called_must_be_false');
  if (evidence.raw_media_present === true) errors.push('raw_media_detected');
  if (evidence.storage_configured === true) errors.push('storage_configured');
  if (evidence.can_trigger_real_execution !== false) errors.push('can_trigger_real_execution_must_be_false');
  errors.push(...findTranscriptionForbiddenFields(evidence));
  return uniqueSorted(errors);
}

function collectReadinessRequirements(candidate, context = {}) {
  const status = { satisfied: [], blocking: [] };
  const candidateErrors = validateCandidateDescriptor(candidate);
  pushRequirement(status, 'candidate_identity_bound', candidateErrors);

  const adapter = getFromRegistry(context.adapterRegistry, 'getAdapter', candidate && candidate.adapter_id);
  const adapterMetadata = context.adapterMetadata || (adapter && adapter.metadata);
  const adapterErrors = [];
  if (!adapterMetadata) {
    adapterErrors.push('adapter_not_registered');
  } else {
    const adapterValidation = validateAdapterMetadata(adapterMetadata);
    if (!adapterValidation.valid) adapterErrors.push('adapter_metadata_invalid');
    if (adapterMetadata.adapter_id !== candidate.adapter_id) adapterErrors.push('adapter_id_mismatch');
    if (adapterMetadata.provider_id !== candidate.provider_id) adapterErrors.push('adapter_provider_id_mismatch');
    if (adapterMetadata.readiness_candidate_id !== candidate.candidate_id) adapterErrors.push('adapter_candidate_id_mismatch');
  }
  pushRequirement(status, 'adapter_registered', adapterErrors);
  pushRequirement(status, 'adapter_runtime_disabled', adapterMetadata && adapterMetadata.enabled === false ? [] : ['adapter_enabled']);

  const lifecycle = context.lifecycleRecord || getFromRegistry(context.lifecycleRegistry, 'getConnector', candidate && candidate.connector_id);
  const lifecycleErrors = [];
  if (!lifecycle) {
    lifecycleErrors.push('lifecycle_missing');
  } else {
    if (!ELIGIBLE_LIFECYCLE_STATES.includes(lifecycle.lifecycle_state)) lifecycleErrors.push(`lifecycle_state_not_eligible::${lifecycle.lifecycle_state}`);
    if (lifecycle.runtime_enabled !== false) lifecycleErrors.push('runtime_enabled');
    if (lifecycle.real_provider_enabled !== false) lifecycleErrors.push('real_provider_enabled');
  }
  pushRequirement(status, 'provider_real_disabled', lifecycle && lifecycle.real_provider_enabled === false ? [] : ['real_provider_enabled']);
  pushRequirement(status, 'lifecycle_eligible_for_evaluation', lifecycleErrors);

  const configuration = context.providerConfiguration || getFromRegistry(context.configurationRegistry, 'getConfiguration', candidate && candidate.configuration_id);
  const configurationErrors = [];
  if (!configuration) {
    configurationErrors.push('provider_configuration_missing');
  } else {
    const validation = validateProviderConfiguration(configuration, { now: context.now });
    if (!validation.valid) configurationErrors.push(...validation.errors);
    if (configuration.configuration_status !== 'structurally_ready') configurationErrors.push('configuration_not_structurally_ready');
    if (configuration.disabled !== false) configurationErrors.push('configuration_disabled');
  }
  pushRequirement(status, 'configuration_valid', configurationErrors);

  const secretReference = context.secretReference || getFromRegistry(context.secretReferenceRegistry, 'getSecretReference', candidate && candidate.secret_reference_id);
  const secretErrors = [];
  if (!secretReference) {
    secretErrors.push('secret_reference_missing');
  } else {
    const validation = validateSecretReference(secretReference, { now: context.now });
    if (!validation.valid) secretErrors.push(...validation.errors);
    if (secretReference.synthetic !== true) secretErrors.push('secret_reference_must_be_synthetic');
    if (secretReference.secret_value || secretReference.token || secretReference.api_key) secretErrors.push('secret_value_present');
    if (secretReference.status === 'revoked' || secretReference.revoked !== false) secretErrors.push('secret_reference_revoked');
    if (secretReference.disabled !== false) secretErrors.push('secret_reference_disabled');
  }
  pushRequirement(status, 'secret_reference_described_only', secretErrors);

  pushRequirement(status, 'consent_valid', validateTranscriptionConsent(context.consentRecord, {
    tenant_id: candidate && candidate.tenant_id,
    workspace_type: candidate && candidate.workspace_type,
    transcription_id: candidate && candidate.transcription_id,
    operation: 'evaluate_transcription_candidate',
    now: context.now
  }).errors);
  pushRequirement(status, 'retention_policy_valid', validateTranscriptionRetentionPolicy(context.retentionPolicy, {
    tenant_id: candidate && candidate.tenant_id,
    workspace_type: candidate && candidate.workspace_type,
    now: context.now
  }).errors);
  pushRequirement(status, 'budget_policy_valid', validateTranscriptionBudgetPolicy(context.budgetPolicy, {
    tenant_id: candidate && candidate.tenant_id,
    workspace_type: candidate && candidate.workspace_type,
    environment: candidate && candidate.environment
  }).errors);
  pushRequirement(status, 'operator_approval_valid', validateTranscriptionOperatorApproval(context.operatorApproval, {
    candidate_id: candidate && candidate.candidate_id,
    tenant_id: candidate && candidate.tenant_id,
    environment: candidate && candidate.environment,
    operation: 'evaluate_transcription_candidate',
    now: context.now
  }).errors);
  pushRequirement(status, 'tenant_workspace_policy_valid', validateTenantWorkspacePolicy(candidate, context.tenantWorkspacePolicy));
  pushRequirement(status, 'feature_flag_off', context.featureFlagEnabled === false ? [] : ['feature_flag_enabled_or_missing']);
  pushRequirement(status, 'kill_switch_available', context.killSwitchAvailable === true && context.killSwitchActive !== true ? [] : ['kill_switch_unavailable_or_active']);
  pushRequirement(status, 'rollout_zero', candidate && candidate.rollout_percentage === 0 && context.rollout_percentage === 0 ? [] : ['rollout_percentage_must_be_zero']);
  pushRequirement(status, 'production_blocked', candidate && candidate.environment !== 'production' && candidate.production_blocked === true ? [] : ['production_not_blocked']);
  pushRequirement(status, 'network_blocked', candidate && candidate.network_blocked === true ? [] : ['network_not_blocked']);
  pushRequirement(status, 'raw_media_blocked', candidate && candidate.raw_media_allowed === false ? [] : ['raw_media_allowed']);
  pushRequirement(status, 'storage_blocked', candidate && candidate.storage_enabled === false ? [] : ['storage_enabled']);
  pushRequirement(status, 'automatic_execution_blocked', candidate && candidate.automatic_execution_enabled === false ? [] : ['automatic_execution_enabled']);
  pushRequirement(status, 'write_actions_blocked', candidate && ['write_allowed', 'action_allowed', 'send_allowed', 'publish_allowed', 'delete_allowed'].every((field) => candidate && candidate[field] === false) ? [] : ['write_action_allowed']);
  pushRequirement(status, 'endpoint_absent', candidate && candidate.endpoint_configured === false && !(configuration && (configuration.endpoint || configuration.provider_url)) ? [] : ['endpoint_configured']);
  pushRequirement(status, 'scheduler_absent', candidate && candidate.scheduler_configured === false ? [] : ['scheduler_configured']);
  pushRequirement(status, 'worker_absent', candidate && candidate.worker_configured === false ? [] : ['worker_configured']);
  pushRequirement(status, 'queue_absent', candidate && candidate.queue_configured === false ? [] : ['queue_configured']);
  pushRequirement(status, 'safety_flags_false', validateSyntheticEvidence(context.syntheticEvidence));
  pushRequirement(status, 'candidate_identity_bound', validateIdentityBindings(candidate, {
    adapterMetadata,
    lifecycleRecord: lifecycle,
    providerConfiguration: configuration,
    secretReference,
    consentRecord: context.consentRecord,
    retentionPolicy: context.retentionPolicy,
    budgetPolicy: context.budgetPolicy,
    operatorApproval: context.operatorApproval
  }));

  return {
    satisfied_requirements: uniqueSorted(status.satisfied),
    blocking_requirements: uniqueSorted(status.blocking)
  };
}

function buildReadinessAuditEvent(candidate, fields = {}) {
  return sanitizeTranscriptionData({
    event_name: fields.event_name || 'transcription_readiness_evaluated',
    readiness_evaluation_id: candidate && candidate.readiness_evaluation_id ? candidate.readiness_evaluation_id : 'readiness_evaluation_not_available',
    candidate_id: candidate && candidate.candidate_id ? candidate.candidate_id : 'candidate_not_available',
    transcription_id: candidate && candidate.transcription_id ? candidate.transcription_id : 'transcription_not_available',
    provider_id: candidate && candidate.provider_id ? candidate.provider_id : 'provider_not_available',
    adapter_id: candidate && candidate.adapter_id ? candidate.adapter_id : 'adapter_not_available',
    connector_id: candidate && candidate.connector_id ? candidate.connector_id : 'connector_not_available',
    configuration_id: candidate && candidate.configuration_id ? candidate.configuration_id : 'configuration_not_available',
    tenant_id: candidate && candidate.tenant_id ? candidate.tenant_id : 'tenant_not_available',
    workspace_type: candidate && candidate.workspace_type ? candidate.workspace_type : 'workspace_not_available',
    readiness_status: fields.readiness_status || 'blocked',
    verdict: fields.verdict || 'BLOCKED',
    blocking_count: fields.blocking_count || 0,
    blocked_reason: sanitizeTranscriptionBlockedReason(fields.blocked_reason) || null,
    evaluated_at: fields.evaluated_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false
  });
}

function evaluateTranscriptionProviderReadiness(candidate, context = {}) {
  try {
    const collected = collectReadinessRequirements(candidate, context);
    const blocking = collected.blocking_requirements;
    const readyForNextReview = blocking.length === 0;
    const evaluatedAt = typeof context.clock === 'function' ? context.clock() : context.now || new Date(0).toISOString();
    const verdict = readyForNextReview ? 'READY_FOR_CONTROLLED_CANARY_REVIEW' : 'BLOCKED';
    return sanitizeTranscriptionData({
      readiness_evaluation_id: candidate && candidate.readiness_evaluation_id ? candidate.readiness_evaluation_id : 'readiness_evaluation_not_available',
      readiness_evaluation_version: Number.isInteger(candidate && candidate.readiness_evaluation_version) ? candidate.readiness_evaluation_version : 0,
      candidate_id: candidate && candidate.candidate_id ? candidate.candidate_id : 'candidate_not_available',
      readiness_status: readyForNextReview ? 'ready_for_controlled_canary_review' : 'readiness_blocked',
      verdict,
      ready_for_next_review: readyForNextReview,
      ready_for_real_execution: false,
      satisfied_requirements: collected.satisfied_requirements,
      blocking_requirements: blocking,
      warnings: readyForNextReview ? ['real_execution_still_blocked', 'production_still_blocked'] : [],
      evaluated_at: evaluatedAt,
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      rollout_percentage: 0,
      production_blocked: true,
      audit_event_candidate: buildReadinessAuditEvent(candidate, {
        readiness_status: readyForNextReview ? 'ready_for_controlled_canary_review' : 'readiness_blocked',
        verdict,
        blocking_count: blocking.length,
        blocked_reason: blocking[0] || null,
        evaluated_at: evaluatedAt,
        event_name: readyForNextReview ? 'transcription_readiness_evaluated' : 'transcription_readiness_blocked'
      }),
      error: readyForNextReview ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', blocking[0] || 'transcription_readiness_blocked')
    });
  } catch (_error) {
    return sanitizeTranscriptionData({
      readiness_evaluation_id: candidate && candidate.readiness_evaluation_id ? candidate.readiness_evaluation_id : 'readiness_evaluation_not_available',
      candidate_id: candidate && candidate.candidate_id ? candidate.candidate_id : 'candidate_not_available',
      readiness_status: 'readiness_blocked',
      verdict: 'BLOCKED',
      ready_for_next_review: false,
      ready_for_real_execution: false,
      satisfied_requirements: [],
      blocking_requirements: ['readiness_internal_error'],
      warnings: [],
      evaluated_at: new Date(0).toISOString(),
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      rollout_percentage: 0,
      production_blocked: true,
      audit_event_candidate: buildReadinessAuditEvent(candidate, {
        readiness_status: 'readiness_blocked',
        verdict: 'BLOCKED',
        blocking_count: 1,
        blocked_reason: 'readiness_internal_error'
      }),
      error: buildSafeTranscriptionError('INTERNAL_ADAPTER_ERROR', 'readiness_internal_error')
    });
  }
}

function hashEvaluation(evaluation) {
  return JSON.stringify(evaluation, Object.keys(evaluation || {}).sort());
}

function createTranscriptionReadinessEvaluationRegistry() {
  const evaluations = new Map();
  const hashes = new Map();
  const versionsByCandidate = new Map();
  function recordEvaluation(evaluation) {
    if (!isPlainObject(evaluation) || !isNonEmptyString(evaluation.readiness_evaluation_id)) {
      return { ok: false, blocked_reason: 'readiness_evaluation_id_invalid', simulated: true, executed: false, real_provider_called: false };
    }
    if (!isNonEmptyString(evaluation.candidate_id)) {
      return { ok: false, blocked_reason: 'candidate_id_invalid', simulated: true, executed: false, real_provider_called: false };
    }
    const version = evaluation.readiness_evaluation_version;
    if (!Number.isInteger(version) || version < 1) return { ok: false, blocked_reason: 'readiness_evaluation_version_invalid', simulated: true, executed: false, real_provider_called: false };
    const previousVersion = versionsByCandidate.get(evaluation.candidate_id) || 0;
    if (version <= previousVersion) return { ok: false, blocked_reason: 'readiness_evaluation_version_regression', simulated: true, executed: false, real_provider_called: false };
    const nextHash = hashEvaluation(evaluation);
    if (evaluations.has(evaluation.readiness_evaluation_id)) {
      if (hashes.get(evaluation.readiness_evaluation_id) !== nextHash) return { ok: false, blocked_reason: 'readiness_evaluation_replay_payload_mismatch', simulated: true, executed: false, real_provider_called: false };
      return { ok: false, blocked_reason: 'readiness_evaluation_replay_duplicate', simulated: true, executed: false, real_provider_called: false };
    }
    const sanitized = sanitizeTranscriptionData(evaluation);
    evaluations.set(evaluation.readiness_evaluation_id, sanitized);
    hashes.set(evaluation.readiness_evaluation_id, nextHash);
    versionsByCandidate.set(evaluation.candidate_id, version);
    return Object.freeze({ ok: true, readiness_evaluation_id: evaluation.readiness_evaluation_id, candidate_id: evaluation.candidate_id, readiness_evaluation_version: version, simulated: true, executed: false, real_provider_called: false });
  }
  function getEvaluation(evaluationId) {
    return evaluations.has(evaluationId) ? deepClone(evaluations.get(evaluationId)) : null;
  }
  const registry = { recordEvaluation, getEvaluation };
  REGISTRY_STORAGE.set(registry, { evaluations, hashes, versionsByCandidate });
  return Object.freeze(registry);
}

module.exports = {
  REQUIRED_CANDIDATE_FIELDS,
  TRANSCRIPTION_READINESS_REQUIREMENTS,
  buildReadinessAuditEvent,
  collectReadinessRequirements,
  createTranscriptionReadinessEvaluationRegistry,
  evaluateTranscriptionProviderReadiness,
  validateCandidateDescriptor
};
