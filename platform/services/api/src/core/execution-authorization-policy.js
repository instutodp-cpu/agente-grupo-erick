'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_AUTHORIZATION_POLICY_VALIDATOR_VERSION = 'execution_authorization_policy_validator_v1';

const EXECUTION_AUTHORIZATION_POLICY_FIELDS = Object.freeze([
  'authorization_policy_id', 'authorization_policy_version', 'allow_authorized_simulation', 'allow_no_llm_plan',
  'allow_model_plan', 'allow_tool_references', 'allow_workflow_reference', 'allow_parallel_plan',
  'allow_external_side_effect_reference', 'allow_irreversible_reference', 'require_ready_orchestrator_decision',
  'require_ready_evidence_bundle', 'require_actor_authorized', 'require_role_authorized', 'require_scope_match',
  'require_risk_compatible', 'require_approval_when_applicable', 'require_budget_authorized',
  'require_unexpired_authorization', 'fail_on_any_blocker', 'fail_on_unknown_status', 'fail_on_version_mismatch',
  'fail_on_fingerprint_mismatch', 'simulation', 'production_blocked', 'validator_version'
]);

const ALLOW_FLAG_FIELDS = Object.freeze([
  'allow_authorized_simulation', 'allow_no_llm_plan', 'allow_model_plan', 'allow_tool_references',
  'allow_workflow_reference', 'allow_parallel_plan', 'allow_external_side_effect_reference', 'allow_irreversible_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_ready_orchestrator_decision', 'require_ready_evidence_bundle', 'require_actor_authorized',
  'require_role_authorized', 'require_scope_match', 'require_risk_compatible', 'require_approval_when_applicable',
  'require_budget_authorized', 'require_unexpired_authorization'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_any_blocker', 'fail_on_unknown_status', 'fail_on_version_mismatch', 'fail_on_fingerprint_mismatch'
]);

// Every require_*/fail_on_* flag is mandatory-true in this PR: nothing in this boundary can be
// authorized while skipping a required validation step, and this PR does not (yet) support
// external side effects or irreversible references at all.
const EXECUTION_AUTHORIZATION_POLICY_SAFE_FLAGS = Object.freeze({
  require_ready_orchestrator_decision: true,
  require_ready_evidence_bundle: true,
  require_actor_authorized: true,
  require_role_authorized: true,
  require_scope_match: true,
  require_risk_compatible: true,
  require_approval_when_applicable: true,
  require_budget_authorized: true,
  require_unexpired_authorization: true,
  fail_on_any_blocker: true,
  fail_on_unknown_status: true,
  fail_on_version_mismatch: true,
  fail_on_fingerprint_mismatch: true,
  allow_external_side_effect_reference: false,
  allow_irreversible_reference: false,
  simulation: true,
  production_blocked: true
});

function validateExecutionAuthorizationPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['execution_authorization_policy_must_be_object'] };
  exactFields(policy, EXECUTION_AUTHORIZATION_POLICY_FIELDS, 'execution_authorization_policy', errors);
  for (const field of ['authorization_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.authorization_policy_version) || policy.authorization_policy_version < 1) errors.push('authorization_policy_version_invalid');
  for (const field of [...ALLOW_FLAG_FIELDS, ...REQUIRE_FLAG_FIELDS, ...FAIL_ON_FLAG_FIELDS]) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(EXECUTION_AUTHORIZATION_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== EXECUTION_AUTHORIZATION_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionAuthorizationPolicy(input = {}) {
  const policy = {
    authorization_policy_id: input.authorization_policy_id,
    authorization_policy_version: Number.isInteger(input.authorization_policy_version) ? input.authorization_policy_version : 1,
    allow_authorized_simulation: input.allow_authorized_simulation !== false,
    allow_no_llm_plan: input.allow_no_llm_plan !== false,
    allow_model_plan: input.allow_model_plan !== false,
    allow_tool_references: input.allow_tool_references !== false,
    allow_workflow_reference: input.allow_workflow_reference !== false,
    allow_parallel_plan: input.allow_parallel_plan !== false,
    ...EXECUTION_AUTHORIZATION_POLICY_SAFE_FLAGS,
    validator_version: EXECUTION_AUTHORIZATION_POLICY_VALIDATOR_VERSION
  };

  const validation = validateExecutionAuthorizationPolicy(policy);
  if (!validation.valid) {
    throw new Error(`execution_authorization_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

module.exports = {
  ALLOW_FLAG_FIELDS,
  EXECUTION_AUTHORIZATION_POLICY_FIELDS,
  EXECUTION_AUTHORIZATION_POLICY_SAFE_FLAGS,
  EXECUTION_AUTHORIZATION_POLICY_VALIDATOR_VERSION,
  FAIL_ON_FLAG_FIELDS,
  REQUIRE_FLAG_FIELDS,
  buildExecutionAuthorizationPolicy,
  validateExecutionAuthorizationPolicy
};
