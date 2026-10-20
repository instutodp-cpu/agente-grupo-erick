'use strict';

const crypto = require('node:crypto');

const INTEGRITY_STATUSES = Object.freeze(['UNVERIFIED','VERIFIED','INVALID','CONFLICT']);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
}

function stableHash(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function createEvidence(input = {}) {
  for (const field of ['evidenceId','tenantId','companyId','sourceSystem','sourceType','sourceReference','documentType','occurredAt','receivedAt','schemaVersion']) {
    required(input[field], field);
  }
  const integrityStatus = input.integrityStatus ?? 'UNVERIFIED';
  if (!INTEGRITY_STATUSES.includes(integrityStatus)) throw new Error('unsupported integrityStatus');

  const originalPayload = input.originalPayload ?? null;
  const documentHash = input.documentHash ?? stableHash(originalPayload);

  return Object.freeze({
    evidenceId: input.evidenceId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    sourceSystem: input.sourceSystem,
    sourceType: input.sourceType,
    sourceReference: input.sourceReference,
    documentType: input.documentType,
    documentNumber: input.documentNumber ?? null,
    documentHash,
    originalPayload,
    normalizedPayload: input.normalizedPayload ?? null,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    competence: input.competence ?? null,
    schemaVersion: input.schemaVersion,
    ruleVersion: input.ruleVersion ?? null,
    createdBy: input.createdBy ?? 'system',
    verifiedBy: input.verifiedBy ?? null,
    integrityStatus
  });
}

function sameEvidenceIdentity(a, b) {
  return a.sourceSystem === b.sourceSystem &&
    a.sourceReference === b.sourceReference &&
    a.documentHash === b.documentHash;
}

module.exports = { INTEGRITY_STATUSES, stableHash, createEvidence, sameEvidenceIdentity };
