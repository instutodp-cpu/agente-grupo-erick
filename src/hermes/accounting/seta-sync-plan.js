'use strict';

// Incremental load plan shared by every transport of the seta_read_v1
// adapter (FILE_EXPORT today, the official API once discovered). Both
// transports turn their input into the same canonical READ records and the
// same manifest entries (sourceId -> payloadHash, version), so switching a
// company from file exports to the API keeps idempotency: an unchanged
// record is ignored, a changed one becomes a new version, whatever brought
// it. No network, no database, no disk.

const { normalizeSetaRecord, decideSyncAction } = require('./seta-read-adapter');

const MANIFEST_VERSION = 1;
const MAX_REMEMBERED = 60;

function fail(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

function emptyManifest(identity) {
  return { version: MANIFEST_VERSION, tenantId: identity.tenantId, companyId: identity.companyId,
    kind: identity.kind, files: [], entries: {} };
}

// Multi-company isolation: a manifest never crosses tenant, company or kind.
function validateManifest(manifest, identity) {
  if (manifest == null) return emptyManifest(identity);
  if (manifest.version !== MANIFEST_VERSION || !Array.isArray(manifest.files) ||
      !manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries) ||
      (manifest.apiPages !== undefined && !Array.isArray(manifest.apiPages)) ||
      (manifest.apiCursor !== undefined && manifest.apiCursor !== null && typeof manifest.apiCursor !== 'string')) {
    throw fail('manifest is invalid');
  }
  if (manifest.tenantId !== identity.tenantId || manifest.companyId !== identity.companyId ||
      manifest.kind !== identity.kind) {
    throw fail('manifest belongs to another tenant, company or kind');
  }
  return manifest;
}

// One source row -> canonical record + sync decision. `entries` is the
// working copy of the manifest entries and is updated in place.
function planRecord(entries, { identity, sourceId, establishmentId, occurredAt, sourceUpdatedAt,
  receivedAt, evidenceId, payload }) {
  if (!/^[A-Za-z0-9._/-]{1,64}$/.test(sourceId || '')) throw fail('invalid_id');
  const record = normalizeSetaRecord({
    kind: identity.kind,
    id: `seta:${identity.companyId}:${identity.kind}:${sourceId}`,
    sourceId,
    tenantId: identity.tenantId,
    companyId: identity.companyId,
    establishmentId,
    occurredAt,
    sourceUpdatedAt,
    ingestedAt: receivedAt,
    evidenceIds: [evidenceId],
    payload
  });
  const previous = entries[sourceId];
  const action = decideSyncAction(previous ? { payload: { payloadHash: previous.payloadHash } } : null, record);
  if (action === 'IGNORE_IDENTICAL') return null;
  const version = (previous?.version || 0) + 1;
  entries[sourceId] = { payloadHash: record.payload.payloadHash, version, sourceUpdatedAt };
  return Object.freeze({ action, version, record });
}

// Remembered input hashes (files or API pages), newest last, bounded.
function remember(list, hash) {
  return [...(list || []), hash].slice(-MAX_REMEMBERED);
}

module.exports = {
  MANIFEST_VERSION,
  MAX_REMEMBERED,
  fail,
  emptyManifest,
  validateManifest,
  planRecord,
  remember
};
