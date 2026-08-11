'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID
} = require('./public-web-transport-contract');
const {
  findTrialForbiddenFields,
  hashTrialPlan,
  validateTrialPlan
} = require('./public-web-canary-trial-contract');
const {
  validateExecutionPreparationEligibilityResult
} = require('./execution-preparation-requirement-boundary');

const PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION =
  'public_web_canary_preflight_readiness_boundary_v1';

const PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
  'PUBLIC_WEB_CANARY_PREFLIGHT_NOT_READY',
  'PUBLIC_WEB_CANARY_PREFLIGHT_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_DECISIONS = Object.freeze([
  'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
  'BLOCKED_REFERENCE'
]);

const OUTCOMES = Object.freeze({
  PUBLIC_WEB_CANARY_PREFLIGHT_READY: {
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN'
  },
  PUBLIC_WEB_CANARY_PREFLIGHT_NOT_READY: {
    decision: 'BLOCKED',
    next_state: 'BLOCKED_REFERENCE'
  },
  PUBLIC_WEB_CANARY_PREFLIGHT_VALIDATION_FAILED: {
    decision: 'BLOCKED',
    next_state: 'BLOCKED_REFERENCE'
  }
});

const RESULT_FIELDS = Object.freeze([
  'ok',
  'status',
  'decision',
  'next_state',
  'reason_codes',
  'readiness_id',
  'readiness_fingerprint',
  'preparation',
  'trial',
  'identity',
  'requirements',
  'authority_boundary',
  'evidence',
  'audit',
  'validator_version'
]);

const PREPARATION_FIELDS = Object.freeze([
  'preparation_eligibility_id',
  'preparation_eligibility_fingerprint',
  'status',
  'decision',
  'next_state'
]);

const TRIAL_FIELDS = Object.freeze([
  'trial_id',
  'trial_version',
  'plan_hash',
  'environment',
  'target_policy_id',
  'target_path_hash',
  'connector_id',
  'configuration_id',
  'adapter_id',
  'provider_id',
  'readiness_candidate_id'
]);

const IDENTITY_FIELDS = Object.freeze([
  'tenant_id',
  'organization_id',
  'project_id',
  'actor_id',
  'operator_id',
  'approver_id',
  'workspace_type',
  'user_id'
]);

const REQUIREMENT_FIELDS = Object.freeze([
  'canonical_preparation_eligible',
  'trial_plan_valid',
  'trial_plan_bound_to_preparation',
  'non_production_environment',
  'single_request_limit',
  'explicit_feature_flag_required',
  'kill_switch_required',
  'target_policy_required',
  'dns_resolver_required',
  'https_client_or_runner_required',
  'secret_reference_represented',
  'secret_resolution_not_performed',
  'network_not_used',
  'provider_not_called',
  'runtime_not_enabled',
  'worker_not_started',
  'queue_not_mutated',
  'scheduler_not_mutated',
  'dispatch_not_executed',
  'operational_persistence_not_written',
  'production_effect'
]);

const AUTHORITY_FIELDS = Object.freeze([
  'preparation_seen',
  'preflight_readiness_evaluated',
  'preflight_ready',
  'preflight_authorized',
  'dry_run_authorized',
  'operator_confirmation_authorized',
  'trial_execution_authorized',
  'provider_called',
  'external_network_used',
  'secret_resolved',
  'runtime_execution',
  'worker_execution',
  'queue_mutation',
  'scheduler_mutation',
  'dispatch_execution',
  'operational_persistence',
  'real_execution_authorized',
  'production_effect'
]);

const EVIDENCE_FIELDS = Object.freeze([
  'preparation_validated',
  'trial_plan_validated',
  'binding_validated',
  'security_boundary_validated',
  'readiness_material_fingerprint',
  'secret_material_exposed',
  'production_effect'
]);

const AUDIT_FIELDS = Object.freeze([
  'event_name',
  'trial_id',
  'preparation_eligibility_id',
  'decision',
  'next_state',
  'reason_codes',
  'provider_called',
  'external_network_used',
  'production_effect'
]);

function digest(value) {
  return computeCanonicalContentDigest(value);
}

function valuesEqual(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function summarizePreparation(result) {
  const safe = isPlainObject(result) ? result : {};
  return {
    preparation_eligibility_id: safe.preparation_eligibility_id || null,
    preparation_eligibility_fingerprint: safe.preparation_eligibility_fingerprint || null,
    status: safe.status || null,
    decision: safe.decision || null,
    next_state: safe.next_state || null
  };
}

function summarizeTrial(plan) {
  const safe = isPlainObject(plan) ? plan : {};
  return {
    trial_id: safe.trial_id || null,
    trial_version: Number.isInteger(safe.trial_version) ? safe.trial_version : null,
    plan_hash: safe.plan_hash || null,
    environment: safe.environment || null,
    target_policy_id: safe.target_policy_id || null,
    target_path_hash: safe.target_path_hash || null,
    connector_id: safe.connector_id || null,
    configuration_id: safe.configuration_id || null,
    adapter_id: safe.adapter_id || null,
    provider_id: safe.provider_id || null,
    readiness_candidate_id: safe.readiness_candidate_id || null
  };
}

function summarizeIdentity(preparationResult, plan) {
  const prepIdentity = isPlainObject(preparationResult && preparationResult.identity) ? preparationResult.identity : {};
  const safePlan = isPlainObject(plan) ? plan : {};
  return {
    tenant_id: prepIdentity.tenant_id || safePlan.tenant_id || null,
    organization_id: prepIdentity.organization_id || null,
    project_id: prepIdentity.project_id || null,
    actor_id: prepIdentity.actor_id || null,
    operator_id: safePlan.operator_id || null,
    approver_id: safePlan.approver_id || null,
    workspace_type: safePlan.workspace_type || null,
    user_id: safePlan.user_id || null
  };
}

function requirementSummary(ok) {
  return {
    canonical_preparation_eligible: ok === true,
    trial_plan_valid: ok === true,
    trial_plan_bound_to_preparation: ok === true,
    non_production_environment: ok === true,
    single_request_limit: ok === true,
    explicit_feature_flag_required: true,
    kill_switch_required: true,
    target_policy_required: true,
    dns_resolver_required: true,
    https_client_or_runner_required: true,
    secret_reference_represented: ok === true,
    secret_resolution_not_performed: true,
    network_not_used: true,
    provider_not_called: true,
    runtime_not_enabled: true,
    worker_not_started: true,
    queue_not_mutated: true,
    scheduler_not_mutated: true,
    dispatch_not_executed: true,
    operational_persistence_not_written: true,
    production_effect: 'ZERO'
  };
}

function authorityBoundary(ok) {
  return {
    preparation_seen: ok === true,
    preflight_readiness_evaluated: true,
    preflight_ready: ok === true,
    preflight_authorized: ok === true,
    dry_run_authorized: false,
    operator_confirmation_authorized: false,
    trial_execution_authorized: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    runtime_execution: false,
    worker_execution: false,
    queue_mutation: false,
    scheduler_mutation: false,
    dispatch_execution: false,
    operational_persistence: false,
    real_execution_authorized: false,
    production_effect: 'ZERO'
  };
}

function buildMaterial({ preparation, trial, identity, requirements, authority, status, decision, nextState, reasonCodes }) {
  return {
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION,
    preparation,
    trial,
    identity,
    requirements,
    authority_boundary: authority,
    status,
    decision,
    next_state: nextState,
    reason_codes: uniqueSorted(reasonCodes),
    production_effect: 'ZERO'
  };
}

function hasUnsafeAuthority(preparationResult) {
  const authority = preparationResult && preparationResult.authority_boundary;
  if (!isPlainObject(authority)) return ['preparation_authority_missing'];
  const failures = [];
  for (const field of [
    'execution_authorized',
    'provider_authorized',
    'provider_called',
    'secret_resolution_authorized',
    'secret_resolved',
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
  ]) {
    if (authority[field] !== false) failures.push(`preparation_${field}_must_be_false`);
  }
  if (authority.production_effect !== 'ZERO') failures.push('preparation_production_effect_must_be_zero');
  return failures;
}

function collectPreparationFailures(preparationResult, context) {
  const failures = [];
  if (!isPlainObject(preparationResult)) return ['preparation_result_missing'];
  if (preparationResult.ok !== true) failures.push('preparation_not_eligible');
  if (preparationResult.status !== 'EXECUTION_PREPARATION_ELIGIBLE_SIMULATION') failures.push('preparation_status_not_eligible');
  if (preparationResult.decision !== 'ENTER_EXECUTION_PREPARATION_SIMULATION') failures.push('preparation_decision_not_entry');
  failures.push(...hasUnsafeAuthority(preparationResult));
  if (isPlainObject(context) && isPlainObject(context.preparationValidationContext)) {
    const validation = validateExecutionPreparationEligibilityResult(
      preparationResult,
      context.preparationValidationContext
    );
    if (!validation.valid) failures.push('preparation_validation_context_mismatch');
  }
  return failures;
}

function collectTrialFailures(plan) {
  const failures = [];
  const validation = validateTrialPlan(plan);
  if (!validation.valid) failures.push('trial_plan_invalid');
  if (!isPlainObject(plan)) return failures;
  if (plan.environment === 'production') failures.push('production_environment_blocked');
  if (!['development', 'staging'].includes(plan.environment)) failures.push('non_production_environment_required');
  if (plan.maximum_requests !== 1) failures.push('maximum_requests_must_be_one');
  if (plan.production_allowed !== false) failures.push('production_allowed_must_be_false');
  if (plan.automatic_execution_allowed !== false) failures.push('automatic_execution_must_be_false');
  if (plan.message_integration_allowed !== false) failures.push('message_integration_must_be_false');
  if (plan.confirm_integration_allowed !== false) failures.push('confirm_integration_must_be_false');
  if (plan.connector_id !== CONNECTOR_ID) failures.push('connector_id_mismatch');
  if (plan.configuration_id !== CONFIGURATION_ID) failures.push('configuration_id_mismatch');
  if (plan.adapter_id !== ADAPTER_ID) failures.push('adapter_id_mismatch');
  if (plan.provider_id !== PROVIDER_ID) failures.push('provider_id_mismatch');
  if (plan.readiness_candidate_id !== READINESS_CANDIDATE_ID) failures.push('readiness_candidate_id_mismatch');
  if (plan.plan_hash !== hashTrialPlan(plan)) failures.push('plan_hash_mismatch');
  if (findTrialForbiddenFields(plan).length > 0) failures.push('trial_plan_forbidden_field_detected');
  return failures;
}

function collectBindingFailures(preparationResult, plan) {
  const failures = [];
  if (!isPlainObject(preparationResult) || !isPlainObject(plan)) return failures;
  const binding = isPlainObject(preparationResult.binding) ? preparationResult.binding : {};
  const source = isPlainObject(binding.source) ? binding.source : {};
  const identity = isPlainObject(preparationResult.identity) ? preparationResult.identity : {};
  if (source.trial_id !== plan.trial_id) failures.push('trial_id_binding_mismatch');
  if (source.plan_hash !== plan.plan_hash) failures.push('plan_hash_binding_mismatch');
  if (identity.tenant_id !== plan.tenant_id) failures.push('tenant_binding_mismatch');
  return failures;
}

function statusFor(reasonCodes) {
  if (reasonCodes.some((reason) => reason.includes('invalid') || reason.includes('missing') || reason.includes('mismatch'))) {
    return 'PUBLIC_WEB_CANARY_PREFLIGHT_VALIDATION_FAILED';
  }
  return 'PUBLIC_WEB_CANARY_PREFLIGHT_NOT_READY';
}

function buildResult({ ok, status, reasonCodes, preparationEligibilityResult, trialPlan, evidenceFlags }) {
  const outcome = OUTCOMES[status] || OUTCOMES.PUBLIC_WEB_CANARY_PREFLIGHT_VALIDATION_FAILED;
  const normalizedReasons = ok
    ? ['public_web_canary_preflight_ready_non_side_effect_only']
    : uniqueSorted([...reasonCodes, 'fail_closed']);
  const preparation = summarizePreparation(preparationEligibilityResult);
  const trial = summarizeTrial(trialPlan);
  const identity = summarizeIdentity(preparationEligibilityResult, trialPlan);
  const requirements = requirementSummary(ok);
  const authority = authorityBoundary(ok);
  const material = buildMaterial({
    preparation,
    trial,
    identity,
    requirements,
    authority,
    status,
    decision: outcome.decision,
    nextState: outcome.next_state,
    reasonCodes: normalizedReasons
  });
  const evidence = {
    preparation_validated: evidenceFlags.preparationValidated === true,
    trial_plan_validated: evidenceFlags.trialPlanValidated === true,
    binding_validated: evidenceFlags.bindingValidated === true,
    security_boundary_validated: true,
    readiness_material_fingerprint: digest(material),
    secret_material_exposed: false,
    production_effect: 'ZERO'
  };
  const readinessId = `public_web_canary_preflight_readiness:${digest({ material, evidence })}`;
  const audit = {
    event_name: ok === true
      ? 'public_web_canary_preflight_readiness_ready'
      : 'public_web_canary_preflight_readiness_blocked',
    trial_id: trial.trial_id,
    preparation_eligibility_id: preparation.preparation_eligibility_id,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    provider_called: false,
    external_network_used: false,
    production_effect: 'ZERO'
  };
  return cloneFrozen({
    ok,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    readiness_id: readinessId,
    readiness_fingerprint: digest({ material, evidence, audit }),
    preparation,
    trial,
    identity,
    requirements,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryPreflightReadiness(preparationEligibilityResult, trialPlan, context = {}) {
  const preparationFailures = collectPreparationFailures(preparationEligibilityResult, context);
  const trialFailures = collectTrialFailures(trialPlan);
  const bindingFailures = collectBindingFailures(preparationEligibilityResult, trialPlan);
  const reasonCodes = uniqueSorted([...preparationFailures, ...trialFailures, ...bindingFailures]);
  const ok = reasonCodes.length === 0;
  return buildResult({
    ok,
    status: ok ? 'PUBLIC_WEB_CANARY_PREFLIGHT_READY' : statusFor(reasonCodes),
    reasonCodes,
    preparationEligibilityResult,
    trialPlan,
    evidenceFlags: {
      preparationValidated: preparationFailures.length === 0,
      trialPlanValidated: trialFailures.length === 0,
      bindingValidated: bindingFailures.length === 0
    }
  });
}

function validatePublicWebCanaryPreflightReadinessResult(result, context = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['preflight_readiness_result_must_be_object'] };
  exactFields(result, RESULT_FIELDS, 'preflight_readiness_result', errors);
  if (typeof result.ok !== 'boolean') errors.push('ok_must_be_boolean');
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const outcome = OUTCOMES[result.status];
  if (outcome && result.decision !== outcome.decision) errors.push('decision_status_mismatch');
  if (outcome && result.next_state !== outcome.next_state) errors.push('next_state_status_mismatch');
  if (!Array.isArray(result.reason_codes) || result.reason_codes.some((reason) => !isNonEmptyString(reason))) {
    errors.push('reason_codes_invalid');
  }
  if (!isNonEmptyString(result.readiness_id)) errors.push('readiness_id_invalid');
  if (!isNonEmptyString(result.readiness_fingerprint)) errors.push('readiness_fingerprint_invalid');
  if (result.validator_version !== PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION) errors.push('validator_version_invalid');

  const exactObjects = [
    ['preparation', PREPARATION_FIELDS],
    ['trial', TRIAL_FIELDS],
    ['identity', IDENTITY_FIELDS],
    ['requirements', REQUIREMENT_FIELDS],
    ['authority_boundary', AUTHORITY_FIELDS],
    ['evidence', EVIDENCE_FIELDS],
    ['audit', AUDIT_FIELDS]
  ];
  let exact = true;
  for (const [field, fields] of exactObjects) {
    if (!isPlainObject(result[field])) {
      errors.push(`${field}_must_be_object`);
      exact = false;
    } else {
      exactFields(result[field], fields, field, errors);
    }
  }

  if (result.ok === true) {
    if (result.status !== 'PUBLIC_WEB_CANARY_PREFLIGHT_READY') errors.push('ok_status_mismatch');
    if (!valuesEqual(result.reason_codes, ['public_web_canary_preflight_ready_non_side_effect_only'])) {
      errors.push('ok_reason_codes_mismatch');
    }
  } else if (!result.reason_codes.includes('fail_closed')) {
    errors.push('blocked_fail_closed_required');
  }

  if (isPlainObject(result.authority_boundary)) {
    for (const field of [
      'dry_run_authorized',
      'operator_confirmation_authorized',
      'trial_execution_authorized',
      'provider_called',
      'external_network_used',
      'secret_resolved',
      'runtime_execution',
      'worker_execution',
      'queue_mutation',
      'scheduler_mutation',
      'dispatch_execution',
      'operational_persistence',
      'real_execution_authorized'
    ]) {
      if (result.authority_boundary[field] !== false) errors.push(`authority_${field}_must_be_false`);
    }
    if (result.authority_boundary.production_effect !== 'ZERO') errors.push('authority_production_effect_must_be_zero');
  }
  if (isPlainObject(result.evidence)) {
    if (result.evidence.secret_material_exposed !== false) errors.push('evidence_secret_material_exposed_must_be_false');
    if (result.evidence.production_effect !== 'ZERO') errors.push('evidence_production_effect_must_be_zero');
  }

  if (!isPlainObject(context)
    || !Object.prototype.hasOwnProperty.call(context, 'preparationEligibilityResult')
    || !Object.prototype.hasOwnProperty.call(context, 'trialPlan')) {
    errors.push('preflight_readiness_validation_context_required');
  } else {
    const expected = evaluatePublicWebCanaryPreflightReadiness(
      context.preparationEligibilityResult,
      context.trialPlan,
      context
    );
    if (!valuesEqual(result, expected)) errors.push('preflight_readiness_context_mismatch');
  }

  if (exact) {
    const material = buildMaterial({
      preparation: result.preparation,
      trial: result.trial,
      identity: result.identity,
      requirements: result.requirements,
      authority: result.authority_boundary,
      status: result.status,
      decision: result.decision,
      nextState: result.next_state,
      reasonCodes: result.reason_codes
    });
    if (result.evidence.readiness_material_fingerprint !== digest(material)) errors.push('readiness_material_fingerprint_mismatch');
    if (result.readiness_id !== `public_web_canary_preflight_readiness:${digest({ material, evidence: result.evidence })}`) {
      errors.push('readiness_id_mismatch');
    }
    if (result.readiness_fingerprint !== digest({ material, evidence: result.evidence, audit: result.audit })) {
      errors.push('readiness_fingerprint_mismatch');
    }
  }
  if (findTrialForbiddenFields(result).length > 0) errors.push('forbidden_field_detected');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`non_canonical_input::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AUTHORITY_FIELDS,
  AUDIT_FIELDS,
  EVIDENCE_FIELDS,
  IDENTITY_FIELDS,
  OUTCOMES,
  PREPARATION_FIELDS,
  PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_DECISIONS,
  PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_NEXT_STATES,
  PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES,
  PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION,
  REQUIREMENT_FIELDS,
  RESULT_FIELDS,
  TRIAL_FIELDS,
  buildMaterial,
  evaluatePublicWebCanaryPreflightReadiness,
  validatePublicWebCanaryPreflightReadinessResult
};
