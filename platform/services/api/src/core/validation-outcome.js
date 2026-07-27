'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { VALIDATION_STATES } = require('./validation-state');

const VALIDATION_OUTCOME_FIELDS = Object.freeze([
  'validator_id', 'validator_version', 'validation_stage', 'state', 'status', 'severity', 'reason_codes',
  'evidence_reference_ids', 'input_fingerprint', 'output_fingerprint', 'evaluated', 'applicable', 'blocking',
  'terminal', 'logical_sequence', 'simulation', 'production_blocked'
]);

// The canonical 22-stage evaluation order every ValidationPipeline run walks, top to bottom.
// Mirrors execution-plan-engine.js's own established gate order (PR #94-#100), formalized here as
// a single source of truth rather than left implicit in a long chain of early returns.
const VALIDATION_STAGES = Object.freeze([
  'SCHEMA', 'SIMULATION_CONTEXT', 'IDENTITY', 'TENANT', 'ORGANIZATION', 'PROJECT', 'SESSION', 'TASK',
  'AUTHORIZATION', 'AUTHORIZATION_PROVENANCE', 'AUTHORIZATION_SCOPE', 'REGISTRY_SNAPSHOT', 'EVIDENCE',
  'STAGE_MANIFEST', 'DEPENDENCY_GRAPH', 'REFERENCE_BINDING', 'BUDGET', 'IDEMPOTENCY', 'STOP_CONDITIONS',
  'COMPENSATIONS', 'PACKAGE_INTEGRITY', 'FINALIZATION'
]);

const VALIDATION_SEVERITIES = Object.freeze(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);

const VALIDATION_OUTCOME_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 100;

function isSanitizedOrderedList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

// `status` is always a non-empty string (this contract, like every other in this codebase, has no
// nullable-unless-documented fields) -- for VALID/NOT_APPLICABLE/NOT_EVALUATED outcomes, where the
// 24-value official taxonomy (validation-taxonomy.js) has no "this one stage passed" entry of its
// own, a deterministic per-stage/state sentinel (`${stage}_${state}`, e.g. 'TENANT_VALID') is used
// instead. For INVALID outcomes, `status` is always one of the real taxonomy statuses.
function defaultStatusFor(stage, state) {
  return `${stage}_${state}`;
}

function computeOutcomeFingerprint(outcome) {
  const { output_fingerprint, ...rest } = outcome;
  return stablePayload(rest);
}

function validateValidationOutcome(outcome) {
  const errors = [];
  if (!isPlainObject(outcome)) return { valid: false, errors: ['validation_outcome_must_be_object'] };
  exactFields(outcome, VALIDATION_OUTCOME_FIELDS, 'validation_outcome', errors);
  for (const field of [
    'validator_id', 'validator_version', 'status', 'input_fingerprint', 'output_fingerprint'
  ]) {
    if (!isNonEmptyString(outcome[field])) errors.push(`${field}_invalid`);
  }
  if (!VALIDATION_STAGES.includes(outcome.validation_stage)) errors.push(`validation_stage_not_allowed::${outcome.validation_stage}`);
  if (!VALIDATION_STATES.includes(outcome.state)) errors.push(`state_not_allowed::${outcome.state}`);
  if (!VALIDATION_SEVERITIES.includes(outcome.severity)) errors.push(`severity_not_allowed::${outcome.severity}`);
  if (!isSanitizedOrderedList(outcome.reason_codes)) errors.push('reason_codes_invalid');
  if (!isSanitizedOrderedList(outcome.evidence_reference_ids)) errors.push('evidence_reference_ids_invalid');
  if (!Number.isInteger(outcome.logical_sequence) || outcome.logical_sequence < 0) errors.push('logical_sequence_invalid');

  // evaluated/applicable are strictly derived from state -- never independently caller-asserted,
  // the same derived-boolean discipline execution_plan_prepared/snapshot_consistent already
  // established in prior PRs.
  const expectedEvaluated = outcome.state !== 'NOT_EVALUATED';
  const expectedApplicable = outcome.state === 'VALID' || outcome.state === 'INVALID';
  if (outcome.evaluated !== expectedEvaluated) errors.push('evaluated_does_not_match_state');
  if (outcome.applicable !== expectedApplicable) errors.push('applicable_does_not_match_state');

  if (typeof outcome.blocking !== 'boolean') errors.push('blocking_must_be_boolean');
  if (typeof outcome.terminal !== 'boolean') errors.push('terminal_must_be_boolean');
  if (outcome.blocking === true && outcome.state !== 'INVALID') errors.push('blocking_requires_state_invalid');
  if (outcome.terminal === true && outcome.blocking !== true) errors.push('terminal_requires_blocking');

  for (const [field, expected] of Object.entries(VALIDATION_OUTCOME_SAFE_FLAGS)) {
    if (outcome[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  try {
    stablePayload(outcome);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeOutcomeFingerprint(outcome) !== outcome.output_fingerprint) errors.push('output_fingerprint_mismatch');
  } catch (error) {
    errors.push('output_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(outcome));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Never executes anything -- a pure, declarative record of "did validator X run for stage Y, and
// what did it find," nothing more. `state` is the only field this builder trusts from the caller
// as the ground truth; every other derived field (evaluated/applicable/status-sentinel) is
// computed from it, never independently accepted.
function buildValidationOutcome(input = {}) {
  const state = VALIDATION_STATES.includes(input.state) ? input.state : 'NOT_EVALUATED';
  const evaluated = state !== 'NOT_EVALUATED';
  const applicable = state === 'VALID' || state === 'INVALID';
  const blocking = state === 'INVALID' && input.blocking === true;
  const terminal = blocking === true && input.terminal === true;

  const outcome = {
    validator_id: input.validator_id,
    validator_version: input.validator_version,
    validation_stage: input.validation_stage,
    state,
    status: isNonEmptyString(input.status) ? input.status : defaultStatusFor(input.validation_stage, state),
    severity: VALIDATION_SEVERITIES.includes(input.severity) ? input.severity : (state === 'INVALID' ? 'ERROR' : 'INFO'),
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    evidence_reference_ids: Array.isArray(input.evidence_reference_ids) ? uniqueSorted(input.evidence_reference_ids) : [],
    input_fingerprint: isNonEmptyString(input.input_fingerprint) ? input.input_fingerprint : 'fingerprint_not_available',
    output_fingerprint: 'pending',
    evaluated,
    applicable,
    blocking,
    terminal,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true
  };
  outcome.output_fingerprint = computeOutcomeFingerprint({ ...outcome, output_fingerprint: undefined });

  const validation = validateValidationOutcome(outcome);
  if (!validation.valid) {
    throw new Error(`validation_outcome_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(outcome);
}

module.exports = {
  MAX_LIST_ITEMS,
  VALIDATION_OUTCOME_FIELDS,
  VALIDATION_OUTCOME_SAFE_FLAGS,
  VALIDATION_SEVERITIES,
  VALIDATION_STAGES,
  buildValidationOutcome,
  computeOutcomeFingerprint,
  defaultStatusFor,
  isSanitizedOrderedList,
  validateValidationOutcome
};
