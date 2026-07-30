'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr105: the policy governing runtime-scheduler-boundary.js. "Nenhuma policy pode habilitar
// scheduler ou execução" -- every require_*/fail_on_*/fail_closed flag is forced true, and
// allow_external_effect_reference/allow_irreversible_reference are forced false, mirroring exactly
// the same discipline runtime-readiness-policy.js and runtime-admission-policy.js already
// established one layer below. The 8 remaining allow_*_reference flags are genuinely
// caller-configurable booleans, re-checked by the boundary against the real stage composition the
// Runtime Stage Manifest declares (never trusted structurally alone) -- the same shape
// runtime-readiness-policy.js's own allow_*_package flags already use. Only the 9
// `maximum_*` limits are real, positive-or-explicitly-zero integer caps the boundary compares real
// derived counts against -- never reserved, never consumed.
const RUNTIME_SCHEDULER_POLICY_VALIDATOR_VERSION = 'runtime_scheduler_policy_validator_v1';

const CONFIGURABLE_ALLOW_FIELDS = Object.freeze([
  'allow_required_stage_reference', 'allow_optional_stage_reference', 'allow_parallel_group_reference',
  'allow_human_approval_wait_reference', 'allow_model_stage_reference', 'allow_tool_stage_reference',
  'allow_workflow_stage_reference', 'allow_state_change_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_runtime_admitted_simulation', 'require_runtime_ready_simulation', 'require_runtime_package_prepared',
  'require_stage_manifest', 'require_dependency_manifest', 'require_capacity_snapshot',
  'require_concurrency_reference', 'require_budget_reference', 'require_stop_references',
  'require_compensation_references', 'require_freshness_reference', 'require_replay_reference',
  'require_idempotency_reference', 'require_deterministic_order', 'require_dependency_preservation',
  'require_parallel_group_derivation', 'require_approval_wait_derivation', 'require_zero_operational_flags',
  'require_rollout_zero'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_unknown_stage', 'fail_on_unknown_dependency', 'fail_on_cycle', 'fail_on_missing_dependency',
  'fail_on_dependency_redirection', 'fail_on_parallel_group_mismatch', 'fail_on_approval_wait_mismatch',
  'fail_on_capacity_mismatch', 'fail_on_concurrency_mismatch', 'fail_on_budget_mismatch',
  'fail_on_fingerprint_mismatch', 'fail_on_digest_mismatch', 'fail_on_version_mismatch',
  'fail_on_replay_conflict', 'fail_on_stale_reference', 'fail_closed'
]);

const MAXIMUM_FIELDS = Object.freeze([
  'maximum_scheduler_stage_count', 'maximum_parallel_group_count', 'maximum_stages_per_parallel_group',
  'maximum_waiting_approval_stage_count', 'maximum_model_stage_count', 'maximum_tool_stage_count',
  'maximum_workflow_stage_count', 'maximum_estimated_tokens', 'maximum_estimated_cost_minor_units'
]);

const RUNTIME_SCHEDULER_POLICY_FIELDS = Object.freeze([
  'runtime_scheduler_policy_id', 'runtime_scheduler_policy_version',
  'allow_scheduler_package_preparation_simulation', ...CONFIGURABLE_ALLOW_FIELDS,
  'allow_external_effect_reference', 'allow_irreversible_reference',
  ...REQUIRE_FLAG_FIELDS,
  ...MAXIMUM_FIELDS,
  ...FAIL_ON_FLAG_FIELDS,
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_SCHEDULER_POLICY_SAFE_FLAGS = Object.freeze({
  allow_scheduler_package_preparation_simulation: true,
  allow_external_effect_reference: false,
  allow_irreversible_reference: false,
  ...Object.fromEntries(REQUIRE_FLAG_FIELDS.map((field) => [field, true])),
  ...Object.fromEntries(FAIL_ON_FLAG_FIELDS.map((field) => [field, true])),
  simulation: true,
  production_blocked: true
});

const MAX_SCHEDULER_BOUND = 1000000000;

function validateRuntimeSchedulerPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['runtime_scheduler_policy_must_be_object'] };
  exactFields(policy, RUNTIME_SCHEDULER_POLICY_FIELDS, 'runtime_scheduler_policy', errors);
  for (const field of ['runtime_scheduler_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.runtime_scheduler_policy_version) || policy.runtime_scheduler_policy_version < 1) {
    errors.push('runtime_scheduler_policy_version_invalid');
  }
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of MAXIMUM_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_SCHEDULER_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== RUNTIME_SCHEDULER_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerPolicy(input = {}) {
  const policy = {
    runtime_scheduler_policy_id: input.runtime_scheduler_policy_id,
    runtime_scheduler_policy_version: Number.isInteger(input.runtime_scheduler_policy_version) ? input.runtime_scheduler_policy_version : 1,
    ...RUNTIME_SCHEDULER_POLICY_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_POLICY_VALIDATOR_VERSION
  };
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    policy[field] = input[field] === true;
  }
  for (const field of MAXIMUM_FIELDS) {
    policy[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }

  const validation = validateRuntimeSchedulerPolicy(policy);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  CONFIGURABLE_ALLOW_FIELDS,
  FAIL_ON_FLAG_FIELDS,
  MAXIMUM_FIELDS,
  MAX_SCHEDULER_BOUND,
  REQUIRE_FLAG_FIELDS,
  RUNTIME_SCHEDULER_POLICY_FIELDS,
  RUNTIME_SCHEDULER_POLICY_SAFE_FLAGS,
  RUNTIME_SCHEDULER_POLICY_VALIDATOR_VERSION,
  buildRuntimeSchedulerPolicy,
  validateRuntimeSchedulerPolicy
};
