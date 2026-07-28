'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_GATEWAY_POLICY_VALIDATOR_VERSION = 'execution_gateway_policy_validator_v1';

const EXECUTION_GATEWAY_POLICY_FIELDS = Object.freeze([
  'gateway_policy_id', 'gateway_policy_version', 'allow_gateway_acceptance_simulation', 'allow_no_llm_package',
  'allow_model_reference_package', 'allow_tool_reference_package', 'allow_workflow_reference_package',
  'allow_parallel_package', 'allow_waiting_approval_package', 'allow_external_side_effect_reference',
  'allow_irreversible_reference', 'require_prepared_execution_plan', 'require_prepared_execution_result',
  'require_validation_pipeline_completed', 'require_all_required_validations_valid', 'require_references_bound',
  'require_authorization_provenance', 'require_authorization_scope', 'require_registry_snapshot',
  'require_stage_manifest', 'require_dependency_graph', 'require_binding_ledger', 'require_validation_ledger',
  'require_architecture_gate_evidence', 'require_package_fingerprint', 'require_package_digest', 'require_freshness',
  'require_replay_validation', 'fail_on_any_blocker', 'fail_on_warning', 'fail_on_unknown_status',
  'fail_on_version_mismatch', 'fail_on_fingerprint_mismatch', 'fail_on_digest_mismatch', 'simulation',
  'production_blocked', 'validator_version'
]);

const ALLOW_FLAG_FIELDS = Object.freeze([
  'allow_gateway_acceptance_simulation', 'allow_no_llm_package', 'allow_model_reference_package',
  'allow_tool_reference_package', 'allow_workflow_reference_package', 'allow_parallel_package',
  'allow_waiting_approval_package', 'allow_external_side_effect_reference', 'allow_irreversible_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_prepared_execution_plan', 'require_prepared_execution_result', 'require_validation_pipeline_completed',
  'require_all_required_validations_valid', 'require_references_bound', 'require_authorization_provenance',
  'require_authorization_scope', 'require_registry_snapshot', 'require_stage_manifest', 'require_dependency_graph',
  'require_binding_ledger', 'require_validation_ledger', 'require_architecture_gate_evidence',
  'require_package_fingerprint', 'require_package_digest', 'require_freshness', 'require_replay_validation'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_any_blocker', 'fail_on_warning', 'fail_on_unknown_status', 'fail_on_version_mismatch',
  'fail_on_fingerprint_mismatch', 'fail_on_digest_mismatch'
]);

// Every field this PR mandates a fixed value for -- only `allow_no_llm_package`/
// `allow_model_reference_package`/`allow_tool_reference_package`/`allow_workflow_reference_package`/
// `allow_parallel_package`/`fail_on_warning` remain genuinely caller-configurable.
const EXECUTION_GATEWAY_POLICY_SAFE_FLAGS = Object.freeze({
  allow_gateway_acceptance_simulation: true,
  allow_waiting_approval_package: false,
  allow_external_side_effect_reference: false,
  allow_irreversible_reference: false,
  require_prepared_execution_plan: true,
  require_prepared_execution_result: true,
  require_validation_pipeline_completed: true,
  require_all_required_validations_valid: true,
  require_references_bound: true,
  require_authorization_provenance: true,
  require_authorization_scope: true,
  require_registry_snapshot: true,
  require_stage_manifest: true,
  require_dependency_graph: true,
  require_binding_ledger: true,
  require_validation_ledger: true,
  require_architecture_gate_evidence: true,
  require_package_fingerprint: true,
  require_package_digest: true,
  require_freshness: true,
  require_replay_validation: true,
  fail_on_any_blocker: true,
  fail_on_unknown_status: true,
  fail_on_version_mismatch: true,
  fail_on_fingerprint_mismatch: true,
  fail_on_digest_mismatch: true,
  simulation: true,
  production_blocked: true
});

function validateExecutionGatewayPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['execution_gateway_policy_must_be_object'] };
  exactFields(policy, EXECUTION_GATEWAY_POLICY_FIELDS, 'execution_gateway_policy', errors);
  for (const field of ['gateway_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.gateway_policy_version) || policy.gateway_policy_version < 1) errors.push('gateway_policy_version_invalid');
  for (const field of [...ALLOW_FLAG_FIELDS, ...REQUIRE_FLAG_FIELDS, ...FAIL_ON_FLAG_FIELDS]) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== EXECUTION_GATEWAY_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionGatewayPolicy(input = {}) {
  const policy = {
    gateway_policy_id: input.gateway_policy_id,
    gateway_policy_version: Number.isInteger(input.gateway_policy_version) ? input.gateway_policy_version : 1,
    allow_no_llm_package: input.allow_no_llm_package !== false,
    allow_model_reference_package: input.allow_model_reference_package !== false,
    allow_tool_reference_package: input.allow_tool_reference_package !== false,
    allow_workflow_reference_package: input.allow_workflow_reference_package !== false,
    allow_parallel_package: input.allow_parallel_package !== false,
    fail_on_warning: input.fail_on_warning === true,
    ...EXECUTION_GATEWAY_POLICY_SAFE_FLAGS,
    validator_version: EXECUTION_GATEWAY_POLICY_VALIDATOR_VERSION
  };

  const validation = validateExecutionGatewayPolicy(policy);
  if (!validation.valid) {
    throw new Error(`execution_gateway_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  ALLOW_FLAG_FIELDS,
  EXECUTION_GATEWAY_POLICY_FIELDS,
  EXECUTION_GATEWAY_POLICY_SAFE_FLAGS,
  EXECUTION_GATEWAY_POLICY_VALIDATOR_VERSION,
  FAIL_ON_FLAG_FIELDS,
  REQUIRE_FLAG_FIELDS,
  buildExecutionGatewayPolicy,
  validateExecutionGatewayPolicy
};
