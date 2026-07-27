'use strict';

const { createHash } = require('node:crypto');
const { stablePayload } = require('./agent-identity-contract');

// A compact, deterministic digest over a canonicalized payload -- built to let a BindingRecord
// reference a large, already-fingerprinted object (AuthorizationProvenanceReference,
// ExecutionRegistrySnapshotReference, ...) in full fidelity without re-embedding that object's
// own multi-KB canonical fingerprint string as a field value, which would otherwise get
// re-serialized (with string-escaping overhead) at every downstream layer -- BindingRecord's own
// recompute-and-compare, then BindingLedger, then ExecutionPlanPackage, then plan/result/audit --
// compounding into a fingerprint hundreds of times larger than the object it describes.
//
// This is a *content digest*, not a signature: it constitutes canonicalization plus a one-way
// hash, nothing more.
// - The canonical payload fingerprint (`stablePayload` alone, used everywhere else in this
//   codebase) continues to exist unchanged -- this digest is an additional, compact representation
//   for the specific case of referencing an already-fingerprinted object from a BindingRecord.
// - The digest is compact: a fixed ~71-character string (`sha256:` + 64 hex characters) regardless
//   of input size.
// - The digest is not a signature, MAC, or cryptographic authenticity guarantee -- it proves two
//   canonicalized payloads are byte-identical, nothing about who produced either one.
// - The digest does not prove the identity of the emitter. No key, secret, or credential is
//   involved in producing it.
// - The digest is not a trusted attestation. A caller who can recompute the same canonical payload
//   can trivially reproduce the same digest; this module implements no KMS, HMAC, or real
//   attestation, and never will on its own.
//
// Only node:crypto's createHash('sha256') is used -- no HMAC, no secret material, no network call,
// no private key, no real attestation.

const DIGEST_ALGORITHM = 'sha256';
const DIGEST_PREFIX = `${DIGEST_ALGORITHM}:`;
const DIGEST_INVALID_PREFIX = 'digest_invalid';

function computeCanonicalContentDigest(value) {
  let canonical;
  try {
    canonical = stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `${DIGEST_INVALID_PREFIX}::${error.message}`;
  }
  const hash = createHash(DIGEST_ALGORITHM).update(canonical, 'utf8').digest('hex');
  return `${DIGEST_PREFIX}${hash}`;
}

function isCanonicalContentDigest(value) {
  return typeof value === 'string' && new RegExp(`^${DIGEST_PREFIX}[0-9a-f]{64}$`).test(value);
}

module.exports = {
  DIGEST_ALGORITHM,
  DIGEST_INVALID_PREFIX,
  DIGEST_PREFIX,
  computeCanonicalContentDigest,
  isCanonicalContentDigest
};
