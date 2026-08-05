'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ADMISSION_STATUSES } = require('./runtime-queue-admission-entry-reference');

// pr109: the per-entry declarative materialization representation -- "Como essa entrada admitida
// seria representada e posicionada declarativamente na fila de runtime?" Every Queue Admission
// Entry produces exactly one Queue Materialization Entry (1:1 correspondence, "para preservar
// cardinalidade; auditabilidade; identidade; explicação da decisão"), but only a genuinely accepted
// AND validated admission entry can ever receive a non-null `materialization_position`.
//
// "QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION significa somente que uma entrada admitida foi
// representada declarativamente com uma posição lógica na fila. Nenhum item de fila real foi
// criado." `admission_status`/`queue_admission_validated` are the ORIGINAL facts already decided by
// Queue Admission -- carried here verbatim, never recomputed, never reinterpreted with a different
// meaning.
const RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_materialization_entry_reference_validator_v1';

const MATERIALIZATION_STATUSES = Object.freeze([
  'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION', 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE'
]);

const MAX_POSITION = 1000000;
const MAX_REASON_CODES = 50;

const RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_materialization_entry_reference_id', 'runtime_queue_materialization_entry_reference_version',
  'runtime_queue_materialization_package_id', 'runtime_queue_admission_package_id',
  'runtime_queue_admission_entry_reference_id', 'runtime_queue_admission_entry_fingerprint',
  'dispatch_intent_reference_id', 'runtime_queue_class_reference_id',
  'admission_status', 'queue_admission_validated',
  'materialization_status', 'materialization_position',
  'queue_materialization_validated',
  'queue_materialization_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued',
  'queue_position_reserved',
  'reason_codes',
  'materialization_entry_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_materialization_applied: false,
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

function computeMaterializationEntryFingerprint(reference) {
  const { materialization_entry_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueueMaterializationEntryReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_materialization_entry_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_FIELDS, 'runtime_queue_materialization_entry_reference', errors);
  for (const field of [
    'runtime_queue_materialization_entry_reference_id', 'runtime_queue_materialization_package_id',
    'runtime_queue_admission_package_id', 'runtime_queue_admission_entry_reference_id',
    'runtime_queue_admission_entry_fingerprint', 'dispatch_intent_reference_id',
    'materialization_entry_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_materialization_entry_reference_version) || reference.runtime_queue_materialization_entry_reference_version < 1) {
    errors.push('runtime_queue_materialization_entry_reference_version_invalid');
  }
  if (reference.runtime_queue_class_reference_id !== null && !isNonEmptyString(reference.runtime_queue_class_reference_id)) {
    errors.push('runtime_queue_class_reference_id_must_be_null_or_string');
  }
  if (!ADMISSION_STATUSES.includes(reference.admission_status)) errors.push('admission_status_invalid');
  if (typeof reference.queue_admission_validated !== 'boolean') errors.push('queue_admission_validated_must_be_boolean');
  if (!MATERIALIZATION_STATUSES.includes(reference.materialization_status)) errors.push('materialization_status_invalid');

  // "Elas nunca podem receber uma posição materializada válida." A materialization entry is only
  // ever PREPARED when the inherited admission fact was genuinely accepted+validated -- never
  // re-derived, never overridden.
  const expectedMaterializationStatus = reference.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' && reference.queue_admission_validated === true
    ? 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION'
    : 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE';
  if (reference.materialization_status !== expectedMaterializationStatus) errors.push('materialization_status_inconsistent_with_inherited_admission_fact');

  const isPrepared = reference.materialization_status === 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION';
  if (isPrepared) {
    if (!Number.isInteger(reference.materialization_position) || reference.materialization_position < 0 || reference.materialization_position > MAX_POSITION) {
      errors.push('materialization_position_invalid');
    }
  } else if (reference.materialization_position !== null) {
    errors.push('materialization_position_must_be_null_when_not_prepared');
  }
  if (typeof reference.queue_materialization_validated !== 'boolean') errors.push('queue_materialization_validated_must_be_boolean');
  else if (reference.queue_materialization_validated !== isPrepared) errors.push('queue_materialization_validated_inconsistent_with_status');

  if (!isSanitizedList(reference.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeMaterializationEntryFingerprint(reference) !== reference.materialization_entry_fingerprint) errors.push('materialization_entry_fingerprint_mismatch');
  } catch (error) {
    errors.push('materialization_entry_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueMaterializationEntryReference(input = {}) {
  const isPrepared = input.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' && input.queue_admission_validated === true;
  const reference = {
    runtime_queue_materialization_entry_reference_id: input.runtime_queue_materialization_entry_reference_id,
    runtime_queue_materialization_entry_reference_version: Number.isInteger(input.runtime_queue_materialization_entry_reference_version) ? input.runtime_queue_materialization_entry_reference_version : 1,
    runtime_queue_materialization_package_id: input.runtime_queue_materialization_package_id,
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
    runtime_queue_admission_entry_reference_id: input.runtime_queue_admission_entry_reference_id,
    runtime_queue_admission_entry_fingerprint: input.runtime_queue_admission_entry_fingerprint,
    dispatch_intent_reference_id: input.dispatch_intent_reference_id,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id === undefined ? null : input.runtime_queue_class_reference_id,
    admission_status: input.admission_status,
    queue_admission_validated: input.queue_admission_validated === true,
    materialization_status: isPrepared ? 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION' : 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE',
    materialization_position: isPrepared ? (Number.isInteger(input.materialization_position) ? input.materialization_position : 0) : null,
    queue_materialization_validated: isPrepared,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    materialization_entry_fingerprint: 'pending',
    ...RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_VALIDATOR_VERSION
  };
  reference.materialization_entry_fingerprint = computeMaterializationEntryFingerprint(reference);

  const validation = validateRuntimeQueueMaterializationEntryReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_materialization_entry_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MATERIALIZATION_STATUSES,
  MAX_POSITION,
  MAX_REASON_CODES,
  RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_FIELDS,
  RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueueMaterializationEntryReference,
  computeMaterializationEntryFingerprint,
  validateRuntimeQueueMaterializationEntryReference
};
