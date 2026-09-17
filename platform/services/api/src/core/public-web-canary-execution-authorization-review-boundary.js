'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATOR_VERSION,
  validatePublicWebCanaryDryRunRequestConsumerBoundaryResult
} = require('./public-web-canary-dry-run-request-consumer-boundary');

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATOR_VERSION =
  'public_web_canary_execution_authorization_review_boundary_v1';

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_PREPARED_SIMULATION',
  'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_BLOCKED',
  'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_DECISIONS = Object.freeze([
  'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_EXPLICIT_EXECUTION_AUTHORIZATION',
  'BLOCKED_REFERENCE'
]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_PREPARED_SIMULATION',
  decision: 'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_EXPLICIT_EXECUTION_AUTHORIZATION'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const SOURCE_SUCCESS_REASON =
  'public_web_canary_fake_dry_run_evidence_prepared_from_validated_dry_run_request_non_side_effect_only';

const SUCCESS_REASON =
  'public_web_canary_execution_authorization_review_prepared_from_validated_fake_dry_run_evidence_non_side_effect_only';

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

const BINDING_FIELDS = Object.freeze([
  'dry_run_request_id',
  'dry_run_request_fingerprint',
  'dry_run_request_validator_version',
  'preflight_request_id',
  'preflight_request_fingerprint',
  'preflight_request_validator_version',
  'entry_reference_id',
  'entry_reference_fingerprint',
  'entry_reference_validator_version',
  'entry_id',
  'entry_fingerprint',
  'entry_validator_version',
  'readiness_id',
  'readiness_fingerprint',
  'readiness_validator_version',
  'trial_id',
  'plan_hash',
  'preparation_eligibility_id',
  'tenant_id'
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

function safeSourceBinding(fakeDryRunResult) {
  const safe = isPlainObject(fakeDryRunResult) ? fakeDryRunResult : {};
  const fakeEvidence = isPlainObject(safe.fake_dry_run_evidence)
    ? safe.fake_dry_run_evidence
    : {};

  const binding = {
    fake_dry_run_evidence_id: isNonEmptyString(safe.fake_dry_run_evidence_id)
      ? safe.fake_dry_run_evidence_id
      : null,
    fake_dry_run_evidence_fingerprint: isNonEmptyString(safe.fake_dry_run_evidence_fingerprint)
      ? safe.fake_dry_run_evidence_fingerprint
      : null,
    fake_dry_run_evidence_validator_version: isNonEmptyString(safe.validator_version)
      ? safe.validator_version
      : null
  };

  for (const field of BINDING_FIELDS) {
    binding[field] = isNonEmptyString(fakeEvidence[field]) ? fakeEvidence[field] : null;
  }

  return binding;
}

function collectSourceFailures(
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult
) {
  const failures = [];

  if (!isPlainObject(fakeDryRunResult)) {
    return ['execution_authorization_review_source_missing'];
  }

  if (fakeDryRunResult.ok !== true) {
    failures.push('execution_authorization_review_source_not_ok');
  }
  if (
    fakeDryRunResult.status !==
    'PUBLIC_WEB_CANARY_FAKE_DRY_RUN_EVIDENCE_PREPARED_SIMULATION'
  ) {
    failures.push('execution_authorization_review_source_status_not_prepared');
  }
  if (
    fakeDryRunResult.decision !==
    'EVALUATE_PUBLIC_WEB_CANARY_FAKE_ONLY_DRY_RUN'
  ) {
    failures.push('execution_authorization_review_source_decision_mismatch');
  }
  if (
    fakeDryRunResult.next_state !==
    'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_BOUNDARY'
  ) {
    failures.push('execution_authorization_review_source_next_state_mismatch');
  }
  if (
    fakeDryRunResult.validator_version !==
    PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATOR_VERSION
  ) {
    failures.push('execution_authorization_review_source_validator_version_mismatch');
  }
  if (!valuesEqual(fakeDryRunResult.reason_codes, [SOURCE_SUCCESS_REASON])) {
    failures.push('execution_authorization_review_source_reason_codes_mismatch');
  }

  for (const legacyField of [
    'ready',
    'authorized',
    'canary_authorized',
    'execution_authorized',
    'dry_run_authorized',
    'operator_confirmation_authorized',
    'trial_execution_authorized',
    'ready_for_real_execution',
    'can_trigger_real_execution',
    'real_execution_authorized'
  ]) {
    if (Object.prototype.hasOwnProperty.call(fakeDryRunResult, legacyField)) {
      failures.push(
        'legacy_execution_authorization_review_source_field_forbidden::' + legacyField
      );
    }
  }

  if (!isPlainObject(dryRunResult)) {
    failures.push('dry_run_request_consumer_result_missing');
  }
  if (!isPlainObject(consumerResult)) {
    failures.push('preflight_request_consumer_result_missing');
  }
  if (!isPlainObject(referenceResult)) {
    failures.push('preflight_entry_reference_result_missing');
  }
  if (!isPlainObject(entryResult)) {
    failures.push('preflight_entry_result_missing');
  }

  if (
    isPlainObject(dryRunResult) &&
    isPlainObject(consumerResult) &&
    isPlainObject(referenceResult) &&
    isPlainObject(entryResult)
  ) {
    const validation = validatePublicWebCanaryDryRunRequestConsumerBoundaryResult(
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult
    );

    if (!validation.valid) {
      for (const error of validation.errors) {
        failures.push(
          'execution_authorization_review_source_validation::' + error
        );
      }
    }
  }

  if (!isNonEmptyString(fakeDryRunResult.fake_dry_run_evidence_id)) {
    failures.push('fake_dry_run_evidence_id_invalid');
  }
  if (!isNonEmptyString(fakeDryRunResult.fake_dry_run_evidence_fingerprint)) {
    failures.push('fake_dry_run_evidence_fingerprint_invalid');
  }

  const fakeEvidence = isPlainObject(fakeDryRunResult.fake_dry_run_evidence)
    ? fakeDryRunResult.fake_dry_run_evidence
    : null;

  if (!fakeEvidence) {
    failures.push('fake_dry_run_evidence_missing');
  } else {
    if (
      fakeEvidence.evidence_type !==
      'PUBLIC_WEB_CANARY_FAKE_ONLY_DRY_RUN_EVIDENCE_SIMULATION'
    ) {
      failures.push('fake_dry_run_evidence_type_mismatch');
    }

    for (const field of BINDING_FIELDS) {
      if (!isNonEmptyString(fakeEvidence[field])) {
        failures.push('fake_dry_run_evidence_' + field + '_invalid');
      }
    }

    if (fakeEvidence.fake_dry_run_evaluated !== true) {
      failures.push('fake_dry_run_evidence_evaluated_required');
    }
    if (fakeEvidence.evaluation_outcome !== 'FAKE_DRY_RUN_EVALUATION_PASSED') {
      failures.push('fake_dry_run_evidence_outcome_mismatch');
    }
    if (fakeEvidence.simulated !== true) {
      failures.push('fake_dry_run_evidence_simulated_required');
    }
    if (fakeEvidence.executed !== false) {
      failures.push('fake_dry_run_evidence_executed_must_be_false');
    }
    if (fakeEvidence.dry_run_execution !== false) {
      failures.push('fake_dry_run_evidence_dry_run_execution_must_be_false');
    }
    if (fakeEvidence.real_provider_called !== false) {
      failures.push('fake_dry_run_evidence_real_provider_called_must_be_false');
    }
    if (fakeEvidence.external_network_used !== false) {
      failures.push('fake_dry_run_evidence_external_network_used_must_be_false');
    }
    if (fakeEvidence.secret_resolved !== false) {
      failures.push('fake_dry_run_evidence_secret_resolved_must_be_false');
    }
    if (fakeEvidence.can_trigger_real_execution !== false) {
      failures.push('fake_dry_run_evidence_can_trigger_real_execution_must_be_false');
    }
    if (fakeEvidence.real_execution_authorized !== false) {
      failures.push('fake_dry_run_evidence_real_execution_authorized_must_be_false');
    }
    if (fakeEvidence.production_effect !== 'ZERO') {
      failures.push('fake_dry_run_evidence_production_effect_must_be_zero');
    }
  }

  const authority = isPlainObject(fakeDryRunResult.authority_boundary)
    ? fakeDryRunResult.authority_boundary
    : null;

  if (!authority) {
    failures.push('execution_authorization_review_source_authority_missing');
  } else {
    if (authority.dry_run_request_seen !== true) {
      failures.push('execution_authorization_review_source_dry_run_request_seen_required');
    }
    if (authority.dry_run_request_validated !== true) {
      failures.push(
        'execution_authorization_review_source_dry_run_request_validated_required'
      );
    }
    if (authority.fake_dry_run_evaluated !== true) {
      failures.push(
        'execution_authorization_review_source_fake_dry_run_evaluated_required'
      );
    }
    if (authority.fake_only !== true) {
      failures.push('execution_authorization_review_source_fake_only_required');
    }
    if (authority.non_side_effect_only !== true) {
      failures.push(
        'execution_authorization_review_source_non_side_effect_only_required'
      );
    }

    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (authority[field] !== false) {
        failures.push(
          'execution_authorization_review_source_authority_' +
            field +
            '_must_be_false'
        );
      }
    }

    if (authority.production_effect !== 'ZERO') {
      failures.push(
        'execution_authorization_review_source_authority_production_effect_must_be_zero'
      );
    }
  }

  const evidence = isPlainObject(fakeDryRunResult.evidence)
    ? fakeDryRunResult.evidence
    : null;

  if (!evidence) {
    failures.push('execution_authorization_review_source_evidence_missing');
  } else {
    if (evidence.fake_dry_run_evaluated !== true) {
      failures.push(
        'execution_authorization_review_source_evidence_fake_dry_run_evaluated_required'
      );
    }
    if (evidence.simulated !== true) {
      failures.push(
        'execution_authorization_review_source_evidence_simulated_required'
      );
    }
    if (evidence.executed !== false) {
      failures.push(
        'execution_authorization_review_source_evidence_executed_must_be_false'
      );
    }
    if (evidence.dry_run_execution !== false) {
      failures.push(
        'execution_authorization_review_source_evidence_dry_run_execution_must_be_false'
      );
    }
    if (evidence.real_provider_called !== false) {
      failures.push(
        'execution_authorization_review_source_evidence_real_provider_called_must_be_false'
      );
    }
    if (evidence.external_network_used !== false) {
      failures.push(
        'execution_authorization_review_source_evidence_external_network_used_must_be_false'
      );
    }
    if (evidence.secret_resolved !== false) {
      failures.push(
        'execution_authorization_review_source_evidence_secret_resolved_must_be_false'
      );
    }
    if (evidence.can_trigger_real_execution !== false) {
      failures.push(
        'execution_authorization_review_source_evidence_can_trigger_real_execution_must_be_false'
      );
    }
    if (evidence.real_execution_authorized !== false) {
      failures.push(
        'execution_authorization_review_source_evidence_real_execution_authorized_must_be_false'
      );
    }
    if (evidence.production_effect !== 'ZERO') {
      failures.push(
        'execution_authorization_review_source_evidence_production_effect_must_be_zero'
      );
    }
  }

  const audit = isPlainObject(fakeDryRunResult.audit)
    ? fakeDryRunResult.audit
    : null;

  if (!audit) {
    failures.push('execution_authorization_review_source_audit_missing');
  } else {
    if (
      audit.event_name !==
      'public_web_canary_fake_dry_run_evidence_prepared_simulation'
    ) {
      failures.push('execution_authorization_review_source_audit_event_mismatch');
    }
    if (audit.decision !== 'EVALUATE_PUBLIC_WEB_CANARY_FAKE_ONLY_DRY_RUN') {
      failures.push('execution_authorization_review_source_audit_decision_mismatch');
    }
    if (
      audit.next_state !==
      'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_BOUNDARY'
    ) {
      failures.push('execution_authorization_review_source_audit_next_state_mismatch');
    }
    if (!valuesEqual(audit.reason_codes, [SOURCE_SUCCESS_REASON])) {
      failures.push(
        'execution_authorization_review_source_audit_reason_codes_mismatch'
      );
    }
    if (audit.fake_only !== true) {
      failures.push('execution_authorization_review_source_audit_fake_only_required');
    }
    if (audit.provider_called !== false) {
      failures.push(
        'execution_authorization_review_source_audit_provider_called_must_be_false'
      );
    }
    if (audit.external_network_used !== false) {
      failures.push(
        'execution_authorization_review_source_audit_external_network_used_must_be_false'
      );
    }
    if (audit.secret_resolved !== false) {
      failures.push(
        'execution_authorization_review_source_audit_secret_resolved_must_be_false'
      );
    }
    if (audit.production_effect !== 'ZERO') {
      failures.push(
        'execution_authorization_review_source_audit_production_effect_must_be_zero'
      );
    }
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    fake_dry_run_evidence_seen: true,
    fake_dry_run_evidence_validated: ok === true,
    authorization_review_prepared: ok === true,
    review_only: true,
    explicit_separate_authorization_required: true,
    authorization_granted: false,
    execution_reservation_created: false,
    approver_confirmation: false,
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

function buildResult(fakeDryRunResult, failures) {
  const ok = failures.length === 0;
  const validationFailure = failures.some(
    (reason) =>
      reason.endsWith('_missing') ||
      reason.endsWith('_invalid') ||
      reason.includes('mismatch') ||
      reason.startsWith('execution_authorization_review_source_validation::')
  );

  const status = ok
    ? SUCCESS.status
    : validationFailure
      ? 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok
    ? [SUCCESS_REASON]
    : uniqueSorted(failures.concat(['fail_closed']));
  const sourceBinding = safeSourceBinding(fakeDryRunResult);
  const authority = authorityBoundary(ok);

  const authorizationReviewRequest = {
    request_type:
      'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_REQUEST_SIMULATION',
    fake_dry_run_evidence_id: sourceBinding.fake_dry_run_evidence_id,
    fake_dry_run_evidence_fingerprint:
      sourceBinding.fake_dry_run_evidence_fingerprint,
    fake_dry_run_evidence_validator_version:
      sourceBinding.fake_dry_run_evidence_validator_version,
    dry_run_request_id: sourceBinding.dry_run_request_id,
    dry_run_request_fingerprint: sourceBinding.dry_run_request_fingerprint,
    dry_run_request_validator_version:
      sourceBinding.dry_run_request_validator_version,
    preflight_request_id: sourceBinding.preflight_request_id,
    preflight_request_fingerprint: sourceBinding.preflight_request_fingerprint,
    preflight_request_validator_version:
      sourceBinding.preflight_request_validator_version,
    entry_reference_id: sourceBinding.entry_reference_id,
    entry_reference_fingerprint: sourceBinding.entry_reference_fingerprint,
    entry_reference_validator_version:
      sourceBinding.entry_reference_validator_version,
    entry_id: sourceBinding.entry_id,
    entry_fingerprint: sourceBinding.entry_fingerprint,
    entry_validator_version: sourceBinding.entry_validator_version,
    readiness_id: sourceBinding.readiness_id,
    readiness_fingerprint: sourceBinding.readiness_fingerprint,
    readiness_validator_version: sourceBinding.readiness_validator_version,
    trial_id: sourceBinding.trial_id,
    plan_hash: sourceBinding.plan_hash,
    preparation_eligibility_id: sourceBinding.preparation_eligibility_id,
    tenant_id: sourceBinding.tenant_id,
    review_scope: 'NON_PRODUCTION_SINGLE_EXECUTION_REVIEW_ONLY',
    explicit_separate_authorization_required: true,
    review_prepared: ok,
    authorization_granted: false,
    execution_reservation_created: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };

  const material = {
    validator_version:
      PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    source_binding: sourceBinding,
    authorization_review_request: authorizationReviewRequest,
    authority_boundary: authority,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };

  const evidence = {
    fake_dry_run_evidence_validated: ok,
    fake_dry_run_evidence_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.fake_dry_run_evidence_id) &&
      isNonEmptyString(sourceBinding.fake_dry_run_evidence_fingerprint),
    authorization_review_prepared: ok,
    explicit_separate_authorization_required: true,
    authorization_granted: false,
    execution_reservation_created: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    simulated: true,
    executed: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    production_effect: 'ZERO'
  };

  const audit = {
    event_name: ok
      ? 'public_web_canary_execution_authorization_review_prepared_simulation'
      : 'public_web_canary_execution_authorization_review_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    review_only: true,
    explicit_separate_authorization_required: true,
    authorization_granted: false,
    execution_reservation_created: false,
    can_trigger_real_execution: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    production_effect: 'ZERO'
  };

  const authorizationReviewRequestId =
    'public_web_canary_execution_authorization_review:' +
    digest({ material, evidence });

  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    authorization_review_request_id: authorizationReviewRequestId,
    authorization_review_request_fingerprint: digest({
      material,
      evidence,
      audit
    }),
    authorization_review_request: authorizationReviewRequest,
    source_binding: sourceBinding,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version:
      PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult
) {
  const failures = collectSourceFailures(
    fakeDryRunResult,
    dryRunResult,
    consumerResult,
    referenceResult,
    entryResult
  );
  return buildResult(fakeDryRunResult, failures);
}

function validatePublicWebCanaryExecutionAuthorizationReviewBoundaryResult(
  result,
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult
) {
  const errors = [];

  if (!isPlainObject(result)) {
    return {
      valid: false,
      errors: ['execution_authorization_review_result_must_be_object']
    };
  }

  if (!PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_STATUSES.includes(result.status)) {
    errors.push('status_invalid');
  }
  if (
    !PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_DECISIONS.includes(
      result.decision
    )
  ) {
    errors.push('decision_invalid');
  }
  if (
    !PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_NEXT_STATES.includes(
      result.next_state
    )
  ) {
    errors.push('next_state_invalid');
  }
  if (!isNonEmptyString(result.authorization_review_request_id)) {
    errors.push('authorization_review_request_id_invalid');
  }
  if (!isNonEmptyString(result.authorization_review_request_fingerprint)) {
    errors.push('authorization_review_request_fingerprint_invalid');
  }
  if (
    result.validator_version !==
    PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATOR_VERSION
  ) {
    errors.push('validator_version_invalid');
  }

  const expected = evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary(
    fakeDryRunResult,
    dryRunResult,
    consumerResult,
    referenceResult,
    entryResult
  );

  if (!valuesEqual(result, expected)) {
    errors.push('execution_authorization_review_context_mismatch');
  }

  if (isPlainObject(result.authority_boundary)) {
    if (result.authority_boundary.review_only !== true) {
      errors.push('authority_review_only_required');
    }
    if (
      result.authority_boundary.explicit_separate_authorization_required !== true
    ) {
      errors.push('authority_explicit_separate_authorization_required');
    }
    if (result.authority_boundary.authorization_granted !== false) {
      errors.push('authority_authorization_granted_must_be_false');
    }
    if (result.authority_boundary.execution_reservation_created !== false) {
      errors.push('authority_execution_reservation_created_must_be_false');
    }
    if (result.authority_boundary.approver_confirmation !== false) {
      errors.push('authority_approver_confirmation_must_be_false');
    }
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (result.authority_boundary[field] !== false) {
        errors.push('authority_' + field + '_must_be_false');
      }
    }
    if (result.authority_boundary.production_effect !== 'ZERO') {
      errors.push('authority_production_effect_must_be_zero');
    }
  } else {
    errors.push('authority_boundary_must_be_object');
  }

  if (isPlainObject(result.authorization_review_request)) {
    if (
      result.authorization_review_request.request_type !==
      'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_REQUEST_SIMULATION'
    ) {
      errors.push('authorization_review_request_type_invalid');
    }
    if (
      result.authorization_review_request.explicit_separate_authorization_required !==
      true
    ) {
      errors.push(
        'authorization_review_request_explicit_separate_authorization_required'
      );
    }
    if (result.authorization_review_request.authorization_granted !== false) {
      errors.push('authorization_review_request_authorization_granted_must_be_false');
    }
    if (
      result.authorization_review_request.execution_reservation_created !== false
    ) {
      errors.push(
        'authorization_review_request_execution_reservation_created_must_be_false'
      );
    }
    if (result.authorization_review_request.can_trigger_real_execution !== false) {
      errors.push(
        'authorization_review_request_can_trigger_real_execution_must_be_false'
      );
    }
    if (result.authorization_review_request.real_execution_authorized !== false) {
      errors.push(
        'authorization_review_request_real_execution_authorized_must_be_false'
      );
    }
    if (result.authorization_review_request.simulated !== true) {
      errors.push('authorization_review_request_simulated_required');
    }
    if (result.authorization_review_request.executed !== false) {
      errors.push('authorization_review_request_executed_must_be_false');
    }
    if (result.authorization_review_request.production_effect !== 'ZERO') {
      errors.push('authorization_review_request_production_effect_must_be_zero');
    }
  } else {
    errors.push('authorization_review_request_must_be_object');
  }

  if (isPlainObject(result.evidence)) {
    if (result.evidence.explicit_separate_authorization_required !== true) {
      errors.push('evidence_explicit_separate_authorization_required');
    }
    if (result.evidence.authorization_granted !== false) {
      errors.push('evidence_authorization_granted_must_be_false');
    }
    if (result.evidence.execution_reservation_created !== false) {
      errors.push('evidence_execution_reservation_created_must_be_false');
    }
    if (result.evidence.can_trigger_real_execution !== false) {
      errors.push('evidence_can_trigger_real_execution_must_be_false');
    }
    if (result.evidence.real_execution_authorized !== false) {
      errors.push('evidence_real_execution_authorized_must_be_false');
    }
    if (result.evidence.simulated !== true) {
      errors.push('evidence_simulated_required');
    }
    if (result.evidence.executed !== false) {
      errors.push('evidence_executed_must_be_false');
    }
    if (result.evidence.provider_called !== false) {
      errors.push('evidence_provider_called_must_be_false');
    }
    if (result.evidence.external_network_used !== false) {
      errors.push('evidence_external_network_used_must_be_false');
    }
    if (result.evidence.secret_resolved !== false) {
      errors.push('evidence_secret_resolved_must_be_false');
    }
    if (result.evidence.production_effect !== 'ZERO') {
      errors.push('evidence_production_effect_must_be_zero');
    }
  } else {
    errors.push('evidence_must_be_object');
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_DECISIONS,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_NEXT_STATES,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_STATUSES,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATOR_VERSION,
  evaluatePublicWebCanaryExecutionAuthorizationReviewBoundary,
  validatePublicWebCanaryExecutionAuthorizationReviewBoundaryResult
};
