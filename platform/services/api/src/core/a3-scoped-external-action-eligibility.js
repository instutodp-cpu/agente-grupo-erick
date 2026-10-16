'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  READY: DURABLE_TARGET_READY,
  validateHermesMaintainerSafeWorkflowDurableTarget
} = require('./hermes-maintainer-safe-workflow-durable-target');
const {
  AUTHORIZED: MAINTAINER_AUTHORIZED,
  validateHermesMaintainerSingleUseAuthorization
} = require('./hermes-maintainer-single-use-execution-authorization');

// A3 is an eligibility boundary, never execution authority. The first supported adapter is
// intentionally narrow: it consumes the existing maintainer SCM approval + authorization +
// single-use authorization artifacts directly. New capability families require explicit code
// and tests; caller-supplied generic authority booleans are not accepted.
const CONTRACT_VERSION = 'hermes_a3_scoped_external_action_eligibility_v2';
const ELIGIBLE = 'A3_SCOPED_EXTERNAL_ACTION_ELIGIBLE';
const BLOCKED = 'A3_SCOPED_EXTERNAL_ACTION_BLOCKED';
const SOURCE_FAMILY = 'MAINTAINER_SCM_WRITE_SINGLE_USE_V1';
const CAPABILITY_ID = 'hermes-maintainer-scm-write';
const TARGET_TYPE = 'SCM_WRITE_TARGET';

const INPUT_FIELDS = Object.freeze([
  'eligibility_id', 'capability_id', 'environment', 'operation', 'target_reference',
  'action_intent_digest', 'operator_binding', 'source_evidence', 'cost_control',
  'protected_actions', 'evaluation_time'
]);
const TARGET_FIELDS = Object.freeze([
  'target_type', 'repository', 'base_ref', 'base_sha', 'branch_name', 'target_digest'
]);
const OPERATOR_FIELDS = Object.freeze([
  'operator_id', 'source_reference', 'identity_verified', 'scope_verified', 'operator_binding_digest'
]);
const SOURCE_EVIDENCE_FIELDS = Object.freeze([
  'family', 'approval_binding', 'authorization_grant', 'single_use_authorization', 'durable_target'
]);
const COST_FIELDS = Object.freeze(['requested_units', 'maximum_units']);
const PROTECTED_ACTION_FIELDS = Object.freeze([
  'merge_main', 'production_publish', 'financial_spend', 'customer_message',
  'destructive_action', 'secret_or_permission_change'
]);
const APPROVAL_BINDING_FIELDS = Object.freeze([
  'contract_version', 'status', 'approval_valid', 'intent_digest', 'operation', 'repository',
  'base_ref', 'branch_name', 'approval_reference', 'human_approval_required',
  'human_approval_present', 'execution_authorized', 'credential_material_present',
  'network_call_performed', 'write_performed', 'production_used', 'blockers'
]);
const AUTHORIZATION_GRANT_FIELDS = Object.freeze([
  'contract_version', 'status', 'authorization_valid', 'intent_digest', 'operation', 'repository',
  'base_ref', 'branch_name', 'approval_reference', 'authorization_reference',
  'human_approval_present', 'execution_authorized', 'authorization_consumed',
  'credential_material_present', 'network_call_performed', 'write_performed',
  'production_used', 'blockers'
]);
const SINGLE_USE_AUTHORIZATION_FIELDS = Object.freeze([
  'contract_version', 'authorization_id', 'mission_id', 'operation', 'repository', 'base_ref',
  'issued_at', 'expires_at', 'environment', 'single_use', 'status', 'execution_authorized',
  'consumed', 'revoked', 'authorization_fingerprint', 'production_allowed', 'executed', 'blockers'
]);
const DURABLE_TARGET_FIELDS = Object.freeze([
  'contract_version', 'mission_id', 'workflow_digest', 'intent_digest', 'authorization_binding_digest',
  'durable_operation', 'target_handoff_contract', 'ownership_key', 'attempt_reference', 'status',
  'target_prepared', 'target', 'execution_eligible', 'execution_authorized', 'network_authorized',
  'credentials_authorized', 'write_authorized', 'merge_authority', 'human_merge_required', 'simulation',
  'production_allowed', 'provider_called', 'secret_accessed', 'operational_authority_consumed', 'blockers'
]);
const DURABLE_TARGET_VALUE_FIELDS = Object.freeze([
  'operation', 'repository', 'base_ref', 'base_sha', 'branch_name'
]);

const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE_TARGET_TOKEN_PATTERN = /[*?\[\]{}]/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function digest(value) {
  return computeCanonicalContentDigest(JSON.parse(stablePayload(value)));
}

function computeA3TargetDigest(target) {
  return digest({
    target_type: target.target_type,
    repository: target.repository,
    base_ref: target.base_ref,
    base_sha: target.base_sha,
    branch_name: target.branch_name
  });
}

function computeA3OperatorBindingDigest(binding) {
  const { operator_binding_digest: ignored, ...material } = binding;
  return digest(material);
}

function exactSourceFields(value, fields, prefix, errors) {
  exactFields(value, fields, prefix, errors);
  if (!Array.isArray(value?.blockers)) errors.push(`${prefix}_blockers_invalid`);
}

function validateApprovalBinding(binding, errors) {
  exactSourceFields(binding, APPROVAL_BINDING_FIELDS, 'approval_binding', errors);
  if (binding?.contract_version !== 'hermes_maintainer_scm_write_approval_binding_v1') errors.push('approval_binding_contract_invalid');
  if (binding?.status !== 'SCM_WRITE_APPROVAL_BOUND' || binding?.approval_valid !== true) errors.push('approval_binding_not_approved');
  if (!isCanonicalContentDigest(binding?.intent_digest)) errors.push('approval_binding_intent_digest_invalid');
  for (const field of ['operation', 'repository', 'base_ref', 'branch_name', 'approval_reference']) {
    if (!isNonEmptyString(binding?.[field])) errors.push(`approval_binding_${field}_invalid`);
  }
  if (binding?.human_approval_required !== true || binding?.human_approval_present !== true) errors.push('approval_binding_human_approval_required');
  if (binding?.execution_authorized !== false) errors.push('approval_binding_execution_authority_forbidden');
  for (const field of ['credential_material_present', 'network_call_performed', 'write_performed', 'production_used']) {
    if (binding?.[field] !== false) errors.push(`approval_binding_${field}_must_be_false`);
  }
  if (Array.isArray(binding?.blockers) && binding.blockers.length !== 0) errors.push('approval_binding_has_blockers');
}

function validateAuthorizationGrant(grant, approval, errors) {
  exactSourceFields(grant, AUTHORIZATION_GRANT_FIELDS, 'authorization_grant', errors);
  if (grant?.contract_version !== 'hermes_maintainer_scm_write_authorization_grant_v1') errors.push('authorization_grant_contract_invalid');
  if (grant?.status !== 'SCM_WRITE_AUTHORIZATION_GRANTED' || grant?.authorization_valid !== true) errors.push('authorization_grant_not_authorized');
  if (!isCanonicalContentDigest(grant?.intent_digest)) errors.push('authorization_grant_intent_digest_invalid');
  for (const field of ['operation', 'repository', 'base_ref', 'branch_name', 'approval_reference', 'authorization_reference']) {
    if (!isNonEmptyString(grant?.[field])) errors.push(`authorization_grant_${field}_invalid`);
  }
  if (grant?.intent_digest !== approval?.intent_digest) errors.push('approval_authorization_intent_mismatch');
  for (const field of ['operation', 'repository', 'base_ref', 'branch_name', 'approval_reference']) {
    if (grant?.[field] !== approval?.[field]) errors.push(`approval_authorization_${field}_mismatch`);
  }
  if (grant?.human_approval_present !== true || grant?.execution_authorized !== true) errors.push('authorization_grant_state_invalid');
  if (grant?.authorization_consumed !== false) errors.push('authorization_grant_already_consumed');
  for (const field of ['credential_material_present', 'network_call_performed', 'write_performed', 'production_used']) {
    if (grant?.[field] !== false) errors.push(`authorization_grant_${field}_must_be_false`);
  }
  if (Array.isArray(grant?.blockers) && grant.blockers.length !== 0) errors.push('authorization_grant_has_blockers');
}

function validateSingleUseAuthorization(authorization, grant, evaluationTime, errors) {
  exactSourceFields(authorization, SINGLE_USE_AUTHORIZATION_FIELDS, 'single_use_authorization', errors);
  const validation = validateHermesMaintainerSingleUseAuthorization(authorization);
  if (!validation.valid) errors.push(...validation.errors.map(error => `single_use_authorization_invalid::${error}`));
  if (authorization?.status !== MAINTAINER_AUTHORIZED || authorization?.execution_authorized !== true) errors.push('single_use_authorization_not_authorized');
  if (authorization?.environment !== 'staging' || authorization?.single_use !== true) errors.push('single_use_authorization_scope_invalid');
  if (authorization?.consumed !== false) errors.push('single_use_authorization_already_consumed');
  if (authorization?.revoked !== false) errors.push('single_use_authorization_revoked');
  if (authorization?.production_allowed !== false || authorization?.executed !== false) errors.push('single_use_authorization_execution_boundary_invalid');
  for (const field of ['operation', 'repository', 'base_ref']) {
    if (authorization?.[field] !== grant?.[field]) errors.push(`authorization_chain_${field}_mismatch`);
  }
  if (isCanonicalTimestamp(evaluationTime) && isCanonicalTimestamp(authorization?.expires_at)
    && Date.parse(authorization.expires_at) <= Date.parse(evaluationTime)) errors.push('single_use_authorization_expired');
}


function validateDurableTarget(durableTarget, approval, grant, targetReference, errors) {
  if (!isPlainObject(durableTarget)) {
    errors.push('durable_target_must_be_object');
    return;
  }
  exactSourceFields(durableTarget, DURABLE_TARGET_FIELDS, 'durable_target', errors);
  if (!isPlainObject(durableTarget.target)) errors.push('durable_target_value_must_be_object');
  else exactFields(durableTarget.target, DURABLE_TARGET_VALUE_FIELDS, 'durable_target_value', errors);
  const validation = validateHermesMaintainerSafeWorkflowDurableTarget(durableTarget);
  if (!validation.valid) errors.push(...validation.errors.map(error => `durable_target_invalid::${error}`));
  if (durableTarget?.status !== DURABLE_TARGET_READY || durableTarget?.target_prepared !== true) errors.push('durable_target_not_prepared');
  if (!isCanonicalContentDigest(durableTarget?.workflow_digest)) errors.push('durable_target_workflow_digest_invalid');
  if (!isCanonicalContentDigest(durableTarget?.authorization_binding_digest)) errors.push('durable_target_authorization_binding_digest_invalid');
  if (durableTarget?.intent_digest !== approval?.intent_digest || durableTarget?.intent_digest !== grant?.intent_digest) errors.push('durable_target_intent_mismatch');
  if (durableTarget?.durable_operation !== 'create_branch') errors.push('durable_target_operation_invalid');
  if (durableTarget?.target_handoff_contract !== 'hermes_maintainer_scm_write_durable_admission_handoff_v1') errors.push('durable_target_handoff_contract_invalid');
  const target = durableTarget?.target;
  if (target?.operation !== 'create_branch') errors.push('durable_target_value_operation_invalid');
  for (const field of ['repository', 'base_ref', 'base_sha', 'branch_name']) {
    if (target?.[field] !== targetReference?.[field]) errors.push(`durable_target_${field}_mismatch`);
  }
  if (Array.isArray(durableTarget?.blockers) && durableTarget.blockers.length !== 0) errors.push('durable_target_has_blockers');
}

function validateA3ScopedExternalActionEligibilityInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return { valid: false, errors: ['eligibility_input_must_be_object'] };
  exactFields(input, INPUT_FIELDS, 'eligibility_input', errors);

  if (!isIdentifier(input.eligibility_id)) errors.push('eligibility_id_invalid');
  if (input.capability_id !== CAPABILITY_ID) errors.push('capability_not_supported');
  if (input.environment !== 'staging') errors.push('environment_must_be_staging');
  if (!isIdentifier(input.operation)) errors.push('operation_invalid');
  if (!isCanonicalTimestamp(input.evaluation_time)) errors.push('evaluation_time_invalid');
  if (!isCanonicalContentDigest(input.action_intent_digest)) errors.push('action_intent_digest_invalid');

  exactFields(input.target_reference, TARGET_FIELDS, 'target_reference', errors);
  if (input.target_reference?.target_type !== TARGET_TYPE) errors.push('target_type_not_supported');
  for (const field of ['repository', 'base_ref', 'branch_name']) {
    if (!isNonEmptyString(input.target_reference?.[field]) || UNSAFE_TARGET_TOKEN_PATTERN.test(input.target_reference?.[field] || '')) errors.push(`target_${field}_invalid`);
  }
  if (!SHA_PATTERN.test(input.target_reference?.base_sha || '')) errors.push('target_base_sha_invalid');
  if (!isCanonicalContentDigest(input.target_reference?.target_digest)) errors.push('target_digest_invalid');
  else if (input.target_reference.target_digest !== computeA3TargetDigest(input.target_reference)) errors.push('target_digest_mismatch');

  exactFields(input.operator_binding, OPERATOR_FIELDS, 'operator_binding', errors);
  if (!isIdentifier(input.operator_binding?.operator_id)) errors.push('operator_id_invalid');
  if (!isIdentifier(input.operator_binding?.source_reference)) errors.push('operator_source_reference_invalid');
  if (input.operator_binding?.identity_verified !== true) errors.push('operator_identity_not_verified');
  if (input.operator_binding?.scope_verified !== true) errors.push('operator_scope_not_verified');
  if (!isCanonicalContentDigest(input.operator_binding?.operator_binding_digest)) errors.push('operator_binding_digest_invalid');
  else if (input.operator_binding.operator_binding_digest !== computeA3OperatorBindingDigest(input.operator_binding)) errors.push('operator_binding_digest_mismatch');

  exactFields(input.source_evidence, SOURCE_EVIDENCE_FIELDS, 'source_evidence', errors);
  if (input.source_evidence?.family !== SOURCE_FAMILY) errors.push('source_evidence_family_not_supported');
  const approval = input.source_evidence?.approval_binding;
  const grant = input.source_evidence?.authorization_grant;
  const singleUse = input.source_evidence?.single_use_authorization;
  const durableTarget = input.source_evidence?.durable_target;
  validateApprovalBinding(approval, errors);
  validateAuthorizationGrant(grant, approval, errors);
  validateSingleUseAuthorization(singleUse, grant, input.evaluation_time, errors);
  validateDurableTarget(durableTarget, approval, grant, input.target_reference, errors);

  if (isCanonicalContentDigest(input.action_intent_digest) && input.action_intent_digest !== approval?.intent_digest) errors.push('action_intent_not_bound_to_official_approval');
  if (input.operation !== approval?.operation || input.operation !== grant?.operation || input.operation !== singleUse?.operation) errors.push('operation_not_bound_to_authorization_chain');
  for (const field of ['repository', 'base_ref', 'branch_name']) {
    if (input.target_reference?.[field] !== grant?.[field]) errors.push(`target_${field}_not_bound_to_authorization_grant`);
  }
  if (input.target_reference?.repository !== singleUse?.repository || input.target_reference?.base_ref !== singleUse?.base_ref) errors.push('target_not_bound_to_single_use_authorization');

  exactFields(input.cost_control, COST_FIELDS, 'cost_control', errors);
  if (!Number.isInteger(input.cost_control?.requested_units) || input.cost_control.requested_units < 0) errors.push('requested_cost_units_invalid');
  if (!Number.isInteger(input.cost_control?.maximum_units) || input.cost_control.maximum_units < 0) errors.push('maximum_cost_units_invalid');
  if (Number.isInteger(input.cost_control?.requested_units) && Number.isInteger(input.cost_control?.maximum_units)
    && input.cost_control.requested_units > input.cost_control.maximum_units) errors.push('cost_budget_exceeded');

  exactFields(input.protected_actions, PROTECTED_ACTION_FIELDS, 'protected_actions', errors);
  for (const field of PROTECTED_ACTION_FIELDS) if (input.protected_actions?.[field] !== false) errors.push(`a4_boundary_forbidden::${field}`);

  try { stablePayload(input); } catch (error) { errors.push(`eligibility_input_not_canonical::${error.message}`); }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateA3ScopedExternalActionEligibility(input = {}) {
  const validation = validateA3ScopedExternalActionEligibilityInput(input);
  const eligible = validation.valid;
  const result = {
    contract_version: CONTRACT_VERSION,
    eligibility_id: isNonEmptyString(input.eligibility_id) ? input.eligibility_id : null,
    status: eligible ? ELIGIBLE : BLOCKED,
    a3_eligible: eligible,
    capability_id: input.capability_id === CAPABILITY_ID ? CAPABILITY_ID : null,
    environment: input.environment === 'staging' ? 'staging' : null,
    operation: isNonEmptyString(input.operation) ? input.operation : null,
    action_intent_digest: isCanonicalContentDigest(input.action_intent_digest) ? input.action_intent_digest : null,
    approval_reference: isNonEmptyString(input.source_evidence?.approval_binding?.approval_reference) ? input.source_evidence.approval_binding.approval_reference : null,
    authorization_reference: isNonEmptyString(input.source_evidence?.authorization_grant?.authorization_reference) ? input.source_evidence.authorization_grant.authorization_reference : null,
    single_use_authorization_id: isNonEmptyString(input.source_evidence?.single_use_authorization?.authorization_id) ? input.source_evidence.single_use_authorization.authorization_id : null,
    durable_target_contract: input.source_evidence?.durable_target?.contract_version === 'hermes_maintainer_safe_workflow_durable_target_v1' ? input.source_evidence.durable_target.contract_version : null,
    base_sha: SHA_PATTERN.test(input.target_reference?.base_sha || '') ? input.target_reference.base_sha : null,
    single_use_required: true,
    authorization_consumed: input.source_evidence?.single_use_authorization?.consumed === true,
    authorization_revoked: input.source_evidence?.single_use_authorization?.revoked === true,
    execution_authorized: false,
    execution_started: false,
    executed: false,
    provider_invoked: false,
    external_network_called: false,
    production_allowed: false,
    a4_authority_granted: false,
    blockers: validation.valid ? [] : validation.errors,
    eligibility_fingerprint: null
  };
  result.eligibility_fingerprint = digest({ ...result, eligibility_fingerprint: null });
  return cloneFrozen(result);
}

module.exports = {
  BLOCKED,
  CAPABILITY_ID,
  CONTRACT_VERSION,
  ELIGIBLE,
  PROTECTED_ACTION_FIELDS,
  SOURCE_FAMILY,
  TARGET_TYPE,
  computeA3OperatorBindingDigest,
  computeA3TargetDigest,
  evaluateA3ScopedExternalActionEligibility,
  validateA3ScopedExternalActionEligibilityInput
};
