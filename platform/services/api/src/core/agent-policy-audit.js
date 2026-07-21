'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { ACTIONS } = require('./agent-policy-scope');

const AGENT_POLICY_AUDIT_VERSION = 'agent_policy_audit_v1';
const AGENT_POLICY_AUDIT_FIELDS = Object.freeze([
  'audit_id',
  'policy_request_fingerprint',
  'decision_fingerprint',
  'agent_contract_fingerprint',
  'policy_fingerprints',
  'rule_fingerprints',
  'tenant_binding',
  'organization_binding',
  'actor_type',
  'actor_role',
  'capability_reference',
  'requested_action',
  'channel',
  'risk_classification',
  'data_classification',
  'budget_summary',
  'limit_summary',
  'decision_status',
  'effect',
  'blockers',
  'reason_codes',
  'logical_sequence',
  'simulation',
  'production_blocked',
  'executed',
  'validator_version'
]);

function fingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function validateAgentPolicyAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['agent_policy_audit_must_be_object'] };
  exactFields(audit, AGENT_POLICY_AUDIT_FIELDS, 'agent_policy_audit', errors);
  for (const field of ['audit_id', 'policy_request_fingerprint', 'decision_fingerprint', 'agent_contract_fingerprint', 'actor_type', 'actor_role', 'requested_action', 'channel', 'risk_classification', 'data_classification', 'decision_status', 'effect', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!ACTIONS.includes(audit.requested_action)) errors.push(`requested_action_not_allowed::${audit.requested_action}`);
  if (!Array.isArray(audit.policy_fingerprints) || !audit.policy_fingerprints.every(isNonEmptyString)) errors.push('policy_fingerprints_invalid');
  if (!Array.isArray(audit.rule_fingerprints) || !audit.rule_fingerprints.every(isNonEmptyString)) errors.push('rule_fingerprints_invalid');
  for (const field of ['tenant_binding', 'organization_binding', 'capability_reference', 'budget_summary', 'limit_summary']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Array.isArray(audit.reason_codes)) errors.push('reason_codes_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== AGENT_POLICY_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentPolicyAudit(input = {}) {
  const request = input.request || {};
  const decision = input.decision || {};
  const actor = request.actor_context || {};
  const audit = {
    audit_id: `agent_policy_audit_${decision.decision_id || request.policy_request_id || 'missing'}`,
    policy_request_fingerprint: decision.request_fingerprint || fingerprint(request),
    decision_fingerprint: decision.decision_fingerprint || 'decision_fingerprint_not_available',
    agent_contract_fingerprint: decision.contract_fingerprint || 'contract_fingerprint_not_available',
    policy_fingerprints: uniqueSorted(decision.applicable_policy_fingerprints || []),
    rule_fingerprints: uniqueSorted(decision.evaluated_rule_fingerprints || []),
    tenant_binding: {
      request_tenant_id: request.tenant_id || 'tenant_not_available',
      decision_tenant_id: decision.tenant_id || 'tenant_not_available'
    },
    organization_binding: {
      request_organization_id: request.organization_id || 'organization_not_available',
      decision_organization_id: decision.organization_id || 'organization_not_available'
    },
    actor_type: actor.actor_type || 'actor_type_not_available',
    actor_role: actor.actor_role || 'actor_role_not_available',
    capability_reference: isPlainObject(request.capability_reference) ? request.capability_reference : {},
    requested_action: request.requested_action || 'VALIDATE',
    channel: request.channel || 'channel_not_available',
    risk_classification: request.risk_classification || 'risk_classification_not_available',
    data_classification: request.data_classification || 'data_classification_not_available',
    budget_summary: isPlainObject(decision.budget_decision) ? decision.budget_decision : {},
    limit_summary: isPlainObject(decision.limit_decision) ? decision.limit_decision : {},
    decision_status: decision.status || 'VALIDATION_FAILED',
    effect: decision.effect || 'DENY',
    blockers: uniqueSorted(decision.blockers || []),
    reason_codes: uniqueSorted(decision.reason_codes || []),
    logical_sequence: Number.isInteger(input.logical_sequence) && input.logical_sequence >= 1 ? input.logical_sequence : 1,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: AGENT_POLICY_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  AGENT_POLICY_AUDIT_FIELDS,
  AGENT_POLICY_AUDIT_VERSION,
  buildAgentPolicyAudit,
  validateAgentPolicyAudit
};
