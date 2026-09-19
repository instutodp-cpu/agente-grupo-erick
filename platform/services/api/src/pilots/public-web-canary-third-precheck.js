'use strict';

const { findCanaryForbiddenFields, hashCanaryEvidence } = require('../core/public-web-canary-session-contract');
const { uniqueSorted } = require('../core/public-web-transport-contract');

const THIRD_CANARY_PRECHECK_VERSION = 'public_web_third_canary_offline_precheck_v1';
const REQUIRED_ENVIRONMENT = 'staging';
const REQUIRED_MAXIMUM_REQUESTS = 1;
const REQUIRED_ROLLOUT_PERCENTAGE = 1;
const REQUIRED_PROVIDER = 'official_public_web_provider';
const REQUIRED_TRANSPORT = 'official_public_web_real_transport_candidate';
const REQUIRED_TRANSPORT_SOURCE = 'official_public_web_node_https_client';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function fail(reasonCodes) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_PRECHECK_BLOCKED',
    phase: 'PRECHECK_OFFLINE',
    decision: 'WAIT_FOR_HUMAN_AUTHORIZATION',
    reason_codes: uniqueSorted(reasonCodes),
    production_allowed: false,
    real_canary_executable: false,
    grant_created: false,
    reservation_created: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    cleanup_required: true,
    revocation_required: true,
    validator_version: THIRD_CANARY_PRECHECK_VERSION
  });
}

function resourceFailures(resource, name, trialId, previousIds) {
  const failures = [];
  if (!isObject(resource)) return [`${name}_missing`];
  if (resource.fresh !== true) failures.push(`${name}_not_fresh`);
  if (resource.single_use !== true) failures.push(`${name}_not_single_use`);
  if (resource.consumed === true) failures.push(`${name}_already_consumed`);
  if (resource.reused === true || resource.previously_used === true) failures.push(`${name}_reused`);
  if (!isNonEmptyString(resource.id)) failures.push(`${name}_id_missing`);
  if (resource.trial_id !== trialId) failures.push(`${name}_trial_mismatch`);
  if (previousIds.includes(resource.id)) failures.push(`${name}_belongs_to_previous_canary`);
  return failures;
}

function validateThirdCanaryTelemetry(telemetry = {}) {
  const failures = [];
  const providerInvoked = telemetry.provider_invoked === true;
  const transportInvoked = telemetry.transport_invoked === true;
  const externalNetworkCalled = telemetry.external_network_called === true;
  const positiveEvidence = telemetry.external_network_evidence === true;

  if (transportInvoked && !providerInvoked) failures.push('transport_requires_provider_invoked');
  if (externalNetworkCalled && !transportInvoked) failures.push('external_network_requires_transport_invoked');
  if (externalNetworkCalled && !positiveEvidence) failures.push('external_network_positive_evidence_required');
  return { valid: failures.length === 0, errors: uniqueSorted(failures) };
}

function validateTarget(target, context) {
  if (!isObject(target)) return ['target_required_from_human'];
  if (target.synthetic === true || target.source !== 'human_approved_staging_external') {
    return ['target_external_staging_approval_required'];
  }
  if (!isNonEmptyString(target.origin) || !isNonEmptyString(target.path)) return ['target_required_from_human'];
  if (!target.targetAllowlist || typeof target.targetAllowlist.isTargetAllowed !== 'function') {
    return ['target_allowlist_required'];
  }
  const allowed = target.targetAllowlist.isTargetAllowed({
    target_origin: target.origin,
    target_path: target.path,
    environment: context.environment,
    operation: target.operation,
    source_type: target.source_type
  });
  if (!allowed || allowed.allowed !== true) return ['target_or_path_not_allowlisted'];
  if (!allowed.target_policy || allowed.target_policy.environment !== REQUIRED_ENVIRONMENT) {
    return ['target_policy_staging_required'];
  }
  if (allowed.target_policy.maximum_requests !== REQUIRED_MAXIMUM_REQUESTS) {
    return ['target_policy_maximum_requests_must_be_one'];
  }
  return [];
}

function preparePublicWebThirdCanaryPrecheck(input = {}) {
  const failures = [];
  if (findCanaryForbiddenFields(input).length > 0) failures.push('forbidden_field_detected');

  const identity = isObject(input.identity) ? input.identity : {};
  const trialId = identity.trial_id;
  if (!isNonEmptyString(trialId)) failures.push('trial_id_required');
  const previousIds = Array.isArray(identity.previous_canary_ids) ? identity.previous_canary_ids.map(String) : [];
  const previousResourceIds = Array.isArray(identity.previous_resource_ids) ? identity.previous_resource_ids.map(String) : [];
  if (!Array.isArray(identity.previous_canary_ids) || !Array.isArray(identity.previous_resource_ids)) failures.push('previous_identity_snapshot_required');
  if (previousIds.includes(String(trialId || ''))) failures.push('third_canary_identity_reused');

  if (input.environment !== REQUIRED_ENVIRONMENT) failures.push('staging_environment_required');
  if (input.production_allowed !== false) failures.push('production_must_remain_blocked');
  if (input.maximum_requests !== REQUIRED_MAXIMUM_REQUESTS) failures.push('maximum_requests_must_be_one');
  if (input.rollout_percentage !== REQUIRED_ROLLOUT_PERCENTAGE) failures.push('rollout_percentage_must_equal_one');

  const transport = isObject(input.transport) ? input.transport : {};
  if (transport.selected !== REQUIRED_TRANSPORT) failures.push('official_real_transport_opt_in_required');
  if (transport.source !== REQUIRED_TRANSPORT_SOURCE) failures.push('official_real_transport_source_required');
  if (transport.provider !== REQUIRED_PROVIDER) failures.push('official_provider_required');
  if (transport.synthetic === true || transport.synthetic === undefined) failures.push('synthetic_transport_forbidden');
  if (transport.enabled !== true) failures.push('real_transport_must_be_enabled_explicitly');

  const gates = isObject(input.gates) ? input.gates : {};
  if (gates.feature_flag_enabled !== true) failures.push('feature_flag_required');
  if (gates.kill_switch_active !== false) failures.push('kill_switch_must_be_healthy');
  failures.push(...validateTarget(input.target, { environment: input.environment }));

  const resources = isObject(input.resources) ? input.resources : {};
  const previousResourceSnapshot = [...previousIds, ...previousResourceIds];
  failures.push(...resourceFailures(resources.human_authorization, 'authorization', trialId, previousResourceSnapshot));
  failures.push(...resourceFailures(resources.grant, 'grant', trialId, previousResourceSnapshot));
  failures.push(...resourceFailures(resources.reservation, 'reservation', trialId, previousResourceSnapshot));
  if (isObject(resources.human_authorization) && resources.human_authorization.human_authorized === true) {
    failures.push('human_authorization_must_be_a_separate_next_phase');
  }

  const secretReference = input.secret_reference;
  if (!isObject(secretReference) || secretReference.valid !== true || secretReference.revoked === true || secretReference.disabled === true || secretReference.materialized === true) {
    failures.push('secret_reference_invalid');
  }

  const auditSink = input.audit_sink;
  if (!isObject(auditSink) || auditSink.available !== true || auditSink.durable !== true || auditSink.append_durably_available !== true) {
    failures.push('durable_audit_sink_required');
  }

  const execution = isObject(input.execution_policy) ? input.execution_policy : {};
  if (execution.attempt_count !== 0) failures.push('precheck_attempt_count_must_be_zero');
  if (execution.retry_enabled !== false) failures.push('automatic_retry_forbidden');
  if (execution.replay_attempt !== false) failures.push('replay_forbidden');
  if (execution.second_attempt !== false) failures.push('second_attempt_forbidden');

  const cleanup = isObject(input.cleanup) ? input.cleanup : {};
  if (cleanup.required !== true || cleanup.revocation_required !== true || cleanup.target_disable_required !== true) {
    failures.push('cleanup_and_revocation_required');
  }

  const evidence = isObject(input.evidence) ? input.evidence : {};
  if (evidence.sanitized !== true || evidence.sensitive_output_redacted !== true) failures.push('sanitized_evidence_required');

  const telemetry = validateThirdCanaryTelemetry(input.telemetry || {});
  failures.push(...telemetry.errors);
  if (input.telemetry && (input.telemetry.provider_invoked === true || input.telemetry.transport_invoked === true || input.telemetry.external_network_called === true)) {
    failures.push('precheck_must_not_execute');
  }

  if (failures.length > 0) return fail(failures);
  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_PRECHECK_READY',
    phase: 'PRECHECK_OFFLINE',
    decision: 'WAIT_FOR_HUMAN_AUTHORIZATION',
    trial_id_hash: hashCanaryEvidence({ trial_id: trialId }),
    target_status: 'APPROVED_EXTERNAL_STAGING_TARGET',
    production_allowed: false,
    maximum_requests: REQUIRED_MAXIMUM_REQUESTS,
    rollout_percentage: REQUIRED_ROLLOUT_PERCENTAGE,
    real_canary_executable: false,
    grant_created: false,
    reservation_created: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    cleanup_required: true,
    revocation_required: true,
    validator_version: THIRD_CANARY_PRECHECK_VERSION
  });
}

module.exports = {
  REQUIRED_ENVIRONMENT,
  REQUIRED_MAXIMUM_REQUESTS,
  REQUIRED_ROLLOUT_PERCENTAGE,
  REQUIRED_PROVIDER,
  REQUIRED_TRANSPORT,
  REQUIRED_TRANSPORT_SOURCE,
  THIRD_CANARY_PRECHECK_VERSION,
  preparePublicWebThirdCanaryPrecheck,
  validateThirdCanaryTelemetry
};
