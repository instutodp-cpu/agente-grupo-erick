'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: the policy governing runtime-dispatch-boundary.js. "Nenhuma policy pode habilitar dispatch
// ou execução" -- every require_*/fail_on_*/fail_closed flag is forced true, and
// allow_external_effect_reference/allow_irreversible_reference are forced false, mirroring exactly
// the same discipline runtime-worker-assignment-policy.js (PR #106) already established one layer
// below. The 7 remaining allow_* flags are genuinely caller-configurable booleans, re-checked by the
// boundary against the real stage composition. Only the 7 `maximum_*` limits are real, positive-or-
// explicitly-zero integer caps -- never reserved, never consumed.
const RUNTIME_DISPATCH_POLICY_VALIDATOR_VERSION = 'runtime_dispatch_policy_validator_v1';

const CONFIGURABLE_ALLOW_FIELDS = Object.freeze([
  'allow_no_llm_dispatch_reference', 'allow_model_dispatch_reference', 'allow_tool_dispatch_reference',
  'allow_workflow_dispatch_reference', 'allow_optional_stage_dispatch_reference',
  'allow_parallel_stage_dispatch_reference', 'allow_state_change_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_worker_assignment_package_prepared', 'require_scheduler_package_prepared', 'require_runtime_admitted',
  'require_worker_recommended', 'require_worker_binding_valid', 'require_stage_assignment_valid',
  'require_candidate_set_valid', 'require_compatibility_valid', 'require_scheduler_order_preserved',
  'require_required_dependency_gate', 'require_approval_gate', 'require_capacity_valid', 'require_budget_valid',
  'require_freshness_valid', 'require_replay_valid', 'require_idempotency_valid', 'require_registry_snapshot_valid',
  'require_network_policy_valid', 'require_secret_policy_valid', 'require_stage_policy_requirements_valid',
  'require_zero_operational_flags', 'require_rollout_zero'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_unknown_stage', 'fail_on_unknown_worker', 'fail_on_assignment_mismatch', 'fail_on_candidate_mismatch',
  'fail_on_compatibility_mismatch', 'fail_on_worker_binding_mismatch', 'fail_on_scheduler_order_mismatch',
  'fail_on_dependency_gate_mismatch', 'fail_on_approval_gate_mismatch', 'fail_on_capacity_mismatch',
  'fail_on_budget_mismatch', 'fail_on_freshness_mismatch', 'fail_on_replay_conflict', 'fail_on_idempotency_mismatch',
  'fail_on_registry_snapshot_mismatch', 'fail_on_policy_requirement_mismatch', 'fail_on_fingerprint_mismatch',
  'fail_on_digest_mismatch', 'fail_on_version_mismatch', 'fail_on_conflict', 'fail_closed'
]);

const MAXIMUM_FIELDS = Object.freeze([
  'maximum_dispatch_intent_count', 'maximum_model_dispatch_intent_count', 'maximum_tool_dispatch_intent_count',
  'maximum_workflow_dispatch_intent_count', 'maximum_parallel_dispatch_intent_count', 'maximum_estimated_tokens',
  'maximum_estimated_cost_minor_units'
]);

const RUNTIME_DISPATCH_POLICY_FIELDS = Object.freeze([
  'runtime_dispatch_policy_id', 'runtime_dispatch_policy_version',
  'allow_dispatch_package_preparation_simulation', ...CONFIGURABLE_ALLOW_FIELDS,
  'allow_external_effect_reference', 'allow_irreversible_reference',
  ...REQUIRE_FLAG_FIELDS,
  ...MAXIMUM_FIELDS,
  ...FAIL_ON_FLAG_FIELDS,
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_POLICY_SAFE_FLAGS = Object.freeze({
  allow_dispatch_package_preparation_simulation: true,
  allow_external_effect_reference: false,
  allow_irreversible_reference: false,
  ...Object.fromEntries(REQUIRE_FLAG_FIELDS.map((field) => [field, true])),
  ...Object.fromEntries(FAIL_ON_FLAG_FIELDS.map((field) => [field, true])),
  simulation: true,
  production_blocked: true
});

const MAX_DISPATCH_BOUND = 1000000000;

function validateRuntimeDispatchPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['runtime_dispatch_policy_must_be_object'] };
  exactFields(policy, RUNTIME_DISPATCH_POLICY_FIELDS, 'runtime_dispatch_policy', errors);
  for (const field of ['runtime_dispatch_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.runtime_dispatch_policy_version) || policy.runtime_dispatch_policy_version < 1) {
    errors.push('runtime_dispatch_policy_version_invalid');
  }
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of MAXIMUM_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_DISPATCH_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== RUNTIME_DISPATCH_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchPolicy(input = {}) {
  const policy = {
    runtime_dispatch_policy_id: input.runtime_dispatch_policy_id,
    runtime_dispatch_policy_version: Number.isInteger(input.runtime_dispatch_policy_version) ? input.runtime_dispatch_policy_version : 1,
    ...RUNTIME_DISPATCH_POLICY_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_POLICY_VALIDATOR_VERSION
  };
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    policy[field] = input[field] === true;
  }
  for (const field of MAXIMUM_FIELDS) {
    policy[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }

  const validation = validateRuntimeDispatchPolicy(policy);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  CONFIGURABLE_ALLOW_FIELDS,
  FAIL_ON_FLAG_FIELDS,
  MAXIMUM_FIELDS,
  MAX_DISPATCH_BOUND,
  REQUIRE_FLAG_FIELDS,
  RUNTIME_DISPATCH_POLICY_FIELDS,
  RUNTIME_DISPATCH_POLICY_SAFE_FLAGS,
  RUNTIME_DISPATCH_POLICY_VALIDATOR_VERSION,
  buildRuntimeDispatchPolicy,
  validateRuntimeDispatchPolicy
};
