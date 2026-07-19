'use strict';

const {
  buildSafeTranscriptionError,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const { validateTranscriptionBudgetPolicy } = require('./transcription-budget-policy');
const { validateTranscriptionConsent } = require('./transcription-consent-policy');
const { validateTranscriptionOperatorApproval } = require('./transcription-operator-approval-policy');
const { validateTranscriptionRetentionPolicy } = require('./transcription-retention-policy');
const {
  buildTranscriptionCanaryAuditEvent,
  isTranscriptionCanarySessionExpired,
  nowIso,
  validateTranscriptionCanarySession
} = require('./transcription-canary-session-contract');

const TRANSCRIPTION_CANARY_PREFLIGHT_REQUIREMENTS = Object.freeze([
  'readiness_ready_for_controlled_canary_review',
  'real_execution_blocked',
  'adapter_runtime_disabled',
  'provider_real_disabled',
  'consent_valid',
  'retention_valid',
  'budget_valid',
  'approval_valid',
  'session_not_expired',
  'feature_flag_off',
  'kill_switch_available',
  'network_blocked',
  'raw_media_absent',
  'storage_disabled',
  'endpoint_absent',
  'worker_absent',
  'scheduler_absent',
  'queue_absent',
  'upload_absent',
  'production_blocked',
  'synthetic_evidence_valid',
  'secret_value_absent'
]);

function push(status, requirement, errors) {
  if (!errors || errors.length === 0) status.satisfied.push(requirement);
  else status.blocking.push(...errors.map((reason) => `${requirement}::${reason}`));
}

function validateSyntheticEvidence(evidence = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return ['synthetic_evidence_missing'];
  if (evidence.provider_called === true || evidence.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  if (evidence.external_network_called !== false || evidence.network_attempts !== 0) errors.push('external_network_called_must_be_false');
  if (evidence.raw_media_present === true) errors.push('raw_media_present');
  if (evidence.storage_configured === true) errors.push('storage_configured');
  if (evidence.upload_present === true) errors.push('upload_present');
  if (evidence.can_trigger_real_execution !== false) errors.push('can_trigger_real_execution_must_be_false');
  errors.push(...findTranscriptionForbiddenFields(evidence));
  return uniqueSorted(errors);
}

function evaluateTranscriptionCanaryPreflight(session, context = {}) {
  const status = { satisfied: [], blocking: [] };
  const now = nowIso(context);
  const sessionValidation = validateTranscriptionCanarySession(session, context);
  push(status, 'session_contract_valid', sessionValidation.errors);

  const readiness = context.readinessResult || {};
  push(status, 'readiness_ready_for_controlled_canary_review',
    readiness.verdict === 'READY_FOR_CONTROLLED_CANARY_REVIEW' && readiness.ready_for_next_review === true ? [] : ['readiness_not_ready_for_controlled_canary_review']);
  if (readiness.ready_for_real_execution !== false) push(status, 'real_execution_blocked', ['readiness_real_execution_not_allowed']);
  push(status, 'real_execution_blocked',
    readiness.ready_for_real_execution === false && readiness.executed === false && readiness.real_provider_called === false &&
      readiness.external_network_called === false && readiness.can_trigger_real_execution === false ? [] : ['readiness_safety_flags_invalid']);

  const adapterMetadata = context.adapterMetadata || {};
  push(status, 'adapter_runtime_disabled', adapterMetadata.enabled === false ? [] : ['adapter_runtime_enabled']);
  const lifecycle = context.lifecycleRecord || {};
  push(status, 'provider_real_disabled', lifecycle.real_provider_enabled === false && lifecycle.runtime_enabled === false ? [] : ['provider_or_runtime_enabled']);

  push(status, 'consent_valid', validateTranscriptionConsent(context.consentRecord, {
    tenant_id: session && session.tenant_id,
    workspace_type: session && session.workspace_type,
    transcription_id: session && session.transcription_id,
    operation: 'evaluate_transcription_candidate',
    now,
    clock: context.clock
  }).errors);
  push(status, 'retention_valid', validateTranscriptionRetentionPolicy(context.retentionPolicy, {
    tenant_id: session && session.tenant_id,
    workspace_type: session && session.workspace_type,
    now,
    clock: context.clock
  }).errors);
  if (context.retentionPolicy && context.retentionPolicy.raw_media_retention_days !== 0) push(status, 'raw_media_absent', ['raw_media_retention_must_be_zero']);

  push(status, 'budget_valid', validateTranscriptionBudgetPolicy(context.budgetPolicy, {
    tenant_id: session && session.tenant_id,
    workspace_type: session && session.workspace_type,
    environment: session && session.environment
  }).errors);
  if (context.budgetPolicy && context.budgetPolicy.rollout_percentage !== 0) push(status, 'budget_valid', ['rollout_percentage_must_be_zero']);

  push(status, 'approval_valid', validateTranscriptionOperatorApproval(context.operatorApproval, {
    candidate_id: session && session.candidate_id,
    tenant_id: session && session.tenant_id,
    environment: session && session.environment,
    operation: 'evaluate_transcription_candidate',
    now,
    clock: context.clock
  }).errors);
  if (context.operatorApproval && context.operatorApproval.consumed_at !== null) push(status, 'approval_valid', ['operator_approval_consumed']);

  push(status, 'session_not_expired', isTranscriptionCanarySessionExpired(session, context) ? ['session_expired'] : []);
  push(status, 'feature_flag_off', context.featureFlagEnabled === false ? [] : ['feature_flag_enabled_or_missing']);
  push(status, 'kill_switch_available', context.killSwitchAvailable === true && context.killSwitchActive !== true ? [] : ['kill_switch_unavailable_or_active']);
  push(status, 'network_blocked', session && session.network_blocked !== false && context.networkBlocked !== false ? [] : ['network_not_blocked']);
  push(status, 'raw_media_absent', context.rawMediaPresent === true ? ['raw_media_present'] : []);
  push(status, 'storage_disabled', context.storageConfigured === true || session && session.storage_enabled === true ? ['storage_configured'] : []);
  push(status, 'endpoint_absent', context.endpointConfigured === true || context.providerConfiguration && (context.providerConfiguration.endpoint || context.providerConfiguration.provider_url) ? ['endpoint_configured'] : []);
  push(status, 'worker_absent', context.workerConfigured === true ? ['worker_configured'] : []);
  push(status, 'scheduler_absent', context.schedulerConfigured === true ? ['scheduler_configured'] : []);
  push(status, 'queue_absent', context.queueConfigured === true ? ['queue_configured'] : []);
  push(status, 'upload_absent', context.uploadPresent === true ? ['upload_present'] : []);
  push(status, 'production_blocked', session && session.environment !== 'production' && session.production_blocked === true ? [] : ['production_not_blocked']);
  push(status, 'synthetic_evidence_valid', validateSyntheticEvidence(context.syntheticEvidence));
  const secretReference = context.secretReference || {};
  push(status, 'secret_value_absent', secretReference.secret_value || secretReference.token || secretReference.api_key ? ['secret_value_present'] : findTranscriptionForbiddenFields(secretReference));

  const blocking = uniqueSorted(status.blocking);
  const allowed = blocking.length === 0;
  const result = sanitizeTranscriptionData({
    preflight_status: allowed ? 'transcription_canary_preflight_passed' : 'transcription_canary_preflight_blocked',
    allowed,
    allowed_for_synthetic_simulation: allowed,
    allowed_for_real_provider: false,
    allowed_for_real_audio: false,
    allowed_for_network: false,
    allowed_for_production: false,
    session_id: session && session.session_id || 'session_not_available',
    satisfied_requirements: uniqueSorted(status.satisfied),
    blocking_requirements: blocking,
    warnings: allowed ? ['real_execution_still_blocked', 'production_still_blocked', 'rollout_zero'] : [],
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    rollout_percentage: 0,
    audit_event_candidate: buildTranscriptionCanaryAuditEvent({
      session,
      event_name: allowed ? 'preflight_evaluated' : 'preflight_blocked',
      status: allowed ? 'preflight_passed' : 'preflight_blocked',
      blocked_reason: blocking[0] || null,
      occurred_at: now
    }),
    error: allowed ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', blocking[0] || 'transcription_canary_preflight_blocked')
  });
  return result;
}

module.exports = {
  TRANSCRIPTION_CANARY_PREFLIGHT_REQUIREMENTS,
  evaluateTranscriptionCanaryPreflight,
  validateSyntheticEvidence
};
