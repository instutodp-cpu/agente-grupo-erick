'use strict';

const { createHash } = require('crypto');
const { MachineIdentityError } = require('./machine-identity-registry');

const MAX_CREDENTIAL_LENGTH = 4096;
const BEARER_SCHEME = /^Bearer ([^\s]+)$/i;

function resolveMachineIdentity({ authorization } = {}, registry) {
  if (!registry || typeof registry.findByDigest !== 'function') {
    throw new MachineIdentityError('INVALID_IDENTITY_REGISTRY');
  }

  if (authorization === undefined || authorization === null) {
    throw new MachineIdentityError('MISSING_CREDENTIAL');
  }
  if (typeof authorization !== 'string' || authorization.length > MAX_CREDENTIAL_LENGTH) {
    throw new MachineIdentityError('MALFORMED_CREDENTIAL');
  }

  const match = BEARER_SCHEME.exec(authorization);
  if (!match) throw new MachineIdentityError('MALFORMED_CREDENTIAL');

  const credential = match[1];
  const digest = createHash('sha256').update(credential, 'utf8').digest();
  const record = registry.findByDigest(digest);

  if (!record) throw new MachineIdentityError('UNKNOWN_CREDENTIAL');
  if (!record.active) throw new MachineIdentityError('INACTIVE_CREDENTIAL');
  if (typeof record.tenant_id !== 'string' || record.tenant_id.trim() === '') {
    throw new MachineIdentityError('MISSING_TENANT_MAPPING');
  }

  return Object.freeze({
    principal: Object.freeze({
      type: 'machine',
      id: record.principal_id
    }),
    tenant_id: record.tenant_id,
    auth_source: 'machine_bearer',
    key_id: record.key_id
  });
}

module.exports = {
  MAX_CREDENTIAL_LENGTH,
  resolveMachineIdentity
};
