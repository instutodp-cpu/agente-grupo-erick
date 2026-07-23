'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { DEPENDENCY_TYPES, hasDependencyCycle } = require('./orchestrator-plan-dependency');

const DEPENDENCY_RECORD_VALIDATOR_VERSION = 'execution_plan_dependency_record_validator_v1';
const DEPENDENCY_GRAPH_REFERENCE_VALIDATOR_VERSION = 'execution_plan_dependency_graph_reference_validator_v1';

const DEPENDENCY_RECORD_FIELDS = Object.freeze([
  'dependency_id', 'dependency_version', 'from_stage_id', 'to_stage_id', 'dependency_type', 'required',
  'dependency_fingerprint', 'validator_version'
]);

const DEPENDENCY_GRAPH_REFERENCE_FIELDS = Object.freeze([
  'dependency_graph_reference_id', 'dependency_graph_reference_version', 'execution_plan_id', 'planning_result_id',
  'orchestration_plan_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'stage_ids',
  'dependency_records', 'dependency_count', 'graph_fingerprint', 'logical_sequence', 'simulation',
  'production_blocked', 'validator_version'
]);

const DEPENDENCY_GRAPH_REFERENCE_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

// Canonical order: from_stage_id, then to_stage_id, then dependency_id -- a total order over the
// three fields that already uniquely identify a directed edge, so "canonical" never depends on
// caller-supplied insertion order.
function canonicalDependencyRecordKey(record) {
  return `${record.from_stage_id}::${record.to_stage_id}::${record.dependency_id}`;
}

function isCanonicallyOrderedDependencyRecordList(records) {
  const keys = records.map(canonicalDependencyRecordKey);
  const sorted = [...keys].sort();
  return keys.every((key, index) => key === sorted[index]);
}

function validateDependencyRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['dependency_record_must_be_object'] };
  exactFields(record, DEPENDENCY_RECORD_FIELDS, 'dependency_record', errors);
  for (const field of ['dependency_id', 'from_stage_id', 'to_stage_id', 'dependency_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(record.dependency_version) || record.dependency_version < 1) errors.push('dependency_version_invalid');
  if (!DEPENDENCY_TYPES.includes(record.dependency_type)) errors.push(`dependency_type_not_allowed::${record.dependency_type}`);
  if (typeof record.required !== 'boolean') errors.push('required_must_be_boolean');
  if (isNonEmptyString(record.from_stage_id) && record.from_stage_id === record.to_stage_id) {
    errors.push('dependency_record_cannot_reference_its_own_stage');
  }
  if (record.validator_version !== DEPENDENCY_RECORD_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(record);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeDependencyRecordFingerprint(record) {
  const { dependency_fingerprint, ...rest } = record;
  return stablePayload(rest);
}

function buildDependencyRecord(input = {}) {
  const record = {
    dependency_id: input.dependency_id,
    dependency_version: Number.isInteger(input.dependency_version) ? input.dependency_version : 1,
    from_stage_id: input.from_stage_id,
    to_stage_id: input.to_stage_id,
    dependency_type: input.dependency_type,
    required: input.required === true,
    validator_version: DEPENDENCY_RECORD_VALIDATOR_VERSION
  };
  record.dependency_fingerprint = computeDependencyRecordFingerprint({ ...record, dependency_fingerprint: undefined });

  const validation = validateDependencyRecord(record);
  if (!validation.valid) {
    throw new Error(`dependency_record_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(record);
}

function computeDependencyGraphReferenceFingerprint(reference) {
  const { graph_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

// stage_ids únicos e ordenados; dependency_records ordenados canonicamente; dependency IDs
// únicos; dependency_count consistente; from/to devem existir em stage_ids; self-dependency
// bloqueia; ciclo bloqueia -- all enforced here, at construction time, so an invalid graph can
// never exist as a value in the first place (the same "validated by construction" discipline
// TaskReference already established in PR #97fix).
function validateExecutionPlanDependencyGraphReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['dependency_graph_reference_must_be_object'] };
  exactFields(reference, DEPENDENCY_GRAPH_REFERENCE_FIELDS, 'dependency_graph_reference', errors);
  for (const field of [
    'dependency_graph_reference_id', 'execution_plan_id', 'planning_result_id', 'orchestration_plan_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'graph_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dependency_graph_reference_version) || reference.dependency_graph_reference_version < 1) {
    errors.push('dependency_graph_reference_version_invalid');
  }
  if (!isOrderedUniqueStringList(reference.stage_ids)) errors.push('stage_ids_invalid');

  const stageIdSet = new Set(Array.isArray(reference.stage_ids) ? reference.stage_ids : []);
  if (!Array.isArray(reference.dependency_records) || reference.dependency_records.length > MAX_LIST_ITEMS) {
    errors.push('dependency_records_invalid');
  } else {
    reference.dependency_records.forEach((record, index) => {
      errors.push(...validateDependencyRecord(record).errors.map((e) => `dependency_records[${index}]_${e}`));
    });
    const validRecords = reference.dependency_records.filter(isPlainObject);
    if (validRecords.length === reference.dependency_records.length) {
      const dependencyIds = validRecords.map((record) => record.dependency_id);
      if (new Set(dependencyIds).size !== dependencyIds.length) errors.push('dependency_records_ids_not_unique');
      if (!isCanonicallyOrderedDependencyRecordList(validRecords)) errors.push('dependency_records_not_canonically_ordered');
      if (validRecords.some((record) => !stageIdSet.has(record.from_stage_id) || !stageIdSet.has(record.to_stage_id))) {
        errors.push('dependency_records_reference_unknown_stage');
      }
      if (validRecords.some((record) => record.from_stage_id === record.to_stage_id)) {
        errors.push('dependency_records_contain_self_dependency');
      }
      if (validRecords.length > 0 && hasDependencyCycle(validRecords)) {
        errors.push('dependency_records_contain_cycle');
      }
    }
    if (reference.dependency_count !== reference.dependency_records.length) errors.push('dependency_count_inconsistent');
  }

  if (!Number.isInteger(reference.logical_sequence) || reference.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(DEPENDENCY_GRAPH_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== DEPENDENCY_GRAPH_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionPlanDependencyGraphReference(input = {}) {
  const dependencyRecords = Array.isArray(input.dependency_records) ? input.dependency_records : [];
  const reference = {
    dependency_graph_reference_id: input.dependency_graph_reference_id,
    dependency_graph_reference_version: Number.isInteger(input.dependency_graph_reference_version) ? input.dependency_graph_reference_version : 1,
    execution_plan_id: input.execution_plan_id,
    planning_result_id: input.planning_result_id,
    orchestration_plan_id: input.orchestration_plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    stage_ids: Array.isArray(input.stage_ids) ? [...input.stage_ids].sort() : [],
    dependency_records: dependencyRecords,
    dependency_count: dependencyRecords.length,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: DEPENDENCY_GRAPH_REFERENCE_VALIDATOR_VERSION
  };
  reference.graph_fingerprint = computeDependencyGraphReferenceFingerprint({ ...reference, graph_fingerprint: undefined });

  const validation = validateExecutionPlanDependencyGraphReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_plan_dependency_graph_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  DEPENDENCY_GRAPH_REFERENCE_FIELDS,
  DEPENDENCY_GRAPH_REFERENCE_SAFE_FLAGS,
  DEPENDENCY_GRAPH_REFERENCE_VALIDATOR_VERSION,
  DEPENDENCY_RECORD_FIELDS,
  DEPENDENCY_RECORD_VALIDATOR_VERSION,
  MAX_LIST_ITEMS,
  buildDependencyRecord,
  buildExecutionPlanDependencyGraphReference,
  canonicalDependencyRecordKey,
  computeDependencyGraphReferenceFingerprint,
  computeDependencyRecordFingerprint,
  isCanonicallyOrderedDependencyRecordList,
  isOrderedUniqueStringList,
  validateDependencyRecord,
  validateExecutionPlanDependencyGraphReference
};
