'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { APPROVAL_STATUSES } = require('./runtime-scheduler-approval-wait-reference');

// pr107: derived exclusively from the Dispatch Stage's own `approval_required` flag -- mirrors
// runtime-scheduler-approval-wait-reference.js's own discipline one layer up: "Nenhuma aprovação é
// concedida ou consumida." `dispatch_allowed_by_approval` is a pure derived boolean, never true when
// approval_required=true, regardless of any caller-supplied claim.
const RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_approval_gate_reference_validator_v1';

const RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_FIELDS = Object.freeze([
  'dispatch_approval_gate_reference_id', 'dispatch_approval_gate_reference_version',
  'runtime_dispatch_package_id', 'runtime_scheduler_package_id',
  'runtime_dispatch_stage_reference_id', 'scheduler_stage_reference_id',
  'approval_required', 'approval_wait_reference_id', 'approval_status',
  'approval_validated', 'approval_granted', 'approval_consumed', 'approval_applied', 'dispatch_allowed_by_approval',
  'reason_codes',
  'approval_gate_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_SAFE_FLAGS = Object.freeze({
  approval_granted: false,
  approval_consumed: false,
  approval_applied: false,
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

function computeApprovalGateFingerprint(reference) {
  const { approval_gate_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchApprovalGateReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_approval_gate_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_FIELDS, 'runtime_dispatch_approval_gate_reference', errors);
  for (const field of [
    'dispatch_approval_gate_reference_id', 'runtime_dispatch_package_id', 'runtime_scheduler_package_id',
    'runtime_dispatch_stage_reference_id', 'scheduler_stage_reference_id', 'approval_gate_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dispatch_approval_gate_reference_version) || reference.dispatch_approval_gate_reference_version < 1) {
    errors.push('dispatch_approval_gate_reference_version_invalid');
  }
  if (typeof reference.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (reference.approval_wait_reference_id !== null && !isNonEmptyString(reference.approval_wait_reference_id)) {
    errors.push('approval_wait_reference_id_must_be_null_or_string');
  }
  if (!APPROVAL_STATUSES.includes(reference.approval_status)) errors.push('approval_status_invalid');
  if (typeof reference.approval_validated !== 'boolean') errors.push('approval_validated_must_be_boolean');
  if (typeof reference.dispatch_allowed_by_approval !== 'boolean') errors.push('dispatch_allowed_by_approval_must_be_boolean');
  if (typeof reference.approval_required === 'boolean' && typeof reference.dispatch_allowed_by_approval === 'boolean') {
    if (reference.approval_required === true && reference.dispatch_allowed_by_approval !== false) {
      errors.push('dispatch_allowed_by_approval_must_be_false_when_approval_required');
    }
    if (reference.approval_required === false && reference.dispatch_allowed_by_approval !== true) {
      errors.push('dispatch_allowed_by_approval_must_be_true_when_approval_not_required');
    }
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeApprovalGateFingerprint(reference) !== reference.approval_gate_fingerprint) errors.push('approval_gate_fingerprint_mismatch');
  } catch (error) {
    errors.push('approval_gate_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchApprovalGateReference(input = {}) {
  const approvalRequired = input.approval_required === true;
  const reference = {
    dispatch_approval_gate_reference_id: input.dispatch_approval_gate_reference_id,
    dispatch_approval_gate_reference_version: Number.isInteger(input.dispatch_approval_gate_reference_version) ? input.dispatch_approval_gate_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    approval_required: approvalRequired,
    approval_wait_reference_id: input.approval_wait_reference_id === undefined ? null : input.approval_wait_reference_id,
    approval_status: approvalRequired ? 'WAITING_APPROVAL_REFERENCE' : (input.approval_status === 'APPROVAL_BLOCKED' ? 'APPROVAL_BLOCKED' : 'APPROVAL_NOT_REQUIRED'),
    approval_validated: true,
    dispatch_allowed_by_approval: !approvalRequired,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    approval_gate_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_VALIDATOR_VERSION
  };
  reference.approval_gate_fingerprint = computeApprovalGateFingerprint(reference);

  const validation = validateRuntimeDispatchApprovalGateReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_approval_gate_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_LIST_ITEMS,
  RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchApprovalGateReference,
  computeApprovalGateFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchApprovalGateReference
};
