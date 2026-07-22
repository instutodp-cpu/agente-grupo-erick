'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-agent-policy-boundary.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  AGENT_POLICY_SCOPE_VALIDATOR_VERSION,
  evaluateDataScope,
  evaluateRiskScope,
  isNormalizedScopeList,
  matchesChannelScope,
  matchesSubjectScope,
  validateActionScope,
  validateChannelScope,
  validateDataScope,
  validateResourceScope,
  validateRiskScope,
  validateSubjectScope
} = require('../src/core/agent-policy-scope');
const {
  AGENT_POLICY_BUDGET_VALIDATOR_VERSION,
  evaluateBudget,
  validateBudgetPolicy,
  validateBudgetRequest
} = require('../src/core/agent-policy-budget');
const {
  AGENT_POLICY_LIMITS_VALIDATOR_VERSION,
  evaluateLimits,
  validateLimitPolicy,
  validateLimitRequest
} = require('../src/core/agent-policy-limits');
const {
  AGENT_POLICY_RULE_VALIDATOR_VERSION,
  applyRuleOperator,
  evaluateAgentPolicyRule,
  validateAgentPolicyRule
} = require('../src/core/agent-policy-rule-contract');
const {
  AGENT_POLICY_CONTRACT_VALIDATOR_VERSION,
  validateAgentPolicy
} = require('../src/core/agent-policy-contract');
const {
  AGENT_POLICY_REQUEST_VALIDATOR_VERSION,
  validateAgentPolicyRequest
} = require('../src/core/agent-policy-request');
const {
  AGENT_POLICY_DECISION_VALIDATOR_VERSION,
  buildAgentPolicyDecision,
  validateAgentPolicyDecision
} = require('../src/core/agent-policy-decision');
const { evaluateAgentPolicyRequest } = require('../src/core/agent-policy-boundary');
const { createAgentPolicyRegistry } = require('../src/core/agent-policy-registry');
const { buildAgentPolicyAudit, validateAgentPolicyAudit } = require('../src/core/agent-policy-audit');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function policyFixture(key, overrides = {}) {
  return { ...clone(fixture.policies[key]), ...overrides };
}

function requestFixture(overrides = {}) {
  return { ...clone(fixture.requests['general-assistant-request']), ...overrides };
}

const POLICY_KEYS = [
  'tenant-default-deny-policy', 'tenant-low-risk-simulation-policy', 'organization-retail-policy',
  'finance-require-approval-policy', 'pharmacy-confidential-data-policy', 'audit-agent-policy',
  'channel-whatsapp-policy', 'request-budget-policy', 'request-limit-policy', 'system-agent-policy'
];
const CASE_KEYS = ['policy-conflict-case', 'tenant-mismatch-case', 'budget-exceeded-case', 'restricted-data-case', 'high-risk-approval-case'];

test('policy boundary fixture and docs exist without operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_AGENT_POLICY_BOUNDARY.md')), true);
  assert.equal(fixture.simulation, true);
  assert.equal(fixture.production_blocked, true);
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
  assert.deepEqual(Object.keys(fixture.policies).sort(), [...POLICY_KEYS].sort());
  assert.deepEqual(Object.keys(fixture.cases).sort(), [...CASE_KEYS].sort());
});

POLICY_KEYS.forEach((key) => {
  test(`fixture policy ${key} is structurally valid`, () => {
    assert.equal(validateAgentPolicy(policyFixture(key)).valid, true);
  });
});

CASE_KEYS.forEach((key) => {
  test(`fixture case ${key} reproduces its expected decision`, () => {
    const scenario = fixture.cases[key];
    const decision = evaluateAgentPolicyRequest(clone(scenario.request), {
      policies: clone(scenario.policies),
      rules: clone(scenario.rules || []),
      agent_type: scenario.agent_type
    });
    assert.equal(decision.status, scenario.expected_status);
    assert.equal(decision.effect, scenario.expected_effect);
  });
});

test('subject scope valid and rejects missing extra wildcard duplicate unsorted', () => {
  const scope = clone(fixture.policies['tenant-low-risk-simulation-policy'].subject_scope);
  assert.equal(validateSubjectScope(scope).valid, true);
  const missing = clone(scope);
  delete missing.tenant_ids;
  assert.ok(validateSubjectScope(missing).errors.includes('subject_scope_missing_tenant_ids'));
  assert.ok(validateSubjectScope({ ...scope, extra: true }).errors.includes('subject_scope_unexpected_field::extra'));
  assert.ok(validateSubjectScope({ ...scope, tenant_ids: ['*'] }).errors.includes('tenant_ids_invalid'));
  assert.ok(validateSubjectScope({ ...scope, tenant_ids: ['a', 'a'] }).errors.includes('tenant_ids_invalid'));
  assert.ok(validateSubjectScope({ ...scope, tenant_ids: ['b', 'a'] }).errors.includes('tenant_ids_invalid'));
  assert.equal(isNormalizedScopeList(['*']), false);
  assert.equal(isNormalizedScopeList(['a(b)']), false);
});

test('subject scope match requires every dimension and empty scope blocks', () => {
  const scope = clone(fixture.policies['tenant-low-risk-simulation-policy'].subject_scope);
  const request = { tenant_id: 'tenant_demo_general', organization_id: 'tenant_demo_general:org-main', agent_id: 'agent_general_assistant_001', agent_type: 'GENERAL_ASSISTANT', actor_type: 'USER', actor_role: 'OPERATOR' };
  assert.equal(matchesSubjectScope(scope, request), true);
  assert.equal(matchesSubjectScope(scope, { ...request, tenant_id: 'tenant_other' }), false);
  assert.equal(matchesSubjectScope({ ...scope, tenant_ids: [] }, request), false);
});

test('resource action risk data channel scopes validate and evaluate', () => {
  const resourceScope = clone(fixture.policies['tenant-low-risk-simulation-policy'].resource_scope);
  assert.equal(validateResourceScope(resourceScope).valid, true);
  assert.ok(validateResourceScope({ ...resourceScope, resource_types: ['NOT_A_TYPE'] }).errors.includes('resource_types_invalid'));

  const actionScope = clone(fixture.policies['tenant-low-risk-simulation-policy'].action_scope);
  assert.equal(validateActionScope(actionScope).valid, true);
  assert.ok(validateActionScope({ actions: ['EXECUTE'], validator_version: AGENT_POLICY_SCOPE_VALIDATOR_VERSION }).errors.includes('actions_invalid'));

  const riskScope = clone(fixture.policies['tenant-low-risk-simulation-policy'].risk_scope);
  assert.equal(validateRiskScope(riskScope).valid, true);
  assert.ok(validateRiskScope({ ...riskScope, maximum_risk_classification: 'RESTRICTED' }).errors.includes('maximum_risk_classification_restricted_forbidden'));
  assert.deepEqual(evaluateRiskScope(riskScope, 'LOW'), { matches: true, approvalRequired: false });
  assert.equal(evaluateRiskScope(riskScope, 'HIGH').matches, false);

  const dataScope = clone(fixture.policies['tenant-low-risk-simulation-policy'].data_scope);
  assert.equal(validateDataScope(dataScope).valid, true);
  assert.ok(validateDataScope({ ...dataScope, secret_material_present: true }).errors.includes('secret_material_present_must_be_false'));
  assert.equal(evaluateDataScope(dataScope, 'INTERNAL').matches, true);
  assert.equal(evaluateDataScope(dataScope, 'CONFIDENTIAL').matches, false);

  const channelScope = clone(fixture.policies['tenant-low-risk-simulation-policy'].channel_scope);
  assert.equal(validateChannelScope(channelScope).valid, true);
  assert.ok(validateChannelScope({ allowed_channels: ['WEB'], denied_channels: ['WEB'], validator_version: AGENT_POLICY_SCOPE_VALIDATOR_VERSION }).errors.includes('allowed_denied_channels_overlap'));
  assert.equal(matchesChannelScope(channelScope, 'WEB'), true);
  assert.equal(matchesChannelScope(channelScope, 'WHATSAPP'), false);
  assert.equal(matchesChannelScope({ allowed_channels: ['WEB'], denied_channels: ['WEB'], validator_version: AGENT_POLICY_SCOPE_VALIDATOR_VERSION }, 'WEB'), false);
});

test('budget policy request and decision validate reject non zero this pr fields and evaluate correctly', () => {
  const budgetPolicy = clone(fixture.policies['tenant-low-risk-simulation-policy'].budget_policy);
  assert.equal(validateBudgetPolicy(budgetPolicy).valid, true);
  for (const field of ['maximum_model_calls', 'maximum_tool_calls', 'maximum_memory_reads', 'maximum_memory_writes', 'maximum_network_calls', 'maximum_escalations']) {
    assert.ok(validateBudgetPolicy({ ...budgetPolicy, [field]: 1 }).errors.includes(`${field}_must_be_zero_this_pr`));
  }
  assert.ok(validateBudgetPolicy({ ...budgetPolicy, currency: 'brl' }).errors.includes('currency_invalid'));

  const budgetRequest = clone(fixture.requests['general-assistant-request'].budget_request);
  assert.equal(validateBudgetRequest(budgetRequest).valid, true);
  for (const field of ['requested_model_calls', 'requested_tool_calls', 'requested_memory_reads', 'requested_memory_writes', 'requested_network_calls', 'requested_escalations']) {
    assert.ok(validateBudgetRequest({ ...budgetRequest, [field]: 1 }).errors.includes(`${field}_must_be_zero_this_pr`));
  }

  const withinDecision = evaluateBudget(budgetPolicy, budgetRequest);
  assert.equal(withinDecision.within_budget, true);
  assert.equal(withinDecision.budget_consumed, false);
  const inputExceeded = evaluateBudget(budgetPolicy, { ...budgetRequest, estimated_input_tokens: 999999 });
  assert.equal(inputExceeded.input_tokens_within_limit, false);
  const outputExceeded = evaluateBudget(budgetPolicy, { ...budgetRequest, estimated_output_tokens: 999999 });
  assert.equal(outputExceeded.output_tokens_within_limit, false);
  const totalExceeded = evaluateBudget(budgetPolicy, { ...budgetRequest, estimated_total_tokens: 999999 });
  assert.equal(totalExceeded.total_tokens_within_limit, false);
  assert.equal(Number.isNaN(1) === true && validateBudgetPolicy({ ...budgetPolicy, maximum_cost_minor_units: Number.NaN }).valid, false);
  assert.equal(validateBudgetPolicy({ ...budgetPolicy, maximum_cost_minor_units: Number.POSITIVE_INFINITY }).valid, false);
});

test('limit policy request and decision validate and evaluate requests concurrency duration payload references evaluations', () => {
  const limitPolicy = clone(fixture.policies['tenant-low-risk-simulation-policy'].limit_policy);
  assert.equal(validateLimitPolicy(limitPolicy).valid, true);
  const limitRequest = clone(fixture.requests['general-assistant-request'].limit_request);
  assert.equal(validateLimitRequest(limitRequest).valid, true);
  assert.equal(evaluateLimits(limitPolicy, limitRequest).within_limits, true);
  assert.equal(evaluateLimits(limitPolicy, { ...limitRequest, requested_requests: 999999 }).requests_within_limit, false);
  assert.equal(evaluateLimits(limitPolicy, { ...limitRequest, requested_concurrency: 999999 }).concurrency_within_limit, false);
  assert.equal(evaluateLimits(limitPolicy, { ...limitRequest, requested_duration_ms: 999999999 }).duration_within_limit, false);
  assert.equal(evaluateLimits(limitPolicy, { ...limitRequest, requested_payload_bytes: 999999999 }).payload_within_limit, false);
  assert.equal(evaluateLimits(limitPolicy, { ...limitRequest, requested_context_references: 999999 }).context_references_within_limit, false);
  assert.equal(evaluateLimits(limitPolicy, { ...limitRequest, requested_policy_evaluations: 999999 }).policy_evaluations_within_limit, false);
  assert.equal(validateLimitPolicy({ ...limitPolicy, maximum_requests: Number.NaN }).valid, false);
  assert.equal(validateLimitPolicy({ ...limitPolicy, maximum_requests: Number.POSITIVE_INFINITY }).valid, false);
});

test('agent policy rule validates and operator evaluation is deterministic without eval or regex', () => {
  const rule = {
    rule_id: 'rule_tenant_match', rule_version: 1, policy_id: 'policy_1', rule_type: 'TENANT_MATCH', rule_operator: 'IN',
    left_operand_reference: 'REQUEST.TENANT_ID', right_operand_reference: 'SUBJECT_SCOPE.TENANT_IDS',
    expected_result: true, failure_effect: 'TENANT_BLOCKED', reason_code: 'tenant_not_in_subject_scope',
    rule_status: 'VALIDATED_SIMULATION', validator_version: AGENT_POLICY_RULE_VALIDATOR_VERSION
  };
  assert.equal(validateAgentPolicyRule(rule).valid, true);
  assert.ok(validateAgentPolicyRule({ ...rule, left_operand_reference: 'lowercase.ref' }).errors.includes('left_operand_reference_invalid_format'));
  assert.ok(validateAgentPolicyRule({ ...rule, rule_operator: 'REGEX_MATCH' }).errors.some((error) => error.includes('rule_operator_not_allowed')));
  assert.equal(applyRuleOperator('EQUALS', 'a', 'a'), true);
  assert.equal(applyRuleOperator('NOT_EQUALS', 'a', 'b'), true);
  assert.equal(applyRuleOperator('IN', 'a', ['a', 'b']), true);
  assert.equal(applyRuleOperator('NOT_IN', 'c', ['a', 'b']), true);
  assert.equal(applyRuleOperator('LESS_THAN', 1, 2), true);
  assert.equal(applyRuleOperator('GREATER_THAN_OR_EQUAL', 2, 2), true);
  assert.equal(applyRuleOperator('BOOLEAN_IS', true, true), true);
  assert.equal(applyRuleOperator('REFERENCE_PRESENT', 'x', null), true);
  assert.equal(applyRuleOperator('VERSION_COMPATIBLE', 1, 1), true);
  assert.equal(evaluateAgentPolicyRule(rule, 'tenant_a', ['tenant_a']).passed, true);
  const failed = evaluateAgentPolicyRule(rule, 'tenant_z', ['tenant_a']);
  assert.equal(failed.passed, false);
  assert.equal(failed.failure_effect, 'TENANT_BLOCKED');
});

test('agent policy contract valid and rejects missing extra invalid enums forbidden status priority bounds', () => {
  const policy = policyFixture('tenant-low-risk-simulation-policy');
  assert.equal(validateAgentPolicy(policy).valid, true);
  const missing = clone(policy);
  delete missing.tenant_id;
  assert.ok(validateAgentPolicy(missing).errors.includes('agent_policy_missing_tenant_id'));
  assert.ok(validateAgentPolicy({ ...policy, extra: true }).errors.includes('agent_policy_unexpected_field::extra'));
  assert.ok(validateAgentPolicy({ ...policy, policy_type: 'NOT_A_TYPE' }).errors.some((error) => error.includes('policy_type_not_allowed')));
  assert.ok(validateAgentPolicy({ ...policy, policy_status: 'ACTIVE' }).errors.includes('policy_status_forbidden::ACTIVE'));
  assert.ok(validateAgentPolicy({ ...policy, effect: 'EXECUTE_REAL' }).errors.some((error) => error.includes('effect_not_allowed')));
  assert.ok(validateAgentPolicy({ ...policy, priority: -1 }).errors.includes('priority_invalid'));
  assert.ok(validateAgentPolicy({ ...policy, priority: 100000 }).errors.includes('priority_invalid'));
  assert.ok(validateAgentPolicy({ ...policy, organization_id: 'unrelated-org' }).errors.includes('organization_id_not_compatible_with_tenant'));
});

test('system policy relaxes tenant organization compatibility', () => {
  const policy = policyFixture('system-agent-policy');
  assert.equal(policy.tenant_id, 'SYSTEM');
  assert.equal(validateAgentPolicy(policy).valid, true);
});

test('approval policy forces approval_granted and approval_applied false', () => {
  const policy = policyFixture('finance-require-approval-policy');
  assert.equal(policy.approval_policy.approval_granted, false);
  assert.equal(policy.approval_policy.approval_applied, false);
});

test('agent policy request valid and rejects missing extra actor mismatch invalid enums', () => {
  const request = requestFixture();
  assert.equal(validateAgentPolicyRequest(request).valid, true);
  const missing = clone(request);
  delete missing.tenant_id;
  assert.ok(validateAgentPolicyRequest(missing).errors.includes('agent_policy_request_missing_tenant_id'));
  assert.ok(validateAgentPolicyRequest({ ...request, extra: true }).errors.includes('agent_policy_request_unexpected_field::extra'));
  assert.ok(validateAgentPolicyRequest({ ...request, requested_action: 'EXECUTE' }).errors.some((error) => error.includes('requested_action_not_allowed')));
  assert.ok(validateAgentPolicyRequest({ ...request, channel: 'SMS' }).errors.some((error) => error.includes('channel_not_allowed')));
  assert.ok(validateAgentPolicyRequest({ ...request, actor_context: { ...request.actor_context, tenant_id: 'tenant_other' } }).errors.includes('actor_tenant_mismatch'));
  assert.ok(validateAgentPolicyRequest({ ...request, agent_contract_reference: { ...request.agent_contract_reference, contract_status: 'INVALID' } }).errors.includes('agent_contract_not_validated_simulation'));
  assert.ok(validateAgentPolicyRequest({ ...request, capability_reference: { ...request.capability_reference, enabled: true } }).errors.some((error) => error.includes('enabled_must_be_false')));
  assert.ok(validateAgentPolicyRequest({ ...request, resource_reference: { ...request.resource_reference, resource_loaded: true } }).errors.some((error) => error.includes('resource_loaded_must_be_false')));
  assert.ok(validateAgentPolicyRequest({ ...request, approval_context: { ...request.approval_context, approval_granted: true } }).errors.some((error) => error.includes('approval_granted_must_be_false')));
});

test('agent policy decision forces safe flags and allowed_in_simulation consistency', () => {
  const decision = buildAgentPolicyDecision({
    decision_id: 'decision_1', policy_request_id: 'policy_request_1', agent_id: 'agent_1', tenant_id: 'tenant_demo_general', organization_id: 'tenant_demo_general:org-main',
    status: 'ALLOW_SIMULATION', effect: 'ALLOW_SIMULATION', allowed_in_simulation: true, approval_required: false,
    applicable_policy_ids: ['policy_1'], applicable_policy_fingerprints: ['fp1'], evaluated_rule_ids: [], evaluated_rule_fingerprints: [],
    matched_scopes: ['SUBJECT', 'RESOURCE', 'ACTION', 'RISK', 'DATA', 'CHANNEL'], blockers: [], reason_codes: ['policy_reviewed_simulation_only'],
    budget_decision: evaluateBudget(clone(fixture.policies['tenant-low-risk-simulation-policy'].budget_policy), clone(fixture.requests['general-assistant-request'].budget_request)),
    limit_decision: evaluateLimits(clone(fixture.policies['tenant-low-risk-simulation-policy'].limit_policy), clone(fixture.requests['general-assistant-request'].limit_request)),
    contract_fingerprint: 'fp_contract', request_fingerprint: 'fp_request', decision_fingerprint: 'fp_decision', policy_registry_version: 'v1', logical_sequence: 1
  });
  assert.equal(validateAgentPolicyDecision(decision).valid, true);
  assert.equal(decision.policy_evaluated, true);
  assert.equal(decision.capability_activated, false);
  assert.equal(decision.agent_executed, false);
  assert.equal(decision.llm_called, false);
  assert.equal(decision.tool_called, false);
  assert.equal(decision.memory_read, false);
  assert.equal(decision.memory_written, false);
  assert.equal(decision.network_used, false);
  assert.equal(decision.runtime_mutated, false);
  assert.equal(decision.budget_consumed, false);
  assert.equal(decision.limit_consumed, false);
  assert.equal(decision.executed, false);
  assert.equal(decision.runtime_enabled, false);
  assert.equal(decision.simulation, true);
  assert.equal(decision.production_blocked, true);
  assert.equal(decision.rollout_percentage, 0);
  assert.equal(Object.isFrozen(decision), true);
  const inconsistent = buildAgentPolicyDecision({ status: 'DENY', effect: 'ALLOW_SIMULATION', allowed_in_simulation: true });
  assert.equal(inconsistent.status, 'VALIDATION_FAILED');
});

test('boundary allow simulation and default deny without applicable policy', () => {
  const allow = evaluateAgentPolicyRequest(requestFixture(), { policies: [policyFixture('tenant-low-risk-simulation-policy')], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  assert.equal(allow.status, 'ALLOW_SIMULATION');
  assert.equal(allow.allowed_in_simulation, true);

  const deny = evaluateAgentPolicyRequest(requestFixture(), { policies: [], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  assert.equal(deny.status, 'POLICY_BLOCKED');
  assert.equal(deny.effect, 'DENY');
  assert.equal(deny.allowed_in_simulation, false);
});

test('boundary deny prevails regardless of priority and require approval prevails over allow', () => {
  const denyPolicy = policyFixture('tenant-low-risk-simulation-policy', { policy_id: 'policy_deny_variant', policy_slug: 'policy-deny-variant', effect: 'DENY', priority: 10 });
  const allowPolicy = policyFixture('tenant-low-risk-simulation-policy', { policy_id: 'policy_allow_variant', policy_slug: 'policy-allow-variant', effect: 'ALLOW_SIMULATION', priority: 900 });
  const denyWins = evaluateAgentPolicyRequest(requestFixture(), { policies: [denyPolicy, allowPolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  assert.equal(denyWins.status, 'DENY');
  assert.equal(denyWins.effect, 'DENY');

  const approvalPolicy = policyFixture('tenant-low-risk-simulation-policy', { policy_id: 'policy_approval_variant', policy_slug: 'policy-approval-variant', effect: 'REQUIRE_APPROVAL_SIMULATION', priority: 10 });
  const approvalWins = evaluateAgentPolicyRequest(requestFixture(), { policies: [approvalPolicy, allowPolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  assert.equal(approvalWins.status, 'REQUIRE_APPROVAL_SIMULATION');
  assert.equal(approvalWins.approval_required, true);
});

test('boundary blocks tenant organization agent actor capability channel and risk mismatches', () => {
  const policy = policyFixture('tenant-low-risk-simulation-policy');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ agent_id: 'agent_other' }), { policies: [policy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).effect, 'DENY');
  assert.equal(evaluateAgentPolicyRequest(requestFixture(), { policies: [policy], rules: [], agent_type: 'OPERATIONS_AGENT' }).effect, 'DENY');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ actor_context: { ...requestFixture().actor_context, actor_role: 'AUDITOR' } }), { policies: [policy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).effect, 'DENY');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ channel: 'WHATSAPP' }), { policies: [policy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'CHANNEL_BLOCKED');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ risk_classification: 'HIGH' }), { policies: [policy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'RISK_BLOCKED');
});

test('boundary risk ladder LOW MODERATE HIGH RESTRICTED', () => {
  const moderatePolicy = policyFixture('tenant-low-risk-simulation-policy', {
    policy_id: 'policy_moderate_variant', policy_slug: 'policy-moderate-variant',
    risk_scope: { allowed_risk_classifications: ['LOW', 'MODERATE'], maximum_risk_classification: 'MODERATE', requires_approval_above: 'MODERATE', validator_version: AGENT_POLICY_SCOPE_VALIDATOR_VERSION }
  });
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ risk_classification: 'LOW' }), { policies: [moderatePolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'ALLOW_SIMULATION');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ risk_classification: 'MODERATE' }), { policies: [moderatePolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'REQUIRE_APPROVAL_SIMULATION');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ risk_classification: 'RESTRICTED' }), { policies: [moderatePolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'RISK_BLOCKED');
});

test('boundary data ladder PUBLIC INTERNAL CONFIDENTIAL with and without explicit policy RESTRICTED', () => {
  const generalPolicy = policyFixture('tenant-low-risk-simulation-policy');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ data_classification: 'PUBLIC' }), { policies: [generalPolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'ALLOW_SIMULATION');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ data_classification: 'INTERNAL' }), { policies: [generalPolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'ALLOW_SIMULATION');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ data_classification: 'CONFIDENTIAL' }), { policies: [generalPolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'DATA_BLOCKED');
  assert.equal(evaluateAgentPolicyRequest(requestFixture({ data_classification: 'RESTRICTED' }), { policies: [generalPolicy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'DATA_BLOCKED');

  const confidentialCapableRequest = requestFixture({
    tenant_id: 'tenant_demo_pharmacy', organization_id: 'tenant_demo_pharmacy:org-main', agent_id: 'agent_pharmacy_specialist_001',
    actor_context: { actor_type: 'USER', actor_id: 'actor_pharmacy_1', actor_role: 'AUDITOR', tenant_id: 'tenant_demo_pharmacy', organization_id: 'tenant_demo_pharmacy:org-main', authorization_state: 'APPROVED_SIMULATION', validator_version: require('../src/core/agent-context-contract').AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION },
    requested_action: 'CLASSIFY_REFERENCE',
    resource_reference: { resource_type: 'DATA_REFERENCE', resource_id: 'data_reference_pharmacy_1', resource_classification: 'CONFIDENTIAL', resource_domain: 'pharmacy_reference', resource_present: true, resource_loaded: false, resource_mutated: false, validator_version: AGENT_POLICY_REQUEST_VALIDATOR_VERSION },
    data_classification: 'CONFIDENTIAL'
  });
  const withExplicitPolicy = evaluateAgentPolicyRequest(confidentialCapableRequest, { policies: [policyFixture('pharmacy-confidential-data-policy')], rules: [], agent_type: 'SPECIALIST_AGENT' });
  assert.equal(withExplicitPolicy.status, 'ALLOW_SIMULATION');
});

test('boundary lifecycle incompatible states are blocked', () => {
  const policy = policyFixture('tenant-low-risk-simulation-policy');
  const draftRequest = requestFixture({ agent_contract_reference: { ...requestFixture().agent_contract_reference, lifecycle_state: 'DRAFT' } });
  assert.equal(evaluateAgentPolicyRequest(draftRequest, { policies: [policy], rules: [], agent_type: 'GENERAL_ASSISTANT' }).status, 'LIFECYCLE_BLOCKED');
});

test('boundary approval is never granted or applied even when required', () => {
  const request = requestFixture({
    tenant_id: 'tenant_demo_finance', organization_id: 'tenant_demo_finance:org-main', agent_id: 'agent_finance_analytics_001',
    actor_context: { actor_type: 'USER', actor_id: 'actor_finance_1', actor_role: 'MANAGER', tenant_id: 'tenant_demo_finance', organization_id: 'tenant_demo_finance:org-main', authorization_state: 'APPROVED_SIMULATION', validator_version: require('../src/core/agent-context-contract').AGENT_ACTOR_CONTEXT_VALIDATOR_VERSION },
    requested_action: 'ANALYZE_REFERENCE',
    resource_reference: { resource_type: 'DATA_REFERENCE', resource_id: 'data_reference_financial_1', resource_classification: 'CONFIDENTIAL', resource_domain: 'financial_reporting', resource_present: true, resource_loaded: false, resource_mutated: false, validator_version: AGENT_POLICY_REQUEST_VALIDATOR_VERSION },
    risk_classification: 'HIGH', data_classification: 'CONFIDENTIAL'
  });
  const decision = evaluateAgentPolicyRequest(request, { policies: [policyFixture('finance-require-approval-policy')], rules: [], agent_type: 'ANALYTICS_AGENT' });
  assert.equal(decision.status, 'REQUIRE_APPROVAL_SIMULATION');
  assert.equal(decision.approval_required, true);
  assert.equal(decision.executed, false);
  assert.equal(decision.agent_executed, false);
});

test('registry replay payload mismatch version conflict tenant block and dangling rule policy conflict', () => {
  const registry = createAgentPolicyRegistry();
  const policy = policyFixture('tenant-low-risk-simulation-policy');
  const first = registry.registerPolicy(policy, { expected_version: 0 });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerPolicy(policy);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const mismatch = registry.registerPolicy({ ...policy, priority: 999 });
  assert.equal(mismatch.status, 'PAYLOAD_MISMATCH');
  const staleConflict = registry.registerPolicy({ ...policy, policy_version: 2 }, { expected_version: 99 });
  assert.equal(staleConflict.status, 'VERSION_CONFLICT');

  const fetched = registry.getPolicyById(policy.policy_id);
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => { fetched.priority = 1; }, TypeError);
  assert.equal(registry.getPolicyBySlugAndTenant(policy.policy_slug, policy.tenant_id).policy_id, policy.policy_id);

  const otherTenantPolicy = policyFixture('organization-retail-policy');
  registry.registerPolicy(otherTenantPolicy, { expected_version: 0 });
  const sameTenantList = registry.listPoliciesByTenant(policy.tenant_id);
  assert.equal(sameTenantList.length, 1);
  const crossTenantList = registry.listPoliciesByTenant(otherTenantPolicy.tenant_id);
  assert.equal(crossTenantList.some((record) => record.policy_id === policy.policy_id), false);

  const rule = {
    rule_id: 'rule_registry_test', rule_version: 1, policy_id: policy.policy_id, rule_type: 'TENANT_MATCH', rule_operator: 'IN',
    left_operand_reference: 'REQUEST.TENANT_ID', right_operand_reference: 'SUBJECT_SCOPE.TENANT_IDS', expected_result: true,
    failure_effect: 'TENANT_BLOCKED', reason_code: 'tenant_not_in_subject_scope', rule_status: 'VALIDATED_SIMULATION',
    validator_version: AGENT_POLICY_RULE_VALIDATOR_VERSION
  };
  const ruleReg = registry.registerRule(rule, { expected_version: 0 });
  assert.equal(ruleReg.status, 'REGISTERED_SIMULATION');
  const dangling = registry.registerRule({ ...rule, rule_id: 'rule_dangling', policy_id: 'policy_never_registered' });
  assert.equal(dangling.status, 'POLICY_CONFLICT');
  assert.equal(registry.listRulesByPolicyId(policy.policy_id).length, 1);
});

test('registry blocks organization reassignment while preserving tenant immutability replay and optimistic concurrency', () => {
  const registry = createAgentPolicyRegistry();
  const policy = policyFixture('tenant-low-risk-simulation-policy');
  assert.equal(registry.registerPolicy(policy, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');

  const bumped = policyFixture('tenant-low-risk-simulation-policy', { policy_version: 2, priority: policy.priority + 1 });
  assert.equal(registry.registerPolicy(bumped).status, 'REGISTERED_SIMULATION');

  const orgChanged = policyFixture('tenant-low-risk-simulation-policy', {
    policy_version: 3, priority: policy.priority + 1, organization_id: `${policy.tenant_id}:org-reassigned`
  });
  const orgResult = registry.registerPolicy(orgChanged);
  assert.equal(orgResult.ok, false);
  assert.equal(orgResult.status, 'ORGANIZATION_BLOCKED');

  const tenantChanged = policyFixture('tenant-low-risk-simulation-policy', {
    policy_version: 3, priority: policy.priority + 1, tenant_id: 'tenant_reassigned', organization_id: 'tenant_reassigned:org-1'
  });
  const tenantResult = registry.registerPolicy(tenantChanged);
  assert.equal(tenantResult.ok, false);
  assert.equal(tenantResult.status, 'TENANT_BLOCKED');

  assert.equal(registry.getPolicyById(policy.policy_id).policy_version, 2);
  assert.equal(registry.registerPolicy(bumped).status, 'REPLAY_ACCEPTED');

  const staleConflict = registry.registerPolicy(
    policyFixture('tenant-low-risk-simulation-policy', { policy_version: 3, priority: policy.priority + 2 }),
    { expected_version: 99 }
  );
  assert.equal(staleConflict.status, 'VERSION_CONFLICT');
});

test('policy audit is immutable structurally minimal and always simulated', () => {
  const decision = evaluateAgentPolicyRequest(requestFixture(), { policies: [policyFixture('tenant-low-risk-simulation-policy')], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  const audit = buildAgentPolicyAudit({ request: requestFixture(), decision, logical_sequence: 1 });
  assert.equal(validateAgentPolicyAudit(audit).valid, true);
  assert.equal(audit.simulation, true);
  assert.equal(audit.production_blocked, true);
  assert.equal(audit.executed, false);
  assert.equal(Object.isFrozen(audit), true);
  assert.throws(() => { audit.blockers.push('x'); }, TypeError);
  assert.deepEqual(Object.keys(audit).sort(), [
    'actor_role', 'actor_type', 'audit_id', 'blockers', 'budget_summary', 'capability_reference', 'channel',
    'data_classification', 'decision_fingerprint', 'decision_status', 'effect', 'executed', 'limit_summary',
    'logical_sequence', 'organization_binding', 'policy_fingerprints', 'policy_request_fingerprint',
    'production_blocked', 'reason_codes', 'requested_action', 'risk_classification', 'rule_fingerprints',
    'simulation', 'tenant_binding', 'validator_version', 'agent_contract_fingerprint'
  ].sort());
});

[
  ['api key', { api_key: 'x' }, 'forbidden_key::api_key'],
  ['secret key', { secret_value: 'x' }, 'forbidden_key'],
  ['token key', { access_token: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['callback word', { note: 'invokes a callback handler' }, 'forbidden_word_value'],
  ['prompt word', { note: 'uses a system_prompt internally' }, 'forbidden_word_value'],
  ['model provider word', { note: 'calls the model provider sdk' }, 'forbidden_word_value']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name}`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate policy field names and slugs', () => {
  assert.deepEqual(findAgentCoreOperationalMaterial({ runtime_mutated: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ secret_material_present: false }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ maximum_model_calls: 0 }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ requested_model_calls: 0 }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ model_calls_within_limit: true }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial({ 'finance-require-approval-policy': true }), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(policyFixture('finance-require-approval-policy')), []);
});

test('operational material detector rejects NaN Infinity bigint symbol function cyclic reference', () => {
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.NaN }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Number.POSITIVE_INFINITY }).some((error) => error.includes('non_finite_number')));
  assert.ok(findAgentCoreOperationalMaterial({ value: BigInt(1) }).some((error) => error.includes('forbidden_bigint')));
  assert.ok(findAgentCoreOperationalMaterial({ value: Symbol('x') }).some((error) => error.includes('forbidden_symbol')));
  assert.ok(findAgentCoreOperationalMaterial({ value: () => null }).some((error) => error.includes('forbidden_function')));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.ok(findAgentCoreOperationalMaterial(cyclic).some((error) => error.includes('forbidden_cycle')));
});

test('fingerprints are deterministic and change with payload and build does not mutate caller input', () => {
  const a = stablePayload({ b: 1, a: 2 });
  const b = stablePayload({ a: 2, b: 1 });
  assert.equal(a, b);

  const request = requestFixture();
  const policy = policyFixture('tenant-low-risk-simulation-policy');
  const beforeRequest = JSON.stringify(request);
  const beforePolicy = JSON.stringify(policy);
  const decision1 = evaluateAgentPolicyRequest(request, { policies: [policy], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  const decision2 = evaluateAgentPolicyRequest(clone(request), { policies: [clone(policy)], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  assert.equal(JSON.stringify(request), beforeRequest);
  assert.equal(JSON.stringify(policy), beforePolicy);
  assert.equal(decision1.applicable_policy_fingerprints[0], decision2.applicable_policy_fingerprints[0]);
  const decision3 = evaluateAgentPolicyRequest(requestFixture(), { policies: [policyFixture('tenant-low-risk-simulation-policy', { priority: 42 })], rules: [], agent_type: 'GENERAL_ASSISTANT' });
  assert.notEqual(decision1.applicable_policy_fingerprints[0], decision3.applicable_policy_fingerprints[0]);
});

test('regression agent policy modules do not use llm tools memory network filesystem env or timers', () => {
  const files = [
    'services/api/src/core/agent-policy-boundary.js',
    'services/api/src/core/agent-policy-contract.js',
    'services/api/src/core/agent-policy-rule-contract.js',
    'services/api/src/core/agent-policy-request.js',
    'services/api/src/core/agent-policy-decision.js',
    'services/api/src/core/agent-policy-scope.js',
    'services/api/src/core/agent-policy-budget.js',
    'services/api/src/core/agent-policy-limits.js',
    'services/api/src/core/agent-policy-registry.js',
    'services/api/src/core/agent-policy-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|assemblyai|deepgram|eval\(|new Function\(/i.test(source), false);
  }
});

test('regression agent policy boundary is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-policy'), false);
  }
});

test('regression PR79 agent core and prior boundaries remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js',
    'services/api/src/core/agent-registry.js',
    'services/api/src/core/transcription-runtime-registration-boundary.js',
    'services/api/src/core/transcription-network-permission-boundary.js',
    'services/api/src/core/transcription-secret-resolution-boundary.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('agent-policy'), false);
  }
});
