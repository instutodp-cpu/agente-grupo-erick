'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr104: the policy governing Phase A (Readiness) of runtime-admission-boundary.js -- every
// `require_*` flag below is forced true (readiness re-checks every one of these dimensions, never
// skips one), matching the same "quase inteiramente SAFE_FLAGS forçados" shape
// execution-gateway-policy.js/runtime-execution-simulation-policy.js already established. Only 6
// `allow_*_package` flags remain genuinely caller-configurable, mirroring the same 6-knob shape
// runtime-execution-simulation-policy.js already uses for its own `allow_*_stage` flags -- this
// policy re-checks stage *composition* one more time at the readiness layer, independent of
// whatever the original runtime_policy (PR #103) already decided.
const RUNTIME_READINESS_POLICY_VALIDATOR_VERSION = 'runtime_readiness_policy_validator_v1';

const RUNTIME_READINESS_POLICY_FIELDS = Object.freeze([
  'runtime_readiness_policy_id', 'runtime_readiness_policy_version',
  'require_runtime_package_prepared', 'require_gateway_accepted', 'require_execution_plan_prepared',
  'require_validation_pipeline_completed', 'require_all_required_validations_valid', 'require_references_bound',
  'require_authorization_valid', 'require_authorization_scope_valid', 'require_registry_snapshot_valid',
  'require_architecture_gate_evidence_valid', 'require_stage_manifest_valid', 'require_dependency_manifest_valid',
  'require_budget_valid', 'require_stops_valid', 'require_compensations_valid', 'require_artifact_plan_valid',
  'require_event_plan_valid', 'require_package_fingerprint_valid', 'require_package_digest_valid',
  'require_freshness_valid', 'require_replay_valid', 'require_capacity_available', 'require_concurrency_available',
  'allow_no_llm_package', 'allow_model_reference_package', 'allow_tool_reference_package',
  'allow_workflow_reference_package', 'allow_parallel_package', 'allow_human_approval_reference',
  'allow_state_change_reference', 'allow_external_effect_reference', 'allow_irreversible_reference',
  'fail_on_unknown_status', 'fail_on_any_blocker', 'fail_on_version_mismatch', 'fail_on_fingerprint_mismatch',
  'fail_on_digest_mismatch', 'fail_on_capacity_exhausted', 'fail_on_concurrency_exhausted',
  'fail_on_stale_reference', 'fail_on_replay_conflict',
  'simulation', 'production_blocked', 'validator_version'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_runtime_package_prepared', 'require_gateway_accepted', 'require_execution_plan_prepared',
  'require_validation_pipeline_completed', 'require_all_required_validations_valid', 'require_references_bound',
  'require_authorization_valid', 'require_authorization_scope_valid', 'require_registry_snapshot_valid',
  'require_architecture_gate_evidence_valid', 'require_stage_manifest_valid', 'require_dependency_manifest_valid',
  'require_budget_valid', 'require_stops_valid', 'require_compensations_valid', 'require_artifact_plan_valid',
  'require_event_plan_valid', 'require_package_fingerprint_valid', 'require_package_digest_valid',
  'require_freshness_valid', 'require_replay_valid', 'require_capacity_available', 'require_concurrency_available'
]);

const ALLOW_FLAG_FIELDS = Object.freeze([
  'allow_no_llm_package', 'allow_model_reference_package', 'allow_tool_reference_package',
  'allow_workflow_reference_package', 'allow_parallel_package', 'allow_human_approval_reference',
  'allow_state_change_reference', 'allow_external_effect_reference', 'allow_irreversible_reference'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_unknown_status', 'fail_on_any_blocker', 'fail_on_version_mismatch', 'fail_on_fingerprint_mismatch',
  'fail_on_digest_mismatch', 'fail_on_capacity_exhausted', 'fail_on_concurrency_exhausted',
  'fail_on_stale_reference', 'fail_on_replay_conflict'
]);

// Every require_*/fail_on_* flag, plus allow_state_change_reference (declarative-only, same forced
// shape runtime-execution-simulation-policy.js already established for the identical concept) and
// the two permanently-forced-false effect flags. Nenhuma policy pode habilitar runtime.
const RUNTIME_READINESS_POLICY_SAFE_FLAGS = Object.freeze({
  require_runtime_package_prepared: true,
  require_gateway_accepted: true,
  require_execution_plan_prepared: true,
  require_validation_pipeline_completed: true,
  require_all_required_validations_valid: true,
  require_references_bound: true,
  require_authorization_valid: true,
  require_authorization_scope_valid: true,
  require_registry_snapshot_valid: true,
  require_architecture_gate_evidence_valid: true,
  require_stage_manifest_valid: true,
  require_dependency_manifest_valid: true,
  require_budget_valid: true,
  require_stops_valid: true,
  require_compensations_valid: true,
  require_artifact_plan_valid: true,
  require_event_plan_valid: true,
  require_package_fingerprint_valid: true,
  require_package_digest_valid: true,
  require_freshness_valid: true,
  require_replay_valid: true,
  require_capacity_available: true,
  require_concurrency_available: true,
  allow_state_change_reference: true,
  allow_external_effect_reference: false,
  allow_irreversible_reference: false,
  fail_on_unknown_status: true,
  fail_on_any_blocker: true,
  fail_on_version_mismatch: true,
  fail_on_fingerprint_mismatch: true,
  fail_on_digest_mismatch: true,
  fail_on_capacity_exhausted: true,
  fail_on_concurrency_exhausted: true,
  fail_on_stale_reference: true,
  fail_on_replay_conflict: true,
  simulation: true,
  production_blocked: true
});

function validateRuntimeReadinessPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['runtime_readiness_policy_must_be_object'] };
  exactFields(policy, RUNTIME_READINESS_POLICY_FIELDS, 'runtime_readiness_policy', errors);
  for (const field of ['runtime_readiness_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.runtime_readiness_policy_version) || policy.runtime_readiness_policy_version < 1) {
    errors.push('runtime_readiness_policy_version_invalid');
  }
  for (const field of [...REQUIRE_FLAG_FIELDS, ...ALLOW_FLAG_FIELDS, ...FAIL_ON_FLAG_FIELDS]) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_READINESS_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== RUNTIME_READINESS_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeReadinessPolicy(input = {}) {
  const policy = {
    runtime_readiness_policy_id: input.runtime_readiness_policy_id,
    runtime_readiness_policy_version: Number.isInteger(input.runtime_readiness_policy_version) ? input.runtime_readiness_policy_version : 1,
    allow_no_llm_package: input.allow_no_llm_package !== false,
    allow_model_reference_package: input.allow_model_reference_package !== false,
    allow_tool_reference_package: input.allow_tool_reference_package !== false,
    allow_workflow_reference_package: input.allow_workflow_reference_package !== false,
    allow_parallel_package: input.allow_parallel_package !== false,
    allow_human_approval_reference: input.allow_human_approval_reference !== false,
    ...RUNTIME_READINESS_POLICY_SAFE_FLAGS,
    validator_version: RUNTIME_READINESS_POLICY_VALIDATOR_VERSION
  };

  const validation = validateRuntimeReadinessPolicy(policy);
  if (!validation.valid) {
    throw new Error(`runtime_readiness_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  ALLOW_FLAG_FIELDS,
  FAIL_ON_FLAG_FIELDS,
  REQUIRE_FLAG_FIELDS,
  RUNTIME_READINESS_POLICY_FIELDS,
  RUNTIME_READINESS_POLICY_SAFE_FLAGS,
  RUNTIME_READINESS_POLICY_VALIDATOR_VERSION,
  buildRuntimeReadinessPolicy,
  validateRuntimeReadinessPolicy
};
