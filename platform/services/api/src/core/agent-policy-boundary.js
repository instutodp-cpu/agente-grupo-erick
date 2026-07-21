'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { AGENT_TYPES, stablePayload } = require('./agent-identity-contract');
const { AGENT_LIFECYCLE_STATES } = require('./agent-lifecycle-contract');
const { validateAgentPolicy } = require('./agent-policy-contract');
const { validateAgentPolicyRequest } = require('./agent-policy-request');
const {
  evaluateAgentPolicyRule,
  validateAgentPolicyRule
} = require('./agent-policy-rule-contract');
const {
  evaluateDataScope,
  evaluateRiskScope,
  matchesActionScope,
  matchesChannelScope,
  matchesResourceScope,
  matchesSubjectScope
} = require('./agent-policy-scope');
const { evaluateBudget } = require('./agent-policy-budget');
const { evaluateLimits } = require('./agent-policy-limits');
const { buildAgentPolicyDecision } = require('./agent-policy-decision');

const AGENT_POLICY_BOUNDARY_VALIDATOR_VERSION = 'agent_policy_boundary_validator_v1';
const LIFECYCLE_COMPATIBLE_STATES = Object.freeze(['VALIDATED', 'REGISTERED_SIMULATION']);
const EFFECT_SEVERITY = Object.freeze({ DENY: 0, REQUIRE_APPROVAL_SIMULATION: 1, ALLOW_SIMULATION: 2 });

function moreRestrictiveEffect(a, b) {
  return EFFECT_SEVERITY[a] <= EFFECT_SEVERITY[b] ? a : b;
}

function safeFingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function finalizeDecision(request, overrides) {
  const requestFingerprint = isPlainObject(request) ? safeFingerprint(request) : 'invalid_request';
  const contractFingerprint = isPlainObject(request) && isPlainObject(request.agent_contract_reference)
    ? (request.agent_contract_reference.contract_fingerprint || 'contract_fingerprint_not_available')
    : 'contract_fingerprint_not_available';
  const base = {
    policy_request_id: isPlainObject(request) ? request.policy_request_id : 'policy_request_not_available',
    agent_id: isPlainObject(request) ? request.agent_id : 'agent_not_available',
    tenant_id: isPlainObject(request) ? request.tenant_id : 'tenant_not_available',
    organization_id: isPlainObject(request) ? request.organization_id : 'organization_not_available',
    contract_fingerprint: contractFingerprint,
    request_fingerprint: requestFingerprint,
    logical_sequence: isPlainObject(request) && Number.isInteger(request.logical_sequence) ? request.logical_sequence : 1,
    policy_registry_version: AGENT_POLICY_BOUNDARY_VALIDATOR_VERSION,
    ...overrides
  };
  const decisionFingerprint = safeFingerprint({ ...base, decision_fingerprint: undefined });
  return buildAgentPolicyDecision({ ...base, decision_fingerprint: decisionFingerprint });
}

function blockedDecision(request, status, reasonCodes, extra = {}) {
  return finalizeDecision(request, {
    status,
    effect: 'DENY',
    allowed_in_simulation: false,
    approval_required: false,
    applicable_policy_ids: [],
    applicable_policy_fingerprints: [],
    evaluated_rule_ids: [],
    evaluated_rule_fingerprints: [],
    matched_scopes: [],
    blockers: uniqueSorted(reasonCodes),
    reason_codes: uniqueSorted(reasonCodes),
    budget_decision: {
      within_budget: false, cost_within_limit: false, input_tokens_within_limit: false, output_tokens_within_limit: false,
      total_tokens_within_limit: false, model_calls_within_limit: false, tool_calls_within_limit: false,
      memory_reads_within_limit: false, memory_writes_within_limit: false, network_calls_within_limit: false,
      escalations_within_limit: false, budget_consumed: false, reason_codes: ['budget_not_evaluated'],
      validator_version: 'agent_policy_budget_validator_v1'
    },
    limit_decision: {
      within_limits: false, requests_within_limit: false, concurrency_within_limit: false, duration_within_limit: false,
      payload_within_limit: false, context_references_within_limit: false, dependency_references_within_limit: false,
      policy_evaluations_within_limit: false, limit_consumed: false, reason_codes: ['limit_not_evaluated'],
      validator_version: 'agent_policy_limits_validator_v1'
    },
    ...extra
  });
}

function evaluateAgentPolicyRequest(request, context = {}) {
  const policies = Array.isArray(context.policies) ? context.policies : [];
  const rules = Array.isArray(context.rules) ? context.rules : [];
  const agentType = context.agent_type;

  const requestValidation = validateAgentPolicyRequest(request);
  if (!requestValidation.valid) {
    return blockedDecision(request, 'VALIDATION_FAILED', requestValidation.errors);
  }
  if (!AGENT_TYPES.includes(agentType)) {
    return blockedDecision(request, 'VALIDATION_FAILED', ['agent_type_not_provided']);
  }
  if (request.tenant_id !== 'SYSTEM' && !request.organization_id.startsWith(`${request.tenant_id}:`)) {
    return blockedDecision(request, 'ORGANIZATION_BLOCKED', ['organization_not_compatible_with_tenant']);
  }
  if (request.risk_classification === 'RESTRICTED') {
    return blockedDecision(request, 'RISK_BLOCKED', ['risk_restricted_always_denied']);
  }
  if (request.data_classification === 'RESTRICTED') {
    return blockedDecision(request, 'DATA_BLOCKED', ['data_restricted_always_denied']);
  }
  if (!LIFECYCLE_COMPATIBLE_STATES.includes(request.agent_contract_reference.lifecycle_state)) {
    return blockedDecision(request, 'LIFECYCLE_BLOCKED', ['lifecycle_state_incompatible_with_policy_evaluation']);
  }

  const eligiblePolicies = policies.filter((policy) => (
    validateAgentPolicy(policy).valid &&
    policy.policy_status === 'VALIDATED_SIMULATION' &&
    policy.tenant_id === request.tenant_id
  ));

  if (eligiblePolicies.length === 0) {
    return blockedDecision(request, 'POLICY_BLOCKED', ['no_applicable_policy_default_deny']);
  }

  const byId = new Map();
  for (const policy of eligiblePolicies) {
    const fingerprint = safeFingerprint(policy);
    if (byId.has(policy.policy_id) && byId.get(policy.policy_id).fingerprint !== fingerprint) {
      return blockedDecision(request, 'CONFLICT_BLOCKED', [`policy_conflict::${policy.policy_id}`]);
    }
    byId.set(policy.policy_id, { policy, fingerprint });
  }

  const evaluations = eligiblePolicies.map((policy) => {
    const subjectMatch = matchesSubjectScope(policy.subject_scope, {
      tenant_id: request.tenant_id,
      organization_id: request.organization_id,
      agent_id: request.agent_id,
      agent_type: agentType,
      actor_type: request.actor_context.actor_type,
      actor_role: request.actor_context.actor_role
    });
    const resourceMatch = matchesResourceScope(policy.resource_scope, request.resource_reference);
    const actionMatch = matchesActionScope(policy.action_scope, request.requested_action);
    const riskEval = evaluateRiskScope(policy.risk_scope, request.risk_classification);
    const dataEval = evaluateDataScope(policy.data_scope, request.data_classification);
    const channelMatch = matchesChannelScope(policy.channel_scope, request.channel);
    const fullyMatches = subjectMatch && resourceMatch && actionMatch && riskEval.matches && dataEval.matches && channelMatch;
    return { policy, subjectMatch, resourceMatch, actionMatch, riskEval, dataEval, channelMatch, fullyMatches };
  });

  const matched = evaluations.filter((entry) => entry.fullyMatches);
  if (matched.length === 0) {
    const reasonCodes = [];
    if (evaluations.every((entry) => !entry.subjectMatch)) reasonCodes.push('subject_scope_no_match');
    if (evaluations.every((entry) => !entry.resourceMatch)) reasonCodes.push('resource_scope_no_match');
    if (evaluations.every((entry) => !entry.actionMatch)) reasonCodes.push('action_scope_no_match');
    if (evaluations.every((entry) => !entry.riskEval.matches)) reasonCodes.push('risk_scope_no_match');
    if (evaluations.every((entry) => !entry.dataEval.matches)) reasonCodes.push('data_scope_no_match');
    if (evaluations.every((entry) => !entry.channelMatch)) reasonCodes.push('channel_scope_no_match');
    if (reasonCodes.length === 0) reasonCodes.push('no_applicable_policy_default_deny');
    const status = reasonCodes.includes('channel_scope_no_match') ? 'CHANNEL_BLOCKED'
      : reasonCodes.includes('risk_scope_no_match') ? 'RISK_BLOCKED'
        : reasonCodes.includes('data_scope_no_match') ? 'DATA_BLOCKED'
          : 'POLICY_BLOCKED';
    return blockedDecision(request, status, reasonCodes);
  }

  const matchedRules = rules.filter((rule) => matched.some((entry) => entry.policy.policy_id === rule.policy_id));
  const evaluatedRuleIds = [];
  const evaluatedRuleFingerprints = [];
  const ruleBlockers = [];
  let ruleForcedEffect = null;
  for (const rule of matchedRules) {
    const ruleValidation = validateAgentPolicyRule(rule);
    if (!ruleValidation.valid || rule.rule_status !== 'VALIDATED_SIMULATION') continue;
    evaluatedRuleIds.push(rule.rule_id);
    evaluatedRuleFingerprints.push(safeFingerprint(rule));
    if (rule.rule_type === 'SIMULATION_REQUIRED') {
      const outcome = evaluateAgentPolicyRule(rule, request.simulation_context.simulation, true);
      if (!outcome.passed) {
        ruleBlockers.push(outcome.reason_code || 'simulation_required_rule_failed');
        ruleForcedEffect = 'DENY';
      }
    }
    if (rule.rule_type === 'PRODUCTION_BLOCKED_REQUIRED') {
      const outcome = evaluateAgentPolicyRule(rule, request.simulation_context.production_blocked, true);
      if (!outcome.passed) {
        ruleBlockers.push(outcome.reason_code || 'production_blocked_required_rule_failed');
        ruleForcedEffect = 'DENY';
      }
    }
  }

  if (ruleForcedEffect === 'DENY') {
    return blockedDecision(request, 'POLICY_BLOCKED', uniqueSorted(ruleBlockers));
  }

  const priorityMax = Math.max(...matched.map((entry) => entry.policy.priority));
  const budgetPolicySource = matched.find((entry) => entry.policy.priority === priorityMax).policy;
  const budgetDecision = evaluateBudget(budgetPolicySource.budget_policy, request.budget_request);
  const limitDecision = evaluateLimits(budgetPolicySource.limit_policy, request.limit_request);

  if (!budgetDecision.within_budget) {
    return blockedDecision(request, 'BUDGET_BLOCKED', budgetDecision.reason_codes, { budget_decision: budgetDecision });
  }
  if (!limitDecision.within_limits) {
    return blockedDecision(request, 'LIMIT_BLOCKED', limitDecision.reason_codes, { limit_decision: limitDecision });
  }

  let effect = matched.reduce((acc, entry) => moreRestrictiveEffect(acc, entry.policy.effect), 'ALLOW_SIMULATION');
  if (request.risk_classification === 'HIGH') {
    effect = moreRestrictiveEffect(effect, 'REQUIRE_APPROVAL_SIMULATION');
  }
  if (matched.some((entry) => entry.riskEval.approvalRequired)) {
    effect = moreRestrictiveEffect(effect, 'REQUIRE_APPROVAL_SIMULATION');
  }

  const status = effect;
  const approvalRequired = effect === 'REQUIRE_APPROVAL_SIMULATION';
  const allowed = effect === 'ALLOW_SIMULATION';

  return finalizeDecision(request, {
    status,
    effect,
    allowed_in_simulation: allowed,
    approval_required: approvalRequired,
    applicable_policy_ids: matched.map((entry) => entry.policy.policy_id),
    applicable_policy_fingerprints: matched.map((entry) => safeFingerprint(entry.policy)),
    evaluated_rule_ids: evaluatedRuleIds,
    evaluated_rule_fingerprints: evaluatedRuleFingerprints,
    matched_scopes: ['SUBJECT', 'RESOURCE', 'ACTION', 'RISK', 'DATA', 'CHANNEL'],
    blockers: [],
    reason_codes: [effect === 'DENY' ? 'policy_effect_deny' : effect === 'REQUIRE_APPROVAL_SIMULATION' ? 'policy_requires_approval_simulation' : 'policy_reviewed_simulation_only'],
    budget_decision: budgetDecision,
    limit_decision: limitDecision
  });
}

module.exports = {
  AGENT_POLICY_BOUNDARY_VALIDATOR_VERSION,
  EFFECT_SEVERITY,
  LIFECYCLE_COMPATIBLE_STATES,
  evaluateAgentPolicyRequest,
  moreRestrictiveEffect
};
