'use strict';

const { timingSafeEqual } = require('crypto');

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const ALLOWED_ENTRY_FIELDS = new Set(['key_id', 'key_digest', 'principal_id', 'tenant_id', 'active']);

class MachineIdentityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MachineIdentityError';
    this.code = code;
  }
}

function requiredString(value, code) {
  if (typeof value !== 'string' || value.trim() === '') throw new MachineIdentityError(code);
  return value.trim();
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new MachineIdentityError('INVALID_IDENTITY_ENTRY');
  }

  for (const field of Object.keys(entry)) {
    if (!ALLOWED_ENTRY_FIELDS.has(field)) throw new MachineIdentityError('INVALID_IDENTITY_ENTRY');
  }

  const keyId = requiredString(entry.key_id, 'INVALID_KEY_ID');
  const digest = requiredString(entry.key_digest, 'INVALID_KEY_DIGEST').toLowerCase();
  const principalId = requiredString(entry.principal_id, 'INVALID_PRINCIPAL_ID');
  const tenantId = requiredString(entry.tenant_id, 'MISSING_TENANT_MAPPING');

  if (!SHA256_HEX.test(digest)) throw new MachineIdentityError('INVALID_KEY_DIGEST');
  if (typeof entry.active !== 'boolean') throw new MachineIdentityError('INVALID_KEY_STATUS');

  return Object.freeze({
    key_id: keyId,
    key_digest: digest,
    principal_id: principalId,
    tenant_id: tenantId,
    active: entry.active
  });
}

function createMachineIdentityRegistry({ entries } = {}) {
  if (!Array.isArray(entries)) throw new MachineIdentityError('INVALID_IDENTITY_REGISTRY');

  const normalized = entries.map(normalizeEntry);
  const keyIds = new Set();
  const digests = new Set();

  for (const entry of normalized) {
    if (keyIds.has(entry.key_id)) throw new MachineIdentityError('DUPLICATE_KEY_ID');
    if (digests.has(entry.key_digest)) throw new MachineIdentityError('DUPLICATE_KEY_DIGEST');
    keyIds.add(entry.key_id);
    digests.add(entry.key_digest);
  }

  function findByDigest(digest) {
    if (!Buffer.isBuffer(digest) || digest.length !== 32) return null;

    for (const entry of normalized) {
      const configuredDigest = Buffer.from(entry.key_digest, 'hex');
      if (!timingSafeEqual(configuredDigest, digest)) continue;
      return Object.freeze({
        key_id: entry.key_id,
        principal_id: entry.principal_id,
        tenant_id: entry.tenant_id,
        active: entry.active
      });
    }

    return null;
  }

  return Object.freeze({
    findByDigest,
    size: normalized.length
  });
}

module.exports = {
  MachineIdentityError,
  createMachineIdentityRegistry
};
