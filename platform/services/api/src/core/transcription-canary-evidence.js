'use strict';

const {
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const {
  buildTranscriptionCanaryAuditEvent,
  nowIso
} = require('./transcription-canary-session-contract');

const ALLOWED_EVIDENCE_FIELDS = Object.freeze([
  'evidence_id',
  'session_id',
  'session_version',
  'candidate_id',
  'readiness_evaluation_id',
  'consent_id',
  'approval_id',
  'authorization_id',
  'retention_policy_id',
  'budget_policy_id',
  'tenant_id',
  'workspace_type',
  'environment',
  'timestamps',
  'preflight_decision',
  'authorization_decision',
  'state_transitions',
  'synthetic_result_metadata',
  'blocking_reasons',
  'cleanup_status',
  'rollback_status',
  'safety_flags',
  'audit_event_candidate',
  'simulated',
  'executed',
  'real_provider_called',
  'external_network_called',
  'can_trigger_real_execution',
  'production_blocked'
]);

function validateEvidenceBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return { valid: false, errors: ['evidence_bundle_missing'] };
  for (const key of Object.keys(bundle)) {
    if (!ALLOWED_EVIDENCE_FIELDS.includes(key)) errors.push(`evidence_field_not_allowed::${key}`);
  }
  for (const field of ['evidence_id', 'session_id', 'candidate_id', 'readiness_evaluation_id', 'consent_id', 'approval_id', 'authorization_id', 'retention_policy_id', 'budget_policy_id', 'tenant_id', 'workspace_type', 'environment']) {
    if (typeof bundle[field] !== 'string' || bundle[field].trim() === '') errors.push(`invalid_${field}`);
  }
  if (!Number.isInteger(bundle.session_version) || bundle.session_version < 1) errors.push('session_version_invalid');
  if (!bundle.timestamps || typeof bundle.timestamps !== 'object') errors.push('timestamps_required');
  if (!Array.isArray(bundle.state_transitions)) errors.push('state_transitions_required');
  if (!bundle.synthetic_result_metadata || typeof bundle.synthetic_result_metadata !== 'object') errors.push('synthetic_result_metadata_required');
  if (!Array.isArray(bundle.blocking_reasons)) errors.push('blocking_reasons_required');
  if (!bundle.safety_flags || typeof bundle.safety_flags !== 'object') errors.push('safety_flags_required');
  if (bundle.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution']) {
    if (bundle[field] !== false) errors.push(`${field}_must_be_false`);
    if (bundle.safety_flags && bundle.safety_flags[field] !== false) errors.push(`safety_${field}_must_be_false`);
  }
  if (bundle.production_blocked !== true || bundle.safety_flags && bundle.safety_flags.production_blocked !== true) errors.push('production_blocked_must_be_true');
  errors.push(...findTranscriptionForbiddenFields(bundle));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildTranscriptionCanaryEvidenceBundle(input = {}, context = {}) {
  const session = input.session || {};
  const now = nowIso(context);
  const rawBundle = {
    evidence_id: input.evidence_id || `evidence_${session.session_id || 'session_not_available'}`,
    session_id: session.session_id || input.session_id || 'session_not_available',
    session_version: Number.isInteger(session.session_version) ? session.session_version : input.session_version || 0,
    candidate_id: session.candidate_id || input.candidate_id || 'candidate_not_available',
    readiness_evaluation_id: session.readiness_evaluation_id || input.readiness_evaluation_id || 'readiness_not_available',
    consent_id: session.consent_id || input.consent_id || 'consent_not_available',
    approval_id: session.approval_id || input.approval_id || 'approval_not_available',
    authorization_id: input.authorization_id || 'authorization_not_available',
    retention_policy_id: session.retention_policy_id || input.retention_policy_id || 'retention_not_available',
    budget_policy_id: session.budget_policy_id || input.budget_policy_id || 'budget_not_available',
    tenant_id: session.tenant_id || input.tenant_id || 'tenant_not_available',
    workspace_type: session.workspace_type || input.workspace_type || 'workspace_not_available',
    environment: session.environment || input.environment || 'environment_not_available',
    timestamps: {
      requested_at: session.requested_at || null,
      started_at: input.started_at || null,
      completed_at: input.completed_at || null,
      evaluated_at: now
    },
    preflight_decision: input.preflight_decision || 'not_evaluated',
    authorization_decision: input.authorization_decision || 'not_evaluated',
    state_transitions: Array.isArray(input.state_transitions) ? input.state_transitions : [],
    synthetic_result_metadata: input.synthetic_result_metadata || {},
    blocking_reasons: uniqueSorted(input.blocking_reasons || []),
    cleanup_status: input.cleanup_status || 'cleanup_not_started',
    rollback_status: input.rollback_status || 'rollback_not_started',
    safety_flags: {
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true,
      rollout_percentage: 0
    },
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  };
  const rawForbiddenFields = findTranscriptionForbiddenFields(rawBundle);
  const bundle = sanitizeTranscriptionData(rawBundle);
  const bundleValidation = validateEvidenceBundle(bundle);
  const validation = {
    valid: bundleValidation.valid && rawForbiddenFields.length === 0,
    errors: uniqueSorted([...bundleValidation.errors, ...rawForbiddenFields])
  };
  const frozen = Object.freeze(deepClone(bundle));
  return Object.freeze({
    ok: validation.valid,
    evidence_bundle: frozen,
    validation,
    audit_event_candidate: buildTranscriptionCanaryAuditEvent({
      session,
      event_name: validation.valid ? 'evidence_bundle_created' : 'evidence_bundle_blocked',
      status: validation.valid ? 'evidence_bundle_created' : 'evidence_bundle_blocked',
      blocked_reason: validation.errors[0] || null,
      occurred_at: now
    }),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  });
}

module.exports = {
  ALLOWED_EVIDENCE_FIELDS,
  buildTranscriptionCanaryEvidenceBundle,
  validateEvidenceBundle
};
