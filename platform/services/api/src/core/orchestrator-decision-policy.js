'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_DECISION_POLICY_VALIDATOR_VERSION = 'orchestrator_decision_policy_validator_v1';

const ORCHESTRATOR_DECISION_POLICY_FIELDS = Object.freeze([
  'decision_policy_id', 'decision_policy_version', 'allow_ready_simulation', 'allow_no_llm', 'allow_model_reference',
  'allow_tool_reference', 'allow_workflow_reference', 'allow_parallel_plan', 'allow_fallback_reference',
  'allow_escalation_reference', 'require_policy_validated', 'require_memory_preserved',
  'require_preferences_preserved', 'require_project_state_preserved', 'require_continuity_preserved',
  'require_context_planned', 'require_budget_validated', 'require_dependency_validation',
  'require_approval_for_high_risk', 'require_approval_for_critical_task', 'fail_on_any_blocker',
  'fail_on_unknown_status', 'fail_on_fingerprint_mismatch', 'fail_on_version_mismatch', 'simulation',
  'production_blocked', 'validator_version'
]);

const ALLOW_FLAG_FIELDS = Object.freeze([
  'allow_ready_simulation', 'allow_no_llm', 'allow_model_reference', 'allow_tool_reference',
  'allow_workflow_reference', 'allow_parallel_plan', 'allow_fallback_reference', 'allow_escalation_reference'
]);

const APPROVAL_FLAG_FIELDS = Object.freeze(['require_approval_for_high_risk', 'require_approval_for_critical_task']);

const ORCHESTRATOR_DECISION_POLICY_SAFE_FLAGS = Object.freeze({
  require_policy_validated: true,
  require_memory_preserved: true,
  require_preferences_preserved: true,
  require_project_state_preserved: true,
  require_continuity_preserved: true,
  require_context_planned: true,
  require_budget_validated: true,
  require_dependency_validation: true,
  fail_on_any_blocker: true,
  fail_on_unknown_status: true,
  fail_on_fingerprint_mismatch: true,
  fail_on_version_mismatch: true,
  simulation: true,
  production_blocked: true
});

function validateOrchestratorDecisionPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['decision_policy_must_be_object'] };
  exactFields(policy, ORCHESTRATOR_DECISION_POLICY_FIELDS, 'decision_policy', errors);
  for (const field of ['decision_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.decision_policy_version) || policy.decision_policy_version < 1) errors.push('decision_policy_version_invalid');
  for (const field of [...ALLOW_FLAG_FIELDS, ...APPROVAL_FLAG_FIELDS]) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(ORCHESTRATOR_DECISION_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== ORCHESTRATOR_DECISION_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  ALLOW_FLAG_FIELDS,
  APPROVAL_FLAG_FIELDS,
  ORCHESTRATOR_DECISION_POLICY_FIELDS,
  ORCHESTRATOR_DECISION_POLICY_SAFE_FLAGS,
  ORCHESTRATOR_DECISION_POLICY_VALIDATOR_VERSION,
  validateOrchestratorDecisionPolicy
};
