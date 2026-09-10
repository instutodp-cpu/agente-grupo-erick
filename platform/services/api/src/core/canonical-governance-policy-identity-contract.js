'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

// This is a pure identity value contract. It distinguishes a future Governance Policy from
// agent, canary, root-authority, grant, and audit policy objects. It deliberately defines no
// policy content, lifecycle, operation, capability, authorization, persistence, or execution.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_POLICY_IDENTITY_CONTRACT';
const CONTRACT_VERSION = 'hermes_canonical_governance_policy_identity_contract_v1';
const POLICY_IDENTITY_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_POLICY_IDENTITY_V1';

const GOVERNANCE_POLICY_IDENTITY_FIELDS = Object.freeze([
  'contract_version',
  'policy_identity_domain',
  'governance_policy_id',
  'governance_policy_digest'
]);

// The namespace is structural rather than semantic: no display name, policy type, lifecycle
// state, operation, or caller-provided alias can stand in for the identity.
const GOVERNANCE_POLICY_ID_PATTERN = /^governance-policy::[a-z0-9][a-z0-9._-]{0,253}$/;

function governancePolicyIdentityDigestMaterial(identity) {
  const { governance_policy_digest: ignoredDigest, ...material } = identity;
  return material;
}

function canonicalGovernancePolicyIdentityBytes(identity) {
  return Buffer.from(stablePayload(governancePolicyIdentityDigestMaterial(identity)), 'utf8');
}

function governancePolicyIdentityDigest(identity) {
  return computeCanonicalContentDigest(
    JSON.parse(canonicalGovernancePolicyIdentityBytes(identity).toString('utf8'))
  );
}

function validateGovernancePolicyIdentity(identity) {
  const errors = [];
  if (!isPlainObject(identity)) {
    return { valid: false, errors: ['governance_policy_identity_must_be_object'] };
  }

  exactFields(identity, GOVERNANCE_POLICY_IDENTITY_FIELDS, 'governance_policy_identity', errors);
  if (identity.contract_version !== CONTRACT_VERSION) {
    errors.push('governance_policy_identity_contract_version_invalid');
  }
  if (identity.policy_identity_domain !== POLICY_IDENTITY_DOMAIN) {
    errors.push('governance_policy_identity_domain_invalid');
  }
  if (typeof identity.governance_policy_id !== 'string'
    || !GOVERNANCE_POLICY_ID_PATTERN.test(identity.governance_policy_id)) {
    errors.push('governance_policy_identity_id_invalid');
  }
  if (!isCanonicalContentDigest(identity.governance_policy_digest)) {
    errors.push('governance_policy_identity_digest_invalid');
  }

  try {
    if (identity.governance_policy_digest !== governancePolicyIdentityDigest(identity)) {
      errors.push('governance_policy_identity_digest_mismatch');
    }
  } catch (error) {
    errors.push(`governance_policy_identity_canonical_serialization_invalid::${error.message}`);
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildGovernancePolicyIdentity(input) {
  if (!isPlainObject(input)) throw new TypeError('governance_policy_identity_input_must_be_object');
  const identity = {
    ...input,
    contract_version: CONTRACT_VERSION,
    policy_identity_domain: POLICY_IDENTITY_DOMAIN,
    governance_policy_digest: 'pending'
  };
  identity.governance_policy_digest = governancePolicyIdentityDigest(identity);
  const validation = validateGovernancePolicyIdentity(identity);
  if (!validation.valid) {
    throw new TypeError(`governance_policy_identity_invalid::${validation.errors.join(',')}`);
  }
  return cloneFrozen(identity);
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  GOVERNANCE_POLICY_IDENTITY_FIELDS,
  GOVERNANCE_POLICY_ID_PATTERN,
  POLICY_IDENTITY_DOMAIN,
  canonicalGovernancePolicyIdentityBytes,
  governancePolicyIdentityDigest,
  governancePolicyIdentityDigestMaterial,
  buildGovernancePolicyIdentity,
  validateGovernancePolicyIdentity
};
