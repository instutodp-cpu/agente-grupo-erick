'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const AUTHORIZATION_PROVENANCE_REFERENCE_VALIDATOR_VERSION = 'execution_authorization_provenance_reference_validator_v1';

const AUTHORIZATION_PROVENANCE_REFERENCE_FIELDS = Object.freeze([
  'authorization_provenance_reference_id', 'authorization_provenance_reference_version', 'authorization_decision_id',
  'authorization_request_id', 'authorization_policy_id', 'authorization_scope_id', 'actor_id', 'actor_role',
  'approval_reference_id', 'budget_authorization_id', 'expiration_evaluation_id', 'planning_result_id', 'plan_id',
  'task_reference_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'authorization_decision_fingerprint', 'authorization_request_fingerprint', 'authorization_policy_fingerprint',
  'authorization_scope_fingerprint', 'actor_fingerprint', 'approval_fingerprint', 'budget_authorization_fingerprint',
  'expiration_fingerprint', 'planning_result_fingerprint', 'orchestration_plan_fingerprint', 'task_fingerprint',
  'created_from_reference_id', 'derived_from_reference_ids', 'parent_reference_id', 'logical_sequence',
  'provenance_validated', 'provenance_applied', 'execution_authorized', 'execution_started', 'simulation',
  'production_blocked', 'validator_version'
]);

// created_from_reference_id/parent_reference_id are nullable: a root provenance reference (the
// first ever produced for a given authorization decision) has no prior reference to point to.
const NULLABLE_REFERENCE_FIELDS = Object.freeze(['created_from_reference_id', 'parent_reference_id']);

const REQUIRED_STRING_FIELDS = Object.freeze([
  'authorization_provenance_reference_id', 'authorization_decision_id', 'authorization_request_id',
  'authorization_policy_id', 'authorization_scope_id', 'actor_id', 'actor_role', 'approval_reference_id',
  'budget_authorization_id', 'expiration_evaluation_id', 'planning_result_id', 'plan_id', 'task_reference_id',
  'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'authorization_decision_fingerprint', 'authorization_request_fingerprint', 'authorization_policy_fingerprint',
  'authorization_scope_fingerprint', 'actor_fingerprint', 'approval_fingerprint',
  'budget_authorization_fingerprint', 'expiration_fingerprint', 'planning_result_fingerprint',
  'orchestration_plan_fingerprint', 'task_fingerprint', 'validator_version'
]);

// provenance_applied/execution_authorized/execution_started/simulation/production_blocked are the
// only fields this contract itself forces -- provenance_validated is a genuine boolean the caller
// (execution-reference-binding-validator.js) sets after cross-checking every id/version/
// fingerprint/binding this reference claims; this contract cannot verify that itself, since doing
// so requires data from the rest of the request it has no access to.
const AUTHORIZATION_PROVENANCE_REFERENCE_SAFE_FLAGS = Object.freeze({
  provenance_applied: false,
  execution_authorized: false,
  execution_started: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateAuthorizationProvenanceReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['authorization_provenance_reference_must_be_object'] };
  exactFields(reference, AUTHORIZATION_PROVENANCE_REFERENCE_FIELDS, 'authorization_provenance_reference', errors);
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!isOrderedUniqueStringList(reference.derived_from_reference_ids)) errors.push('derived_from_reference_ids_invalid');
  if (!Number.isInteger(reference.authorization_provenance_reference_version) || reference.authorization_provenance_reference_version < 1) {
    errors.push('authorization_provenance_reference_version_invalid');
  }
  if (!Number.isInteger(reference.logical_sequence) || reference.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (typeof reference.provenance_validated !== 'boolean') errors.push('provenance_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(AUTHORIZATION_PROVENANCE_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== AUTHORIZATION_PROVENANCE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAuthorizationProvenanceReference(input = {}) {
  const reference = {
    authorization_provenance_reference_id: input.authorization_provenance_reference_id,
    authorization_provenance_reference_version: Number.isInteger(input.authorization_provenance_reference_version) ? input.authorization_provenance_reference_version : 1,
    authorization_decision_id: input.authorization_decision_id,
    authorization_request_id: input.authorization_request_id,
    authorization_policy_id: input.authorization_policy_id,
    authorization_scope_id: input.authorization_scope_id,
    actor_id: input.actor_id,
    actor_role: input.actor_role,
    approval_reference_id: input.approval_reference_id,
    budget_authorization_id: input.budget_authorization_id,
    expiration_evaluation_id: input.expiration_evaluation_id,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    task_reference_id: input.task_reference_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    authorization_decision_fingerprint: input.authorization_decision_fingerprint,
    authorization_request_fingerprint: input.authorization_request_fingerprint,
    authorization_policy_fingerprint: input.authorization_policy_fingerprint,
    authorization_scope_fingerprint: input.authorization_scope_fingerprint,
    actor_fingerprint: input.actor_fingerprint,
    approval_fingerprint: input.approval_fingerprint,
    budget_authorization_fingerprint: input.budget_authorization_fingerprint,
    expiration_fingerprint: input.expiration_fingerprint,
    planning_result_fingerprint: input.planning_result_fingerprint,
    orchestration_plan_fingerprint: input.orchestration_plan_fingerprint,
    task_fingerprint: input.task_fingerprint,
    created_from_reference_id: input.created_from_reference_id === undefined ? null : input.created_from_reference_id,
    derived_from_reference_ids: Array.isArray(input.derived_from_reference_ids) ? input.derived_from_reference_ids : [],
    parent_reference_id: input.parent_reference_id === undefined ? null : input.parent_reference_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    provenance_validated: input.provenance_validated === true,
    provenance_applied: false,
    execution_authorized: false,
    execution_started: false,
    simulation: true,
    production_blocked: true,
    validator_version: AUTHORIZATION_PROVENANCE_REFERENCE_VALIDATOR_VERSION
  };

  const validation = validateAuthorizationProvenanceReference(reference);
  if (!validation.valid) {
    throw new Error(`authorization_provenance_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  AUTHORIZATION_PROVENANCE_REFERENCE_FIELDS,
  AUTHORIZATION_PROVENANCE_REFERENCE_SAFE_FLAGS,
  AUTHORIZATION_PROVENANCE_REFERENCE_VALIDATOR_VERSION,
  MAX_LIST_ITEMS,
  NULLABLE_REFERENCE_FIELDS,
  buildAuthorizationProvenanceReference,
  isOrderedUniqueStringList,
  validateAuthorizationProvenanceReference
};
