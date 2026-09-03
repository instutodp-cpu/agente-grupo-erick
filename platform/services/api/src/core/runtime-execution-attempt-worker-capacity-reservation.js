'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { validatePersistedLease } = require('./runtime-execution-attempt-worker-lease');

const CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_WORKER_CAPACITY_RESERVATION_AUTHORITY';
const CONTRACT_VERSION = 'runtime_execution_attempt_worker_capacity_reservation_authority_contract_v1';
const RESERVATION_ID_PREFIX = 'runtime-execution-attempt-worker-capacity-reservation-';
const RESERVATION_ORDINAL = 1;
const CAPACITY_DIMENSIONS = Object.freeze([
  'worker_stage_assignments',
  'worker_parallel_assignments',
  'worker_model_assignments',
  'worker_tool_assignments',
  'worker_workflow_assignments',
  'worker_token_capacity',
  'worker_cost_capacity_minor_units'
]);
const SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const RESOURCE_IDENTITY_FIELDS = Object.freeze([
  'capacity_resource_id', 'capacity_dimension', 'worker_id', ...SCOPE_FIELDS
]);
const IDENTITY_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'lease_id', 'ownership_id', 'operational_owner_id',
  'worker_id', 'fencing_token', 'capacity_resource_id', 'capacity_resource_digest',
  'capacity_dimension', 'requested_amount', 'reservation_ordinal', ...SCOPE_FIELDS
]);
const FIELDS = Object.freeze([
  ...IDENTITY_FIELDS, 'reservation_id', 'reservation_state', 'reservation_fingerprint',
  'reservation_digest', 'reservation_artifact', 'created_at', 'updated_at', 'released_at'
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
  capacity_reservation_created: true,
  capacity_reserved: true,
  reservation_granted: true,
  executor_ownership_established: false,
  lease_created_by_reservation: false,
  lease_granted_by_reservation: false,
  lease_renewed: false,
  lease_released: false,
  liveness_established_by_reservation: false,
  fencing_token_created_by_reservation: false,
  fencing_token_issued_by_reservation: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  capacity_released: false,
  quota_reserved: false,
  quota_consumed: false,
  reservation_authorizes_execution: false,
  reservation_creates_lease: false,
  reservation_creates_fencing: false,
  reservation_authorizes_provider: false,
  simulation: false,
  production_blocked: true
});
const RESERVATION_STATES = Object.freeze(['ACTIVE', 'RELEASED', 'EXPIRED']);

function sameScope(left, right) {
  return SCOPE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function resourceIdentity(resource) {
  return Object.freeze(Object.fromEntries(RESOURCE_IDENTITY_FIELDS.map((field) => [field, resource[field]])));
}

function buildCapacityResource(input = {}) {
  const identity = resourceIdentity(input);
  const identityValid = RESOURCE_IDENTITY_FIELDS.every((field) => isNonEmptyString(identity[field]))
    && CAPACITY_DIMENSIONS.includes(identity.capacity_dimension);
  const limitValid = Number.isInteger(input.capacity_limit) && input.capacity_limit >= 1;
  if (!identityValid || !limitValid) return Object.freeze({ outcome: 'INVALID', reason_code: 'capacity_resource_invalid' });
  const fingerprint = stablePayload(identity);
  const digest = computeCanonicalContentDigest({ ...identity, capacity_limit: input.capacity_limit });
  return cloneFrozen({
    outcome: 'READY',
    ...identity,
    capacity_limit: input.capacity_limit,
    capacity_fingerprint: fingerprint,
    capacity_digest: digest,
    capacity_artifact: { ...identity, capacity_limit: input.capacity_limit, capacity_fingerprint: fingerprint, capacity_digest: digest },
    ...SAFE_FLAGS,
    capacity_reservation_created: false,
    capacity_reserved: false,
    reservation_granted: false
  });
}

function validatePersistedCapacityResource(resource) {
  const errors = [];
  if (!isPlainObject(resource)) return { valid: false, errors: ['capacity_resource_must_be_object'] };
  for (const field of [...RESOURCE_IDENTITY_FIELDS, 'capacity_limit', 'capacity_fingerprint', 'capacity_digest', 'capacity_artifact']) {
    if (!Object.prototype.hasOwnProperty.call(resource, field)) errors.push(`capacity_resource_missing_${field}`);
  }
  if (!RESOURCE_IDENTITY_FIELDS.every((field) => isNonEmptyString(resource[field]))) errors.push('capacity_resource_identity_invalid');
  if (!CAPACITY_DIMENSIONS.includes(resource.capacity_dimension)) errors.push('capacity_resource_dimension_invalid');
  if (!Number.isInteger(Number(resource.capacity_limit)) || Number(resource.capacity_limit) < 1) errors.push('capacity_resource_limit_invalid');
  if (!isNonEmptyString(resource.capacity_fingerprint) || !isNonEmptyString(resource.capacity_digest)) errors.push('capacity_resource_digest_fields_invalid');
  if (!isCanonicalContentDigest(resource.capacity_digest)) errors.push('capacity_resource_digest_invalid');
  if (!isPlainObject(resource.capacity_artifact)) errors.push('capacity_resource_artifact_invalid');
  try {
    const identity = resourceIdentity(resource);
    if (resource.capacity_fingerprint !== stablePayload(identity)) errors.push('capacity_resource_fingerprint_mismatch');
    if (resource.capacity_digest !== computeCanonicalContentDigest({ ...identity, capacity_limit: Number(resource.capacity_limit) })) {
      errors.push('capacity_resource_digest_mismatch');
    }
    if (resource.capacity_artifact.capacity_resource_id !== resource.capacity_resource_id
      || resource.capacity_artifact.capacity_dimension !== resource.capacity_dimension
      || Number(resource.capacity_artifact.capacity_limit) !== Number(resource.capacity_limit)
      || resource.capacity_artifact.capacity_digest !== resource.capacity_digest) {
      errors.push('capacity_resource_artifact_mismatch');
    }
  } catch (error) {
    errors.push(`capacity_resource_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildIdentity({ lease, resource, requestedAmount, reservationOrdinal }) {
  return Object.freeze({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    lease_id: lease.lease_id,
    ownership_id: lease.ownership_id,
    operational_owner_id: lease.operational_owner_id,
    worker_id: lease.selected_worker_id,
    fencing_token: Number(lease.fencing_token),
    capacity_resource_id: resource.capacity_resource_id,
    capacity_resource_digest: resource.capacity_digest,
    capacity_dimension: resource.capacity_dimension,
    requested_amount: requestedAmount,
    reservation_ordinal: reservationOrdinal,
    ...Object.fromEntries(SCOPE_FIELDS.map((field) => [field, lease[field]]))
  });
}

function buildCapacityReservationPlan({ lease, resource, operational_owner_id: ownerId, fencing_token: fencingToken, requested_amount: requestedAmount, reservation_ordinal: reservationOrdinal = RESERVATION_ORDINAL } = {}) {
  const errors = [];
  const leaseValidation = validatePersistedLease(lease);
  if (!leaseValidation.valid) errors.push(...leaseValidation.errors.map((error) => `lease_${error}`));
  const resourceValidation = validatePersistedCapacityResource(resource);
  if (!resourceValidation.valid) errors.push(...resourceValidation.errors);
  if (lease?.lease_state !== 'ACTIVE') errors.push('lease_not_active');
  if (lease?.operational_owner_id !== ownerId) errors.push('owner_mismatch');
  if (Number(lease?.fencing_token) !== fencingToken) errors.push('fencing_token_stale');
  if (!Number.isInteger(requestedAmount) || requestedAmount < 1) errors.push('requested_amount_invalid');
  if (Number.isInteger(resource?.capacity_limit) && requestedAmount > resource.capacity_limit) errors.push('requested_amount_exceeds_resource_limit');
  if (!Number.isInteger(reservationOrdinal) || reservationOrdinal < 1) errors.push('reservation_ordinal_invalid');
  if (!sameScope(lease, resource)) errors.push('resource_scope_mismatch');
  if (resource?.worker_id !== lease?.selected_worker_id) errors.push('resource_worker_mismatch');
  if (errors.length > 0) return Object.freeze({ outcome: 'INVALID', reason_code: 'invalid_capacity_reservation_predecessor', errors: uniqueSorted(errors) });
  const identity = buildIdentity({ lease, resource, requestedAmount, reservationOrdinal });
  const fingerprint = stablePayload(identity);
  const digest = computeCanonicalContentDigest({ ...identity, capacity_limit: resource.capacity_limit });
  const reservationId = `${RESERVATION_ID_PREFIX}${digest.slice('sha256:'.length)}`;
  const artifact = {
    ...identity,
    capacity_limit: resource.capacity_limit,
    reservation_id: reservationId,
    reservation_fingerprint: fingerprint,
    reservation_digest: digest,
    ...SAFE_FLAGS
  };
  return cloneFrozen({
    outcome: 'READY',
    reservation_id: reservationId,
    reservation_fingerprint: fingerprint,
    reservation_digest: digest,
    reservation_ordinal: reservationOrdinal,
    reservation_artifact: artifact,
    identity,
    ...SAFE_FLAGS
  });
}

function planToInsertRow(plan) {
  if (!plan || plan.outcome !== 'READY') throw new TypeError('capacity_reservation_plan_not_ready');
  return {
    ...plan.identity,
    reservation_id: plan.reservation_id,
    reservation_state: 'ACTIVE',
    reservation_fingerprint: plan.reservation_fingerprint,
    reservation_digest: plan.reservation_digest,
    reservation_artifact: plan.reservation_artifact
  };
}

function identityFromPersistedRow(row) {
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, field === 'fencing_token' || field === 'requested_amount' || field === 'reservation_ordinal' ? Number(row[field]) : row[field]])));
}

function validatePersistedCapacityReservation(row) {
  const errors = [];
  if (!isPlainObject(row)) return { valid: false, errors: ['capacity_reservation_must_be_object'] };
  for (const field of FIELDS.filter((field) => !['created_at', 'updated_at', 'released_at'].includes(field))) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) errors.push(`capacity_reservation_missing_${field}`);
  }
  for (const field of IDENTITY_FIELDS.filter((field) => !['fencing_token', 'requested_amount', 'reservation_ordinal'].includes(field))) {
    if (!isNonEmptyString(row[field])) errors.push(`capacity_reservation_${field}_invalid`);
  }
  for (const field of ['fencing_token', 'requested_amount', 'reservation_ordinal']) {
    if (!Number.isInteger(Number(row[field])) || Number(row[field]) < 1) errors.push(`capacity_reservation_${field}_invalid`);
  }
  if (!isNonEmptyString(row.reservation_id) || !row.reservation_id.startsWith(RESERVATION_ID_PREFIX)) errors.push('capacity_reservation_id_invalid');
  if (row.contract_name !== CONTRACT_NAME) errors.push('capacity_reservation_contract_invalid');
  if (row.contract_version !== CONTRACT_VERSION) errors.push('capacity_reservation_contract_version_invalid');
  if (!isCanonicalContentDigest(row.capacity_resource_digest) || !isCanonicalContentDigest(row.reservation_digest)) errors.push('capacity_reservation_digest_invalid');
  if (!RESERVATION_STATES.includes(row.reservation_state)) errors.push('capacity_reservation_state_invalid');
  if (!isPlainObject(row.reservation_artifact)) errors.push('capacity_reservation_artifact_invalid');
  try {
    const identity = identityFromPersistedRow(row);
    const fingerprint = stablePayload(identity);
    const digest = computeCanonicalContentDigest({ ...identity, capacity_limit: Number(row.reservation_artifact.capacity_limit) });
    if (row.reservation_fingerprint !== fingerprint) errors.push('capacity_reservation_fingerprint_mismatch');
    if (row.reservation_digest !== digest) errors.push('capacity_reservation_digest_mismatch');
    if (row.reservation_id !== `${RESERVATION_ID_PREFIX}${digest.slice('sha256:'.length)}`) errors.push('capacity_reservation_id_mismatch');
    const artifact = row.reservation_artifact;
    if (artifact.reservation_id !== row.reservation_id || artifact.lease_id !== row.lease_id
      || artifact.capacity_resource_id !== row.capacity_resource_id || artifact.worker_id !== row.worker_id
      || Number(artifact.requested_amount) !== Number(row.requested_amount)
      || Number(artifact.fencing_token) !== Number(row.fencing_token)
      || !Number.isInteger(Number(artifact.capacity_limit)) || Number(artifact.capacity_limit) < 1
      || artifact.capacity_reservation_created !== true || artifact.capacity_reserved !== true
      || artifact.reservation_granted !== true || artifact.execution_authorized !== false
      || artifact.production_blocked !== true) errors.push('capacity_reservation_artifact_mismatch');
  } catch (error) {
    errors.push(`capacity_reservation_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function classifyPersistedCapacityReservation(row, plan) {
  if (!plan || plan.outcome !== 'READY') return { outcome: 'INVALID', reason_code: 'capacity_reservation_plan_not_ready' };
  const validation = validatePersistedCapacityReservation(row);
  if (!validation.valid) return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_capacity_reservation_invalid', validation_errors: validation.errors };
  return stablePayload(identityFromPersistedRow(row)) === stablePayload(plan.identity)
    ? { outcome: 'EXISTING_IDENTICAL', reason_code: 'capacity_reservation_replay' }
    : { outcome: 'CONFLICT', reason_code: 'capacity_reservation_slot_conflict' };
}

module.exports = {
  CAPACITY_DIMENSIONS,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  IDENTITY_FIELDS,
  RESERVATION_ID_PREFIX,
  RESERVATION_ORDINAL,
  RESERVATION_STATES,
  RESOURCE_IDENTITY_FIELDS,
  SAFE_FLAGS,
  SCOPE_FIELDS,
  buildCapacityResource,
  buildCapacityReservationPlan,
  classifyPersistedCapacityReservation,
  identityFromPersistedRow,
  planToInsertRow,
  validatePersistedCapacityReservation,
  validatePersistedCapacityResource
};
