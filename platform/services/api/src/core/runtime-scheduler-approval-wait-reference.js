'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr105: derived exclusively from a Scheduler Stage Reference's own `approval_required` flag --
// "Derivar exclusivamente de approval_required. Nenhuma aprovação é concedida ou consumida." A
// stage with approval_required=true always carries waiting_for_approval=true and
// approval_status=WAITING_APPROVAL_REFERENCE; this PR never grants or consumes an approval, so
// approval_granted/approval_consumed/approval_applied are permanently forced false regardless of
// approval_status.
const RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_VALIDATOR_VERSION = 'runtime_scheduler_approval_wait_reference_validator_v1';

const APPROVAL_STATUSES = Object.freeze(['WAITING_APPROVAL_REFERENCE', 'APPROVAL_NOT_REQUIRED', 'APPROVAL_BLOCKED']);

const RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_FIELDS = Object.freeze([
  'approval_wait_reference_id', 'approval_wait_reference_version',
  'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'scheduler_stage_reference_id', 'runtime_stage_reference_id',
  'approval_required', 'approval_reference_id', 'approval_status', 'approval_validated', 'approval_applied',
  'waiting_for_approval', 'approval_granted', 'approval_consumed',
  'reason_codes', 'approval_wait_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_SAFE_FLAGS = Object.freeze({
  approval_applied: false,
  approval_granted: false,
  approval_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeApprovalWaitFingerprint(reference) {
  const { approval_wait_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeSchedulerApprovalWaitReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_scheduler_approval_wait_reference_must_be_object'] };
  exactFields(reference, RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_FIELDS, 'runtime_scheduler_approval_wait_reference', errors);
  for (const field of [
    'approval_wait_reference_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
    'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'approval_wait_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.approval_wait_reference_version) || reference.approval_wait_reference_version < 1) {
    errors.push('approval_wait_reference_version_invalid');
  }
  if (typeof reference.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (reference.approval_reference_id !== null && !isNonEmptyString(reference.approval_reference_id)) {
    errors.push('approval_reference_id_must_be_null_or_string');
  }
  if (!APPROVAL_STATUSES.includes(reference.approval_status)) errors.push('approval_status_invalid');
  if (typeof reference.approval_validated !== 'boolean') errors.push('approval_validated_must_be_boolean');
  for (const field of ['waiting_for_approval']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.approval_required === 'boolean' && typeof reference.waiting_for_approval === 'boolean' && isNonEmptyString(reference.approval_status)) {
    if (reference.approval_required === true) {
      if (reference.waiting_for_approval !== true) errors.push('waiting_for_approval_must_be_true_when_approval_required');
      if (reference.approval_status !== 'WAITING_APPROVAL_REFERENCE') errors.push('approval_status_must_be_waiting_when_approval_required');
    } else {
      if (reference.waiting_for_approval !== false) errors.push('waiting_for_approval_must_be_false_when_approval_not_required');
      if (reference.approval_status === 'WAITING_APPROVAL_REFERENCE') errors.push('approval_status_cannot_be_waiting_when_approval_not_required');
    }
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeApprovalWaitFingerprint(reference) !== reference.approval_wait_fingerprint) errors.push('approval_wait_fingerprint_mismatch');
  } catch (error) {
    errors.push('approval_wait_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerApprovalWaitReference(input = {}) {
  const approvalRequired = input.approval_required === true;
  const reference = {
    approval_wait_reference_id: input.approval_wait_reference_id,
    approval_wait_reference_version: Number.isInteger(input.approval_wait_reference_version) ? input.approval_wait_reference_version : 1,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    approval_required: approvalRequired,
    approval_reference_id: input.approval_reference_id === undefined ? null : input.approval_reference_id,
    approval_status: approvalRequired ? 'WAITING_APPROVAL_REFERENCE' : (input.approval_status === 'APPROVAL_BLOCKED' ? 'APPROVAL_BLOCKED' : 'APPROVAL_NOT_REQUIRED'),
    approval_validated: input.approval_validated === true,
    waiting_for_approval: approvalRequired,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    approval_wait_fingerprint: 'pending',
    ...RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_VALIDATOR_VERSION
  };
  reference.approval_wait_fingerprint = computeApprovalWaitFingerprint(reference);

  const validation = validateRuntimeSchedulerApprovalWaitReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_approval_wait_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  APPROVAL_STATUSES,
  MAX_LIST_ITEMS,
  RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_FIELDS,
  RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_SAFE_FLAGS,
  RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeSchedulerApprovalWaitReference,
  computeApprovalWaitFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeSchedulerApprovalWaitReference
};
