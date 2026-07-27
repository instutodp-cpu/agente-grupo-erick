'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateValidationOutcome } = require('./validation-outcome');
const { getPrecedenceIndex } = require('./validation-taxonomy');

const VALIDATION_LEDGER_VALIDATOR_VERSION = 'validation_ledger_validator_v1';

const VALIDATION_LEDGER_FIELDS = Object.freeze([
  'validation_ledger_id', 'validation_ledger_version', 'execution_plan_request_id', 'execution_plan_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'validation_outcome_ids', 'validation_outcomes', 'validation_outcome_count', 'evaluated_count', 'valid_count',
  'invalid_count', 'not_applicable_count', 'not_evaluated_count', 'blocking_count', 'terminal_count',
  'first_blocking_stage', 'first_blocking_status', 'pipeline_completed', 'all_required_validations_valid',
  'ledger_fingerprint', 'logical_sequence', 'simulation', 'production_blocked', 'validator_version'
]);

// execution_plan_request_id/execution_plan_id are nullable so this single contract can serve both
// execution-plan-engine.js (both populated) and execution-authorization-boundary.js (both null --
// an authorization request has no execution plan of its own yet). "Pode usar ValidationLedger
// próprio da autorização ou adaptar ao ledger comum com execution_plan_id nullable" -- this PR
// adapts the common ledger rather than duplicating the contract.
const NULLABLE_REFERENCE_FIELDS = Object.freeze(['execution_plan_request_id', 'execution_plan_id', 'first_blocking_stage', 'first_blocking_status']);

const VALIDATION_LEDGER_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true
});

const MAX_OUTCOMES = 50;

function computeLedgerFingerprint(ledger) {
  const { ledger_fingerprint, ...rest } = ledger;
  return stablePayload(rest);
}

function validateValidationLedger(ledger) {
  const errors = [];
  if (!isPlainObject(ledger)) return { valid: false, errors: ['validation_ledger_must_be_object'] };
  exactFields(ledger, VALIDATION_LEDGER_FIELDS, 'validation_ledger', errors);
  for (const field of [
    'validation_ledger_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id',
    'actor_id', 'ledger_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(ledger[field])) errors.push(`${field}_invalid`);
  }
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (ledger[field] !== null && !isNonEmptyString(ledger[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!Number.isInteger(ledger.validation_ledger_version) || ledger.validation_ledger_version < 1) errors.push('validation_ledger_version_invalid');
  if (!Number.isInteger(ledger.logical_sequence) || ledger.logical_sequence < 0) errors.push('logical_sequence_invalid');

  const outcomesValid = Array.isArray(ledger.validation_outcomes) && ledger.validation_outcomes.length <= MAX_OUTCOMES;
  if (!outcomesValid) {
    errors.push('validation_outcomes_invalid');
  } else {
    ledger.validation_outcomes.forEach((outcome, index) => {
      const result = validateValidationOutcome(outcome);
      if (!result.valid) errors.push(`validation_outcomes[${index}]_invalid::${result.errors.join('|')}`);
    });
    // Outcomes must be ordered by logical_sequence -- the same "semantic order, never re-sorted"
    // discipline stage_records/stage_ids already established (PR #99).
    for (let i = 1; i < ledger.validation_outcomes.length; i += 1) {
      if (ledger.validation_outcomes[i].logical_sequence < ledger.validation_outcomes[i - 1].logical_sequence) {
        errors.push('validation_outcomes_not_ordered_by_logical_sequence');
        break;
      }
    }
  }

  if (outcomesValid && Array.isArray(ledger.validation_outcome_ids)) {
    const idsMatch = ledger.validation_outcome_ids.length === ledger.validation_outcomes.length
      && ledger.validation_outcome_ids.every((id, index) => id === `${ledger.validation_outcomes[index].validation_stage}::${ledger.validation_outcomes[index].validator_id}`);
    if (!idsMatch) errors.push('validation_outcome_ids_does_not_match_validation_outcomes');
    if (new Set(ledger.validation_outcome_ids).size !== ledger.validation_outcome_ids.length) errors.push('validation_outcome_ids_not_unique');
  } else {
    errors.push('validation_outcome_ids_invalid');
  }

  if (outcomesValid) {
    const outcomes = ledger.validation_outcomes;
    const expectedCounts = {
      validation_outcome_count: outcomes.length,
      evaluated_count: outcomes.filter((o) => o.evaluated === true).length,
      valid_count: outcomes.filter((o) => o.state === 'VALID').length,
      invalid_count: outcomes.filter((o) => o.state === 'INVALID').length,
      not_applicable_count: outcomes.filter((o) => o.state === 'NOT_APPLICABLE').length,
      not_evaluated_count: outcomes.filter((o) => o.state === 'NOT_EVALUATED').length,
      blocking_count: outcomes.filter((o) => o.blocking === true).length,
      terminal_count: outcomes.filter((o) => o.terminal === true).length
    };
    for (const [field, expected] of Object.entries(expectedCounts)) {
      if (ledger[field] !== expected) errors.push(`${field}_does_not_match_validation_outcomes`);
    }

    // first_blocking_stage/status must correspond to the first outcome (in logical_sequence
    // order) with blocking=true -- never any other one, never caller-chosen.
    const sorted = [...outcomes].sort((a, b) => a.logical_sequence - b.logical_sequence);
    const firstBlocker = sorted.find((o) => o.blocking === true) || null;
    const expectedFirstBlockingStage = firstBlocker ? firstBlocker.validation_stage : null;
    const expectedFirstBlockingStatus = firstBlocker ? firstBlocker.status : null;
    if (ledger.first_blocking_stage !== expectedFirstBlockingStage) errors.push('first_blocking_stage_does_not_match_validation_outcomes');
    if (ledger.first_blocking_status !== expectedFirstBlockingStatus) errors.push('first_blocking_status_does_not_match_validation_outcomes');

    // Once a blocker is reached, every outcome logically after it must remain NOT_EVALUATED --
    // "após blocker terminal, etapas posteriores permanecem NOT_EVALUATED."
    if (firstBlocker) {
      for (const outcome of sorted) {
        if (outcome.logical_sequence > firstBlocker.logical_sequence && outcome.state !== 'NOT_EVALUATED') {
          errors.push('outcome_after_blocker_must_remain_not_evaluated');
          break;
        }
      }
    }

    const expectedPipelineCompleted = expectedCounts.not_evaluated_count === 0;
    if (ledger.pipeline_completed !== expectedPipelineCompleted) errors.push('pipeline_completed_does_not_match_validation_outcomes');

    const expectedAllValid = expectedCounts.invalid_count === 0 && expectedCounts.not_evaluated_count === 0;
    if (ledger.all_required_validations_valid !== expectedAllValid) errors.push('all_required_validations_valid_does_not_match_validation_outcomes');
    // No blocker can coexist with all_required_validations_valid=true -- redundant with the check
    // above given blocking only ever accompanies state=INVALID, but kept explicit per spec.
    if (expectedCounts.blocking_count > 0 && ledger.all_required_validations_valid === true) {
      errors.push('all_required_validations_valid_must_be_false_when_blocking_count_positive');
    }
  }

  for (const [field, expected] of Object.entries(VALIDATION_LEDGER_SAFE_FLAGS)) {
    if (ledger[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (ledger.validator_version !== VALIDATION_LEDGER_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(ledger);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeLedgerFingerprint(ledger) !== ledger.ledger_fingerprint) errors.push('ledger_fingerprint_mismatch');
  } catch (error) {
    errors.push('ledger_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(ledger));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildValidationLedger(input = {}) {
  const outcomes = Array.isArray(input.validation_outcomes) ? [...input.validation_outcomes].sort((a, b) => a.logical_sequence - b.logical_sequence) : [];
  const firstBlocker = outcomes.find((o) => o.blocking === true) || null;
  const notEvaluatedCount = outcomes.filter((o) => o.state === 'NOT_EVALUATED').length;
  const invalidCount = outcomes.filter((o) => o.state === 'INVALID').length;

  const ledger = {
    validation_ledger_id: input.validation_ledger_id,
    validation_ledger_version: Number.isInteger(input.validation_ledger_version) ? input.validation_ledger_version : 1,
    execution_plan_request_id: input.execution_plan_request_id === undefined ? null : input.execution_plan_request_id,
    execution_plan_id: input.execution_plan_id === undefined ? null : input.execution_plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    validation_outcome_ids: outcomes.map((o) => `${o.validation_stage}::${o.validator_id}`),
    validation_outcomes: outcomes,
    validation_outcome_count: outcomes.length,
    evaluated_count: outcomes.filter((o) => o.evaluated === true).length,
    valid_count: outcomes.filter((o) => o.state === 'VALID').length,
    invalid_count: invalidCount,
    not_applicable_count: outcomes.filter((o) => o.state === 'NOT_APPLICABLE').length,
    not_evaluated_count: notEvaluatedCount,
    blocking_count: outcomes.filter((o) => o.blocking === true).length,
    terminal_count: outcomes.filter((o) => o.terminal === true).length,
    first_blocking_stage: firstBlocker ? firstBlocker.validation_stage : null,
    first_blocking_status: firstBlocker ? firstBlocker.status : null,
    pipeline_completed: notEvaluatedCount === 0,
    all_required_validations_valid: invalidCount === 0 && notEvaluatedCount === 0,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: VALIDATION_LEDGER_VALIDATOR_VERSION
  };
  ledger.ledger_fingerprint = computeLedgerFingerprint({ ...ledger, ledger_fingerprint: undefined });

  const validation = validateValidationLedger(ledger);
  if (!validation.valid) {
    throw new Error(`validation_ledger_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(ledger);
}

module.exports = {
  MAX_OUTCOMES,
  NULLABLE_REFERENCE_FIELDS,
  VALIDATION_LEDGER_FIELDS,
  VALIDATION_LEDGER_SAFE_FLAGS,
  VALIDATION_LEDGER_VALIDATOR_VERSION,
  buildValidationLedger,
  computeLedgerFingerprint,
  validateValidationLedger
};
