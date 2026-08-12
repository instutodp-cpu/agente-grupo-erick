'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  PLAN_VERSION,
  validateHermesVpsProvisioningPlan
} = require('./hermes-vps-provisioning-plan');

const CONTRACT_VERSION = 'hermes-vps-execution-authorization-contract-v1';
const AUTHORIZATION_STATES = Object.freeze([
  'NOT_AUTHORIZED', 'AUTHORIZED', 'EXPIRED', 'REVOKED', 'ALREADY_CONSUMED', 'PLAN_MISMATCH', 'INVALID'
]);
const REVOCATION_STATES = Object.freeze(['NOT_REVOKED', 'REVOKED']);
const CONSUMPTION_STATES = Object.freeze(['UNCONSUMED', 'CONSUMED']);
const SINGLE_USE_POLICIES = Object.freeze(['SINGLE_USE']);
const MATERIAL_FIELDS = Object.freeze([
  'contract_version', 'authorization_id', 'provisioning_plan_reference', 'provisioning_plan_hash',
  'issued_at', 'expires_at', 'issued_by', 'execution_scope', 'environment', 'target_reference',
  'single_use', 'provenance'
]);
const ALL_FIELDS = Object.freeze([
  ...MATERIAL_FIELDS, 'authorization_state', 'execution_authorized', 'consumption', 'revocation',
  'binding_hash', 'authorization_hash'
]);

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${prefix}_unknown_field::${key}`);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_field::${field}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return computeCanonicalContentDigest(JSON.parse(stablePayload(value)));
}

function withoutHashes(value) {
  const copy = clone(value);
  delete copy.binding_hash;
  delete copy.authorization_hash;
  return copy;
}

function bindingMaterial(authorization) {
  return MATERIAL_FIELDS.reduce((result, field) => {
    result[field] = authorization[field];
    return result;
  }, {});
}

function computeAuthorizationBindingHash(authorization) {
  return digest(bindingMaterial(authorization));
}

function computeAuthorizationHash(authorization) {
  return digest(withoutHashes(authorization));
}

function validIso(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateLifecycleRecords(records, kind) {
  if (records === undefined) return { valid: true };
  if (!Array.isArray(records)) return { valid: false, reason: `${kind}_records_must_be_array` };
  const seen = new Set();
  for (const record of records) {
    if (!isPlainObject(record) || !isNonEmptyString(record.authorization_id) || !isNonEmptyString(record.reference_id)) return { valid: false, reason: `${kind}_record_invalid` };
    if (seen.has(record.authorization_id)) return { valid: false, reason: `${kind}_records_ambiguous` };
    seen.add(record.authorization_id);
  }
  return { valid: true };
}

function validateExecutionScopeAgainstPlan(scope, provisioningPlan) {
  if (!provisioningPlan) return { valid: false, reason: 'provisioning_plan_required' };
  if (!Array.isArray(provisioningPlan.phases) || !Array.isArray(provisioningPlan.ordered_steps)) return { valid: false, reason: 'provisioning_plan_malformed' };
  const phaseIds = new Set(provisioningPlan.phases.map((phase) => phase.phase_id));
  const steps = new Map(provisioningPlan.ordered_steps.map((step) => [step.id, step.phase]));
  if (!Array.isArray(scope.phase_ids) || !Array.isArray(scope.step_ids) || scope.phase_ids.length === 0 || scope.step_ids.length === 0) return { valid: false, reason: 'execution_scope_must_be_non_empty' };
  if (new Set(scope.phase_ids).size !== scope.phase_ids.length || new Set(scope.step_ids).size !== scope.step_ids.length) return { valid: false, reason: 'execution_scope_ambiguous' };
  if (scope.phase_ids.some((id) => !phaseIds.has(id)) || scope.step_ids.some((id) => !steps.has(id))) return { valid: false, reason: 'execution_scope_unknown' };
  if (scope.step_ids.some((id) => !scope.phase_ids.includes(steps.get(id)))) return { valid: false, reason: 'execution_scope_phase_step_mismatch' };
  return { valid: true };
}

function validateHermesVpsExecutionAuthorizationContract(authorization, provisioningPlan = null) {
  const errors = [];
  if (!isPlainObject(authorization)) return { valid: false, errors: ['authorization_must_be_object'] };
  exactFields(authorization, ALL_FIELDS, 'authorization', errors);
  exactFields(authorization.provisioning_plan_reference, ['plan_version', 'plan_hash', 'target_host_role', 'environment'], 'plan_reference', errors);
  exactFields(authorization.issued_by, ['authority_id', 'authority_type'], 'issued_by', errors);
  exactFields(authorization.execution_scope, ['phase_ids', 'step_ids', 'operation', 'provider_allowed', 'network_allowed', 'shell_allowed', 'production_allowed'], 'execution_scope', errors);
  exactFields(authorization.target_reference, ['target_id', 'target_environment'], 'target_reference', errors);
  exactFields(authorization.single_use, ['policy', 'required'], 'single_use', errors);
  exactFields(authorization.consumption, ['state', 'reference'], 'consumption', errors);
  exactFields(authorization.revocation, ['state', 'reference'], 'revocation', errors);
  exactFields(authorization.provenance, ['repository', 'branch', 'commit_sha', 'plan_hash'], 'provenance', errors);

  if (authorization.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!isNonEmptyString(authorization.authorization_id)) errors.push('authorization_id_invalid');
  if (authorization.provisioning_plan_reference?.plan_version !== PLAN_VERSION) errors.push('plan_version_invalid');
  if (!isCanonicalContentDigest(authorization.provisioning_plan_hash) || authorization.provisioning_plan_reference?.plan_hash !== authorization.provisioning_plan_hash) errors.push('provisioning_plan_hash_invalid');
  if (authorization.provisioning_plan_reference?.target_host_role !== 'hermes_execution_plane') errors.push('target_host_role_invalid');
  if (authorization.provisioning_plan_reference?.environment !== 'staging' || authorization.environment !== 'staging') errors.push('environment_must_be_staging');
  if (!validIso(authorization.issued_at) || !validIso(authorization.expires_at) || Date.parse(authorization.expires_at) <= Date.parse(authorization.issued_at)) errors.push('authorization_window_invalid');
  if (!isNonEmptyString(authorization.issued_by?.authority_id) || !isNonEmptyString(authorization.issued_by?.authority_type)) errors.push('issuer_invalid');
  if (!Array.isArray(authorization.execution_scope?.phase_ids) || !Array.isArray(authorization.execution_scope?.step_ids) || authorization.execution_scope.phase_ids.length === 0 || authorization.execution_scope.step_ids.length === 0) errors.push('execution_scope_must_be_non_empty');
  if (authorization.execution_scope?.provider_allowed !== false || authorization.execution_scope?.network_allowed !== false || authorization.execution_scope?.shell_allowed !== false || authorization.execution_scope?.production_allowed !== false) errors.push('unsafe_execution_scope');
  if (authorization.execution_scope?.operation !== 'provisioning_plan_handoff') errors.push('operation_invalid');
  if (!isNonEmptyString(authorization.target_reference?.target_id) || authorization.target_reference?.target_environment !== 'staging') errors.push('target_reference_invalid');
  if (authorization.single_use?.policy !== 'SINGLE_USE' || authorization.single_use?.required !== true) errors.push('single_use_required');
  if (!CONSUMPTION_STATES.includes(authorization.consumption?.state) || authorization.consumption?.reference !== null && (!isPlainObject(authorization.consumption?.reference) || authorization.consumption.reference.authorization_id !== authorization.authorization_id || !isNonEmptyString(authorization.consumption.reference.reference_id))) errors.push('consumption_invalid');
  if (!REVOCATION_STATES.includes(authorization.revocation?.state) || authorization.revocation?.reference !== null && (!isPlainObject(authorization.revocation?.reference) || authorization.revocation.reference.authorization_id !== authorization.authorization_id || !isNonEmptyString(authorization.revocation.reference.reference_id))) errors.push('revocation_invalid');
  if (authorization.authorization_state === 'AUTHORIZED' && authorization.execution_authorized !== true) errors.push('authorized_state_requires_explicit_flag');
  if (authorization.authorization_state !== 'AUTHORIZED' && authorization.execution_authorized === true) errors.push('execution_flag_requires_authorized_state');
  if (!AUTHORIZATION_STATES.includes(authorization.authorization_state)) errors.push('authorization_state_invalid');
  if (!isNonEmptyString(authorization.provenance?.repository) || !isNonEmptyString(authorization.provenance?.branch) || !/^[0-9a-f]{40}$/.test(authorization.provenance?.commit_sha || '') || authorization.provenance?.plan_hash !== authorization.provisioning_plan_hash) errors.push('provenance_invalid');
  if (!isCanonicalContentDigest(authorization.binding_hash) || authorization.binding_hash !== computeAuthorizationBindingHash(authorization)) errors.push('binding_hash_invalid');
  if (!isCanonicalContentDigest(authorization.authorization_hash) || authorization.authorization_hash !== computeAuthorizationHash(authorization)) errors.push('authorization_hash_invalid');
  if (provisioningPlan) {
    const planValidation = validateHermesVpsProvisioningPlan(provisioningPlan);
    if (!planValidation.valid || provisioningPlan.plan_hash !== authorization.provisioning_plan_hash) errors.push('provisioning_plan_incompatible');
    const scopeValidation = validateExecutionScopeAgainstPlan(authorization.execution_scope, provisioningPlan);
    if (!scopeValidation.valid) errors.push(scopeValidation.reason);
  }
  try { stablePayload(authorization); } catch (error) { errors.push(`canonical_serialization_invalid::${error.message}`); }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildHermesVpsExecutionAuthorization({ provisioning_plan, authorization_id, issued_at, expires_at, issued_by, target_id, phase_ids, step_ids, provenance }) {
  if (!provisioning_plan || !validateHermesVpsProvisioningPlan(provisioning_plan).valid) throw new Error('provisioning_plan_invalid');
  const authorization = {
    contract_version: CONTRACT_VERSION,
    authorization_id,
    provisioning_plan_reference: {
      plan_version: PLAN_VERSION,
      plan_hash: provisioning_plan.plan_hash,
      target_host_role: provisioning_plan.target_host_role,
      environment: provisioning_plan.environment
    },
    provisioning_plan_hash: provisioning_plan.plan_hash,
    authorization_state: 'AUTHORIZED',
    execution_authorized: true,
    issued_at,
    expires_at,
    issued_by,
    execution_scope: {
      phase_ids: [...phase_ids],
      step_ids: [...step_ids],
      operation: 'provisioning_plan_handoff',
      provider_allowed: false,
      network_allowed: false,
      shell_allowed: false,
      production_allowed: false
    },
    environment: provisioning_plan.environment,
    target_reference: { target_id, target_environment: provisioning_plan.environment },
    single_use: { policy: 'SINGLE_USE', required: true },
    consumption: { state: 'UNCONSUMED', reference: null },
    revocation: { state: 'NOT_REVOKED', reference: null },
    provenance: { ...provenance, plan_hash: provisioning_plan.plan_hash },
    binding_hash: 'pending',
    authorization_hash: 'pending'
  };
  authorization.binding_hash = computeAuthorizationBindingHash(authorization);
  authorization.authorization_hash = computeAuthorizationHash(authorization);
  const result = validateHermesVpsExecutionAuthorizationContract(authorization, provisioning_plan);
  if (!result.valid) throw new Error(`authorization_construction_invalid::${result.errors.join(',')}`);
  return Object.freeze(authorization);
}

function evaluateHermesVpsExecutionAuthorization(authorization, context = {}) {
  if (!authorization) return { status: 'NOT_AUTHORIZED', execution_authorized: false, reason: 'authorization_missing' };
  const validation = validateHermesVpsExecutionAuthorizationContract(authorization, context.provisioning_plan);
  if (!validation.valid) return { status: 'INVALID', execution_authorized: false, reason: 'authorization_invalid', errors: validation.errors };
  if (!context.provisioning_plan) return { status: 'INVALID', execution_authorized: false, reason: 'provisioning_plan_required' };
  if (context.provisioning_plan.plan_hash !== authorization.provisioning_plan_hash || context.provisioning_plan.plan_version !== authorization.provisioning_plan_reference.plan_version) return { status: 'PLAN_MISMATCH', execution_authorized: false, reason: 'provisioning_plan_mismatch' };
  const requestedScope = context.execution_scope;
  if (!isPlainObject(requestedScope) || !isNonEmptyString(requestedScope.phase_id) || !isNonEmptyString(requestedScope.step_id)) return { status: 'INVALID', execution_authorized: false, reason: 'execution_scope_required' };
  if (!authorization.execution_scope.phase_ids.includes(requestedScope.phase_id) || !authorization.execution_scope.step_ids.includes(requestedScope.step_id) || context.provisioning_plan.ordered_steps.find((step) => step.id === requestedScope.step_id)?.phase !== requestedScope.phase_id) return { status: 'PLAN_MISMATCH', execution_authorized: false, reason: 'execution_scope_mismatch' };
  if (!validIso(context.now)) return { status: 'INVALID', execution_authorized: false, reason: 'current_time_required' };
  const revocationRecords = validateLifecycleRecords(context.revocation_records, 'revocation');
  const consumptionRecords = validateLifecycleRecords(context.consumption_records, 'consumption');
  if (!revocationRecords.valid || !consumptionRecords.valid) return { status: 'INVALID', execution_authorized: false, reason: revocationRecords.reason || consumptionRecords.reason };
  if (authorization.revocation.state === 'REVOKED' || context.revocation_records?.some((record) => record.authorization_id === authorization.authorization_id)) return { status: 'REVOKED', execution_authorized: false, reason: 'authorization_revoked' };
  if (Date.parse(authorization.expires_at) <= Date.parse(context.now || '')) return { status: 'EXPIRED', execution_authorized: false, reason: 'authorization_expired' };
  if (authorization.single_use.required && (authorization.consumption.state === 'CONSUMED' || context.consumption_records?.some((record) => record.authorization_id === authorization.authorization_id))) return { status: 'ALREADY_CONSUMED', execution_authorized: false, reason: 'single_use_already_consumed' };
  if (authorization.authorization_state !== 'AUTHORIZED' || authorization.execution_authorized !== true) return { status: 'NOT_AUTHORIZED', execution_authorized: false, reason: 'explicit_authorization_not_valid' };
  return { status: 'AUTHORIZED', execution_authorized: true, reason: 'authorization_valid' };
}

module.exports = {
  ALL_FIELDS,
  AUTHORIZATION_STATES,
  CONTRACT_VERSION,
  CONSUMPTION_STATES,
  REVOCATION_STATES,
  SINGLE_USE_POLICIES,
  buildHermesVpsExecutionAuthorization,
  computeAuthorizationBindingHash,
  computeAuthorizationHash,
  evaluateHermesVpsExecutionAuthorization,
  validateHermesVpsExecutionAuthorizationContract
};
