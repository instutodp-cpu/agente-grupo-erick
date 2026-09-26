'use strict';

const {
  isPlainObject,
  isNonEmptyString
} = require('./read-only-adapter-contract');
const {
  validateHermesMaintainerReadRuntimeAuthorization
} = require('./hermes-maintainer-read-runtime-authorization');

const CONTRACT_VERSION = 'hermes_maintainer_repository_read_boundary_v1';
const MAX_CONTENT_BYTES = 1024 * 1024;
const REQUEST_FIELDS = Object.freeze(['repository', 'ref', 'path']);

function result(outcome, providerCalled, executionPerformed, data, blocker) {
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    outcome,
    read_only: true,
    provider_called: providerCalled === true,
    execution_performed: executionPerformed === true,
    write_performed: false,
    production_used: false,
    data: data || null,
    blockers: Object.freeze(blocker ? [blocker] : [])
  });
}

function validateRepositoryPath(path) {
  if (!isNonEmptyString(path) || path.length > 4096) return false;
  if (/^[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('//')) return false;
  if (/[\u0000-\u001f\u007f\\?#]/.test(path)) return false;
  if (/%(?:2e|2f|5c)/i.test(path)) return false;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  if (path.includes('..')) return false;
  try {
    if (new URL(path).protocol) return false;
  } catch (_error) {
    // Repository paths are relative strings, not URLs.
  }
  return true;
}

function validateAuthorization(authorization) {
  const official = validateHermesMaintainerReadRuntimeAuthorization(authorization);
  if (!official.valid || !isPlainObject(authorization)) return false;
  return authorization.operation === 'repository_read' &&
    authorization.provider === 'GITHUB' &&
    authorization.trusted_adapter_id === 'github_read_only_staging' &&
    authorization.environment === 'staging' &&
    authorization.read_only === true &&
    authorization.credential_resolution_authorized === true &&
    authorization.network_authorized === true &&
    authorization.credentials_authorized === true &&
    authorization.execution_allowed === true &&
    authorization.write_authorized === false &&
    authorization.provider_called === false &&
    authorization.execution_performed === false &&
    authorization.production_allowed === false &&
    Array.isArray(authorization.blockers) &&
    authorization.blockers.length === 0;
}

function validateRequest(authorization, request) {
  if (!isPlainObject(request)) return false;
  const fields = Object.keys(request);
  if (fields.length !== REQUEST_FIELDS.length || fields.some((field) => !REQUEST_FIELDS.includes(field))) return false;
  return request.repository === authorization.repository &&
    request.ref === authorization.base_ref &&
    validateRepositoryPath(request.path);
}

function sanitizeReaderData(request, raw) {
  if (!isPlainObject(raw) || raw.ok !== true || typeof raw.content !== 'string') return null;
  if (Buffer.byteLength(raw.content, 'utf8') > MAX_CONTENT_BYTES) return null;
  return Object.freeze({
    path: request.path,
    content: raw.content,
    sha: typeof raw.sha === 'string' ? raw.sha : null
  });
}

async function invokeHermesMaintainerRepositoryReadBoundary(authorization, request, reader) {
  if (!validateAuthorization(authorization)) return result('BLOCKED', false, false, null, 'AUTHORIZATION_INVALID');
  if (!validateRequest(authorization, request)) return result('BLOCKED', false, false, null, 'REQUEST_SCOPE_INVALID');
  if (!reader || typeof reader.readRepositoryPath !== 'function') return result('BLOCKED', false, false, null, 'TRUSTED_READER_UNAVAILABLE');

  const readerRequest = Object.freeze({
    provider: 'GITHUB',
    repository: authorization.repository,
    ref: authorization.base_ref,
    path: request.path,
    method: 'GET',
    read_only: true
  });

  let raw;
  try {
    raw = await reader.readRepositoryPath(readerRequest);
  } catch (_error) {
    return result('FAILED', true, true, null, 'READER_INVOCATION_FAILED');
  }

  let data;
  try {
    data = sanitizeReaderData(request, raw);
  } catch (_error) {
    data = null;
  }
  if (!data) return result('FAILED', true, true, null, 'READER_RESPONSE_INVALID');
  return result('SUCCEEDED', true, true, data, null);
}

module.exports = {
  CONTRACT_VERSION,
  MAX_CONTENT_BYTES,
  invokeHermesMaintainerRepositoryReadBoundary,
  validateRepositoryPath
};
