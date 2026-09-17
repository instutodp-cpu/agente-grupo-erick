'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION,
  validatePublicWebCanaryPreflightReadinessResult
} = require('./public-web-canary-preflight-readiness-boundary');

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATOR_VERSION =
  'public_web_canary_preflight_entry_boundary_v1';

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_PREPARED_SIMULATION',
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_BLOCKED',
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_DECISIONS = Object.freeze([
  'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_PREPARED_SIMULATION',
  decision: 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const SAFE_FALSE_AUTHORITY_FIELDS = Object.freeze([
  'preflight_execution',
  'dry_run_execution',
  'operator_confirmation',
  'trial_execution',
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

function safeReference(readinessResult) {
  const safe = isPlainObject(readinessResult) ? readinessResult : {};
  const trial = isPlainObject(safe.trial) ? safe.trial : {};
  const preparation = isPlainObject(safe.preparation) ? safe.preparation : {};
  const identity = isPlainObject(safe.identity) ? safe.identity : {};
  return {
    readiness_id: isNonEmptyString(safe.readiness_id) ? safe.readiness_id : null,
    readiness_fingerprint: isNonEmptyString(safe.readiness_fingerprint) ? safe.readiness_fingerprint : null,
    readiness_validator_version: isNonEmptyString(safe.validator_version) ? safe.validator_version : null,
    status: isNonEmptyString(safe.status) ? safe.status : null,
    decision: isNonEmptyString(safe.decision) ? safe.decision : null,
    next_state: isNonEmptyString(safe.next_state) ? safe.next_state : null,
    trial_id: isNonEmptyString(trial.trial_id) ? trial.trial_id : null,
    plan_hash: isNonEmptyString(trial.plan_hash) ? trial.plan_hash : null,
    preparation_eligibility_id: isNonEmptyString(preparation.preparation_eligibility_id)
      ? preparation.preparation_eligibility_id
      : null,
    tenant_id: isNonEmptyString(identity.tenant_id) ? identity.tenant_id : null
  };
}

function collectReadinessFailures(readinessResult, context) {
  const failures = [];
  if (!isPlainObject(readinessResult)) return ['readiness_result_missing'];

  let validation;
  try {
    validation = validatePublicWebCanaryPreflightReadinessResult(readinessResult, context);
  } catch (_error) {
    failures.push('readiness_validation_threw');
    return failures;
  }

  if (!validation || validation.valid !== true) {
    const errors = validation && Array.isArray(validation.errors) ? validation.errors : ['unknown'];
    for (const error of errors) failures.push(`readiness_validation::${error}`);
  }

  if (readinessResult.ok !== true) failures.push('readiness_not_ok');
  if (readinessResult.status !== 'PUBLIC_WEB_CANARY_PREFLIGHT_READY') failures.push('readiness_status_not_ready');
  if (readinessResult.decision !== 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT') {
    failures.push('readiness_decision_not_entry');
  }
  if (readinessResult.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN') {
    failures.push('readiness_next_state_not_waiting_run');
  }
  if (readinessResult.validator_version !== PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION) {
    failures.push('readiness_validator_version_mismatch');
  }

  for (const legacyField of ['ready', 'ready_for_review', 'ready_for_real_execution', 'canary_authorized']) {
    if (Object.prototype.hasOwnProperty.call(readinessResult, legacyField)) {
      failures.push(`legacy_readiness_field_forbidden::${legacyField}`);
    }
  }

  const authority = isPlainObject(readinessResult.authority_boundary)
    ? readinessResult.authority_boundary
    : null;
  if (!authority) {
    failures.push('readiness_authority_missing');
  } else {
    if (authority.preflight_ready !== true) failures.push('readiness_preflight_ready_required');
    if (authority.preflight_authorized !== true) failures.push('readiness_preflight_authorized_required');
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
      if (authority[field] !== false) failures.push(`readiness_authority_${field}_must_be_false`);
    }
    if (authority.production_effect !== 'ZERO') failures.push('readiness_authority_production_effect_must_be_zero');
  }

  const requirements = isPlainObject(readinessResult.requirements) ? readinessResult.requirements : null;
  if (!requirements) {
    failures.push('readiness_requirements_missing');
  } else {
    for (const field of [
      'secret_resolution_not_performed',
      'network_not_used',
      'provider_not_called',
      'runtime_not_enabled',
      'worker_not_started',
      'queue_not_mutated',
      'scheduler_not_mutated',
      'dispatch_not_executed',
      'operational_persistence_not_written'
    ]) {
      if (requirements[field] !== true) failures.push(`readiness_requirement_${field}_required`);
    }
    if (requirements.production_effect !== 'ZERO') failures.push('readiness_requirements_production_effect_must_be_zero');
  }

  const evidence = isPlainObject(readinessResult.evidence) ? readinessResult.evidence : null;
  if (!evidence) {
    failures.push('readiness_evidence_missing');
  } else {
    if (evidence.secret_material_exposed !== false) failures.push('readiness_secret_material_exposed');
    if (evidence.production_effect !== 'ZERO') failures.push('readiness_evidence_production_effect_must_be_zero');
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    readiness_seen: true,
    readiness_validated: ok === true,
    preflight_entry_prepared: ok === true,
    non_side_effect_only: true,
    preflight_execution: false,
    dry_run_execution: false,
    operator_confirmation: false,
    trial_execution: false,
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

function buildResult(readinessResult, failures) {
  const ok = failures.length === 0;
  const status = ok
    ? SUCCESS.status
    : failures.some((reason) => reason.startsWith('readiness_validation::') || reason.endsWith('_missing') || reason.includes('mismatch'))
      ? 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok
    ? ['public_web_canary_preflight_entry_prepared_non_side_effect_only']
    : uniqueSorted([...failures, 'fail_closed']);
  const readinessReference = safeReference(readinessResult);
  const authority = authorityBoundary(ok);
  const material = {
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    readiness_reference: readinessReference,
    authority_boundary: authority,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };
  const evidence = {
    readiness_validated: ok,
    readiness_fingerprint_bound: ok && isNonEmptyString(readinessReference.readiness_fingerprint),
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    production_effect: 'ZERO'
  };
  const audit = {
    event_name: ok
      ? 'public_web_canary_preflight_entry_prepared_simulation'
      : 'public_web_canary_preflight_entry_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    provider_called: false,
    external_network_used: false,
    production_effect: 'ZERO'
  };
  const entryId = `public_web_canary_preflight_entry:${digest({ material, evidence })}`;
  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    entry_id: entryId,
    entry_fingerprint: digest({ material, evidence, audit }),
    readiness_reference: readinessReference,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryPreflightEntryBoundary(readinessResult, context = {}) {
  const failures = collectReadinessFailures(readinessResult, context);
  return buildResult(readinessResult, failures);
}

function validatePublicWebCanaryPreflightEntryBoundaryResult(result, readinessResult, context = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['preflight_entry_result_must_be_object'] };
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  if (!isNonEmptyString(result.entry_id)) errors.push('entry_id_invalid');
  if (!isNonEmptyString(result.entry_fingerprint)) errors.push('entry_fingerprint_invalid');
  if (result.validator_version !== PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  const expected = evaluatePublicWebCanaryPreflightEntryBoundary(readinessResult, context);
  if (!valuesEqual(result, expected)) errors.push('preflight_entry_context_mismatch');
  if (isPlainObject(result.authority_boundary)) {
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (result.authority_boundary[field] !== false) errors.push(`authority_${field}_must_be_false`);
    }
    if (result.authority_boundary.production_effect !== 'ZERO') errors.push('authority_production_effect_must_be_zero');
  } else {
    errors.push('authority_boundary_must_be_object');
  }
  if (isPlainObject(result.evidence)) {
    if (result.evidence.simulated !== true) errors.push('evidence_simulated_required');
    if (result.evidence.executed !== false) errors.push('evidence_executed_must_be_false');
    if (result.evidence.real_provider_called !== false) errors.push('evidence_real_provider_called_must_be_false');
    if (result.evidence.can_trigger_real_execution !== false) errors.push('evidence_can_trigger_real_execution_must_be_false');
    if (result.evidence.production_effect !== 'ZERO') errors.push('evidence_production_effect_must_be_zero');
  } else {
    errors.push('evidence_must_be_object');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_DECISIONS,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_NEXT_STATES,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_STATUSES,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATOR_VERSION,
  evaluatePublicWebCanaryPreflightEntryBoundary,
  validatePublicWebCanaryPreflightEntryBoundaryResult
};
