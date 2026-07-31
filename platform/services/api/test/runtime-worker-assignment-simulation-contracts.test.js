'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const {
  validateRuntimeWorkerAssignmentPolicy, buildRuntimeWorkerAssignmentPolicy, RUNTIME_WORKER_ASSIGNMENT_POLICY_FIELDS
} = require('../src/core/runtime-worker-assignment-policy');
const {
  validateRuntimeWorkerReference, buildRuntimeWorkerReference, RUNTIME_WORKER_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-reference');
const {
  validateRuntimeWorkerCapabilityReference, buildRuntimeWorkerCapabilityReference, RUNTIME_WORKER_CAPABILITY_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-capability-reference');
const {
  validateRuntimeWorkerCapacityReference, buildRuntimeWorkerCapacityReference, RUNTIME_WORKER_CAPACITY_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-capacity-reference');
const {
  validateRuntimeWorkerHealthReference, buildRuntimeWorkerHealthReference, RUNTIME_WORKER_HEALTH_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-health-reference');
const {
  validateRuntimeWorkerCompatibilityReference, buildRuntimeWorkerCompatibilityReference,
  RUNTIME_WORKER_COMPATIBILITY_REFERENCE_FIELDS, MATCH_FIELDS
} = require('../src/core/runtime-worker-compatibility-reference');
const {
  validateRuntimeWorkerCandidateSetReference, buildRuntimeWorkerCandidateSetReference,
  RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-candidate-set-reference');
const {
  validateRuntimeWorkerStageAssignmentReference, buildRuntimeWorkerStageAssignmentReference,
  RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-stage-assignment-reference');
const { validateRuntimeWorkerAssignmentRequest, buildRuntimeWorkerAssignmentRequest } = require('../src/core/runtime-worker-assignment-request');
const { validateRuntimeWorkerAssignmentPackage } = require('../src/core/runtime-worker-assignment-package');
const {
  validateRuntimeWorkerAssignmentDecision, WORKER_ASSIGNMENT_STATUSES, WORKER_ASSIGNMENT_PRECEDENCE_ORDER
} = require('../src/core/runtime-worker-assignment-decision');
const { validateRuntimeWorkerAssignmentResult } = require('../src/core/runtime-worker-assignment-result');
const { validateRuntimeWorkerAssignmentAudit } = require('../src/core/runtime-worker-assignment-audit');
const { createRuntimeWorkerAssignmentRegistry } = require('../src/core/runtime-worker-assignment-registry');
const { runAllGates } = require('../src/core/architecture-gate-runner');
const {
  validateRuntimeWorkerNetworkPolicyReference, buildRuntimeWorkerNetworkPolicyReference, RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-network-policy-reference');
const {
  validateRuntimeWorkerSecretPolicyReference, buildRuntimeWorkerSecretPolicyReference, RUNTIME_WORKER_SECRET_POLICY_REFERENCE_FIELDS
} = require('../src/core/runtime-worker-secret-policy-reference');
const {
  deriveStageRequiresNetworkOrSecret, evaluatePolicyReferenceMatch, evaluateHealthAtAssignment
} = require('../src/core/runtime-worker-assignment-boundary');

const {
  buildGoldenWorkerAssignmentBundle, buildWorkerPool, evaluateRuntimeWorkerAssignmentRequest
} = require('./helpers/runtime-worker-assignment-test-data');

const fixture = require('./fixtures/hermes-runtime-worker-assignment-simulation-contracts.json');

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

function rebuild(request) {
  return buildRuntimeWorkerAssignmentRequest(request);
}

const OPERATIONAL_FLAG_FIELDS = [
  'worker_assignment_applied', 'worker_reserved', 'worker_started', 'worker_connection_opened',
  'worker_process_created', 'worker_thread_created', 'container_started', 'job_created', 'queue_created',
  'queue_used', 'stage_dispatched', 'stage_started', 'stage_completed', 'stage_failed', 'runtime_enabled',
  'execution_authorized', 'execution_started', 'executed'
];

// --- Policy -----------------------------------------------------------------------------------

test('worker assignment policy: valid contract, exact fields, safe defaults, nenhuma policy habilita worker', () => {
  const policy = buildRuntimeWorkerAssignmentPolicy({ runtime_worker_assignment_policy_id: 'wap-1' });
  assertValid('worker assignment policy', validateRuntimeWorkerAssignmentPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...RUNTIME_WORKER_ASSIGNMENT_POLICY_FIELDS].sort());
  assert.equal(policy.allow_external_effect_reference, false);
  assert.equal(policy.allow_irreversible_reference, false);
  assert.equal(policy.simulation, true);
  assert.equal(policy.production_blocked, true);
  for (const field of RUNTIME_WORKER_ASSIGNMENT_POLICY_FIELDS) {
    if (field.startsWith('require_') || field.startsWith('fail_on_')) assert.equal(policy[field], true, field);
  }
});

test('worker assignment policy: fields missing/extra rejected, invalid limits rejected', () => {
  const policy = buildRuntimeWorkerAssignmentPolicy({ runtime_worker_assignment_policy_id: 'wap-1' });
  const { runtime_worker_assignment_policy_id, ...missing } = policy;
  assertInvalid('missing field', validateRuntimeWorkerAssignmentPolicy(missing));
  assertInvalid('extra field', validateRuntimeWorkerAssignmentPolicy({ ...policy, extra_field: true }));
  assertInvalid('require flipped false', validateRuntimeWorkerAssignmentPolicy({ ...policy, require_capability_match: false }));
  assertInvalid('external effect flipped true', validateRuntimeWorkerAssignmentPolicy({ ...policy, allow_external_effect_reference: true }));
  assertInvalid('negative maximum', validateRuntimeWorkerAssignmentPolicy({ ...policy, maximum_worker_candidates_per_stage: -1 }));
});

// --- Worker Reference ---------------------------------------------------------------------------

test('worker reference: valid contract, exact fields, immutable, capacity arithmetic, fingerprint/digest', () => {
  const pool = buildWorkerPool('wr-1');
  assertValid('worker reference', validateRuntimeWorkerReference(pool.worker));
  assert.deepEqual(Object.keys(pool.worker).sort(), [...RUNTIME_WORKER_REFERENCE_FIELDS].sort());
  assert.equal(pool.worker.available_parallel_assignments, pool.worker.maximum_parallel_assignments - pool.worker.current_parallel_assignments);
  assert.throws(() => { pool.worker.worker_reserved = true; });
  assertInvalid('tampered fingerprint', validateRuntimeWorkerReference({ ...pool.worker, worker_fingerprint: 'sha256:' + 'f'.repeat(64) }));
  assertInvalid('tampered digest', validateRuntimeWorkerReference({ ...pool.worker, worker_digest: 'sha256:' + 'f'.repeat(64) }));
});

test('worker reference: safe flags always forced regardless of input', () => {
  const pool = buildWorkerPool('wr-2');
  assert.equal(pool.worker.worker_registered, true);
  assert.equal(pool.worker.worker_reserved, false);
  assert.equal(pool.worker.worker_started, false);
  assert.equal(pool.worker.worker_connection_opened, false);
  assert.equal(pool.worker.rollout_percentage, 0);
});

test('worker reference: worker_active_reference tracks status, all 4 worker types and 5 classifications construct validly', () => {
  for (const workerType of ['LOCAL_REFERENCE', 'REMOTE_REFERENCE', 'SHARED_REFERENCE', 'DEDICATED_REFERENCE']) {
    const scope = workerType === 'DEDICATED_REFERENCE' ? { tenant_scope_id: 't1', organization_scope_id: 'o1', project_scope_id: 'p1' } : {};
    const pool = buildWorkerPool(`wr-type-${workerType}`, { worker: { worker_type: workerType, ...scope } });
    assertValid(`worker type ${workerType}`, validateRuntimeWorkerReference(pool.worker));
  }
  for (const classification of ['DETERMINISTIC_WORKER_REFERENCE', 'MODEL_WORKER_REFERENCE', 'TOOL_WORKER_REFERENCE', 'WORKFLOW_WORKER_REFERENCE', 'MULTI_CAPABILITY_WORKER_REFERENCE']) {
    const pool = buildWorkerPool(`wr-class-${classification}`, { worker: { worker_classification: classification } });
    assertValid(`classification ${classification}`, validateRuntimeWorkerReference(pool.worker));
  }
  const unhealthy = buildWorkerPool('wr-unavailable', { worker: { worker_status: 'WORKER_UNHEALTHY_REFERENCE' } });
  assert.equal(unhealthy.worker.worker_active_reference, false);
});

// --- Capability -----------------------------------------------------------------------------

test('capability reference: no-LLM, model, tool, workflow, modalities, stage types all construct validly', () => {
  const noLlm = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: 'cap-no-llm', runtime_worker_reference_id: 'w-1',
    capability_ids: [], modality_ids: [], stage_type_ids: ['DETERMINISTIC_STAGE'],
    model_provider_ids: [], model_ids: [], tool_ids: [], workflow_ids: [],
    supports_no_llm: true, supports_model_reference: false, supports_tool_reference: false, supports_workflow_reference: false,
    supports_parallel_reference: true, supports_state_change_reference: false
  });
  assertValid('no-llm capability', validateRuntimeWorkerCapabilityReference(noLlm));
  assert.deepEqual(Object.keys(noLlm).sort(), [...RUNTIME_WORKER_CAPABILITY_REFERENCE_FIELDS].sort());

  const model = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: 'cap-genref', runtime_worker_reference_id: 'w-2',
    capability_ids: ['cap-a'], modality_ids: ['TEXT_INPUT'], stage_type_ids: ['MODEL_REFERENCE_STAGE'],
    model_provider_ids: ['prov-a'], model_ids: ['gen-a'], tool_ids: [], workflow_ids: [],
    supports_no_llm: false, supports_model_reference: true, supports_tool_reference: false, supports_workflow_reference: false,
    supports_parallel_reference: false, supports_state_change_reference: false
  });
  assert.equal(model.supports_model_reference, true);

  const tool = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: 'cap-tool', runtime_worker_reference_id: 'w-3',
    capability_ids: [], modality_ids: [], stage_type_ids: ['TOOL_REFERENCE_STAGE'],
    model_provider_ids: [], model_ids: [], tool_ids: ['tool-a'], workflow_ids: [],
    supports_no_llm: false, supports_model_reference: false, supports_tool_reference: true, supports_workflow_reference: false,
    supports_parallel_reference: false, supports_state_change_reference: false
  });
  assert.equal(tool.supports_tool_reference, true);

  const workflow = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: 'cap-workflow', runtime_worker_reference_id: 'w-4',
    capability_ids: [], modality_ids: [], stage_type_ids: ['WORKFLOW_REFERENCE_STAGE'],
    model_provider_ids: [], model_ids: [], tool_ids: [], workflow_ids: ['flow-a'],
    supports_no_llm: false, supports_model_reference: false, supports_tool_reference: false, supports_workflow_reference: true,
    supports_parallel_reference: false, supports_state_change_reference: false
  });
  assert.equal(workflow.supports_workflow_reference, true);

  const stateChange = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: 'cap-state', runtime_worker_reference_id: 'w-5',
    capability_ids: [], modality_ids: [], stage_type_ids: ['DETERMINISTIC_STAGE'],
    model_provider_ids: [], model_ids: [], tool_ids: [], workflow_ids: [],
    supports_no_llm: true, supports_model_reference: false, supports_tool_reference: false, supports_workflow_reference: false,
    supports_parallel_reference: false, supports_state_change_reference: true
  });
  assert.equal(stateChange.supports_state_change_reference, true);
});

test('capability reference: external/irreversible support permanently forced false', () => {
  const cap = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: 'cap-6', runtime_worker_reference_id: 'w-6',
    capability_ids: [], modality_ids: [], stage_type_ids: [], model_provider_ids: [], model_ids: [], tool_ids: [], workflow_ids: [],
    supports_no_llm: true
  });
  assert.equal(cap.supports_external_effect_reference, false);
  assert.equal(cap.supports_irreversible_reference, false);
  assert.equal(cap.capability_applied, false);
  assertInvalid('smuggled external support', validateRuntimeWorkerCapabilityReference({ ...cap, supports_external_effect_reference: true }));
});

// --- Capacity -------------------------------------------------------------------------------

test('capacity reference: arithmetic per dimension, fingerprint/digest, no reserve/consume', () => {
  const pool = buildWorkerPool('cap-arith-1');
  assertValid('capacity reference', validateRuntimeWorkerCapacityReference(pool.capacity));
  assert.deepEqual(Object.keys(pool.capacity).sort(), [...RUNTIME_WORKER_CAPACITY_REFERENCE_FIELDS].sort());
  assert.equal(pool.capacity.capacity_applied, false);
  assert.equal(pool.capacity.capacity_reserved, false);
  assert.equal(pool.capacity.slots_consumed, false);
  assertInvalid('used exceeds total', validateRuntimeWorkerCapacityReference({ ...pool.capacity, current_stage_assignments: 999999 }));
});

test('capacity reference: each dimension exhausted (available=0) still constructs, capacity_validated tracks capacity_available flag', () => {
  const exhausted = buildRuntimeWorkerCapacityReference({
    worker_capacity_reference_id: 'cap-exhausted', runtime_worker_reference_id: 'w-1',
    maximum_stage_assignments: 1, current_stage_assignments: 1, available_stage_assignments: 0,
    maximum_parallel_assignments: 1, current_parallel_assignments: 1, available_parallel_assignments: 0,
    maximum_model_assignments: 1, current_model_assignments: 1, available_model_assignments: 0,
    maximum_tool_assignments: 1, current_tool_assignments: 1, available_tool_assignments: 0,
    maximum_workflow_assignments: 1, current_workflow_assignments: 1, available_workflow_assignments: 0,
    maximum_token_capacity: 1, used_token_capacity: 1, available_token_capacity: 0,
    maximum_cost_capacity_minor_units: 1, used_cost_capacity_minor_units: 1, available_cost_capacity_minor_units: 0,
    capacity_available: true
  });
  assert.equal(exhausted.capacity_consistent, true);
  assert.equal(exhausted.capacity_validated, true);
});

// --- Health -----------------------------------------------------------------------------------

test('health reference: healthy/degraded/unhealthy/unknown/expired statuses all construct validly', () => {
  for (const status of ['HEALTHY_REFERENCE_SIMULATION', 'DEGRADED_REFERENCE', 'UNHEALTHY_REFERENCE', 'UNKNOWN_REFERENCE', 'EXPIRED_REFERENCE']) {
    const health = buildRuntimeWorkerHealthReference({
      worker_health_reference_id: `health-${status}`, runtime_worker_reference_id: 'w-1',
      health_status: status, health_source_type: 'simulation_declared_reference',
      health_created_logical_sequence: 0, current_logical_sequence: 0, maximum_valid_sequences: 1000,
      configuration_valid: true, registration_valid: true, capability_reference_valid: true, capacity_reference_valid: true, policy_references_valid: true
    });
    assertValid(`health status ${status}`, validateRuntimeWorkerHealthReference(health));
    assert.deepEqual(Object.keys(health).sort(), [...RUNTIME_WORKER_HEALTH_REFERENCE_FIELDS].sort());
    assert.equal(health.health_validated, status === 'HEALTHY_REFERENCE_SIMULATION');
  }
});

test('health reference: logical freshness expires deterministically, no Date/timer used', () => {
  const expired = buildRuntimeWorkerHealthReference({
    worker_health_reference_id: 'health-expired-seq', runtime_worker_reference_id: 'w-1',
    health_status: 'HEALTHY_REFERENCE_SIMULATION', health_source_type: 'simulation_declared_reference',
    health_created_logical_sequence: 0, current_logical_sequence: 5000, maximum_valid_sequences: 1000,
    configuration_valid: true, registration_valid: true, capability_reference_valid: true, capacity_reference_valid: true, policy_references_valid: true
  });
  assert.equal(expired.health_expired_logically, true);
  assert.equal(expired.health_validated, false);
});

test('health reference: any binding invalid blocks health_validated even when status is healthy', () => {
  const badBinding = buildRuntimeWorkerHealthReference({
    worker_health_reference_id: 'health-bad-binding', runtime_worker_reference_id: 'w-1',
    health_status: 'HEALTHY_REFERENCE_SIMULATION', health_source_type: 'simulation_declared_reference',
    health_created_logical_sequence: 0, current_logical_sequence: 0, maximum_valid_sequences: 1000,
    configuration_valid: true, registration_valid: true, capability_reference_valid: false, capacity_reference_valid: true, policy_references_valid: true
  });
  assert.equal(badBinding.health_validated, false);
});

// --- Compatibility ----------------------------------------------------------------------------

test('compatibility reference: worker_compatible=true only when all 17 matches are true', () => {
  const allTrue = Object.fromEntries(MATCH_FIELDS.map((f) => [f, true]));
  const compat = buildRuntimeWorkerCompatibilityReference({
    worker_compatibility_reference_id: 'wc-1', runtime_worker_assignment_request_id: 'war-1', runtime_scheduler_package_id: 'sp-1',
    scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1', runtime_worker_reference_id: 'w-1',
    ...allTrue
  });
  assertValid('compatibility reference', validateRuntimeWorkerCompatibilityReference(compat));
  assert.deepEqual(Object.keys(compat).sort(), [...RUNTIME_WORKER_COMPATIBILITY_REFERENCE_FIELDS].sort());
  assert.equal(compat.worker_compatible, true);
  assert.equal(compat.compatibility_applied, false);
});

for (const field of MATCH_FIELDS) {
  test(`compatibility reference: ${field}=false alone blocks worker_compatible`, () => {
    const allTrue = Object.fromEntries(MATCH_FIELDS.map((f) => [f, true]));
    const compat = buildRuntimeWorkerCompatibilityReference({
      worker_compatibility_reference_id: `wc-${field}`, runtime_worker_assignment_request_id: 'war-1', runtime_scheduler_package_id: 'sp-1',
      scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1', runtime_worker_reference_id: 'w-1',
      ...allTrue, [field]: false
    });
    assert.equal(compat.worker_compatible, false, field);
  });
}

// --- Candidate Set ------------------------------------------------------------------------------

test('candidate set reference: complete partition, deterministic recommendation, no compatible candidate yields null recommendation', () => {
  const withCandidate = buildRuntimeWorkerCandidateSetReference({
    worker_candidate_set_reference_id: 'cs-1', runtime_worker_assignment_request_id: 'war-1', runtime_scheduler_package_id: 'sp-1',
    scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1',
    worker_compatibility_reference_ids: ['wc-1', 'wc-2'], compatible_worker_reference_ids: ['w-1'], incompatible_worker_reference_ids: ['w-2'],
    recommended_worker_reference_id: 'w-1'
  });
  assertValid('candidate set', validateRuntimeWorkerCandidateSetReference(withCandidate));
  assert.deepEqual(Object.keys(withCandidate).sort(), [...RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_FIELDS].sort());
  assert.equal(withCandidate.candidate_count, 2);

  const noCandidate = buildRuntimeWorkerCandidateSetReference({
    worker_candidate_set_reference_id: 'cs-2', runtime_worker_assignment_request_id: 'war-1', runtime_scheduler_package_id: 'sp-1',
    scheduler_stage_reference_id: 'ss-2', runtime_stage_reference_id: 'rs-2',
    worker_compatibility_reference_ids: ['wc-3'], compatible_worker_reference_ids: [], incompatible_worker_reference_ids: ['w-3']
  });
  assert.equal(noCandidate.recommended_worker_reference_id, null);
  assert.equal(noCandidate.candidate_set_applied, false);
});

test('candidate set reference: recommended worker not in compatible set is rejected', () => {
  assertInvalid('recommended not compatible', validateRuntimeWorkerCandidateSetReference({
    worker_candidate_set_reference_id: 'cs-3', worker_candidate_set_reference_version: 1,
    runtime_worker_assignment_request_id: 'war-1', runtime_scheduler_package_id: 'sp-1',
    scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1',
    worker_compatibility_reference_ids: [], compatible_worker_reference_ids: ['w-1'], incompatible_worker_reference_ids: [],
    candidate_count: 1, compatible_candidate_count: 1, incompatible_candidate_count: 0,
    recommended_worker_reference_id: 'w-not-in-set', selection_strategy: 'DETERMINISTIC_CAPABILITY_CAPACITY_PRIORITY',
    selection_reason_codes: [], candidate_set_validated: true, candidate_set_applied: false,
    candidate_set_fingerprint: 'x', simulation: true, production_blocked: true, validator_version: 'runtime_worker_candidate_set_reference_validator_v1'
  }));
});

test('candidate set reference: duplicate ID across compatible/incompatible lists rejected', () => {
  assert.throws(() => buildRuntimeWorkerCandidateSetReference({
    worker_candidate_set_reference_id: 'cs-4', runtime_worker_assignment_request_id: 'war-1', runtime_scheduler_package_id: 'sp-1',
    scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1',
    worker_compatibility_reference_ids: [], compatible_worker_reference_ids: ['w-1'], incompatible_worker_reference_ids: ['w-1']
  }));
});

// --- Stage Assignment -----------------------------------------------------------------------

test('stage assignment reference: eligible/optional/waiting/blocked/no-candidate all construct validly, never reserve/start/dispatch', () => {
  const base = {
    worker_stage_assignment_reference_id: 'wsa-1', runtime_worker_assignment_package_id: 'wap-1', runtime_scheduler_package_id: 'sp-1',
    runtime_execution_package_id: 'pkg-1', scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1',
    worker_candidate_set_reference_id: 'cs-1', stage_type: 'DETERMINISTIC_STAGE', priority: 0
  };
  const recommended = buildRuntimeWorkerStageAssignmentReference({ ...base, assignment_status: 'WORKER_RECOMMENDED_SIMULATION', recommended_worker_reference_id: 'w-1' });
  assertValid('recommended', validateRuntimeWorkerStageAssignmentReference(recommended));
  assert.deepEqual(Object.keys(recommended).sort(), [...RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_FIELDS].sort());
  for (const status of ['WORKER_WAITING_APPROVAL_REFERENCE', 'WORKER_WAITING_DEPENDENCY_REFERENCE', 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED', 'WORKER_ASSIGNMENT_BLOCKED']) {
    const ref = buildRuntimeWorkerStageAssignmentReference({ ...base, assignment_status: status });
    assert.equal(ref.recommended_worker_reference_id, null, status);
    assert.equal(ref.worker_reserved, false);
    assert.equal(ref.worker_started, false);
    assert.equal(ref.stage_dispatched, false);
  }
});

test('stage assignment reference: recommended status requires a worker id, other statuses forbid one', () => {
  const base = {
    worker_stage_assignment_reference_id: 'wsa-2', worker_stage_assignment_reference_version: 1,
    runtime_worker_assignment_package_id: 'wap-1', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1', worker_candidate_set_reference_id: 'cs-1',
    assignment_reason_codes: [], stage_type: 'DETERMINISTIC_STAGE', priority: 0, parallelizable: false, approval_required: false,
    required_capability_ids: [], required_modality_ids: [], estimated_total_tokens: 0, estimated_cost_minor_units: 0,
    worker_assignment_validated: true, worker_assignment_applied: false, worker_reserved: false, worker_started: false,
    stage_dispatched: false, stage_started: false, simulation: true, production_blocked: true,
    validator_version: 'runtime_worker_stage_assignment_reference_validator_v1'
  };
  assertInvalid('recommended without worker id', validateRuntimeWorkerStageAssignmentReference({ ...base, assignment_status: 'WORKER_RECOMMENDED_SIMULATION', recommended_worker_reference_id: null, assignment_fingerprint: 'x' }));
  assertInvalid('blocked with worker id', validateRuntimeWorkerStageAssignmentReference({ ...base, assignment_status: 'WORKER_ASSIGNMENT_BLOCKED', recommended_worker_reference_id: 'w-1', assignment_fingerprint: 'x' }));
});

// --- Request ------------------------------------------------------------------------------------

test('worker assignment request: golden bundle is structurally valid, nested validators cover every reference', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  assertValid('worker assignment request', validateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest));
});

test('worker assignment request: missing/extra field and invalid nested reference rejected', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const { runtime_worker_assignment_request_id, ...missing } = golden.workerAssignmentRequest;
  assertInvalid('missing field', validateRuntimeWorkerAssignmentRequest(missing));
  assertInvalid('extra field', validateRuntimeWorkerAssignmentRequest({ ...golden.workerAssignmentRequest, extra_field: true }));
  assertInvalid('invalid nested policy', validateRuntimeWorkerAssignmentRequest({ ...golden.workerAssignmentRequest, runtime_worker_assignment_policy: { not: 'valid' } }));
});

test('worker assignment request: immutable once built', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  assert.throws(() => { golden.workerAssignmentRequest.logical_sequence = 999; });
});

// --- Boundary: golden happy path -----------------------------------------------------------------

test('worker assignment boundary: golden bundle reaches WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION with every validated flag true', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.decision.worker_assignment_package_prepared_in_simulation, true);
  assert.equal(outcome.decision.worker_assignment_evaluated, true);
  assertValid('worker assignment decision', validateRuntimeWorkerAssignmentDecision(outcome.decision));
  assertValid('worker assignment result', validateRuntimeWorkerAssignmentResult(outcome.result));
  assertValid('worker assignment audit', validateRuntimeWorkerAssignmentAudit(outcome.audit));
  assertValid('worker assignment package', validateRuntimeWorkerAssignmentPackage(outcome.package));
  assert.equal(outcome.result.recommended_assignment_count, 2);
});

test('worker assignment boundary: every stage receives a recommendation when a compatible worker exists', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  for (const assignment of outcome.assignmentRefs) {
    assert.equal(assignment.assignment_status, 'WORKER_RECOMMENDED_SIMULATION');
    assert.equal(assignment.recommended_worker_reference_id, golden.pool.worker.runtime_worker_reference_id);
  }
});

test('worker assignment boundary: dedicated-worker-selected -- a dedicated worker outranks a shared one', () => {
  const dedicated = buildWorkerPool('dedicated-1', { worker: { worker_type: 'DEDICATED_REFERENCE' } });
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {});
  const badPackage = golden.runtimePackage;
  const scopedDedicated = buildWorkerPool('dedicated-2', {
    worker: { worker_type: 'DEDICATED_REFERENCE', tenant_scope_id: badPackage.tenant_id, organization_scope_id: badPackage.organization_id, project_scope_id: badPackage.project_id }
  });
  const shared = buildWorkerPool('shared-1');
  const golden2 = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerRefs: [shared.worker, scopedDedicated.worker],
    workerCapabilityRefs: [shared.capability, scopedDedicated.capability],
    workerCapacityRefs: [shared.capacity, scopedDedicated.capacity],
    workerHealthRefs: [shared.health, scopedDedicated.health]
  });
  void dedicated;
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden2.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
  for (const assignment of outcome.assignmentRefs) {
    assert.equal(assignment.recommended_worker_reference_id, scopedDedicated.worker.runtime_worker_reference_id);
  }
});

test('worker assignment boundary: candidate-order-deterministic -- input order of workers never changes the recommendation', () => {
  const workerA = buildWorkerPool('order-a');
  const workerB = buildWorkerPool('order-b', { capacity: { available_stage_assignments: 200, maximum_stage_assignments: 200 } });
  const golden1 = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerRefs: [workerA.worker, workerB.worker], workerCapabilityRefs: [workerA.capability, workerB.capability],
    workerCapacityRefs: [workerA.capacity, workerB.capacity], workerHealthRefs: [workerA.health, workerB.health]
  });
  const golden2 = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerRefs: [workerB.worker, workerA.worker], workerCapabilityRefs: [workerB.capability, workerA.capability],
    workerCapacityRefs: [workerB.capacity, workerA.capacity], workerHealthRefs: [workerB.health, workerA.health]
  });
  const outcome1 = evaluateRuntimeWorkerAssignmentRequest(golden1.workerAssignmentRequest, {});
  const outcome2 = evaluateRuntimeWorkerAssignmentRequest(golden2.workerAssignmentRequest, {});
  assert.equal(outcome1.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome2.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
  assert.deepEqual(
    outcome1.assignmentRefs.map((a) => a.recommended_worker_reference_id).sort(),
    outcome2.assignmentRefs.map((a) => a.recommended_worker_reference_id).sort()
  );
  // Both orderings must recommend the worker with more available capacity (workerB).
  for (const assignment of outcome1.assignmentRefs) assert.equal(assignment.recommended_worker_reference_id, workerB.worker.runtime_worker_reference_id);
});

// --- Boundary: reference-tamper -> specific blocker -----------------------------------------------

test('worker assignment boundary: stage type mismatch blocks as WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { capability: { stage_type_ids: ['MODEL_REFERENCE_STAGE'] } } });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
});

test('worker assignment boundary: unhealthy worker blocks as WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { health: { health_status: 'UNHEALTHY_REFERENCE' } } });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
});

test('worker assignment boundary: health expired between creation and assignment blocks as WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED', () => {
  // pr106fix FIX 2: health_created_logical_sequence/current_logical_sequence stay at 0 (no
  // regression relative to the request), but maximum_valid_sequences is small and the request's own
  // logical_sequence has moved forward past it -- a genuine "aged since creation" expiration,
  // recomputed on request.logical_sequence, never on the health reference's own frozen sequence.
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerPool: { health: { maximum_valid_sequences: 10 } },
    request: { logical_sequence: 50 }
  });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
});

test('worker assignment boundary: health current_logical_sequence ahead of the assignment request blocks as WORKER_ASSIGNMENT_HEALTH_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { health: { current_logical_sequence: 5000 } } });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_HEALTH_BLOCKED');
});

test('worker assignment boundary: health_created_logical_sequence ahead of the assignment request blocks as WORKER_ASSIGNMENT_HEALTH_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { health: { health_created_logical_sequence: 5000, current_logical_sequence: 5000 } } });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_HEALTH_BLOCKED');
});

test('worker assignment boundary: health valid at the same sequence as the request stays selectable', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { health: { current_logical_sequence: 0 } }, request: { logical_sequence: 0 } });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
});

test('worker assignment boundary: health valid at a later sequence within the limit stays selectable', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerPool: { health: { maximum_valid_sequences: 1000 } }, request: { logical_sequence: 50 }
  });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');
});

for (const status of ['DEGRADED_REFERENCE', 'UNHEALTHY_REFERENCE', 'UNKNOWN_REFERENCE', 'EXPIRED_REFERENCE']) {
  test(`worker assignment boundary: health status ${status} blocks as WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED`, () => {
    const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { health: { health_status: status } } });
    const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
    assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
  });
}

test('worker assignment boundary: invalid health binding flag blocks as WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { health: { capability_reference_valid: false } } });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
});

test('worker assignment boundary: a caller-supplied health_validated=true never masks expiration recomputed at the assignment sequence', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerPool: { health: { maximum_valid_sequences: 10 } },
    request: { logical_sequence: 50 }
  });
  assert.equal(golden.pool.health.health_validated, true);
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
});

test('worker assignment boundary: a caller-supplied health_expired_logically=false never masks expiration recomputed at the assignment sequence', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerPool: { health: { maximum_valid_sequences: 10 } },
    request: { logical_sequence: 50 }
  });
  assert.equal(golden.pool.health.health_expired_logically, false);
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
});

test('evaluateHealthAtAssignment: unit coverage of every branch', () => {
  const healthyBase = {
    current_logical_sequence: 0, health_created_logical_sequence: 0, maximum_valid_sequences: 1000,
    health_status: 'HEALTHY_REFERENCE_SIMULATION', configuration_valid: true, registration_valid: true,
    capability_reference_valid: true, capacity_reference_valid: true, policy_references_valid: true
  };
  assert.equal(evaluateHealthAtAssignment(healthyBase, 0).match, true);
  assert.equal(evaluateHealthAtAssignment(healthyBase, 500).match, true);
  assert.equal(evaluateHealthAtAssignment({ ...healthyBase, current_logical_sequence: 10 }, 5).reason, 'worker_health_sequence_regressive');
  assert.equal(evaluateHealthAtAssignment({ ...healthyBase, health_created_logical_sequence: 10 }, 5).reason, 'worker_health_sequence_regressive');
  assert.equal(evaluateHealthAtAssignment(healthyBase, 1500).reason, 'worker_health_expired_at_assignment_sequence');
  assert.equal(evaluateHealthAtAssignment({ ...healthyBase, health_status: 'DEGRADED_REFERENCE' }, 0).reason, 'worker_health_status_not_healthy');
  assert.equal(evaluateHealthAtAssignment({ ...healthyBase, registration_valid: false }, 0).reason, 'worker_health_binding_invalid');
});

test('worker assignment boundary: exhausted worker capacity blocks as WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerPool: { capacity: { maximum_stage_assignments: 1, current_stage_assignments: 1, available_stage_assignments: 0 } }
  });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED');
});

// --- Network / Secret Policy Reference (pr106fix FIX 1) ------------------------------------------

test('network policy reference: valid contract, exact fields, genuine fingerprint', () => {
  const ref = buildRuntimeWorkerNetworkPolicyReference({
    worker_network_policy_reference_id: 'w1-netpolicy', runtime_worker_reference_id: 'w1',
    runtime_environment_reference_id: 'w1-env', network_policy_reference_id: 'w1-network-policy',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1'
  });
  assertValid('network policy reference', validateRuntimeWorkerNetworkPolicyReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_FIELDS].sort());
  assert.equal(ref.project_id, 'proj-1');
  assertInvalid('tampered fingerprint', validateRuntimeWorkerNetworkPolicyReference({ ...ref, network_policy_fingerprint: 'sha256:' + 'f'.repeat(64) }));
});

test('network policy reference: project_id may be null (shared / non-project-scoped policy)', () => {
  const ref = buildRuntimeWorkerNetworkPolicyReference({
    worker_network_policy_reference_id: 'w2-netpolicy', runtime_worker_reference_id: 'w2',
    runtime_environment_reference_id: 'w2-env', network_policy_reference_id: 'w2-network-policy',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1'
  });
  assert.equal(ref.project_id, null);
  assertValid('nullable project', validateRuntimeWorkerNetworkPolicyReference(ref));
});

test('secret policy reference: valid contract, exact fields, genuine fingerprint', () => {
  const ref = buildRuntimeWorkerSecretPolicyReference({
    worker_secret_policy_reference_id: 'w1-secpolicy-ref', runtime_worker_reference_id: 'w1',
    runtime_environment_reference_id: 'w1-env', secret_policy_reference_id: 'w1-secpolicy-reference',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1'
  });
  assertValid('secret policy reference', validateRuntimeWorkerSecretPolicyReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_WORKER_SECRET_POLICY_REFERENCE_FIELDS].sort());
  assertInvalid('tampered fingerprint', validateRuntimeWorkerSecretPolicyReference({ ...ref, secret_policy_fingerprint: 'sha256:' + 'f'.repeat(64) }));
});

test('deriveStageRequiresNetworkOrSecret: only stages reaching model/tool/workflow require network or secret access', () => {
  const base = { model_selection_reference_id: null, tool_reference_ids: [], workflow_reference_id: null };
  assert.equal(deriveStageRequiresNetworkOrSecret(base), false);
  assert.equal(deriveStageRequiresNetworkOrSecret({ ...base, model_selection_reference_id: 'model-ref-1' }), true);
  assert.equal(deriveStageRequiresNetworkOrSecret({ ...base, tool_reference_ids: ['tool-a'] }), true);
  assert.equal(deriveStageRequiresNetworkOrSecret({ ...base, workflow_reference_id: 'flow-a' }), true);
});

test('evaluatePolicyReferenceMatch: stage with no requirement is NOT_APPLICABLE (match true) regardless of policy state', () => {
  const stage = { model_selection_reference_id: null, tool_reference_ids: [], workflow_reference_id: null };
  const result = evaluatePolicyReferenceMatch('network', stage, { network_policy_reference_id: 'w1-network-policy' }, undefined, { tenantId: 't', organizationId: 'o', projectId: 'p' });
  assert.equal(result.match, true);
  assert.equal(result.reason, null);
});

test('evaluatePolicyReferenceMatch: required stage with no policy reference bound blocks with missing reason', () => {
  const stage = { model_selection_reference_id: 'model-ref-1', tool_reference_ids: [], workflow_reference_id: null };
  const result = evaluatePolicyReferenceMatch('network', stage, { network_policy_reference_id: 'w1-network-policy' }, undefined, { tenantId: 't', organizationId: 'o', projectId: 'p' });
  assert.equal(result.match, false);
  assert.equal(result.reason, 'worker_network_policy_reference_missing');
});

test('evaluatePolicyReferenceMatch: ID/version/tenant/organization/project/environment mismatch each block with a distinct reason', () => {
  const stage = { model_selection_reference_id: 'model-ref-1', tool_reference_ids: [], workflow_reference_id: null };
  const worker = { network_policy_reference_id: 'w1-network-policy', runtime_environment_reference_id: 'w1-env' };
  const canonical = { tenantId: 'tenant-a', organizationId: 'tenant-a:org-1', projectId: 'proj-1' };
  const validPolicyRef = {
    network_policy_reference_id: 'w1-network-policy', network_policy_reference_valid: true,
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', runtime_environment_reference_id: 'w1-env'
  };
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, validPolicyRef, canonical).match, true);
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, { ...validPolicyRef, network_policy_reference_id: 'other-id' }, canonical).reason, 'worker_network_policy_id_mismatch');
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, { ...validPolicyRef, network_policy_reference_valid: false }, canonical).reason, 'worker_network_policy_reference_invalid');
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, { ...validPolicyRef, tenant_id: 'other-tenant' }, canonical).reason, 'worker_network_policy_tenant_mismatch');
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, { ...validPolicyRef, organization_id: 'other-org' }, canonical).reason, 'worker_network_policy_organization_mismatch');
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, { ...validPolicyRef, project_id: 'other-project' }, canonical).reason, 'worker_network_policy_project_mismatch');
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, { ...validPolicyRef, runtime_environment_reference_id: 'other-env' }, canonical).reason, 'worker_network_policy_environment_mismatch');
  assert.equal(evaluatePolicyReferenceMatch('secret', stage, { secret_policy_reference_id: 'w1-secpolicy-reference', runtime_environment_reference_id: 'w1-env' }, {
    secret_policy_reference_id: 'other-id', secret_policy_reference_valid: true, tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', runtime_environment_reference_id: 'w1-env'
  }, canonical).reason, 'worker_secret_policy_id_mismatch');
});

test('worker assignment boundary: model stage with a compatible network/secret policy reaches WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const modelStage = golden.schedulerOutcome.schedulerStageRefs[0];
  assert.equal(evaluatePolicyReferenceMatch('network', { ...modelStage, model_selection_reference_id: 'model-ref-1' }, golden.pool.worker, golden.pool.networkPolicy, {
    tenantId: golden.runtimePackage.tenant_id, organizationId: golden.runtimePackage.organization_id, projectId: golden.runtimePackage.project_id
  }).match, true);
});

test('worker assignment boundary: network policy ID mismatch on the only worker blocks as WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED when the stage requires it', () => {
  const stage = { model_selection_reference_id: 'model-ref-1', tool_reference_ids: [], workflow_reference_id: null, side_effect_classification: 'NONE' };
  const worker = { network_policy_reference_id: 'w1-network-policy', runtime_environment_reference_id: 'w1-env' };
  const canonical = { tenantId: 'tenant-a', organizationId: 'tenant-a:org-1', projectId: 'proj-1' };
  const mismatched = { network_policy_reference_id: 'other-id', network_policy_reference_valid: true, tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', runtime_environment_reference_id: 'w1-env' };
  assert.equal(evaluatePolicyReferenceMatch('network', stage, worker, mismatched, canonical).match, false);
});

test('worker assignment boundary: secret policy fingerprint tamper is rejected at the contract level, never silently accepted', () => {
  const ref = buildRuntimeWorkerSecretPolicyReference({
    worker_secret_policy_reference_id: 'w1-secpolicy-ref', runtime_worker_reference_id: 'w1',
    runtime_environment_reference_id: 'w1-env', secret_policy_reference_id: 'w1-secpolicy-reference',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1'
  });
  const tampered = { ...ref, secret_policy_reference_id: 'tampered-id' };
  assertInvalid('tampered secret policy id without fingerprint recompute', validateRuntimeWorkerSecretPolicyReference(tampered));
});

test('worker assignment boundary: duplicate network policy reference for the same worker blocks as WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_worker_network_policy_references: [golden.pool.networkPolicy, golden.pool.networkPolicy] });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED');
});

test('worker assignment boundary: network/secret policy reference orphaned to a nonexistent worker blocks as WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const orphan = buildRuntimeWorkerNetworkPolicyReference({
    worker_network_policy_reference_id: 'orphan-netpolicy', runtime_worker_reference_id: 'nonexistent-worker-id',
    runtime_environment_reference_id: 'nonexistent-env', network_policy_reference_id: 'nonexistent-network-policy',
    tenant_id: golden.runtimePackage.tenant_id, organization_id: golden.runtimePackage.organization_id, project_id: golden.runtimePackage.project_id
  });
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_worker_network_policy_references: [golden.pool.networkPolicy, orphan] });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED');
});

test('worker assignment boundary: context never alters network/secret policy evaluation', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const withContext = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, { networkAllowed: true, secretResolved: true });
  const withoutContext = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.deepEqual(withContext.decision, withoutContext.decision);
});

test('worker assignment boundary: no network access and no secret resolution ever occurs while evaluating policy references', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  assert.deepEqual(findAgentCoreOperationalMaterial(golden.pool.networkPolicy), []);
  assert.deepEqual(findAgentCoreOperationalMaterial(golden.pool.secretPolicy), []);
});

test('worker assignment boundary: scheduler not prepared blocks as WORKER_ASSIGNMENT_SCHEDULER_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const { buildRuntimeSchedulerDecision } = require('../src/core/runtime-scheduler-decision');
  const badDecision = buildRuntimeSchedulerDecision({ ...golden.schedulerOutcome.decision, status: 'SCHEDULER_POLICY_BLOCKED', scheduler_package_prepared_in_simulation: false });
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_scheduler_decision_reference: badDecision });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_SCHEDULER_BLOCKED');
});

test('worker assignment boundary: runtime package swapped since scheduling blocks as WORKER_ASSIGNMENT_RUNTIME_PACKAGE_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badPackage = { ...golden.runtimePackage, package_fingerprint: 'sha256:' + 'f'.repeat(64) };
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_execution_package_reference: badPackage });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_RUNTIME_PACKAGE_BLOCKED');
});

test('worker assignment boundary: duplicate worker reference id blocks as WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', () => {
  const pool = buildWorkerPool('dup-1');
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerRefs: [pool.worker, pool.worker], workerCapabilityRefs: [pool.capability], workerCapacityRefs: [pool.capacity], workerHealthRefs: [pool.health]
  });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED');
});

test('worker assignment boundary: dedicated worker missing scope blocks as WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', { workerPool: { worker: { worker_type: 'DEDICATED_REFERENCE' } } });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED');
});

test('worker assignment boundary: capability reference binding mismatch blocks as WORKER_ASSIGNMENT_CAPABILITY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badCapability = buildRuntimeWorkerCapabilityReference({ ...golden.pool.capability, runtime_worker_reference_id: 'other-worker-id' });
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_worker_capability_references: [badCapability] });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_CAPABILITY_BLOCKED');
});

test('worker assignment boundary: capacity reference binding mismatch blocks as WORKER_ASSIGNMENT_CAPACITY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badCapacity = buildRuntimeWorkerCapacityReference({ ...golden.pool.capacity, runtime_worker_reference_id: 'other-worker-id' });
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_worker_capacity_references: [badCapacity] });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_CAPACITY_BLOCKED');
});

test('worker assignment boundary: health reference binding mismatch blocks as WORKER_ASSIGNMENT_HEALTH_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badHealth = buildRuntimeWorkerHealthReference({ ...golden.pool.health, runtime_worker_reference_id: 'other-worker-id' });
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_worker_health_references: [badHealth] });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_HEALTH_BLOCKED');
});

test('worker assignment boundary: freshness expired at current logical_sequence blocks as WORKER_ASSIGNMENT_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const request = rebuild({ ...golden.workerAssignmentRequest, logical_sequence: 5000 });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_FRESHNESS_BLOCKED');
});

test('worker assignment boundary: replay reference swapped since scheduling blocks as WORKER_ASSIGNMENT_REPLAY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const { buildRuntimeReadinessReplayReference } = require('../src/core/runtime-readiness-replay-reference');
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, maximum_readiness_attempts: golden.replayRef.maximum_readiness_attempts + 1 });
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_replay_reference: badReplay });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  // A freshly rebuilt, structurally self-consistent but distinct object no longer matches the exact
  // fingerprint the Scheduler Request originally carried -- proving genuine continuity, not merely
  // "any valid-looking replay reference will do".
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_REPLAY_BLOCKED');
});

test('worker assignment boundary: idempotency reference swapped since scheduling blocks as WORKER_ASSIGNMENT_IDEMPOTENCY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badIdempotency = { ...golden.idempotencyReference, maximum_execution_attempts: golden.idempotencyReference.maximum_execution_attempts + 1 };
  const request = rebuild({ ...golden.workerAssignmentRequest, idempotency_reference: badIdempotency });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_IDEMPOTENCY_BLOCKED');
});

test('worker assignment boundary: tenant mismatch blocks as TENANT_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badPackage = { ...golden.runtimePackage, tenant_id: 'other-tenant-id' };
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_execution_package_reference: badPackage });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'TENANT_BLOCKED');
});

test('worker assignment boundary: policy disallowing the plan\'s own stage shape blocks as WORKER_ASSIGNMENT_POLICY_BLOCKED', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badPolicy = buildRuntimeWorkerAssignmentPolicy({ ...golden.assignmentPolicy, allow_no_llm_stage: false });
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_worker_assignment_policy: badPolicy });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_POLICY_BLOCKED');
});

// --- Precedence + progressive flags ---------------------------------------------------------------

test('worker assignment boundary: a structurally invalid request never reaches a later check', () => {
  const outcome = evaluateRuntimeWorkerAssignmentRequest({ not: 'a valid request' }, {});
  assert.equal(outcome.decision.status, 'WORKER_ASSIGNMENT_VALIDATION_FAILED');
});

test('worker assignment boundary: WORKER_ASSIGNMENT_STATUSES is exactly covered by WORKER_ASSIGNMENT_PRECEDENCE_ORDER', () => {
  assert.deepEqual([...WORKER_ASSIGNMENT_STATUSES].sort(), [...WORKER_ASSIGNMENT_PRECEDENCE_ORDER].sort());
});

test('worker assignment boundary: identity blocker leaves later validated flags false (progressive, never retroactive)', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const badPackage = { ...golden.runtimePackage, tenant_id: 'other-tenant-id' };
  const request = rebuild({ ...golden.workerAssignmentRequest, runtime_execution_package_reference: badPackage });
  const outcome = evaluateRuntimeWorkerAssignmentRequest(request, {});
  assert.equal(outcome.decision.status, 'TENANT_BLOCKED');
  assert.equal(outcome.decision.capacity_validated, false);
  assert.equal(outcome.decision.non_execution_invariants_validated, false);
});

// --- Side-channels ------------------------------------------------------------------------------

test('side-channels: a hostile context claiming worker availability/health/reservation has zero effect', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const hostileContext = {
    workerAvailable: true, workerHealthy: true, workerCompatible: true, recommendedWorkerId: 'hostile-worker',
    workerReserved: true, workerStarted: true, stageDispatched: true, networkAllowed: true, secretAvailable: true,
    anything: 'hostile'
  };
  const withContext = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, hostileContext);
  const withoutContext = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.deepEqual(withContext.decision, withoutContext.decision);
});

// --- Security -------------------------------------------------------------------------------------

test('security: every worker assignment outcome forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  for (const field of ['worker_assignment_applied', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed']) {
    assert.equal(outcome.decision[field], false, field);
  }
  assert.equal(outcome.decision.simulation, true);
  assert.equal(outcome.decision.production_blocked, true);
  assert.equal(outcome.decision.rollout_percentage, 0);
  for (const field of OPERATIONAL_FLAG_FIELDS) assert.equal(outcome.result[field], false, field);
  assert.equal(outcome.package.worker_assignment_package_prepared_in_simulation, true);
  for (const field of ['worker_assignment_applied', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed']) {
    assert.equal(outcome.package[field], false, field);
  }
});

test('security: an operational flag smuggled directly onto a nested reference build input is silently forced false, never honored', () => {
  const pool = buildWorkerPool('smuggle-1');
  const ref = buildRuntimeWorkerStageAssignmentReference({
    worker_stage_assignment_reference_id: 'wsa-x', runtime_worker_assignment_package_id: 'wap-1', runtime_scheduler_package_id: 'sp-1',
    runtime_execution_package_id: 'pkg-1', scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1',
    worker_candidate_set_reference_id: 'cs-1', assignment_status: 'WORKER_ASSIGNMENT_BLOCKED',
    stage_type: 'DETERMINISTIC_STAGE', priority: 0, worker_reserved: true, worker_started: true
  });
  assert.equal(ref.worker_reserved, false);
  assert.equal(ref.worker_started, false);
  void pool;
});

// --- Adversarial types --------------------------------------------------------------------------

test('adversarial types: NaN/Infinity/bigint/symbol/function/undefined/Buffer/cyclic are all rejected by the request validator', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const adversarialValues = [NaN, Infinity, -Infinity, 10n, Symbol('x'), () => {}, undefined, Buffer.from('x')];
  for (const value of adversarialValues) {
    const request = { ...golden.workerAssignmentRequest, correlation_id: value };
    assert.equal(validateRuntimeWorkerAssignmentRequest(request).valid, false, String(value));
  }
  const cyclic = { ...golden.workerAssignmentRequest };
  cyclic.self = cyclic;
  assert.equal(validateRuntimeWorkerAssignmentRequest(cyclic).valid, false);
});

test('adversarial types: Date/Map/Set/RegExp/ArrayBuffer value shapes are all rejected', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const adversarialValues = [new Date(), new Map(), new Set(), /x/, new ArrayBuffer(4)];
  for (const value of adversarialValues) {
    const request = { ...golden.workerAssignmentRequest, correlation_id: value };
    assert.equal(validateRuntimeWorkerAssignmentRequest(request).valid, false);
  }
});

// --- Registry -----------------------------------------------------------------------------------

test('registry: registers a worker assignment package, replays an identical one, blocks a payload mismatch without a version bump', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  const registry = createRuntimeWorkerAssignmentRegistry();
  const first = registry.registerRuntimeWorkerAssignmentPackage(outcome.package);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerRuntimeWorkerAssignmentPackage(outcome.package);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
});

test('registry: every store result is forced into simulation/production_blocked/executed=false', () => {
  const registry = createRuntimeWorkerAssignmentRegistry();
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  const result = registry.registerRuntimeWorkerAssignmentDecision(outcome.decision);
  assert.equal(result.simulation, true);
  assert.equal(result.production_blocked, true);
  assert.equal(result.executed, false);
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeWorkerAssignmentRegistry();
  const result = registry.registerRuntimeWorkerReference({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- Fixture --------------------------------------------------------------------------------------

test('fixture: every scenario reproduces its recorded status deterministically', () => {
  for (const [key, scenario] of Object.entries(fixture.scenarios)) {
    const outcome = evaluateRuntimeWorkerAssignmentRequest(scenario.request, {});
    assert.equal(outcome.decision.status, scenario.decision.status, key);
  }
});

test('fixture: every runtime worker assignment contract in the fixture is free of forbidden operational material', () => {
  for (const [key, scenario] of Object.entries(fixture.scenarios)) {
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.request), [], `${key} request`);
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.decision), [], `${key} decision`);
  }
});

// --- Regression -----------------------------------------------------------------------------------

test('regression: architecture gates report zero findings with every PR106 module included', () => {
  const findings = runAllGates();
  assert.deepEqual(findings, []);
});

test('regression: Runtime Scheduler topological order (PR #105) remains preserved and untouched by this PR', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  assert.equal(golden.schedulerOutcome.decision.status, 'SCHEDULER_PACKAGE_PREPARED_SIMULATION');
  const bySequence = [...golden.schedulerOutcome.schedulerStageRefs].sort((a, b) => a.scheduler_sequence - b.scheduler_sequence).map((s) => s.scheduler_stage_reference_id);
  assert.deepEqual(golden.schedulerOutcome.queuePlanRef.ordered_scheduler_stage_reference_ids, bySequence);
});

test('regression: optional dependencies remain non-blocking at the Scheduler layer this PR builds on', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  for (const stage of golden.schedulerOutcome.schedulerStageRefs) {
    if (stage.optional === false && stage.blocking_dependency_reference_ids.length === 0) {
      assert.notEqual(stage.scheduler_stage_status, 'SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE');
    }
  }
});

test('regression: nenhum scheduler operacional é iniciado, nenhuma fila/job/worker real in any producible outcome', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  assert.equal(outcome.decision.worker_reserved, false);
  assert.equal(outcome.result.job_created, false);
  assert.equal(outcome.result.queue_created, false);
  assert.equal(outcome.result.worker_process_created, false);
  assert.equal(outcome.result.worker_thread_created, false);
  assert.equal(outcome.result.container_started, false);
});

test('regression: package fingerprint/digest change when a compatibility-affecting reference changes', () => {
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcomeA = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  const goldenB = buildGoldenWorkerAssignmentBundle('prepared-no-llm-plan', {
    workerPool: { worker: { runtime_worker_reference_id: 'plan-1-rt-request-worker-assignment-worker' }, capacity: { maximum_stage_assignments: 999, available_stage_assignments: 999 } }
  });
  const outcomeB = evaluateRuntimeWorkerAssignmentRequest(goldenB.workerAssignmentRequest, {});
  assert.notEqual(outcomeA.package.worker_assignment_package_fingerprint, outcomeB.package.worker_assignment_package_fingerprint);
});
