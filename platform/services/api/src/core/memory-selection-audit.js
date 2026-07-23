'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const MEMORY_SELECTION_AUDIT_VALIDATOR_VERSION = 'memory_selection_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const MEMORY_SELECTION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'selection_request_id', 'request_fingerprint', 'item_fingerprints', 'policy_fingerprint',
  'budget_fingerprint', 'score_fingerprints', 'plan_fingerprint', 'decision_fingerprint', 'tenant_binding',
  'organization_binding', 'project_binding', 'reference_counts_by_class', 'omission_risk_summary',
  'preservation_flags', 'exclusion_reason_codes', 'blockers', 'logical_sequence', 'decision', 'simulation',
  'production_blocked', 'executed', 'validator_version'
]);

const REFERENCE_COUNT_BY_CLASS_FIELDS = Object.freeze(['REQUIRED', 'RELEVANT', 'OPTIONAL']);
const OMISSION_RISK_SUMMARY_FIELDS = Object.freeze(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
const PRESERVATION_FLAG_FIELDS = Object.freeze([
  'required_memory_preserved', 'preferences_preserved', 'project_state_preserved', 'continuity_preserved',
  'pending_tasks_preserved', 'applicable_decisions_preserved'
]);

function isFingerprintList(list) {
  return Array.isArray(list) && list.every(isNonEmptyString);
}

function validateSelectionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['selection_audit_must_be_object'] };
  exactFields(audit, MEMORY_SELECTION_AUDIT_FIELDS, 'selection_audit', errors);
  for (const field of [
    'audit_id', 'selection_request_id', 'request_fingerprint', 'policy_fingerprint', 'budget_fingerprint',
    'plan_fingerprint', 'decision_fingerprint', 'decision', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isFingerprintList(audit.item_fingerprints)) errors.push('item_fingerprints_invalid');
  if (!isFingerprintList(audit.score_fingerprints)) errors.push('score_fingerprints_invalid');
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) {
    errors.push('organization_binding_invalid');
  }
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.reference_counts_by_class)) {
    errors.push('reference_counts_by_class_must_be_object');
  } else {
    for (const field of REFERENCE_COUNT_BY_CLASS_FIELDS) {
      if (!Number.isInteger(audit.reference_counts_by_class[field]) || audit.reference_counts_by_class[field] < 0) {
        errors.push(`reference_counts_by_class_${field}_invalid`);
      }
    }
  }
  if (!isPlainObject(audit.omission_risk_summary)) {
    errors.push('omission_risk_summary_must_be_object');
  } else {
    for (const field of OMISSION_RISK_SUMMARY_FIELDS) {
      if (!Number.isInteger(audit.omission_risk_summary[field]) || audit.omission_risk_summary[field] < 0) {
        errors.push(`omission_risk_summary_${field}_invalid`);
      }
    }
  }
  if (!isPlainObject(audit.preservation_flags)) {
    errors.push('preservation_flags_must_be_object');
  } else {
    for (const field of PRESERVATION_FLAG_FIELDS) {
      if (typeof audit.preservation_flags[field] !== 'boolean') errors.push(`preservation_flags_${field}_invalid`);
    }
  }
  if (!Array.isArray(audit.exclusion_reason_codes) || !audit.exclusion_reason_codes.every(isNonEmptyString)) {
    errors.push('exclusion_reason_codes_invalid');
  }
  if (!Array.isArray(audit.blockers) || !audit.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== MEMORY_SELECTION_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSelectionAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const preservationFlags = {};
  for (const field of PRESERVATION_FLAG_FIELDS) preservationFlags[field] = decision[field] === true;

  const omissionRiskSummary = {};
  for (const field of OMISSION_RISK_SUMMARY_FIELDS) {
    omissionRiskSummary[field] = Number.isInteger(input.omissionRiskSummary && input.omissionRiskSummary[field])
      ? input.omissionRiskSummary[field] : 0;
  }

  const referenceCountsByClass = {};
  for (const field of REFERENCE_COUNT_BY_CLASS_FIELDS) {
    referenceCountsByClass[field] = Number.isInteger(input.referenceCountsByClass && input.referenceCountsByClass[field])
      ? input.referenceCountsByClass[field] : 0;
  }

  const audit = {
    audit_id: `memory_selection_audit_${decision.decision_id || 'not_available'}`,
    selection_request_id: decision.selection_request_id || 'selection_request_not_available',
    request_fingerprint: decision.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    item_fingerprints: Array.isArray(input.itemFingerprints) ? uniqueSorted(input.itemFingerprints) : [],
    policy_fingerprint: decision.policy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: decision.budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    score_fingerprints: Array.isArray(input.scoreFingerprints) ? uniqueSorted(input.scoreFingerprints) : [],
    plan_fingerprint: decision.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    decision_fingerprint: (() => {
      try {
        return stablePayload(decision);
      } catch (error) {
        return NOT_AVAILABLE_FINGERPRINT;
      }
    })(),
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    reference_counts_by_class: referenceCountsByClass,
    omission_risk_summary: omissionRiskSummary,
    preservation_flags: preservationFlags,
    exclusion_reason_codes: Array.isArray(input.exclusionReasonCodes) ? uniqueSorted(input.exclusionReasonCodes) : [],
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    decision: decision.status || 'VALIDATION_FAILED',
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: MEMORY_SELECTION_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  MEMORY_SELECTION_AUDIT_FIELDS,
  MEMORY_SELECTION_AUDIT_VALIDATOR_VERSION,
  NOT_AVAILABLE_FINGERPRINT,
  OMISSION_RISK_SUMMARY_FIELDS,
  PRESERVATION_FLAG_FIELDS,
  REFERENCE_COUNT_BY_CLASS_FIELDS,
  buildSelectionAudit,
  validateSelectionAudit
};
