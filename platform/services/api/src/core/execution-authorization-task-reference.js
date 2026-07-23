'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { TASK_COMPLEXITIES, TASK_TYPES } = require('./orchestrator-task-definition');
const { RISK_CLASSIFICATIONS } = require('./execution-authorization-scope');

const EXECUTION_AUTHORIZATION_TASK_REFERENCE_VALIDATOR_VERSION = 'execution_authorization_task_reference_validator_v1';

const EXECUTION_AUTHORIZATION_TASK_REFERENCE_FIELDS = Object.freeze([
  'task_reference_id', 'task_reference_version', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id',
  'organization_id', 'project_id', 'session_reference_id', 'task_id', 'task_version', 'task_type',
  'task_complexity', 'risk_classification', 'data_classification', 'requires_human_approval',
  'external_side_effect_reference', 'irreversible_reference', 'task_fingerprint', 'logical_sequence',
  'simulation', 'production_blocked', 'validator_version'
]);

// Neither external side effects nor irreversible references are supported at all yet -- not even
// declaratively -- matching execution-authorization-policy.js's own analogous forced-false flags.
const EXECUTION_AUTHORIZATION_TASK_REFERENCE_SAFE_FLAGS = Object.freeze({
  external_side_effect_reference: false,
  irreversible_reference: false,
  simulation: true,
  production_blocked: true
});

function validateExecutionAuthorizationTaskReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_authorization_task_reference_must_be_object'] };
  exactFields(reference, EXECUTION_AUTHORIZATION_TASK_REFERENCE_FIELDS, 'execution_authorization_task_reference', errors);
  for (const field of [
    'task_reference_id', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'task_id', 'task_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.task_reference_version) || reference.task_reference_version < 1) errors.push('task_reference_version_invalid');
  if (!Number.isInteger(reference.task_version) || reference.task_version < 1) errors.push('task_version_invalid');
  if (!TASK_TYPES.includes(reference.task_type)) errors.push(`task_type_not_allowed::${reference.task_type}`);
  if (!TASK_COMPLEXITIES.includes(reference.task_complexity)) errors.push(`task_complexity_not_allowed::${reference.task_complexity}`);
  if (!RISK_CLASSIFICATIONS.includes(reference.risk_classification)) errors.push(`risk_classification_not_allowed::${reference.risk_classification}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(reference.data_classification)) errors.push(`data_classification_not_allowed::${reference.data_classification}`);
  if (typeof reference.requires_human_approval !== 'boolean') errors.push('requires_human_approval_must_be_boolean');
  for (const [field, expected] of Object.entries(EXECUTION_AUTHORIZATION_TASK_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (!Number.isInteger(reference.logical_sequence) || reference.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (reference.validator_version !== EXECUTION_AUTHORIZATION_TASK_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeTaskReferenceFingerprint(reference) {
  const { task_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function buildExecutionAuthorizationTaskReference(input = {}) {
  const reference = {
    task_reference_id: input.task_reference_id,
    task_reference_version: Number.isInteger(input.task_reference_version) ? input.task_reference_version : 1,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    task_id: input.task_id,
    task_version: Number.isInteger(input.task_version) ? input.task_version : 1,
    task_type: input.task_type,
    task_complexity: input.task_complexity,
    risk_classification: input.risk_classification,
    data_classification: input.data_classification,
    requires_human_approval: input.requires_human_approval === true,
    external_side_effect_reference: false,
    irreversible_reference: false,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: EXECUTION_AUTHORIZATION_TASK_REFERENCE_VALIDATOR_VERSION
  };
  reference.task_fingerprint = computeTaskReferenceFingerprint({ ...reference, task_fingerprint: undefined });

  const validation = validateExecutionAuthorizationTaskReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_authorization_task_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  EXECUTION_AUTHORIZATION_TASK_REFERENCE_FIELDS,
  EXECUTION_AUTHORIZATION_TASK_REFERENCE_SAFE_FLAGS,
  EXECUTION_AUTHORIZATION_TASK_REFERENCE_VALIDATOR_VERSION,
  buildExecutionAuthorizationTaskReference,
  computeTaskReferenceFingerprint,
  validateExecutionAuthorizationTaskReference
};
