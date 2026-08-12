'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  CONTRACT_VERSION: BOOTSTRAP_CONTRACT_VERSION,
  validateHermesVpsBootstrapContract
} = require('./hermes-vps-bootstrap-contract');

const PLAN_VERSION = 'hermes-vps-provisioning-plan-v1';
const PLAN_MODE = 'PLAN_ONLY';
const HOST_ROLE = 'hermes_execution_plane';
const ENVIRONMENT = 'staging';
const PROVIDER_MODE = 'provider_neutral';
const PHASE_IDS = Object.freeze([
  'P0_HOST_VALIDATION', 'P1_BASE_OS_PREPARATION', 'P2_IDENTITY_USERS',
  'P3_FILESYSTEM_LAYOUT', 'P4_RUNTIME_DEPENDENCIES', 'P5_NETWORK_FIREWALL_INTENT',
  'P6_APPLICATION_PREPARATION', 'P7_PERSISTENT_DATA_LOGGING',
  'P8_SERVICE_SUPERVISION_INTENT', 'P9_HEALTH_READINESS_VERIFICATION',
  'P10_FINAL_HANDOFF'
]);
const PHASE_STEPS = Object.freeze([
  ['P0_HOST_VALIDATION', 'validate_host', 'READ_ONLY', false, false, false, false, false],
  ['P1_BASE_OS_PREPARATION', 'prepare_os_baseline', 'PACKAGE_INSTALL', true, true, false, false, false],
  ['P2_IDENTITY_USERS', 'prepare_service_identity', 'FILESYSTEM_MUTATION', true, true, false, false, false],
  ['P3_FILESYSTEM_LAYOUT', 'prepare_filesystem_layout', 'FILESYSTEM_MUTATION', true, true, false, false, false],
  ['P4_RUNTIME_DEPENDENCIES', 'describe_runtime_dependencies', 'PACKAGE_INSTALL', true, true, false, true, false],
  ['P5_NETWORK_FIREWALL_INTENT', 'describe_network_firewall_policy', 'FIREWALL_CONFIG', true, true, false, true, false],
  ['P6_APPLICATION_PREPARATION', 'place_exact_application_revision', 'LOCAL_CONFIG', true, true, false, true, false],
  ['P7_PERSISTENT_DATA_LOGGING', 'prepare_persistent_data_logging', 'FILESYSTEM_MUTATION', true, true, false, false, true],
  ['P8_SERVICE_SUPERVISION_INTENT', 'describe_service_supervision', 'SERVICE_CONFIG', true, true, false, false, true],
  ['P9_HEALTH_READINESS_VERIFICATION', 'verify_readiness_contracts', 'READ_ONLY', true, false, false, false, false],
  ['P10_FINAL_HANDOFF', 'prepare_authorized_handoff', 'READ_ONLY', true, false, false, false, false]
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  'provider_execution', 'production_execution', 'unauthorized_network_execution',
  'shell_execution_without_authorization', 'queue_mutation', 'scheduler_mutation',
  'dispatch', 'operational_persistence', 'secret_value_exposure'
]);
const EXECUTION_BOUNDARY = Object.freeze({
  plan_created_execution_authorized: false,
  execution_authorized: false,
  execution_performed: false,
  provider_execution_authorized: false,
  network_execution_authorized: false,
  shell_execution_authorized: false,
  production_execution_authorized: false,
  safe_mode: true,
  production_effect: 'ZERO'
});

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  const expected = new Set(fields);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${prefix}_unknown_field::${key}`);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_field::${field}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hashPlan(plan) {
  const copy = clone(plan);
  delete copy.plan_hash;
  return computeCanonicalContentDigest(JSON.parse(stablePayload(copy)));
}

function phaseDefinition(phaseId, index) {
  const step = PHASE_STEPS[index];
  return {
    phase_id: phaseId,
    order: index,
    purpose: `Declarative phase ${phaseId}`,
    preconditions: index === 0 ? ['bootstrap_contract_valid', 'environment_is_staging'] : [`${PHASE_IDS[index - 1]}_passed`],
    expected_state_transition: `${phaseId}_declared_not_executed`,
    verification_criteria: ['state_matches_contract', 'no_forbidden_effect_observed'],
    rollback_recovery: 'abort_and_preserve_logs_receipts_audit_secrets_and_persistent_data',
    human_approval_required: true,
    network_required: step[5],
    secrets_required: step[7],
    privileged_execution_required: step[3],
    idempotency_key: `hermes-vps-provisioning-v1::${phaseId}`
  };
}

function stepDefinition(phaseId, id, category, mutating, shellRequired, providerRequired, networkRequired, secretsRequired, order) {
  return {
    id,
    phase: phaseId,
    order,
    description: `Declarative future intent for ${id}`,
    category,
    requires_authorization: true,
    mutating,
    network_required: networkRequired,
    shell_required: shellRequired,
    provider_required: providerRequired,
    secrets_required: secretsRequired,
    expected_inputs: ['approved_host_fingerprint', 'exact_revision_reference', 'contract_references'],
    preconditions: [`${phaseId}_preconditions_passed`],
    intended_effect: 'describe_only_no_current_execution',
    verification: [`${id}_state_matches_contract`, 'production_effect_is_ZERO'],
    failure_behavior: 'fail_closed_stop_preserve_evidence',
    forbidden_effects: [...FORBIDDEN_EFFECTS],
    idempotency_key: `hermes-vps-provisioning-v1::${id}`
  };
}

function buildHermesVpsProvisioningPlan(options = {}) {
  const bootstrapContract = options.bootstrap_contract;
  const bootstrapResult = validateHermesVpsBootstrapContract(bootstrapContract);
  if (!bootstrapResult.valid) throw new Error(`invalid_bootstrap_contract::${bootstrapResult.errors.join(',')}`);
  const bootstrapHash = bootstrapContract.provenance && bootstrapContract.provenance.contract_hash;
  if (!isCanonicalContentDigest(bootstrapHash)) throw new Error('bootstrap_contract_hash_required');
  const provenance = {
    repository: bootstrapContract.provenance.repository,
    branch: bootstrapContract.provenance.branch,
    commit_sha: bootstrapContract.provenance.commit_sha
  };
  const phases = PHASE_IDS.map(phaseDefinition);
  const orderedSteps = PHASE_STEPS.map((entry, index) => stepDefinition(entry[0], entry[1], entry[2], entry[3], entry[4], entry[5], entry[6], entry[7], index));
  const plan = {
    plan_version: PLAN_VERSION,
    mode: PLAN_MODE,
    bootstrap_contract_version: BOOTSTRAP_CONTRACT_VERSION,
    bootstrap_contract_reference: { version: BOOTSTRAP_CONTRACT_VERSION, hash: bootstrapHash },
    target_host_role: bootstrapContract.host_role,
    target_os: bootstrapContract.operating_system,
    target_architecture: bootstrapContract.architecture,
    provider_mode: PROVIDER_MODE,
    environment: ENVIRONMENT,
    safe_mode: true,
    phases,
    ordered_steps: orderedSteps,
    prerequisites: ['approved_host_identity', 'valid_bootstrap_contract', 'exact_revision_reference'],
    expected_preconditions: ['environment_is_staging', 'production_is_forbidden', 'safe_mode_enabled'],
    expected_postconditions: ['plan_validated', 'no_execution_performed', 'audit_evidence_available'],
    rollback_abort: { strategy: 'abort_and_preserve_evidence', irreversible_steps: false, preserves: ['logs', 'receipts', 'audit_trail', 'secret_references', 'persistent_data'] },
    execution_authorization_requirement: 'separate_explicit_authorization_required',
    execution_boundary: { ...EXECUTION_BOUNDARY },
    secret_material_embedded: false,
    provider_neutral: true,
    network_requirements_descriptive_only: true,
    shell_requirements_descriptive_only: true,
    provenance: {
      repository: provenance.repository,
      branch: provenance.branch,
      commit_sha: provenance.commit_sha,
      bootstrap_contract_hash: bootstrapHash,
      input_fingerprint: computeCanonicalContentDigest({
        bootstrap_contract_hash: bootstrapHash,
        target_host_role: bootstrapContract.host_role,
        target_os: bootstrapContract.operating_system,
        target_architecture: bootstrapContract.architecture,
        provider_mode: PROVIDER_MODE,
        safe_mode: true
      })
    }
  };
  plan.plan_hash = hashPlan(plan);
  return deepFreeze(plan);
}

function validateHermesVpsProvisioningPlan(plan, bootstrapContract = null) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['plan_must_be_object'] };
  const fields = ['plan_version', 'mode', 'bootstrap_contract_version', 'bootstrap_contract_reference', 'target_host_role', 'target_os', 'target_architecture', 'provider_mode', 'environment', 'safe_mode', 'phases', 'ordered_steps', 'prerequisites', 'expected_preconditions', 'expected_postconditions', 'rollback_abort', 'execution_authorization_requirement', 'execution_boundary', 'secret_material_embedded', 'provider_neutral', 'network_requirements_descriptive_only', 'shell_requirements_descriptive_only', 'provenance', 'plan_hash'];
  exactFields(plan, fields, 'plan', errors);
  exactFields(plan.bootstrap_contract_reference, ['version', 'hash'], 'bootstrap_contract_reference', errors);
  exactFields(plan.execution_boundary, Object.keys(EXECUTION_BOUNDARY), 'execution_boundary', errors);
  exactFields(plan.provenance, ['repository', 'branch', 'commit_sha', 'bootstrap_contract_hash', 'input_fingerprint'], 'provenance', errors);
  if (plan.plan_version !== PLAN_VERSION) errors.push('plan_version_invalid');
  if (plan.mode !== PLAN_MODE) errors.push('plan_mode_must_be_plan_only');
  if (plan.bootstrap_contract_version !== BOOTSTRAP_CONTRACT_VERSION || plan.bootstrap_contract_reference?.version !== BOOTSTRAP_CONTRACT_VERSION) errors.push('bootstrap_contract_version_invalid');
  if (plan.target_host_role !== HOST_ROLE || plan.environment !== ENVIRONMENT) errors.push('target_context_invalid');
  if (plan.provider_mode !== PROVIDER_MODE || plan.provider_neutral !== true) errors.push('provider_neutrality_invalid');
  if (plan.target_os !== 'ubuntu_server_lts' || !['x86_64', 'arm64'].includes(plan.target_architecture)) errors.push('target_platform_invalid');
  if (plan.safe_mode !== true || plan.secret_material_embedded !== false || plan.network_requirements_descriptive_only !== true || plan.shell_requirements_descriptive_only !== true) errors.push('safety_defaults_invalid');
  if (plan.execution_authorization_requirement !== 'separate_explicit_authorization_required') errors.push('execution_authorization_requirement_invalid');
  if (plan.execution_boundary && Object.entries(EXECUTION_BOUNDARY).some(([key, value]) => plan.execution_boundary[key] !== value)) errors.push('execution_boundary_invalid');
  if (!Array.isArray(plan.phases) || plan.phases.length !== PHASE_IDS.length) errors.push('phase_count_invalid');
  else {
    const ids = plan.phases.map((phase) => phase.phase_id);
    if (JSON.stringify(ids) !== JSON.stringify(PHASE_IDS)) errors.push('phase_order_invalid');
    if (new Set(ids).size !== ids.length) errors.push('phase_ids_not_unique');
    for (const phase of plan.phases) {
      exactFields(phase, ['phase_id', 'order', 'purpose', 'preconditions', 'expected_state_transition', 'verification_criteria', 'rollback_recovery', 'human_approval_required', 'network_required', 'secrets_required', 'privileged_execution_required', 'idempotency_key'], `phase::${phase.phase_id}`, errors);
      if (phase.human_approval_required !== true || !Array.isArray(phase.verification_criteria) || phase.verification_criteria.length === 0) errors.push(`phase_safety_metadata_invalid::${phase.phase_id}`);
    }
  }
  if (!Array.isArray(plan.ordered_steps) || plan.ordered_steps.length !== PHASE_STEPS.length) errors.push('step_count_invalid');
  else {
    const ids = plan.ordered_steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) errors.push('step_ids_not_unique');
    if (plan.ordered_steps.some((step, index) => step.order !== index || step.phase !== PHASE_IDS[index])) errors.push('step_order_or_phase_invalid');
    for (const step of plan.ordered_steps) {
      exactFields(step, ['id', 'phase', 'order', 'description', 'category', 'requires_authorization', 'mutating', 'network_required', 'shell_required', 'provider_required', 'secrets_required', 'expected_inputs', 'preconditions', 'intended_effect', 'verification', 'failure_behavior', 'forbidden_effects', 'idempotency_key'], `step::${step.id}`, errors);
      if (step.mutating && step.requires_authorization !== true) errors.push(`mutating_step_authorization_missing::${step.id}`);
      if (step.provider_required === true || JSON.stringify(step.forbidden_effects) !== JSON.stringify(FORBIDDEN_EFFECTS)) errors.push(`step_execution_boundary_invalid::${step.id}`);
      if (!Array.isArray(step.verification) || step.verification.length === 0) errors.push(`step_verification_missing::${step.id}`);
    }
  }
  if (plan.bootstrap_contract_reference && !isCanonicalContentDigest(plan.bootstrap_contract_reference.hash)) errors.push('bootstrap_reference_hash_invalid');
  if (plan.provenance && (plan.provenance.repository !== 'instutodp-cpu/agente-grupo-erick' || !/^[0-9a-f]{40}$/.test(plan.provenance.commit_sha || '') || plan.provenance.bootstrap_contract_hash !== plan.bootstrap_contract_reference?.hash || !isCanonicalContentDigest(plan.provenance.input_fingerprint))) errors.push('provenance_invalid');
  if (bootstrapContract) {
    const bootstrapResult = validateHermesVpsBootstrapContract(bootstrapContract);
    if (!bootstrapResult.valid || bootstrapContract.provenance.contract_hash !== plan.bootstrap_contract_reference?.hash) errors.push('bootstrap_contract_incompatible');
  }
  if (plan.plan_hash !== hashPlan(plan)) errors.push('plan_hash_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  BOOTSTRAP_CONTRACT_VERSION,
  ENVIRONMENT,
  EXECUTION_BOUNDARY,
  HOST_ROLE,
  PHASE_IDS,
  PLAN_MODE,
  PLAN_VERSION,
  PROVIDER_MODE,
  buildHermesVpsProvisioningPlan,
  hashPlan,
  validateHermesVpsProvisioningPlan
};
