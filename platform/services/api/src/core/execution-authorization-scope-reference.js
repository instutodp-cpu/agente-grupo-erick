'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const {
  MAX_COST_MINOR_UNITS, MAX_LIST_ITEMS, MAX_TOKENS_REFERENCE, RISK_CLASSIFICATIONS, WILDCARD_FREE_PATTERN,
  isOrderedUniqueEnumList
} = require('./execution-authorization-scope');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');

const AUTHORIZATION_SCOPE_REFERENCE_VALIDATOR_VERSION = 'execution_authorization_scope_reference_validator_v1';

const AUTHORIZATION_SCOPE_REFERENCE_FIELDS = Object.freeze([
  'authorization_scope_reference_id', 'authorization_scope_reference_version', 'authorization_scope_id',
  'authorization_decision_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id',
  'actor_id', 'actor_role', 'allowed_plan_ids', 'allowed_task_reference_ids', 'allowed_agent_ids',
  'allowed_model_reference_ids', 'allowed_tool_reference_ids', 'allowed_workflow_reference_ids',
  'allowed_capability_types', 'allowed_stage_types', 'allowed_risk_classifications', 'maximum_authorized_tokens',
  'maximum_authorized_cost_minor_units', 'cross_tenant_allowed', 'cross_organization_allowed',
  'cross_project_allowed', 'cross_session_allowed', 'scope_fingerprint', 'scope_validated', 'scope_applied',
  'simulation', 'production_blocked', 'validator_version'
]);

const ALLOWED_ID_LIST_FIELDS = Object.freeze([
  'allowed_plan_ids', 'allowed_task_reference_ids', 'allowed_agent_ids', 'allowed_model_reference_ids',
  'allowed_tool_reference_ids', 'allowed_workflow_reference_ids'
]);

// A scope reference is a positive allowlist: an empty list means nothing is permitted, never "no
// restriction" -- the same principle PR #97's own AuthorizationScope already established.
const AUTHORIZATION_SCOPE_REFERENCE_SAFE_FLAGS = Object.freeze({
  cross_tenant_allowed: false,
  cross_organization_allowed: false,
  cross_project_allowed: false,
  cross_session_allowed: false,
  scope_applied: false,
  simulation: true,
  production_blocked: true
});

function isWildcardFreeStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every((item) => isNonEmptyString(item) && WILDCARD_FREE_PATTERN.test(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateAuthorizationScopeReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['authorization_scope_reference_must_be_object'] };
  exactFields(reference, AUTHORIZATION_SCOPE_REFERENCE_FIELDS, 'authorization_scope_reference', errors);
  for (const field of [
    'authorization_scope_reference_id', 'authorization_scope_id', 'authorization_decision_id', 'tenant_id',
    'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id', 'actor_role',
    'scope_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.authorization_scope_reference_version) || reference.authorization_scope_reference_version < 1) {
    errors.push('authorization_scope_reference_version_invalid');
  }
  for (const field of ALLOWED_ID_LIST_FIELDS) {
    if (!isWildcardFreeStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueEnumList(reference.allowed_capability_types, CAPABILITY_TYPES, { maxItems: CAPABILITY_TYPES.length })) errors.push('allowed_capability_types_invalid');
  if (!isOrderedUniqueEnumList(reference.allowed_stage_types, STAGE_TYPES, { maxItems: STAGE_TYPES.length })) errors.push('allowed_stage_types_invalid');
  if (!isOrderedUniqueEnumList(reference.allowed_risk_classifications, RISK_CLASSIFICATIONS, { maxItems: RISK_CLASSIFICATIONS.length })) errors.push('allowed_risk_classifications_invalid');
  if (!Number.isInteger(reference.maximum_authorized_tokens) || reference.maximum_authorized_tokens < 0 || reference.maximum_authorized_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('maximum_authorized_tokens_invalid');
  }
  if (!Number.isInteger(reference.maximum_authorized_cost_minor_units) || reference.maximum_authorized_cost_minor_units < 0 || reference.maximum_authorized_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('maximum_authorized_cost_minor_units_invalid');
  }
  if (typeof reference.scope_validated !== 'boolean') errors.push('scope_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(AUTHORIZATION_SCOPE_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== AUTHORIZATION_SCOPE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  // Recompute and compare, fail-closed -- learned from PR #99fix: a registry calls this
  // validator directly, not only the engine, so a declared scope_fingerprint that disagrees with
  // the reference's own content must never pass structural validation.
  try {
    if (computeScopeReferenceFingerprint(reference) !== reference.scope_fingerprint) {
      errors.push('scope_fingerprint_mismatch');
    }
  } catch (error) {
    errors.push('scope_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeScopeReferenceFingerprint(reference) {
  const { scope_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function buildAuthorizationScopeReference(input = {}) {
  const reference = {
    authorization_scope_reference_id: input.authorization_scope_reference_id,
    authorization_scope_reference_version: Number.isInteger(input.authorization_scope_reference_version) ? input.authorization_scope_reference_version : 1,
    authorization_scope_id: input.authorization_scope_id,
    authorization_decision_id: input.authorization_decision_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    actor_role: input.actor_role,
    allowed_plan_ids: Array.isArray(input.allowed_plan_ids) ? input.allowed_plan_ids : [],
    allowed_task_reference_ids: Array.isArray(input.allowed_task_reference_ids) ? input.allowed_task_reference_ids : [],
    allowed_agent_ids: Array.isArray(input.allowed_agent_ids) ? input.allowed_agent_ids : [],
    allowed_model_reference_ids: Array.isArray(input.allowed_model_reference_ids) ? input.allowed_model_reference_ids : [],
    allowed_tool_reference_ids: Array.isArray(input.allowed_tool_reference_ids) ? input.allowed_tool_reference_ids : [],
    allowed_workflow_reference_ids: Array.isArray(input.allowed_workflow_reference_ids) ? input.allowed_workflow_reference_ids : [],
    allowed_capability_types: Array.isArray(input.allowed_capability_types) ? input.allowed_capability_types : [],
    allowed_stage_types: Array.isArray(input.allowed_stage_types) ? input.allowed_stage_types : [],
    allowed_risk_classifications: Array.isArray(input.allowed_risk_classifications) ? input.allowed_risk_classifications : [],
    maximum_authorized_tokens: Number.isInteger(input.maximum_authorized_tokens) ? input.maximum_authorized_tokens : 0,
    maximum_authorized_cost_minor_units: Number.isInteger(input.maximum_authorized_cost_minor_units) ? input.maximum_authorized_cost_minor_units : 0,
    cross_tenant_allowed: false,
    cross_organization_allowed: false,
    cross_project_allowed: false,
    cross_session_allowed: false,
    scope_validated: input.scope_validated === true,
    scope_applied: false,
    simulation: true,
    production_blocked: true,
    validator_version: AUTHORIZATION_SCOPE_REFERENCE_VALIDATOR_VERSION
  };
  reference.scope_fingerprint = computeScopeReferenceFingerprint({ ...reference, scope_fingerprint: undefined });

  const validation = validateAuthorizationScopeReference(reference);
  if (!validation.valid) {
    throw new Error(`authorization_scope_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  ALLOWED_ID_LIST_FIELDS,
  AUTHORIZATION_SCOPE_REFERENCE_FIELDS,
  AUTHORIZATION_SCOPE_REFERENCE_SAFE_FLAGS,
  AUTHORIZATION_SCOPE_REFERENCE_VALIDATOR_VERSION,
  buildAuthorizationScopeReference,
  computeScopeReferenceFingerprint,
  isWildcardFreeStringList,
  validateAuthorizationScopeReference
};
