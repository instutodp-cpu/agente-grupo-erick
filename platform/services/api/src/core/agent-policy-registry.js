'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateAgentPolicy } = require('./agent-policy-contract');
const { validateAgentPolicyRule } = require('./agent-policy-rule-contract');

const AGENT_POLICY_REGISTRY_VALIDATOR_VERSION = 'agent_policy_registry_validator_v1';
const AGENT_POLICY_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION',
  'REPLAY_ACCEPTED',
  'PAYLOAD_MISMATCH',
  'VERSION_CONFLICT',
  'VALIDATION_FAILED',
  'TENANT_BLOCKED',
  'POLICY_CONFLICT'
]);
const FORBIDDEN_AGENT_POLICY_REGISTRY_STATUSES = Object.freeze(['REGISTERED_REAL']);
const AGENT_POLICY_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...AGENT_POLICY_REGISTRY_SAFE_FLAGS });
}

function slugKey(tenantId, slug) {
  return `${tenantId}::${slug}`;
}

function createAgentPolicyRegistry() {
  const policiesById = new Map();
  const policyIdBySlug = new Map();
  const rulesById = new Map();
  const rulesByPolicyId = new Map();

  function registerPolicy(policy, options = {}) {
    const validation = validateAgentPolicy(policy);
    if (!validation.valid) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    }
    if (policy.policy_status !== 'VALIDATED_SIMULATION') {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`policy_status_not_registerable::${policy.policy_status}`] });
    }
    let payload;
    try {
      payload = stablePayload(policy);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const policyId = policy.policy_id;
    const tenantId = policy.tenant_id;
    const policySlug = policy.policy_slug;
    const policyVersion = policy.policy_version;
    const existing = policiesById.get(policyId);

    if (existing) {
      if (existing.fingerprint === payload) {
        return safe({ ok: true, status: 'REPLAY_ACCEPTED', policy_id: policyId, tenant_id: tenantId, policy_version: existing.policy_version, fingerprint: payload });
      }
      if (policyVersion === existing.policy_version) {
        return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: ['agent_policy_payload_mismatch'] });
      }
      if (options.expected_version !== undefined && options.expected_version !== existing.policy_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_policy_optimistic_conflict'] });
      }
      if (policyVersion < existing.policy_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_policy_version_downgrade'] });
      }
      if (existing.tenant_id !== tenantId) {
        return safe({ ok: false, status: 'TENANT_BLOCKED', errors: ['agent_policy_tenant_reassignment_blocked'] });
      }
      const stored = cloneFrozen(policy);
      policiesById.set(policyId, { record: stored, fingerprint: payload, tenant_id: tenantId, policy_slug: policySlug, policy_version: policyVersion });
      if (existing.policy_slug !== policySlug) policyIdBySlug.delete(slugKey(existing.tenant_id, existing.policy_slug));
      policyIdBySlug.set(slugKey(tenantId, policySlug), policyId);
      return safe({ ok: true, status: 'REGISTERED_SIMULATION', policy_id: policyId, tenant_id: tenantId, policy_version: policyVersion, fingerprint: payload });
    }

    if (options.expected_version !== undefined && options.expected_version !== 0) {
      return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_policy_optimistic_conflict'] });
    }
    const slugOwner = policyIdBySlug.get(slugKey(tenantId, policySlug));
    if (slugOwner && slugOwner !== policyId) {
      return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: ['agent_policy_slug_already_registered_for_tenant'] });
    }
    const stored = cloneFrozen(policy);
    policiesById.set(policyId, { record: stored, fingerprint: payload, tenant_id: tenantId, policy_slug: policySlug, policy_version: policyVersion });
    policyIdBySlug.set(slugKey(tenantId, policySlug), policyId);
    return safe({ ok: true, status: 'REGISTERED_SIMULATION', policy_id: policyId, tenant_id: tenantId, policy_version: policyVersion, fingerprint: payload });
  }

  function registerRule(rule, options = {}) {
    const validation = validateAgentPolicyRule(rule);
    if (!validation.valid) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    }
    if (rule.rule_status !== 'VALIDATED_SIMULATION') {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`rule_status_not_registerable::${rule.rule_status}`] });
    }
    if (!policiesById.has(rule.policy_id)) {
      return safe({ ok: false, status: 'POLICY_CONFLICT', errors: [`rule_references_unregistered_policy::${rule.policy_id}`] });
    }
    let payload;
    try {
      payload = stablePayload(rule);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const ruleId = rule.rule_id;
    const ruleVersion = rule.rule_version;
    const existing = rulesById.get(ruleId);

    if (existing) {
      if (existing.fingerprint === payload) {
        return safe({ ok: true, status: 'REPLAY_ACCEPTED', rule_id: ruleId, policy_id: rule.policy_id, rule_version: existing.rule_version, fingerprint: payload });
      }
      if (ruleVersion === existing.rule_version) {
        return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: ['agent_policy_rule_payload_mismatch'] });
      }
      if (options.expected_version !== undefined && options.expected_version !== existing.rule_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_policy_rule_optimistic_conflict'] });
      }
      if (ruleVersion < existing.rule_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_policy_rule_version_downgrade'] });
      }
      const stored = cloneFrozen(rule);
      rulesById.set(ruleId, { record: stored, fingerprint: payload, policy_id: rule.policy_id, rule_version: ruleVersion });
      return safe({ ok: true, status: 'REGISTERED_SIMULATION', rule_id: ruleId, policy_id: rule.policy_id, rule_version: ruleVersion, fingerprint: payload });
    }

    if (options.expected_version !== undefined && options.expected_version !== 0) {
      return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_policy_rule_optimistic_conflict'] });
    }
    const stored = cloneFrozen(rule);
    rulesById.set(ruleId, { record: stored, fingerprint: payload, policy_id: rule.policy_id, rule_version: ruleVersion });
    rulesByPolicyId.set(rule.policy_id, [...(rulesByPolicyId.get(rule.policy_id) || []), ruleId]);
    return safe({ ok: true, status: 'REGISTERED_SIMULATION', rule_id: ruleId, policy_id: rule.policy_id, rule_version: ruleVersion, fingerprint: payload });
  }

  function getPolicyById(policyId) {
    if (!isNonEmptyString(policyId)) return null;
    const entry = policiesById.get(policyId);
    return entry ? cloneFrozen(entry.record) : null;
  }

  function getPolicyBySlugAndTenant(policySlug, tenantId) {
    if (!isNonEmptyString(policySlug) || !isNonEmptyString(tenantId)) return null;
    const policyId = policyIdBySlug.get(slugKey(tenantId, policySlug));
    return policyId ? getPolicyById(policyId) : null;
  }

  function listPoliciesByTenant(tenantId, filters = {}) {
    if (!isNonEmptyString(tenantId)) return [];
    const organizationId = isPlainObject(filters) && isNonEmptyString(filters.organization_id) ? filters.organization_id : null;
    const policyType = isPlainObject(filters) && isNonEmptyString(filters.policy_type) ? filters.policy_type : null;
    const policyStatus = isPlainObject(filters) && isNonEmptyString(filters.policy_status) ? filters.policy_status : null;
    const results = [];
    for (const entry of policiesById.values()) {
      if (entry.tenant_id !== tenantId) continue;
      if (organizationId && entry.record.organization_id !== organizationId) continue;
      if (policyType && entry.record.policy_type !== policyType) continue;
      if (policyStatus && entry.record.policy_status !== policyStatus) continue;
      results.push(cloneFrozen(entry.record));
      if (results.length >= MAX_LIST_RESULTS) break;
    }
    return results.sort((a, b) => (a.policy_id < b.policy_id ? -1 : a.policy_id > b.policy_id ? 1 : 0));
  }

  function getRuleById(ruleId) {
    if (!isNonEmptyString(ruleId)) return null;
    const entry = rulesById.get(ruleId);
    return entry ? cloneFrozen(entry.record) : null;
  }

  function listRulesByPolicyId(policyId) {
    if (!isNonEmptyString(policyId)) return [];
    const ids = rulesByPolicyId.get(policyId) || [];
    return ids.map((ruleId) => getRuleById(ruleId)).filter(Boolean).sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));
  }

  return Object.freeze({
    registerPolicy,
    registerRule,
    getPolicyById,
    getPolicyBySlugAndTenant,
    listPoliciesByTenant,
    getRuleById,
    listRulesByPolicyId
  });
}

module.exports = {
  AGENT_POLICY_REGISTRY_SAFE_FLAGS,
  AGENT_POLICY_REGISTRY_STATUSES,
  AGENT_POLICY_REGISTRY_VALIDATOR_VERSION,
  FORBIDDEN_AGENT_POLICY_REGISTRY_STATUSES,
  MAX_LIST_RESULTS,
  createAgentPolicyRegistry
};
