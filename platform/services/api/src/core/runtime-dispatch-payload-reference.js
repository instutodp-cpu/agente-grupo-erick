'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { isOrderedUniqueEnumList } = require('./model-selection-task-profile');

// pr107: "RuntimeDispatchPayloadReference contém somente referências e fingerprints. Não contém
// prompt, mensagem, memória, segredo, credencial, argumentos de ferramenta, endpoint ou código
// executável." Every one of the 10 content-inclusion flags is permanently forced `false` --
// mirrors the same "safe flag smuggled onto a nested reference build input is silently forced
// false, never honored" discipline every prior contract in this lineage already established. This
// reference is built exclusively from already-validated ID/fingerprint/type/estimate fields the
// Dispatch Stage Reference itself carries, never from raw content.
const RUNTIME_DISPATCH_PAYLOAD_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_payload_reference_validator_v1';

const CONTENT_FLAG_FIELDS = Object.freeze([
  'payload_content_included', 'prompt_included', 'message_included', 'memory_content_included', 'secret_included',
  'credential_included', 'tool_arguments_included', 'provider_output_included', 'executable_code_included',
  'endpoint_included'
]);

const RUNTIME_DISPATCH_PAYLOAD_REFERENCE_FIELDS = Object.freeze([
  'dispatch_payload_reference_id', 'dispatch_payload_reference_version',
  'runtime_dispatch_package_id', 'runtime_dispatch_stage_reference_id', 'dispatch_worker_binding_reference_id',
  'runtime_execution_package_id', 'runtime_stage_reference_id', 'runtime_worker_reference_id',
  'task_reference_id', 'agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id',
  'model_selection_reference_id', 'tool_reference_ids', 'workflow_reference_id',
  'stage_policy_requirement_reference_ids', 'network_policy_reference_ids', 'secret_policy_reference_ids',
  'required_capability_ids', 'required_modality_ids',
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units',
  ...CONTENT_FLAG_FIELDS,
  'payload_validated', 'payload_applied', 'payload_sent',
  'payload_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_PAYLOAD_REFERENCE_SAFE_FLAGS = Object.freeze({
  ...Object.fromEntries(CONTENT_FLAG_FIELDS.map((field) => [field, false])),
  payload_applied: false,
  payload_sent: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_TOKENS = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeDispatchPayloadFingerprint(reference) {
  const { payload_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchPayloadReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_payload_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_PAYLOAD_REFERENCE_FIELDS, 'runtime_dispatch_payload_reference', errors);
  for (const field of [
    'dispatch_payload_reference_id', 'runtime_dispatch_package_id', 'runtime_dispatch_stage_reference_id',
    'dispatch_worker_binding_reference_id', 'runtime_execution_package_id', 'runtime_stage_reference_id',
    'runtime_worker_reference_id', 'task_reference_id', 'payload_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dispatch_payload_reference_version) || reference.dispatch_payload_reference_version < 1) {
    errors.push('dispatch_payload_reference_version_invalid');
  }
  for (const field of ['agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id', 'model_selection_reference_id', 'workflow_reference_id']) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  for (const field of ['tool_reference_ids', 'stage_policy_requirement_reference_ids', 'network_policy_reference_ids', 'secret_policy_reference_ids']) {
    if (!isOrderedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueEnumList(reference.required_capability_ids, CAPABILITY_TYPES, { maxItems: MAX_LIST_ITEMS })) {
    errors.push('required_capability_ids_invalid');
  }
  if (!isOrderedUniqueEnumList(reference.required_modality_ids, MODALITIES, { maxItems: MAX_LIST_ITEMS })) {
    errors.push('required_modality_ids_invalid');
  }
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_TOKENS) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.estimated_cost_minor_units) || reference.estimated_cost_minor_units < 0 || reference.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (typeof reference.payload_validated !== 'boolean') errors.push('payload_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_PAYLOAD_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_PAYLOAD_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDispatchPayloadFingerprint(reference) !== reference.payload_fingerprint) errors.push('payload_fingerprint_mismatch');
  } catch (error) {
    errors.push('payload_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchPayloadReference(input = {}) {
  const reference = {
    dispatch_payload_reference_id: input.dispatch_payload_reference_id,
    dispatch_payload_reference_version: Number.isInteger(input.dispatch_payload_reference_version) ? input.dispatch_payload_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    dispatch_worker_binding_reference_id: input.dispatch_worker_binding_reference_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    task_reference_id: input.task_reference_id,
    agent_reference_id: input.agent_reference_id === undefined ? null : input.agent_reference_id,
    memory_selection_reference_id: input.memory_selection_reference_id === undefined ? null : input.memory_selection_reference_id,
    context_assembly_reference_id: input.context_assembly_reference_id === undefined ? null : input.context_assembly_reference_id,
    model_selection_reference_id: input.model_selection_reference_id === undefined ? null : input.model_selection_reference_id,
    tool_reference_ids: uniqueSorted(input.tool_reference_ids || []),
    workflow_reference_id: input.workflow_reference_id === undefined ? null : input.workflow_reference_id,
    stage_policy_requirement_reference_ids: uniqueSorted(input.stage_policy_requirement_reference_ids || []),
    network_policy_reference_ids: uniqueSorted(input.network_policy_reference_ids || []),
    secret_policy_reference_ids: uniqueSorted(input.secret_policy_reference_ids || []),
    required_capability_ids: Array.isArray(input.required_capability_ids) ? input.required_capability_ids : [],
    required_modality_ids: Array.isArray(input.required_modality_ids) ? input.required_modality_ids : [],
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_cost_minor_units: Number.isInteger(input.estimated_cost_minor_units) ? input.estimated_cost_minor_units : 0,
    payload_validated: true,
    payload_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_PAYLOAD_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_PAYLOAD_REFERENCE_VALIDATOR_VERSION
  };
  reference.payload_fingerprint = computeDispatchPayloadFingerprint(reference);

  const validation = validateRuntimeDispatchPayloadReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_payload_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  CONTENT_FLAG_FIELDS,
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_TOKENS,
  RUNTIME_DISPATCH_PAYLOAD_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_PAYLOAD_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_PAYLOAD_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchPayloadReference,
  computeDispatchPayloadFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchPayloadReference
};
