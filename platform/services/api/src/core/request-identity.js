'use strict';

const { MachineIdentityError } = require('./machine-identity-registry');
const { resolveMachineIdentity } = require('./machine-identity-resolver');

const REQUEST_IDENTITY_CONTRACT_VERSION = 'hermes-request-identity-v1';
const REQUEST_IDENTITY_MODES = Object.freeze({
  PUBLIC: 'public',
  OPTIONAL_IDENTITY: 'optional_identity',
  REQUIRED_IDENTITY: 'required_identity'
});

class RequestIdentityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RequestIdentityError';
    this.code = code;
  }
}

function ensureRequest(req) {
  if (!req || typeof req !== 'object') throw new RequestIdentityError('INVALID_REQUEST');
}

function currentIdentity(req) {
  return req.context && Object.prototype.hasOwnProperty.call(req.context, 'identity')
    ? req.context.identity
    : undefined;
}

function setIdentityContext(req, identity) {
  const existing = req.context && typeof req.context === 'object' ? req.context : {};
  req.context = Object.freeze({
    ...existing,
    identity: identity || null
  });
  return req.context;
}

function attachRequestIdentity(req, { mode = REQUEST_IDENTITY_MODES.PUBLIC, registry } = {}) {
  ensureRequest(req);

  const alreadyResolved = currentIdentity(req);
  if (alreadyResolved !== undefined) return req.context;

  if (!Object.values(REQUEST_IDENTITY_MODES).includes(mode)) {
    throw new RequestIdentityError('INVALID_IDENTITY_MODE');
  }

  if (mode === REQUEST_IDENTITY_MODES.PUBLIC) return setIdentityContext(req, null);

  const authorization = req.headers && req.headers.authorization;
  if (authorization === undefined && mode === REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY) {
    return setIdentityContext(req, null);
  }

  try {
    const identity = resolveMachineIdentity({ authorization }, registry);
    return setIdentityContext(req, identity);
  } catch (error) {
    if (error instanceof MachineIdentityError) throw error;
    throw new RequestIdentityError('IDENTITY_RESOLUTION_FAILED');
  }
}

function getRequestIdentity(req) {
  ensureRequest(req);
  return currentIdentity(req) || null;
}

function requireRequestIdentity(req) {
  const identity = getRequestIdentity(req);
  if (!identity) throw new RequestIdentityError('IDENTITY_REQUIRED');
  return identity;
}

module.exports = {
  REQUEST_IDENTITY_CONTRACT_VERSION,
  REQUEST_IDENTITY_MODES,
  RequestIdentityError,
  attachRequestIdentity,
  getRequestIdentity,
  requireRequestIdentity
};
