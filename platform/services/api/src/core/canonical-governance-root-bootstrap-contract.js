'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload, cloneFrozen } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

const CONTRACT_NAME = 'OWNER_CONTROLLED_INSTALLATION_BOOTSTRAP_AND_CANONICAL_GOVERNANCE_ROOT';
const CONTRACT_VERSION = 'owner_controlled_installation_bootstrap_and_canonical_governance_root_v1';
const IDENTITY_VERSION = 'installation_identity_v1';
const INSTALLATION_STATES = Object.freeze(['UNINITIALIZED', 'BOOTSTRAPPED', 'SUSPENDED', 'RECOVERY_REQUIRED', 'REVOKED']);
const ROOT_STATES = Object.freeze(['ACTIVE', 'RECOVERY_REQUIRED', 'REVOKED']);
const ROOT_KEY_STATES = Object.freeze(['ACTIVE', 'SUPERSEDED', 'REVOKED']);
const ROOT_CAPABILITIES = Object.freeze([
  'GOVERNANCE_AUDIT_READ',
  'GOVERNANCE_DELEGATE_AUTHORITY',
  'GOVERNANCE_REVOKE_AUTHORITY',
  'GOVERNANCE_ROTATE_ROOT_KEY'
]);
const IDENTITY_FIELDS = Object.freeze([
  'identity_version', 'installation_id', 'deployment_target_id', 'environment',
  'repository', 'commit_sha', 'release_digest'
]);
const SCOPE_FIELDS = Object.freeze([
  'scope_type', 'installation_id', 'tenant_ids', 'organization_ids', 'project_ids',
  'cross_tenant', 'cross_organization', 'cross_project'
]);
const DELEGATION_FIELDS = Object.freeze([
  'max_depth', 'wildcard_allowed', 'cross_tenant_allowed',
  'cross_organization_allowed', 'cross_project_allowed', 'delegable_authority_classes'
]);
const ROOT_SPEC_FIELDS = Object.freeze(['root_subject_id', 'root_scope', 'root_capabilities', 'delegation_policy', 'initial_key']);
const KEY_FIELDS = Object.freeze(['root_key_id', 'algorithm', 'public_key', 'key_fingerprint', 'key_digest']);
const AUTHORIZATION_FIELDS = Object.freeze([
  'authorization_id', 'boundary_type', 'operator_subject', 'operator_key_id',
  'target_installation_id', 'installation_identity_digest', 'authorized_action',
  'authorized_artifact_digest', 'root_spec_digest', 'issued_at', 'expires_at',
  'boundary_key_id', 'signature_algorithm', 'signature', 'attestation_digest'
]);

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return false;
  }
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${prefix}_unknown_field::${key}`);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_field::${field}`);
  return true;
}

function requiredStrings(value, fields, prefix, errors) {
  for (const field of fields) if (!isNonEmptyString(value?.[field])) errors.push(`${prefix}_${field}_invalid`);
}

function canonicalDigest(value) {
  return computeCanonicalContentDigest(JSON.parse(stablePayload(value)));
}

function installationIdentityDigest(identity) {
  return canonicalDigest(identity);
}

function rootSpecDigest(rootSpec) {
  return canonicalDigest(rootSpec);
}

function artifactDigestMaterial(request) {
  const authorization = { ...request.external_authorization };
  delete authorization.authorized_artifact_digest;
  delete authorization.attestation_digest;
  delete authorization.issued_at;
  delete authorization.expires_at;
  delete authorization.signature;
  return {
    contract_version: CONTRACT_VERSION,
    bootstrap_id: request.bootstrap_id,
    installation_identity: request.installation_identity,
    root_spec: request.root_spec,
    external_authorization: authorization
  };
}

function computeArtifactDigest(request) {
  return canonicalDigest(artifactDigestMaterial(request));
}

function computeAttestationDigest(authorization) {
  const material = { ...authorization };
  delete material.attestation_digest;
  return canonicalDigest(material);
}

function computeProvenanceDigest(request) {
  return canonicalDigest({
    artifact_digest: request.artifact_digest,
    external_authorization: request.external_authorization
  });
}

function validateInstallationIdentity(identity, expectedInstallationId, errors = []) {
  if (!exactFields(identity, IDENTITY_FIELDS, 'installation_identity', errors)) return errors;
  requiredStrings(identity, IDENTITY_FIELDS, 'installation_identity', errors);
  if (identity.identity_version !== IDENTITY_VERSION) errors.push('installation_identity_version_invalid');
  if (expectedInstallationId && identity.installation_id !== expectedInstallationId) errors.push('installation_identity_mismatch');
  if (!/^[0-9a-f]{40}$/i.test(identity.commit_sha || '')) errors.push('installation_commit_sha_invalid');
  if (!isCanonicalContentDigest(identity.release_digest)) errors.push('installation_release_digest_invalid');
  return errors;
}

function validateScope(scope, installationId, errors = []) {
  if (!exactFields(scope, SCOPE_FIELDS, 'root_scope', errors)) return errors;
  if (scope.scope_type !== 'installation') errors.push('root_scope_type_invalid');
  if (scope.installation_id !== installationId) errors.push('root_scope_installation_mismatch');
  for (const field of ['tenant_ids', 'organization_ids', 'project_ids']) {
    if (!Array.isArray(scope[field]) || scope[field].length !== 0) errors.push(`root_scope_${field}_must_be_empty`);
  }
  for (const field of ['cross_tenant', 'cross_organization', 'cross_project']) {
    if (scope[field] !== false) errors.push(`root_scope_${field}_must_be_false`);
  }
  return errors;
}

function validateDelegationPolicy(policy, errors = []) {
  if (!exactFields(policy, DELEGATION_FIELDS, 'delegation_policy', errors)) return errors;
  if (policy.max_depth !== 1) errors.push('delegation_max_depth_invalid');
  for (const field of ['wildcard_allowed', 'cross_tenant_allowed', 'cross_organization_allowed', 'cross_project_allowed']) {
    if (policy[field] !== false) errors.push(`delegation_${field}_must_be_false`);
  }
  if (!Array.isArray(policy.delegable_authority_classes) || policy.delegable_authority_classes.length !== 0) {
    errors.push('delegation_authority_classes_must_be_empty');
  }
  return errors;
}

function validateRootKey(key, errors = []) {
  if (!exactFields(key, KEY_FIELDS, 'initial_key', errors)) return errors;
  requiredStrings(key, KEY_FIELDS, 'initial_key', errors);
  if (key.algorithm !== 'Ed25519') errors.push('root_key_algorithm_invalid');
  for (const field of ['key_fingerprint', 'key_digest']) if (!isCanonicalContentDigest(key[field])) errors.push(`root_key_${field}_invalid`);
  if (key.key_fingerprint !== canonicalDigest({ algorithm: key.algorithm, public_key: key.public_key })) errors.push('root_key_fingerprint_mismatch');
  if (key.key_digest !== canonicalDigest({ root_key_id: key.root_key_id, algorithm: key.algorithm, public_key: key.public_key })) errors.push('root_key_digest_mismatch');
  if (Object.keys(key).some((field) => /private|secret|token|password|credential/i.test(field))) errors.push('root_key_sensitive_field_forbidden');
  if (/private|secret|token|password|credential/i.test(key.public_key || '')) errors.push('root_key_sensitive_value_forbidden');
  return errors;
}

function validateRootSpec(rootSpec, installationId, errors = []) {
  if (!exactFields(rootSpec, ROOT_SPEC_FIELDS, 'root_spec', errors)) return errors;
  requiredStrings(rootSpec, ['root_subject_id'], 'root_spec', errors);
  validateScope(rootSpec.root_scope, installationId, errors);
  if (!Array.isArray(rootSpec.root_capabilities)
    || uniqueSorted(rootSpec.root_capabilities).length !== ROOT_CAPABILITIES.length
    || uniqueSorted(rootSpec.root_capabilities).join('|') !== uniqueSorted(ROOT_CAPABILITIES).join('|')) {
    errors.push('root_capabilities_invalid');
  }
  validateDelegationPolicy(rootSpec.delegation_policy, errors);
  validateRootKey(rootSpec.initial_key, errors);
  if (rootSpec.root_subject_id !== `governance-root::${installationId}`) errors.push('root_subject_id_invalid');
  return errors;
}

function validateExternalAuthorization(authorization, request, errors = []) {
  if (!exactFields(authorization, AUTHORIZATION_FIELDS, 'external_authorization', errors)) return errors;
  requiredStrings(authorization, AUTHORIZATION_FIELDS, 'external_authorization', errors);
  if (authorization.boundary_type !== 'EXTERNAL_DEPLOYMENT_BOUNDARY') errors.push('external_boundary_type_invalid');
  if (authorization.target_installation_id !== request.installation_identity.installation_id) errors.push('external_target_installation_mismatch');
  if (authorization.installation_identity_digest !== installationIdentityDigest(request.installation_identity)) errors.push('external_identity_digest_mismatch');
  if (authorization.authorized_action !== 'OWNER_CONTROLLED_INSTALLATION_BOOTSTRAP') errors.push('external_authorized_action_invalid');
  if (authorization.root_spec_digest !== rootSpecDigest(request.root_spec)) errors.push('external_root_spec_digest_mismatch');
  if (authorization.signature_algorithm !== 'Ed25519') errors.push('external_signature_algorithm_invalid');
  if (!/^[A-Za-z0-9_-]+$/.test(authorization.signature || '')) errors.push('external_signature_invalid');
  const issuedAt = Date.parse(authorization.issued_at || '');
  const expiresAt = Date.parse(authorization.expires_at || '');
  if (!Number.isFinite(issuedAt)) errors.push('external_issued_at_invalid');
  if (!Number.isFinite(expiresAt)) errors.push('external_expires_at_invalid');
  if (Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && expiresAt <= issuedAt) {
    errors.push('external_authorization_expiry_invalid');
  }
  if (authorization.attestation_digest !== computeAttestationDigest(authorization)) errors.push('external_attestation_digest_mismatch');
  return errors;
}

function validateBootstrapRequest(request) {
  const errors = [];
  const fields = ['contract_version', 'bootstrap_id', 'installation_identity', 'root_spec', 'external_authorization', 'artifact_digest', 'provenance_digest'];
  if (!exactFields(request, fields, 'bootstrap_request', errors)) return { valid: false, errors: uniqueSorted(errors) };
  if (request.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  requiredStrings(request, ['bootstrap_id', 'artifact_digest', 'provenance_digest'], 'bootstrap_request', errors);
  if (!isCanonicalContentDigest(request.artifact_digest)) errors.push('artifact_digest_invalid');
  if (!isCanonicalContentDigest(request.provenance_digest)) errors.push('provenance_digest_invalid');
  validateInstallationIdentity(request.installation_identity, null, errors);
  validateRootSpec(request.root_spec, request.installation_identity?.installation_id, errors);
  validateExternalAuthorization(request.external_authorization, request, errors);
  if (request.artifact_digest !== computeArtifactDigest(request)) errors.push('artifact_digest_mismatch');
  if (request.provenance_digest !== computeProvenanceDigest(request)) errors.push('provenance_digest_mismatch');
  if (request.external_authorization.authorized_artifact_digest !== request.artifact_digest) errors.push('external_artifact_digest_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validatePersistedBootstrapRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['bootstrap_record_must_be_object'] };
  const result = validateBootstrapRequest(record.bootstrap_artifact);
  if (!result.valid) errors.push(...result.errors);
  if (record.bootstrap_id !== record.bootstrap_artifact?.bootstrap_id) errors.push('persisted_bootstrap_id_mismatch');
  if (record.artifact_digest !== record.bootstrap_artifact?.artifact_digest) errors.push('persisted_artifact_digest_mismatch');
  if (record.provenance_digest !== record.bootstrap_artifact?.provenance_digest) errors.push('persisted_provenance_digest_mismatch');
  if (record.external_authorization_id !== record.external_authorization?.authorization_id) errors.push('persisted_authorization_id_mismatch');
  if (record.external_attestation_digest !== record.external_authorization?.attestation_digest) errors.push('persisted_attestation_digest_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildBootstrapArtifact(input = {}) {
  const request = {
    contract_version: CONTRACT_VERSION,
    bootstrap_id: input.bootstrap_id,
    installation_identity: input.installation_identity,
    root_spec: input.root_spec,
    external_authorization: input.external_authorization,
    artifact_digest: 'pending',
    provenance_digest: 'pending'
  };
  request.artifact_digest = computeArtifactDigest(request);
  request.external_authorization = {
    ...request.external_authorization,
    authorized_artifact_digest: request.artifact_digest
  };
  request.external_authorization.attestation_digest = computeAttestationDigest(request.external_authorization);
  request.provenance_digest = computeProvenanceDigest(request);
  const validation = validateBootstrapRequest(request);
  if (!validation.valid) throw new Error(`bootstrap_request_invalid::${validation.errors.join(',')}`);
  return cloneFrozen(request);
}

function buildReceipt(request, values = {}) {
  return cloneFrozen({
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    status: values.status || 'BOOTSTRAPPED',
    bootstrap_id: request.bootstrap_id,
    installation_id: request.installation_identity.installation_id,
    installation_identity_digest: installationIdentityDigest(request.installation_identity),
    artifact_digest: request.artifact_digest,
    provenance_digest: request.provenance_digest,
    root_subject_id: request.root_spec.root_subject_id,
    root_digest: rootSpecDigest(request.root_spec),
    root_key_id: request.root_spec.initial_key.root_key_id,
    root_generation: 0,
    lifecycle_state: 'BOOTSTRAPPED',
    root_state: 'ACTIVE',
    replay: values.replay === true,
    execution_started: false,
    authority_operational: false,
    provider_called: false,
    tool_called: false,
    network_used: false,
    created_at: values.created_at || null
  });
}

module.exports = {
  AUTHORIZATION_FIELDS,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  DELEGATION_FIELDS,
  IDENTITY_VERSION,
  IDENTITY_FIELDS,
  INSTALLATION_STATES,
  KEY_FIELDS,
  ROOT_CAPABILITIES,
  ROOT_KEY_STATES,
  ROOT_SPEC_FIELDS,
  ROOT_STATES,
  SCOPE_FIELDS,
  artifactDigestMaterial,
  buildBootstrapArtifact,
  buildReceipt,
  canonicalDigest,
  computeArtifactDigest,
  computeAttestationDigest,
  computeProvenanceDigest,
  installationIdentityDigest,
  rootSpecDigest,
  validateBootstrapRequest,
  validateDelegationPolicy,
  validateInstallationIdentity,
  validatePersistedBootstrapRecord,
  validateRootKey,
  validateRootSpec,
  validateScope
};
