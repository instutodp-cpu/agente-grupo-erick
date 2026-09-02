'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

const CONTRACT_NAME = 'RUNTIME_OPERATIONAL_OWNER_IDENTITY_AUTHORITY';
const CONTRACT_VERSION = 'runtime_operational_owner_identity_authority_contract_v1';
const VERSION = 1;
const OWNER_TYPES = Object.freeze(['operational_owner']);
const OPERATIONAL_OWNER_ID_PREFIX = 'runtime-operational-owner-';
const IDENTITY_FIELDS = Object.freeze([
  'contract_name', 'contract_version', 'operational_owner_type', 'owner_reference_id',
  'tenant_id', 'organization_id', 'project_id'
]);
const FIELDS = Object.freeze([
  ...IDENTITY_FIELDS, 'operational_owner_id', 'owner_identity_fingerprint',
  'owner_identity_digest', 'owner_identity_artifact', 'created_at'
]);
const SAFE_FLAGS = Object.freeze({
  operational_owner_identity_registered: true,
  worker_ownership_established: false,
  executor_ownership_established: false,
  lease_created: false,
  lease_granted: false,
  fencing_token_created: false,
  fencing_token_issued: false,
  capacity_reserved: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  production_blocked: true,
  identity_establishes_ownership: false,
  identity_creates_lease: false,
  identity_creates_fencing: false,
  identity_reserves_capacity: false,
  identity_authorizes_execution: false
});

function requiredIdentityFields(value) {
  return ['owner_reference_id', 'tenant_id', 'organization_id', 'project_id'].filter((field) => {
    return !isNonEmptyString(value?.[field]) || value[field].length > 255;
  });
}

function buildIdentity(input = {}) {
  return Object.freeze({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    operational_owner_type: input.operational_owner_type,
    owner_reference_id: input.owner_reference_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id
  });
}

function identityFromPersistedRow(row) {
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, row[field]])));
}

function artifactFor({ identity, operational_owner_id, owner_identity_fingerprint, owner_identity_digest }) {
  return {
    ...identity,
    operational_owner_id,
    owner_identity_fingerprint,
    owner_identity_digest,
    ...SAFE_FLAGS
  };
}

function buildOperationalOwnerIdentity({
  operational_owner_type: operationalOwnerType = OWNER_TYPES[0],
  owner_reference_id: ownerReferenceId,
  tenant_id: tenantId,
  organization_id: organizationId,
  project_id: projectId
} = {}) {
  const input = {
    operational_owner_type: operationalOwnerType,
    owner_reference_id: ownerReferenceId,
    tenant_id: tenantId,
    organization_id: organizationId,
    project_id: projectId
  };
  const errors = [];
  if (!isPlainObject(input)) errors.push('identity_must_be_object');
  if (!OWNER_TYPES.includes(operationalOwnerType)) errors.push('operational_owner_type_invalid');
  errors.push(...requiredIdentityFields(input).map((field) => `${field}_invalid`));
  if (errors.length > 0) {
    return Object.freeze({ outcome: 'INVALID', reason_code: 'invalid_operational_owner_identity', errors: uniqueSorted(errors) });
  }

  const identity = buildIdentity(input);
  const ownerIdentityFingerprint = stablePayload(identity);
  const ownerIdentityDigest = computeCanonicalContentDigest(identity);
  const operationalOwnerId = `${OPERATIONAL_OWNER_ID_PREFIX}${ownerIdentityDigest.slice('sha256:'.length)}`;
  return cloneFrozen({
    outcome: 'READY',
    operational_owner_id: operationalOwnerId,
    owner_identity_fingerprint: ownerIdentityFingerprint,
    owner_identity_digest: ownerIdentityDigest,
    identity,
    owner_identity_artifact: artifactFor({
      identity,
      operational_owner_id: operationalOwnerId,
      owner_identity_fingerprint: ownerIdentityFingerprint,
      owner_identity_digest: ownerIdentityDigest
    }),
    ...SAFE_FLAGS
  });
}

function planToInsertRow(plan) {
  if (!plan || plan.outcome !== 'READY') throw new TypeError('operational_owner_identity_plan_not_ready');
  return {
    ...plan.identity,
    operational_owner_id: plan.operational_owner_id,
    owner_identity_fingerprint: plan.owner_identity_fingerprint,
    owner_identity_digest: plan.owner_identity_digest,
    owner_identity_artifact: plan.owner_identity_artifact
  };
}

function validatePersistedOperationalOwnerIdentity(row) {
  const errors = [];
  if (!isPlainObject(row)) return { valid: false, errors: ['persisted_operational_owner_identity_must_be_object'] };
  for (const field of FIELDS.filter((field) => field !== 'created_at')) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) errors.push(`persisted_operational_owner_missing_${field}`);
  }
  if (row.contract_name !== CONTRACT_NAME) errors.push('persisted_operational_owner_contract_invalid');
  if (row.contract_version !== CONTRACT_VERSION) errors.push('persisted_operational_owner_contract_version_invalid');
  if (!OWNER_TYPES.includes(row.operational_owner_type)) errors.push('persisted_operational_owner_type_invalid');
  for (const field of ['owner_reference_id', 'tenant_id', 'organization_id', 'project_id']) {
    if (!isNonEmptyString(row[field]) || row[field].length > 255) errors.push(`persisted_operational_owner_${field}_invalid`);
  }
  if (!isNonEmptyString(row.operational_owner_id) || !row.operational_owner_id.startsWith(OPERATIONAL_OWNER_ID_PREFIX)) {
    errors.push('persisted_operational_owner_id_invalid');
  }
  if (!isNonEmptyString(row.owner_identity_fingerprint)) errors.push('persisted_operational_owner_fingerprint_invalid');
  if (!isCanonicalContentDigest(row.owner_identity_digest)) errors.push('persisted_operational_owner_digest_invalid');
  if (!isPlainObject(row.owner_identity_artifact)) errors.push('persisted_operational_owner_artifact_invalid');

  try {
    const identity = identityFromPersistedRow(row);
    const fingerprint = stablePayload(identity);
    const digest = computeCanonicalContentDigest(identity);
    if (row.owner_identity_fingerprint !== fingerprint) errors.push('persisted_operational_owner_fingerprint_mismatch');
    if (row.owner_identity_digest !== digest) errors.push('persisted_operational_owner_digest_mismatch');
    if (row.operational_owner_id !== `${OPERATIONAL_OWNER_ID_PREFIX}${digest.slice('sha256:'.length)}`) errors.push('persisted_operational_owner_id_mismatch');
    const expectedArtifact = artifactFor({
      identity,
      operational_owner_id: row.operational_owner_id,
      owner_identity_fingerprint: row.owner_identity_fingerprint,
      owner_identity_digest: row.owner_identity_digest
    });
    if (stablePayload(row.owner_identity_artifact) !== stablePayload(expectedArtifact)) errors.push('persisted_operational_owner_artifact_mismatch');
  } catch (error) {
    errors.push(`persisted_operational_owner_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function classifyPersistedOperationalOwner(row, plan) {
  if (!plan || plan.outcome !== 'READY') return { outcome: 'INVALID', reason_code: 'identity_plan_not_ready' };
  const persisted = validatePersistedOperationalOwnerIdentity(row);
  if (!persisted.valid) return { outcome: 'TECHNICAL_FAILURE', reason_code: 'persisted_identity_invalid', validation_errors: persisted.errors };
  return stablePayload(identityFromPersistedRow(row)) === stablePayload(plan.identity)
    ? { outcome: 'EXISTING_IDENTICAL', reason_code: 'operational_owner_identity_replay' }
    : { outcome: 'CONFLICT', reason_code: 'operational_owner_identity_slot_conflict' };
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  IDENTITY_FIELDS,
  OPERATIONAL_OWNER_ID_PREFIX,
  OWNER_TYPES,
  SAFE_FLAGS,
  VERSION,
  buildOperationalOwnerIdentity,
  classifyPersistedOperationalOwner,
  identityFromPersistedRow,
  planToInsertRow,
  validatePersistedOperationalOwnerIdentity
};
