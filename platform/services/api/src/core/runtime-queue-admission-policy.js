'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr108: the policy governing runtime-queue-admission-boundary.js. "Nenhuma policy pode habilitar
// queue creation, enqueue ou execução" -- every require_*/fail_on_*/fail_closed flag is forced
// true, and allow_external_effect_reference/allow_irreversible_reference are forced false,
// mirroring exactly the same discipline runtime-dispatch-policy.js (PR #107) already established
// one layer below. The 11 remaining allow_* flags are genuinely caller-configurable booleans,
// re-checked by the boundary against the real queue class composition. Only the 11 `maximum_*`
// limits are real, positive-or-explicitly-zero integer caps -- never reserved, never consumed.
const RUNTIME_QUEUE_ADMISSION_POLICY_VALIDATOR_VERSION = 'runtime_queue_admission_policy_validator_v1';

const CONFIGURABLE_ALLOW_FIELDS = Object.freeze([
  'allow_no_llm_queue_reference', 'allow_model_queue_reference', 'allow_tool_queue_reference',
  'allow_workflow_queue_reference', 'allow_parallel_queue_reference', 'allow_shared_queue_reference',
  'allow_dedicated_queue_reference', 'allow_optional_queue_reference', 'allow_retry_queue_reference',
  'allow_dead_letter_reference', 'allow_state_change_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_dispatch_package_prepared', 'require_dispatch_intent_prepared', 'require_dispatch_order_preserved',
  'require_queue_class_match', 'require_partition_match', 'require_quota_available',
  'require_backlog_capacity_available', 'require_fairness_valid', 'require_freshness_valid', 'require_replay_valid',
  'require_idempotency_valid', 'require_registry_snapshot_valid', 'require_worker_binding_valid',
  'require_capacity_valid', 'require_budget_valid', 'require_policy_requirements_valid',
  'require_zero_operational_flags', 'require_rollout_zero'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_unknown_queue_class', 'fail_on_queue_class_mismatch', 'fail_on_partition_mismatch',
  'fail_on_quota_exceeded', 'fail_on_backlog_exceeded', 'fail_on_fairness_mismatch',
  'fail_on_dispatch_binding_mismatch', 'fail_on_order_mismatch', 'fail_on_freshness_mismatch',
  'fail_on_replay_conflict', 'fail_on_idempotency_mismatch', 'fail_on_registry_snapshot_mismatch',
  'fail_on_policy_requirement_mismatch', 'fail_on_fingerprint_mismatch', 'fail_on_digest_mismatch',
  'fail_on_version_mismatch', 'fail_on_conflict', 'fail_closed'
]);

const MAXIMUM_FIELDS = Object.freeze([
  'maximum_admission_entry_count', 'maximum_model_admission_count', 'maximum_tool_admission_count',
  'maximum_workflow_admission_count', 'maximum_parallel_admission_count', 'maximum_per_tenant_admission_count',
  'maximum_per_organization_admission_count', 'maximum_per_project_admission_count',
  'maximum_per_agent_admission_count', 'maximum_estimated_tokens', 'maximum_estimated_cost_minor_units'
]);

const RUNTIME_QUEUE_ADMISSION_POLICY_FIELDS = Object.freeze([
  'runtime_queue_admission_policy_id', 'runtime_queue_admission_policy_version',
  'allow_queue_admission_package_preparation_simulation', ...CONFIGURABLE_ALLOW_FIELDS,
  'allow_external_effect_reference', 'allow_irreversible_reference',
  ...REQUIRE_FLAG_FIELDS,
  ...MAXIMUM_FIELDS,
  ...FAIL_ON_FLAG_FIELDS,
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_ADMISSION_POLICY_SAFE_FLAGS = Object.freeze({
  allow_queue_admission_package_preparation_simulation: true,
  allow_external_effect_reference: false,
  allow_irreversible_reference: false,
  ...Object.fromEntries(REQUIRE_FLAG_FIELDS.map((field) => [field, true])),
  ...Object.fromEntries(FAIL_ON_FLAG_FIELDS.map((field) => [field, true])),
  simulation: true,
  production_blocked: true
});

const MAX_QUEUE_ADMISSION_BOUND = 1000000000;

function validateRuntimeQueueAdmissionPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['runtime_queue_admission_policy_must_be_object'] };
  exactFields(policy, RUNTIME_QUEUE_ADMISSION_POLICY_FIELDS, 'runtime_queue_admission_policy', errors);
  for (const field of ['runtime_queue_admission_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.runtime_queue_admission_policy_version) || policy.runtime_queue_admission_policy_version < 1) {
    errors.push('runtime_queue_admission_policy_version_invalid');
  }
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of MAXIMUM_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_QUEUE_ADMISSION_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_ADMISSION_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== RUNTIME_QUEUE_ADMISSION_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionPolicy(input = {}) {
  const policy = {
    runtime_queue_admission_policy_id: input.runtime_queue_admission_policy_id,
    runtime_queue_admission_policy_version: Number.isInteger(input.runtime_queue_admission_policy_version) ? input.runtime_queue_admission_policy_version : 1,
    ...RUNTIME_QUEUE_ADMISSION_POLICY_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_ADMISSION_POLICY_VALIDATOR_VERSION
  };
  for (const field of CONFIGURABLE_ALLOW_FIELDS) {
    policy[field] = input[field] === true;
  }
  for (const field of MAXIMUM_FIELDS) {
    policy[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }

  const validation = validateRuntimeQueueAdmissionPolicy(policy);
  if (!validation.valid) {
    throw new Error(`runtime_queue_admission_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  CONFIGURABLE_ALLOW_FIELDS,
  FAIL_ON_FLAG_FIELDS,
  MAXIMUM_FIELDS,
  MAX_QUEUE_ADMISSION_BOUND,
  REQUIRE_FLAG_FIELDS,
  RUNTIME_QUEUE_ADMISSION_POLICY_FIELDS,
  RUNTIME_QUEUE_ADMISSION_POLICY_SAFE_FLAGS,
  RUNTIME_QUEUE_ADMISSION_POLICY_VALIDATOR_VERSION,
  buildRuntimeQueueAdmissionPolicy,
  validateRuntimeQueueAdmissionPolicy
};
