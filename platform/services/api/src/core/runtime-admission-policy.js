'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr104: the policy governing Phase B (Admission) of runtime-admission-boundary.js. Every boolean
// flag is forced -- "Nenhuma policy pode habilitar runtime" applies here exactly as it does to
// runtime-readiness-policy.js. Only the 9 `maximum_admitted_*` limits are genuinely
// caller-configurable: real, positive-or-explicitly-zero integer caps the boundary compares real
// package/request counts against (never reserved, never consumed -- see
// runtime-admission-boundary.js's own "Admission Policy Limits" cross-check).
const RUNTIME_ADMISSION_POLICY_VALIDATOR_VERSION = 'runtime_admission_policy_validator_v1';

const RUNTIME_ADMISSION_POLICY_FIELDS = Object.freeze([
  'runtime_admission_policy_id', 'runtime_admission_policy_version',
  'allow_runtime_admission_simulation', 'require_runtime_ready_simulation', 'require_capacity_allocation_reference',
  'require_concurrency_reference', 'require_replay_protection', 'require_idempotency_protection',
  'require_tenant_isolation', 'require_organization_isolation', 'require_project_isolation',
  'require_session_isolation', 'require_agent_isolation', 'require_actor_isolation',
  'require_zero_operational_flags', 'require_rollout_zero',
  'maximum_admitted_packages_per_tenant', 'maximum_admitted_packages_per_organization',
  'maximum_admitted_packages_per_agent', 'maximum_admitted_parallel_stages', 'maximum_admitted_model_stages',
  'maximum_admitted_tool_stages', 'maximum_admitted_workflow_stages', 'maximum_admitted_estimated_tokens',
  'maximum_admitted_estimated_cost_minor_units',
  'fail_closed', 'simulation', 'production_blocked', 'validator_version'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'allow_runtime_admission_simulation', 'require_runtime_ready_simulation', 'require_capacity_allocation_reference',
  'require_concurrency_reference', 'require_replay_protection', 'require_idempotency_protection',
  'require_tenant_isolation', 'require_organization_isolation', 'require_project_isolation',
  'require_session_isolation', 'require_agent_isolation', 'require_actor_isolation',
  'require_zero_operational_flags', 'require_rollout_zero'
]);

const MAXIMUM_FIELDS = Object.freeze([
  'maximum_admitted_packages_per_tenant', 'maximum_admitted_packages_per_organization',
  'maximum_admitted_packages_per_agent', 'maximum_admitted_parallel_stages', 'maximum_admitted_model_stages',
  'maximum_admitted_tool_stages', 'maximum_admitted_workflow_stages', 'maximum_admitted_estimated_tokens',
  'maximum_admitted_estimated_cost_minor_units'
]);

const RUNTIME_ADMISSION_POLICY_SAFE_FLAGS = Object.freeze({
  allow_runtime_admission_simulation: true,
  require_runtime_ready_simulation: true,
  require_capacity_allocation_reference: true,
  require_concurrency_reference: true,
  require_replay_protection: true,
  require_idempotency_protection: true,
  require_tenant_isolation: true,
  require_organization_isolation: true,
  require_project_isolation: true,
  require_session_isolation: true,
  require_agent_isolation: true,
  require_actor_isolation: true,
  require_zero_operational_flags: true,
  require_rollout_zero: true,
  fail_closed: true,
  simulation: true,
  production_blocked: true
});

const MAX_ADMITTED_BOUND = 1000000000;

function validateRuntimeAdmissionPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['runtime_admission_policy_must_be_object'] };
  exactFields(policy, RUNTIME_ADMISSION_POLICY_FIELDS, 'runtime_admission_policy', errors);
  for (const field of ['runtime_admission_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.runtime_admission_policy_version) || policy.runtime_admission_policy_version < 1) {
    errors.push('runtime_admission_policy_version_invalid');
  }
  for (const field of REQUIRE_FLAG_FIELDS) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of MAXIMUM_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_ADMITTED_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_ADMISSION_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== RUNTIME_ADMISSION_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeAdmissionPolicy(input = {}) {
  const policy = {
    runtime_admission_policy_id: input.runtime_admission_policy_id,
    runtime_admission_policy_version: Number.isInteger(input.runtime_admission_policy_version) ? input.runtime_admission_policy_version : 1,
    ...RUNTIME_ADMISSION_POLICY_SAFE_FLAGS,
    validator_version: RUNTIME_ADMISSION_POLICY_VALIDATOR_VERSION
  };
  for (const field of MAXIMUM_FIELDS) {
    policy[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }

  const validation = validateRuntimeAdmissionPolicy(policy);
  if (!validation.valid) {
    throw new Error(`runtime_admission_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  MAXIMUM_FIELDS,
  MAX_ADMITTED_BOUND,
  REQUIRE_FLAG_FIELDS,
  RUNTIME_ADMISSION_POLICY_FIELDS,
  RUNTIME_ADMISSION_POLICY_SAFE_FLAGS,
  RUNTIME_ADMISSION_POLICY_VALIDATOR_VERSION,
  buildRuntimeAdmissionPolicy,
  validateRuntimeAdmissionPolicy
};
