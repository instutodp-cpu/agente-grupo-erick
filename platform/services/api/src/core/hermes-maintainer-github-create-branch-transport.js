'use strict';

const CONTRACT_VERSION = 'hermes_maintainer_github_create_branch_transport_v1';
const PROVIDER = 'GITHUB';
const METHOD = 'POST';
const REPOSITORY = 'instutodp-cpu/agente-grupo-erick';
const URL = `https://api.github.com/repos/${REPOSITORY}/git/refs`;
const AUTHORIZATION_REFERENCE = 'github_create_branch_staging';
const OWNERSHIP_SOURCE = 'DURABLE_PERSISTENCE_RECEIPT';

const REQUEST_FIELDS = Object.freeze([
  'method',
  'url',
  'body',
  'ownership_source',
  'ownership_key',
  'persistence_key',
  'intent_digest',
  'attempt_reference',
  'capability_reference',
  'admission_reference'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyFields(value, fields) {
  if (!isObject(value)) return false;
  const allowed = new Set(fields);
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => allowed.has(key));
}

function validBranchRef(value) {
  return typeof value === 'string' &&
    /^refs\/heads\/hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(value) &&
    !value.includes('..');
}

function validRequest(request) {
  if (!hasOnlyFields(request, REQUEST_FIELDS)) return false;
  if (request.method !== METHOD || request.url !== URL) return false;
  if (!hasOnlyFields(request.body, ['ref', 'sha'])) return false;
  if (!validBranchRef(request.body.ref) || !/^[a-f0-9]{40}$/.test(request.body.sha)) return false;
  if (request.ownership_source !== OWNERSHIP_SOURCE) return false;
  if (!isNonEmptyString(request.persistence_key) ||
      request.ownership_key !== `${request.persistence_key}::attempt-ownership`) return false;
  if (!/^sha256:[0-9a-f]{64}$/.test(request.intent_digest)) return false;
  return ['attempt_reference', 'capability_reference', 'admission_reference']
    .every((field) => isNonEmptyString(request[field]));
}

function safeResult(fields) {
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    provider: PROVIDER,
    method: METHOD,
    url: URL,
    created: false,
    status: 'BLOCKED',
    reason: null,
    provider_status: null,
    authorization_header_present: false,
    credential_material_present: false,
    network_call_performed: false,
    write_performed: false,
    production_used: false,
    response_body_present: false,
    ...fields
  });
}

function createHermesMaintainerGithubCreateBranchTransport({ fetchImpl, resolveAuthorization } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl_required');
  if (typeof resolveAuthorization !== 'function') throw new TypeError('resolveAuthorization_required');

  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    provider: PROVIDER,
    method: METHOD,
    url: URL,
    authorization_reference: AUTHORIZATION_REFERENCE,
    async createBranch(request) {
      if (!validRequest(request)) {
        return safeResult({ reason: 'REQUEST_INVALID' });
      }

      let resolution;
      try {
        resolution = await resolveAuthorization(AUTHORIZATION_REFERENCE);
      } catch {
        return safeResult({ reason: 'AUTHORIZATION_UNAVAILABLE' });
      }

      const authorization = resolution?.ok === true &&
        typeof resolution.authorization === 'string' &&
        resolution.authorization.trim().length > 0
        ? resolution.authorization
        : null;
      if (!authorization) {
        return safeResult({ reason: 'AUTHORIZATION_UNAVAILABLE' });
      }

      let response;
      try {
        response = await fetchImpl(URL, {
          method: METHOD,
          redirect: 'error',
          headers: {
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: authorization
          },
          body: JSON.stringify(request.body)
        });
      } catch {
        return safeResult({
          status: 'FAILED',
          reason: 'PROVIDER_REQUEST_FAILED',
          network_call_performed: true,
          authorization_header_present: true
        });
      }

      const providerStatus = Number.isInteger(response?.status) ? response.status : null;
      if (providerStatus === 201) {
        return safeResult({
          status: 'CREATED',
          created: true,
          provider_status: providerStatus,
          authorization_header_present: true,
          network_call_performed: true
        });
      }

      return safeResult({
        status: 'FAILED',
        reason: 'CREATE_BRANCH_NOT_CONFIRMED',
        provider_status: providerStatus,
        authorization_header_present: true,
        network_call_performed: true
      });
    }
  });
}

module.exports = {
  AUTHORIZATION_REFERENCE,
  CONTRACT_VERSION,
  METHOD,
  OWNERSHIP_SOURCE,
  PROVIDER,
  REPOSITORY,
  URL,
  createHermesMaintainerGithubCreateBranchTransport
};
