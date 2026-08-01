'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const {
  RUNTIME_SCHEDULER_STATUSES, RUNTIME_SCHEDULER_DECISIONS, RUNTIME_SCHEDULER_NEXT_STATES, STATUS_OUTCOME_MAP,
  DEFAULT_OUTCOME, OPERATIONAL_SAFE_FLAGS
} = require('./runtime-scheduler-decision');
const { validateRuntimeSchedulerStageReference } = require('./runtime-scheduler-stage-reference');

const RUNTIME_SCHEDULER_RESULT_VALIDATOR_VERSION = 'runtime_scheduler_result_validator_v1';
const MAX_STAGE_REFERENCES = 200;

const COUNT_FIELDS = Object.freeze([
  'scheduler_stage_count', 'scheduler_dependency_count', 'parallel_group_count', 'approval_wait_count',
  'eligible_stage_count', 'waiting_dependency_stage_count', 'waiting_approval_stage_count', 'optional_stage_count',
  'blocked_stage_count', 'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens',
  'estimated_total_cost_minor_units'
]);

const RUNTIME_SCHEDULER_RESULT_FIELDS = Object.freeze([
  'runtime_scheduler_result_id', 'runtime_scheduler_request_id', 'runtime_scheduler_decision_id',
  'runtime_scheduler_package_id',
  'runtime_admission_decision_id', 'runtime_admission_result_id', 'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  'runtime_scheduler_request_fingerprint', 'runtime_scheduler_decision_fingerprint',
  'runtime_scheduler_package_fingerprint', 'runtime_scheduler_package_digest',
  'registry_version',
  ...COUNT_FIELDS,
  // pr106: the full derived stage list (never just IDs) -- the one thing PR #105's own thin,
  // ID-and-fingerprint-only Package/Decision shape deliberately omitted, but that a downstream
  // consumer (Runtime Worker Assignment Simulation Contracts) genuinely needs to cross-check each
  // stage's own eligibility/type/capabilities/modalities 1:1 without re-deriving them. Each entry is
  // independently validated against its own real RuntimeSchedulerStageReference contract -- never a
  // parallel, looser shape.
  'scheduler_stage_references',
  'blockers', 'reason_codes',
  'scheduler_evaluated', 'scheduler_package_prepared_in_simulation',
  'scheduler_started', 'runtime_enabled', 'execution_authorized', 'execution_started', 'job_created',
  'queue_created', 'queue_used', 'worker_started', 'stage_dispatched', 'stage_started', 'stage_completed', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;
const MAX_COUNT = 100000;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeSchedulerResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['runtime_scheduler_result_must_be_object'] };
  exactFields(result, RUNTIME_SCHEDULER_RESULT_FIELDS, 'runtime_scheduler_result', errors);
  for (const field of [
    'runtime_scheduler_result_id', 'runtime_scheduler_request_id', 'runtime_scheduler_decision_id',
    'runtime_scheduler_package_id', 'runtime_admission_decision_id', 'runtime_admission_result_id',
    'runtime_execution_package_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'agent_id', 'actor_id', 'runtime_scheduler_request_fingerprint', 'runtime_scheduler_decision_fingerprint',
    'runtime_scheduler_package_fingerprint', 'runtime_scheduler_package_digest', 'registry_version',
    'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_SCHEDULER_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!RUNTIME_SCHEDULER_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!RUNTIME_SCHEDULER_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[result.status] || DEFAULT_OUTCOME;
  if (result.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (result.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(result.scheduler_stage_references) || result.scheduler_stage_references.length > MAX_STAGE_REFERENCES) {
    errors.push('scheduler_stage_references_invalid');
  } else {
    result.scheduler_stage_references.forEach((reference, index) => {
      const referenceValidation = validateRuntimeSchedulerStageReference(reference);
      if (!referenceValidation.valid) errors.push(`scheduler_stage_references[${index}]_invalid::${referenceValidation.errors.join('|')}`);
    });
    if (result.scheduler_stage_references.length !== result.scheduler_stage_count) errors.push('scheduler_stage_references_count_mismatch');
  }
  if (!isSanitizedList(result.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(result.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  if (result.scheduler_evaluated !== true) errors.push('scheduler_evaluated_must_be_true');
  if (typeof result.scheduler_package_prepared_in_simulation !== 'boolean') errors.push('scheduler_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = result.status === 'SCHEDULER_PACKAGE_PREPARED_SIMULATION';
  if (result.scheduler_package_prepared_in_simulation !== expectedPrepared) errors.push('scheduler_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (result.validator_version !== RUNTIME_SCHEDULER_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// A thin envelope over the RuntimeSchedulerDecision this evaluation already produced -- never an
// independent source of truth. status/decision/next_state are always copied, never re-derived.
function buildRuntimeSchedulerResult(input = {}) {
  const status = RUNTIME_SCHEDULER_STATUSES.includes(input.status) ? input.status : 'SCHEDULER_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const result = {
    runtime_scheduler_result_id: input.runtime_scheduler_result_id,
    runtime_scheduler_request_id: input.runtime_scheduler_request_id,
    runtime_scheduler_decision_id: input.runtime_scheduler_decision_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_admission_decision_id: input.runtime_admission_decision_id,
    runtime_admission_result_id: input.runtime_admission_result_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    runtime_scheduler_request_fingerprint: input.runtime_scheduler_request_fingerprint || 'fingerprint_not_available',
    runtime_scheduler_decision_fingerprint: input.runtime_scheduler_decision_fingerprint || 'fingerprint_not_available',
    runtime_scheduler_package_fingerprint: input.runtime_scheduler_package_fingerprint || 'fingerprint_not_available',
    runtime_scheduler_package_digest: input.runtime_scheduler_package_digest || 'digest_not_available',
    registry_version: input.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    scheduler_evaluated: true,
    scheduler_package_prepared_in_simulation: status === 'SCHEDULER_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_RESULT_VALIDATOR_VERSION
  };
  for (const field of COUNT_FIELDS) {
    result[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  result.scheduler_stage_references = Array.isArray(input.scheduler_stage_references) ? input.scheduler_stage_references : [];

  const validation = validateRuntimeSchedulerResult(result);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_result_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(result);
}

module.exports = {
  COUNT_FIELDS,
  MAX_BLOCKERS,
  MAX_COUNT,
  MAX_REASON_CODES,
  MAX_STAGE_REFERENCES,
  RUNTIME_SCHEDULER_RESULT_FIELDS,
  RUNTIME_SCHEDULER_RESULT_VALIDATOR_VERSION,
  buildRuntimeSchedulerResult,
  validateRuntimeSchedulerResult
};
