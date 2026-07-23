'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_VALIDATOR_VERSION = 'execution_authorization_budget_reference_validator_v1';

const EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_FIELDS = Object.freeze([
  'budget_authorization_id', 'budget_authorization_version', 'planning_result_id', 'plan_id', 'tenant_id',
  'organization_id', 'project_id', 'session_reference_id', 'budget_evidence_id', 'maximum_authorized_tokens',
  'estimated_plan_tokens', 'maximum_authorized_cost_minor_units', 'estimated_plan_cost_minor_units',
  'protected_memory_reservations_preserved', 'protected_context_reservations_preserved',
  'protected_output_reservations_preserved', 'tokens_authorized_in_simulation', 'cost_authorized_in_simulation',
  'budget_authorization_validated', 'budget_consumed', 'budget_fingerprint', 'validator_version'
]);

const NON_NEGATIVE_INTEGER_FIELDS = Object.freeze([
  'maximum_authorized_tokens', 'estimated_plan_tokens', 'maximum_authorized_cost_minor_units', 'estimated_plan_cost_minor_units'
]);

const RESERVATION_FLAG_FIELDS = Object.freeze([
  'protected_memory_reservations_preserved', 'protected_context_reservations_preserved', 'protected_output_reservations_preserved'
]);

const AUTHORIZATION_FLAG_FIELDS = Object.freeze(['tokens_authorized_in_simulation', 'cost_authorized_in_simulation']);

const EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_SAFE_FLAGS = Object.freeze({
  budget_consumed: false
});

const MAX_TOKEN_BOUND = 1000000000;

function validateExecutionAuthorizationBudgetReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_authorization_budget_reference_must_be_object'] };
  exactFields(reference, EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_FIELDS, 'execution_authorization_budget_reference', errors);
  for (const field of [
    'budget_authorization_id', 'planning_result_id', 'plan_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'budget_evidence_id', 'budget_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.budget_authorization_version) || reference.budget_authorization_version < 1) errors.push('budget_authorization_version_invalid');
  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  for (const field of [...RESERVATION_FLAG_FIELDS, ...AUTHORIZATION_FLAG_FIELDS]) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.budget_authorization_validated !== 'boolean') errors.push('budget_authorization_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  const allFlagsKnown = [...RESERVATION_FLAG_FIELDS, ...AUTHORIZATION_FLAG_FIELDS].every((field) => typeof reference[field] === 'boolean');
  if (allFlagsKnown) {
    const expectedValidated = [...RESERVATION_FLAG_FIELDS, ...AUTHORIZATION_FLAG_FIELDS].every((field) => reference[field] === true);
    if (reference.budget_authorization_validated !== expectedValidated) errors.push('budget_authorization_validated_inconsistent_with_flags');
  }

  if (reference.validator_version !== EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeBudgetReferenceFingerprint(reference) {
  const { budget_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function buildExecutionAuthorizationBudgetReference(input = {}) {
  const tokensAuthorized = Number.isInteger(input.estimated_plan_tokens) && Number.isInteger(input.maximum_authorized_tokens) &&
    input.estimated_plan_tokens <= input.maximum_authorized_tokens;
  const costAuthorized = Number.isInteger(input.estimated_plan_cost_minor_units) && Number.isInteger(input.maximum_authorized_cost_minor_units) &&
    input.estimated_plan_cost_minor_units <= input.maximum_authorized_cost_minor_units;
  const memoryReservationsPreserved = input.protected_memory_reservations_preserved === true;
  const contextReservationsPreserved = input.protected_context_reservations_preserved === true;
  const outputReservationsPreserved = input.protected_output_reservations_preserved === true;
  const budgetAuthorizationValidated = tokensAuthorized && costAuthorized && memoryReservationsPreserved &&
    contextReservationsPreserved && outputReservationsPreserved;

  const reference = {
    budget_authorization_id: input.budget_authorization_id,
    budget_authorization_version: Number.isInteger(input.budget_authorization_version) ? input.budget_authorization_version : 1,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    budget_evidence_id: input.budget_evidence_id,
    maximum_authorized_tokens: input.maximum_authorized_tokens,
    estimated_plan_tokens: input.estimated_plan_tokens,
    maximum_authorized_cost_minor_units: input.maximum_authorized_cost_minor_units,
    estimated_plan_cost_minor_units: input.estimated_plan_cost_minor_units,
    protected_memory_reservations_preserved: memoryReservationsPreserved,
    protected_context_reservations_preserved: contextReservationsPreserved,
    protected_output_reservations_preserved: outputReservationsPreserved,
    tokens_authorized_in_simulation: tokensAuthorized,
    cost_authorized_in_simulation: costAuthorized,
    budget_authorization_validated: budgetAuthorizationValidated,
    budget_consumed: false,
    validator_version: EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_VALIDATOR_VERSION
  };
  reference.budget_fingerprint = computeBudgetReferenceFingerprint({ ...reference, budget_fingerprint: undefined });

  const validation = validateExecutionAuthorizationBudgetReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_authorization_budget_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  AUTHORIZATION_FLAG_FIELDS,
  EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_FIELDS,
  EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_SAFE_FLAGS,
  EXECUTION_AUTHORIZATION_BUDGET_REFERENCE_VALIDATOR_VERSION,
  MAX_TOKEN_BOUND,
  NON_NEGATIVE_INTEGER_FIELDS,
  RESERVATION_FLAG_FIELDS,
  buildExecutionAuthorizationBudgetReference,
  computeBudgetReferenceFingerprint,
  validateExecutionAuthorizationBudgetReference
};
