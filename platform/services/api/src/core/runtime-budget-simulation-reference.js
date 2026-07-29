'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// A declarative cross-check between the real ExecutionPlanBudget (PR #98, the caller's own
// maximum_*/reserved_* limits) and what the Runtime Stage Simulation Manifest actually sums to --
// never reserves, never consumes. "Nenhum valor financeiro deve ser consumido ou reservado" --
// tokens_reserved/tokens_consumed/cost_reserved/cost_consumed are always false. Monetary values
// stay in minor units throughout, no conversion.
const RUNTIME_BUDGET_SIMULATION_REFERENCE_VALIDATOR_VERSION = 'runtime_budget_simulation_reference_validator_v1';

const RUNTIME_BUDGET_SIMULATION_REFERENCE_FIELDS = Object.freeze([
  'runtime_budget_reference_id', 'runtime_budget_reference_version', 'runtime_execution_package_id',
  'execution_plan_id', 'execution_budget_id', 'budget_authorization_id', 'maximum_total_tokens',
  'estimated_total_tokens', 'maximum_input_tokens', 'estimated_input_tokens', 'maximum_output_tokens',
  'estimated_output_tokens', 'maximum_total_cost_minor_units', 'estimated_total_cost_minor_units',
  'reserved_memory_tokens', 'reserved_context_tokens', 'reserved_output_tokens', 'model_stage_count',
  'tool_stage_count', 'workflow_stage_count', 'parallel_stage_count', 'tokens_within_limit', 'input_within_limit',
  'output_within_limit', 'cost_within_limit', 'stage_counts_within_limit', 'protected_reservations_preserved',
  'budget_validated', 'tokens_reserved', 'tokens_consumed', 'cost_reserved', 'cost_consumed', 'budget_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const NON_NEGATIVE_INTEGER_FIELDS = Object.freeze([
  'maximum_total_tokens', 'estimated_total_tokens', 'maximum_input_tokens', 'estimated_input_tokens',
  'maximum_output_tokens', 'estimated_output_tokens', 'maximum_total_cost_minor_units',
  'estimated_total_cost_minor_units', 'reserved_memory_tokens', 'reserved_context_tokens', 'reserved_output_tokens',
  'model_stage_count', 'tool_stage_count', 'workflow_stage_count', 'parallel_stage_count'
]);

const LIMIT_FLAG_FIELDS = Object.freeze([
  'tokens_within_limit', 'input_within_limit', 'output_within_limit', 'cost_within_limit',
  'stage_counts_within_limit', 'protected_reservations_preserved'
]);

const RUNTIME_BUDGET_SIMULATION_REFERENCE_SAFE_FLAGS = Object.freeze({
  tokens_reserved: false,
  tokens_consumed: false,
  cost_reserved: false,
  cost_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_TOKEN_BOUND = 1000000000;
const MAX_STAGE_CAP = 100000;

function computeRuntimeBudgetReferenceFingerprint(reference) {
  const { budget_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeBudgetSimulationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_budget_simulation_reference_must_be_object'] };
  exactFields(reference, RUNTIME_BUDGET_SIMULATION_REFERENCE_FIELDS, 'runtime_budget_simulation_reference', errors);
  for (const field of [
    'runtime_budget_reference_id', 'runtime_execution_package_id', 'execution_plan_id', 'execution_budget_id',
    'budget_authorization_id', 'budget_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_budget_reference_version) || reference.runtime_budget_reference_version < 1) {
    errors.push('runtime_budget_reference_version_invalid');
  }
  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    const bound = field.endsWith('_stage_count') ? MAX_STAGE_CAP : MAX_TOKEN_BOUND;
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > bound) errors.push(`${field}_invalid`);
  }
  for (const field of LIMIT_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.budget_validated !== 'boolean') errors.push('budget_validated_must_be_boolean');
  if (LIMIT_FLAG_FIELDS.every((field) => typeof reference[field] === 'boolean')) {
    const expectedValidated = LIMIT_FLAG_FIELDS.every((field) => reference[field] === true);
    if (reference.budget_validated !== expectedValidated) errors.push('budget_validated_inconsistent_with_limit_flags');
  }
  for (const [field, expected] of Object.entries(RUNTIME_BUDGET_SIMULATION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_BUDGET_SIMULATION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeBudgetReferenceFingerprint(reference) !== reference.budget_fingerprint) errors.push('budget_fingerprint_mismatch');
  } catch (error) {
    errors.push('budget_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeBudgetSimulationReference(input = {}) {
  const tokensWithinLimit = Number.isInteger(input.estimated_total_tokens) && Number.isInteger(input.maximum_total_tokens)
    && input.estimated_total_tokens <= input.maximum_total_tokens;
  const inputWithinLimit = Number.isInteger(input.estimated_input_tokens) && Number.isInteger(input.maximum_input_tokens)
    && input.estimated_input_tokens <= input.maximum_input_tokens;
  const outputWithinLimit = Number.isInteger(input.estimated_output_tokens) && Number.isInteger(input.maximum_output_tokens)
    && input.estimated_output_tokens <= input.maximum_output_tokens;
  const costWithinLimit = Number.isInteger(input.estimated_total_cost_minor_units) && Number.isInteger(input.maximum_total_cost_minor_units)
    && input.estimated_total_cost_minor_units <= input.maximum_total_cost_minor_units;
  // This contract's own fields carry only the *actual* model/tool/workflow/parallel stage counts,
  // never the maximum caps (those live on the source ExecutionPlanBudget, one layer below) -- the
  // caller (runtime-execution-package.js) is the one that compares actual-vs-maximum and hands the
  // resulting boolean in directly, the same "caller decides, this contract only records" shape
  // stage_counts_within_limit already has to have given its own field list.
  const stageCountsWithinLimit = input.stage_counts_within_limit === true;
  const reservedSum = (input.reserved_memory_tokens || 0) + (input.reserved_context_tokens || 0) + (input.reserved_output_tokens || 0);
  const protectedReservationsPreserved = Number.isInteger(input.maximum_total_tokens) && reservedSum <= input.maximum_total_tokens;
  const budgetValidated = tokensWithinLimit && inputWithinLimit && outputWithinLimit && costWithinLimit
    && stageCountsWithinLimit && protectedReservationsPreserved;

  const reference = {
    runtime_budget_reference_id: input.runtime_budget_reference_id,
    runtime_budget_reference_version: Number.isInteger(input.runtime_budget_reference_version) ? input.runtime_budget_reference_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    execution_budget_id: input.execution_budget_id,
    budget_authorization_id: input.budget_authorization_id,
    maximum_total_tokens: input.maximum_total_tokens,
    estimated_total_tokens: input.estimated_total_tokens,
    maximum_input_tokens: input.maximum_input_tokens,
    estimated_input_tokens: input.estimated_input_tokens,
    maximum_output_tokens: input.maximum_output_tokens,
    estimated_output_tokens: input.estimated_output_tokens,
    maximum_total_cost_minor_units: input.maximum_total_cost_minor_units,
    estimated_total_cost_minor_units: input.estimated_total_cost_minor_units,
    reserved_memory_tokens: input.reserved_memory_tokens,
    reserved_context_tokens: input.reserved_context_tokens,
    reserved_output_tokens: input.reserved_output_tokens,
    model_stage_count: input.model_stage_count,
    tool_stage_count: input.tool_stage_count,
    workflow_stage_count: input.workflow_stage_count,
    parallel_stage_count: input.parallel_stage_count,
    tokens_within_limit: tokensWithinLimit,
    input_within_limit: inputWithinLimit,
    output_within_limit: outputWithinLimit,
    cost_within_limit: costWithinLimit,
    stage_counts_within_limit: stageCountsWithinLimit,
    protected_reservations_preserved: protectedReservationsPreserved,
    budget_validated: budgetValidated,
    budget_fingerprint: 'pending',
    ...RUNTIME_BUDGET_SIMULATION_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_BUDGET_SIMULATION_REFERENCE_VALIDATOR_VERSION
  };
  reference.budget_fingerprint = computeRuntimeBudgetReferenceFingerprint(reference);

  const validation = validateRuntimeBudgetSimulationReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_budget_simulation_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  LIMIT_FLAG_FIELDS,
  MAX_STAGE_CAP,
  MAX_TOKEN_BOUND,
  NON_NEGATIVE_INTEGER_FIELDS,
  RUNTIME_BUDGET_SIMULATION_REFERENCE_FIELDS,
  RUNTIME_BUDGET_SIMULATION_REFERENCE_SAFE_FLAGS,
  RUNTIME_BUDGET_SIMULATION_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeBudgetSimulationReference,
  computeRuntimeBudgetReferenceFingerprint,
  validateRuntimeBudgetSimulationReference
};
