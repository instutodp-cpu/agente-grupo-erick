'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const BUDGET_EVIDENCE_REFERENCE_VALIDATOR_VERSION = 'orchestrator_budget_evidence_reference_validator_v1';

const BUDGET_EVIDENCE_REFERENCE_FIELDS = Object.freeze([
  'budget_evidence_id', 'budget_evidence_version', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id',
  'organization_id', 'project_id', 'session_reference_id', 'budget_policy_reference_id', 'budget_reference_id',
  'maximum_total_tokens', 'estimated_total_tokens', 'maximum_total_cost_minor_units',
  'estimated_total_cost_minor_units', 'reserved_memory_tokens', 'reserved_context_tokens', 'reserved_output_tokens',
  'tokens_within_limit', 'cost_within_limit', 'protected_reservations_within_limit', 'budget_validated',
  'budget_consumed', 'evidence_status', 'evidence_fingerprint', 'logical_sequence', 'simulation',
  'production_blocked', 'validator_version'
]);

const NON_NEGATIVE_INTEGER_FIELDS = Object.freeze([
  'maximum_total_tokens', 'estimated_total_tokens', 'maximum_total_cost_minor_units',
  'estimated_total_cost_minor_units', 'reserved_memory_tokens', 'reserved_context_tokens', 'reserved_output_tokens'
]);

const LIMIT_FLAG_FIELDS = Object.freeze(['tokens_within_limit', 'cost_within_limit', 'protected_reservations_within_limit']);

const BUDGET_EVIDENCE_STATUSES = Object.freeze([
  'VALIDATED_SIMULATION', 'BUDGET_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED',
  'CONFLICT_BLOCKED'
]);

const BUDGET_EVIDENCE_SAFE_FLAGS = Object.freeze({
  budget_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_TOKEN_BOUND = 1000000000;

function validateBudgetEvidenceReference(evidence) {
  const errors = [];
  if (!isPlainObject(evidence)) return { valid: false, errors: ['budget_evidence_must_be_object'] };
  exactFields(evidence, BUDGET_EVIDENCE_REFERENCE_FIELDS, 'budget_evidence', errors);
  for (const field of [
    'budget_evidence_id', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id', 'organization_id',
    'project_id', 'session_reference_id', 'budget_policy_reference_id', 'budget_reference_id',
    'evidence_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(evidence[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(evidence.budget_evidence_version) || evidence.budget_evidence_version < 1) errors.push('budget_evidence_version_invalid');
  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(evidence[field]) || evidence[field] < 0 || evidence[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  for (const field of LIMIT_FLAG_FIELDS) {
    if (typeof evidence[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof evidence.budget_validated !== 'boolean') errors.push('budget_validated_must_be_boolean');
  if (!BUDGET_EVIDENCE_STATUSES.includes(evidence.evidence_status)) errors.push(`evidence_status_not_allowed::${evidence.evidence_status}`);
  if (!Number.isInteger(evidence.logical_sequence) || evidence.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(BUDGET_EVIDENCE_SAFE_FLAGS)) {
    if (evidence[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (LIMIT_FLAG_FIELDS.every((field) => typeof evidence[field] === 'boolean')) {
    const expectedValidated = LIMIT_FLAG_FIELDS.every((field) => evidence[field] === true);
    if (evidence.budget_validated !== expectedValidated) errors.push('budget_validated_inconsistent_with_limit_flags');
  }
  if (evidence.budget_validated === true && evidence.evidence_status !== 'VALIDATED_SIMULATION') {
    errors.push('evidence_status_must_be_validated_simulation_when_budget_validated');
  }
  if (evidence.budget_validated === false && evidence.evidence_status === 'VALIDATED_SIMULATION') {
    errors.push('evidence_status_cannot_be_validated_simulation_when_budget_not_validated');
  }

  if (evidence.validator_version !== BUDGET_EVIDENCE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(evidence);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(evidence));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeBudgetEvidenceFingerprint(evidence) {
  const { evidence_fingerprint, ...rest } = evidence;
  return stablePayload(rest);
}

function buildBudgetEvidenceReference(input = {}) {
  const tokensWithinLimit = Number.isInteger(input.estimated_total_tokens) && Number.isInteger(input.maximum_total_tokens) &&
    input.estimated_total_tokens <= input.maximum_total_tokens;
  const costWithinLimit = Number.isInteger(input.estimated_total_cost_minor_units) && Number.isInteger(input.maximum_total_cost_minor_units) &&
    input.estimated_total_cost_minor_units <= input.maximum_total_cost_minor_units;
  const reservedSum = (input.reserved_memory_tokens || 0) + (input.reserved_context_tokens || 0) + (input.reserved_output_tokens || 0);
  const protectedReservationsWithinLimit = Number.isInteger(input.maximum_total_tokens) && reservedSum <= input.maximum_total_tokens;
  const budgetValidated = tokensWithinLimit && costWithinLimit && protectedReservationsWithinLimit;
  // evidence_status is derived from the limit checks by default; callers may only override it
  // to one of the non-budget-derived statuses (upstream reference problems), never to force
  // VALIDATED_SIMULATION/BUDGET_BLOCKED against what the limit checks actually computed.
  const overridableStatuses = ['VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED', 'VALIDATION_FAILED'];
  const status = overridableStatuses.includes(input.evidence_status) ? input.evidence_status
    : (budgetValidated ? 'VALIDATED_SIMULATION' : 'BUDGET_BLOCKED');

  const evidence = {
    budget_evidence_id: input.budget_evidence_id,
    budget_evidence_version: Number.isInteger(input.budget_evidence_version) ? input.budget_evidence_version : 1,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    budget_policy_reference_id: input.budget_policy_reference_id,
    budget_reference_id: input.budget_reference_id,
    maximum_total_tokens: input.maximum_total_tokens,
    estimated_total_tokens: input.estimated_total_tokens,
    maximum_total_cost_minor_units: input.maximum_total_cost_minor_units,
    estimated_total_cost_minor_units: input.estimated_total_cost_minor_units,
    reserved_memory_tokens: input.reserved_memory_tokens,
    reserved_context_tokens: input.reserved_context_tokens,
    reserved_output_tokens: input.reserved_output_tokens,
    tokens_within_limit: tokensWithinLimit,
    cost_within_limit: costWithinLimit,
    protected_reservations_within_limit: protectedReservationsWithinLimit,
    budget_validated: budgetValidated,
    budget_consumed: false,
    evidence_status: status,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: BUDGET_EVIDENCE_REFERENCE_VALIDATOR_VERSION
  };
  evidence.evidence_fingerprint = computeBudgetEvidenceFingerprint({ ...evidence, evidence_fingerprint: undefined });

  const validation = validateBudgetEvidenceReference(evidence);
  if (!validation.valid) {
    throw new Error(`budget_evidence_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(evidence);
}

module.exports = {
  BUDGET_EVIDENCE_REFERENCE_FIELDS,
  BUDGET_EVIDENCE_REFERENCE_VALIDATOR_VERSION,
  BUDGET_EVIDENCE_SAFE_FLAGS,
  BUDGET_EVIDENCE_STATUSES,
  LIMIT_FLAG_FIELDS,
  MAX_TOKEN_BOUND,
  NON_NEGATIVE_INTEGER_FIELDS,
  buildBudgetEvidenceReference,
  computeBudgetEvidenceFingerprint,
  validateBudgetEvidenceReference
};
