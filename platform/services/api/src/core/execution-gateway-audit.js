'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { GATEWAY_STATUSES, GATEWAY_DECISIONS, GATEWAY_NEXT_STATES } = require('./execution-gateway-decision');

const EXECUTION_GATEWAY_AUDIT_VALIDATOR_VERSION = 'execution_gateway_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

const EXECUTION_GATEWAY_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'gateway_request_id', 'gateway_decision_id', 'gateway_result_id', 'execution_plan_id',
  'execution_plan_result_id', 'fingerprints', 'package_digest', 'tenant_binding', 'organization_binding',
  'project_binding', 'session_binding', 'agent_binding', 'actor_binding', 'gate_counts', 'validation_counts',
  'binding_counts', 'status', 'decision', 'next_state', 'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

// Never registers a payload, StageRecords, content, prompts, memory, messages, tool parameters,
// responses, secrets, tokens, endpoints, code, or full workflow logs -- only ids, fingerprints,
// digests, status/decision/next_state, tenant/organization/project/session/agent/actor bindings,
// counts, blockers, and reason codes.
// Bare 'authorization'/'authorization_provenance' would trip the forbidden-key scanner's
// segment check (only full compound names are allowlisted, never the bare 'authorization'
// segment) -- these three use the exact same field names execution-gateway-decision.js already
// carries (authorization_fingerprint/authorization_provenance_fingerprint/
// authorization_scope_fingerprint), all already allowlisted, instead of a shorter nested-object
// key that no allowlist entry matches.
const FINGERPRINT_KEYS = Object.freeze([
  'gateway_request', 'gateway_decision', 'gateway_package', 'execution_plan', 'execution_plan_result',
  'authorization_fingerprint', 'authorization_provenance_fingerprint', 'authorization_scope_fingerprint',
  'registry_snapshot', 'stage_manifest', 'dependency_graph', 'binding_ledger', 'validation_ledger',
  'architecture_gate_evidence', 'freshness', 'replay'
]);
const GATE_COUNT_KEYS = Object.freeze(['gate_count', 'passed_gate_count', 'failed_gate_count', 'warning_gate_count']);
const VALIDATION_COUNT_KEYS = Object.freeze(['valid_count', 'invalid_count', 'not_applicable_count', 'not_evaluated_count']);
const BINDING_COUNT_KEYS = Object.freeze(['binding_count', 'required_binding_count', 'validated_binding_count', 'blocked_binding_count']);

const MAX_LIST_ITEMS = 50;

function isSanitizedList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateCountObject(value, keys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label}_must_be_object`);
    return;
  }
  for (const key of keys) {
    if (!Number.isInteger(value[key]) || value[key] < 0) errors.push(`${label}_${key}_invalid`);
  }
}

function validateExecutionGatewayAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['execution_gateway_audit_must_be_object'] };
  exactFields(audit, EXECUTION_GATEWAY_AUDIT_FIELDS, 'execution_gateway_audit', errors);
  for (const field of [
    'audit_id', 'gateway_request_id', 'gateway_decision_id', 'gateway_result_id', 'execution_plan_id',
    'execution_plan_result_id', 'package_digest', 'status', 'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!GATEWAY_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!GATEWAY_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!GATEWAY_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

  if (!isPlainObject(audit.fingerprints)) {
    errors.push('fingerprints_must_be_object');
  } else {
    for (const key of FINGERPRINT_KEYS) {
      if (!isNonEmptyString(audit.fingerprints[key])) errors.push(`fingerprints_${key}_invalid`);
    }
  }
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) errors.push('organization_binding_invalid');
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.session_binding) || !isNonEmptyString(audit.session_binding.session_reference_id)) errors.push('session_binding_invalid');
  if (!isPlainObject(audit.agent_binding) || !isNonEmptyString(audit.agent_binding.agent_id)) errors.push('agent_binding_invalid');
  if (!isPlainObject(audit.actor_binding) || !isNonEmptyString(audit.actor_binding.actor_id)) errors.push('actor_binding_invalid');

  validateCountObject(audit.gate_counts, GATE_COUNT_KEYS, 'gate_counts', errors);
  validateCountObject(audit.validation_counts, VALIDATION_COUNT_KEYS, 'validation_counts', errors);
  validateCountObject(audit.binding_counts, BINDING_COUNT_KEYS, 'binding_counts', errors);

  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== EXECUTION_GATEWAY_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionGatewayAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};

  const audit = {
    audit_id: `execution_gateway_audit_${result.gateway_result_id || decision.gateway_decision_id || NOT_AVAILABLE_LABEL}`,
    gateway_request_id: decision.gateway_request_id || NOT_AVAILABLE_LABEL,
    gateway_decision_id: decision.gateway_decision_id || NOT_AVAILABLE_LABEL,
    gateway_result_id: result.gateway_result_id || NOT_AVAILABLE_LABEL,
    execution_plan_id: decision.execution_plan_id || NOT_AVAILABLE_LABEL,
    execution_plan_result_id: decision.execution_plan_result_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      gateway_request: decision.gateway_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      gateway_decision: input.gatewayDecisionFingerprint || NOT_AVAILABLE_FINGERPRINT,
      gateway_package: decision.gateway_package_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      execution_plan: decision.execution_plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      execution_plan_result: decision.execution_plan_result_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      authorization_fingerprint: decision.authorization_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      authorization_provenance_fingerprint: decision.authorization_provenance_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      authorization_scope_fingerprint: decision.authorization_scope_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      registry_snapshot: decision.registry_snapshot_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      stage_manifest: decision.stage_manifest_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      dependency_graph: decision.dependency_graph_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      binding_ledger: decision.binding_ledger_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      validation_ledger: decision.validation_ledger_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      architecture_gate_evidence: decision.architecture_gate_evidence_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      freshness: decision.freshness_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      replay: decision.replay_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    gate_counts: {
      gate_count: Number.isInteger(input.gateCount) ? input.gateCount : 0,
      passed_gate_count: Number.isInteger(input.passedGateCount) ? input.passedGateCount : 0,
      failed_gate_count: Number.isInteger(input.failedGateCount) ? input.failedGateCount : 0,
      warning_gate_count: Number.isInteger(input.warningGateCount) ? input.warningGateCount : 0
    },
    validation_counts: {
      valid_count: Number.isInteger(input.validCount) ? input.validCount : 0,
      invalid_count: Number.isInteger(input.invalidCount) ? input.invalidCount : 0,
      not_applicable_count: Number.isInteger(input.notApplicableCount) ? input.notApplicableCount : 0,
      not_evaluated_count: Number.isInteger(input.notEvaluatedCount) ? input.notEvaluatedCount : 0
    },
    binding_counts: {
      binding_count: Number.isInteger(input.bindingCount) ? input.bindingCount : 0,
      required_binding_count: Number.isInteger(input.requiredBindingCount) ? input.requiredBindingCount : 0,
      validated_binding_count: Number.isInteger(input.validatedBindingCount) ? input.validatedBindingCount : 0,
      blocked_binding_count: Number.isInteger(input.blockedBindingCount) ? input.blockedBindingCount : 0
    },
    status: decision.status || 'VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: EXECUTION_GATEWAY_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  BINDING_COUNT_KEYS,
  EXECUTION_GATEWAY_AUDIT_FIELDS,
  EXECUTION_GATEWAY_AUDIT_VALIDATOR_VERSION,
  FINGERPRINT_KEYS,
  GATE_COUNT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  VALIDATION_COUNT_KEYS,
  buildExecutionGatewayAudit,
  validateExecutionGatewayAudit
};
