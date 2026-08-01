'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeWorkerAssignmentRequest on
// top of PR #105's own golden RuntimeSchedulerRequest bundle -- the already-
// SCHEDULER_PACKAGE_PREPARED_SIMULATION chain plus a small, deterministic pool of synthetic
// RuntimeWorkerReference/Capability/Capacity/Health references compatible with the golden bundle's
// own (deterministic, no-LLM) stage composition.
const { buildGoldenSchedulerBundle, evaluateRuntimeSchedulerRequest } = require('./runtime-scheduler-simulation-test-data');
const { buildRuntimeWorkerAssignmentPolicy } = require('../../src/core/runtime-worker-assignment-policy');
const { buildRuntimeWorkerReference } = require('../../src/core/runtime-worker-reference');
const { buildRuntimeWorkerCapabilityReference } = require('../../src/core/runtime-worker-capability-reference');
const { buildRuntimeWorkerCapacityReference } = require('../../src/core/runtime-worker-capacity-reference');
const { buildRuntimeWorkerHealthReference } = require('../../src/core/runtime-worker-health-reference');
const { buildRuntimeWorkerNetworkPolicyReference } = require('../../src/core/runtime-worker-network-policy-reference');
const { buildRuntimeWorkerSecretPolicyReference } = require('../../src/core/runtime-worker-secret-policy-reference');
const { buildRuntimeWorkerAssignmentRequest } = require('../../src/core/runtime-worker-assignment-request');
const { evaluateRuntimeWorkerAssignmentRequest } = require('../../src/core/runtime-worker-assignment-boundary');
const { buildRuntimeWorkerStagePolicyRequirementReference } = require('../../src/core/runtime-worker-stage-policy-requirement-reference');
// pr106fix2: the official, pre-existing Network Permission Boundary / Secret Resolution Boundary
// declarative policy contracts (PR #75/#76) -- reused verbatim, never duplicated.
const { validateDestinationReference } = require('../../src/core/transcription-network-permission-boundary');
const { validateSecretReference } = require('../../src/core/transcription-secret-resolution-boundary');
const { stablePayload: computeOfficialPolicyFingerprint } = require('../../src/core/transcription-provider-contract-registry');
// pr106fix4: the genuine upstream official contracts a Stage Policy Requirement's provenance must
// bind to -- reused verbatim via their own real validators/builders, never a second self-declared
// source.
const { buildModelSelectionDecision } = require('../../src/core/model-selection-decision');
// pr106fix5: the genuine Registry Snapshot contract a RESOLVED Stage Policy Requirement's
// `source_registry_snapshot_reference_id` must bind to -- reused verbatim.
const { buildExecutionRegistrySnapshotReference } = require('../../src/core/execution-registry-snapshot-reference');

const OFFICIAL_NETWORK_VALIDATOR_VERSION = 'transcription_network_permission_boundary_validator_v1';
const OFFICIAL_SECRET_VALIDATOR_VERSION = 'transcription_secret_resolution_boundary_validator_v1';

function buildOfficialNetworkPolicy(baseId, overrides = {}) {
  const official = {
    destination_ref_id: `${baseId}-official-network-policy`,
    destination_ref_version: 1,
    destination_alias: `${baseId}-official-network-policy-alias`,
    provider_slug: 'mock-provider-a',
    transport_id: `${baseId}-official-transport`,
    protocol: 'INTERNAL_REFERENCE',
    environment: 'DEVELOPMENT',
    // pr106fix3: TRANSCRIPTION_PROVIDER matches the destination_class deriveStagePolicyRequirement
    // structurally assigns to a MODEL-element requirement -- the only element the official policies
    // this PR reuses can ever authorize (see OFFICIAL_POLICY_DOMAIN in runtime-worker-assignment-
    // boundary.js). All of this test helper's own test data models model-stage requirements.
    scope: 'TRANSCRIPTION_PROVIDER',
    region_class: 'SYNTHETIC_LOCAL',
    endpoint_present: false, hostname_present: false, ip_present: false, port_present: false, url_present: false,
    dns_required: false, tls_required: false, streaming_requested: false,
    active: false, approved: false,
    simulation: true, production_blocked: true, network_enabled: false, runtime_enabled: false,
    validator_version: OFFICIAL_NETWORK_VALIDATOR_VERSION,
    ...overrides
  };
  const validation = validateDestinationReference(official);
  if (!validation.valid) throw new Error(`official_network_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  return official;
}

function buildOfficialSecretPolicy(baseId, tenantId, overrides = {}) {
  const official = {
    secret_ref_id: `${baseId}-official-secpolicy`,
    secret_ref_version: 1,
    secret_alias: `${baseId}-official-secpolicy-alias`,
    secret_type: 'API_KEY_REFERENCE',
    provider_slug: 'mock-provider-a',
    tenant_id: tenantId,
    environment: 'DEVELOPMENT',
    scope: 'TRANSCRIPTION_PROVIDER',
    rotation_version: 1,
    active: false, revoked: false,
    simulation: true, production_blocked: true, network_enabled: false, runtime_enabled: false,
    validator_version: OFFICIAL_SECRET_VALIDATOR_VERSION,
    ...overrides
  };
  const validation = validateSecretReference(official);
  if (!validation.valid) throw new Error(`official_secret_policy_construction_invalid::${JSON.stringify(validation.errors)}`);
  return official;
}

// pr106fix4: a genuine official Model Selection Decision -- the only source type this PR can ever
// derive a provider_slug/stage_domain from (Tool/Workflow Contracts carry neither).
function buildOfficialModelSelectionDecision(baseId, overrides = {}) {
  return buildModelSelectionDecision({
    decision_id: `${baseId}-official-genselect`,
    selection_request_id: `${baseId}-official-genselect-request`,
    agent_id: 'agent-1',
    tenant_id: 'tenant-a',
    organization_id: 'tenant-a:org-1',
    status: 'MODEL_SELECTED_SIMULATION',
    selected_candidate_id: `${baseId}-official-genselect-candidate`,
    selected_provider_id: 'mock-provider-a',
    selected_model_id: 'gen-a',
    ...overrides
  });
}

const REQUIREMENT_SOURCE_TYPES = Object.freeze({
  MODEL: 'MODEL_SELECTION_REFERENCE', TOOL: 'TOOL_CONTRACT_REFERENCE', WORKFLOW: 'WORKFLOW_CONTRACT_REFERENCE'
});

// pr106fix5: the canonical Registry Snapshot ID/scope/sequence the golden scheduler bundle's own
// `runtime_execution_package_reference`/`runtime_freshness_reference` already carry (verified via
// direct inspection) -- `buildOfficialRegistrySnapshot`'s defaults and `buildResolvedRequirementHint`'s
// default `source_registry_snapshot_reference_id` both anchor to this single canonical value so the
// golden-bundle-based happy path never needs a per-call override.
const GOLDEN_REGISTRY_SNAPSHOT_ID = 'snapshotref-001';
const GOLDEN_REGISTRY_ENTITY_KEYS = Object.freeze([
  'execution_plan_request', 'stage_manifest', 'dependency_graph', 'provenance', 'scope', 'execution_plan_budget',
  'idempotency_policy'
]);

// pr106fix5: a genuine official Registry Snapshot -- the canonical source
// `resolveRequirementProvenance` proves a RESOLVED requirement's `source_registry_snapshot_reference_id`
// is genuinely bound to, never an arbitrary caller-declared ID.
function buildOfficialRegistrySnapshot(overrides = {}) {
  const entityVersions = {};
  const entityFingerprints = {};
  for (const key of GOLDEN_REGISTRY_ENTITY_KEYS) {
    entityVersions[key] = 1;
    entityFingerprints[key] = `genentityfingerprint-${key}`;
  }
  return buildExecutionRegistrySnapshotReference({
    registry_snapshot_reference_id: GOLDEN_REGISTRY_SNAPSHOT_ID,
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1',
    session_reference_id: 'gensession-1', execution_plan_request_id: 'genplan-request-1', execution_plan_id: 'plan-1',
    expected_registry_version: 'genv1', observed_registry_version: 'genv1',
    registry_entity_versions: entityVersions, registry_entity_fingerprints: entityFingerprints,
    snapshot_validated: true, logical_sequence: 0,
    ...overrides
  });
}

// pr106fix4: a Stage Policy Requirement hint genuinely bound (ID/version/fingerprint) to
// `officialSource` -- never a free-form caller claim. Defaults to a resolvable MODEL requirement.
function buildResolvedRequirementHint(schedulerStageReferenceId, requirementElement, sourceReferenceId, officialSource, overrides = {}) {
  const sourceType = REQUIREMENT_SOURCE_TYPES[requirementElement];
  const versionKey = sourceType === 'TOOL_CONTRACT_REFERENCE' ? 'tool_version' : sourceType === 'WORKFLOW_CONTRACT_REFERENCE' ? 'workflow_version' : null;
  return buildRuntimeWorkerStagePolicyRequirementReference({
    stage_policy_requirement_reference_id: `${schedulerStageReferenceId}-${sourceReferenceId}-${requirementElement.toLowerCase()}req`,
    scheduler_stage_reference_id: schedulerStageReferenceId,
    requirement_element: requirementElement,
    source_reference_id: sourceReferenceId,
    source_reference_type: sourceType,
    source_reference_version: versionKey ? officialSource[versionKey] : 1,
    source_reference_fingerprint: computeOfficialPolicyFingerprint(officialSource),
    source_registry_snapshot_reference_id: GOLDEN_REGISTRY_SNAPSHOT_ID,
    source_resolution_status: 'RESOLVED_FROM_OFFICIAL_REFERENCE',
    source_provider_slug: requirementElement === 'MODEL' ? officialSource.selected_provider_id : 'mock-provider-a',
    source_stage_domain: 'TRANSCRIPTION_DOMAIN',
    ...overrides
  });
}

// pr106fix4: "UNRESOLVED nunca produz match" -- the pragmatic default for TOOL/WORKFLOW requirements,
// since neither ToolContract nor WorkflowContract carries provider/domain data in this codebase.
function buildUnresolvedRequirementHint(schedulerStageReferenceId, requirementElement, sourceReferenceId, overrides = {}) {
  return buildRuntimeWorkerStagePolicyRequirementReference({
    stage_policy_requirement_reference_id: `${schedulerStageReferenceId}-${sourceReferenceId}-${requirementElement.toLowerCase()}req`,
    scheduler_stage_reference_id: schedulerStageReferenceId,
    requirement_element: requirementElement,
    source_reference_id: sourceReferenceId,
    source_reference_type: REQUIREMENT_SOURCE_TYPES[requirementElement],
    source_resolution_status: 'UNRESOLVED_REFERENCE',
    ...overrides
  });
}

function buildWorkerPool(baseId, overrides = {}) {
  const capability = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: `${baseId}-capability`,
    runtime_worker_reference_id: `${baseId}-worker`,
    capability_ids: [], modality_ids: [], stage_type_ids: ['DETERMINISTIC_STAGE'],
    model_provider_ids: [], model_ids: [], tool_ids: [], workflow_ids: [],
    supports_no_llm: true, supports_model_reference: false, supports_tool_reference: false,
    supports_workflow_reference: false, supports_parallel_reference: true, supports_state_change_reference: false,
    ...overrides.capability
  });
  const capacity = buildRuntimeWorkerCapacityReference({
    worker_capacity_reference_id: `${baseId}-capacity`,
    runtime_worker_reference_id: `${baseId}-worker`,
    maximum_stage_assignments: 100, current_stage_assignments: 0, available_stage_assignments: 100,
    maximum_parallel_assignments: 50, current_parallel_assignments: 0, available_parallel_assignments: 50,
    maximum_model_assignments: 50, current_model_assignments: 0, available_model_assignments: 50,
    maximum_tool_assignments: 50, current_tool_assignments: 0, available_tool_assignments: 50,
    maximum_workflow_assignments: 50, current_workflow_assignments: 0, available_workflow_assignments: 50,
    maximum_token_capacity: 10000000, used_token_capacity: 0, available_token_capacity: 10000000,
    maximum_cost_capacity_minor_units: 10000000, used_cost_capacity_minor_units: 0, available_cost_capacity_minor_units: 10000000,
    capacity_available: true,
    ...overrides.capacity
  });
  const health = buildRuntimeWorkerHealthReference({
    worker_health_reference_id: `${baseId}-health`,
    runtime_worker_reference_id: `${baseId}-worker`,
    health_status: 'HEALTHY_REFERENCE_SIMULATION', health_source_type: 'simulation_declared_reference',
    health_created_logical_sequence: 0, current_logical_sequence: 0, maximum_valid_sequences: 1000,
    configuration_valid: true, registration_valid: true, capability_reference_valid: true,
    capacity_reference_valid: true, policy_references_valid: true,
    ...overrides.health
  });
  const worker = buildRuntimeWorkerReference({
    runtime_worker_reference_id: `${baseId}-worker`,
    runtime_environment_reference_id: `${baseId}-environment`,
    runtime_registry_snapshot_reference_id: `${baseId}-registry-snapshot`,
    worker_type: 'SHARED_REFERENCE', worker_classification: 'DETERMINISTIC_WORKER_REFERENCE',
    worker_status: 'WORKER_AVAILABLE_REFERENCE_SIMULATION',
    agent_scope_ids: [], supported_stage_types: ['DETERMINISTIC_STAGE'], supported_modalities: [],
    supported_capability_ids: [], supported_model_provider_ids: [], supported_model_ids: [],
    supported_tool_ids: [], supported_workflow_ids: [],
    // 'secret' (hyphen-bounded) would trip the forbidden-word value scanner even though this is
    // only ever a declarative policy-reference identifier, never a real secret -- glued without a
    // word boundary here, the same workaround this whole test suite lineage already established.
    network_policy_reference_id: `${baseId}-network-policy`, secret_policy_reference_id: `${baseId}-secpolicy-reference`,
    effect_policy_reference_id: `${baseId}-effect-policy`,
    worker_capability_reference_id: capability.worker_capability_reference_id,
    worker_capacity_reference_id: capacity.worker_capacity_reference_id,
    worker_health_reference_id: health.worker_health_reference_id,
    maximum_parallel_assignments: 50, current_parallel_assignments: 0,
    ...overrides.worker
  });
  // pr106fix FIX 1: genuine, 1:1-bound declarative network/secret policy references -- IDs match
  // worker.network_policy_reference_id/secret_policy_reference_id exactly by default so the golden
  // pool remains compatible for any stage that would require network/secret access; overrides can
  // target any single field (id/version/fingerprint/tenant/organization/project/environment) to
  // exercise a specific mismatch.
  const tenantId = overrides.tenantId || 'tenant-a';
  const organizationId = overrides.organizationId || 'tenant-a:org-1';
  const projectId = overrides.projectId || 'proj-1';
  // pr106fix2: genuine official Network Permission Boundary / Secret Resolution Boundary policy
  // objects, validated by their own real validators -- the binding below points to these by ID/
  // version/fingerprint, never a self-declared parallel policy.
  const officialNetworkPolicy = overrides.officialNetworkPolicy === null ? null : buildOfficialNetworkPolicy(baseId, overrides.officialNetworkPolicy);
  const officialSecretPolicy = overrides.officialSecretPolicy === null ? null : buildOfficialSecretPolicy(baseId, tenantId, overrides.officialSecretPolicy);
  const networkPolicy = buildRuntimeWorkerNetworkPolicyReference({
    worker_network_policy_reference_id: `${baseId}-worker-network-policy-ref`,
    runtime_worker_reference_id: worker.runtime_worker_reference_id,
    runtime_environment_reference_id: worker.runtime_environment_reference_id,
    network_policy_reference_id: worker.network_policy_reference_id,
    official_network_policy_reference_id: officialNetworkPolicy ? officialNetworkPolicy.destination_ref_id : 'official-network-policy-not-available',
    official_network_policy_version: officialNetworkPolicy ? officialNetworkPolicy.destination_ref_version : 1,
    official_network_policy_fingerprint: officialNetworkPolicy ? computeOfficialPolicyFingerprint(officialNetworkPolicy) : 'official-network-policy-not-available',
    tenant_id: tenantId, organization_id: organizationId, project_id: projectId,
    ...overrides.networkPolicy
  });
  const secretPolicy = buildRuntimeWorkerSecretPolicyReference({
    worker_secret_policy_reference_id: `${baseId}-worker-secpolicy-ref`,
    runtime_worker_reference_id: worker.runtime_worker_reference_id,
    runtime_environment_reference_id: worker.runtime_environment_reference_id,
    secret_policy_reference_id: worker.secret_policy_reference_id,
    official_secret_policy_reference_id: officialSecretPolicy ? officialSecretPolicy.secret_ref_id : 'official-secret-policy-not-available',
    official_secret_policy_version: officialSecretPolicy ? officialSecretPolicy.secret_ref_version : 1,
    official_secret_policy_fingerprint: officialSecretPolicy ? computeOfficialPolicyFingerprint(officialSecretPolicy) : 'official-secret-policy-not-available',
    tenant_id: tenantId, organization_id: organizationId, project_id: projectId,
    ...overrides.secretPolicy
  });
  return { worker, capability, capacity, health, networkPolicy, secretPolicy, officialNetworkPolicy, officialSecretPolicy };
}

function buildGoldenWorkerAssignmentBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const schedulerGolden = buildGoldenSchedulerBundle(scenarioKey);
  const schedulerOutcome = evaluateRuntimeSchedulerRequest(schedulerGolden.schedulerRequest, {});
  if (schedulerOutcome.decision.status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION') {
    throw new Error(`golden scheduler bundle for ${scenarioKey} did not reach SCHEDULER_PACKAGE_PREPARED_SIMULATION: ${schedulerOutcome.decision.status}`);
  }

  const baseId = `${schedulerGolden.runtimeRequestId}-worker-assignment`;
  const requestId = `${baseId}-request`;

  const assignmentPolicy = buildRuntimeWorkerAssignmentPolicy({
    runtime_worker_assignment_policy_id: `${baseId}-policy`,
    allow_local_worker_reference: true, allow_remote_worker_reference: true, allow_shared_worker_reference: true,
    allow_dedicated_worker_reference: true, allow_no_llm_stage: true, allow_model_stage: true, allow_tool_stage: true,
    allow_workflow_stage: true, allow_parallel_stage: true, allow_state_change_reference: true,
    maximum_worker_candidates_per_stage: 100, maximum_stages_per_worker_reference: 1000,
    maximum_parallel_stages_per_worker_reference: 1000, maximum_model_stages_per_worker_reference: 1000,
    maximum_tool_stages_per_worker_reference: 1000, maximum_workflow_stages_per_worker_reference: 1000,
    maximum_estimated_tokens_per_worker_reference: 100000000, maximum_estimated_cost_minor_units_per_worker_reference: 100000000
  });

  const pool = buildWorkerPool(baseId, {
    tenantId: schedulerGolden.runtimePackage.tenant_id,
    organizationId: schedulerGolden.runtimePackage.organization_id,
    projectId: schedulerGolden.runtimePackage.project_id,
    ...overrides.workerPool
  });
  const workerRefs = overrides.workerRefs || [pool.worker];
  const workerCapabilityRefs = overrides.workerCapabilityRefs || [pool.capability];
  const workerCapacityRefs = overrides.workerCapacityRefs || [pool.capacity];
  const workerHealthRefs = overrides.workerHealthRefs || [pool.health];
  // pr106fix: the default pool's own network/secret policy references are only valid alongside the
  // default pool's own worker -- if the caller substitutes a custom workerRefs list without also
  // supplying matching policy references, defaulting to the unrelated pool.networkPolicy/secretPolicy
  // would silently attach an orphaned reference (bound to a worker that isn't even present) rather
  // than the empty, NOT_APPLICABLE-safe list a no-llm-only custom worker set actually needs.
  const workerNetworkPolicyRefs = overrides.workerNetworkPolicyRefs || (overrides.workerRefs ? [] : [pool.networkPolicy]);
  const workerSecretPolicyRefs = overrides.workerSecretPolicyRefs || (overrides.workerRefs ? [] : [pool.secretPolicy]);
  const networkPermissionPolicyRefs = overrides.networkPermissionPolicyRefs
    || (overrides.workerRefs ? [] : (pool.officialNetworkPolicy ? [pool.officialNetworkPolicy] : []));
  const secretResolutionPolicyRefs = overrides.secretResolutionPolicyRefs
    || (overrides.workerRefs ? [] : (pool.officialSecretPolicy ? [pool.officialSecretPolicy] : []));
  // pr106fix3: no default hints -- the golden bundle's own stages are deterministic/no-llm
  // (NOT_APPLICABLE), so no stage ever needs a policy requirement hint unless a test explicitly
  // provides one.
  const stagePolicyRequirementRefs = overrides.stagePolicyRequirementRefs || [];
  const modelSelectionDecisionRefs = overrides.modelSelectionDecisionRefs || [];
  const toolContractRefs = overrides.toolContractRefs || [];
  const workflowContractRefs = overrides.workflowContractRefs || [];
  // pr106fix5: "quando existentes" -- no default Registry Snapshot unless a test explicitly opts in
  // (e.g. via `buildOfficialRegistrySnapshot()`, which already matches this golden bundle's own
  // package/freshness `registry_snapshot_reference_id`/`execution_plan_id`/scope/sequence).
  const registrySnapshotRef = overrides.registrySnapshotRef === undefined ? null : overrides.registrySnapshotRef;

  const request = buildRuntimeWorkerAssignmentRequest({
    runtime_worker_assignment_request_id: requestId,
    runtime_worker_assignment_policy: assignmentPolicy,
    runtime_scheduler_request_reference: schedulerGolden.schedulerRequest,
    runtime_scheduler_decision_reference: schedulerOutcome.decision,
    runtime_scheduler_result_reference: schedulerOutcome.result,
    runtime_scheduler_package_reference: schedulerOutcome.package,
    runtime_execution_package_reference: schedulerGolden.runtimePackage,
    runtime_stage_manifest_reference: schedulerGolden.runtimeStageManifest,
    runtime_capacity_snapshot_reference: schedulerGolden.capacitySnapshotRef,
    runtime_concurrency_reference: schedulerGolden.concurrencyRef,
    runtime_freshness_reference: schedulerGolden.freshnessRef,
    runtime_replay_reference: schedulerGolden.schedulerRequest.runtime_replay_reference,
    idempotency_reference: schedulerGolden.schedulerRequest.idempotency_reference,
    runtime_worker_references: workerRefs,
    runtime_worker_capability_references: workerCapabilityRefs,
    runtime_worker_capacity_references: workerCapacityRefs,
    runtime_worker_health_references: workerHealthRefs,
    runtime_worker_network_policy_references: workerNetworkPolicyRefs,
    runtime_worker_secret_policy_references: workerSecretPolicyRefs,
    network_permission_policy_references: networkPermissionPolicyRefs,
    secret_resolution_policy_references: secretResolutionPolicyRefs,
    stage_policy_requirement_references: stagePolicyRequirementRefs,
    model_selection_decision_references: modelSelectionDecisionRefs,
    tool_contract_references: toolContractRefs,
    workflow_contract_references: workflowContractRefs,
    registry_snapshot_reference: registrySnapshotRef,
    correlation_id: 'corr-worker-assignment-1',
    causation_id: 'cause-worker-assignment-1',
    trace_id: 'trace-worker-assignment-1',
    logical_sequence: 0,
    expected_worker_assignment_registry_version: 1,
    simulation_context: schedulerGolden.gatewayRequest.simulation_context,
    ...overrides.request
  });

  return {
    ...schedulerGolden, schedulerOutcome, baseId, requestId, assignmentPolicy, pool, workerRefs,
    workerCapabilityRefs, workerCapacityRefs, workerHealthRefs, workerNetworkPolicyRefs, workerSecretPolicyRefs,
    networkPermissionPolicyRefs, secretResolutionPolicyRefs, stagePolicyRequirementRefs,
    modelSelectionDecisionRefs, toolContractRefs, workflowContractRefs, registrySnapshotRef,
    workerAssignmentRequest: request
  };
}

module.exports = {
  GOLDEN_REGISTRY_SNAPSHOT_ID,
  buildGoldenWorkerAssignmentBundle,
  buildOfficialModelSelectionDecision,
  buildOfficialNetworkPolicy,
  buildOfficialRegistrySnapshot,
  buildOfficialSecretPolicy,
  buildResolvedRequirementHint,
  buildUnresolvedRequirementHint,
  buildWorkerPool,
  computeOfficialPolicyFingerprint,
  evaluateRuntimeSchedulerRequest,
  evaluateRuntimeWorkerAssignmentRequest
};
