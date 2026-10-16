'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ELIGIBLE,
  evaluateA3ScopedExternalActionEligibility
} = require('./a3-scoped-external-action-eligibility');
const {
  CANARY_CONTRACT_VERSION,
  prepareHermesMaintainerGithubWriteCanary
} = require('./hermes-maintainer-github-write-canary-contract');

// This contract is the last pure boundary before any A3 side effect. It composes the
// official A3 eligibility chain with the bounded GitHub canary contract and proves that
// they describe exactly the same target. Admission is evidence only: it never grants
// execution authority, performs network I/O, writes a ref, consumes authorization, or
// promotes A3.
const CONTRACT_VERSION = 'hermes_a3_scoped_external_action_pre_execution_admission_v1';
const ADMITTED = 'A3_PRE_EXECUTION_ADMISSION_PREPARED';
const BLOCKED = 'A3_PRE_EXECUTION_ADMISSION_BLOCKED';
const INPUT_FIELDS = Object.freeze(['admission_id', 'eligibility_input', 'canary_request']);
const CANARY_REQUEST_FIELDS = Object.freeze(['operation', 'ref', 'repository', 'sha']);
const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function validateA3PreExecutionAdmissionInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return { valid: false, errors: ['admission_input_must_be_object'] };
  exactFields(input, INPUT_FIELDS, 'admission_input', errors);
  if (!isIdentifier(input.admission_id)) errors.push('admission_id_invalid');
  if (!isPlainObject(input.eligibility_input)) errors.push('eligibility_input_must_be_object');
  if (!isPlainObject(input.canary_request)) errors.push('canary_request_must_be_object');
  else exactFields(input.canary_request, CANARY_REQUEST_FIELDS, 'canary_request', errors);
  try { stablePayload(input); } catch (error) { errors.push(`admission_input_not_canonical::${error.message}`); }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateA3PreExecutionAdmission(input = {}) {
  const validation = validateA3PreExecutionAdmissionInput(input);
  const errors = [...validation.errors];
  const eligibility = evaluateA3ScopedExternalActionEligibility(
    isPlainObject(input.eligibility_input) ? input.eligibility_input : {}
  );
  const canary = prepareHermesMaintainerGithubWriteCanary(
    isPlainObject(input.canary_request) ? input.canary_request : {}
  );

  if (eligibility.status !== ELIGIBLE || eligibility.a3_eligible !== true) {
    errors.push(...(eligibility.blockers || ['a3_eligibility_not_satisfied']).map(error => `eligibility::${error}`));
  }
  if (canary.canary_valid !== true || canary.status !== 'CANARY_PREPARED') {
    errors.push(`canary::${canary.reason || 'not_prepared'}`);
  }

  const target = isPlainObject(input.eligibility_input?.target_reference)
    ? input.eligibility_input.target_reference
    : {};
  const expectedRef = isNonEmptyString(target.branch_name) ? `refs/heads/${target.branch_name}` : null;
  const request = isPlainObject(input.canary_request) ? input.canary_request : {};

  if (request.repository !== target.repository) errors.push('canary_repository_not_bound_to_eligibility_target');
  if (request.operation !== input.eligibility_input?.operation) errors.push('canary_operation_not_bound_to_eligibility_operation');
  if (request.ref !== expectedRef) errors.push('canary_ref_not_bound_to_eligibility_branch');
  if (request.sha !== target.base_sha) errors.push('canary_sha_not_bound_to_durable_base_sha');

  if (eligibility.execution_authorized !== false) errors.push('eligibility_execution_authority_forbidden');
  if (eligibility.execution_started !== false || eligibility.executed !== false) errors.push('eligibility_execution_state_forbidden');
  if (eligibility.provider_invoked !== false || eligibility.external_network_called !== false) errors.push('eligibility_external_side_effect_forbidden');
  if (eligibility.production_allowed !== false || eligibility.a4_authority_granted !== false) errors.push('eligibility_protected_authority_forbidden');
  if (canary.execution_authorized !== false || canary.network_call_performed !== false || canary.write_performed !== false || canary.production_used !== false) {
    errors.push('canary_side_effect_boundary_invalid');
  }

  const blockers = uniqueSorted(errors);
  const admitted = blockers.length === 0;
  const result = {
    contract_version: CONTRACT_VERSION,
    admission_id: isIdentifier(input.admission_id) ? input.admission_id : null,
    status: admitted ? ADMITTED : BLOCKED,
    admission_valid: admitted,
    eligibility_contract_version: eligibility.contract_version || null,
    eligibility_fingerprint: eligibility.eligibility_fingerprint || null,
    canary_contract_version: canary.contract_version === CANARY_CONTRACT_VERSION ? CANARY_CONTRACT_VERSION : null,
    environment: admitted ? 'staging' : null,
    provider: admitted ? 'GITHUB' : null,
    repository: admitted ? request.repository : null,
    operation: admitted ? request.operation : null,
    ref: admitted ? request.ref : null,
    sha: admitted ? request.sha : null,
    single_use_required: true,
    authorization_consumed: eligibility.authorization_consumed === true,
    authorization_revoked: eligibility.authorization_revoked === true,
    execution_authorized: false,
    execution_started: false,
    executed: false,
    provider_invoked: false,
    external_network_called: false,
    network_call_performed: false,
    write_performed: false,
    production_allowed: false,
    a3_promoted: false,
    a4_authority_granted: false,
    blockers
  };
  return cloneFrozen(result);
}

module.exports = {
  ADMITTED,
  BLOCKED,
  CONTRACT_VERSION,
  evaluateA3PreExecutionAdmission,
  validateA3PreExecutionAdmissionInput
};
