'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106: the policy governing runtime-worker-assignment-boundary.js. "Nenhuma policy pode habilitar
// worker ou execução" -- every require_*/fail_on_*/fail_closed flag is forced true, and
// allow_external_effect_reference/allow_irreversible_reference are forced false, mirroring exactly
// the same discipline every prior policy contract in this lineage (PR #104/#105) already
// established. The 10 remaining allow_* flags are genuinely caller-configurable booleans,
// re-checked by the boundary against the real worker/stage composition -- the same shape
// runtime-scheduler-policy.js's own allow_*_stage_reference flags already use. Only the 8
// `maximum_*` limits are real, positive-or-explicitly-zero integer caps -- never reserved, never
// consumed.
const RUNTIME_WORKER_ASSIGNMENT_POLICY_VALIDATOR_VERSION = 'runtime_worker_assignment_policy_validator_v1';

const CONFIGURABLE_ALLOW_FIELDS = Object.freeze([
  'allow_local_worker_reference', 'allow_remote_worker_reference', 'allow_shared_worker_reference',
  'allow_dedicated_worker_reference', 'allow_no_llm_stage', 'allow_model_stage', 'allow_tool_stage',
  'allow_workflow_stage', 'allow_parallel_stage', 'allow_state_change_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_scheduler_package_prepared', 'require_scheduler_stage_validated', 'require_worker_registered',
  'require_worker_active_reference', 'require_worker_health_reference', 'require_worker_capacity_reference',
  'require_capability_match', 'require_modality_match', 'require_stage_type_match', 'require_model_support_match',
  'require_tool_support_match', 'require_workflow_support_match', 'require_network_policy_match',
  'require_secret_policy_match', 'require_effect_policy_match', 'require_tenant_isolation',
  'require_organization_isolation', 'require_project_isolation', 'require_agent_scope_match',
  'require_capacity_available', 'require_concurrency_available', 'require_freshness_valid', 'require_replay_valid',
  'require_idempotency_valid', 'require_zero_operational_flags', 'require_rollout_zero'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_no_candidate', 'fail_on_ambiguous_duplicate_candidate', 'fail_on_unknown_worker_type',
  'fail_on_unknown_stage_type', 'fail_on_capability_mismatch', 'fail_on_modality_mismatch',
  'fail_on_model_mismatch', 'fail_on_tool_mismatch', 'fail_on_workflow_mismatch',
  'fail_on_network_policy_mismatch', 'fail_on_secret_policy_mismatch', 'fail_on_effect_policy_mismatch',
  'fail_on_capacity_mismatch', 'fail_on_health_mismatch', 'fail_on_fingerprint_mismatch',
  'fail_on_digest_mismatch', 'fail_on_version_mismatch', 'fail_on_replay_conflict', 'fail_on_stale_reference',
  'fail_closed'
]);

const MAXIMUM_FIELDS = Object.freeze([
  'maximum_worker_candidates_per_stage', 'maximum_stages_per_worker_reference',
  'maximum_parallel_stages_per_worker_reference', 'maximum_model_stages_per_worker_reference',
  'maximum_tool_stages_per_worker_reference', 'maximum_workflow_stages_per_worker_reference',
  'maximum_estimated_tokens_per_worker_reference', 'maximum_estimated_cost_minor_units_per_worker_reference'
]);

const RUNTIME_WORKER_ASSIGNMENT_POLICY_FIELDS = Object.freeze([
  'runtime_worker_assignment_policy_id', 'runtime_worker_assignment_policy_version',
  'allow_worker_assignment_package_preparation_simulation', ...CONFIGURABLE_ALLOW_FIELDS,
  'allow_external_effect_reference', 'allow_irreversible_reference',
  ...REQUIRE_FLAG_FIELDS,
  ...MAXIMUM_FIELDS,
  ...FAIL_ON_FLAG_FIELDS,
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_ASSIGNMENT_POLICY_SAFE_FLAGS = Object.freeze({
  allow_worker_assignment_package_preparation_simulation: true,
  allow_external_effect_reference: false,
  allow_irreversible_reference: false,
  ...Object.fromEntries(REQUIRE_FLAG_FIELDS.map((field) => [field, true])),
  ...Object.fromEntries(FAIL_ON_FLAG_FIELDS.map((field) => [field, true])),
  simulation: true,
  production_blocked: true
});

const MAX_WORKER_ASSIGNMENT_BOUND = 1000000000;

function validateRuntimeWorkerAssignmentPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['runtime_worker_assignment_policy_must_be_object'] };
  exactFields(policy, RUNTIME_WORKER_ASSIGNMENT_POLICY_FIELDS, 'runtime_worker_assignment_policy', errors);
  for (const field of ['runtime_worker_assignment_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.runtime_worker_assignment_policy_version) || policy.runtime_worker_assignment_policy_version < 1) {
    errors.push('runtime_worker_assignment_policy_version_invalid');
  }
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of MAXIMUM_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_WORKER_ASSIGNMENT_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_ASSIGNMENT_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== RUNTIME_WORKER_ASSIGNMENT_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerAssignmentPolicy(input = {}) {
  const policy = {
    runtime_worker_assignment_policy_id: input.runtime_worker_assignment_policy_id,
    runtime_worker_assignment_policy_version: Number.isInteger(input.runtime_worker_assignment_policy_version) ? input.runtime_worker_assignment_policy_version : 1,
    ...RUNTIME_WORKER_ASSIGNMENT_POLICY_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_ASSIGNMENT_POLICY_VALIDATOR_VERSION
  };
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    policy[field] = input[field] === true;
  }
  for (const field of MAXIMUM_FIELDS) {
    policy[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }

  const validation = validateRuntimeWorkerAssignmentPolicy(policy);
  if (!validation.valid) {
    throw new Error(`runtime_worker_assignment_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  CONFIGURABLE_ALLOW_FIELDS,
  FAIL_ON_FLAG_FIELDS,
  MAXIMUM_FIELDS,
  MAX_WORKER_ASSIGNMENT_BOUND,
  REQUIRE_FLAG_FIELDS,
  RUNTIME_WORKER_ASSIGNMENT_POLICY_FIELDS,
  RUNTIME_WORKER_ASSIGNMENT_POLICY_SAFE_FLAGS,
  RUNTIME_WORKER_ASSIGNMENT_POLICY_VALIDATOR_VERSION,
  buildRuntimeWorkerAssignmentPolicy,
  validateRuntimeWorkerAssignmentPolicy
};
