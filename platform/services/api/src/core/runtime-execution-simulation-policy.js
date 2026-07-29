'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const RUNTIME_EXECUTION_SIMULATION_POLICY_VALIDATOR_VERSION = 'runtime_execution_simulation_policy_validator_v1';

const RUNTIME_EXECUTION_SIMULATION_POLICY_FIELDS = Object.freeze([
  'runtime_policy_id', 'runtime_policy_version', 'allow_runtime_package_preparation_simulation',
  'allow_no_llm_stage', 'allow_model_reference_stage', 'allow_tool_reference_stage', 'allow_workflow_reference_stage',
  'allow_parallel_reference', 'allow_human_approval_reference', 'allow_state_change_reference',
  'allow_external_effect_reference', 'allow_irreversible_reference', 'require_gateway_accepted_simulation',
  'require_gateway_result_accepted', 'require_gateway_package_validated', 'require_execution_plan_prepared',
  'require_stage_manifest', 'require_dependency_graph', 'require_binding_ledger', 'require_validation_ledger',
  'require_budget_simulation', 'require_stop_simulation', 'require_compensation_simulation', 'require_artifact_plan',
  'require_event_plan', 'require_package_fingerprint', 'require_package_digest', 'require_replay_protection',
  'fail_on_unknown_stage', 'fail_on_unknown_dependency', 'fail_on_missing_binding', 'fail_on_budget_mismatch',
  'fail_on_stop_mismatch', 'fail_on_compensation_mismatch', 'fail_on_external_effect', 'fail_on_irreversible_effect',
  'simulation', 'production_blocked', 'validator_version'
]);

const ALLOW_FLAG_FIELDS = Object.freeze([
  'allow_runtime_package_preparation_simulation', 'allow_no_llm_stage', 'allow_model_reference_stage',
  'allow_tool_reference_stage', 'allow_workflow_reference_stage', 'allow_parallel_reference',
  'allow_human_approval_reference', 'allow_state_change_reference', 'allow_external_effect_reference',
  'allow_irreversible_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_gateway_accepted_simulation', 'require_gateway_result_accepted', 'require_gateway_package_validated',
  'require_execution_plan_prepared', 'require_stage_manifest', 'require_dependency_graph', 'require_binding_ledger',
  'require_validation_ledger', 'require_budget_simulation', 'require_stop_simulation', 'require_compensation_simulation',
  'require_artifact_plan', 'require_event_plan', 'require_package_fingerprint', 'require_package_digest',
  'require_replay_protection'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_unknown_stage', 'fail_on_unknown_dependency', 'fail_on_missing_binding', 'fail_on_budget_mismatch',
  'fail_on_stop_mismatch', 'fail_on_compensation_mismatch', 'fail_on_external_effect', 'fail_on_irreversible_effect'
]);

// Every field this PR mandates a fixed value for -- only allow_no_llm_stage/
// allow_model_reference_stage/allow_tool_reference_stage/allow_workflow_reference_stage/
// allow_parallel_reference/allow_human_approval_reference remain genuinely caller-configurable,
// the same "6 real knobs, everything else forced" shape execution-gateway-policy.js already
// established. allow_state_change_reference is forced true, but only as a *declarative reference*
// -- it never enables an actual state change (see runtime-compensation-simulation-reference.js's
// own compensation_executed=false SAFE_FLAG, and the STATE_CHANGE_REFERENCE-requires-compensation
// cross-check in runtime-execution-package.js).
const RUNTIME_EXECUTION_SIMULATION_POLICY_SAFE_FLAGS = Object.freeze({
  allow_runtime_package_preparation_simulation: true,
  allow_state_change_reference: true,
  allow_external_effect_reference: false,
  allow_irreversible_reference: false,
  require_gateway_accepted_simulation: true,
  require_gateway_result_accepted: true,
  require_gateway_package_validated: true,
  require_execution_plan_prepared: true,
  require_stage_manifest: true,
  require_dependency_graph: true,
  require_binding_ledger: true,
  require_validation_ledger: true,
  require_budget_simulation: true,
  require_stop_simulation: true,
  require_compensation_simulation: true,
  require_artifact_plan: true,
  require_event_plan: true,
  require_package_fingerprint: true,
  require_package_digest: true,
  require_replay_protection: true,
  fail_on_unknown_stage: true,
  fail_on_unknown_dependency: true,
  fail_on_missing_binding: true,
  fail_on_budget_mismatch: true,
  fail_on_stop_mismatch: true,
  fail_on_compensation_mismatch: true,
  fail_on_external_effect: true,
  fail_on_irreversible_effect: true,
  simulation: true,
  production_blocked: true
});

function validateRuntimeExecutionSimulationPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['runtime_execution_simulation_policy_must_be_object'] };
  exactFields(policy, RUNTIME_EXECUTION_SIMULATION_POLICY_FIELDS, 'runtime_execution_simulation_policy', errors);
  for (const field of ['runtime_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.runtime_policy_version) || policy.runtime_policy_version < 1) errors.push('runtime_policy_version_invalid');
  for (const field of [...ALLOW_FLAG_FIELDS, ...REQUIRE_FLAG_FIELDS, ...FAIL_ON_FLAG_FIELDS]) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_EXECUTION_SIMULATION_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== RUNTIME_EXECUTION_SIMULATION_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeExecutionSimulationPolicy(input = {}) {
  const policy = {
    runtime_policy_id: input.runtime_policy_id,
    runtime_policy_version: Number.isInteger(input.runtime_policy_version) ? input.runtime_policy_version : 1,
    allow_no_llm_stage: input.allow_no_llm_stage !== false,
    allow_model_reference_stage: input.allow_model_reference_stage !== false,
    allow_tool_reference_stage: input.allow_tool_reference_stage !== false,
    allow_workflow_reference_stage: input.allow_workflow_reference_stage !== false,
    allow_parallel_reference: input.allow_parallel_reference !== false,
    allow_human_approval_reference: input.allow_human_approval_reference !== false,
    ...RUNTIME_EXECUTION_SIMULATION_POLICY_SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_SIMULATION_POLICY_VALIDATOR_VERSION
  };

  const validation = validateRuntimeExecutionSimulationPolicy(policy);
  if (!validation.valid) {
    throw new Error(`runtime_execution_simulation_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  ALLOW_FLAG_FIELDS,
  FAIL_ON_FLAG_FIELDS,
  REQUIRE_FLAG_FIELDS,
  RUNTIME_EXECUTION_SIMULATION_POLICY_FIELDS,
  RUNTIME_EXECUTION_SIMULATION_POLICY_SAFE_FLAGS,
  RUNTIME_EXECUTION_SIMULATION_POLICY_VALIDATOR_VERSION,
  buildRuntimeExecutionSimulationPolicy,
  validateRuntimeExecutionSimulationPolicy
};
