'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateBindingRecord } = require('./execution-reference-binding-record');

const BINDING_LEDGER_VALIDATOR_VERSION = 'execution_reference_binding_ledger_validator_v1';

const BINDING_LEDGER_FIELDS = Object.freeze([
  'binding_ledger_id', 'binding_ledger_version', 'execution_plan_request_id', 'execution_plan_id',
  'authorization_decision_id', 'authorization_scope_reference_id', 'authorization_provenance_reference_id',
  'registry_snapshot_reference_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'agent_id', 'actor_id', 'binding_record_ids', 'binding_records', 'binding_count', 'required_binding_count',
  'validated_binding_count', 'blocked_binding_count', 'all_required_bindings_present', 'all_bindings_validated',
  'bindings_applied', 'ledger_status', 'ledger_fingerprint', 'logical_sequence',
  'references_bound_in_simulation', 'execution_authorized', 'execution_started', 'simulation',
  'production_blocked', 'validator_version'
]);

const LEDGER_STATUSES = Object.freeze([
  'REFERENCES_BOUND_SIMULATION', 'MISSING_BINDING_BLOCKED', 'BINDING_BLOCKED', 'FINGERPRINT_BLOCKED',
  'VERSION_BLOCKED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'SCOPE_BLOCKED', 'CONFLICT_BLOCKED', 'VALIDATION_FAILED'
]);

const BINDING_LEDGER_SAFE_FLAGS = Object.freeze({
  bindings_applied: false,
  execution_authorized: false,
  execution_started: false,
  simulation: true,
  production_blocked: true
});

const MAX_BINDING_RECORDS = 200;

function computeLedgerFingerprint(ledger) {
  const { ledger_fingerprint, ...rest } = ledger;
  return stablePayload(rest);
}

// all_required_bindings_present cannot be derived from binding_records alone: it depends on
// knowing which binding types the request *should* have produced a record for, information only
// execution-reference-binding-validator.js has. Everything else on this contract that CAN be
// derived from the embedded binding_records array is derived and cross-checked below, never
// caller-asserted independently -- same principle as snapshot_consistent on
// ExecutionRegistrySnapshotReference.
function validateExecutionReferenceBindingLedger(ledger) {
  const errors = [];
  if (!isPlainObject(ledger)) return { valid: false, errors: ['binding_ledger_must_be_object'] };
  exactFields(ledger, BINDING_LEDGER_FIELDS, 'binding_ledger', errors);
  for (const field of [
    'binding_ledger_id', 'execution_plan_request_id', 'execution_plan_id', 'authorization_decision_id',
    'authorization_scope_reference_id', 'authorization_provenance_reference_id', 'registry_snapshot_reference_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
    'ledger_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(ledger[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(ledger.binding_ledger_version) || ledger.binding_ledger_version < 1) errors.push('binding_ledger_version_invalid');
  if (!Number.isInteger(ledger.logical_sequence) || ledger.logical_sequence < 0) errors.push('logical_sequence_invalid');

  const recordsValid = Array.isArray(ledger.binding_records) && ledger.binding_records.length <= MAX_BINDING_RECORDS;
  if (!recordsValid) {
    errors.push('binding_records_invalid');
  } else {
    ledger.binding_records.forEach((record, index) => {
      const result = validateBindingRecord(record);
      if (!result.valid) errors.push(`binding_records[${index}]_invalid::${result.errors.join('|')}`);
    });
  }

  if (recordsValid && Array.isArray(ledger.binding_record_ids)) {
    const idsMatch = ledger.binding_record_ids.length === ledger.binding_records.length
      && ledger.binding_record_ids.every((id, index) => id === ledger.binding_records[index]?.binding_record_id);
    if (!idsMatch) errors.push('binding_record_ids_does_not_match_binding_records');
    if (new Set(ledger.binding_record_ids).size !== ledger.binding_record_ids.length) errors.push('binding_record_ids_not_unique');
  } else {
    errors.push('binding_record_ids_invalid');
  }

  if (recordsValid) {
    const expectedBindingCount = ledger.binding_records.length;
    const expectedRequiredCount = ledger.binding_records.filter((r) => r && r.binding_required === true).length;
    const expectedValidatedCount = ledger.binding_records.filter((r) => r && r.binding_validated === true).length;
    const expectedBlockedCount = expectedBindingCount - expectedValidatedCount;
    const expectedAllValidated = expectedBindingCount > 0 && expectedValidatedCount === expectedBindingCount;

    if (ledger.binding_count !== expectedBindingCount) errors.push('binding_count_does_not_match_binding_records');
    if (ledger.required_binding_count !== expectedRequiredCount) errors.push('required_binding_count_does_not_match_binding_records');
    if (ledger.validated_binding_count !== expectedValidatedCount) errors.push('validated_binding_count_does_not_match_binding_records');
    if (ledger.blocked_binding_count !== expectedBlockedCount) errors.push('blocked_binding_count_does_not_match_binding_records');
    if (ledger.all_bindings_validated !== expectedAllValidated) errors.push('all_bindings_validated_does_not_match_binding_records');
  }

  if (typeof ledger.all_required_bindings_present !== 'boolean') errors.push('all_required_bindings_present_must_be_boolean');
  if (!LEDGER_STATUSES.includes(ledger.ledger_status)) errors.push(`ledger_status_not_allowed::${ledger.ledger_status}`);

  // references_bound_in_simulation, and the REFERENCES_BOUND_SIMULATION status it mirrors, can
  // only ever be true when every required binding is both present and validated -- the two fields
  // can never disagree, and neither can disagree with the underlying binding_records evidence.
  const expectedBound = ledger.all_required_bindings_present === true && ledger.all_bindings_validated === true;
  if (ledger.references_bound_in_simulation !== expectedBound) errors.push('references_bound_in_simulation_does_not_match_binding_evidence');
  if (expectedBound && ledger.ledger_status !== 'REFERENCES_BOUND_SIMULATION') errors.push('ledger_status_must_be_references_bound_simulation_when_bound');
  if (!expectedBound && ledger.ledger_status === 'REFERENCES_BOUND_SIMULATION') errors.push('ledger_status_must_not_be_references_bound_simulation_when_not_bound');

  for (const [field, expected] of Object.entries(BINDING_LEDGER_SAFE_FLAGS)) {
    if (ledger[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (ledger.validator_version !== BINDING_LEDGER_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(ledger);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeLedgerFingerprint(ledger) !== ledger.ledger_fingerprint) errors.push('ledger_fingerprint_mismatch');
  } catch (error) {
    errors.push('ledger_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(ledger));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionReferenceBindingLedger(input = {}) {
  const bindingRecords = Array.isArray(input.binding_records) ? input.binding_records : [];
  const requiredCount = bindingRecords.filter((r) => r && r.binding_required === true).length;
  const validatedCount = bindingRecords.filter((r) => r && r.binding_validated === true).length;
  const blockedCount = bindingRecords.length - validatedCount;
  const allBindingsValidated = bindingRecords.length > 0 && validatedCount === bindingRecords.length;
  const allRequiredPresent = input.all_required_bindings_present === true;
  const bound = allRequiredPresent && allBindingsValidated;

  const ledger = {
    binding_ledger_id: input.binding_ledger_id,
    binding_ledger_version: Number.isInteger(input.binding_ledger_version) ? input.binding_ledger_version : 1,
    execution_plan_request_id: input.execution_plan_request_id,
    execution_plan_id: input.execution_plan_id,
    authorization_decision_id: input.authorization_decision_id,
    authorization_scope_reference_id: input.authorization_scope_reference_id,
    authorization_provenance_reference_id: input.authorization_provenance_reference_id,
    registry_snapshot_reference_id: input.registry_snapshot_reference_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    binding_record_ids: bindingRecords.map((r) => r && r.binding_record_id),
    binding_records: bindingRecords,
    binding_count: bindingRecords.length,
    required_binding_count: requiredCount,
    validated_binding_count: validatedCount,
    blocked_binding_count: blockedCount,
    all_required_bindings_present: allRequiredPresent,
    all_bindings_validated: allBindingsValidated,
    bindings_applied: false,
    ledger_status: bound ? 'REFERENCES_BOUND_SIMULATION' : (LEDGER_STATUSES.includes(input.ledger_status) ? input.ledger_status : 'VALIDATION_FAILED'),
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    references_bound_in_simulation: bound,
    execution_authorized: false,
    execution_started: false,
    simulation: true,
    production_blocked: true,
    validator_version: BINDING_LEDGER_VALIDATOR_VERSION
  };
  ledger.ledger_fingerprint = computeLedgerFingerprint({ ...ledger, ledger_fingerprint: undefined });

  const validation = validateExecutionReferenceBindingLedger(ledger);
  if (!validation.valid) {
    throw new Error(`execution_reference_binding_ledger_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(ledger);
}

module.exports = {
  BINDING_LEDGER_FIELDS,
  BINDING_LEDGER_SAFE_FLAGS,
  BINDING_LEDGER_VALIDATOR_VERSION,
  LEDGER_STATUSES,
  MAX_BINDING_RECORDS,
  buildExecutionReferenceBindingLedger,
  computeLedgerFingerprint,
  validateExecutionReferenceBindingLedger
};
