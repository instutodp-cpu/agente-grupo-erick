'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { IDENTITY_SCOPE_FIELDS, validatePersistedClaimIdentity } = require('./runtime-execution-attempt-durable-claim-contract');
const { ELIGIBLE_STATUS } = require('./runtime-execution-attempt-claim-eligibility-decision-simulation');
const {
  CONTRACT_NAME: SELECTION_CONTRACT_NAME,
  CONTRACT_VERSION: SELECTION_CONTRACT_VERSION,
  validatePersistedSelection
} = require('./runtime-execution-attempt-claim-worker-selection');
const { validateWorkerRegistration } = require('./runtime-worker-registry-contract');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_BINDING_AUTHORITY';
const CONTRACT_VERSION = 'runtime_execution_attempt_claim_worker_binding_authority_contract_v1';
const VERSION = 1;
const BINDING_ORDINAL = 1;
const BINDING_ID_PREFIX = 'runtime-execution-attempt-claim-worker-binding-';
const BINDING_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'binding_id', 'claim_id', 'claim_digest',
  'attempt_durable_record_id', 'runtime_stage_reference_id', 'runtime_stage_reference_version',
  'selection_id', 'selection_digest', 'selected_worker_id', 'selected_worker_digest', 'binding_ordinal',
  ...IDENTITY_SCOPE_FIELDS, 'binding_fingerprint', 'binding_digest', 'binding_artifact', 'created_at'
]);
const IDENTITY_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'claim_id', 'claim_digest', 'attempt_durable_record_id',
  'runtime_stage_reference_id', 'runtime_stage_reference_version', 'selection_id', 'selection_digest',
  'selected_worker_id', 'selected_worker_digest', 'binding_ordinal', ...IDENTITY_SCOPE_FIELDS
]);
const SAFE_FLAGS = Object.freeze({
  worker_selected: true,
  worker_bound: true,
  worker_ownership_established: false,
  executor_bound: false,
  executor_ownership_established: false,
  capacity_reserved: false,
  lease_created: false,
  lease_granted: false,
  fencing_token_created: false,
  fencing_token_issued: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  binding_grants_ownership: false,
  binding_reserves_capacity: false,
  binding_creates_lease: false,
  binding_creates_fencing: false,
  binding_authorizes_execution: false,
  simulation: false,
  production_blocked: true
});

function sameScope(left, right) {
  return IDENTITY_SCOPE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function validateClaim(claim) {
  const errors = [];
  if (!isPlainObject(claim)) return { valid: false, stale: false, errors: ['claim_must_be_object'] };
  const identity = validatePersistedClaimIdentity(claim);
  if (!identity.valid) errors.push(...identity.errors.map((error) => `claim_${error}`));
  if (claim.claim_state !== 'ACTIVE') errors.push('claim_not_active');
  if (claim.claim_eligibility_decision_status !== ELIGIBLE_STATUS) errors.push('claim_not_eligible');
  if (claim.attempt_state !== 'ADMITTED' || Number(claim.attempt_revision) !== 2) errors.push('claim_attempt_lifecycle_invalid');
  if (!isPlainObject(claim.claim_artifact) || !isPlainObject(claim.claim_receipt)) errors.push('claim_artifact_invalid');
  return {
    valid: errors.length === 0,
    stale: claim.claim_state !== 'ACTIVE' || claim.attempt_state !== 'ADMITTED' || Number(claim.attempt_revision) !== 2,
    errors: uniqueSorted(errors),
    identity: identity.identity
  };
}

function validateSelection(selection, claim) {
  const errors = [];
  if (!isPlainObject(selection)) return { valid: false, errors: ['selection_must_be_object'] };
  const validation = validatePersistedSelection(selection);
  if (!validation.valid) errors.push(...validation.errors);
  if (selection.contract_name !== SELECTION_CONTRACT_NAME) errors.push('selection_contract_invalid');
  if (selection.contract_version !== SELECTION_CONTRACT_VERSION) errors.push('selection_contract_version_invalid');
  if (selection.claim_id !== claim.claim_id) errors.push('selection_claim_mismatch');
  if (selection.claim_digest !== claim.claim_digest) errors.push('selection_claim_digest_mismatch');
  if (selection.attempt_durable_record_id !== claim.attempt_durable_record_id) errors.push('selection_attempt_mismatch');
  if (selection.attempt_ordinal !== Number(claim.attempt_ordinal)) errors.push('selection_attempt_ordinal_mismatch');
  if (!sameScope(selection, claim)) errors.push('selection_scope_mismatch');
  if (!selection.stage_reference || selection.runtime_stage_reference_id !== selection.stage_reference.runtime_stage_reference_id
    || Number(selection.runtime_stage_reference_version) !== Number(selection.stage_reference.runtime_stage_reference_version)) {
    errors.push('selection_stage_reference_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorker(worker, selection, claim) {
  const errors = [];
  if (!isPlainObject(worker)) return { valid: false, errors: ['worker_must_be_object'] };
  const validation = validateWorkerRegistration(worker);
  if (!validation.valid) errors.push(...validation.errors);
  if (worker.worker_id !== selection.selected_worker_id) errors.push('worker_id_mismatch');
  if (worker.canonical_digest !== selection.selected_worker_digest) errors.push('worker_digest_mismatch');
  if (!['tenant_id', 'organization_id', 'project_id'].every((field) => worker[field] === claim[field])) {
    errors.push('worker_scope_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildIdentity({ claim, selection, worker, bindingOrdinal }) {
  return Object.freeze({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    claim_id: claim.claim_id,
    claim_digest: claim.claim_digest,
    attempt_durable_record_id: claim.attempt_durable_record_id,
    runtime_stage_reference_id: selection.runtime_stage_reference_id,
    runtime_stage_reference_version: Number(selection.runtime_stage_reference_version),
    selection_id: selection.selection_id,
    selection_digest: selection.selection_digest,
    selected_worker_id: worker.worker_id,
    selected_worker_digest: worker.canonical_digest,
    binding_ordinal: bindingOrdinal,
    ...Object.fromEntries(IDENTITY_SCOPE_FIELDS.map((field) => [field, claim[field]]))
  });
}

function buildBindingPlan({ claim, selection, worker, binding_ordinal: bindingOrdinal = BINDING_ORDINAL } = {}) {
  const claimValidation = validateClaim(claim);
  const selectionValidation = claimValidation.identity
    ? validateSelection(selection, claim)
    : { valid: false, errors: ['claim_invalid'] };
  const workerValidation = claimValidation.identity && selectionValidation.valid
    ? validateWorker(worker, selection, claim)
    : { valid: false, errors: ['selection_invalid'] };
  const ordinalValid = Number.isInteger(bindingOrdinal) && bindingOrdinal >= 1;
  const errors = uniqueSorted([
    ...claimValidation.errors,
    ...selectionValidation.errors,
    ...workerValidation.errors,
    ...(ordinalValid ? [] : ['binding_ordinal_invalid'])
  ]);
  if (errors.length > 0) {
    return Object.freeze({
      outcome: claimValidation.stale ? 'STALE' : 'INVALID',
      reason_code: claimValidation.stale ? 'claim_predecessor_stale' : 'invalid_binding_predecessor',
      errors
    });
  }

  const identity = buildIdentity({ claim, selection, worker, bindingOrdinal });
  const bindingFingerprint = stablePayload(identity);
  const bindingDigest = computeCanonicalContentDigest(identity);
  const bindingId = `${BINDING_ID_PREFIX}${bindingDigest.slice('sha256:'.length)}`;
  const artifact = {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    binding_id: bindingId,
    claim_id: claim.claim_id,
    selection_id: selection.selection_id,
    runtime_stage_reference_id: selection.runtime_stage_reference_id,
    selected_worker_id: worker.worker_id,
    binding_digest: bindingDigest,
    ...SAFE_FLAGS
  };
  return cloneFrozen({
    outcome: 'READY',
    binding_id: bindingId,
    binding_fingerprint: bindingFingerprint,
    binding_digest: bindingDigest,
    binding_ordinal: bindingOrdinal,
    identity,
    binding_artifact: artifact,
    ...SAFE_FLAGS
  });
}

function planToInsertRow(plan) {
  if (!plan || plan.outcome !== 'READY') throw new TypeError('binding_plan_not_ready');
  return {
    ...plan.identity,
    binding_id: plan.binding_id,
    binding_ordinal: plan.binding_ordinal,
    binding_fingerprint: plan.binding_fingerprint,
    binding_digest: plan.binding_digest,
    binding_artifact: plan.binding_artifact
  };
}

function identityFromPersistedRow(row) {
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map((field) => [
    field,
    ['runtime_stage_reference_version', 'binding_ordinal'].includes(field) ? Number(row[field]) : row[field]
  ])));
}

function validatePersistedBinding(row) {
  const errors = [];
  if (!isPlainObject(row)) return { valid: false, errors: ['persisted_binding_must_be_object'] };
  for (const field of BINDING_FIELDS.filter((field) => field !== 'created_at')) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) errors.push(`persisted_binding_missing_${field}`);
  }
  for (const field of ['contract_name', 'contract_version', 'binding_id', 'claim_id', 'claim_digest',
    'attempt_durable_record_id', 'runtime_stage_reference_id', 'selection_id', 'selection_digest',
    'selected_worker_id', 'selected_worker_digest', ...IDENTITY_SCOPE_FIELDS, 'binding_fingerprint', 'binding_digest']) {
    if (!isNonEmptyString(row[field])) errors.push(`persisted_binding_${field}_invalid`);
  }
  if (row.contract_name !== CONTRACT_NAME) errors.push('persisted_binding_contract_invalid');
  if (row.contract_version !== CONTRACT_VERSION) errors.push('persisted_binding_contract_version_invalid');
  if (!Number.isInteger(Number(row.runtime_stage_reference_version)) || Number(row.runtime_stage_reference_version) < 1) errors.push('persisted_binding_stage_version_invalid');
  if (!Number.isInteger(Number(row.binding_ordinal)) || Number(row.binding_ordinal) < 1) errors.push('persisted_binding_ordinal_invalid');
  if (!isCanonicalContentDigest(row.claim_digest) || !isCanonicalContentDigest(row.selection_digest)
    || !isCanonicalContentDigest(row.selected_worker_digest) || !isCanonicalContentDigest(row.binding_digest)) errors.push('persisted_binding_digest_invalid');
  if (!isPlainObject(row.binding_artifact)) errors.push('persisted_binding_artifact_invalid');
  try {
    const identity = identityFromPersistedRow(row);
    if (stablePayload(identity) !== row.binding_fingerprint) errors.push('persisted_binding_fingerprint_mismatch');
    if (computeCanonicalContentDigest(identity) !== row.binding_digest) errors.push('persisted_binding_digest_mismatch');
    if (row.binding_id !== `${BINDING_ID_PREFIX}${row.binding_digest.slice('sha256:'.length)}`) errors.push('persisted_binding_id_mismatch');
    if (row.binding_artifact.binding_id !== row.binding_id
      || row.binding_artifact.claim_id !== row.claim_id
      || row.binding_artifact.selection_id !== row.selection_id
      || row.binding_artifact.selected_worker_id !== row.selected_worker_id
      || row.binding_artifact.runtime_stage_reference_id !== row.runtime_stage_reference_id
      || row.binding_artifact.binding_digest !== row.binding_digest
      || row.binding_artifact.worker_bound !== true) errors.push('persisted_binding_artifact_binding_invalid');
  } catch (error) {
    errors.push(`persisted_binding_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function classifyPersistedBinding(row, plan) {
  if (!plan || plan.outcome !== 'READY') return { outcome: 'INVALID', reason_code: 'binding_plan_not_ready' };
  const persisted = validatePersistedBinding(row);
  if (!persisted.valid) return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_binding_invalid', validation_errors: persisted.errors };
  return stablePayload(identityFromPersistedRow(row)) === stablePayload(plan.identity)
    ? { outcome: 'EXISTING_IDENTICAL', reason_code: 'binding_replay' }
    : { outcome: 'CONFLICT', reason_code: 'binding_slot_conflict' };
}

module.exports = {
  BINDING_FIELDS,
  BINDING_ID_PREFIX,
  BINDING_ORDINAL,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  IDENTITY_FIELDS,
  SAFE_FLAGS,
  VERSION,
  buildBindingPlan,
  classifyPersistedBinding,
  planToInsertRow,
  validateClaim,
  validatePersistedBinding,
  validateSelection,
  validateWorker
};
