'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const {
  MAX_COST_MINOR_UNITS, MAX_PRIORITY, MAX_REQUIRED_CAPABILITIES, MAX_REQUIRED_MODALITIES, MAX_STAGE_SEQUENCE,
  MAX_TOKENS_REFERENCE, NULLABLE_REFERENCE_FIELDS, ORDERED_LIST_FIELDS, STAGE_TYPES, isOrderedUniqueStringList
} = require('./orchestrator-plan-stage');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { isOrderedUniqueEnumList } = require('./model-selection-task-profile');

const STAGE_RECORD_VALIDATOR_VERSION = 'orchestrator_stage_record_validator_v1';
const STAGE_MANIFEST_REFERENCE_VALIDATOR_VERSION = 'orchestrator_stage_manifest_reference_validator_v1';

const STAGE_RECORD_FIELDS = Object.freeze([
  'stage_id', 'stage_version', 'stage_type', 'stage_sequence', 'agent_reference_id', 'task_reference_id',
  'model_selection_reference_id', 'context_assembly_reference_id', 'memory_selection_reference_id',
  'tool_reference_ids', 'workflow_reference_id', 'dependency_reference_ids', 'required_capabilities',
  'required_modalities', 'priority', 'parallelizable', 'optional', 'approval_required', 'estimated_input_tokens',
  'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units', 'success_criteria_reference_ids',
  'fallback_reference_ids', 'escalation_reference_ids', 'stage_fingerprint', 'validator_version'
]);

const STAGE_MANIFEST_REFERENCE_FIELDS = Object.freeze([
  'stage_manifest_reference_id', 'stage_manifest_reference_version', 'planning_result_id', 'orchestration_plan_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'stage_ids', 'stage_records',
  'stage_count', 'manifest_fingerprint', 'logical_sequence', 'simulation', 'production_blocked', 'validator_version'
]);

const STAGE_MANIFEST_REFERENCE_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;

function validateStageRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['stage_record_must_be_object'] };
  exactFields(record, STAGE_RECORD_FIELDS, 'stage_record', errors);
  for (const field of ['stage_id', 'task_reference_id', 'stage_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(record.stage_version) || record.stage_version < 1) errors.push('stage_version_invalid');
  if (!STAGE_TYPES.includes(record.stage_type)) errors.push(`stage_type_not_allowed::${record.stage_type}`);
  if (!Number.isInteger(record.stage_sequence) || record.stage_sequence < 0 || record.stage_sequence > MAX_STAGE_SEQUENCE) {
    errors.push('stage_sequence_invalid');
  }
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (record[field] !== null && !isNonEmptyString(record[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(record[field], MAX_LIST_ITEMS)) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueEnumList(record.required_capabilities, CAPABILITY_TYPES, { maxItems: MAX_REQUIRED_CAPABILITIES })) errors.push('required_capabilities_invalid');
  if (!isOrderedUniqueEnumList(record.required_modalities, MODALITIES, { maxItems: MAX_REQUIRED_MODALITIES })) errors.push('required_modalities_invalid');
  if (!Number.isInteger(record.priority) || record.priority < 0 || record.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['parallelizable', 'optional', 'approval_required']) {
    if (typeof record[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(record[field]) || record[field] < 0 || record[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(record.estimated_input_tokens) && Number.isInteger(record.estimated_output_tokens) &&
    Number.isInteger(record.estimated_total_tokens) &&
    record.estimated_total_tokens !== record.estimated_input_tokens + record.estimated_output_tokens
  ) {
    errors.push('estimated_total_tokens_mismatch');
  }
  if (!Number.isInteger(record.estimated_cost_minor_units) || record.estimated_cost_minor_units < 0 || record.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (record.validator_version !== STAGE_RECORD_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(record);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(record));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeStageRecordFingerprint(record) {
  const { stage_fingerprint, ...rest } = record;
  return stablePayload(rest);
}

function buildStageRecord(input = {}) {
  const record = {
    stage_id: input.stage_id,
    stage_version: Number.isInteger(input.stage_version) ? input.stage_version : 1,
    stage_type: input.stage_type,
    stage_sequence: input.stage_sequence,
    agent_reference_id: input.agent_reference_id === undefined ? null : input.agent_reference_id,
    task_reference_id: input.task_reference_id,
    model_selection_reference_id: input.model_selection_reference_id === undefined ? null : input.model_selection_reference_id,
    context_assembly_reference_id: input.context_assembly_reference_id === undefined ? null : input.context_assembly_reference_id,
    memory_selection_reference_id: input.memory_selection_reference_id === undefined ? null : input.memory_selection_reference_id,
    tool_reference_ids: Array.isArray(input.tool_reference_ids) ? input.tool_reference_ids : [],
    workflow_reference_id: input.workflow_reference_id === undefined ? null : input.workflow_reference_id,
    dependency_reference_ids: Array.isArray(input.dependency_reference_ids) ? input.dependency_reference_ids : [],
    required_capabilities: Array.isArray(input.required_capabilities) ? input.required_capabilities : [],
    required_modalities: Array.isArray(input.required_modalities) ? input.required_modalities : [],
    priority: Number.isInteger(input.priority) ? input.priority : 0,
    parallelizable: input.parallelizable === true,
    optional: input.optional === true,
    approval_required: input.approval_required === true,
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_cost_minor_units: Number.isInteger(input.estimated_cost_minor_units) ? input.estimated_cost_minor_units : 0,
    success_criteria_reference_ids: Array.isArray(input.success_criteria_reference_ids) ? input.success_criteria_reference_ids : [],
    fallback_reference_ids: Array.isArray(input.fallback_reference_ids) ? input.fallback_reference_ids : [],
    escalation_reference_ids: Array.isArray(input.escalation_reference_ids) ? input.escalation_reference_ids : [],
    validator_version: STAGE_RECORD_VALIDATOR_VERSION
  };
  record.stage_fingerprint = computeStageRecordFingerprint({ ...record, stage_fingerprint: undefined });

  const validation = validateStageRecord(record);
  if (!validation.valid) {
    throw new Error(`stage_record_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(record);
}

// Canonical order = stage_sequence (the Planner's own semantic order), never alphabetical --
// enforced as stage_records[i].stage_sequence === i, which simultaneously guarantees
// non-negative, contiguous, unique, and ascending-in-array-order in one check.
function isCanonicalStageSequenceOrder(records) {
  return records.every((record, index) => isPlainObject(record) && record.stage_sequence === index);
}

function computeManifestFingerprint(manifest) {
  const { manifest_fingerprint, ...rest } = manifest;
  return stablePayload(rest);
}

function validateOrchestratorStageManifestReference(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) return { valid: false, errors: ['stage_manifest_reference_must_be_object'] };
  exactFields(manifest, STAGE_MANIFEST_REFERENCE_FIELDS, 'stage_manifest_reference', errors);
  for (const field of [
    'stage_manifest_reference_id', 'planning_result_id', 'orchestration_plan_id', 'tenant_id', 'organization_id',
    'project_id', 'session_reference_id', 'agent_id', 'manifest_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(manifest[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(manifest.stage_manifest_reference_version) || manifest.stage_manifest_reference_version < 1) {
    errors.push('stage_manifest_reference_version_invalid');
  }

  if (!Array.isArray(manifest.stage_records) || manifest.stage_records.length === 0 || manifest.stage_records.length > MAX_LIST_ITEMS) {
    errors.push('stage_records_invalid');
  } else {
    manifest.stage_records.forEach((record, index) => {
      errors.push(...validateStageRecord(record).errors.map((e) => `stage_records[${index}]_${e}`));
    });
    const validRecords = manifest.stage_records.filter(isPlainObject);
    if (validRecords.length === manifest.stage_records.length) {
      const stageIds = validRecords.map((record) => record.stage_id);
      if (new Set(stageIds).size !== stageIds.length) errors.push('stage_records_duplicate_stage_id');
      const sequences = validRecords.map((record) => record.stage_sequence);
      if (new Set(sequences).size !== sequences.length) errors.push('stage_records_duplicate_stage_sequence');
      if (!isCanonicalStageSequenceOrder(validRecords)) errors.push('stage_records_not_in_canonical_sequence_order');
    }
  }

  if (!Array.isArray(manifest.stage_ids) || !manifest.stage_ids.every(isNonEmptyString) || manifest.stage_ids.length > MAX_LIST_ITEMS) {
    errors.push('stage_ids_invalid');
  } else if (Array.isArray(manifest.stage_records)) {
    const validRecords = manifest.stage_records.filter(isPlainObject);
    if (validRecords.length === manifest.stage_records.length) {
      const expectedIds = validRecords.map((record) => record.stage_id);
      if (manifest.stage_ids.length !== expectedIds.length || manifest.stage_ids.some((id, index) => id !== expectedIds[index])) {
        errors.push('stage_ids_diverge_from_stage_records_order');
      }
    }
  }

  if (!Number.isInteger(manifest.stage_count) || manifest.stage_count < 0) {
    errors.push('stage_count_invalid');
  } else if (Array.isArray(manifest.stage_records) && manifest.stage_count !== manifest.stage_records.length) {
    errors.push('stage_count_inconsistent');
  }

  if (!Number.isInteger(manifest.logical_sequence) || manifest.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(STAGE_MANIFEST_REFERENCE_SAFE_FLAGS)) {
    if (manifest[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (manifest.validator_version !== STAGE_MANIFEST_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(manifest);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(manifest));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorStageManifestReference(input = {}) {
  const stageRecords = Array.isArray(input.stage_records) ? input.stage_records : [];
  const manifest = {
    stage_manifest_reference_id: input.stage_manifest_reference_id,
    stage_manifest_reference_version: Number.isInteger(input.stage_manifest_reference_version) ? input.stage_manifest_reference_version : 1,
    planning_result_id: input.planning_result_id,
    orchestration_plan_id: input.orchestration_plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    stage_ids: stageRecords.filter(isPlainObject).map((record) => record.stage_id),
    stage_records: stageRecords,
    stage_count: stageRecords.length,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: STAGE_MANIFEST_REFERENCE_VALIDATOR_VERSION
  };
  manifest.manifest_fingerprint = computeManifestFingerprint({ ...manifest, manifest_fingerprint: undefined });

  const validation = validateOrchestratorStageManifestReference(manifest);
  if (!validation.valid) {
    throw new Error(`orchestrator_stage_manifest_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(manifest);
}

module.exports = {
  MAX_LIST_ITEMS,
  STAGE_MANIFEST_REFERENCE_FIELDS,
  STAGE_MANIFEST_REFERENCE_SAFE_FLAGS,
  STAGE_MANIFEST_REFERENCE_VALIDATOR_VERSION,
  STAGE_RECORD_FIELDS,
  STAGE_RECORD_VALIDATOR_VERSION,
  buildOrchestratorStageManifestReference,
  buildStageRecord,
  computeManifestFingerprint,
  computeStageRecordFingerprint,
  isCanonicalStageSequenceOrder,
  validateOrchestratorStageManifestReference,
  validateStageRecord
};
