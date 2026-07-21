'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateModelProviderContract } = require('./model-provider-contract');
const { validateModelContract } = require('./model-contract');
const { validateModelCapabilityContract } = require('./model-capability-contract');
const { validateModelPricingContract } = require('./model-pricing-contract');
const { validateModelLimitsContract } = require('./model-limits-contract');
const { validateModelAvailabilityContract } = require('./model-availability-contract');
const { validateModelPrivacyContract } = require('./model-privacy-contract');
const { validateModelHealthContract } = require('./model-health-contract');

const MODEL_PROVIDER_REGISTRY_VALIDATOR_VERSION = 'model_provider_registry_validator_v1';
const MODEL_PROVIDER_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'ITEM_CONFLICT'
]);
const FORBIDDEN_MODEL_PROVIDER_REGISTRY_STATUSES = Object.freeze(['CONNECTED_REAL', 'LOADED_REAL']);
const MODEL_PROVIDER_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...MODEL_PROVIDER_REGISTRY_SAFE_FLAGS });
}

function createEntityStore(config) {
  const { idField, tenantField, organizationField, versionField, validate, extraConflictCheck } = config;
  const byId = new Map();

  function register(record, options = {}) {
    const validation = validate(record);
    if (!validation.valid) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    }
    let payload;
    try {
      payload = stablePayload(record);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const id = record[idField];
    const tenantId = tenantField ? record[tenantField] : undefined;
    const organizationId = organizationField ? record[organizationField] : undefined;
    const version = versionField ? record[versionField] : 1;
    const existing = byId.get(id);

    if (existing) {
      if (tenantField && existing.tenant_id !== tenantId) {
        return safe({ ok: false, status: 'TENANT_BLOCKED', errors: [`${idField}_tenant_reassignment_blocked`] });
      }
      if (organizationField && existing.organization_id !== organizationId) {
        return safe({ ok: false, status: 'ORGANIZATION_BLOCKED', errors: [`${idField}_organization_reassignment_blocked`] });
      }
      if (extraConflictCheck) {
        const conflictReason = extraConflictCheck(existing.record, record);
        if (conflictReason) {
          return safe({ ok: false, status: 'ITEM_CONFLICT', errors: [conflictReason] });
        }
      }
      if (existing.fingerprint === payload) {
        return safe({ ok: true, status: 'REPLAY_ACCEPTED', id, version: existing.version, fingerprint: payload });
      }
      if (!versionField) {
        return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: [`${idField}_payload_mismatch`] });
      }
      if (version === existing.version) {
        return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: [`${idField}_payload_mismatch`] });
      }
      if (options.expected_version !== undefined && options.expected_version !== existing.version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: [`${idField}_optimistic_conflict`] });
      }
      if (options.expected_fingerprint !== undefined && options.expected_fingerprint !== existing.fingerprint) {
        return safe({ ok: false, status: 'FINGERPRINT_CONFLICT', errors: [`${idField}_fingerprint_conflict`] });
      }
      if (version < existing.version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: [`${idField}_version_downgrade`] });
      }
      const stored = cloneFrozen(record);
      byId.set(id, { record: stored, fingerprint: payload, tenant_id: tenantId, organization_id: organizationId, version });
      return safe({ ok: true, status: 'REGISTERED_SIMULATION', id, version, fingerprint: payload });
    }

    if (versionField && options.expected_version !== undefined && options.expected_version !== 0) {
      return safe({ ok: false, status: 'VERSION_CONFLICT', errors: [`${idField}_optimistic_conflict`] });
    }
    const stored = cloneFrozen(record);
    byId.set(id, { record: stored, fingerprint: payload, tenant_id: tenantId, organization_id: organizationId, version });
    return safe({ ok: true, status: 'REGISTERED_SIMULATION', id, version, fingerprint: payload });
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

  return Object.freeze({ register, getById, listAll, listByTenant });
}

function createModelProviderRegistry() {
  const providerStore = createEntityStore({
    idField: 'provider_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    versionField: 'provider_version', validate: validateModelProviderContract
  });
  const modelStore = createEntityStore({
    idField: 'model_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    versionField: 'model_version', validate: validateModelContract,
    extraConflictCheck: (existing, next) => (existing.provider_id !== next.provider_id ? 'model_provider_reassignment_blocked' : null)
  });
  const capabilityStore = createEntityStore({ idField: 'capability_id', versionField: 'capability_version', validate: validateModelCapabilityContract });
  const pricingStore = createEntityStore({ idField: 'pricing_id', versionField: 'pricing_version', validate: validateModelPricingContract });
  const limitsStore = createEntityStore({ idField: 'limits_id', validate: validateModelLimitsContract });
  const availabilityStore = createEntityStore({ idField: 'availability_id', validate: validateModelAvailabilityContract });
  const privacyStore = createEntityStore({ idField: 'privacy_id', validate: validateModelPrivacyContract });
  const healthStore = createEntityStore({ idField: 'health_id', validate: validateModelHealthContract });

  function registerProvider(provider, options = {}) {
    return providerStore.register(provider, options);
  }

  function registerModel(model, options = {}) {
    if (!isPlainObject(model) || !isNonEmptyString(model.provider_id) || !providerStore.getById(model.provider_id)) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: ['model_provider_not_registered'] });
    }
    return modelStore.register(model, options);
  }

  function registerLeafRecord(store, record, options = {}) {
    if (!isPlainObject(record) || !isNonEmptyString(record.provider_id) || !providerStore.getById(record.provider_id)) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: ['leaf_record_provider_not_registered'] });
    }
    if (!isNonEmptyString(record.model_id) || !modelStore.getById(record.model_id)) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: ['leaf_record_model_not_registered'] });
    }
    return store.register(record, options);
  }

  function registerCapability(capability, options = {}) {
    return registerLeafRecord(capabilityStore, capability, options);
  }
  function registerPricing(pricing, options = {}) {
    return registerLeafRecord(pricingStore, pricing, options);
  }
  function registerLimits(limits, options = {}) {
    return registerLeafRecord(limitsStore, limits, options);
  }
  function registerAvailability(availability, options = {}) {
    return registerLeafRecord(availabilityStore, availability, options);
  }
  function registerPrivacy(privacy, options = {}) {
    return registerLeafRecord(privacyStore, privacy, options);
  }
  function registerHealth(health, options = {}) {
    return registerLeafRecord(healthStore, health, options);
  }

  function getProviderById(providerId) {
    return providerStore.getById(providerId);
  }
  function getModelById(modelId) {
    return modelStore.getById(modelId);
  }
  function getCapabilityById(capabilityId) {
    return capabilityStore.getById(capabilityId);
  }
  function getPricingById(pricingId) {
    return pricingStore.getById(pricingId);
  }
  function getLimitsById(limitsId) {
    return limitsStore.getById(limitsId);
  }
  function getAvailabilityById(availabilityId) {
    return availabilityStore.getById(availabilityId);
  }
  function getPrivacyById(privacyId) {
    return privacyStore.getById(privacyId);
  }
  function getHealthById(healthId) {
    return healthStore.getById(healthId);
  }

  function listProvidersByTenant(tenantId, filters = {}) {
    const organizationId = isPlainObject(filters) && isNonEmptyString(filters.organization_id) ? filters.organization_id : null;
    const providerType = isPlainObject(filters) && isNonEmptyString(filters.provider_type) ? filters.provider_type : null;
    return providerStore.listByTenant(tenantId, (record) => {
      if (organizationId && record.organization_id !== organizationId) return false;
      if (providerType && record.provider_type !== providerType) return false;
      return true;
    });
  }

  function listModelsByTenant(tenantId, filters = {}) {
    const organizationId = isPlainObject(filters) && isNonEmptyString(filters.organization_id) ? filters.organization_id : null;
    const providerId = isPlainObject(filters) && isNonEmptyString(filters.provider_id) ? filters.provider_id : null;
    const qualityTier = isPlainObject(filters) && isNonEmptyString(filters.quality_tier) ? filters.quality_tier : null;
    const costTier = isPlainObject(filters) && isNonEmptyString(filters.cost_tier) ? filters.cost_tier : null;
    const privacyTier = isPlainObject(filters) && isNonEmptyString(filters.privacy_tier) ? filters.privacy_tier : null;
    const modality = isPlainObject(filters) && isNonEmptyString(filters.modality) ? filters.modality : null;
    const capabilityType = isPlainObject(filters) && isNonEmptyString(filters.capability_type) ? filters.capability_type : null;
    return modelStore.listByTenant(tenantId, (record) => {
      if (organizationId && record.organization_id !== organizationId) return false;
      if (providerId && record.provider_id !== providerId) return false;
      if (qualityTier && record.quality_tier !== qualityTier) return false;
      if (costTier && record.cost_tier !== costTier) return false;
      if (privacyTier && record.privacy_tier !== privacyTier) return false;
      if (modality && !record.supported_modalities.includes(modality)) return false;
      if (capabilityType) {
        const hasCapability = capabilityStore.listAll((capability) => capability.model_id === record.model_id && capability.capability_type === capabilityType).length > 0;
        if (!hasCapability) return false;
      }
      return true;
    });
  }

  return Object.freeze({
    registerProvider,
    registerModel,
    registerCapability,
    registerPricing,
    registerLimits,
    registerAvailability,
    registerPrivacy,
    registerHealth,
    getProviderById,
    getModelById,
    getCapabilityById,
    getPricingById,
    getLimitsById,
    getAvailabilityById,
    getPrivacyById,
    getHealthById,
    listProvidersByTenant,
    listModelsByTenant
  });
}

module.exports = {
  FORBIDDEN_MODEL_PROVIDER_REGISTRY_STATUSES,
  MAX_LIST_RESULTS,
  MODEL_PROVIDER_REGISTRY_SAFE_FLAGS,
  MODEL_PROVIDER_REGISTRY_STATUSES,
  MODEL_PROVIDER_REGISTRY_VALIDATOR_VERSION,
  createModelProviderRegistry
};
