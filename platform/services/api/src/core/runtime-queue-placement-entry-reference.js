'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { MATERIALIZATION_STATUSES } = require('./runtime-queue-materialization-entry-reference');

// pr110: the per-entry declarative placement representation -- "A qual grupo lógico ou estrutura
// simulada essa representação seria colocada?" Every Queue Materialization Entry produces exactly
// one Queue Placement Entry (same 1:1 cardinality discipline as every prior layer), but only a
// genuinely `QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION` materialization entry can ever receive
// a non-null `placement_position`/`runtime_queue_placement_group_reference_id`.
//
// "QUEUE_PLACEMENT_PREPARED_SIMULATION significa somente que uma entrada materializada foi associada
// declarativamente a um grupo lógico simulado, com uma posição relativa dentro desse grupo. Nenhuma
// fila real, item de fila ou colocação operacional ocorreu." `materialization_status`/
// `materialization_position` are the ORIGINAL facts already decided by Queue Materialization --
// carried here verbatim, never recomputed, never reinterpreted with a different meaning.
const RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_placement_entry_reference_validator_v1';

const PLACEMENT_STATUSES = Object.freeze([
  'QUEUE_PLACEMENT_PREPARED_SIMULATION', 'QUEUE_PLACEMENT_BLOCKED_SIMULATION'
]);

const MAX_POSITION = 1000000;
const MAX_REASON_CODES = 50;

const RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_placement_entry_reference_id', 'runtime_queue_placement_entry_reference_version',
  'runtime_queue_placement_package_id', 'runtime_queue_materialization_package_id',
  'runtime_queue_materialization_entry_reference_id', 'runtime_queue_materialization_entry_fingerprint',
  'runtime_queue_admission_entry_reference_id', 'runtime_queue_class_reference_id',
  'runtime_queue_placement_group_reference_id',
  'materialization_status', 'materialization_position',
  'placement_status', 'placement_position',
  'queue_placement_validated',
  'queue_placement_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued', 'queue_position_reserved',
  'reason_codes',
  'placement_entry_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_placement_applied: false,
  queue_created: false,
  queue_item_created: false,
  queue_item_enqueued: false,
  queue_position_reserved: false,
  simulation: true,
  production_blocked: true
});

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function computePlacementEntryFingerprint(reference) {
  const { placement_entry_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueuePlacementEntryReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_placement_entry_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_FIELDS, 'runtime_queue_placement_entry_reference', errors);
  for (const field of [
    'runtime_queue_placement_entry_reference_id', 'runtime_queue_placement_package_id',
    'runtime_queue_materialization_package_id', 'runtime_queue_materialization_entry_reference_id',
    'runtime_queue_materialization_entry_fingerprint', 'runtime_queue_admission_entry_reference_id',
    'placement_entry_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_placement_entry_reference_version) || reference.runtime_queue_placement_entry_reference_version < 1) {
    errors.push('runtime_queue_placement_entry_reference_version_invalid');
  }
  if (reference.runtime_queue_class_reference_id !== null && !isNonEmptyString(reference.runtime_queue_class_reference_id)) {
    errors.push('runtime_queue_class_reference_id_must_be_null_or_string');
  }
  if (!MATERIALIZATION_STATUSES.includes(reference.materialization_status)) errors.push('materialization_status_invalid');
  if (
    reference.materialization_position !== null
    && (!Number.isInteger(reference.materialization_position) || reference.materialization_position < 0 || reference.materialization_position > MAX_POSITION)
  ) {
    errors.push('materialization_position_must_be_null_or_non_negative_integer');
  }
  if (!PLACEMENT_STATUSES.includes(reference.placement_status)) errors.push('placement_status_invalid');

  // "Somente entries oficialmente materializadas podem receber placement." Never recomputed from a
  // different meaning: structurally derived from the inherited materialization_status verbatim.
  const expectedPlacementStatus = reference.materialization_status === 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION'
    ? 'QUEUE_PLACEMENT_PREPARED_SIMULATION'
    : 'QUEUE_PLACEMENT_BLOCKED_SIMULATION';
  if (reference.placement_status !== expectedPlacementStatus) errors.push('placement_status_inconsistent_with_inherited_materialization_fact');

  const isPlaced = reference.placement_status === 'QUEUE_PLACEMENT_PREPARED_SIMULATION';
  if (isPlaced) {
    if (!Number.isInteger(reference.placement_position) || reference.placement_position < 0 || reference.placement_position > MAX_POSITION) {
      errors.push('placement_position_invalid');
    }
    if (!isNonEmptyString(reference.runtime_queue_placement_group_reference_id)) errors.push('runtime_queue_placement_group_reference_id_required_when_placed');
    if (!isNonEmptyString(reference.runtime_queue_class_reference_id)) errors.push('runtime_queue_class_reference_id_required_when_placed');
  } else {
    if (reference.placement_position !== null) errors.push('placement_position_must_be_null_when_not_placed');
    if (reference.runtime_queue_placement_group_reference_id !== null) errors.push('runtime_queue_placement_group_reference_id_must_be_null_when_not_placed');
  }
  if (typeof reference.queue_placement_validated !== 'boolean') errors.push('queue_placement_validated_must_be_boolean');
  else if (reference.queue_placement_validated !== isPlaced) errors.push('queue_placement_validated_inconsistent_with_status');

  if (!isSanitizedList(reference.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computePlacementEntryFingerprint(reference) !== reference.placement_entry_fingerprint) errors.push('placement_entry_fingerprint_mismatch');
  } catch (error) {
    errors.push('placement_entry_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueuePlacementEntryReference(input = {}) {
  const isPlaced = input.materialization_status === 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION';
  const reference = {
    runtime_queue_placement_entry_reference_id: input.runtime_queue_placement_entry_reference_id,
    runtime_queue_placement_entry_reference_version: Number.isInteger(input.runtime_queue_placement_entry_reference_version) ? input.runtime_queue_placement_entry_reference_version : 1,
    runtime_queue_placement_package_id: input.runtime_queue_placement_package_id,
    runtime_queue_materialization_package_id: input.runtime_queue_materialization_package_id,
    runtime_queue_materialization_entry_reference_id: input.runtime_queue_materialization_entry_reference_id,
    runtime_queue_materialization_entry_fingerprint: input.runtime_queue_materialization_entry_fingerprint,
    runtime_queue_admission_entry_reference_id: input.runtime_queue_admission_entry_reference_id,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id === undefined ? null : input.runtime_queue_class_reference_id,
    runtime_queue_placement_group_reference_id: isPlaced ? input.runtime_queue_placement_group_reference_id : null,
    materialization_status: input.materialization_status,
    materialization_position: input.materialization_position === undefined ? null : input.materialization_position,
    placement_status: isPlaced ? 'QUEUE_PLACEMENT_PREPARED_SIMULATION' : 'QUEUE_PLACEMENT_BLOCKED_SIMULATION',
    placement_position: isPlaced ? (Number.isInteger(input.placement_position) ? input.placement_position : 0) : null,
    queue_placement_validated: isPlaced,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    placement_entry_fingerprint: 'pending',
    ...RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_VALIDATOR_VERSION
  };
  reference.placement_entry_fingerprint = computePlacementEntryFingerprint(reference);

  const validation = validateRuntimeQueuePlacementEntryReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_placement_entry_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_POSITION,
  MAX_REASON_CODES,
  PLACEMENT_STATUSES,
  RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_FIELDS,
  RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueuePlacementEntryReference,
  computePlacementEntryFingerprint,
  validateRuntimeQueuePlacementEntryReference
};
