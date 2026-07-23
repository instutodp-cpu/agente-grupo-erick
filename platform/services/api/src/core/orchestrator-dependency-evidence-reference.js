'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { hasDependencyCycle } = require('./orchestrator-plan-dependency');

const DEPENDENCY_EVIDENCE_REFERENCE_VALIDATOR_VERSION = 'orchestrator_dependency_evidence_reference_validator_v1';

const DEPENDENCY_EVIDENCE_REFERENCE_FIELDS = Object.freeze([
  'dependency_evidence_id', 'dependency_evidence_version', 'planning_result_id', 'plan_id', 'tenant_id',
  'organization_id', 'stage_ids', 'dependency_ids', 'dependency_count', 'cycle_detected',
  'self_dependency_detected', 'missing_dependency_detected', 'duplicate_dependency_detected',
  'dependency_graph_valid', 'dependency_validation_executed', 'dependency_applied', 'evidence_status',
  'evidence_fingerprint', 'logical_sequence', 'simulation', 'production_blocked', 'validator_version'
]);

const DETECTION_FLAG_FIELDS = Object.freeze([
  'cycle_detected', 'self_dependency_detected', 'missing_dependency_detected', 'duplicate_dependency_detected'
]);

const DEPENDENCY_EVIDENCE_STATUSES = Object.freeze([
  'VALIDATED_SIMULATION', 'DEPENDENCY_BLOCKED', 'CYCLE_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED',
  'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED'
]);

const DEPENDENCY_EVIDENCE_SAFE_FLAGS = Object.freeze({
  dependency_validation_executed: true,
  dependency_applied: false,
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

function validateDependencyEvidenceReference(evidence) {
  const errors = [];
  if (!isPlainObject(evidence)) return { valid: false, errors: ['dependency_evidence_must_be_object'] };
  exactFields(evidence, DEPENDENCY_EVIDENCE_REFERENCE_FIELDS, 'dependency_evidence', errors);
  for (const field of ['dependency_evidence_id', 'planning_result_id', 'plan_id', 'tenant_id', 'organization_id', 'evidence_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(evidence[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(evidence.dependency_evidence_version) || evidence.dependency_evidence_version < 1) errors.push('dependency_evidence_version_invalid');
  if (!isOrderedUniqueStringList(evidence.stage_ids)) errors.push('stage_ids_invalid');
  if (!isOrderedUniqueStringList(evidence.dependency_ids)) errors.push('dependency_ids_invalid');
  if (!Number.isInteger(evidence.dependency_count) || evidence.dependency_count < 0 || evidence.dependency_count > MAX_COUNT) {
    errors.push('dependency_count_invalid');
  }
  if (Array.isArray(evidence.dependency_ids) && evidence.dependency_count !== evidence.dependency_ids.length) {
    errors.push('dependency_count_inconsistent_with_dependency_ids');
  }
  for (const field of DETECTION_FLAG_FIELDS) {
    if (typeof evidence[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof evidence.dependency_graph_valid !== 'boolean') errors.push('dependency_graph_valid_must_be_boolean');
  if (!DEPENDENCY_EVIDENCE_STATUSES.includes(evidence.evidence_status)) errors.push(`evidence_status_not_allowed::${evidence.evidence_status}`);
  if (!Number.isInteger(evidence.logical_sequence) || evidence.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(DEPENDENCY_EVIDENCE_SAFE_FLAGS)) {
    if (evidence[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (DETECTION_FLAG_FIELDS.every((field) => typeof evidence[field] === 'boolean')) {
    const expectedValid = DETECTION_FLAG_FIELDS.every((field) => evidence[field] === false);
    if (evidence.dependency_graph_valid !== expectedValid) errors.push('dependency_graph_valid_inconsistent_with_detection_flags');
  }
  if (evidence.dependency_graph_valid === true && evidence.evidence_status !== 'VALIDATED_SIMULATION') {
    errors.push('evidence_status_must_be_validated_simulation_when_graph_valid');
  }

  if (evidence.validator_version !== DEPENDENCY_EVIDENCE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(evidence);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(evidence));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeDependencyEvidenceFingerprint(evidence) {
  const { evidence_fingerprint, ...rest } = evidence;
  return stablePayload(rest);
}

// Detects self-dependencies and missing stage references directly from the declarative
// dependencyRecords (full {from_stage_id, to_stage_id} objects) supplied by the caller --
// mirroring the same side-channel pattern PR #95's Decision Engine already uses, since the
// minimal dependency_ids list alone cannot carry graph shape.
function analyzeDependencyRecords(dependencyRecords, stageIds) {
  const stageIdSet = new Set(stageIds);
  let selfDependencyDetected = false;
  let missingDependencyDetected = false;
  const seen = new Set();
  let duplicateDetected = false;
  for (const record of Array.isArray(dependencyRecords) ? dependencyRecords : []) {
    if (!isPlainObject(record)) continue;
    if (record.from_stage_id === record.to_stage_id) selfDependencyDetected = true;
    if (!stageIdSet.has(record.from_stage_id) || !stageIdSet.has(record.to_stage_id)) missingDependencyDetected = true;
    const key = `${record.from_stage_id}->${record.to_stage_id}`;
    if (seen.has(key)) duplicateDetected = true;
    seen.add(key);
  }
  const cycleDetected = Array.isArray(dependencyRecords) && dependencyRecords.length > 0 && hasDependencyCycle(dependencyRecords);
  return { cycleDetected, selfDependencyDetected, missingDependencyDetected, duplicateDetected };
}

function buildDependencyEvidenceReference(input = {}) {
  const stageIds = uniqueSorted(input.stage_ids || []);
  const dependencyIds = uniqueSorted(input.dependency_ids || []);
  const analysis = analyzeDependencyRecords(input.dependencyRecords, stageIds);
  const cycleDetected = input.cycle_detected === true || analysis.cycleDetected;
  const selfDependencyDetected = input.self_dependency_detected === true || analysis.selfDependencyDetected;
  const missingDependencyDetected = input.missing_dependency_detected === true || analysis.missingDependencyDetected;
  const duplicateDependencyDetected = input.duplicate_dependency_detected === true || analysis.duplicateDetected;
  const graphValid = !cycleDetected && !selfDependencyDetected && !missingDependencyDetected && !duplicateDependencyDetected;

  const overridableStatuses = ['VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED', 'VALIDATION_FAILED'];
  let status;
  if (overridableStatuses.includes(input.evidence_status)) status = input.evidence_status;
  else if (cycleDetected) status = 'CYCLE_BLOCKED';
  else if (!graphValid) status = 'DEPENDENCY_BLOCKED';
  else status = 'VALIDATED_SIMULATION';

  const evidence = {
    dependency_evidence_id: input.dependency_evidence_id,
    dependency_evidence_version: Number.isInteger(input.dependency_evidence_version) ? input.dependency_evidence_version : 1,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    stage_ids: stageIds,
    dependency_ids: dependencyIds,
    dependency_count: dependencyIds.length,
    cycle_detected: cycleDetected,
    self_dependency_detected: selfDependencyDetected,
    missing_dependency_detected: missingDependencyDetected,
    duplicate_dependency_detected: duplicateDependencyDetected,
    dependency_graph_valid: graphValid,
    dependency_validation_executed: true,
    dependency_applied: false,
    evidence_status: status,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: DEPENDENCY_EVIDENCE_REFERENCE_VALIDATOR_VERSION
  };
  evidence.evidence_fingerprint = computeDependencyEvidenceFingerprint({ ...evidence, evidence_fingerprint: undefined });

  const validation = validateDependencyEvidenceReference(evidence);
  if (!validation.valid) {
    throw new Error(`dependency_evidence_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(evidence);
}

module.exports = {
  DEPENDENCY_EVIDENCE_REFERENCE_FIELDS,
  DEPENDENCY_EVIDENCE_REFERENCE_VALIDATOR_VERSION,
  DEPENDENCY_EVIDENCE_SAFE_FLAGS,
  DEPENDENCY_EVIDENCE_STATUSES,
  DETECTION_FLAG_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  buildDependencyEvidenceReference,
  computeDependencyEvidenceFingerprint,
  isOrderedUniqueStringList,
  validateDependencyEvidenceReference
};
