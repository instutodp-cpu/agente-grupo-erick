'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateExecutionAuthorizationRequest } = require('./execution-authorization-request');
const { validateExecutionAuthorizationPolicy } = require('./execution-authorization-policy');
const { validateExecutionAuthorizationScope } = require('./execution-authorization-scope');
const { validateExecutionAuthorizationActorContext } = require('./execution-authorization-actor-context');
const { validateExecutionAuthorizationApprovalReference } = require('./execution-authorization-approval-reference');
const { validateExecutionAuthorizationBudgetReference } = require('./execution-authorization-budget-reference');
const { validateExecutionAuthorizationExpiration } = require('./execution-authorization-expiration');
const { validateExecutionAuthorizationDecision } = require('./execution-authorization-decision');

const EXECUTION_AUTHORIZATION_REGISTRY_VALIDATOR_VERSION = 'execution_authorization_registry_validator_v1';
const EXECUTION_AUTHORIZATION_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const EXECUTION_AUTHORIZATION_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...EXECUTION_AUTHORIZATION_REGISTRY_SAFE_FLAGS });
}

function resolveRegistration(existing, id, payload, rawVersion, options, idLabel) {
  const hasVersionField = rawVersion !== undefined;
  const version = hasVersionField ? rawVersion : NO_VERSION_FIELD_SENTINEL;
  if (existing) {
    if (existing.tenant_id !== undefined && existing.tenant_id !== payload.tenant_id) {
      return { ok: false, status: 'TENANT_BLOCKED', errors: [`${idLabel}_tenant_reassignment_blocked`] };
    }
    if (existing.organization_id !== undefined && existing.organization_id !== payload.organization_id) {
      return { ok: false, status: 'ORGANIZATION_BLOCKED', errors: [`${idLabel}_organization_reassignment_blocked`] };
    }
    if (existing.fingerprint === payload.fingerprint) {
      return { ok: true, status: 'REPLAY_ACCEPTED', id, version: existing.version, fingerprint: payload.fingerprint };
    }
    if (!hasVersionField) {
      return { ok: false, status: 'PAYLOAD_MISMATCH', errors: [`${idLabel}_payload_mismatch`] };
    }
    if (version === existing.version) {
      return { ok: false, status: 'PAYLOAD_MISMATCH', errors: [`${idLabel}_payload_mismatch`] };
    }
    if (options.expected_version !== undefined && options.expected_version !== existing.version) {
      return { ok: false, status: 'VERSION_CONFLICT', errors: [`${idLabel}_optimistic_conflict`] };
    }
    if (options.expected_fingerprint !== undefined && options.expected_fingerprint !== existing.fingerprint) {
      return { ok: false, status: 'FINGERPRINT_CONFLICT', errors: [`${idLabel}_fingerprint_conflict`] };
    }
    if (version < existing.version) {
      return { ok: false, status: 'VERSION_CONFLICT', errors: [`${idLabel}_version_downgrade`] };
    }
    return { ok: true, status: 'REGISTERED_SIMULATION', id, version, fingerprint: payload.fingerprint };
  }
  if (hasVersionField && options.expected_version !== undefined && options.expected_version !== 0) {
    return { ok: false, status: 'VERSION_CONFLICT', errors: [`${idLabel}_optimistic_conflict`] };
  }
  return { ok: true, status: 'REGISTERED_SIMULATION', id, version, fingerprint: payload.fingerprint };
}

function createEntityStore(config) {
  const { idField, tenantField, organizationField, versionField, validate, idLabel } = config;
  const byId = new Map();

  function register(record, options = {}) {
    const validation = validate(record);
    if (!validation.valid) return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    let fingerprint;
    try {
      fingerprint = stablePayload(record);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const id = record[idField];
    const tenantId = tenantField ? record[tenantField] : undefined;
    const organizationId = organizationField ? record[organizationField] : undefined;
    const version = versionField ? record[versionField] : undefined;
    const existing = byId.get(id);
    const resolution = resolveRegistration(
      existing,
      id,
      { tenant_id: tenantId, organization_id: organizationId, fingerprint },
      version,
      options,
      idLabel
    );
    if (resolution.ok) {
      byId.set(id, { record: cloneFrozen(record), fingerprint, tenant_id: tenantId, organization_id: organizationId, version: resolution.version });
    }
    return safe(resolution);
  }

  function getById(id) {
    if (!isNonEmptyString(id)) return null;
    const entry = byId.get(id);
    return entry ? cloneFrozen(entry.record) : null;
  }

  function listAll(predicate) {
    const results = [];
    for (const entry of byId.values()) {
      if (typeof predicate === 'function' && !predicate(entry.record)) continue;
      results.push(cloneFrozen(entry.record));
      if (results.length >= MAX_LIST_RESULTS) break;
    }
    return results.sort((a, b) => (a[idField] < b[idField] ? -1 : a[idField] > b[idField] ? 1 : 0));
  }

  function listByTenant(tenantId, predicate) {
    if (!tenantField || !isNonEmptyString(tenantId)) return [];
    return listAll((record) => record[tenantField] === tenantId && (typeof predicate !== 'function' || predicate(record)));
  }

  function listByOrganization(organizationId, predicate) {
    if (!organizationField || !isNonEmptyString(organizationId)) return [];
    return listAll((record) => record[organizationField] === organizationId && (typeof predicate !== 'function' || predicate(record)));
  }

  return Object.freeze({ register, getById, listAll, listByTenant, listByOrganization });
}

function createExecutionAuthorizationRegistry() {
  const requestStore = createEntityStore({
    idField: 'authorization_request_id', versionField: 'authorization_request_version',
    validate: validateExecutionAuthorizationRequest, idLabel: 'authorization_request'
  });
  const policyStore = createEntityStore({
    idField: 'authorization_policy_id', versionField: 'authorization_policy_version',
    validate: validateExecutionAuthorizationPolicy, idLabel: 'authorization_policy'
  });
  const scopeStore = createEntityStore({
    idField: 'scope_id', versionField: 'scope_version', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateExecutionAuthorizationScope, idLabel: 'authorization_scope'
  });
  const actorStore = createEntityStore({
    idField: 'actor_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateExecutionAuthorizationActorContext, idLabel: 'actor_context'
  });
  const approvalStore = createEntityStore({
    idField: 'approval_reference_id', versionField: 'approval_reference_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateExecutionAuthorizationApprovalReference, idLabel: 'approval_reference'
  });
  const budgetStore = createEntityStore({
    idField: 'budget_authorization_id', versionField: 'budget_authorization_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateExecutionAuthorizationBudgetReference, idLabel: 'budget_authorization'
  });
  const expirationStore = createEntityStore({
    idField: 'expiration_evaluation_id', validate: validateExecutionAuthorizationExpiration, idLabel: 'expiration_evaluation'
  });
  const decisionStore = createEntityStore({
    idField: 'authorization_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateExecutionAuthorizationDecision, idLabel: 'authorization_decision'
  });

  return Object.freeze({
    registerAuthorizationRequest: requestStore.register,
    getAuthorizationRequestById: requestStore.getById,

    registerAuthorizationPolicy: policyStore.register,
    getAuthorizationPolicyById: policyStore.getById,

    registerAuthorizationScope: scopeStore.register,
    getAuthorizationScopeById: scopeStore.getById,
    listAuthorizationScopesByTenant: scopeStore.listByTenant,

    registerActorContext: actorStore.register,
    getActorContextById: actorStore.getById,
    listActorContextsByTenant: actorStore.listByTenant,

    registerApprovalReference: approvalStore.register,
    getApprovalReferenceById: approvalStore.getById,
    listApprovalReferencesByTenant: approvalStore.listByTenant,

    registerBudgetAuthorization: budgetStore.register,
    getBudgetAuthorizationById: budgetStore.getById,
    listBudgetAuthorizationsByTenant: budgetStore.listByTenant,

    registerExpirationEvaluation: expirationStore.register,
    getExpirationEvaluationById: expirationStore.getById,

    registerAuthorizationDecision: decisionStore.register,
    getAuthorizationDecisionById: decisionStore.getById,
    listAuthorizationDecisionsByTenant: decisionStore.listByTenant,
    listAuthorizationDecisionsByOrganization: decisionStore.listByOrganization
  });
}

module.exports = {
  EXECUTION_AUTHORIZATION_REGISTRY_SAFE_FLAGS,
  EXECUTION_AUTHORIZATION_REGISTRY_STATUSES,
  EXECUTION_AUTHORIZATION_REGISTRY_VALIDATOR_VERSION,
  MAX_LIST_RESULTS,
  createExecutionAuthorizationRegistry
};
