'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const BINDING_RECORD_VALIDATOR_VERSION = 'execution_reference_binding_record_validator_v1';

const BINDING_RECORD_FIELDS = Object.freeze([
  'binding_record_id', 'binding_record_version', 'execution_plan_id', 'execution_plan_request_id',
  'execution_stage_id', 'binding_type', 'source_reference_id', 'source_reference_version',
  'source_reference_fingerprint', 'target_reference_id', 'target_reference_version',
  'target_reference_fingerprint', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'agent_id', 'actor_id', 'authorization_scope_id', 'binding_required', 'binding_validated', 'binding_applied',
  'binding_status', 'reason_codes', 'logical_sequence', 'binding_record_fingerprint', 'simulation',
  'production_blocked', 'validator_version'
]);

// Reuses PR #98's own 12 binding types verbatim, plus 6 new ones this PR needs for reference-
// level (not just per-stage) bindings: a whole authorization scope, a whole provenance chain, an
// approval, idempotency, a stop condition, a compensation reference, a registry snapshot, a
// dependency graph, and a stage manifest can all now be represented as one binding record, not
// only task/agent/model/tool/workflow/budget/authorization.
const BINDING_TYPES = Object.freeze([
  'TASK_BINDING', 'AGENT_BINDING', 'MEMORY_BINDING', 'CONTEXT_BINDING', 'MODEL_BINDING', 'TOOL_BINDING',
  'WORKFLOW_BINDING', 'BUDGET_BINDING', 'AUTHORIZATION_BINDING', 'AUTHORIZATION_SCOPE_BINDING',
  'AUTHORIZATION_PROVENANCE_BINDING', 'APPROVAL_BINDING', 'IDEMPOTENCY_BINDING', 'STOP_CONDITION_BINDING',
  'COMPENSATION_BINDING', 'REGISTRY_SNAPSHOT_BINDING', 'DEPENDENCY_GRAPH_BINDING', 'STAGE_MANIFEST_BINDING'
]);

const BINDING_STATUSES = Object.freeze([
  'VALIDATED_SIMULATION', 'BINDING_BLOCKED', 'FINGERPRINT_BLOCKED', 'VERSION_BLOCKED', 'TENANT_BLOCKED',
  'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'SCOPE_BLOCKED', 'CONFLICT_BLOCKED',
  'VALIDATION_FAILED'
]);

// A binding whose own source/target/stage is entirely plan-scoped (budget, authorization,
// authorization scope/provenance, registry snapshot, dependency graph, stage manifest,
// idempotency) has no single stage to anchor to -- execution_stage_id is null for those, exactly
// like model_selection_reference_id/workflow_reference_id are null on a StageRecord that does not
// use them.
const NULLABLE_REFERENCE_FIELDS = Object.freeze(['execution_stage_id']);

const BINDING_RECORD_SAFE_FLAGS = Object.freeze({
  binding_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_REASON_CODES = 50;

function isSanitizedStringList(list, maxItems = MAX_REASON_CODES) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function computeBindingRecordFingerprint(record) {
  const { binding_record_fingerprint, ...rest } = record;
  return stablePayload(rest);
}

function validateBindingRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['binding_record_must_be_object'] };
  exactFields(record, BINDING_RECORD_FIELDS, 'binding_record', errors);
  for (const field of [
    'binding_record_id', 'execution_plan_id', 'execution_plan_request_id', 'source_reference_id',
    'source_reference_fingerprint', 'target_reference_id', 'target_reference_fingerprint', 'tenant_id',
    'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id', 'authorization_scope_id',
    'binding_record_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}_invalid`);
  }
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (record[field] !== null && !isNonEmptyString(record[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!Number.isInteger(record.binding_record_version) || record.binding_record_version < 1) errors.push('binding_record_version_invalid');
  if (!BINDING_TYPES.includes(record.binding_type)) errors.push(`binding_type_not_allowed::${record.binding_type}`);
  if (!Number.isInteger(record.source_reference_version) || record.source_reference_version < 1) errors.push('source_reference_version_invalid');
  if (!Number.isInteger(record.target_reference_version) || record.target_reference_version < 1) errors.push('target_reference_version_invalid');
  for (const field of ['binding_required', 'binding_validated']) {
    if (typeof record[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!BINDING_STATUSES.includes(record.binding_status)) errors.push(`binding_status_not_allowed::${record.binding_status}`);
  if (!isSanitizedStringList(record.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(record.logical_sequence) || record.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(BINDING_RECORD_SAFE_FLAGS)) {
    if (record[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  // binding_status VALIDATED_SIMULATION must agree with binding_validated=true, and every
  // blocked status must agree with binding_validated=false -- the two fields can never disagree.
  if (record.binding_status === 'VALIDATED_SIMULATION' && record.binding_validated !== true) {
    errors.push('binding_validated_must_be_true_when_status_is_validated_simulation');
  }
  if (record.binding_status !== 'VALIDATED_SIMULATION' && record.binding_validated !== false) {
    errors.push('binding_validated_must_be_false_unless_status_is_validated_simulation');
  }
  if (record.validator_version !== BINDING_RECORD_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(record);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeBindingRecordFingerprint(record) !== record.binding_record_fingerprint) {
      errors.push('binding_record_fingerprint_mismatch');
    }
  } catch (error) {
    errors.push('binding_record_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(record));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildBindingRecord(input = {}) {
  const status = BINDING_STATUSES.includes(input.binding_status) ? input.binding_status : 'VALIDATION_FAILED';
  const record = {
    binding_record_id: input.binding_record_id,
    binding_record_version: Number.isInteger(input.binding_record_version) ? input.binding_record_version : 1,
    execution_plan_id: input.execution_plan_id,
    execution_plan_request_id: input.execution_plan_request_id,
    execution_stage_id: input.execution_stage_id === undefined ? null : input.execution_stage_id,
    binding_type: input.binding_type,
    source_reference_id: input.source_reference_id,
    source_reference_version: Number.isInteger(input.source_reference_version) ? input.source_reference_version : 1,
    source_reference_fingerprint: input.source_reference_fingerprint,
    target_reference_id: input.target_reference_id,
    target_reference_version: Number.isInteger(input.target_reference_version) ? input.target_reference_version : 1,
    target_reference_fingerprint: input.target_reference_fingerprint,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    authorization_scope_id: input.authorization_scope_id,
    binding_required: input.binding_required === true,
    binding_validated: status === 'VALIDATED_SIMULATION',
    binding_applied: false,
    binding_status: status,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: BINDING_RECORD_VALIDATOR_VERSION
  };
  record.binding_record_fingerprint = computeBindingRecordFingerprint({ ...record, binding_record_fingerprint: undefined });

  const validation = validateBindingRecord(record);
  if (!validation.valid) {
    throw new Error(`binding_record_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(record);
}

module.exports = {
  BINDING_RECORD_FIELDS,
  BINDING_RECORD_SAFE_FLAGS,
  BINDING_RECORD_VALIDATOR_VERSION,
  BINDING_STATUSES,
  BINDING_TYPES,
  MAX_REASON_CODES,
  NULLABLE_REFERENCE_FIELDS,
  buildBindingRecord,
  computeBindingRecordFingerprint,
  isSanitizedStringList,
  validateBindingRecord
};
