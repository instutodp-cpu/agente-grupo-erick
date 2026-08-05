'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const {
  QUEUE_PLACEMENT_STATUSES, QUEUE_PLACEMENT_DECISIONS, QUEUE_PLACEMENT_NEXT_STATES
} = require('./runtime-queue-placement-decision');

const RUNTIME_QUEUE_PLACEMENT_AUDIT_VALIDATOR_VERSION = 'runtime_queue_placement_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

// Registers only IDs, fingerprints, digest, status/decision/next_state, identity bindings, queue
// class reference IDs, group reference IDs, counts, and blockers/reason codes -- never a payload,
// prompt, memory, message, tool argument, secret, endpoint, provider output, sensitive token, or
// credential. Mirrors runtime-queue-materialization-audit.js's own shape exactly, one layer up.
const RUNTIME_QUEUE_PLACEMENT_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'runtime_queue_placement_request_id', 'runtime_queue_placement_decision_id',
  'runtime_queue_placement_result_id', 'runtime_queue_placement_package_id',
  'runtime_queue_materialization_package_id',
  'fingerprints', 'package_digest',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding', 'actor_binding',
  'queue_class_reference_ids', 'queue_placement_group_reference_ids', 'entry_counts',
  'status', 'decision', 'next_state',
  'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze([
  'runtime_queue_placement_request_fingerprint', 'runtime_queue_placement_decision_fingerprint',
  'runtime_queue_placement_package_fingerprint', 'runtime_queue_materialization_package_fingerprint'
]);
const ENTRY_COUNT_KEYS = Object.freeze(['entry_count', 'placed_count', 'not_placed_count', 'group_count']);

const MAX_LIST_ITEMS = 200;

function isSanitizedList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateIntegerCountObject(value, keys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label}_must_be_object`);
    return;
  }
  for (const key of keys) {
    if (!Number.isInteger(value[key]) || value[key] < 0) errors.push(`${label}_${key}_invalid`);
  }
}

function validateRuntimeQueuePlacementAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_queue_placement_audit_must_be_object'] };
  exactFields(audit, RUNTIME_QUEUE_PLACEMENT_AUDIT_FIELDS, 'runtime_queue_placement_audit', errors);
  for (const field of [
    'audit_id', 'runtime_queue_placement_request_id', 'runtime_queue_placement_decision_id',
    'runtime_queue_placement_result_id', 'runtime_queue_placement_package_id',
    'runtime_queue_materialization_package_id', 'package_digest',
    'status', 'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!QUEUE_PLACEMENT_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!QUEUE_PLACEMENT_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!QUEUE_PLACEMENT_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

  if (!isPlainObject(audit.fingerprints)) {
    errors.push('fingerprints_must_be_object');
  } else {
    for (const key of FINGERPRINT_KEYS) {
      if (!isNonEmptyString(audit.fingerprints[key])) errors.push(`fingerprints_${key}_invalid`);
    }
  }
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) errors.push('organization_binding_invalid');
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.session_binding) || !isNonEmptyString(audit.session_binding.session_reference_id)) errors.push('session_binding_invalid');
  if (!isPlainObject(audit.agent_binding) || !isNonEmptyString(audit.agent_binding.agent_id)) errors.push('agent_binding_invalid');
  if (!isPlainObject(audit.actor_binding) || !isNonEmptyString(audit.actor_binding.actor_id)) errors.push('actor_binding_invalid');

  if (!isSanitizedList(audit.queue_class_reference_ids)) errors.push('queue_class_reference_ids_invalid');
  if (!isSanitizedList(audit.queue_placement_group_reference_ids)) errors.push('queue_placement_group_reference_ids_invalid');

  validateIntegerCountObject(audit.entry_counts, ENTRY_COUNT_KEYS, 'entry_counts', errors);

  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== RUNTIME_QUEUE_PLACEMENT_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueuePlacementAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};

  const audit = {
    audit_id: `runtime_queue_placement_audit_${result.runtime_queue_placement_result_id || decision.runtime_queue_placement_decision_id || NOT_AVAILABLE_LABEL}`,
    runtime_queue_placement_request_id: decision.runtime_queue_placement_request_id || NOT_AVAILABLE_LABEL,
    runtime_queue_placement_decision_id: decision.runtime_queue_placement_decision_id || NOT_AVAILABLE_LABEL,
    runtime_queue_placement_result_id: result.runtime_queue_placement_result_id || NOT_AVAILABLE_LABEL,
    runtime_queue_placement_package_id: decision.runtime_queue_placement_package_id || NOT_AVAILABLE_LABEL,
    runtime_queue_materialization_package_id: decision.runtime_queue_materialization_package_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      runtime_queue_placement_request_fingerprint: decision.runtime_queue_placement_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_queue_placement_decision_fingerprint: result.runtime_queue_placement_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_queue_placement_package_fingerprint: decision.runtime_queue_placement_package_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_queue_materialization_package_fingerprint: decision.runtime_queue_materialization_package_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.runtime_queue_placement_package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    queue_class_reference_ids: Array.isArray(input.queueClassReferenceIds) ? uniqueSorted(input.queueClassReferenceIds) : [],
    queue_placement_group_reference_ids: Array.isArray(input.queuePlacementGroupReferenceIds) ? uniqueSorted(input.queuePlacementGroupReferenceIds) : [],
    entry_counts: Object.fromEntries(ENTRY_COUNT_KEYS.map((key) => [key, Number.isInteger(result[key]) ? result[key] : 0])),
    status: decision.status || 'QUEUE_PLACEMENT_VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: RUNTIME_QUEUE_PLACEMENT_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  ENTRY_COUNT_KEYS,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  RUNTIME_QUEUE_PLACEMENT_AUDIT_FIELDS,
  RUNTIME_QUEUE_PLACEMENT_AUDIT_VALIDATOR_VERSION,
  buildRuntimeQueuePlacementAudit,
  validateRuntimeQueuePlacementAudit
};
