'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { LEDGER_STATUSES } = require('./execution-reference-binding-ledger');

const BINDING_RESULT_VALIDATOR_VERSION = 'execution_reference_binding_result_validator_v1';

// A thin envelope around the ledger this evaluation already produced -- mirrors the shape of
// every other *Result contract in this PR series (status/reason_codes/validated-flags envelope
// over a richer underlying record), but carries no data the ledger does not already carry, so
// there is nothing here for a caller to disagree with the ledger about except by tampering with
// the envelope's own fingerprint.
const BINDING_RESULT_FIELDS = Object.freeze([
  'binding_result_id', 'binding_result_version', 'execution_plan_request_id', 'execution_plan_id',
  'binding_ledger_id', 'binding_ledger_fingerprint', 'tenant_id', 'organization_id', 'project_id',
  'session_reference_id', 'agent_id', 'actor_id', 'status', 'reason_codes', 'logical_sequence',
  'references_bound_in_simulation', 'execution_authorized', 'execution_started', 'result_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const BINDING_RESULT_SAFE_FLAGS = Object.freeze({
  execution_authorized: false,
  execution_started: false,
  simulation: true,
  production_blocked: true
});

const MAX_REASON_CODES = 50;

function computeBindingResultFingerprint(result) {
  const { result_fingerprint, ...rest } = result;
  return stablePayload(rest);
}

function validateExecutionReferenceBindingResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['binding_result_must_be_object'] };
  exactFields(result, BINDING_RESULT_FIELDS, 'binding_result', errors);
  for (const field of [
    'binding_result_id', 'execution_plan_request_id', 'execution_plan_id', 'binding_ledger_id',
    'binding_ledger_fingerprint', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'agent_id', 'actor_id', 'result_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(result.binding_result_version) || result.binding_result_version < 1) errors.push('binding_result_version_invalid');
  if (!Number.isInteger(result.logical_sequence) || result.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!LEDGER_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (!Array.isArray(result.reason_codes) || result.reason_codes.length > MAX_REASON_CODES || !result.reason_codes.every(isNonEmptyString)) {
    errors.push('reason_codes_invalid');
  }
  const expectedBound = result.status === 'REFERENCES_BOUND_SIMULATION';
  if (result.references_bound_in_simulation !== expectedBound) errors.push('references_bound_in_simulation_does_not_match_status');
  for (const [field, expected] of Object.entries(BINDING_RESULT_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.validator_version !== BINDING_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeBindingResultFingerprint(result) !== result.result_fingerprint) errors.push('result_fingerprint_mismatch');
  } catch (error) {
    errors.push('result_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionReferenceBindingResult(input = {}) {
  const status = LEDGER_STATUSES.includes(input.status) ? input.status : 'VALIDATION_FAILED';
  const result = {
    binding_result_id: input.binding_result_id,
    binding_result_version: Number.isInteger(input.binding_result_version) ? input.binding_result_version : 1,
    execution_plan_request_id: input.execution_plan_request_id,
    execution_plan_id: input.execution_plan_id,
    binding_ledger_id: input.binding_ledger_id,
    binding_ledger_fingerprint: input.binding_ledger_fingerprint,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    status,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    references_bound_in_simulation: status === 'REFERENCES_BOUND_SIMULATION',
    execution_authorized: false,
    execution_started: false,
    simulation: true,
    production_blocked: true,
    validator_version: BINDING_RESULT_VALIDATOR_VERSION
  };
  result.result_fingerprint = computeBindingResultFingerprint({ ...result, result_fingerprint: undefined });

  const validation = validateExecutionReferenceBindingResult(result);
  if (!validation.valid) {
    throw new Error(`execution_reference_binding_result_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(result);
}

module.exports = {
  BINDING_RESULT_FIELDS,
  BINDING_RESULT_SAFE_FLAGS,
  BINDING_RESULT_VALIDATOR_VERSION,
  MAX_REASON_CODES,
  buildExecutionReferenceBindingResult,
  computeBindingResultFingerprint,
  validateExecutionReferenceBindingResult
};
