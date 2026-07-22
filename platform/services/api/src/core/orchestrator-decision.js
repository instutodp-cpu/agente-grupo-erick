'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_DECISION_VALIDATOR_VERSION = 'orchestrator_decision_validator_v1';
const ORCHESTRATOR_DECISION_FIELDS = Object.freeze([
  'decision_id', 'orchestrator_request_id', 'tenant_id', 'organization_id', 'agent_id', 'status',
  'plan_reference_id', 'request_fingerprint', 'plan_fingerprint', 'workflow_reference_id', 'tool_reference_ids',
  'model_selection_reference_id', 'context_reference_id', 'blockers', 'reason_codes', 'executed', 'tool_called',
  'workflow_executed', 'provider_called', 'model_called', 'runtime_enabled', 'network_used', 'tokens_consumed',
  'cost_consumed', 'simulation', 'production_blocked', 'validator_version'
]);
const ORCHESTRATOR_DECISION_STATUSES = Object.freeze(['PLAN_READY', 'BLOCKED', 'VALIDATION_FAILED', 'SIMULATION_ONLY']);
const FORBIDDEN_ORCHESTRATOR_DECISION_STATUSES = Object.freeze(['EXECUTED', 'RUNNING', 'ACTIVE']);
const NOT_AVAILABLE_REFERENCE = 'reference_not_available';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const MAX_LIST_ITEMS = 500;
const ORCHESTRATOR_DECISION_SAFE_FLAGS = Object.freeze({
  executed: false,
  tool_called: false,
  workflow_executed: false,
  provider_called: false,
  model_called: false,
  runtime_enabled: false,
  network_used: false,
  tokens_consumed: false,
  cost_consumed: false,
  simulation: true,
  production_blocked: true
});

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateOrchestratorDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['decision_must_be_object'] };
  exactFields(decision, ORCHESTRATOR_DECISION_FIELDS, 'decision', errors);
  for (const field of [
    'decision_id', 'orchestrator_request_id', 'tenant_id', 'organization_id', 'agent_id', 'plan_reference_id',
    'request_fingerprint', 'plan_fingerprint', 'workflow_reference_id', 'context_reference_id', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (decision.model_selection_reference_id !== null && !isNonEmptyString(decision.model_selection_reference_id)) {
    errors.push('model_selection_reference_id_must_be_null_or_string');
  }
  if (!ORCHESTRATOR_DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (FORBIDDEN_ORCHESTRATOR_DECISION_STATUSES.includes(decision.status)) errors.push(`status_forbidden::${decision.status}`);
  if (!isOrderedUniqueStringList(decision.tool_reference_ids)) errors.push('tool_reference_ids_invalid');
  if (!isOrderedUniqueStringList(decision.blockers)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(decision.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(ORCHESTRATOR_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.status === 'PLAN_READY') {
    if (decision.plan_reference_id === NOT_AVAILABLE_REFERENCE) errors.push('plan_reference_id_required_when_ready');
  } else if (decision.plan_reference_id !== NOT_AVAILABLE_REFERENCE) {
    errors.push('plan_reference_id_must_be_sentinel_unless_ready');
  }
  if (decision.validator_version !== ORCHESTRATOR_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorDecision(overrides = {}) {
  const status = ORCHESTRATOR_DECISION_STATUSES.includes(overrides.status) ? overrides.status : 'VALIDATION_FAILED';
  const isReady = status === 'PLAN_READY';
  const decision = {
    decision_id: overrides.decision_id || 'orchestrator_decision_not_available',
    orchestrator_request_id: overrides.orchestrator_request_id || 'orchestrator_request_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    status,
    plan_reference_id: isReady ? (overrides.plan_reference_id || NOT_AVAILABLE_REFERENCE) : NOT_AVAILABLE_REFERENCE,
    request_fingerprint: overrides.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    plan_fingerprint: isReady ? (overrides.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT) : NOT_AVAILABLE_FINGERPRINT,
    workflow_reference_id: overrides.workflow_reference_id || NOT_AVAILABLE_REFERENCE,
    tool_reference_ids: Array.isArray(overrides.tool_reference_ids) ? uniqueSorted(overrides.tool_reference_ids) : [],
    model_selection_reference_id: isNonEmptyString(overrides.model_selection_reference_id) ? overrides.model_selection_reference_id : null,
    context_reference_id: overrides.context_reference_id || NOT_AVAILABLE_REFERENCE,
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    validator_version: ORCHESTRATOR_DECISION_VALIDATOR_VERSION,
    ...ORCHESTRATOR_DECISION_SAFE_FLAGS
  };
  const validation = validateOrchestratorDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      plan_reference_id: NOT_AVAILABLE_REFERENCE,
      plan_fingerprint: NOT_AVAILABLE_FINGERPRINT,
      blockers: uniqueSorted([...decision.blockers, ...validation.errors]),
      reason_codes: uniqueSorted([...decision.reason_codes, validation.errors[0] || 'orchestrator_decision_invalid']),
      ...ORCHESTRATOR_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  FORBIDDEN_ORCHESTRATOR_DECISION_STATUSES,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_REFERENCE,
  ORCHESTRATOR_DECISION_FIELDS,
  ORCHESTRATOR_DECISION_SAFE_FLAGS,
  ORCHESTRATOR_DECISION_STATUSES,
  ORCHESTRATOR_DECISION_VALIDATOR_VERSION,
  buildOrchestratorDecision,
  validateOrchestratorDecision
};
