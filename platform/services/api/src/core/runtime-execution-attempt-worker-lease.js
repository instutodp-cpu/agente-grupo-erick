'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { validatePersistedOwnership } = require('./runtime-execution-attempt-worker-ownership');
const { validatePersistedOperationalOwnerIdentity } = require('./runtime-operational-owner-identity');
const { validateWorkerRegistration } = require('./runtime-worker-registry-contract');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_WORKER_LEASE_FENCING_AUTHORITY';
const CONTRACT_VERSION = 'runtime_execution_attempt_worker_lease_fencing_authority_contract_v1';
const LEASE_ID_PREFIX = 'runtime-execution-attempt-worker-lease-';
const LEASE_ORDINAL = 1;
const INITIAL_FENCING_TOKEN = 1;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const MAX_LEASE_DURATION_MS = 86_400_000;
const LEASE_STATES = Object.freeze(['ACTIVE', 'EXPIRED', 'RELEASED']);
const SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const IDENTITY_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'ownership_id', 'ownership_digest',
  'binding_id', 'operational_owner_id', 'selected_worker_id', 'selected_worker_digest',
  'owner_identity_digest', 'lease_ordinal', ...SCOPE_FIELDS
]);
const FIELDS = Object.freeze([
  ...IDENTITY_FIELDS, 'lease_id', 'fencing_token', 'lease_state', 'lease_fingerprint',
  'lease_digest', 'lease_artifact', 'lease_expires_at', 'last_renewed_at', 'released_at',
  'created_at', 'updated_at'
]);
const SAFE_FLAGS = Object.freeze({
  worker_selected: true,
  worker_bound: true,
  operational_owner_identity_registered: true,
  worker_ownership_established: true,
  lease_created: true,
  lease_granted: true,
  liveness_established: true,
  fencing_token_created: true,
  fencing_token_issued: true,
  executor_ownership_established: false,
  capacity_reserved: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  ownership_creates_lease: false,
  ownership_establishes_liveness: false,
  ownership_creates_fencing: false,
  ownership_reserves_capacity: false,
  ownership_authorizes_execution: false,
  lease_creates_fencing: true,
  lease_authorizes_execution: false,
  simulation: false,
  production_blocked: true
});

function sameScope(left, right) {
  return ['tenant_id', 'organization_id', 'project_id'].every((field) => left?.[field] === right?.[field]);
}

function validDuration(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_LEASE_DURATION_MS;
}

function validateOwnership(ownership) {
  const errors = [];
  const validation = validatePersistedOwnership(ownership);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `ownership_${error}`));
  if (ownership?.worker_ownership_established !== true
    && ownership?.ownership_artifact?.worker_ownership_established !== true) errors.push('ownership_not_established');
  if (ownership?.production_blocked !== true
    && ownership?.ownership_artifact?.production_blocked !== true) errors.push('ownership_not_production_blocked');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateOwner(owner) {
  const errors = [];
  const validation = validatePersistedOperationalOwnerIdentity(owner);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `owner_${error}`));
  if (owner?.operational_owner_type !== 'operational_owner') errors.push('owner_type_invalid');
  if (owner?.operational_owner_identity_registered !== true
    && owner?.owner_identity_artifact?.operational_owner_identity_registered !== true) errors.push('owner_identity_not_registered');
  if (owner?.production_blocked !== true && owner?.owner_identity_artifact?.production_blocked !== true) {
    errors.push('owner_not_production_blocked');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorker(worker, ownership) {
  const errors = [];
  const validation = validateWorkerRegistration(worker);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `worker_${error}`));
  if (worker?.worker_id !== ownership?.selected_worker_id) errors.push('worker_id_mismatch');
  if (worker?.canonical_digest !== ownership?.selected_worker_digest) errors.push('worker_digest_mismatch');
  if (!sameScope(worker, ownership)) errors.push('worker_scope_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildIdentity({ ownership, owner, worker, leaseOrdinal }) {
  return Object.freeze({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    ownership_id: ownership.ownership_id,
    ownership_digest: ownership.ownership_digest,
    binding_id: ownership.binding_id,
    operational_owner_id: owner.operational_owner_id,
    selected_worker_id: worker.worker_id,
    selected_worker_digest: worker.canonical_digest,
    owner_identity_digest: owner.owner_identity_digest,
    lease_ordinal: leaseOrdinal,
    ...Object.fromEntries(SCOPE_FIELDS.map((field) => [field, ownership[field]]))
  });
}

function buildLeasePlan({ ownership, owner, worker, lease_ordinal: leaseOrdinal = LEASE_ORDINAL } = {}) {
  const ownershipValidation = validateOwnership(ownership);
  const ownerValidation = validateOwner(owner);
  const workerValidation = ownershipValidation.valid ? validateWorker(worker, ownership) : { valid: false, errors: ['ownership_invalid'] };
  const ordinalValid = Number.isInteger(leaseOrdinal) && leaseOrdinal >= 1;
  const scopeValid = ownershipValidation.valid && ownerValidation.valid
    && sameScope(owner, ownership) && sameScope(worker, ownership);
  const errors = uniqueSorted([
    ...ownershipValidation.errors,
    ...ownerValidation.errors,
    ...workerValidation.errors,
    ...(scopeValid ? [] : ['predecessor_scope_mismatch']),
    ...(ordinalValid ? [] : ['lease_ordinal_invalid'])
  ]);
  if (errors.length > 0) return Object.freeze({ outcome: 'INVALID', reason_code: 'invalid_lease_predecessor', errors });

  const identity = buildIdentity({ ownership, owner, worker, leaseOrdinal });
  const leaseFingerprint = stablePayload(identity);
  const leaseDigest = computeCanonicalContentDigest(identity);
  const leaseId = `${LEASE_ID_PREFIX}${leaseDigest.slice('sha256:'.length)}`;
  const artifact = {
    ...identity,
    lease_id: leaseId,
    fencing_token: INITIAL_FENCING_TOKEN,
    ...SAFE_FLAGS
  };
  return cloneFrozen({
    outcome: 'READY',
    lease_id: leaseId,
    lease_fingerprint: leaseFingerprint,
    lease_digest: leaseDigest,
    lease_ordinal: leaseOrdinal,
    fencing_token: INITIAL_FENCING_TOKEN,
    lease_artifact: artifact,
    identity,
    ...SAFE_FLAGS
  });
}

function planToInsertRow(plan) {
  if (!plan || plan.outcome !== 'READY') throw new TypeError('lease_plan_not_ready');
  return {
    ...plan.identity,
    lease_id: plan.lease_id,
    fencing_token: plan.fencing_token,
    lease_state: 'ACTIVE',
    lease_fingerprint: plan.lease_fingerprint,
    lease_digest: plan.lease_digest,
    lease_artifact: plan.lease_artifact
  };
}

function identityFromPersistedRow(row) {
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map((field) => [
    field, field === 'lease_ordinal' ? Number(row[field]) : row[field]
  ])));
}

function validatePersistedLease(row) {
  const errors = [];
  if (!isPlainObject(row)) return { valid: false, errors: ['persisted_lease_must_be_object'] };
  for (const field of FIELDS.filter((field) => !['lease_expires_at', 'last_renewed_at', 'released_at', 'created_at', 'updated_at'].includes(field))) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) errors.push(`persisted_lease_missing_${field}`);
  }
  for (const field of IDENTITY_FIELDS.filter((field) => field !== 'lease_ordinal')) {
    if (!isNonEmptyString(row[field])) errors.push(`persisted_lease_${field}_invalid`);
  }
  if (row.contract_name !== CONTRACT_NAME) errors.push('persisted_lease_contract_invalid');
  if (row.contract_version !== CONTRACT_VERSION) errors.push('persisted_lease_contract_version_invalid');
  if (!Number.isInteger(Number(row.lease_ordinal)) || Number(row.lease_ordinal) < 1) errors.push('persisted_lease_ordinal_invalid');
  if (!isCanonicalContentDigest(row.ownership_digest) || !isCanonicalContentDigest(row.selected_worker_digest)
    || !isCanonicalContentDigest(row.owner_identity_digest) || !isCanonicalContentDigest(row.lease_digest)) {
    errors.push('persisted_lease_digest_invalid');
  }
  if (!isNonEmptyString(row.lease_id) || !row.lease_id.startsWith(LEASE_ID_PREFIX)) errors.push('persisted_lease_id_invalid');
  if (!isNonEmptyString(row.lease_fingerprint)) errors.push('persisted_lease_fingerprint_invalid');
  if (!Number.isInteger(Number(row.fencing_token)) || Number(row.fencing_token) < 1) errors.push('persisted_lease_fencing_token_invalid');
  if (!LEASE_STATES.includes(row.lease_state)) errors.push('persisted_lease_state_invalid');
  if (!isPlainObject(row.lease_artifact)) errors.push('persisted_lease_artifact_invalid');
  try {
    const identity = identityFromPersistedRow(row);
    const fingerprint = stablePayload(identity);
    const digest = computeCanonicalContentDigest(identity);
    if (row.lease_fingerprint !== fingerprint) errors.push('persisted_lease_fingerprint_mismatch');
    if (row.lease_digest !== digest) errors.push('persisted_lease_digest_mismatch');
    if (row.lease_id !== `${LEASE_ID_PREFIX}${digest.slice('sha256:'.length)}`) errors.push('persisted_lease_id_mismatch');
    const artifact = row.lease_artifact;
    if (artifact.lease_id !== row.lease_id || artifact.ownership_id !== row.ownership_id
      || artifact.operational_owner_id !== row.operational_owner_id || artifact.selected_worker_id !== row.selected_worker_id
      || Number(artifact.lease_ordinal) !== Number(row.lease_ordinal)
      || artifact.fencing_token !== Number(row.fencing_token)
      || artifact.lease_created !== true || artifact.lease_granted !== true
      || artifact.liveness_established !== true || artifact.fencing_token_created !== true
      || artifact.fencing_token_issued !== true || artifact.execution_authorized !== false
      || artifact.production_blocked !== true) {
      errors.push('persisted_lease_artifact_invalid');
    }
  } catch (error) {
    errors.push(`persisted_lease_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function classifyPersistedLease(row, plan) {
  if (!plan || plan.outcome !== 'READY') return { outcome: 'INVALID', reason_code: 'lease_plan_not_ready' };
  const persisted = validatePersistedLease(row);
  if (!persisted.valid) return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_lease_invalid', validation_errors: persisted.errors };
  return stablePayload(identityFromPersistedRow(row)) === stablePayload(plan.identity)
    ? { outcome: 'EXISTING_IDENTICAL', reason_code: 'lease_replay' }
    : { outcome: 'CONFLICT', reason_code: 'lease_slot_conflict' };
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  DEFAULT_LEASE_DURATION_MS,
  FIELDS,
  IDENTITY_FIELDS,
  INITIAL_FENCING_TOKEN,
  LEASE_ID_PREFIX,
  LEASE_ORDINAL,
  LEASE_STATES,
  MAX_LEASE_DURATION_MS,
  SAFE_FLAGS,
  SCOPE_FIELDS,
  buildLeasePlan,
  classifyPersistedLease,
  identityFromPersistedRow,
  planToInsertRow,
  validateOwner,
  validatePersistedLease,
  validateWorker,
  validateOwnership,
  validDuration
};
