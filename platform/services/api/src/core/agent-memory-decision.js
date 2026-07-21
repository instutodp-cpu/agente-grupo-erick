'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { validateMemoryScope, matchesMemoryScope } = require('./agent-memory-scope');
const { validateAgentMemoryRequest } = require('./agent-memory-request');

const AGENT_MEMORY_DECISION_VALIDATOR_VERSION = 'agent_memory_decision_validator_v1';
const AGENT_MEMORY_DECISION_FIELDS = Object.freeze([
  'decision_id', 'memory_request_id', 'memory_contract_id', 'memory_item_id', 'agent_id', 'tenant_id',
  'organization_id', 'status', 'decision', 'allowed_in_simulation', 'memory_contract_fingerprint',
  'memory_item_fingerprint', 'request_fingerprint', 'retrieval_fingerprint', 'policy_decision_fingerprint',
  'registry_version', 'blockers', 'reason_codes', 'contract_validated', 'scope_validated', 'policy_validated',
  'retention_evaluated', 'memory_registered', 'memory_loaded', 'memory_read', 'memory_written', 'memory_updated',
  'memory_deleted', 'memory_shared', 'retrieval_executed', 'ranking_executed', 'similarity_executed',
  'embedding_generated', 'vector_store_used', 'llm_called', 'tool_called', 'network_used', 'runtime_mutated',
  'executed', 'runtime_enabled', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);
const MEMORY_DECISION_STATUSES = Object.freeze([
  'ALLOW_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'AGENT_BLOCKED',
  'SESSION_BLOCKED', 'POLICY_BLOCKED', 'APPROVAL_BLOCKED', 'SCOPE_BLOCKED', 'CLASSIFICATION_BLOCKED',
  'RETENTION_BLOCKED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED'
]);
const MEMORY_DECISION_VALUES = Object.freeze([
  'VALIDATE_REFERENCE_ALLOWED', 'REGISTER_REFERENCE_ALLOWED', 'READ_REFERENCE_ALLOWED', 'LIST_REFERENCES_ALLOWED',
  'RETRIEVAL_REFERENCE_VALIDATED', 'RETENTION_REFERENCE_EVALUATED', 'BLOCKED'
]);
const AGENT_MEMORY_DECISION_SAFE_FLAGS = Object.freeze({
  memory_registered: false,
  memory_loaded: false,
  memory_read: false,
  memory_written: false,
  memory_updated: false,
  memory_deleted: false,
  memory_shared: false,
  retrieval_executed: false,
  ranking_executed: false,
  similarity_executed: false,
  embedding_generated: false,
  vector_store_used: false,
  llm_called: false,
  tool_called: false,
  network_used: false,
  runtime_mutated: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});
const REQUEST_TYPE_DECISION_MAP = Object.freeze({
  VALIDATE_MEMORY_REFERENCE: 'VALIDATE_REFERENCE_ALLOWED',
  REGISTER_MEMORY_REFERENCE: 'REGISTER_REFERENCE_ALLOWED',
  READ_MEMORY_REFERENCE: 'READ_REFERENCE_ALLOWED',
  LIST_MEMORY_REFERENCES: 'LIST_REFERENCES_ALLOWED',
  RETRIEVE_MEMORY_REFERENCE: 'RETRIEVAL_REFERENCE_VALIDATED',
  EVALUATE_RETENTION_REFERENCE: 'RETENTION_REFERENCE_EVALUATED'
});
const ALWAYS_BLOCKED_REQUEST_TYPES = Object.freeze(['UPDATE_MEMORY_REFERENCE', 'DELETE_MEMORY_REFERENCE', 'SHARE_MEMORY_REFERENCE']);
const NO_CURRENT_MEMORY_REQUIRED = Object.freeze(['REGISTER_MEMORY_REFERENCE']);

function validateAgentMemoryDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['agent_memory_decision_must_be_object'] };
  exactFields(decision, AGENT_MEMORY_DECISION_FIELDS, 'agent_memory_decision', errors);
  for (const field of ['decision_id', 'memory_request_id', 'memory_contract_id', 'memory_item_id', 'agent_id', 'tenant_id', 'organization_id', 'memory_contract_fingerprint', 'memory_item_fingerprint', 'request_fingerprint', 'retrieval_fingerprint', 'policy_decision_fingerprint', 'registry_version', 'validator_version']) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!MEMORY_DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!MEMORY_DECISION_VALUES.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  if (typeof decision.allowed_in_simulation !== 'boolean') errors.push('allowed_in_simulation_must_be_boolean');
  for (const field of ['contract_validated', 'scope_validated', 'policy_validated', 'retention_evaluated']) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!Array.isArray(decision.blockers) || !decision.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (!Array.isArray(decision.reason_codes) || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(AGENT_MEMORY_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.allowed_in_simulation === true && decision.status !== 'ALLOW_SIMULATION') {
    errors.push('allowed_in_simulation_inconsistent_with_status');
  }
  if (decision.validator_version !== AGENT_MEMORY_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentMemoryDecision(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const decision = {
    decision_id: overrides.decision_id || `agent_memory_decision_${overrides.memory_request_id || 'missing'}`,
    memory_request_id: overrides.memory_request_id || 'memory_request_not_available',
    memory_contract_id: overrides.memory_contract_id || 'memory_contract_not_available',
    memory_item_id: overrides.memory_item_id || 'memory_item_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    status,
    decision: MEMORY_DECISION_VALUES.includes(overrides.decision) ? overrides.decision : 'BLOCKED',
    allowed_in_simulation: status === 'ALLOW_SIMULATION' && overrides.allowed_in_simulation === true,
    memory_contract_fingerprint: overrides.memory_contract_fingerprint || 'memory_contract_fingerprint_not_available',
    memory_item_fingerprint: overrides.memory_item_fingerprint || 'memory_item_fingerprint_not_available',
    request_fingerprint: overrides.request_fingerprint || 'request_fingerprint_not_available',
    retrieval_fingerprint: overrides.retrieval_fingerprint || 'retrieval_fingerprint_not_available',
    policy_decision_fingerprint: overrides.policy_decision_fingerprint || 'policy_decision_fingerprint_not_available',
    registry_version: overrides.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    contract_validated: overrides.contract_validated === true,
    scope_validated: overrides.scope_validated === true,
    policy_validated: overrides.policy_validated === true,
    retention_evaluated: overrides.retention_evaluated === true,
    validator_version: AGENT_MEMORY_DECISION_VALIDATOR_VERSION,
    ...AGENT_MEMORY_DECISION_SAFE_FLAGS
  };
  const validation = validateAgentMemoryDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      allowed_in_simulation: false,
      contract_validated: false,
      scope_validated: false,
      policy_validated: false,
      blockers: uniqueSorted([...(decision.blockers || []), ...validation.errors]),
      reason_codes: uniqueSorted([...(decision.reason_codes || []), validation.errors[0] || 'agent_memory_decision_invalid']),
      ...AGENT_MEMORY_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
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
  const base = {
    memory_request_id: isPlainObject(request) ? request.memory_request_id : 'memory_request_not_available',
    memory_contract_id: isPlainObject(request) && isPlainObject(request.memory_contract_reference) ? request.memory_contract_reference.memory_contract_id : 'memory_contract_not_available',
    memory_item_id: isPlainObject(request) && isPlainObject(request.memory_item_reference) ? request.memory_item_reference.memory_item_id : 'memory_item_not_available',
    agent_id: isPlainObject(request) && isPlainObject(request.agent_contract_reference) ? request.agent_contract_reference.agent_id : 'agent_not_available',
    tenant_id: isPlainObject(request) ? request.tenant_id : 'tenant_not_available',
    organization_id: isPlainObject(request) ? request.organization_id : 'organization_not_available',
    memory_contract_fingerprint: isPlainObject(request) && isPlainObject(request.memory_contract_reference) ? request.memory_contract_reference.memory_contract_fingerprint : 'memory_contract_fingerprint_not_available',
    memory_item_fingerprint: isPlainObject(request) && isPlainObject(request.memory_item_reference) ? request.memory_item_reference.memory_item_fingerprint : 'memory_item_fingerprint_not_available',
    request_fingerprint: requestFingerprint,
    retrieval_fingerprint: isPlainObject(request) && isPlainObject(request.retrieval_reference) ? request.retrieval_reference.retrieval_fingerprint : 'retrieval_fingerprint_not_available',
    policy_decision_fingerprint: isPlainObject(request) && isPlainObject(request.policy_reference) ? request.policy_reference.policy_decision_fingerprint : 'policy_decision_fingerprint_not_available',
    registry_version: AGENT_MEMORY_DECISION_VALIDATOR_VERSION,
    ...overrides
  };
  return buildAgentMemoryDecision(base);
}

function blockedDecision(request, status, reasonCodes, extra = {}) {
  return finalizeDecision(request, {
    status,
    decision: 'BLOCKED',
    allowed_in_simulation: false,
    blockers: uniqueSorted(reasonCodes),
    reason_codes: uniqueSorted(reasonCodes),
    contract_validated: false,
    scope_validated: false,
    policy_validated: false,
    retention_evaluated: false,
    ...extra
  });
}

function evaluateAgentMemoryRequest(request, context = {}) {
  const requestValidation = validateAgentMemoryRequest(request);
  if (!requestValidation.valid) {
    return blockedDecision(request, 'VALIDATION_FAILED', requestValidation.errors);
  }

  if (ALWAYS_BLOCKED_REQUEST_TYPES.includes(request.request_type)) {
    return blockedDecision(request, 'DENY', ['operation_not_available_this_pr']);
  }

  const memoryScope = context.memory_scope;
  const scopeValidation = validateMemoryScope(memoryScope);
  if (!scopeValidation.valid) {
    return blockedDecision(request, 'SCOPE_BLOCKED', scopeValidation.errors);
  }
  if (request.tenant_id !== memoryScope.tenant_id) {
    return blockedDecision(request, 'TENANT_BLOCKED', ['tenant_not_in_memory_scope']);
  }
  if (request.organization_id !== memoryScope.organization_id) {
    return blockedDecision(request, 'ORGANIZATION_BLOCKED', ['organization_not_in_memory_scope']);
  }

  const classification = context.classification;
  if (classification === 'RESTRICTED') {
    return blockedDecision(request, 'CLASSIFICATION_BLOCKED', ['classification_restricted_always_blocked']);
  }
  const retentionClass = context.retention_class;
  if (retentionClass === 'PERMANENT_REFERENCE_BLOCKED') {
    return blockedDecision(request, 'RETENTION_BLOCKED', ['retention_permanent_always_blocked']);
  }

  const candidate = {
    tenant_id: request.tenant_id,
    organization_id: request.organization_id,
    agent_id: request.agent_contract_reference.agent_id,
    session_reference_id: request.session_reference.session_id,
    actor_role: request.actor_context.actor_role,
    memory_types: Array.isArray(context.memory_types) ? context.memory_types : [],
    classification
  };
  if (!Array.isArray(memoryScope.allowed_agent_ids) || !memoryScope.allowed_agent_ids.includes(candidate.agent_id)) {
    return blockedDecision(request, 'AGENT_BLOCKED', ['agent_not_in_memory_scope']);
  }
  if (!Array.isArray(memoryScope.allowed_session_reference_ids) || !memoryScope.allowed_session_reference_ids.includes(candidate.session_reference_id)) {
    return blockedDecision(request, 'SESSION_BLOCKED', ['session_not_in_memory_scope']);
  }
  if (!matchesMemoryScope(memoryScope, candidate)) {
    return blockedDecision(request, 'SCOPE_BLOCKED', ['memory_scope_no_match']);
  }

  const policyRef = request.policy_reference;
  if (policyRef.policy_evaluated !== true) return blockedDecision(request, 'POLICY_BLOCKED', ['policy_not_evaluated']);
  if (policyRef.allowed_in_simulation !== true) return blockedDecision(request, 'POLICY_BLOCKED', ['policy_not_allowed_in_simulation']);
  if (context.importance_level === 'CRITICAL_REFERENCE' && policyRef.approval_required !== true) {
    return blockedDecision(request, 'APPROVAL_BLOCKED', ['critical_importance_requires_approval_flagged']);
  }

  const requiresCurrentMemory = !NO_CURRENT_MEMORY_REQUIRED.includes(request.request_type);
  const current = context.current_memory;
  if (requiresCurrentMemory) {
    if (!isPlainObject(current)) {
      return blockedDecision(request, 'VALIDATION_FAILED', ['current_memory_context_required']);
    }
    if (request.memory_item_reference.memory_item_id !== current.memory_item_id) {
      return blockedDecision(request, 'CONFLICT_BLOCKED', ['memory_item_id_conflict']);
    }
    if (request.expected_memory_version !== current.memory_item_version) {
      return blockedDecision(request, 'VERSION_BLOCKED', ['memory_version_conflict']);
    }
    if (request.expected_memory_fingerprint !== current.memory_fingerprint) {
      return blockedDecision(request, 'FINGERPRINT_BLOCKED', ['memory_fingerprint_conflict']);
    }
    if (current.agent_id !== candidate.agent_id || current.tenant_id !== request.tenant_id || current.organization_id !== request.organization_id) {
      return blockedDecision(request, 'AGENT_BLOCKED', ['memory_item_binding_mismatch']);
    }
  }

  const decisionValue = REQUEST_TYPE_DECISION_MAP[request.request_type] || 'BLOCKED';
  return finalizeDecision(request, {
    status: 'ALLOW_SIMULATION',
    decision: decisionValue,
    allowed_in_simulation: true,
    blockers: [],
    reason_codes: ['memory_reference_reviewed_simulation_only'],
    contract_validated: true,
    scope_validated: true,
    policy_validated: true,
    retention_evaluated: request.request_type === 'EVALUATE_RETENTION_REFERENCE'
  });
}

module.exports = {
  AGENT_MEMORY_DECISION_FIELDS,
  AGENT_MEMORY_DECISION_SAFE_FLAGS,
  AGENT_MEMORY_DECISION_VALIDATOR_VERSION,
  ALWAYS_BLOCKED_REQUEST_TYPES,
  MEMORY_DECISION_STATUSES,
  MEMORY_DECISION_VALUES,
  buildAgentMemoryDecision,
  evaluateAgentMemoryRequest,
  validateAgentMemoryDecision
};
