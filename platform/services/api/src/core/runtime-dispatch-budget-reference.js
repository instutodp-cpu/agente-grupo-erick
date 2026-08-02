'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: a per-stage cross-check between the Stage's own estimated tokens/cost and what remains on
// the Runtime Budget Reference already flowing through the chain -- "Não ajustar estimativas. Não
// reservar ou consumir." `budget_validated` is a pure derived boolean, true only when all 4
// `*_within_limit` flags are true.
const RUNTIME_DISPATCH_BUDGET_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_budget_reference_validator_v1';

const ESTIMATE_FIELDS = Object.freeze(['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units']);
const REMAINING_FIELDS = Object.freeze(['remaining_input_tokens', 'remaining_output_tokens', 'remaining_total_tokens', 'remaining_cost_minor_units']);
const LIMIT_FLAG_FIELDS = Object.freeze(['input_within_limit', 'output_within_limit', 'total_within_limit', 'cost_within_limit']);

const RUNTIME_DISPATCH_BUDGET_REFERENCE_FIELDS = Object.freeze([
  'dispatch_budget_reference_id', 'dispatch_budget_reference_version',
  'runtime_dispatch_package_id', 'runtime_dispatch_stage_reference_id',
  'runtime_budget_reference_id', 'execution_budget_reference_id',
  ...ESTIMATE_FIELDS,
  ...REMAINING_FIELDS,
  ...LIMIT_FLAG_FIELDS,
  'budget_validated', 'budget_applied', 'tokens_reserved', 'tokens_consumed', 'cost_reserved', 'cost_consumed',
  'reason_codes',
  'budget_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_BUDGET_REFERENCE_SAFE_FLAGS = Object.freeze({
  budget_applied: false,
  tokens_reserved: false,
  tokens_consumed: false,
  cost_reserved: false,
  cost_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;
const MAX_TOKEN_BOUND = 1000000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeDispatchBudgetFingerprint(reference) {
  const { budget_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchBudgetReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_budget_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_BUDGET_REFERENCE_FIELDS, 'runtime_dispatch_budget_reference', errors);
  for (const field of [
    'dispatch_budget_reference_id', 'runtime_dispatch_package_id', 'runtime_dispatch_stage_reference_id',
    'runtime_budget_reference_id', 'execution_budget_reference_id', 'budget_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dispatch_budget_reference_version) || reference.dispatch_budget_reference_version < 1) {
    errors.push('dispatch_budget_reference_version_invalid');
  }
  for (const field of [...ESTIMATE_FIELDS, ...REMAINING_FIELDS]) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  for (const field of LIMIT_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.budget_validated !== 'boolean') errors.push('budget_validated_must_be_boolean');
  if (LIMIT_FLAG_FIELDS.every((field) => typeof reference[field] === 'boolean')) {
    const expectedValidated = LIMIT_FLAG_FIELDS.every((field) => reference[field] === true);
    if (reference.budget_validated !== expectedValidated) errors.push('budget_validated_inconsistent_with_limit_flags');
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_BUDGET_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_BUDGET_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDispatchBudgetFingerprint(reference) !== reference.budget_fingerprint) errors.push('budget_fingerprint_mismatch');
  } catch (error) {
    errors.push('budget_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchBudgetReference(input = {}) {
  const inputWithinLimit = Number.isInteger(input.estimated_input_tokens) && Number.isInteger(input.remaining_input_tokens)
    && input.estimated_input_tokens <= input.remaining_input_tokens;
  const outputWithinLimit = Number.isInteger(input.estimated_output_tokens) && Number.isInteger(input.remaining_output_tokens)
    && input.estimated_output_tokens <= input.remaining_output_tokens;
  const totalWithinLimit = Number.isInteger(input.estimated_total_tokens) && Number.isInteger(input.remaining_total_tokens)
    && input.estimated_total_tokens <= input.remaining_total_tokens;
  const costWithinLimit = Number.isInteger(input.estimated_cost_minor_units) && Number.isInteger(input.remaining_cost_minor_units)
    && input.estimated_cost_minor_units <= input.remaining_cost_minor_units;

  const reference = {
    dispatch_budget_reference_id: input.dispatch_budget_reference_id,
    dispatch_budget_reference_version: Number.isInteger(input.dispatch_budget_reference_version) ? input.dispatch_budget_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    runtime_budget_reference_id: input.runtime_budget_reference_id,
    execution_budget_reference_id: input.execution_budget_reference_id,
    estimated_input_tokens: input.estimated_input_tokens,
    estimated_output_tokens: input.estimated_output_tokens,
    estimated_total_tokens: input.estimated_total_tokens,
    estimated_cost_minor_units: input.estimated_cost_minor_units,
    remaining_input_tokens: input.remaining_input_tokens,
    remaining_output_tokens: input.remaining_output_tokens,
    remaining_total_tokens: input.remaining_total_tokens,
    remaining_cost_minor_units: input.remaining_cost_minor_units,
    input_within_limit: inputWithinLimit,
    output_within_limit: outputWithinLimit,
    total_within_limit: totalWithinLimit,
    cost_within_limit: costWithinLimit,
    budget_validated: inputWithinLimit && outputWithinLimit && totalWithinLimit && costWithinLimit,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    budget_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_BUDGET_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_BUDGET_REFERENCE_VALIDATOR_VERSION
  };
  reference.budget_fingerprint = computeDispatchBudgetFingerprint(reference);

  const validation = validateRuntimeDispatchBudgetReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_budget_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  ESTIMATE_FIELDS,
  LIMIT_FLAG_FIELDS,
  MAX_LIST_ITEMS,
  MAX_TOKEN_BOUND,
  REMAINING_FIELDS,
  RUNTIME_DISPATCH_BUDGET_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_BUDGET_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_BUDGET_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchBudgetReference,
  computeDispatchBudgetFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchBudgetReference
};
