'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_BLOCKER_VALIDATOR_VERSION = 'orchestrator_blocker_validator_v1';

const ORCHESTRATOR_BLOCKER_FIELDS = Object.freeze([
  'blocker_id', 'blocker_version', 'blocker_type', 'source_reference_type', 'source_reference_id', 'severity',
  'blocking', 'resolvable', 'resolution_type', 'reason_code', 'logical_sequence', 'validator_version'
]);

const BLOCKER_TYPES = Object.freeze([
  'VALIDATION_BLOCKER', 'TENANT_BLOCKER', 'ORGANIZATION_BLOCKER', 'AGENT_BLOCKER', 'PROJECT_BLOCKER',
  'SESSION_BLOCKER', 'POLICY_BLOCKER', 'MEMORY_BLOCKER', 'PREFERENCE_BLOCKER', 'PROJECT_STATE_BLOCKER',
  'CONTINUITY_BLOCKER', 'CONTEXT_BLOCKER', 'MODEL_BLOCKER', 'TOOL_BLOCKER', 'WORKFLOW_BLOCKER', 'BUDGET_BLOCKER',
  'DEPENDENCY_BLOCKER', 'APPROVAL_BLOCKER', 'FINGERPRINT_BLOCKER', 'VERSION_BLOCKER', 'CONFLICT_BLOCKER',
  'UNKNOWN_STATUS_BLOCKER'
]);

const SEVERITIES = Object.freeze(['INFO', 'WARNING', 'HIGH', 'CRITICAL']);
const BLOCKING_ELIGIBLE_SEVERITIES = Object.freeze(['HIGH', 'CRITICAL']);

const RESOLUTION_TYPES = Object.freeze([
  'NONE', 'REVALIDATE_REFERENCE', 'REASSEMBLE_CONTEXT', 'RESELECT_MODEL', 'RESELECT_MEMORY', 'REVIEW_TOOL',
  'REVIEW_WORKFLOW', 'INCREASE_BUDGET', 'REQUEST_APPROVAL', 'RESOLVE_CONFLICT', 'REFRESH_REFERENCE', 'HUMAN_REVIEW'
]);

function validateOrchestratorBlocker(blocker) {
  const errors = [];
  if (!isPlainObject(blocker)) return { valid: false, errors: ['blocker_must_be_object'] };
  exactFields(blocker, ORCHESTRATOR_BLOCKER_FIELDS, 'blocker', errors);
  for (const field of ['blocker_id', 'source_reference_type', 'source_reference_id', 'reason_code', 'validator_version']) {
    if (!isNonEmptyString(blocker[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(blocker.blocker_version) || blocker.blocker_version < 1) errors.push('blocker_version_invalid');
  if (!BLOCKER_TYPES.includes(blocker.blocker_type)) errors.push(`blocker_type_not_allowed::${blocker.blocker_type}`);
  if (!SEVERITIES.includes(blocker.severity)) errors.push(`severity_not_allowed::${blocker.severity}`);
  if (typeof blocker.blocking !== 'boolean') errors.push('blocking_must_be_boolean');
  if (typeof blocker.resolvable !== 'boolean') errors.push('resolvable_must_be_boolean');
  if (!RESOLUTION_TYPES.includes(blocker.resolution_type)) errors.push(`resolution_type_not_allowed::${blocker.resolution_type}`);
  if (!Number.isInteger(blocker.logical_sequence) || blocker.logical_sequence < 0) errors.push('logical_sequence_invalid');

  if (blocker.blocking === true && !BLOCKING_ELIGIBLE_SEVERITIES.includes(blocker.severity)) {
    errors.push('only_high_or_critical_severity_may_block');
  }
  if (blocker.resolvable === false && blocker.resolution_type !== 'NONE') {
    errors.push('resolution_type_must_be_none_when_not_resolvable');
  }
  if (blocker.resolvable === true && blocker.resolution_type === 'NONE') {
    errors.push('resolvable_blocker_requires_a_resolution_type');
  }

  if (blocker.validator_version !== ORCHESTRATOR_BLOCKER_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(blocker);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(blocker));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorBlocker(overrides = {}) {
  const severity = SEVERITIES.includes(overrides.severity) ? overrides.severity : 'HIGH';
  const blocking = overrides.blocking === true;
  const resolvable = overrides.resolvable === true;
  return {
    blocker_id: overrides.blocker_id || 'blocker_not_available',
    blocker_version: Number.isInteger(overrides.blocker_version) ? overrides.blocker_version : 1,
    blocker_type: BLOCKER_TYPES.includes(overrides.blocker_type) ? overrides.blocker_type : 'VALIDATION_BLOCKER',
    source_reference_type: overrides.source_reference_type || 'unknown_reference_type',
    source_reference_id: overrides.source_reference_id || 'source_reference_not_available',
    severity,
    blocking: blocking && BLOCKING_ELIGIBLE_SEVERITIES.includes(severity),
    resolvable,
    resolution_type: resolvable ? (RESOLUTION_TYPES.includes(overrides.resolution_type) ? overrides.resolution_type : 'HUMAN_REVIEW') : 'NONE',
    reason_code: overrides.reason_code || 'blocker_reason_not_available',
    logical_sequence: Number.isInteger(overrides.logical_sequence) ? overrides.logical_sequence : 0,
    validator_version: ORCHESTRATOR_BLOCKER_VALIDATOR_VERSION
  };
}

module.exports = {
  BLOCKER_TYPES,
  BLOCKING_ELIGIBLE_SEVERITIES,
  ORCHESTRATOR_BLOCKER_FIELDS,
  ORCHESTRATOR_BLOCKER_VALIDATOR_VERSION,
  RESOLUTION_TYPES,
  SEVERITIES,
  buildOrchestratorBlocker,
  validateOrchestratorBlocker
};
