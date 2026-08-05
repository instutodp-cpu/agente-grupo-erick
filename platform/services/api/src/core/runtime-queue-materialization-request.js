'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRuntimeQueueAdmissionPackage } = require('./runtime-queue-admission-package');
const { validateRuntimeQueueAdmissionEntryReference } = require('./runtime-queue-admission-entry-reference');
const { validateRuntimeQueueAdmissionOrderReference } = require('./runtime-queue-admission-order-reference');
const { validateRuntimeQueueClassReference } = require('./runtime-queue-class-reference');

// pr109: "A única entrada de negócio válida deve ser o contrato oficial produzido pela PR108:
// QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION." This request bundles that Package with the exact
// sub-objects it already committed to via its own ID/fingerprint lists (Admission Entries, its own
// Order Reference, Queue Class References) -- never a second, independently-declared source of
// truth. The boundary proves every one of these is genuinely the same object the Package's own
// fingerprints already name, never a caller-substituted stand-in ("não aceitar... admission entries
// avulsas; Queue Class avulsa" -- "avulsas" means unaccompanied by, and unproven against, the
// official Package; bundling them WITH the Package for non-substitution proof is not the same as
// accepting them as an independent source).
const RUNTIME_QUEUE_MATERIALIZATION_REQUEST_VALIDATOR_VERSION = 'runtime_queue_materialization_request_validator_v1';

const RUNTIME_QUEUE_MATERIALIZATION_REQUEST_FIELDS = Object.freeze([
  'runtime_queue_materialization_request_id', 'runtime_queue_materialization_request_version',
  'runtime_queue_admission_package_reference', 'runtime_queue_admission_entry_references',
  'runtime_queue_admission_order_reference', 'runtime_queue_class_references',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence',
  'expected_queue_materialization_registry_version', 'simulation_context', 'validator_version'
]);

const SINGLE_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_queue_admission_package_reference', validateRuntimeQueueAdmissionPackage],
  ['runtime_queue_admission_order_reference', validateRuntimeQueueAdmissionOrderReference]
]);

const LIST_NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['runtime_queue_admission_entry_references', validateRuntimeQueueAdmissionEntryReference],
  ['runtime_queue_class_references', validateRuntimeQueueClassReference]
]);

const MAX_LIST_ITEMS = 1000;

function validateRuntimeQueueMaterializationRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['runtime_queue_materialization_request_must_be_object'] };
  exactFields(request, RUNTIME_QUEUE_MATERIALIZATION_REQUEST_FIELDS, 'runtime_queue_materialization_request', errors);
  for (const field of ['runtime_queue_materialization_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.runtime_queue_materialization_request_version) || request.runtime_queue_materialization_request_version < 1) {
    errors.push('runtime_queue_materialization_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_queue_materialization_registry_version) || request.expected_queue_materialization_registry_version < 1) {
    errors.push('expected_queue_materialization_registry_version_invalid');
  }

  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  for (const [field, validator] of SINGLE_NESTED_REFERENCE_VALIDATORS) {
    const result = validator(request[field]);
    if (!result.valid) errors.push(`${field}_invalid::${result.errors.join('|')}`);
  }
  for (const [field, validator] of LIST_NESTED_REFERENCE_VALIDATORS) {
    if (!Array.isArray(request[field]) || request[field].length > MAX_LIST_ITEMS) {
      errors.push(`${field}_invalid`);
    } else {
      request[field].forEach((reference, index) => {
        const result = validator(reference);
        if (!result.valid) errors.push(`${field}[${index}]_invalid::${result.errors.join('|')}`);
      });
    }
  }

  if (request.validator_version !== RUNTIME_QUEUE_MATERIALIZATION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueMaterializationRequest(input = {}) {
  const request = {
    runtime_queue_materialization_request_id: input.runtime_queue_materialization_request_id,
    runtime_queue_materialization_request_version: Number.isInteger(input.runtime_queue_materialization_request_version) ? input.runtime_queue_materialization_request_version : 1,
    runtime_queue_admission_package_reference: input.runtime_queue_admission_package_reference,
    runtime_queue_admission_entry_references: Array.isArray(input.runtime_queue_admission_entry_references) ? input.runtime_queue_admission_entry_references : [],
    runtime_queue_admission_order_reference: input.runtime_queue_admission_order_reference,
    runtime_queue_class_references: Array.isArray(input.runtime_queue_class_references) ? input.runtime_queue_class_references : [],
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_queue_materialization_registry_version: Number.isInteger(input.expected_queue_materialization_registry_version) ? input.expected_queue_materialization_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: RUNTIME_QUEUE_MATERIALIZATION_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateRuntimeQueueMaterializationRequest(request);
  if (!validation.valid) {
    throw new Error(`runtime_queue_materialization_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  LIST_NESTED_REFERENCE_VALIDATORS,
  MAX_LIST_ITEMS,
  RUNTIME_QUEUE_MATERIALIZATION_REQUEST_FIELDS,
  RUNTIME_QUEUE_MATERIALIZATION_REQUEST_VALIDATOR_VERSION,
  SINGLE_NESTED_REFERENCE_VALIDATORS,
  buildRuntimeQueueMaterializationRequest,
  validateRuntimeQueueMaterializationRequest
};
