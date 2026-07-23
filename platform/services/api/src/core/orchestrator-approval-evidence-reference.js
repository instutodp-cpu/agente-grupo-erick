'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES } = require('./agent-context-contract');
const { APPROVAL_TYPES } = require('./orchestrator-plan-approval');

const APPROVAL_EVIDENCE_REFERENCE_VALIDATOR_VERSION = 'orchestrator_approval_evidence_reference_validator_v1';

const APPROVAL_EVIDENCE_REFERENCE_FIELDS = Object.freeze([
  'approval_evidence_id', 'approval_evidence_version', 'planning_result_id', 'plan_id', 'tenant_id',
  'organization_id', 'project_id', 'session_reference_id', 'approval_required', 'approval_type', 'required_roles',
  'minimum_approvals', 'approval_reference_ids', 'approval_count', 'approval_granted', 'approval_applied',
  'approval_validated', 'evidence_status', 'evidence_fingerprint', 'logical_sequence', 'simulation',
  'production_blocked', 'validator_version'
]);

const APPROVAL_EVIDENCE_STATUSES = Object.freeze([
  'NO_APPROVAL_REQUIRED_SIMULATION', 'WAITING_APPROVAL_SIMULATION', 'APPROVAL_REFERENCE_VALIDATED_SIMULATION',
  'APPROVAL_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED'
]);

const APPROVAL_EVIDENCE_SAFE_FLAGS = Object.freeze({
  approval_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_REQUIRED_ROLES = ACTOR_ROLES.length;
const MAX_MINIMUM_APPROVALS = 10;
const MAX_LIST_ITEMS = 50;

function isOrderedUniqueRoleList(list) {
  if (!Array.isArray(list) || list.length > MAX_REQUIRED_ROLES) return false;
  if (!list.every((item) => isNonEmptyString(item) && ACTOR_ROLES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateApprovalEvidenceReference(evidence) {
  const errors = [];
  if (!isPlainObject(evidence)) return { valid: false, errors: ['approval_evidence_must_be_object'] };
  exactFields(evidence, APPROVAL_EVIDENCE_REFERENCE_FIELDS, 'approval_evidence', errors);
  for (const field of ['approval_evidence_id', 'planning_result_id', 'plan_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'evidence_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(evidence[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(evidence.approval_evidence_version) || evidence.approval_evidence_version < 1) errors.push('approval_evidence_version_invalid');
  if (typeof evidence.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (!APPROVAL_TYPES.includes(evidence.approval_type)) errors.push(`approval_type_not_allowed::${evidence.approval_type}`);
  if (!isOrderedUniqueRoleList(evidence.required_roles)) errors.push('required_roles_invalid');
  if (!Number.isInteger(evidence.minimum_approvals) || evidence.minimum_approvals < 0 || evidence.minimum_approvals > MAX_MINIMUM_APPROVALS) {
    errors.push('minimum_approvals_invalid');
  }
  if (!isOrderedUniqueStringList(evidence.approval_reference_ids)) errors.push('approval_reference_ids_invalid');
  if (!Number.isInteger(evidence.approval_count) || evidence.approval_count < 0) errors.push('approval_count_invalid');
  if (Array.isArray(evidence.approval_reference_ids) && evidence.approval_count !== evidence.approval_reference_ids.length) {
    errors.push('approval_count_inconsistent_with_approval_reference_ids');
  }
  for (const field of ['approval_granted', 'approval_validated']) {
    if (typeof evidence[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!APPROVAL_EVIDENCE_STATUSES.includes(evidence.evidence_status)) errors.push(`evidence_status_not_allowed::${evidence.evidence_status}`);
  if (!Number.isInteger(evidence.logical_sequence) || evidence.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(APPROVAL_EVIDENCE_SAFE_FLAGS)) {
    if (evidence[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (evidence.approval_required === false && evidence.evidence_status !== 'NO_APPROVAL_REQUIRED_SIMULATION') {
    errors.push('evidence_status_must_be_no_approval_required_simulation_when_not_required');
  }
  if (evidence.approval_required === true && evidence.evidence_status === 'NO_APPROVAL_REQUIRED_SIMULATION') {
    errors.push('evidence_status_cannot_be_no_approval_required_simulation_when_required');
  }
  if (
    evidence.approval_required === true && Number.isInteger(evidence.approval_count) && Number.isInteger(evidence.minimum_approvals) &&
    evidence.approval_count < evidence.minimum_approvals &&
    !['WAITING_APPROVAL_SIMULATION', 'APPROVAL_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED'].includes(evidence.evidence_status)
  ) {
    errors.push('evidence_status_must_reflect_insufficient_approval_references');
  }
  if (evidence.approval_granted === true && evidence.evidence_status !== 'APPROVAL_REFERENCE_VALIDATED_SIMULATION') {
    errors.push('approval_granted_requires_approval_reference_validated_simulation_status');
  }

  if (evidence.validator_version !== APPROVAL_EVIDENCE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(evidence);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(evidence));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeApprovalEvidenceFingerprint(evidence) {
  const { evidence_fingerprint, ...rest } = evidence;
  return stablePayload(rest);
}

function buildApprovalEvidenceReference(input = {}) {
  const approvalReferenceIds = uniqueSorted(input.approval_reference_ids || []);
  const requiredRoles = uniqueSorted(input.required_roles || []);
  const approvalRequired = input.approval_required === true;
  const minimumApprovals = Number.isInteger(input.minimum_approvals) ? input.minimum_approvals : 0;
  const approvalType = APPROVAL_TYPES.includes(input.approval_type) ? input.approval_type : 'NONE';

  let status;
  let approvalGranted = false;
  let approvalValidated = false;
  const overridableStatuses = ['VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED'];
  if (overridableStatuses.includes(input.evidence_status)) {
    status = input.evidence_status;
  } else if (!approvalRequired) {
    status = 'NO_APPROVAL_REQUIRED_SIMULATION';
    approvalValidated = true;
  } else if (approvalType === 'NONE') {
    status = 'APPROVAL_BLOCKED';
  } else if (approvalReferenceIds.length >= minimumApprovals && minimumApprovals > 0) {
    status = 'APPROVAL_REFERENCE_VALIDATED_SIMULATION';
    approvalGranted = true;
    approvalValidated = true;
  } else {
    status = 'WAITING_APPROVAL_SIMULATION';
  }

  const evidence = {
    approval_evidence_id: input.approval_evidence_id,
    approval_evidence_version: Number.isInteger(input.approval_evidence_version) ? input.approval_evidence_version : 1,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    approval_required: approvalRequired,
    approval_type: approvalType,
    required_roles: requiredRoles,
    minimum_approvals: minimumApprovals,
    approval_reference_ids: approvalReferenceIds,
    approval_count: approvalReferenceIds.length,
    approval_granted: approvalGranted,
    approval_applied: false,
    approval_validated: approvalValidated,
    evidence_status: status,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: APPROVAL_EVIDENCE_REFERENCE_VALIDATOR_VERSION
  };
  evidence.evidence_fingerprint = computeApprovalEvidenceFingerprint({ ...evidence, evidence_fingerprint: undefined });

  const validation = validateApprovalEvidenceReference(evidence);
  if (!validation.valid) {
    throw new Error(`approval_evidence_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(evidence);
}

module.exports = {
  APPROVAL_EVIDENCE_REFERENCE_FIELDS,
  APPROVAL_EVIDENCE_REFERENCE_VALIDATOR_VERSION,
  APPROVAL_EVIDENCE_SAFE_FLAGS,
  APPROVAL_EVIDENCE_STATUSES,
  MAX_LIST_ITEMS,
  MAX_MINIMUM_APPROVALS,
  MAX_REQUIRED_ROLES,
  buildApprovalEvidenceReference,
  computeApprovalEvidenceFingerprint,
  validateApprovalEvidenceReference
};
