'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  validatePersistedBinding
} = require('./runtime-execution-attempt-claim-worker-binding');
const {
  validatePersistedOperationalOwnerIdentity
} = require('./runtime-operational-owner-identity');
const { validateWorkerRegistration } = require('./runtime-worker-registry-contract');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_WORKER_OWNERSHIP_AUTHORITY';
const CONTRACT_VERSION = 'runtime_execution_attempt_worker_ownership_authority_contract_v1';
const VERSION = 1;
const OWNERSHIP_ORDINAL = 1;
const OWNERSHIP_ID_PREFIX = 'runtime-execution-attempt-worker-ownership-';
const SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const IDENTITY_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'binding_id', 'binding_digest',
  'claim_id', 'selection_id', 'selected_worker_id', 'selected_worker_digest',
  'operational_owner_id', 'operational_owner_type', 'owner_identity_fingerprint',
  'owner_identity_digest', 'ownership_ordinal', ...SCOPE_FIELDS
]);
const FIELDS = Object.freeze([
  ...IDENTITY_FIELDS, 'ownership_id', 'ownership_fingerprint', 'ownership_digest',
  'ownership_artifact', 'created_at'
]);
const SAFE_FLAGS = Object.freeze({
  worker_selected: true,
  worker_bound: true,
  operational_owner_identity_registered: true,
  worker_ownership_established: true,
  executor_ownership_established: false,
  capacity_reserved: false,
  lease_created: false,
  lease_granted: false,
  liveness_established: false,
  fencing_token_created: false,
  fencing_token_issued: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  ownership_creates_lease: false,
  ownership_establishes_liveness: false,
  ownership_creates_fencing: false,
  ownership_reserves_capacity: false,
  ownership_authorizes_execution: false,
  simulation: false,
  production_blocked: true
});

function sameScope(left, right) {
  return ['tenant_id', 'organization_id', 'project_id'].every((field) => left?.[field] === right?.[field]);
}

function validateBinding(binding) {
  const errors = [];
  const validation = validatePersistedBinding(binding);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `binding_${error}`));
  if (binding?.worker_bound !== true && binding?.binding_artifact?.worker_bound !== true) errors.push('binding_not_worker_bound');
  if (binding?.production_blocked !== true && binding?.binding_artifact?.production_blocked !== true) errors.push('binding_not_production_blocked');
  if (binding?.binding_artifact?.binding_grants_ownership !== false) errors.push('binding_ownership_boundary_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateOwner(owner) {
  const errors = [];
  const validation = validatePersistedOperationalOwnerIdentity(owner);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `owner_${error}`));
  const artifact = owner?.owner_identity_artifact;
  if (artifact?.operational_owner_identity_registered !== true) errors.push('owner_identity_not_registered');
  if (artifact?.production_blocked !== true) errors.push('owner_not_production_blocked');
  if (artifact?.identity_establishes_ownership !== false) errors.push('owner_ownership_boundary_invalid');
  if (artifact?.identity_creates_lease !== false || artifact?.identity_creates_fencing !== false
    || artifact?.identity_reserves_capacity !== false || artifact?.identity_authorizes_execution !== false) {
    errors.push('owner_later_layer_boundary_invalid');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorker(worker, binding) {
  const errors = [];
  const validation = validateWorkerRegistration(worker);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `worker_${error}`));
  if (worker?.worker_id !== binding?.selected_worker_id) errors.push('worker_id_mismatch');
  if (worker?.canonical_digest !== binding?.selected_worker_digest) errors.push('worker_digest_mismatch');
  if (!sameScope(worker, binding)) errors.push('worker_scope_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildIdentity({ binding, owner, worker, ownershipOrdinal }) {
  return Object.freeze({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    binding_id: binding.binding_id,
    binding_digest: binding.binding_digest,
    claim_id: binding.claim_id,
    selection_id: binding.selection_id,
    selected_worker_id: worker.worker_id,
    selected_worker_digest: worker.canonical_digest,
    operational_owner_id: owner.operational_owner_id,
    operational_owner_type: owner.operational_owner_type,
    owner_identity_fingerprint: owner.owner_identity_fingerprint,
    owner_identity_digest: owner.owner_identity_digest,
    ownership_ordinal: ownershipOrdinal,
    ...Object.fromEntries(SCOPE_FIELDS.map((field) => [field, binding[field]]))
  });
}

function buildOwnershipPlan({ binding, owner, worker, ownership_ordinal: ownershipOrdinal = OWNERSHIP_ORDINAL } = {}) {
  const bindingValidation = validateBinding(binding);
  const ownerValidation = validateOwner(owner);
  const workerValidation = bindingValidation.valid ? validateWorker(worker, binding) : { valid: false, errors: ['binding_invalid'] };
  const ordinalValid = Number.isInteger(ownershipOrdinal) && ownershipOrdinal >= 1;
  const scopeValid = bindingValidation.valid && ownerValidation.valid
    && sameScope(owner, binding) && sameScope(worker, binding);
  const errors = uniqueSorted([
    ...bindingValidation.errors,
    ...ownerValidation.errors,
    ...workerValidation.errors,
    ...(scopeValid ? [] : ['predecessor_scope_mismatch']),
    ...(ordinalValid ? [] : ['ownership_ordinal_invalid'])
  ]);
  if (errors.length > 0) return Object.freeze({ outcome: 'INVALID', reason_code: 'invalid_ownership_predecessor', errors });

  const identity = buildIdentity({ binding, owner, worker, ownershipOrdinal });
  const ownershipFingerprint = stablePayload(identity);
  const ownershipDigest = computeCanonicalContentDigest(identity);
  const ownershipId = `${OWNERSHIP_ID_PREFIX}${ownershipDigest.slice('sha256:'.length)}`;
  const artifact = {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    ownership_id: ownershipId,
    binding_id: binding.binding_id,
    operational_owner_id: owner.operational_owner_id,
    selected_worker_id: worker.worker_id,
    ownership_ordinal: ownershipOrdinal,
    ownership_digest: ownershipDigest,
    ...SAFE_FLAGS
  };
  return cloneFrozen({
    outcome: 'READY',
    ownership_id: ownershipId,
    ownership_fingerprint: ownershipFingerprint,
    ownership_digest: ownershipDigest,
    ownership_ordinal: ownershipOrdinal,
    identity,
    ownership_artifact: artifact,
    ...SAFE_FLAGS
  });
}

function planToInsertRow(plan) {
  if (!plan || plan.outcome !== 'READY') throw new TypeError('ownership_plan_not_ready');
  return {
    ...plan.identity,
    ownership_id: plan.ownership_id,
    ownership_fingerprint: plan.ownership_fingerprint,
    ownership_digest: plan.ownership_digest,
    ownership_artifact: plan.ownership_artifact
  };
}

function identityFromPersistedRow(row) {
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map((field) => [
    field, field === 'ownership_ordinal' ? Number(row[field]) : row[field]
  ])));
}

function validatePersistedOwnership(row) {
  const errors = [];
  if (!isPlainObject(row)) return { valid: false, errors: ['persisted_ownership_must_be_object'] };
  for (const field of FIELDS.filter((field) => field !== 'created_at')) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) errors.push(`persisted_ownership_missing_${field}`);
  }
  for (const field of IDENTITY_FIELDS.filter((field) => field !== 'ownership_ordinal')) {
    if (!isNonEmptyString(row[field])) errors.push(`persisted_ownership_${field}_invalid`);
  }
  if (row.contract_name !== CONTRACT_NAME) errors.push('persisted_ownership_contract_invalid');
  if (row.contract_version !== CONTRACT_VERSION) errors.push('persisted_ownership_contract_version_invalid');
  if (!Number.isInteger(Number(row.ownership_ordinal)) || Number(row.ownership_ordinal) < 1) errors.push('persisted_ownership_ordinal_invalid');
  for (const field of ['binding_digest', 'selected_worker_digest', 'owner_identity_digest', 'ownership_digest']) {
    if (!isCanonicalContentDigest(row[field])) errors.push(`persisted_ownership_${field}_invalid`);
  }
  if (!isNonEmptyString(row.ownership_id) || !row.ownership_id.startsWith(OWNERSHIP_ID_PREFIX)) errors.push('persisted_ownership_id_invalid');
  if (!isNonEmptyString(row.ownership_fingerprint)) errors.push('persisted_ownership_fingerprint_invalid');
  if (!isPlainObject(row.ownership_artifact)) errors.push('persisted_ownership_artifact_invalid');
  try {
    const identity = identityFromPersistedRow(row);
    const fingerprint = stablePayload(identity);
    const digest = computeCanonicalContentDigest(identity);
    if (row.ownership_fingerprint !== fingerprint) errors.push('persisted_ownership_fingerprint_mismatch');
    if (row.ownership_digest !== digest) errors.push('persisted_ownership_digest_mismatch');
    if (row.ownership_id !== `${OWNERSHIP_ID_PREFIX}${digest.slice('sha256:'.length)}`) errors.push('persisted_ownership_id_mismatch');
    const artifact = row.ownership_artifact;
    if (artifact.ownership_id !== row.ownership_id || artifact.binding_id !== row.binding_id
      || artifact.operational_owner_id !== row.operational_owner_id || artifact.selected_worker_id !== row.selected_worker_id
      || Number(artifact.ownership_ordinal) !== Number(row.ownership_ordinal) || artifact.ownership_digest !== row.ownership_digest
      || artifact.worker_ownership_established !== true || artifact.executor_ownership_established !== false
      || artifact.lease_created !== false || artifact.liveness_established !== false
      || artifact.fencing_token_created !== false || artifact.capacity_reserved !== false
      || artifact.execution_authorized !== false || artifact.production_blocked !== true) {
      errors.push('persisted_ownership_artifact_invalid');
    }
  } catch (error) {
    errors.push(`persisted_ownership_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function classifyPersistedOwnership(row, plan) {
  if (!plan || plan.outcome !== 'READY') return { outcome: 'INVALID', reason_code: 'ownership_plan_not_ready' };
  const persisted = validatePersistedOwnership(row);
  if (!persisted.valid) return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_ownership_invalid', validation_errors: persisted.errors };
  return stablePayload(identityFromPersistedRow(row)) === stablePayload(plan.identity)
    ? { outcome: 'EXISTING_IDENTICAL', reason_code: 'ownership_replay' }
    : { outcome: 'CONFLICT', reason_code: 'ownership_slot_conflict' };
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  IDENTITY_FIELDS,
  OWNERSHIP_ID_PREFIX,
  OWNERSHIP_ORDINAL,
  SAFE_FLAGS,
  SCOPE_FIELDS,
  VERSION,
  buildOwnershipPlan,
  classifyPersistedOwnership,
  identityFromPersistedRow,
  planToInsertRow,
  validateBinding,
  validateOwner,
  validatePersistedOwnership,
  validateWorker
};
