'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const CONFLICT_EVIDENCE_REFERENCE_VALIDATOR_VERSION = 'orchestrator_conflict_evidence_reference_validator_v1';

const CONFLICT_EVIDENCE_REFERENCE_FIELDS = Object.freeze([
  'conflict_evidence_id', 'conflict_evidence_version', 'planning_result_id', 'plan_id', 'tenant_id',
  'organization_id', 'conflict_reference_ids', 'conflict_count', 'tenant_conflict_detected',
  'organization_conflict_detected', 'project_conflict_detected', 'session_conflict_detected',
  'fingerprint_conflict_detected', 'version_conflict_detected', 'policy_conflict_detected',
  'memory_conflict_detected', 'context_conflict_detected', 'model_conflict_detected', 'tool_conflict_detected',
  'workflow_conflict_detected', 'unresolved_conflict_detected', 'conflicts_validated', 'conflicts_resolved',
  'evidence_status', 'evidence_fingerprint', 'logical_sequence', 'simulation', 'production_blocked',
  'validator_version'
]);

const DOMAIN_CONFLICT_FLAG_FIELDS = Object.freeze([
  'tenant_conflict_detected', 'organization_conflict_detected', 'project_conflict_detected',
  'session_conflict_detected', 'fingerprint_conflict_detected', 'version_conflict_detected',
  'policy_conflict_detected', 'memory_conflict_detected', 'context_conflict_detected', 'model_conflict_detected',
  'tool_conflict_detected', 'workflow_conflict_detected'
]);

const CONFLICT_EVIDENCE_STATUSES = Object.freeze([
  'NO_CONFLICT_SIMULATION', 'CONFLICT_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED'
]);

const CONFLICT_EVIDENCE_SAFE_FLAGS = Object.freeze({
  conflicts_validated: true,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 500;
const MAX_COUNT = 500;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateConflictEvidenceReference(evidence) {
  const errors = [];
  if (!isPlainObject(evidence)) return { valid: false, errors: ['conflict_evidence_must_be_object'] };
  exactFields(evidence, CONFLICT_EVIDENCE_REFERENCE_FIELDS, 'conflict_evidence', errors);
  for (const field of ['conflict_evidence_id', 'planning_result_id', 'plan_id', 'tenant_id', 'organization_id', 'evidence_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(evidence[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(evidence.conflict_evidence_version) || evidence.conflict_evidence_version < 1) errors.push('conflict_evidence_version_invalid');
  if (!isOrderedUniqueStringList(evidence.conflict_reference_ids)) errors.push('conflict_reference_ids_invalid');
  if (!Number.isInteger(evidence.conflict_count) || evidence.conflict_count < 0 || evidence.conflict_count > MAX_COUNT) {
    errors.push('conflict_count_invalid');
  }
  if (Array.isArray(evidence.conflict_reference_ids) && evidence.conflict_count !== evidence.conflict_reference_ids.length) {
    errors.push('conflict_count_inconsistent_with_conflict_reference_ids');
  }
  for (const field of DOMAIN_CONFLICT_FLAG_FIELDS) {
    if (typeof evidence[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof evidence.unresolved_conflict_detected !== 'boolean') errors.push('unresolved_conflict_detected_must_be_boolean');
  if (typeof evidence.conflicts_resolved !== 'boolean') errors.push('conflicts_resolved_must_be_boolean');
  if (!CONFLICT_EVIDENCE_STATUSES.includes(evidence.evidence_status)) errors.push(`evidence_status_not_allowed::${evidence.evidence_status}`);
  if (!Number.isInteger(evidence.logical_sequence) || evidence.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(CONFLICT_EVIDENCE_SAFE_FLAGS)) {
    if (evidence[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (evidence.conflicts_resolved !== (evidence.unresolved_conflict_detected === false)) {
    errors.push('conflicts_resolved_inconsistent_with_unresolved_conflict_detected');
  }
  if (evidence.unresolved_conflict_detected === true && evidence.evidence_status !== 'CONFLICT_BLOCKED') {
    errors.push('evidence_status_must_be_conflict_blocked_when_unresolved_conflict_detected');
  }
  if (evidence.conflicts_resolved === true && evidence.evidence_status === 'CONFLICT_BLOCKED') {
    errors.push('evidence_status_cannot_be_conflict_blocked_when_conflicts_resolved');
  }

  if (evidence.validator_version !== CONFLICT_EVIDENCE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(evidence);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(evidence));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeConflictEvidenceFingerprint(evidence) {
  const { evidence_fingerprint, ...rest } = evidence;
  return stablePayload(rest);
}

function buildConflictEvidenceReference(input = {}) {
  const conflictReferenceIds = uniqueSorted(input.conflict_reference_ids || []);
  const domainFlags = {};
  for (const field of DOMAIN_CONFLICT_FLAG_FIELDS) domainFlags[field] = input[field] === true;
  const anyDomainConflict = DOMAIN_CONFLICT_FLAG_FIELDS.some((field) => domainFlags[field]);
  const unresolvedConflictDetected = input.unresolved_conflict_detected === true || anyDomainConflict;
  const conflictsResolved = !unresolvedConflictDetected;

  const overridableStatuses = ['VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED'];
  const status = overridableStatuses.includes(input.evidence_status) ? input.evidence_status
    : (unresolvedConflictDetected ? 'CONFLICT_BLOCKED' : 'NO_CONFLICT_SIMULATION');

  const evidence = {
    conflict_evidence_id: input.conflict_evidence_id,
    conflict_evidence_version: Number.isInteger(input.conflict_evidence_version) ? input.conflict_evidence_version : 1,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    conflict_reference_ids: conflictReferenceIds,
    conflict_count: conflictReferenceIds.length,
    ...domainFlags,
    unresolved_conflict_detected: unresolvedConflictDetected,
    conflicts_validated: true,
    conflicts_resolved: conflictsResolved,
    evidence_status: status,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: CONFLICT_EVIDENCE_REFERENCE_VALIDATOR_VERSION
  };
  evidence.evidence_fingerprint = computeConflictEvidenceFingerprint({ ...evidence, evidence_fingerprint: undefined });

  const validation = validateConflictEvidenceReference(evidence);
  if (!validation.valid) {
    throw new Error(`conflict_evidence_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(evidence);
}

module.exports = {
  CONFLICT_EVIDENCE_REFERENCE_FIELDS,
  CONFLICT_EVIDENCE_REFERENCE_VALIDATOR_VERSION,
  CONFLICT_EVIDENCE_SAFE_FLAGS,
  CONFLICT_EVIDENCE_STATUSES,
  DOMAIN_CONFLICT_FLAG_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  buildConflictEvidenceReference,
  computeConflictEvidenceFingerprint,
  isOrderedUniqueStringList,
  validateConflictEvidenceReference
};
