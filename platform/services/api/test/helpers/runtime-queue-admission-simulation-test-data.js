'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeQueueAdmissionRequest bundle
// on top of PR #107's own golden RuntimeDispatchRequest bundle -- the already-
// DISPATCH_PACKAGE_PREPARED_SIMULATION chain plus a single deterministic, generously-capacitied
// SHARED Queue Class compatible with the golden bundle's own (deterministic, no-LLM) stage
// composition.
const { buildGoldenDispatchBundle, evaluateRuntimeDispatchRequest } = require('./runtime-dispatch-simulation-test-data');
// pr108fix3 FIX 2: the same canonical, reused-verbatim official Registry Snapshot the Worker
// Assignment layer already builds for Stage Policy Requirement provenance (pr106fix5) -- now also
// wired into the Worker Assignment Request's own `registry_snapshot_reference` AND the Dispatch
// Request's own `registry_snapshot_reference` (two structurally independent slots one layer apart),
// so the Dispatch Package's own `registry_snapshot_fingerprint` is genuinely populated, and the
// Queue Admission layer's own newly-mandatory Registry Snapshot check has a real, bound snapshot to
// validate -- never a placeholder.
const { buildOfficialRegistrySnapshot } = require('./runtime-worker-assignment-test-data');
const { buildRuntimeQueueAdmissionPolicy } = require('../../src/core/runtime-queue-admission-policy');
const { buildRuntimeQueueClassReference } = require('../../src/core/runtime-queue-class-reference');
const { buildRuntimeQueueCapacitySnapshotReference } = require('../../src/core/runtime-queue-capacity-snapshot-reference');
const { buildRuntimeQueueQuotaReference } = require('../../src/core/runtime-queue-quota-reference');
const { buildRuntimeQueueAdmissionReplayReference } = require('../../src/core/runtime-queue-admission-replay-reference');
const { buildRuntimeQueueAdmissionRequest, omitQueueAdmissionReplayReference } = require('../../src/core/runtime-queue-admission-request');
const { evaluateRuntimeQueueAdmissionRequest } = require('../../src/core/runtime-queue-admission-boundary');
const { computeCanonicalContentDigest } = require('../../src/core/canonical-content-digest');

const UPSTREAM_CACHEABLE_OVERRIDE_KEYS = Object.freeze(new Set(['policy', 'request', 'registrySnapshotRef']));
const upstreamFixtureCache = new Map();
const upstreamFixtureCacheStats = {
  cachedBuilds: 0,
  cacheHits: 0,
  uncachedBuilds: 0,
  cachedKeys: new Set()
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, nested] of value.entries()) {
      deepFreeze(key, seen);
      deepFreeze(nested, seen);
    }
  } else if (value instanceof Set) {
    for (const nested of value.values()) deepFreeze(nested, seen);
  } else {
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

function cloneFixture(value) {
  if (typeof structuredClone !== 'function') {
    throw new Error('structured_clone_required_for_queue_admission_upstream_fixture_cache');
  }
  return structuredClone(value);
}

function normalizeScenarioKey(scenarioKey) {
  return scenarioKey === undefined ? 'prepared-no-llm-plan' : scenarioKey;
}

function getQueueAdmissionUpstreamFixtureCacheKey(scenarioKey, overrides = {}) {
  const normalizedScenarioKey = normalizeScenarioKey(scenarioKey);
  if (typeof normalizedScenarioKey !== 'string' || normalizedScenarioKey.length === 0) return null;
  if (!isPlainObject(overrides)) return null;
  if (Object.keys(overrides).some((key) => !UPSTREAM_CACHEABLE_OVERRIDE_KEYS.has(key))) return null;
  if ('policy' in overrides && !isPlainObject(overrides.policy)) return null;
  if ('request' in overrides && !isPlainObject(overrides.request)) return null;

  if ('registrySnapshotRef' in overrides) {
    return overrides.registrySnapshotRef === null ? `scenario:${normalizedScenarioKey}|registry:null` : null;
  }
  return `scenario:${normalizedScenarioKey}|registry:default`;
}

function snapshotUpstreamFixtureCacheStats() {
  return {
    cachedBuilds: upstreamFixtureCacheStats.cachedBuilds,
    cacheHits: upstreamFixtureCacheStats.cacheHits,
    uncachedBuilds: upstreamFixtureCacheStats.uncachedBuilds,
    cachedKeys: [...upstreamFixtureCacheStats.cachedKeys].sort()
  };
}

function resetQueueAdmissionUpstreamFixtureCacheForTests() {
  upstreamFixtureCache.clear();
  upstreamFixtureCacheStats.cachedBuilds = 0;
  upstreamFixtureCacheStats.cacheHits = 0;
  upstreamFixtureCacheStats.uncachedBuilds = 0;
  upstreamFixtureCacheStats.cachedKeys.clear();
}

function buildGoldenQueueClassCatalog(baseId, canonical) {
  const queueClassId = `${baseId}-queue-class-shared`;
  const queueClass = buildRuntimeQueueClassReference({
    runtime_queue_class_reference_id: queueClassId,
    queue_class_name: 'golden-shared-queue-class',
    queue_class_type: 'SHARED_QUEUE_REFERENCE',
    queue_domain: 'GENERIC_DOMAIN',
    queue_priority_class: 'NORMAL_REFERENCE',
    queue_partition_strategy: 'TENANT_PARTITION_REFERENCE',
    queue_fairness_strategy: 'FIFO_WITHIN_PRIORITY_REFERENCE',
    queue_retry_class: 'NO_RETRY_REFERENCE',
    supports_no_llm: true, supports_model: true, supports_tool: true, supports_workflow: true,
    supports_parallel: true, supports_optional: true, supports_state_change: true,
    supported_stage_types: ['DETERMINISTIC_STAGE', 'MODEL_REFERENCE_STAGE', 'TOOL_REFERENCE_STAGE', 'WORKFLOW_REFERENCE_STAGE'],
    supported_capability_ids: [], supported_modality_ids: [], supported_model_provider_ids: [], supported_model_ids: [],
    supported_tool_ids: [], supported_workflow_ids: [],
    maximum_backlog_count: 1000, maximum_inflight_count: 1000, maximum_parallel_count: 100, maximum_model_count: 100,
    maximum_tool_count: 100, maximum_workflow_count: 100, maximum_tokens: 100000000, maximum_cost_minor_units: 100000000,
    maximum_logical_age_sequences: 100000,
    queue_class_active: true
  });

  const capacityId = `${baseId}-queue-capacity`;
  const capacitySnapshot = buildRuntimeQueueCapacitySnapshotReference({
    runtime_queue_capacity_snapshot_reference_id: capacityId,
    runtime_queue_class_reference_id: queueClassId,
    logical_sequence: 0,
    snapshot_valid_sequences: 100000,
    capacity_available: true,
    maximum_backlog_count: 1000, current_backlog_count: 0, available_backlog_count: 1000,
    maximum_inflight_count: 1000, current_inflight_count: 0, available_inflight_count: 1000,
    maximum_parallel_count: 100, current_parallel_count: 0, available_parallel_count: 100,
    maximum_model_count: 100, current_model_count: 0, available_model_count: 100,
    maximum_tool_count: 100, current_tool_count: 0, available_tool_count: 100,
    maximum_workflow_count: 100, current_workflow_count: 0, available_workflow_count: 100,
    maximum_tokens: 100000000, current_tokens: 0, available_tokens: 100000000,
    maximum_cost_minor_units: 100000000, current_cost_minor_units: 0, available_cost_minor_units: 100000000
  });

  // pr108fix FIX 2: a Queue Class candidate is only ever eligible with a COMPLETE
  // tenant+organization+project+agent quota collection -- one single-scope reference per scope,
  // all bound to the same class, all genuinely matching this bundle's own canonical identity.
  function buildScopedQuota(scopeType, scopeId) {
    return buildRuntimeQueueQuotaReference({
      runtime_queue_quota_reference_id: `${baseId}-queue-quota-${scopeType.toLowerCase()}`,
      runtime_queue_class_reference_id: queueClassId,
      tenant_id: scopeType === 'TENANT' ? scopeId : null,
      organization_id: scopeType === 'ORGANIZATION' ? scopeId : null,
      project_id: scopeType === 'PROJECT' ? scopeId : null,
      agent_id: scopeType === 'AGENT' ? scopeId : null,
      maximum_admission_count: 1000, current_admission_count: 0, available_admission_count: 1000,
      maximum_backlog_count: 1000, current_backlog_count: 0, available_backlog_count: 1000,
      maximum_parallel_count: 100, current_parallel_count: 0, available_parallel_count: 100,
      maximum_model_count: 100, current_model_count: 0, available_model_count: 100,
      maximum_tool_count: 100, current_tool_count: 0, available_tool_count: 100,
      maximum_workflow_count: 100, current_workflow_count: 0, available_workflow_count: 100,
      maximum_tokens: 100000000, current_tokens: 0, available_tokens: 100000000,
      maximum_cost_minor_units: 100000000, current_cost_minor_units: 0, available_cost_minor_units: 100000000
    });
  }
  const tenantQuota = buildScopedQuota('TENANT', canonical.tenantId);
  const organizationQuota = buildScopedQuota('ORGANIZATION', canonical.organizationId);
  const projectQuota = buildScopedQuota('PROJECT', canonical.projectId);
  const agentQuota = buildScopedQuota('AGENT', canonical.agentId);
  const quotas = [tenantQuota, organizationQuota, projectQuota, agentQuota];

  return { queueClass, capacitySnapshot, quota: tenantQuota, quotas };
}

function buildGoldenQueueAdmissionUpstreamFixture(scenarioKey = 'prepared-no-llm-plan', registrySnapshotRefOverride) {
  // pr108fix3 FIX 2: the SAME canonical official Registry Snapshot wired at both the Worker
  // Assignment layer's own `registry_snapshot_reference` and the Dispatch layer's own
  // `registry_snapshot_reference` (two independent slots one layer apart) -- the Dispatch boundary
  // already requires both to agree ("mesmo snapshot que o Worker Assignment Package já vinculou, ou
  // ausência consistente em ambas as camadas"), so both must carry the identical object for the
  // Dispatch Package to end up with a genuine (non-placeholder) `registry_snapshot_fingerprint`.
  const officialRegistrySnapshot = registrySnapshotRefOverride === undefined ? buildOfficialRegistrySnapshot() : registrySnapshotRefOverride;
  const dispatchOverrides = {
    registrySnapshotRef: officialRegistrySnapshot,
    workerAssignment: { registrySnapshotRef: officialRegistrySnapshot }
  };
  const dispatchGolden = buildGoldenDispatchBundle(scenarioKey, dispatchOverrides);
  const dispatchOutcome = evaluateRuntimeDispatchRequest(dispatchGolden.dispatchRequest, {});
  if (dispatchOutcome.decision.status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION') {
    throw new Error(`golden dispatch bundle for ${scenarioKey} did not reach DISPATCH_PACKAGE_PREPARED_SIMULATION: ${dispatchOutcome.decision.status}`);
  }

  const baseId = `${dispatchGolden.baseId}-queue-admission`;
  const requestId = `${baseId}-request`;

  const canonical = {
    tenantId: dispatchOutcome.package.tenant_id, organizationId: dispatchOutcome.package.organization_id,
    projectId: dispatchOutcome.package.project_id, agentId: dispatchOutcome.package.agent_id
  };

  const { queueClass, capacitySnapshot, quota, quotas } = buildGoldenQueueClassCatalog(baseId, canonical);

  return {
    ...dispatchGolden, dispatchOutcome, baseId, requestId, queueClass, capacitySnapshot, quota, quotas,
    registrySnapshotRef: officialRegistrySnapshot
  };
}

function getQueueAdmissionUpstreamFixture(scenarioKey, overrides = {}) {
  const key = getQueueAdmissionUpstreamFixtureCacheKey(scenarioKey, overrides);
  if (key === null) {
    upstreamFixtureCacheStats.uncachedBuilds += 1;
    return null;
  }

  if (!upstreamFixtureCache.has(key)) {
    const registrySnapshotRefOverride = overrides.registrySnapshotRef === null ? null : undefined;
    const upstreamFixture = buildGoldenQueueAdmissionUpstreamFixture(normalizeScenarioKey(scenarioKey), registrySnapshotRefOverride);
    upstreamFixtureCache.set(key, deepFreeze(cloneFixture(upstreamFixture)));
    upstreamFixtureCacheStats.cachedBuilds += 1;
    upstreamFixtureCacheStats.cachedKeys.add(key);
  } else {
    upstreamFixtureCacheStats.cacheHits += 1;
  }

  return cloneFixture(upstreamFixtureCache.get(key));
}

function buildGoldenQueueAdmissionBundleFromUpstream(upstreamFixture, overrides = {}) {
  const registrySnapshotRef = upstreamFixture.registrySnapshotRef;

  function buildRequestWith(queueAdmissionReplayRef) {
    return buildRuntimeQueueAdmissionRequest({
      runtime_queue_admission_request_id: upstreamFixture.requestId,
      runtime_queue_admission_policy: policy,
      runtime_dispatch_request_reference: upstreamFixture.dispatchRequest,
      runtime_dispatch_decision_reference: upstreamFixture.dispatchOutcome.decision,
      runtime_dispatch_result_reference: upstreamFixture.dispatchOutcome.result,
      runtime_dispatch_package_reference: upstreamFixture.dispatchOutcome.package,
      runtime_dispatch_stage_references: upstreamFixture.dispatchOutcome.dispatchStageRefs,
      runtime_dispatch_worker_binding_references: upstreamFixture.dispatchOutcome.workerBindingRefs,
      runtime_dispatch_dependency_gate_references: upstreamFixture.dispatchOutcome.dependencyGateRefs,
      runtime_dispatch_approval_gate_references: upstreamFixture.dispatchOutcome.approvalGateRefs,
      runtime_dispatch_capacity_references: upstreamFixture.dispatchOutcome.capacityRefs,
      runtime_dispatch_budget_references: upstreamFixture.dispatchOutcome.budgetRefs,
      runtime_dispatch_payload_references: upstreamFixture.dispatchOutcome.payloadRefs,
      runtime_dispatch_intent_references: upstreamFixture.dispatchOutcome.intentRefs,
      runtime_dispatch_order_reference: upstreamFixture.dispatchOutcome.orderRef,
      runtime_dispatch_replay_reference: upstreamFixture.dispatchReplayRef,
      runtime_queue_class_references: [upstreamFixture.queueClass],
      runtime_queue_capacity_snapshot_references: [upstreamFixture.capacitySnapshot],
      runtime_queue_quota_references: upstreamFixture.quotas,
      runtime_queue_partition_references: [],
      official_model_selection_decision_references: [],
      runtime_capacity_snapshot_reference: upstreamFixture.capacitySnapshotRef,
      runtime_concurrency_reference: upstreamFixture.concurrencyRef,
      runtime_budget_reference: upstreamFixture.runtimeBudgetReference,
      runtime_freshness_reference: upstreamFixture.freshnessRef,
      idempotency_reference: upstreamFixture.schedulerRequest.idempotency_reference,
      registry_snapshot_reference: registrySnapshotRef,
      network_permission_policy_references: upstreamFixture.workerAssignmentRequest.network_permission_policy_references,
      secret_resolution_policy_references: upstreamFixture.workerAssignmentRequest.secret_resolution_policy_references,
      runtime_worker_stage_policy_requirement_references: upstreamFixture.workerAssignmentRequest.stage_policy_requirement_references,
      runtime_scheduler_dependency_references: upstreamFixture.dispatchRequest.runtime_scheduler_dependency_references,
      runtime_queue_admission_replay_reference: queueAdmissionReplayRef,
      correlation_id: 'corr-queue-admission-1',
      causation_id: 'cause-queue-admission-1',
      trace_id: 'trace-queue-admission-1',
      logical_sequence: 0,
      expected_queue_admission_registry_version: 1,
      simulation_context: upstreamFixture.gatewayRequest.simulation_context,
      ...overrides.request
    });
  }

  const policy = buildRuntimeQueueAdmissionPolicy({
    runtime_queue_admission_policy_id: `${upstreamFixture.baseId}-policy`,
    allow_no_llm_queue_reference: true, allow_model_queue_reference: true, allow_tool_queue_reference: true,
    allow_workflow_queue_reference: true, allow_parallel_queue_reference: true, allow_shared_queue_reference: true,
    allow_dedicated_queue_reference: true, allow_optional_queue_reference: true, allow_retry_queue_reference: true,
    allow_dead_letter_reference: true, allow_state_change_reference: true,
    maximum_admission_entry_count: 1000, maximum_model_admission_count: 1000, maximum_tool_admission_count: 1000,
    maximum_workflow_admission_count: 1000, maximum_parallel_admission_count: 1000,
    maximum_per_tenant_admission_count: 1000, maximum_per_organization_admission_count: 1000,
    maximum_per_project_admission_count: 1000, maximum_per_agent_admission_count: 1000,
    maximum_estimated_tokens: 100000000, maximum_estimated_cost_minor_units: 100000000,
    ...overrides.policy
  });

  // Two-pass build: a throwaway request first (placeholder replay-bound request fingerprint) to
  // compute the genuine request fingerprint, then the real Queue Admission Replay Reference, then
  // the final request -- the same "self-referential validated-after-construction" pattern already
  // established throughout this whole lineage.
  const throwawayRequest = buildRequestWith(buildRuntimeQueueAdmissionReplayReference({
    runtime_queue_admission_replay_reference_id: `${upstreamFixture.baseId}-replay`,
    runtime_queue_admission_request_id: upstreamFixture.requestId,
    runtime_queue_admission_request_fingerprint: 'placeholder',
    runtime_dispatch_package_id: upstreamFixture.dispatchOutcome.package.runtime_dispatch_package_id,
    runtime_dispatch_package_fingerprint: upstreamFixture.dispatchOutcome.package.dispatch_package_fingerprint,
    runtime_dispatch_package_digest: upstreamFixture.dispatchOutcome.package.dispatch_package_digest,
    runtime_dispatch_replay_reference_id: upstreamFixture.dispatchReplayRef.runtime_dispatch_replay_reference_id,
    runtime_dispatch_replay_fingerprint: upstreamFixture.dispatchReplayRef.replay_fingerprint,
    idempotency_reference_id: upstreamFixture.schedulerRequest.idempotency_reference.idempotency_reference_id,
    idempotency_fingerprint: upstreamFixture.schedulerRequest.idempotency_reference.idempotency_fingerprint,
    expected_queue_admission_attempt: 1, maximum_queue_admission_attempts: 5, replay_validated: true
  }));
  void throwawayRequest;

  const requestFingerprint = computeCanonicalContentDigest(omitQueueAdmissionReplayReference(throwawayRequest));

  const queueAdmissionReplayRef = buildRuntimeQueueAdmissionReplayReference({
    runtime_queue_admission_replay_reference_id: `${upstreamFixture.baseId}-replay`,
    runtime_queue_admission_request_id: upstreamFixture.requestId,
    runtime_queue_admission_request_fingerprint: requestFingerprint,
    runtime_dispatch_package_id: upstreamFixture.dispatchOutcome.package.runtime_dispatch_package_id,
    runtime_dispatch_package_fingerprint: upstreamFixture.dispatchOutcome.package.dispatch_package_fingerprint,
    runtime_dispatch_package_digest: upstreamFixture.dispatchOutcome.package.dispatch_package_digest,
    runtime_dispatch_replay_reference_id: upstreamFixture.dispatchReplayRef.runtime_dispatch_replay_reference_id,
    runtime_dispatch_replay_fingerprint: upstreamFixture.dispatchReplayRef.replay_fingerprint,
    idempotency_reference_id: upstreamFixture.schedulerRequest.idempotency_reference.idempotency_reference_id,
    idempotency_fingerprint: upstreamFixture.schedulerRequest.idempotency_reference.idempotency_fingerprint,
    expected_queue_admission_attempt: 1, maximum_queue_admission_attempts: 5, replay_validated: true
  });

  const request = buildRequestWith(queueAdmissionReplayRef);

  return {
    ...upstreamFixture, policy,
    queueAdmissionReplayRef, queueAdmissionRequest: request
  };
}

function buildGoldenQueueAdmissionBundleUncached(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const registrySnapshotRefOverride = overrides.registrySnapshotRef === undefined ? undefined : overrides.registrySnapshotRef;
  const dispatchOverrides = overrides.dispatch;
  if (dispatchOverrides !== undefined) {
    const officialRegistrySnapshot = registrySnapshotRefOverride === undefined ? buildOfficialRegistrySnapshot() : registrySnapshotRefOverride;
    const dispatchGolden = buildGoldenDispatchBundle(scenarioKey, {
      registrySnapshotRef: officialRegistrySnapshot,
      ...dispatchOverrides,
      workerAssignment: { registrySnapshotRef: officialRegistrySnapshot, ...(dispatchOverrides && dispatchOverrides.workerAssignment) }
    });
    const dispatchOutcome = evaluateRuntimeDispatchRequest(dispatchGolden.dispatchRequest, {});
    if (dispatchOutcome.decision.status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION') {
      throw new Error(`golden dispatch bundle for ${scenarioKey} did not reach DISPATCH_PACKAGE_PREPARED_SIMULATION: ${dispatchOutcome.decision.status}`);
    }
    const baseId = `${dispatchGolden.baseId}-queue-admission`;
    const canonical = {
      tenantId: dispatchOutcome.package.tenant_id, organizationId: dispatchOutcome.package.organization_id,
      projectId: dispatchOutcome.package.project_id, agentId: dispatchOutcome.package.agent_id
    };
    const { queueClass, capacitySnapshot, quota, quotas } = buildGoldenQueueClassCatalog(baseId, canonical);
    return buildGoldenQueueAdmissionBundleFromUpstream({
      ...dispatchGolden, dispatchOutcome, baseId, requestId: `${baseId}-request`, queueClass, capacitySnapshot,
      quota, quotas, registrySnapshotRef: officialRegistrySnapshot
    }, overrides);
  }

  const upstreamFixture = buildGoldenQueueAdmissionUpstreamFixture(scenarioKey, registrySnapshotRefOverride);
  return buildGoldenQueueAdmissionBundleFromUpstream(upstreamFixture, overrides);
}

function buildGoldenQueueAdmissionBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const upstreamFixture = getQueueAdmissionUpstreamFixture(scenarioKey, overrides);
  if (upstreamFixture === null) return buildGoldenQueueAdmissionBundleUncached(scenarioKey, overrides);
  return buildGoldenQueueAdmissionBundleFromUpstream(upstreamFixture, overrides);
}

module.exports = {
  buildGoldenQueueAdmissionBundle,
  buildGoldenQueueAdmissionBundleUncached,
  buildGoldenQueueClassCatalog,
  getQueueAdmissionUpstreamFixtureCacheKey,
  getQueueAdmissionUpstreamFixtureCacheStats: snapshotUpstreamFixtureCacheStats,
  resetQueueAdmissionUpstreamFixtureCacheForTests,
  evaluateRuntimeQueueAdmissionRequest
};
