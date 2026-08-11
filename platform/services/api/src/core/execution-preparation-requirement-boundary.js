'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateExecutionAuthorizationRequest } = require('./execution-authorization-request');
const { evaluateExecutionAuthorizationRequest } = require('./execution-authorization-boundary');
const { validateExecutionAuthorizationDecision } = require('./execution-authorization-decision');

const EXECUTION_PREPARATION_REQUIREMENTS_VALIDATOR_VERSION =
  'execution_preparation_requirements_validator_v1';
const EXECUTION_PREPARATION_ELIGIBILITY_VALIDATOR_VERSION =
  'execution_preparation_eligibility_validator_v1';

const EXECUTION_PREPARATION_REQUIREMENT_STATUSES = Object.freeze([
  'REQUIRED_SATISFIED',
  'REQUIRED_UNSATISFIED',
  'NOT_APPLICABLE'
]);

const EXECUTION_PREPARATION_ELIGIBILITY_STATUSES = Object.freeze([
  'EXECUTION_PREPARATION_ELIGIBLE_SIMULATION',
  'EXECUTION_PREPARATION_BLOCKED',
  'EXECUTION_PREPARATION_VALIDATION_FAILED'
]);

const EXECUTION_PREPARATION_ELIGIBILITY_DECISIONS = Object.freeze([
  'ENTER_EXECUTION_PREPARATION_SIMULATION',
  'BLOCKED'
]);

const EXECUTION_PREPARATION_ELIGIBILITY_NEXT_STATES = Object.freeze([
  'WAITING_EXECUTION_PREPARATION_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const PREPARATION_OUTCOMES = Object.freeze({
  EXECUTION_PREPARATION_ELIGIBLE_SIMULATION: {
    decision: 'ENTER_EXECUTION_PREPARATION_SIMULATION',
    next_state: 'WAITING_EXECUTION_PREPARATION_REFERENCE'
  },
  EXECUTION_PREPARATION_BLOCKED: {
    decision: 'BLOCKED',
    next_state: 'BLOCKED_REFERENCE'
  },
  EXECUTION_PREPARATION_VALIDATION_FAILED: {
    decision: 'BLOCKED',
    next_state: 'BLOCKED_REFERENCE'
  }
});

const EXECUTION_PREPARATION_REQUIREMENTS_FIELDS = Object.freeze([
  'preparation_requirements_id',
  'preparation_requirements_version',
  'preparation_requirements_fingerprint',
  'authorization_request_id',
  'authorization_request_fingerprint',
  'authorization_decision_id',
  'authorization_decision_fingerprint',
  'admission_authorization_binding_id',
  'admission_authorization_binding_fingerprint',
  'tenant_id',
  'organization_id',
  'project_id',
  'actor_id',
  'task_reference_id',
  'approval_reference_id',
  'target_reference',
  'environment_reference',
  'authorization_validity_requirement',
  'provider_requirement',
  'network_requirement',
  'secret_requirement',
  'runtime_requirement',
  'budget_requirement',
  'expiration_requirement',
  'idempotency_requirement',
  'kill_switch_requirement',
  'audit_requirement',
  'validator_version'
]);

const TARGET_REFERENCE_FIELDS = Object.freeze([
  'required',
  'status',
  'target_class',
  'target_reference_id',
  'target_fingerprint'
]);

const ENVIRONMENT_REFERENCE_FIELDS = Object.freeze([
  'required',
  'status',
  'environment_class',
  'environment_reference_id',
  'environment_fingerprint',
  'production'
]);

const AUTHORIZATION_VALIDITY_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'authorization_revoked',
  'authorization_stale',
  'expected_registry_version',
  'observed_registry_version'
]);

const PROVIDER_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'provider_class',
  'provider_reference_id',
  'provider_fingerprint',
  'provider_called'
]);

const NETWORK_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'network_policy_reference_id',
  'destination_class',
  'network_policy_fingerprint',
  'network_used'
]);

const SECRET_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'secret_policy_reference_id',
  'secret_reference_id',
  'secret_reference_fingerprint',
  'secret_resolved',
  'secret_material_exposed'
]);

const RUNTIME_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'runtime_capability_reference_id',
  'runtime_capability_fingerprint',
  'runtime_enabled',
  'worker_started',
  'queue_mutated',
  'scheduler_mutated',
  'dispatch_executed'
]);

const BUDGET_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'budget_authorization_id',
  'budget_fingerprint',
  'within_limits',
  'budget_consumed'
]);

const EXPIRATION_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'expiration_evaluation_id',
  'expiration_fingerprint',
  'expired_logically',
  'clock_accessed'
]);

const IDEMPOTENCY_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'idempotency_key_reference',
  'idempotency_fingerprint',
  'replay_allowed',
  'duplicate_execution_blocked',
  'idempotency_consumed'
]);

const KILL_SWITCH_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'kill_switch_reference_id',
  'kill_switch_fingerprint',
  'kill_switch_active'
]);

const AUDIT_REQUIREMENT_FIELDS = Object.freeze([
  'required',
  'status',
  'audit_reference_id',
  'audit_fingerprint',
  'evidence_required',
  'persistence_written'
]);

const EXECUTION_PREPARATION_ELIGIBILITY_RESULT_FIELDS = Object.freeze([
  'ok',
  'status',
  'decision',
  'next_state',
  'reason_codes',
  'preparation_eligibility_id',
  'preparation_eligibility_fingerprint',
  'authorization',
  'binding',
  'identity',
  'scope',
  'requirements',
  'authority_boundary',
  'evidence',
  'audit',
  'validator_version'
]);

const AUTHORIZATION_SUMMARY_FIELDS = Object.freeze([
  'authorization_request_id',
  'authorization_request_fingerprint',
  'authorization_decision_id',
  'authorization_decision_fingerprint',
  'authorization_status',
  'authorization_decision',
  'authorization_next_state',
  'registry_version'
]);

const BINDING_SUMMARY_FIELDS = Object.freeze([
  'admission_authorization_binding_id',
  'admission_authorization_binding_fingerprint',
  'admission_fingerprint',
  'execution_intent_fingerprint',
  'canonical_authorization_model'
]);

const IDENTITY_SUMMARY_FIELDS = Object.freeze([
  'tenant_id',
  'organization_id',
  'project_id',
  'actor_id',
  'agent_id',
  'session_reference_id'
]);

const SCOPE_SUMMARY_FIELDS = Object.freeze([
  'authorization_scope_id',
  'authorization_scope_fingerprint',
  'task_reference_id',
  'task_fingerprint',
  'task_type',
  'risk_classification',
  'approval_reference_id',
  'approval_fingerprint',
  'budget_authorization_id',
  'budget_fingerprint',
  'expiration_evaluation_id',
  'expiration_fingerprint'
]);

const REQUIREMENTS_SUMMARY_FIELDS = Object.freeze([
  'preparation_requirements_id',
  'preparation_requirements_fingerprint',
  'target_reference',
  'environment_reference',
  'authorization_validity_requirement',
  'provider_requirement',
  'network_requirement',
  'secret_requirement',
  'runtime_requirement',
  'budget_requirement',
  'expiration_requirement',
  'idempotency_requirement',
  'kill_switch_requirement',
  'audit_requirement'
]);

const AUTHORITY_BOUNDARY_FIELDS = Object.freeze([
  'authorization_seen',
  'admission_authorization_binding_seen',
  'preparation_requirements_evaluated',
  'preparation_eligible',
  'execution_authorized',
  'provider_authorized',
  'provider_called',
  'secret_resolution_authorized',
  'secret_resolved',
  'secret_material_exposed',
  'network_authorized',
  'network_used',
  'runtime_authorized',
  'runtime_enabled',
  'worker_authorized',
  'worker_started',
  'queue_mutation_authorized',
  'queue_mutated',
  'scheduler_mutation_authorized',
  'scheduler_mutated',
  'dispatch_authorized',
  'dispatch_executed',
  'operational_persistence_authorized',
  'persistence_written',
  'real_execution_authorized',
  'simulation_only',
  'production_effect'
]);

const EVIDENCE_FIELDS = Object.freeze([
  'authorization_request_validated',
  'authorization_decision_validated',
  'authorization_decision_recomputed',
  'admission_authorization_binding_validated',
  'requirements_validated',
  'requirement_material_fingerprint',
  'simulation_only',
  'production_effect'
]);

const AUDIT_FIELDS = Object.freeze([
  'event_name',
  'authorization_request_id',
  'authorization_decision_id',
  'admission_authorization_binding_id',
  'preparation_requirements_id',
  'decision',
  'next_state',
  'reason_codes',
  'simulation_only',
  'production_effect'
]);

const SAFE_FALSE_AUTHORITY_FIELDS = Object.freeze([
  'execution_authorized',
  'provider_authorized',
  'provider_called',
  'secret_resolution_authorized',
  'secret_resolved',
  'secret_material_exposed',
  'network_authorized',
  'network_used',
  'runtime_authorized',
  'runtime_enabled',
  'worker_authorized',
  'worker_started',
  'queue_mutation_authorized',
  'queue_mutated',
  'scheduler_mutation_authorized',
  'scheduler_mutated',
  'dispatch_authorized',
  'dispatch_executed',
  'operational_persistence_authorized',
  'persistence_written',
  'real_execution_authorized'
]);

const REQUIREMENT_OBJECTS = Object.freeze([
  ['target_reference', TARGET_REFERENCE_FIELDS],
  ['environment_reference', ENVIRONMENT_REFERENCE_FIELDS],
  ['authorization_validity_requirement', AUTHORIZATION_VALIDITY_REQUIREMENT_FIELDS],
  ['provider_requirement', PROVIDER_REQUIREMENT_FIELDS],
  ['network_requirement', NETWORK_REQUIREMENT_FIELDS],
  ['secret_requirement', SECRET_REQUIREMENT_FIELDS],
  ['runtime_requirement', RUNTIME_REQUIREMENT_FIELDS],
  ['budget_requirement', BUDGET_REQUIREMENT_FIELDS],
  ['expiration_requirement', EXPIRATION_REQUIREMENT_FIELDS],
  ['idempotency_requirement', IDEMPOTENCY_REQUIREMENT_FIELDS],
  ['kill_switch_requirement', KILL_SWITCH_REQUIREMENT_FIELDS],
  ['audit_requirement', AUDIT_REQUIREMENT_FIELDS]
]);

const SENSITIVE_KEY_ALLOWLIST = Object.freeze([
  'secret_requirement',
  'secret_policy_reference_id',
  'secret_reference_id',
  'secret_reference_fingerprint',
  'secret_resolved',
  'secret_material_exposed',
  'secret_resolution_authorized'
]);

function valuesEqual(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function digest(value) {
  return computeCanonicalContentDigest(value);
}

function nullableString(value) {
  return value === null || isNonEmptyString(value);
}

function exactObject(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return false;
  }
  exactFields(value, fields, prefix, errors);
  return true;
}

function collectSensitiveMaterial(value, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitiveMaterial(item, [...path, String(index)]));
  }
  if (!isPlainObject(value)) return [];
  const findings = [];
  for (const [key, nested] of Object.entries(value)) {
    const keyLower = key.toLowerCase();
    const allowed = SENSITIVE_KEY_ALLOWLIST.includes(key);
    if (!allowed && /(secret_value|secret_material|credential|api_key|access_token|refresh_token|private_key|password)/.test(keyLower)) {
      findings.push(`secret_or_credential_material_detected::${[...path, key].join('.')}`);
    }
    findings.push(...collectSensitiveMaterial(nested, [...path, key]));
  }
  return findings;
}

function buildRequirementFingerprintMaterial(requirements) {
  const req = isPlainObject(requirements) ? requirements : {};
  return {
    validator_version: EXECUTION_PREPARATION_REQUIREMENTS_VALIDATOR_VERSION,
    preparation_requirements_id: req.preparation_requirements_id || null,
    preparation_requirements_version: Number.isInteger(req.preparation_requirements_version) ? req.preparation_requirements_version : null,
    authorization_request_id: req.authorization_request_id || null,
    authorization_request_fingerprint: req.authorization_request_fingerprint || null,
    authorization_decision_id: req.authorization_decision_id || null,
    authorization_decision_fingerprint: req.authorization_decision_fingerprint || null,
    admission_authorization_binding_id: req.admission_authorization_binding_id || null,
    admission_authorization_binding_fingerprint: req.admission_authorization_binding_fingerprint || null,
    tenant_id: req.tenant_id || null,
    organization_id: req.organization_id || null,
    project_id: req.project_id || null,
    actor_id: req.actor_id || null,
    task_reference_id: req.task_reference_id || null,
    approval_reference_id: req.approval_reference_id || null,
    target_reference: req.target_reference || null,
    environment_reference: req.environment_reference || null,
    authorization_validity_requirement: req.authorization_validity_requirement || null,
    provider_requirement: req.provider_requirement || null,
    network_requirement: req.network_requirement || null,
    secret_requirement: req.secret_requirement || null,
    runtime_requirement: req.runtime_requirement || null,
    budget_requirement: req.budget_requirement || null,
    expiration_requirement: req.expiration_requirement || null,
    idempotency_requirement: req.idempotency_requirement || null,
    kill_switch_requirement: req.kill_switch_requirement || null,
    audit_requirement: req.audit_requirement || null
  };
}

function computeExecutionPreparationRequirementsFingerprint(requirements) {
  return digest(buildRequirementFingerprintMaterial(requirements));
}

function buildExecutionPreparationRequirements(input = {}) {
  const requirements = {
    preparation_requirements_id: input.preparation_requirements_id,
    preparation_requirements_version: Number.isInteger(input.preparation_requirements_version)
      ? input.preparation_requirements_version : 1,
    preparation_requirements_fingerprint: 'pending',
    authorization_request_id: input.authorization_request_id,
    authorization_request_fingerprint: input.authorization_request_fingerprint,
    authorization_decision_id: input.authorization_decision_id,
    authorization_decision_fingerprint: input.authorization_decision_fingerprint,
    admission_authorization_binding_id: input.admission_authorization_binding_id,
    admission_authorization_binding_fingerprint: input.admission_authorization_binding_fingerprint,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    actor_id: input.actor_id,
    task_reference_id: input.task_reference_id,
    approval_reference_id: input.approval_reference_id,
    target_reference: input.target_reference,
    environment_reference: input.environment_reference,
    authorization_validity_requirement: input.authorization_validity_requirement,
    provider_requirement: input.provider_requirement,
    network_requirement: input.network_requirement,
    secret_requirement: input.secret_requirement,
    runtime_requirement: input.runtime_requirement,
    budget_requirement: input.budget_requirement,
    expiration_requirement: input.expiration_requirement,
    idempotency_requirement: input.idempotency_requirement,
    kill_switch_requirement: input.kill_switch_requirement,
    audit_requirement: input.audit_requirement,
    validator_version: EXECUTION_PREPARATION_REQUIREMENTS_VALIDATOR_VERSION
  };
  requirements.preparation_requirements_fingerprint = computeExecutionPreparationRequirementsFingerprint(requirements);
  const validation = validateExecutionPreparationRequirements(requirements);
  if (!validation.valid) {
    throw new Error(`execution_preparation_requirements_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(requirements);
}

function validateRequirementBase(requirement, prefix, errors) {
  if (typeof requirement.required !== 'boolean') errors.push(`${prefix}_required_must_be_boolean`);
  if (!EXECUTION_PREPARATION_REQUIREMENT_STATUSES.includes(requirement.status)) {
    errors.push(`${prefix}_status_not_allowed::${requirement.status}`);
    return;
  }
  if (requirement.required === true && requirement.status === 'NOT_APPLICABLE') {
    errors.push(`${prefix}_required_not_applicable`);
  }
  if (requirement.required === false && requirement.status !== 'NOT_APPLICABLE') {
    errors.push(`${prefix}_optional_status_must_be_not_applicable`);
  }
}

function validateExecutionPreparationRequirements(requirements) {
  const errors = [];
  if (!isPlainObject(requirements)) return { valid: false, errors: ['execution_preparation_requirements_must_be_object'] };
  exactFields(requirements, EXECUTION_PREPARATION_REQUIREMENTS_FIELDS, 'execution_preparation_requirements', errors);
  for (const field of [
    'preparation_requirements_id',
    'preparation_requirements_fingerprint',
    'authorization_request_id',
    'authorization_request_fingerprint',
    'authorization_decision_id',
    'authorization_decision_fingerprint',
    'admission_authorization_binding_id',
    'admission_authorization_binding_fingerprint',
    'tenant_id',
    'organization_id',
    'project_id',
    'actor_id',
    'task_reference_id',
    'approval_reference_id',
    'validator_version'
  ]) {
    if (!isNonEmptyString(requirements[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(requirements.preparation_requirements_version) || requirements.preparation_requirements_version < 1) {
    errors.push('preparation_requirements_version_invalid');
  }
  if (requirements.validator_version !== EXECUTION_PREPARATION_REQUIREMENTS_VALIDATOR_VERSION) {
    errors.push('validator_version_invalid');
  }

  for (const [field, fields] of REQUIREMENT_OBJECTS) {
    if (!exactObject(requirements[field], fields, field, errors)) continue;
    validateRequirementBase(requirements[field], field, errors);
  }

  const target = requirements.target_reference || {};
  for (const field of ['target_class', 'target_reference_id', 'target_fingerprint']) {
    if (target.required === true && !isNonEmptyString(target[field])) errors.push(`target_reference_${field}_invalid`);
    if (target.required === false && !nullableString(target[field])) errors.push(`target_reference_${field}_invalid`);
  }

  const environment = requirements.environment_reference || {};
  for (const field of ['environment_class', 'environment_reference_id', 'environment_fingerprint']) {
    if (environment.required === true && !isNonEmptyString(environment[field])) errors.push(`environment_reference_${field}_invalid`);
    if (environment.required === false && !nullableString(environment[field])) errors.push(`environment_reference_${field}_invalid`);
  }
  if (typeof environment.production !== 'boolean') errors.push('environment_reference_production_must_be_boolean');
  if (environment.production !== false) errors.push('environment_reference_production_must_be_false');

  const validity = requirements.authorization_validity_requirement || {};
  for (const field of ['authorization_revoked', 'authorization_stale']) {
    if (typeof validity[field] !== 'boolean') errors.push(`authorization_validity_requirement_${field}_must_be_boolean`);
  }
  for (const field of ['expected_registry_version', 'observed_registry_version']) {
    if (!isNonEmptyString(validity[field])) errors.push(`authorization_validity_requirement_${field}_invalid`);
  }

  const provider = requirements.provider_requirement || {};
  for (const field of ['provider_class', 'provider_reference_id', 'provider_fingerprint']) {
    if (provider.required === true && !isNonEmptyString(provider[field])) errors.push(`provider_requirement_${field}_invalid`);
    if (provider.required === false && !nullableString(provider[field])) errors.push(`provider_requirement_${field}_invalid`);
  }
  if (provider.provider_called !== false) errors.push('provider_requirement_provider_called_must_be_false');

  const network = requirements.network_requirement || {};
  for (const field of ['network_policy_reference_id', 'destination_class', 'network_policy_fingerprint']) {
    if (network.required === true && !isNonEmptyString(network[field])) errors.push(`network_requirement_${field}_invalid`);
    if (network.required === false && !nullableString(network[field])) errors.push(`network_requirement_${field}_invalid`);
  }
  if (network.network_used !== false) errors.push('network_requirement_network_used_must_be_false');

  const secret = requirements.secret_requirement || {};
  for (const field of ['secret_policy_reference_id', 'secret_reference_id', 'secret_reference_fingerprint']) {
    if (secret.required === true && !isNonEmptyString(secret[field])) errors.push(`secret_requirement_${field}_invalid`);
    if (secret.required === false && !nullableString(secret[field])) errors.push(`secret_requirement_${field}_invalid`);
  }
  if (secret.secret_resolved !== false) errors.push('secret_requirement_secret_resolved_must_be_false');
  if (secret.secret_material_exposed !== false) errors.push('secret_requirement_secret_material_exposed_must_be_false');

  const runtime = requirements.runtime_requirement || {};
  for (const field of ['runtime_capability_reference_id', 'runtime_capability_fingerprint']) {
    if (runtime.required === true && !isNonEmptyString(runtime[field])) errors.push(`runtime_requirement_${field}_invalid`);
    if (runtime.required === false && !nullableString(runtime[field])) errors.push(`runtime_requirement_${field}_invalid`);
  }
  for (const field of ['runtime_enabled', 'worker_started', 'queue_mutated', 'scheduler_mutated', 'dispatch_executed']) {
    if (runtime[field] !== false) errors.push(`runtime_requirement_${field}_must_be_false`);
  }

  const budget = requirements.budget_requirement || {};
  for (const field of ['budget_authorization_id', 'budget_fingerprint']) {
    if (budget.required === true && !isNonEmptyString(budget[field])) errors.push(`budget_requirement_${field}_invalid`);
    if (budget.required === false && !nullableString(budget[field])) errors.push(`budget_requirement_${field}_invalid`);
  }
  if (typeof budget.within_limits !== 'boolean') errors.push('budget_requirement_within_limits_must_be_boolean');
  if (budget.budget_consumed !== false) errors.push('budget_requirement_budget_consumed_must_be_false');

  const expiration = requirements.expiration_requirement || {};
  for (const field of ['expiration_evaluation_id', 'expiration_fingerprint']) {
    if (expiration.required === true && !isNonEmptyString(expiration[field])) errors.push(`expiration_requirement_${field}_invalid`);
    if (expiration.required === false && !nullableString(expiration[field])) errors.push(`expiration_requirement_${field}_invalid`);
  }
  if (typeof expiration.expired_logically !== 'boolean') errors.push('expiration_requirement_expired_logically_must_be_boolean');
  if (expiration.clock_accessed !== false) errors.push('expiration_requirement_clock_accessed_must_be_false');

  const idempotency = requirements.idempotency_requirement || {};
  for (const field of ['idempotency_key_reference', 'idempotency_fingerprint']) {
    if (idempotency.required === true && !isNonEmptyString(idempotency[field])) errors.push(`idempotency_requirement_${field}_invalid`);
    if (idempotency.required === false && !nullableString(idempotency[field])) errors.push(`idempotency_requirement_${field}_invalid`);
  }
  if (typeof idempotency.replay_allowed !== 'boolean') errors.push('idempotency_requirement_replay_allowed_must_be_boolean');
  if (typeof idempotency.duplicate_execution_blocked !== 'boolean') errors.push('idempotency_requirement_duplicate_execution_blocked_must_be_boolean');
  if (idempotency.idempotency_consumed !== false) errors.push('idempotency_requirement_idempotency_consumed_must_be_false');

  const killSwitch = requirements.kill_switch_requirement || {};
  for (const field of ['kill_switch_reference_id', 'kill_switch_fingerprint']) {
    if (killSwitch.required === true && !isNonEmptyString(killSwitch[field])) errors.push(`kill_switch_requirement_${field}_invalid`);
    if (killSwitch.required === false && !nullableString(killSwitch[field])) errors.push(`kill_switch_requirement_${field}_invalid`);
  }
  if (typeof killSwitch.kill_switch_active !== 'boolean') errors.push('kill_switch_requirement_kill_switch_active_must_be_boolean');

  const audit = requirements.audit_requirement || {};
  for (const field of ['audit_reference_id', 'audit_fingerprint']) {
    if (audit.required === true && !isNonEmptyString(audit[field])) errors.push(`audit_requirement_${field}_invalid`);
    if (audit.required === false && !nullableString(audit[field])) errors.push(`audit_requirement_${field}_invalid`);
  }
  if (typeof audit.evidence_required !== 'boolean') errors.push('audit_requirement_evidence_required_must_be_boolean');
  if (audit.persistence_written !== false) errors.push('audit_requirement_persistence_written_must_be_false');

  if (requirements.preparation_requirements_fingerprint !== computeExecutionPreparationRequirementsFingerprint(requirements)) {
    errors.push('preparation_requirements_fingerprint_mismatch');
  }
  errors.push(...collectSensitiveMaterial(requirements));
  try {
    stablePayload(requirements);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAdmissionAuthorizationSourceBinding(binding) {
  const errors = [];
  if (!isPlainObject(binding)) return { valid: false, errors: ['admission_authorization_source_binding_must_be_object'] };
  if (binding.ok !== true) errors.push('source_binding_must_be_ok');
  if (!isNonEmptyString(binding.binding_id)) errors.push('source_binding_id_invalid');
  if (!isNonEmptyString(binding.binding_fingerprint)) errors.push('source_binding_fingerprint_invalid');
  for (const field of ['source', 'destination', 'identity', 'scope', 'target', 'policy', 'authority_boundary']) {
    if (!isPlainObject(binding[field])) errors.push(`source_binding_${field}_must_be_object`);
  }
  const source = isPlainObject(binding.source) ? binding.source : {};
  const destination = isPlainObject(binding.destination) ? binding.destination : {};
  const identity = isPlainObject(binding.identity) ? binding.identity : {};
  const scope = isPlainObject(binding.scope) ? binding.scope : {};
  const target = isPlainObject(binding.target) ? binding.target : {};
  const policy = isPlainObject(binding.policy) ? binding.policy : {};
  const authority = isPlainObject(binding.authority_boundary) ? binding.authority_boundary : {};
  for (const [field, value] of [
    ['source_admission_fingerprint', source.admission_fingerprint],
    ['source_execution_intent_fingerprint', source.intent_fingerprint],
    ['destination_authorization_request_id', destination.authorization_request_id],
    ['destination_authorization_request_fingerprint', destination.authorization_request_fingerprint],
    ['destination_authorization_decision_id', destination.authorization_decision_id],
    ['destination_authorization_decision_fingerprint', destination.authorization_decision_fingerprint],
    ['identity_tenant_id', identity.tenant_id],
    ['identity_organization_id', identity.organization_id],
    ['identity_project_id', identity.project_id],
    ['identity_actor_id', identity.actor_id],
    ['scope_authorization_scope_id', scope.authorization_scope_id],
    ['scope_task_reference_id', scope.task_reference_id],
    ['scope_risk_classification', scope.risk_classification],
    ['target_class', target.target_class],
    ['target_admission_environment', target.admission_environment],
    ['policy_admission_policy_fingerprint', policy.admission_policy_fingerprint]
  ]) {
    if (!isNonEmptyString(value)) errors.push(`${field}_invalid`);
  }
  if (destination.authorization_status !== 'AUTHORIZED_SIMULATION') errors.push('source_binding_authorization_status_must_be_authorized_simulation');
  if (authority.canonical_authorization_model !== 'GENERIC_EXECUTION_AUTHORIZATION') errors.push('source_binding_canonical_authorization_model_invalid');
  for (const field of [
    'execution_authorized',
    'provider_authorized',
    'secret_resolution_authorized',
    'network_authorized',
    'runtime_authorized',
    'worker_authorized',
    'queue_mutation_authorized',
    'scheduler_mutation_authorized',
    'dispatch_authorized',
    'operational_persistence_authorized',
    'real_execution_authorized',
    'legacy_public_web_authorization_used'
  ]) {
    if (authority[field] !== false) errors.push(`source_binding_${field}_must_be_false`);
  }
  try {
    stablePayload(binding);
  } catch (error) {
    errors.push(`source_binding_payload_not_serializable::${error.message}`);
  }
  errors.push(...collectSensitiveMaterial(binding));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function collectUnsatisfiedRequirementFailures(requirements) {
  const failures = [];
  for (const [field] of REQUIREMENT_OBJECTS) {
    const requirement = requirements[field];
    if (!isPlainObject(requirement)) {
      failures.push(`${field}_missing`);
    } else if (requirement.required === true && requirement.status !== 'REQUIRED_SATISFIED') {
      failures.push(`${field}_unsatisfied`);
    }
  }
  const validity = requirements.authorization_validity_requirement;
  if (validity.authorization_revoked === true) failures.push('authorization_revoked');
  if (validity.authorization_stale === true) failures.push('authorization_stale');
  if (validity.expected_registry_version !== validity.observed_registry_version) failures.push('authorization_registry_version_mismatch');
  if (requirements.budget_requirement.required === true && requirements.budget_requirement.within_limits !== true) {
    failures.push('budget_limit_violation');
  }
  if (requirements.expiration_requirement.required === true && requirements.expiration_requirement.expired_logically === true) {
    failures.push('authorization_expired_logically');
  }
  if (requirements.idempotency_requirement.required === true && requirements.idempotency_requirement.duplicate_execution_blocked !== true) {
    failures.push('duplicate_execution_not_blocked');
  }
  if (requirements.kill_switch_requirement.required === true && requirements.kill_switch_requirement.kill_switch_active === true) {
    failures.push('kill_switch_active');
  }
  if (requirements.audit_requirement.required === true && requirements.audit_requirement.evidence_required !== true) {
    failures.push('audit_evidence_not_required');
  }
  return failures;
}

function collectBindingFailures(request, decision, binding, requirements) {
  const failures = [];
  if (requirements.authorization_request_id !== request.authorization_request_id) failures.push('authorization_request_id_mismatch');
  if (requirements.authorization_request_fingerprint !== digest(request)) failures.push('authorization_request_fingerprint_mismatch');
  if (requirements.authorization_decision_id !== decision.authorization_decision_id) failures.push('authorization_decision_id_mismatch');
  if (requirements.authorization_decision_fingerprint !== digest(decision)) failures.push('authorization_decision_fingerprint_mismatch');
  if (requirements.admission_authorization_binding_id !== binding.binding_id) failures.push('admission_authorization_binding_id_mismatch');
  if (requirements.admission_authorization_binding_fingerprint !== binding.binding_fingerprint) {
    failures.push('admission_authorization_binding_fingerprint_mismatch');
  }
  if (binding.destination.authorization_request_id !== request.authorization_request_id) failures.push('binding_authorization_request_id_mismatch');
  if (binding.destination.authorization_request_fingerprint !== digest(request)) failures.push('binding_authorization_request_fingerprint_mismatch');
  if (binding.destination.authorization_decision_id !== decision.authorization_decision_id) failures.push('binding_authorization_decision_id_mismatch');
  if (binding.destination.authorization_decision_fingerprint !== digest(decision)) failures.push('binding_authorization_decision_fingerprint_mismatch');
  if (binding.destination.authorization_status !== decision.status) failures.push('binding_authorization_status_mismatch');
  if (binding.destination.authorization_decision !== decision.decision) failures.push('binding_authorization_decision_mismatch');
  if (binding.destination.authorization_next_state !== decision.next_state) failures.push('binding_authorization_next_state_mismatch');
  if (requirements.tenant_id !== decision.tenant_id || requirements.tenant_id !== binding.identity.tenant_id) failures.push('tenant_mismatch');
  if (requirements.organization_id !== decision.organization_id || requirements.organization_id !== binding.identity.organization_id) failures.push('organization_mismatch');
  if (requirements.project_id !== decision.project_id || requirements.project_id !== binding.identity.project_id) failures.push('project_mismatch');
  if (requirements.actor_id !== decision.actor_id || requirements.actor_id !== binding.identity.actor_id) failures.push('actor_mismatch');
  if (requirements.task_reference_id !== decision.task_reference_id || requirements.task_reference_id !== binding.scope.task_reference_id) {
    failures.push('task_reference_mismatch');
  }
  if (requirements.approval_reference_id !== decision.approval_reference_id) failures.push('approval_reference_mismatch');
  if (requirements.target_reference.required === true && requirements.target_reference.target_class !== binding.target.target_class) {
    failures.push('target_class_mismatch');
  }
  if (requirements.environment_reference.required === true && requirements.environment_reference.environment_class !== binding.target.admission_environment) {
    failures.push('environment_mismatch');
  }
  return failures;
}

function buildAuthorityBoundary(ok) {
  const boundary = {
    authorization_seen: ok === true,
    admission_authorization_binding_seen: ok === true,
    preparation_requirements_evaluated: true,
    preparation_eligible: ok === true,
    execution_authorized: false,
    provider_authorized: false,
    provider_called: false,
    secret_resolution_authorized: false,
    secret_resolved: false,
    secret_material_exposed: false,
    network_authorized: false,
    network_used: false,
    runtime_authorized: false,
    runtime_enabled: false,
    worker_authorized: false,
    worker_started: false,
    queue_mutation_authorized: false,
    queue_mutated: false,
    scheduler_mutation_authorized: false,
    scheduler_mutated: false,
    dispatch_authorized: false,
    dispatch_executed: false,
    operational_persistence_authorized: false,
    persistence_written: false,
    real_execution_authorized: false,
    simulation_only: true,
    production_effect: 'ZERO'
  };
  return boundary;
}

function summarizeAuthorization(request, decision) {
  return {
    authorization_request_id: isPlainObject(request) ? request.authorization_request_id || null : null,
    authorization_request_fingerprint: isPlainObject(request) ? digest(request) : null,
    authorization_decision_id: isPlainObject(decision) ? decision.authorization_decision_id || null : null,
    authorization_decision_fingerprint: isPlainObject(decision) ? digest(decision) : null,
    authorization_status: isPlainObject(decision) ? decision.status || null : null,
    authorization_decision: isPlainObject(decision) ? decision.decision || null : null,
    authorization_next_state: isPlainObject(decision) ? decision.next_state || null : null,
    registry_version: isPlainObject(decision) ? decision.registry_version || null : null
  };
}

function summarizeBinding(binding) {
  const safe = isPlainObject(binding) ? binding : {};
  const source = isPlainObject(safe.source) ? safe.source : {};
  const authority = isPlainObject(safe.authority_boundary) ? safe.authority_boundary : {};
  return {
    admission_authorization_binding_id: safe.binding_id || null,
    admission_authorization_binding_fingerprint: safe.binding_fingerprint || null,
    admission_fingerprint: source.admission_fingerprint || null,
    execution_intent_fingerprint: source.intent_fingerprint || null,
    canonical_authorization_model: authority.canonical_authorization_model || null
  };
}

function summarizeIdentity(request, decision) {
  const requestSafe = isPlainObject(request) ? request : {};
  const decisionSafe = isPlainObject(decision) ? decision : {};
  const actor = isPlainObject(requestSafe.actor_context) ? requestSafe.actor_context : {};
  const orchestrator = isPlainObject(requestSafe.orchestrator_decision_reference)
    ? requestSafe.orchestrator_decision_reference : {};
  return {
    tenant_id: decisionSafe.tenant_id || orchestrator.tenant_id || null,
    organization_id: decisionSafe.organization_id || orchestrator.organization_id || null,
    project_id: decisionSafe.project_id || orchestrator.project_id || null,
    actor_id: decisionSafe.actor_id || actor.actor_id || null,
    agent_id: decisionSafe.agent_id || orchestrator.agent_id || null,
    session_reference_id: decisionSafe.session_reference_id || orchestrator.session_reference_id || null
  };
}

function summarizeScope(request, decision) {
  const requestSafe = isPlainObject(request) ? request : {};
  const decisionSafe = isPlainObject(decision) ? decision : {};
  const scope = isPlainObject(requestSafe.authorization_scope) ? requestSafe.authorization_scope : {};
  const task = isPlainObject(requestSafe.task_reference) ? requestSafe.task_reference : {};
  const approval = isPlainObject(requestSafe.approval_reference) ? requestSafe.approval_reference : {};
  const budget = isPlainObject(requestSafe.budget_authorization_reference) ? requestSafe.budget_authorization_reference : {};
  const expiration = isPlainObject(requestSafe.expiration_evaluation) ? requestSafe.expiration_evaluation : {};
  return {
    authorization_scope_id: decisionSafe.authorization_scope_id || scope.scope_id || null,
    authorization_scope_fingerprint: decisionSafe.scope_fingerprint || scope.scope_fingerprint || null,
    task_reference_id: decisionSafe.task_reference_id || task.task_reference_id || null,
    task_fingerprint: decisionSafe.task_fingerprint || task.task_fingerprint || null,
    task_type: task.task_type || null,
    risk_classification: task.risk_classification || null,
    approval_reference_id: decisionSafe.approval_reference_id || approval.approval_reference_id || null,
    approval_fingerprint: decisionSafe.approval_fingerprint || approval.approval_fingerprint || null,
    budget_authorization_id: decisionSafe.budget_authorization_id || budget.budget_authorization_id || null,
    budget_fingerprint: decisionSafe.budget_fingerprint || budget.budget_fingerprint || null,
    expiration_evaluation_id: decisionSafe.expiration_evaluation_id || expiration.expiration_evaluation_id || null,
    expiration_fingerprint: decisionSafe.expiration_fingerprint || digest(expiration)
  };
}

function summarizeRequirements(requirements) {
  const safe = isPlainObject(requirements) ? requirements : {};
  return {
    preparation_requirements_id: safe.preparation_requirements_id || null,
    preparation_requirements_fingerprint: safe.preparation_requirements_fingerprint || null,
    target_reference: safe.target_reference || null,
    environment_reference: safe.environment_reference || null,
    authorization_validity_requirement: safe.authorization_validity_requirement || null,
    provider_requirement: safe.provider_requirement || null,
    network_requirement: safe.network_requirement || null,
    secret_requirement: safe.secret_requirement || null,
    runtime_requirement: safe.runtime_requirement || null,
    budget_requirement: safe.budget_requirement || null,
    expiration_requirement: safe.expiration_requirement || null,
    idempotency_requirement: safe.idempotency_requirement || null,
    kill_switch_requirement: safe.kill_switch_requirement || null,
    audit_requirement: safe.audit_requirement || null
  };
}

function buildPreparationMaterial({ authorization, binding, identity, scope, requirements, authorityBoundary, status, decision, nextState, reasonCodes }) {
  return {
    validator_version: EXECUTION_PREPARATION_ELIGIBILITY_VALIDATOR_VERSION,
    authorization_request_id: authorization.authorization_request_id,
    authorization_request_fingerprint: authorization.authorization_request_fingerprint,
    authorization_decision_id: authorization.authorization_decision_id,
    authorization_decision_fingerprint: authorization.authorization_decision_fingerprint,
    authorization_status: authorization.authorization_status,
    admission_authorization_binding_id: binding.admission_authorization_binding_id,
    admission_authorization_binding_fingerprint: binding.admission_authorization_binding_fingerprint,
    admission_fingerprint: binding.admission_fingerprint,
    execution_intent_fingerprint: binding.execution_intent_fingerprint,
    canonical_authorization_model: binding.canonical_authorization_model,
    tenant_id: identity.tenant_id,
    organization_id: identity.organization_id,
    project_id: identity.project_id,
    actor_id: identity.actor_id,
    agent_id: identity.agent_id,
    session_reference_id: identity.session_reference_id,
    authorization_scope_id: scope.authorization_scope_id,
    authorization_scope_fingerprint: scope.authorization_scope_fingerprint,
    task_reference_id: scope.task_reference_id,
    task_fingerprint: scope.task_fingerprint,
    task_type: scope.task_type,
    risk_classification: scope.risk_classification,
    approval_reference_id: scope.approval_reference_id,
    approval_fingerprint: scope.approval_fingerprint,
    budget_authorization_id: scope.budget_authorization_id,
    budget_fingerprint: scope.budget_fingerprint,
    expiration_evaluation_id: scope.expiration_evaluation_id,
    expiration_fingerprint: scope.expiration_fingerprint,
    preparation_requirements_id: requirements.preparation_requirements_id,
    preparation_requirements_fingerprint: requirements.preparation_requirements_fingerprint,
    target_reference: requirements.target_reference,
    environment_reference: requirements.environment_reference,
    authorization_validity_requirement: requirements.authorization_validity_requirement,
    provider_requirement: requirements.provider_requirement,
    network_requirement: requirements.network_requirement,
    secret_requirement: requirements.secret_requirement,
    runtime_requirement: requirements.runtime_requirement,
    budget_requirement: requirements.budget_requirement,
    expiration_requirement: requirements.expiration_requirement,
    idempotency_requirement: requirements.idempotency_requirement,
    kill_switch_requirement: requirements.kill_switch_requirement,
    audit_requirement: requirements.audit_requirement,
    status,
    decision,
    next_state: nextState,
    reason_codes: uniqueSorted(reasonCodes),
    preparation_eligible: authorityBoundary.preparation_eligible,
    execution_authorized: authorityBoundary.execution_authorized,
    real_execution_authorized: authorityBoundary.real_execution_authorized,
    simulation_only: true,
    production_effect: 'ZERO'
  };
}

function statusFor(reasonCodes) {
  if (reasonCodes.some((reason) => reason.endsWith('_invalid') || reason.includes('invalid') || reason.includes('missing'))) {
    return 'EXECUTION_PREPARATION_VALIDATION_FAILED';
  }
  return 'EXECUTION_PREPARATION_BLOCKED';
}

function buildResult({
  ok,
  status,
  reasonCodes,
  authorizationRequest,
  authorizationDecision,
  admissionAuthorizationBinding,
  preparationRequirements,
  evidenceFlags
}) {
  const outcome = PREPARATION_OUTCOMES[status] || PREPARATION_OUTCOMES.EXECUTION_PREPARATION_VALIDATION_FAILED;
  const normalizedReasons = ok ? ['execution_preparation_requirements_satisfied_simulation_only'] : uniqueSorted([...reasonCodes, 'fail_closed']);
  const authorization = summarizeAuthorization(authorizationRequest, authorizationDecision);
  const binding = summarizeBinding(admissionAuthorizationBinding);
  const identity = summarizeIdentity(authorizationRequest, authorizationDecision);
  const scope = summarizeScope(authorizationRequest, authorizationDecision);
  const requirements = summarizeRequirements(preparationRequirements);
  const authorityBoundary = buildAuthorityBoundary(ok);
  const material = buildPreparationMaterial({
    authorization,
    binding,
    identity,
    scope,
    requirements,
    authorityBoundary,
    status,
    decision: outcome.decision,
    nextState: outcome.next_state,
    reasonCodes: normalizedReasons
  });
  const evidence = {
    authorization_request_validated: evidenceFlags.authorizationRequestValidated === true,
    authorization_decision_validated: evidenceFlags.authorizationDecisionValidated === true,
    authorization_decision_recomputed: evidenceFlags.authorizationDecisionRecomputed === true,
    admission_authorization_binding_validated: evidenceFlags.admissionAuthorizationBindingValidated === true,
    requirements_validated: evidenceFlags.requirementsValidated === true,
    requirement_material_fingerprint: digest(material),
    simulation_only: true,
    production_effect: 'ZERO'
  };
  const preparationEligibilityId = `execution_preparation_eligibility:${digest({ material, evidence })}`;
  const audit = {
    event_name: ok === true
      ? 'execution_preparation_requirements_eligible_simulation'
      : 'execution_preparation_requirements_blocked',
    authorization_request_id: authorization.authorization_request_id,
    authorization_decision_id: authorization.authorization_decision_id,
    admission_authorization_binding_id: binding.admission_authorization_binding_id,
    preparation_requirements_id: requirements.preparation_requirements_id,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    simulation_only: true,
    production_effect: 'ZERO'
  };
  return cloneFrozen({
    ok,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    preparation_eligibility_id: preparationEligibilityId,
    preparation_eligibility_fingerprint: digest({ material, evidence, audit }),
    authorization,
    binding,
    identity,
    scope,
    requirements,
    authority_boundary: authorityBoundary,
    evidence,
    audit,
    validator_version: EXECUTION_PREPARATION_ELIGIBILITY_VALIDATOR_VERSION
  });
}

function evaluateExecutionPreparationRequirements(
  authorizationRequest,
  authorizationDecision,
  admissionAuthorizationBinding,
  preparationRequirements,
  context = {}
) {
  const reasonCodes = [];
  const evidenceFlags = {
    authorizationRequestValidated: false,
    authorizationDecisionValidated: false,
    authorizationDecisionRecomputed: false,
    admissionAuthorizationBindingValidated: false,
    requirementsValidated: false
  };

  const requestValidation = validateExecutionAuthorizationRequest(authorizationRequest);
  if (!requestValidation.valid) {
    reasonCodes.push('authorization_request_invalid');
  } else {
    evidenceFlags.authorizationRequestValidated = true;
  }

  const decisionValidation = validateExecutionAuthorizationDecision(authorizationDecision);
  if (!decisionValidation.valid) {
    reasonCodes.push('authorization_decision_invalid');
  } else {
    evidenceFlags.authorizationDecisionValidated = true;
  }

  if (requestValidation.valid && decisionValidation.valid) {
    const expected = evaluateExecutionAuthorizationRequest(authorizationRequest).decision;
    evidenceFlags.authorizationDecisionRecomputed = true;
    if (!valuesEqual(expected, authorizationDecision)) reasonCodes.push('authorization_decision_recompute_mismatch');
    if (authorizationDecision.status !== 'AUTHORIZED_SIMULATION') reasonCodes.push('authorization_not_accepted_simulation');
  }

  const bindingValidation = validateAdmissionAuthorizationSourceBinding(admissionAuthorizationBinding);
  if (!bindingValidation.valid) {
    reasonCodes.push('admission_authorization_binding_invalid');
  } else if (admissionAuthorizationBinding.ok !== true) {
    reasonCodes.push('admission_authorization_binding_not_bound');
  } else {
    evidenceFlags.admissionAuthorizationBindingValidated = true;
  }

  const requirementsValidation = validateExecutionPreparationRequirements(preparationRequirements);
  if (!requirementsValidation.valid) {
    reasonCodes.push('execution_preparation_requirements_invalid');
  } else {
    evidenceFlags.requirementsValidated = true;
  }

  if (requestValidation.valid && decisionValidation.valid && bindingValidation.valid && requirementsValidation.valid) {
    reasonCodes.push(...collectBindingFailures(
      authorizationRequest,
      authorizationDecision,
      admissionAuthorizationBinding,
      preparationRequirements
    ));
    reasonCodes.push(...collectUnsatisfiedRequirementFailures(preparationRequirements));
  }

  const ok = reasonCodes.length === 0;
  return buildResult({
    ok,
    status: ok ? 'EXECUTION_PREPARATION_ELIGIBLE_SIMULATION' : statusFor(reasonCodes),
    reasonCodes,
    authorizationRequest,
    authorizationDecision,
    admissionAuthorizationBinding,
    preparationRequirements,
    evidenceFlags
  });
}

function validateExecutionPreparationEligibilityResult(result, context = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['execution_preparation_eligibility_result_must_be_object'] };
  exactFields(result, EXECUTION_PREPARATION_ELIGIBILITY_RESULT_FIELDS, 'execution_preparation_eligibility_result', errors);
  if (typeof result.ok !== 'boolean') errors.push('ok_must_be_boolean');
  if (!EXECUTION_PREPARATION_ELIGIBILITY_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!EXECUTION_PREPARATION_ELIGIBILITY_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!EXECUTION_PREPARATION_ELIGIBILITY_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const outcome = PREPARATION_OUTCOMES[result.status];
  if (outcome && result.decision !== outcome.decision) errors.push('decision_status_mismatch');
  if (outcome && result.next_state !== outcome.next_state) errors.push('next_state_status_mismatch');
  if (!Array.isArray(result.reason_codes) || result.reason_codes.some((reason) => !isNonEmptyString(reason))) errors.push('reason_codes_invalid');
  if (!isNonEmptyString(result.preparation_eligibility_id)) errors.push('preparation_eligibility_id_invalid');
  if (!isNonEmptyString(result.preparation_eligibility_fingerprint)) errors.push('preparation_eligibility_fingerprint_invalid');
  if (result.validator_version !== EXECUTION_PREPARATION_ELIGIBILITY_VALIDATOR_VERSION) errors.push('validator_version_invalid');

  const hasAuthorization = exactObject(result.authorization, AUTHORIZATION_SUMMARY_FIELDS, 'authorization', errors);
  const hasBinding = exactObject(result.binding, BINDING_SUMMARY_FIELDS, 'binding', errors);
  const hasIdentity = exactObject(result.identity, IDENTITY_SUMMARY_FIELDS, 'identity', errors);
  const hasScope = exactObject(result.scope, SCOPE_SUMMARY_FIELDS, 'scope', errors);
  const hasRequirements = exactObject(result.requirements, REQUIREMENTS_SUMMARY_FIELDS, 'requirements', errors);
  const hasAuthority = exactObject(result.authority_boundary, AUTHORITY_BOUNDARY_FIELDS, 'authority_boundary', errors);
  const hasEvidence = exactObject(result.evidence, EVIDENCE_FIELDS, 'evidence', errors);
  const hasAudit = exactObject(result.audit, AUDIT_FIELDS, 'audit', errors);

  if (result.ok === true) {
    if (result.status !== 'EXECUTION_PREPARATION_ELIGIBLE_SIMULATION') errors.push('ok_status_mismatch');
    if (!valuesEqual(result.reason_codes, ['execution_preparation_requirements_satisfied_simulation_only'])) errors.push('ok_reason_codes_mismatch');
  } else if (!result.reason_codes.includes('fail_closed')) {
    errors.push('blocked_fail_closed_required');
  }

  if (hasAuthority) {
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (result.authority_boundary[field] !== false) errors.push(`authority_boundary_${field}_must_be_false`);
    }
    if (result.authority_boundary.authorization_seen !== (result.ok === true)) errors.push('authority_authorization_seen_mismatch');
    if (result.authority_boundary.admission_authorization_binding_seen !== (result.ok === true)) {
      errors.push('authority_binding_seen_mismatch');
    }
    if (result.authority_boundary.preparation_requirements_evaluated !== true) {
      errors.push('authority_preparation_requirements_evaluated_required');
    }
    if (result.authority_boundary.preparation_eligible !== (result.ok === true)) errors.push('authority_preparation_eligible_mismatch');
    if (result.authority_boundary.simulation_only !== true) errors.push('authority_simulation_only_required');
    if (result.authority_boundary.production_effect !== 'ZERO') errors.push('authority_production_effect_must_be_zero');
  }
  if (hasEvidence) {
    if (result.evidence.simulation_only !== true) errors.push('evidence_simulation_only_required');
    if (result.evidence.production_effect !== 'ZERO') errors.push('evidence_production_effect_must_be_zero');
  }
  if (hasAudit) {
    if (!valuesEqual(result.audit.reason_codes, result.reason_codes)) errors.push('audit_reason_codes_mismatch');
    if (result.audit.simulation_only !== true) errors.push('audit_simulation_only_required');
    if (result.audit.production_effect !== 'ZERO') errors.push('audit_production_effect_must_be_zero');
  }

  if (hasAuthorization && hasBinding && hasIdentity && hasScope && hasRequirements && hasAuthority && hasEvidence && hasAudit) {
    const material = buildPreparationMaterial({
      authorization: result.authorization,
      binding: result.binding,
      identity: result.identity,
      scope: result.scope,
      requirements: result.requirements,
      authorityBoundary: result.authority_boundary,
      status: result.status,
      decision: result.decision,
      nextState: result.next_state,
      reasonCodes: result.reason_codes
    });
    if (result.evidence.requirement_material_fingerprint !== digest(material)) errors.push('requirement_material_fingerprint_mismatch');
    if (result.preparation_eligibility_id !== `execution_preparation_eligibility:${digest({ material, evidence: result.evidence })}`) {
      errors.push('preparation_eligibility_id_mismatch');
    }
    if (result.preparation_eligibility_fingerprint !== digest({ material, evidence: result.evidence, audit: result.audit })) {
      errors.push('preparation_eligibility_fingerprint_mismatch');
    }
  }

  if (!isPlainObject(context)
    || !Object.prototype.hasOwnProperty.call(context, 'authorizationRequest')
    || !Object.prototype.hasOwnProperty.call(context, 'authorizationDecision')
    || !Object.prototype.hasOwnProperty.call(context, 'admissionAuthorizationBinding')
    || !Object.prototype.hasOwnProperty.call(context, 'preparationRequirements')) {
    errors.push('preparation_validation_context_required');
  } else {
    const expected = evaluateExecutionPreparationRequirements(
      context.authorizationRequest,
      context.authorizationDecision,
      context.admissionAuthorizationBinding,
      context.preparationRequirements,
      { bindingValidationContext: context.bindingValidationContext }
    );
    if (!valuesEqual(result, expected)) errors.push('preparation_context_mismatch');
  }

  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...collectSensitiveMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AUDIT_FIELDS,
  AUDIT_REQUIREMENT_FIELDS,
  AUTHORIZATION_SUMMARY_FIELDS,
  AUTHORIZATION_VALIDITY_REQUIREMENT_FIELDS,
  BINDING_SUMMARY_FIELDS,
  BUDGET_REQUIREMENT_FIELDS,
  ENVIRONMENT_REFERENCE_FIELDS,
  EVIDENCE_FIELDS,
  EXECUTION_PREPARATION_ELIGIBILITY_DECISIONS,
  EXECUTION_PREPARATION_ELIGIBILITY_NEXT_STATES,
  EXECUTION_PREPARATION_ELIGIBILITY_RESULT_FIELDS,
  EXECUTION_PREPARATION_ELIGIBILITY_STATUSES,
  EXECUTION_PREPARATION_ELIGIBILITY_VALIDATOR_VERSION,
  EXECUTION_PREPARATION_REQUIREMENTS_FIELDS,
  EXECUTION_PREPARATION_REQUIREMENTS_VALIDATOR_VERSION,
  EXECUTION_PREPARATION_REQUIREMENT_STATUSES,
  EXPIRATION_REQUIREMENT_FIELDS,
  IDEMPOTENCY_REQUIREMENT_FIELDS,
  IDENTITY_SUMMARY_FIELDS,
  KILL_SWITCH_REQUIREMENT_FIELDS,
  NETWORK_REQUIREMENT_FIELDS,
  PREPARATION_OUTCOMES,
  PROVIDER_REQUIREMENT_FIELDS,
  REQUIREMENTS_SUMMARY_FIELDS,
  RUNTIME_REQUIREMENT_FIELDS,
  SAFE_FALSE_AUTHORITY_FIELDS,
  SCOPE_SUMMARY_FIELDS,
  SECRET_REQUIREMENT_FIELDS,
  TARGET_REFERENCE_FIELDS,
  buildExecutionPreparationRequirements,
  buildPreparationMaterial,
  computeExecutionPreparationRequirementsFingerprint,
  evaluateExecutionPreparationRequirements,
  validateExecutionPreparationEligibilityResult,
  validateAdmissionAuthorizationSourceBinding,
  validateExecutionPreparationRequirements
};
