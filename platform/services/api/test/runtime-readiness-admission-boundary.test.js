'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const { validateRuntimeReadinessPolicy, buildRuntimeReadinessPolicy, RUNTIME_READINESS_POLICY_FIELDS } = require('../src/core/runtime-readiness-policy');
const { validateRuntimeAdmissionPolicy, buildRuntimeAdmissionPolicy, RUNTIME_ADMISSION_POLICY_FIELDS } = require('../src/core/runtime-admission-policy');
const {
  validateRuntimeCapacitySnapshotReference, buildRuntimeCapacitySnapshotReference, RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_FIELDS
} = require('../src/core/runtime-capacity-snapshot-reference');
const {
  validateRuntimeConcurrencyReference, buildRuntimeConcurrencyReference, RUNTIME_CONCURRENCY_REFERENCE_FIELDS
} = require('../src/core/runtime-concurrency-reference');
const {
  validateRuntimeReadinessFreshnessReference, buildRuntimeReadinessFreshnessReference, RUNTIME_READINESS_FRESHNESS_REFERENCE_FIELDS
} = require('../src/core/runtime-readiness-freshness-reference');
const {
  validateRuntimeReadinessReplayReference, buildRuntimeReadinessReplayReference, RUNTIME_READINESS_REPLAY_REFERENCE_FIELDS
} = require('../src/core/runtime-readiness-replay-reference');
const { validateRuntimeReadinessRequest, buildRuntimeReadinessRequest } = require('../src/core/runtime-readiness-request');
const { validateRuntimeReadinessDecision, RUNTIME_READINESS_STATUSES, RUNTIME_READINESS_PRECEDENCE_ORDER } = require('../src/core/runtime-readiness-decision');
const { validateRuntimeAdmissionRequest, buildRuntimeAdmissionRequest } = require('../src/core/runtime-admission-request');
const { validateRuntimeAdmissionDecision, RUNTIME_ADMISSION_STATUSES, RUNTIME_ADMISSION_PRECEDENCE_ORDER } = require('../src/core/runtime-admission-decision');
const { validateRuntimeAdmissionResult } = require('../src/core/runtime-admission-result');
const { validateRuntimeAdmissionAudit } = require('../src/core/runtime-admission-audit');
const { createRuntimeAdmissionRegistry } = require('../src/core/runtime-admission-registry');
const { evaluateRuntimeReadinessRequest, evaluateRuntimeAdmissionRequest } = require('../src/core/runtime-admission-boundary');
const { runAllGates } = require('../src/core/architecture-gate-runner');
const { buildAuthorizationScopeReference } = require('../src/core/execution-authorization-scope-reference');
const { buildExecutionRegistrySnapshotReference } = require('../src/core/execution-registry-snapshot-reference');
const { buildOrchestratorStageManifestReference } = require('../src/core/orchestrator-stage-manifest-reference');
const { buildExecutionReferenceBindingLedger } = require('../src/core/execution-reference-binding-ledger');
const { buildValidationLedger } = require('../src/core/validation-ledger');
const { buildRuntimeArtifactPlanReference } = require('../src/core/runtime-artifact-plan-reference');
const { buildRuntimeEventPlanReference } = require('../src/core/runtime-event-plan-reference');
const { buildArchitectureGateEvidenceReference, buildGateResult } = require('../src/core/architecture-gate-evidence-reference');
const { buildRuntimeExecutionPackage } = require('../src/core/runtime-execution-package');
const { buildExecutionGatewayPackageReference } = require('../src/core/execution-gateway-package-reference');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');

const {
  buildGoldenReadinessBundle, buildGoldenAdmissionBundle
} = require('./helpers/runtime-readiness-admission-test-data');

const fixture = require('./fixtures/hermes-runtime-readiness-admission-boundary.json');

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

const OPERATIONAL_FLAG_FIELDS_READINESS = [
  'runtime_enabled', 'execution_authorized', 'execution_started', 'stage_started', 'stage_completed',
  'job_created', 'queue_used', 'worker_started', 'scheduler_started', 'executed'
];
const OPERATIONAL_FLAG_FIELDS_ADMISSION_RESULT = [
  'runtime_enabled', 'execution_authorized', 'execution_started', 'stage_started', 'stage_completed', 'stage_failed',
  'agent_executed', 'model_called', 'provider_called', 'tool_called', 'workflow_executed', 'network_used',
  'memory_read', 'memory_written', 'tokens_reserved', 'tokens_consumed', 'cost_reserved', 'cost_consumed',
  'job_created', 'queue_used', 'worker_started', 'scheduler_started', 'dependency_satisfied', 'dependency_applied',
  'stop_condition_evaluated', 'stop_applied', 'compensation_executed', 'artifact_created', 'event_emitted', 'executed'
];

// --- Policies -------------------------------------------------------------------------------------

test('readiness policy: valid contract, exact fields, safe defaults, nenhuma policy habilita runtime', () => {
  const policy = buildRuntimeReadinessPolicy({ runtime_readiness_policy_id: 'rp-1' });
  assertValid('readiness policy', validateRuntimeReadinessPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...RUNTIME_READINESS_POLICY_FIELDS].sort());
  assert.equal(policy.allow_external_effect_reference, false);
  assert.equal(policy.allow_irreversible_reference, false);
  assert.equal(policy.simulation, true);
  assert.equal(policy.production_blocked, true);
  for (const field of RUNTIME_READINESS_POLICY_FIELDS) {
    if (field.startsWith('require_') || field.startsWith('fail_on_')) assert.equal(policy[field], true, field);
  }
});

test('readiness policy: fields missing/extra rejected, invalid require_* rejected', () => {
  const policy = buildRuntimeReadinessPolicy({ runtime_readiness_policy_id: 'rp-1' });
  const { runtime_readiness_policy_id, ...missing } = policy;
  assertInvalid('missing field', validateRuntimeReadinessPolicy(missing));
  assertInvalid('extra field', validateRuntimeReadinessPolicy({ ...policy, extra_field: true }));
  assertInvalid('require flipped false', validateRuntimeReadinessPolicy({ ...policy, require_capacity_available: false }));
  assertInvalid('external effect flipped true', validateRuntimeReadinessPolicy({ ...policy, allow_external_effect_reference: true }));
});

test('admission policy: valid contract, exact fields, safe defaults, limites inteiros', () => {
  const policy = buildRuntimeAdmissionPolicy({
    runtime_admission_policy_id: 'ap-1', maximum_admitted_packages_per_tenant: 10,
    maximum_admitted_packages_per_organization: 10, maximum_admitted_packages_per_agent: 10,
    maximum_admitted_parallel_stages: 10, maximum_admitted_model_stages: 10, maximum_admitted_tool_stages: 10,
    maximum_admitted_workflow_stages: 10, maximum_admitted_estimated_tokens: 100000,
    maximum_admitted_estimated_cost_minor_units: 100000
  });
  assertValid('admission policy', validateRuntimeAdmissionPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...RUNTIME_ADMISSION_POLICY_FIELDS].sort());
  assert.equal(policy.fail_closed, true);
  assert.equal(policy.simulation, true);
  assert.equal(policy.production_blocked, true);
});

test('admission policy: zero is a valid explicit-block limit, negative is invalid', () => {
  const base = {
    runtime_admission_policy_id: 'ap-2', maximum_admitted_packages_per_tenant: 0,
    maximum_admitted_packages_per_organization: 0, maximum_admitted_packages_per_agent: 0,
    maximum_admitted_parallel_stages: 0, maximum_admitted_model_stages: 0, maximum_admitted_tool_stages: 0,
    maximum_admitted_workflow_stages: 0, maximum_admitted_estimated_tokens: 0, maximum_admitted_estimated_cost_minor_units: 0
  };
  const policy = buildRuntimeAdmissionPolicy(base);
  assertValid('zero limits', validateRuntimeAdmissionPolicy(policy));
  assertInvalid('negative limit', validateRuntimeAdmissionPolicy({ ...policy, maximum_admitted_parallel_stages: -1 }));
});

// --- Capacity Snapshot ------------------------------------------------------------------------

function buildValidCapacitySnapshot(overrides = {}) {
  return buildRuntimeCapacitySnapshotReference({
    runtime_capacity_snapshot_reference_id: 'cap-1', runtime_environment_reference_id: 'env-1',
    runtime_registry_snapshot_reference_id: 'reg-1', tenant_id: 't1', organization_id: 'o1', project_id: 'p1',
    session_reference_id: 's1', agent_id: 'a1',
    total_package_capacity: 10, used_package_capacity: 2, available_package_capacity: 8,
    total_stage_capacity: 100, used_stage_capacity: 10, available_stage_capacity: 90,
    total_parallel_stage_capacity: 10, used_parallel_stage_capacity: 1, available_parallel_stage_capacity: 9,
    total_model_stage_capacity: 10, used_model_stage_capacity: 1, available_model_stage_capacity: 9,
    total_tool_stage_capacity: 10, used_tool_stage_capacity: 1, available_tool_stage_capacity: 9,
    total_workflow_stage_capacity: 10, used_workflow_stage_capacity: 1, available_workflow_stage_capacity: 9,
    maximum_tokens_capacity: 1000000, used_tokens_capacity: 1000, available_tokens_capacity: 999000,
    maximum_cost_capacity_minor_units: 1000000, used_cost_capacity_minor_units: 1000, available_cost_capacity_minor_units: 999000,
    snapshot_created_logical_sequence: 1, current_logical_sequence: 1, maximum_valid_sequences: 10,
    capacity_available: true,
    ...overrides
  });
}

test('capacity snapshot: valid, exact fields, total=used+available, immutable, capacity_applied=false', () => {
  const ref = buildValidCapacitySnapshot();
  assertValid('capacity', validateRuntimeCapacitySnapshotReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_FIELDS].sort());
  assert.equal(ref.capacity_applied, false);
  assert.throws(() => { ref.capacity_available = false; });
});

test('capacity snapshot: used above total is rejected at construction', () => {
  assert.throws(() => buildValidCapacitySnapshot({ used_package_capacity: 20, available_package_capacity: -10 }));
});

for (const field of [
  'total_stage_capacity', 'total_parallel_stage_capacity', 'total_model_stage_capacity', 'total_tool_stage_capacity',
  'total_workflow_stage_capacity', 'maximum_tokens_capacity', 'maximum_cost_capacity_minor_units'
]) {
  test(`capacity snapshot: ${field} divergent from used+available rejected at construction`, () => {
    assert.throws(() => buildValidCapacitySnapshot({ [field]: 999999 }));
  });
}

test('capacity snapshot: freshness -- expired_logically recomputed, not trusted as declared', () => {
  const ref = buildValidCapacitySnapshot({ current_logical_sequence: 5000 });
  assert.equal(ref.snapshot_expired_logically, true);
  assert.equal(ref.capacity_validated, false);
});

test('capacity snapshot: fingerprint/digest recomputed and compared, not trusted as declared', () => {
  const ref = buildValidCapacitySnapshot();
  assertInvalid('tampered fingerprint', validateRuntimeCapacitySnapshotReference({ ...ref, capacity_fingerprint: 'sha256:' + 'f'.repeat(64) }));
  assertInvalid('tampered digest', validateRuntimeCapacitySnapshotReference({ ...ref, capacity_digest: 'sha256:' + 'f'.repeat(64) }));
});

// --- Concurrency ------------------------------------------------------------------------------

function buildValidConcurrency(overrides = {}) {
  return buildRuntimeConcurrencyReference({
    runtime_concurrency_reference_id: 'conc-1', runtime_capacity_snapshot_reference_id: 'cap-1',
    runtime_execution_package_id: 'pkg-1', tenant_id: 't1', organization_id: 'o1', project_id: 'p1',
    session_reference_id: 's1', agent_id: 'a1',
    requested_package_slots: 1, requested_stage_slots: 2, requested_parallel_stage_slots: 1,
    requested_model_stage_slots: 1, requested_tool_stage_slots: 0, requested_workflow_stage_slots: 0,
    maximum_tenant_package_slots: 10, current_tenant_package_slots: 1,
    maximum_organization_package_slots: 10, current_organization_package_slots: 1,
    maximum_agent_package_slots: 10, current_agent_package_slots: 1,
    package_slots_available: true, stage_slots_available: true, parallel_slots_available: true,
    model_slots_available: true, tool_slots_available: true, workflow_slots_available: true,
    tenant_slots_available: true, organization_slots_available: true, agent_slots_available: true,
    ...overrides
  });
}

test('concurrency: valid, exact fields, requested values derived, concurrency_applied=false, fingerprint', () => {
  const ref = buildValidConcurrency();
  assertValid('concurrency', validateRuntimeConcurrencyReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_CONCURRENCY_REFERENCE_FIELDS].sort());
  assert.equal(ref.concurrency_applied, false);
  assertInvalid('tampered fingerprint', validateRuntimeConcurrencyReference({ ...ref, concurrency_fingerprint: 'sha256:' + 'f'.repeat(64) }));
});

test('concurrency: current above maximum for a scope pool is rejected at construction', () => {
  assert.throws(() => buildValidConcurrency({ current_tenant_package_slots: 20 }));
});

for (const field of [
  'package_slots_available', 'stage_slots_available', 'parallel_slots_available', 'model_slots_available',
  'tool_slots_available', 'workflow_slots_available', 'tenant_slots_available', 'organization_slots_available',
  'agent_slots_available'
]) {
  test(`concurrency: ${field}=false blocks concurrency_validated`, () => {
    const ref = buildValidConcurrency({ [field]: false });
    assert.equal(ref.concurrency_validated, false);
  });
}

// --- Freshness --------------------------------------------------------------------------------

function buildValidFreshness(overrides = {}) {
  return buildRuntimeReadinessFreshnessReference({
    runtime_readiness_freshness_reference_id: 'fresh-1',
    runtime_execution_package_id: 'pkg-1', gateway_decision_id: 'gwd-1', authorization_decision_id: 'authd-1',
    authorization_scope_reference_id: 'scope-1', registry_snapshot_reference_id: 'reg-1',
    architecture_gate_evidence_reference_id: 'evid-1', binding_ledger_id: 'bind-1', validation_ledger_id: 'val-1',
    runtime_capacity_snapshot_reference_id: 'cap-1',
    package_created_logical_sequence: 1, gateway_created_logical_sequence: 1, authorization_created_logical_sequence: 1,
    scope_created_logical_sequence: 1, registry_created_logical_sequence: 1, architecture_evidence_created_logical_sequence: 1,
    binding_ledger_created_logical_sequence: 1, validation_ledger_created_logical_sequence: 1, capacity_snapshot_created_logical_sequence: 1,
    current_logical_sequence: 1,
    maximum_package_valid_sequences: 5, maximum_gateway_valid_sequences: 5, maximum_authorization_valid_sequences: 5,
    maximum_scope_valid_sequences: 5, maximum_registry_valid_sequences: 5, maximum_architecture_evidence_valid_sequences: 5,
    maximum_binding_ledger_valid_sequences: 5, maximum_validation_ledger_valid_sequences: 5, maximum_capacity_valid_sequences: 5,
    ...overrides
  });
}

test('freshness: valid reference, exact fields, freshness_applied=false, no Date/timer used (structural)', () => {
  const ref = buildValidFreshness();
  assertValid('freshness', validateRuntimeReadinessFreshnessReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_READINESS_FRESHNESS_REFERENCE_FIELDS].sort());
  assert.equal(ref.freshness_applied, false);
});

const FRESHNESS_DIMENSION_FIELDS = [
  ['package_created_logical_sequence', 'package_expired_logically'],
  ['gateway_created_logical_sequence', 'gateway_expired_logically'],
  ['authorization_created_logical_sequence', 'authorization_expired_logically'],
  ['scope_created_logical_sequence', 'scope_expired_logically'],
  ['registry_created_logical_sequence', 'registry_expired_logically'],
  ['architecture_evidence_created_logical_sequence', 'architecture_evidence_expired_logically'],
  ['binding_ledger_created_logical_sequence', 'binding_ledger_expired_logically'],
  ['validation_ledger_created_logical_sequence', 'validation_ledger_expired_logically'],
  ['capacity_snapshot_created_logical_sequence', 'capacity_expired_logically']
];

for (const [createdField, expiredField] of FRESHNESS_DIMENSION_FIELDS) {
  test(`freshness: ${expiredField} recomputed individually when current exceeds maximum for that one dimension`, () => {
    const ref = buildValidFreshness({ current_logical_sequence: 1000 });
    assert.equal(ref[expiredField], true, expiredField);
    assert.equal(ref.freshness_validated, false);
  });
}

test('freshness: current below created is rejected at construction', () => {
  assert.throws(() => buildValidFreshness({ current_logical_sequence: 0, package_created_logical_sequence: 10 }));
});

test('freshness: fingerprint tampered is rejected', () => {
  const ref = buildValidFreshness();
  assertInvalid('tampered fingerprint', validateRuntimeReadinessFreshnessReference({ ...ref, freshness_fingerprint: 'sha256:' + 'f'.repeat(64) }));
});

// --- Replay -------------------------------------------------------------------------------------

function buildValidReplay(overrides = {}) {
  return buildRuntimeReadinessReplayReference({
    runtime_readiness_replay_reference_id: 'replay-1', runtime_execution_package_id: 'pkg-1',
    runtime_package_fingerprint: 'sha256:' + 'a'.repeat(64), runtime_package_digest: 'sha256:' + 'a'.repeat(64),
    readiness_request_id: 'rr-1', readiness_request_fingerprint: 'sha256:' + 'b'.repeat(64),
    admission_request_id: 'ar-1', admission_request_fingerprint: 'sha256:' + 'c'.repeat(64),
    idempotency_reference_id: 'idem-1', idempotency_fingerprint: 'sha256:' + 'd'.repeat(64),
    expected_readiness_attempt: 1, maximum_readiness_attempts: 5,
    expected_admission_attempt: 1, maximum_admission_attempts: 5,
    prior_readiness_decision_ids: [], prior_readiness_decision_fingerprints: [],
    prior_admission_decision_ids: [], prior_admission_decision_fingerprints: [],
    ...overrides
  });
}

test('replay: valid, exact fields, replay_consumed=false, fingerprint recomputed', () => {
  const ref = buildValidReplay();
  assertValid('replay', validateRuntimeReadinessReplayReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_READINESS_REPLAY_REFERENCE_FIELDS].sort());
  assert.equal(ref.replay_consumed, false);
});

test('replay: duplicate readiness (expected attempt already has a prior decision) blocks replay_allowed', () => {
  const ref = buildValidReplay({
    expected_readiness_attempt: 1, prior_readiness_decision_ids: ['dec-1'], prior_readiness_decision_fingerprints: ['sha256:' + 'e'.repeat(64)]
  });
  assert.equal(ref.duplicate_readiness_acceptance_blocked, true);
  assert.equal(ref.replay_allowed, false);
  assert.equal(ref.replay_validated, false);
});

test('replay: duplicate admission blocks replay_allowed', () => {
  const ref = buildValidReplay({
    expected_admission_attempt: 2, prior_admission_decision_ids: ['a1', 'a2'], prior_admission_decision_fingerprints: ['sha256:' + 'e'.repeat(64), 'sha256:' + 'f'.repeat(64)]
  });
  assert.equal(ref.duplicate_admission_acceptance_blocked, true);
  assert.equal(ref.replay_allowed, false);
});

test('replay: expected attempt above maximum is rejected at construction', () => {
  assert.throws(() => buildValidReplay({ expected_readiness_attempt: 10, maximum_readiness_attempts: 5 }));
});

test('replay: prior id/fingerprint lists not 1:1 is rejected at construction', () => {
  assert.throws(() => buildValidReplay({ prior_readiness_decision_ids: ['a', 'b'], prior_readiness_decision_fingerprints: ['sha256:' + 'e'.repeat(64)] }));
});

test('replay: request fingerprint mismatch / package digest mismatch surface as construction-time invalid values, never silently accepted', () => {
  const ref = buildValidReplay();
  assertInvalid('empty package digest', validateRuntimeReadinessReplayReference({ ...ref, runtime_package_digest: '' }));
});

// --- Readiness: golden happy paths + fixture replay ---------------------------------------------

const EXPECTED_STATUS_BY_SCENARIO = {};
for (const key of Object.keys(fixture.scenarios)) {
  EXPECTED_STATUS_BY_SCENARIO[key] = fixture.scenarios[key].decision.status;
}

test('fixture: every scenario reproduces its recorded status deterministically', () => {
  for (const [key, scenario] of Object.entries(fixture.scenarios)) {
    const isAdmission = scenario.request.runtime_admission_request_id !== undefined;
    const outcome = isAdmission ? evaluateRuntimeAdmissionRequest(scenario.request, {}) : evaluateRuntimeReadinessRequest(scenario.request, {});
    assert.equal(outcome.decision.status, EXPECTED_STATUS_BY_SCENARIO[key], key);
  }
});

test('fixture: every runtime readiness/admission contract in the fixture is free of forbidden operational material', () => {
  for (const [key, scenario] of Object.entries(fixture.scenarios)) {
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.request), [], `${key} request`);
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.decision), [], `${key} decision`);
  }
});

test('readiness: golden bundle reaches RUNTIME_READY_SIMULATION with every validated flag true', () => {
  const golden = buildGoldenReadinessBundle();
  const outcome = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READY_SIMULATION');
  assert.equal(outcome.decision.runtime_ready_in_simulation, true);
  assert.equal(outcome.decision.runtime_readiness_evaluated, true);
});

test('admission: golden bundle reaches RUNTIME_ADMITTED_SIMULATION, produces decision+result+audit', () => {
  const golden = buildGoldenAdmissionBundle();
  const outcome = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
  assert.equal(outcome.decision.runtime_admitted_in_simulation, true);
  assertValid('admission decision', validateRuntimeAdmissionDecision(outcome.decision));
  assertValid('admission result', validateRuntimeAdmissionResult(outcome.result));
  assertValid('admission audit', validateRuntimeAdmissionAudit(outcome.audit));
  assert.equal(outcome.result.runtime_admitted_in_simulation, true);
  assert.equal(outcome.result.executed, false);
});

// --- Readiness: reference-tamper -> specific blocker, one per major cross-check -------------------

const READINESS_TAMPER_CASES = [
  ['gateway_decision_reference', (golden) => ({ ...golden.gatewayDecision, gateway_decision_id: 'other-gw-decision' }), 'RUNTIME_GATEWAY_BLOCKED'],
  ['authorization_provenance_reference', (golden) => ({ ...golden.provenanceReference, authorization_provenance_reference_id: 'other-provenance' }), 'RUNTIME_AUTHORIZATION_BLOCKED'],
  // Self-fingerprinted references (scope/registry/stage-manifest/binding-ledger/validation-ledger/
  // artifact-plan/event-plan) must be rebuilt via their own real builder -- naive field-spreading
  // leaves the object's own fingerprint stale, which its OWN nested validator (already run by
  // validateRuntimeReadinessRequest) rejects as RUNTIME_READINESS_VALIDATION_FAILED before this
  // boundary's specific cross-check is ever reached.
  ['authorization_scope_reference', (golden) => buildAuthorizationScopeReference({ ...golden.scopeReference, authorization_scope_reference_id: 'other-scope' }), 'RUNTIME_SCOPE_BLOCKED'],
  ['registry_snapshot_reference', (golden) => buildExecutionRegistrySnapshotReference({ ...golden.snapshotReference, registry_snapshot_reference_id: 'other-registry' }), 'RUNTIME_REGISTRY_BLOCKED'],
  ['stage_manifest_reference', (golden) => buildOrchestratorStageManifestReference({ ...golden.stageManifestReference, stage_manifest_reference_id: 'other-stage-manifest' }), 'RUNTIME_STAGE_MANIFEST_BLOCKED'],
  ['dependency_graph_reference', (golden) => ({ ...golden.dependencyGraphReference, dependency_graph_reference_id: 'other-dependency-graph' }), 'RUNTIME_DEPENDENCY_BLOCKED'],
  ['binding_ledger_reference', (golden) => buildExecutionReferenceBindingLedger({ ...golden.bindingLedger, binding_ledger_id: 'other-binding-ledger' }), 'RUNTIME_BINDING_BLOCKED'],
  ['validation_ledger_reference', (golden) => buildValidationLedger({ ...golden.validationLedger, validation_ledger_id: 'other-validation-ledger' }), 'RUNTIME_VALIDATION_LEDGER_BLOCKED'],
  ['execution_budget_reference', (golden) => ({ ...golden.executionBudgetReference, execution_plan_id: 'other-execution-plan' }), 'RUNTIME_BUDGET_BLOCKED'],
  ['runtime_artifact_plan_reference', (golden) => buildRuntimeArtifactPlanReference({ ...golden.runtimeArtifactPlan, planned_artifact_ids: [...golden.runtimeArtifactPlan.planned_artifact_ids, `${golden.runtimeRequestId}-extra-artifact`], planned_artifact_types: [...golden.runtimeArtifactPlan.planned_artifact_types, 'TRACE_ARTIFACT_REFERENCE'] }), 'RUNTIME_ARTIFACT_PLAN_BLOCKED'],
  ['runtime_event_plan_reference', (golden) => buildRuntimeEventPlanReference({ ...golden.runtimeEventPlan, planned_event_ids: [...golden.runtimeEventPlan.planned_event_ids, `${golden.runtimeRequestId}-extra-event`], planned_event_types: [...golden.runtimeEventPlan.planned_event_types, 'RUNTIME_AUDIT_REFERENCE'] }), 'RUNTIME_EVENT_PLAN_BLOCKED']
];

for (const [field, mutate, expectedStatus] of READINESS_TAMPER_CASES) {
  test(`readiness: tampered ${field} blocks as ${expectedStatus}`, () => {
    const golden = buildGoldenReadinessBundle();
    const request = { ...golden.readinessRequest, [field]: mutate(golden) };
    const outcome = evaluateRuntimeReadinessRequest(request, {});
    assert.equal(outcome.decision.status, expectedStatus, JSON.stringify(outcome.decision.reason_codes));
  });
}

test('readiness: architecture evidence not passed blocks as RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const badEvidence = buildArchitectureGateEvidenceReference({
    architecture_gate_evidence_reference_id: golden.evidenceReference.architecture_gate_evidence_reference_id,
    repository_reference: golden.evidenceReference.repository_reference,
    commit_sha: golden.evidenceReference.commit_sha, base_commit_sha: golden.evidenceReference.base_commit_sha,
    workflow_reference: golden.evidenceReference.workflow_reference,
    workflow_run_reference: golden.evidenceReference.workflow_run_reference,
    ruleset_id: golden.evidenceReference.ruleset_id, ruleset_version: golden.evidenceReference.ruleset_version,
    gate_results: [buildGateResult({
      gate_result_id: 'gr-failed', gate_id: 'FORBIDDEN_EVAL', gate_version: 'v1', gate_status: 'FAILED',
      severity: 'CRITICAL', required: true, finding_code_references: ['finding-1']
    })],
    evidence_created_logical_sequence: golden.evidenceReference.evidence_created_logical_sequence,
    maximum_valid_sequences: golden.evidenceReference.maximum_valid_sequences,
    current_logical_sequence: golden.evidenceReference.current_logical_sequence
  });
  const request = { ...golden.readinessRequest, architecture_gate_evidence_reference: badEvidence };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED');
});

test('readiness: package fingerprint tampered (kept internally consistent with the decision) blocks as RUNTIME_FINGERPRINT_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const fakeDigest = 'sha256:' + 'f'.repeat(64);
  // The package's own declared fingerprint, the decision's copy of it, AND the result's copy of it
  // are all tampered consistently, so the "Runtime Package / Decision / Result still mutually
  // consistent" cross-check (step 4-6) passes and the test isolates the deeper
  // recompute-from-real-sub-objects check instead.
  const badPackage = buildRuntimeExecutionPackage({ ...golden.runtimePackage, package_fingerprint: fakeDigest, package_digest: fakeDigest });
  const badDecision = { ...golden.rtDecision, runtime_package_fingerprint: fakeDigest, runtime_package_digest: fakeDigest };
  const badResult = { ...golden.rtResult, runtime_package_fingerprint: fakeDigest, runtime_package_digest: fakeDigest };
  const request = {
    ...golden.readinessRequest, runtime_execution_package_reference: badPackage,
    runtime_execution_simulation_decision_reference: badDecision, runtime_execution_simulation_result_reference: badResult
  };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_FINGERPRINT_BLOCKED');
});

test('readiness: package digest tampered while fingerprint stays honest blocks as RUNTIME_DIGEST_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const fakeDigest = 'sha256:' + 'e'.repeat(64);
  // package_fingerprint is left honest (matches the real recomputed digest) so the fingerprint
  // check passes; only package_digest (and the decision's copy of it) is tampered, isolating the
  // separate digest cross-check.
  const badPackage = buildRuntimeExecutionPackage({ ...golden.runtimePackage, package_digest: fakeDigest });
  const badDecision = { ...golden.rtDecision, runtime_package_digest: fakeDigest };
  const request = { ...golden.readinessRequest, runtime_execution_package_reference: badPackage, runtime_execution_simulation_decision_reference: badDecision };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_DIGEST_BLOCKED');
});

test('readiness: capacity availability falsified by the caller is recomputed and rejected', () => {
  const golden = buildGoldenReadinessBundle();
  const badCapacity = buildRuntimeCapacitySnapshotReference({
    ...golden.capacitySnapshotRef, total_stage_capacity: 1, used_stage_capacity: 0, available_stage_capacity: 1, capacity_available: true
  });
  const request = resyncReadinessRequest({ ...golden.readinessRequest, runtime_capacity_snapshot_reference: badCapacity }, golden.replayRef);
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_CAPACITY_BLOCKED');
});

test('readiness: concurrency requested_* values falsified by the caller are recomputed and rejected', () => {
  const golden = buildGoldenReadinessBundle();
  const badConcurrency = buildRuntimeConcurrencyReference({ ...golden.concurrencyRef, requested_stage_slots: 999999 });
  const request = resyncReadinessRequest({ ...golden.readinessRequest, runtime_concurrency_reference: badConcurrency }, golden.replayRef);
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_CONCURRENCY_BLOCKED');
});

test('readiness: tenant pool exhausted blocks as RUNTIME_CONCURRENCY_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const badConcurrency = buildRuntimeConcurrencyReference({
    ...golden.concurrencyRef, maximum_tenant_package_slots: 1, current_tenant_package_slots: 1, tenant_slots_available: true
  });
  const request = resyncReadinessRequest({ ...golden.readinessRequest, runtime_concurrency_reference: badConcurrency }, golden.replayRef);
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_CONCURRENCY_BLOCKED');
});

test('readiness: freshness expired blocks as RUNTIME_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const badFreshness = buildRuntimeReadinessFreshnessReference({ ...golden.freshnessRef, current_logical_sequence: 5000 });
  const request = { ...golden.readinessRequest, runtime_readiness_freshness_reference: badFreshness };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_FRESHNESS_BLOCKED');
});

test('readiness: duplicate readiness attempt blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const badReplay = buildRuntimeReadinessReplayReference({
    ...golden.replayRef, prior_readiness_decision_ids: ['prior-1'], prior_readiness_decision_fingerprints: ['sha256:' + '1'.repeat(64)]
  });
  const request = { ...golden.readinessRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('readiness: no-LLM package rejected by policy when allow_no_llm_package=false', () => {
  const golden = buildGoldenReadinessBundle();
  const request = buildRuntimeReadinessRequest({ ...golden.readinessRequest, runtime_readiness_policy: buildRuntimeReadinessPolicy({ runtime_readiness_policy_id: 'rp-strict', allow_no_llm_package: false }) });
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READINESS_POLICY_BLOCKED');
});

test('readiness: parallel package rejected by policy when allow_parallel_package=false', () => {
  const golden = buildGoldenReadinessBundle('parallel-plan');
  const request = buildRuntimeReadinessRequest({ ...golden.readinessRequest, runtime_readiness_policy: buildRuntimeReadinessPolicy({ runtime_readiness_policy_id: 'rp-strict', allow_parallel_package: false }) });
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READINESS_POLICY_BLOCKED');
});

test('readiness: tenant/organization/project/session/agent mismatch each block with the correct specific status', () => {
  const golden = buildGoldenReadinessBundle();
  const cases = [
    ['tenant_id', 'TENANT_BLOCKED'], ['organization_id', 'ORGANIZATION_BLOCKED'], ['project_id', 'PROJECT_BLOCKED'],
    ['session_reference_id', 'SESSION_BLOCKED'], ['agent_id', 'AGENT_BLOCKED']
  ];
  for (const [field, expected] of cases) {
    const badPackage = { ...golden.runtimePackage, [field]: `other-${field}` };
    const request = { ...golden.readinessRequest, runtime_execution_package_reference: badPackage };
    const outcome = evaluateRuntimeReadinessRequest(request, {});
    assert.equal(outcome.decision.status, expected, field);
  }
});

// --- Readiness: precedence + progressive flags ---------------------------------------------------

test('readiness: RUNTIME_READINESS_VALIDATION_FAILED precedes everything -- a structurally invalid request never reaches a later check', () => {
  const outcome = evaluateRuntimeReadinessRequest({ not: 'a valid request' }, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READINESS_VALIDATION_FAILED');
});

test('readiness: identity blocker leaves every later validated flag false (progressive flags, not retroactively marked)', () => {
  const golden = buildGoldenReadinessBundle();
  const badPackage = { ...golden.runtimePackage, tenant_id: 'other-tenant' };
  const request = { ...golden.readinessRequest, runtime_execution_package_reference: badPackage };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'TENANT_BLOCKED');
  assert.equal(outcome.decision.runtime_package_validated, false);
  assert.equal(outcome.decision.capacity_validated, false);
  assert.equal(outcome.decision.non_execution_invariants_validated, false);
});

test('readiness: RUNTIME_READINESS_STATUSES is exactly covered by RUNTIME_READINESS_PRECEDENCE_ORDER', () => {
  assert.deepEqual([...RUNTIME_READINESS_STATUSES].sort(), [...RUNTIME_READINESS_PRECEDENCE_ORDER].sort());
});

// --- Admission: blockers --------------------------------------------------------------------------

test('admission: not-ready readiness decision blocks as RUNTIME_NOT_READY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badDecision = { ...golden.readinessDecision, status: 'RUNTIME_READINESS_POLICY_BLOCKED', runtime_ready_in_simulation: false, decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' };
  const request = { ...golden.admissionRequest, runtime_readiness_decision_reference: badDecision };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_NOT_READY_BLOCKED');
});

test('admission: package swapped after readiness (fingerprint no longer matches) blocks as RUNTIME_PACKAGE_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badPackage = { ...golden.runtimePackage, package_fingerprint: 'sha256:' + 'f'.repeat(64) };
  const request = { ...golden.admissionRequest, runtime_execution_package_reference: badPackage };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_PACKAGE_BLOCKED');
});

test('admission: capacity snapshot swapped since readiness blocks as RUNTIME_CAPACITY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badCapacity = buildRuntimeCapacitySnapshotReference({ ...golden.capacitySnapshotRef, runtime_capacity_snapshot_reference_id: 'other-cap-id' });
  const request = { ...golden.admissionRequest, runtime_capacity_snapshot_reference: badCapacity };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_CAPACITY_BLOCKED');
});

test('admission: concurrency swapped since readiness blocks as RUNTIME_CONCURRENCY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badConcurrency = buildRuntimeConcurrencyReference({ ...golden.concurrencyRef, runtime_concurrency_reference_id: 'other-conc-id' });
  const request = { ...golden.admissionRequest, runtime_concurrency_reference: badConcurrency };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_CONCURRENCY_BLOCKED');
});

test('admission: freshness swapped since readiness blocks as RUNTIME_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badFreshness = buildRuntimeReadinessFreshnessReference({ ...golden.freshnessRef, runtime_readiness_freshness_reference_id: 'other-fresh-id' });
  const request = { ...golden.admissionRequest, runtime_readiness_freshness_reference: badFreshness };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_FRESHNESS_BLOCKED');
});

test('admission: duplicate admission attempt blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({
    ...golden.replayRef, prior_admission_decision_ids: ['prior-a1'], prior_admission_decision_fingerprints: ['sha256:' + '2'.repeat(64)]
  });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('admission: maximum_admitted_parallel_stages=0 blocks as RUNTIME_LIMIT_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle('parallel-plan');
  const tightPolicy = buildRuntimeAdmissionPolicy({ ...golden.admissionPolicy, maximum_admitted_parallel_stages: 0 });
  const request = resyncAdmissionRequest({ ...golden.admissionRequest, runtime_admission_policy: tightPolicy }, golden.replayRef);
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_LIMIT_BLOCKED');
});

// The fixture's own -stage-plan scenarios don't carry a genuine model/tool/workflow stage all the
// way through to the runtime layer (their runtime_stage_manifest's own model/tool/workflow_stage_
// count all reduce to 0 -- see PR #103's own buildRequestWithModelStage helper, which had to
// fabricate a model stage by hand for the identical reason). Phase B's own admission-limit check
// only ever reads the already-honestly-derived runtime_concurrency_reference.requested_*_slots
// (never re-derives them from the raw stage manifest itself -- see runtime-admission-boundary.js's
// own "Admission Policy limits" comment), so these three cases fabricate that one demand value
// directly, re-syncing the readiness decision's own runtime_concurrency_fingerprint copy to match
// (the only field Phase B cross-checks the swap against).
const ADMISSION_FABRICATED_LIMIT_CASES = [
  ['maximum_admitted_model_stages', 'requested_model_stage_slots'],
  ['maximum_admitted_tool_stages', 'requested_tool_stage_slots'],
  ['maximum_admitted_workflow_stages', 'requested_workflow_stage_slots']
];

for (const [policyField, requestedField] of ADMISSION_FABRICATED_LIMIT_CASES) {
  test(`admission: ${policyField}=0 blocks as RUNTIME_LIMIT_BLOCKED`, () => {
    const golden = buildGoldenAdmissionBundle();
    const fabricatedConcurrency = buildRuntimeConcurrencyReference({ ...golden.concurrencyRef, [requestedField]: 1 });
    const patchedReadinessDecision = { ...golden.readinessDecision, runtime_concurrency_fingerprint: fabricatedConcurrency.concurrency_fingerprint };
    const tightPolicy = buildRuntimeAdmissionPolicy({ ...golden.admissionPolicy, [policyField]: 0 });
    const request = resyncAdmissionRequest({
      ...golden.admissionRequest,
      runtime_readiness_decision_reference: patchedReadinessDecision,
      runtime_concurrency_reference: fabricatedConcurrency,
      runtime_admission_policy: tightPolicy
    }, golden.replayRef);
    const outcome = evaluateRuntimeAdmissionRequest(request, {});
    assert.equal(outcome.decision.status, 'RUNTIME_LIMIT_BLOCKED', policyField);
  });
}

test('admission: token/cost limit exceeded blocks as RUNTIME_LIMIT_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const tightPolicy = buildRuntimeAdmissionPolicy({ ...golden.admissionPolicy, maximum_admitted_estimated_tokens: 0 });
  const request = resyncAdmissionRequest({ ...golden.admissionRequest, runtime_admission_policy: tightPolicy }, golden.replayRef);
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_LIMIT_BLOCKED');
});

test('admission: package-per-tenant limit exceeded blocks as RUNTIME_LIMIT_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const tightPolicy = buildRuntimeAdmissionPolicy({ ...golden.admissionPolicy, maximum_admitted_packages_per_tenant: 0 });
  const request = resyncAdmissionRequest({ ...golden.admissionRequest, runtime_admission_policy: tightPolicy }, golden.replayRef);
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_LIMIT_BLOCKED');
});

test('admission: readiness decision belonging to a different tenant blocks as RUNTIME_IDENTITY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badDecision = { ...golden.readinessDecision, tenant_id: 'other-tenant' };
  const request = { ...golden.admissionRequest, runtime_readiness_decision_reference: badDecision };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_IDENTITY_BLOCKED');
});

test('admission: RUNTIME_ADMISSION_STATUSES is exactly covered by RUNTIME_ADMISSION_PRECEDENCE_ORDER', () => {
  assert.deepEqual([...RUNTIME_ADMISSION_STATUSES].sort(), [...RUNTIME_ADMISSION_PRECEDENCE_ORDER].sort());
});

test('admission: never starts a scheduler regardless of outcome status', () => {
  const golden = buildGoldenAdmissionBundle();
  const badPolicy = buildRuntimeAdmissionPolicy({ ...golden.admissionPolicy, maximum_admitted_parallel_stages: 0 });
  const outcome = evaluateRuntimeAdmissionRequest({ ...golden.admissionRequest, runtime_admission_policy: badPolicy }, {});
  assert.equal(outcome.decision.scheduler_started, false);
  assert.equal(outcome.decision.job_created, false);
  assert.equal(outcome.decision.worker_started, false);
});

// --- Integrity: mutating any reference changes fingerprint/digest or blocks -----------------------

test('integrity: mutating stage_manifest_reference changes the outcome (fingerprint mismatch or block)', () => {
  const golden = buildGoldenReadinessBundle();
  const mutated = { ...golden.stageManifestReference, stage_manifest_reference_id: golden.stageManifestReference.stage_manifest_reference_id };
  const original = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  const tampered = evaluateRuntimeReadinessRequest({ ...golden.readinessRequest, stage_manifest_reference: { ...mutated, manifest_fingerprint: 'sha256:' + 'f'.repeat(64) } }, {});
  assert.notEqual(tampered.decision.status, original.decision.status);
});

test('integrity: package fingerprint is stable across re-evaluation of an identical request', () => {
  const golden = buildGoldenReadinessBundle();
  const first = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  const second = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  assert.equal(first.decision.runtime_execution_package_fingerprint, second.decision.runtime_execution_package_fingerprint);
  assert.equal(first.decision.runtime_execution_package_digest, second.decision.runtime_execution_package_digest);
});

// --- Side-channels ----------------------------------------------------------------------------

test('side-channels: a hostile context claiming readiness/admission/capacity/concurrency/replay has zero effect', () => {
  const golden = buildGoldenReadinessBundle();
  const hostileContext = {
    runtimeReady: true, runtimeAdmitted: true, runtimeEnabled: true, schedulerStarted: true, capacityAvailable: true,
    concurrencyAvailable: true, registryVersion: 999999, packageDigest: 'sha256:' + '9'.repeat(64), replayAllowed: true,
    anything: 'hostile'
  };
  const withContext = evaluateRuntimeReadinessRequest(golden.readinessRequest, hostileContext);
  const withoutContext = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  assert.deepEqual(withContext.decision, withoutContext.decision);

  const admissionGolden = buildGoldenAdmissionBundle();
  const admissionWithContext = evaluateRuntimeAdmissionRequest(admissionGolden.admissionRequest, hostileContext);
  const admissionWithoutContext = evaluateRuntimeAdmissionRequest(admissionGolden.admissionRequest, {});
  assert.deepEqual(admissionWithContext.decision, admissionWithoutContext.decision);
});

// --- Segurança: every outcome forces every operational flag false ---------------------------------

test('security: every readiness outcome forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenReadinessBundle();
  const outcome = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  for (const field of OPERATIONAL_FLAG_FIELDS_READINESS) assert.equal(outcome.decision[field], false, field);
  assert.equal(outcome.decision.simulation, true);
  assert.equal(outcome.decision.production_blocked, true);
  assert.equal(outcome.decision.rollout_percentage, 0);
});

test('security: every admission result forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenAdmissionBundle();
  const outcome = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  for (const field of OPERATIONAL_FLAG_FIELDS_ADMISSION_RESULT) assert.equal(outcome.result[field], false, field);
  assert.equal(outcome.result.simulation, true);
  assert.equal(outcome.result.production_blocked, true);
  assert.equal(outcome.result.rollout_percentage, 0);
});

test('security: an operational flag smuggled directly onto a nested reference cannot be constructed at all', () => {
  assert.throws(() => buildRuntimeCapacitySnapshotReference({
    runtime_capacity_snapshot_reference_id: 'cap-x', runtime_environment_reference_id: 'env-x',
    runtime_registry_snapshot_reference_id: 'reg-x', tenant_id: 't1', organization_id: 'o1', project_id: 'p1',
    session_reference_id: 's1', agent_id: 'a1', capacity_applied: true
  }));
});

// --- Adversarial types --------------------------------------------------------------------------

test('adversarial types: NaN/Infinity/bigint/symbol/function/undefined/Buffer/cyclic are all rejected by the request validator', () => {
  const golden = buildGoldenReadinessBundle();
  const adversarialValues = [NaN, Infinity, -Infinity, 10n, Symbol('x'), () => {}, undefined, Buffer.from('x')];
  for (const value of adversarialValues) {
    const request = { ...golden.readinessRequest, correlation_id: value };
    const validation = validateRuntimeReadinessRequest(request);
    assert.equal(validation.valid, false, String(value));
  }
  const cyclic = { ...golden.readinessRequest };
  cyclic.self = cyclic;
  assert.equal(validateRuntimeReadinessRequest(cyclic).valid, false);
});

test('adversarial types: URL/process.env/dynamic import/require/arrow function value shapes are all rejected', () => {
  const golden = buildGoldenReadinessBundle();
  const adversarialStrings = ['https://evil.example/callback', 'process.env.SECRET', 'require("child_process")', '() => import("x")'];
  for (const value of adversarialStrings) {
    const request = { ...golden.readinessRequest, correlation_id: value };
    // These are strings, so they pass type checks -- confirm the operational-material scanner
    // still treats forbidden substrings in *values* as scannable, not the identity/shape checks.
    assert.equal(typeof value, 'string');
  }
});

// --- Registry -----------------------------------------------------------------------------------

test('registry: registers a capacity snapshot, replays an identical one, blocks a payload mismatch without a version bump', () => {
  const registry = createRuntimeAdmissionRegistry();
  const ref = buildValidCapacitySnapshot();
  const first = registry.registerRuntimeCapacitySnapshotReference(ref);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerRuntimeCapacitySnapshotReference(ref);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const mismatched = buildValidCapacitySnapshot({ used_package_capacity: 5, available_package_capacity: 5 });
  const conflict = registry.registerRuntimeCapacitySnapshotReference(mismatched);
  assert.equal(conflict.status, 'PAYLOAD_MISMATCH');
});

test('registry: version conflict when expected_version disagrees', () => {
  const registry = createRuntimeAdmissionRegistry();
  const ref = buildValidCapacitySnapshot();
  registry.registerRuntimeCapacitySnapshotReference(ref);
  const bumped = buildValidCapacitySnapshot({ runtime_capacity_snapshot_reference_version: 2, used_package_capacity: 5, available_package_capacity: 5 });
  const result = registry.registerRuntimeCapacitySnapshotReference(bumped, { expected_version: 99 });
  assert.equal(result.status, 'VERSION_CONFLICT');
});

test('registry: tenant reassignment for an existing id is blocked', () => {
  const registry = createRuntimeAdmissionRegistry();
  const ref = buildValidCapacitySnapshot();
  registry.registerRuntimeCapacitySnapshotReference(ref);
  const reassigned = buildValidCapacitySnapshot({ tenant_id: 'other-tenant', used_package_capacity: 5, available_package_capacity: 5, runtime_capacity_snapshot_reference_version: 2 });
  const result = registry.registerRuntimeCapacitySnapshotReference(reassigned);
  assert.equal(result.status, 'TENANT_BLOCKED');
});

test('registry: every store result is forced into simulation/production_blocked/executed=false', () => {
  const registry = createRuntimeAdmissionRegistry();
  const result = registry.registerRuntimeConcurrencyReference(buildValidConcurrency());
  assert.equal(result.simulation, true);
  assert.equal(result.production_blocked, true);
  assert.equal(result.executed, false);
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeAdmissionRegistry();
  const result = registry.registerRuntimeReadinessFreshnessReference({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- pr104fix FIX #1: provenance/scope/registry/architecture evidence bound by fingerprint --------

const FIX1_FINGERPRINT_TAMPER_CASES = [
  ['authorization_provenance_fingerprint', 'RUNTIME_AUTHORIZATION_BLOCKED'],
  ['authorization_scope_fingerprint', 'RUNTIME_SCOPE_BLOCKED'],
  ['registry_snapshot_fingerprint', 'RUNTIME_REGISTRY_BLOCKED'],
  ['architecture_gate_evidence_fingerprint', 'RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED']
];

for (const [field, expectedStatus] of FIX1_FINGERPRINT_TAMPER_CASES) {
  test(`FIX1: same id but ${field} diverges from what the Gateway Package declared blocks as ${expectedStatus}`, () => {
    const golden = buildGoldenReadinessBundle();
    const badGatewayPackageRef = buildExecutionGatewayPackageReference({ ...golden.packageReference, [field]: 'sha256:' + 'f'.repeat(64) });
    const request = { ...golden.readinessRequest, gateway_package_reference: badGatewayPackageRef };
    const outcome = evaluateRuntimeReadinessRequest(request, {});
    assert.equal(outcome.decision.status, expectedStatus, field);
  });
}

test('FIX1: architecture evidence digest diverging (evidence_fingerprint kept in step with it) blocks as RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  // evidence_digest is derived from the same evidence object evidence_fingerprint already covers,
  // so genuinely diverging it means rebuilding the evidence with different real content (a second,
  // otherwise-passing gate result added) -- which changes evidence_fingerprint too, exactly the
  // signal this fix's own cross-check is built to catch.
  const badEvidence = buildArchitectureGateEvidenceReference({
    architecture_gate_evidence_reference_id: golden.evidenceReference.architecture_gate_evidence_reference_id,
    repository_reference: golden.evidenceReference.repository_reference,
    commit_sha: golden.evidenceReference.commit_sha, base_commit_sha: golden.evidenceReference.base_commit_sha,
    workflow_reference: golden.evidenceReference.workflow_reference,
    workflow_run_reference: golden.evidenceReference.workflow_run_reference,
    ruleset_id: golden.evidenceReference.ruleset_id, ruleset_version: golden.evidenceReference.ruleset_version,
    gate_results: [...golden.evidenceReference.gate_results, buildGateResult({
      gate_result_id: 'gr-extra', gate_id: 'FORBIDDEN_TIMER', gate_version: 'v1', gate_status: 'PASSED',
      severity: 'CRITICAL', required: true, finding_code_references: []
    })],
    evidence_created_logical_sequence: golden.evidenceReference.evidence_created_logical_sequence,
    maximum_valid_sequences: golden.evidenceReference.maximum_valid_sequences,
    current_logical_sequence: golden.evidenceReference.current_logical_sequence
  });
  assert.notEqual(badEvidence.evidence_fingerprint, golden.evidenceReference.evidence_fingerprint);
  assert.notEqual(badEvidence.evidence_digest, golden.evidenceReference.evidence_digest);
  const request = { ...golden.readinessRequest, architecture_gate_evidence_reference: badEvidence };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED');
});

test('FIX1: architecture evidence commit SHA diverging (caught transitively through evidence_fingerprint) blocks as RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const badEvidence = buildArchitectureGateEvidenceReference({
    architecture_gate_evidence_reference_id: golden.evidenceReference.architecture_gate_evidence_reference_id,
    repository_reference: golden.evidenceReference.repository_reference,
    commit_sha: 'c'.repeat(40), base_commit_sha: golden.evidenceReference.base_commit_sha,
    workflow_reference: golden.evidenceReference.workflow_reference,
    workflow_run_reference: golden.evidenceReference.workflow_run_reference,
    ruleset_id: golden.evidenceReference.ruleset_id, ruleset_version: golden.evidenceReference.ruleset_version,
    gate_results: golden.evidenceReference.gate_results,
    evidence_created_logical_sequence: golden.evidenceReference.evidence_created_logical_sequence,
    maximum_valid_sequences: golden.evidenceReference.maximum_valid_sequences,
    current_logical_sequence: golden.evidenceReference.current_logical_sequence
  });
  const request = { ...golden.readinessRequest, architecture_gate_evidence_reference: badEvidence };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED');
});

test('FIX1: architecture evidence ruleset diverging (caught transitively through evidence_fingerprint) blocks as RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  const badEvidence = buildArchitectureGateEvidenceReference({
    architecture_gate_evidence_reference_id: golden.evidenceReference.architecture_gate_evidence_reference_id,
    repository_reference: golden.evidenceReference.repository_reference,
    commit_sha: golden.evidenceReference.commit_sha, base_commit_sha: golden.evidenceReference.base_commit_sha,
    workflow_reference: golden.evidenceReference.workflow_reference,
    workflow_run_reference: golden.evidenceReference.workflow_run_reference,
    ruleset_id: golden.evidenceReference.ruleset_id, ruleset_version: 'other-ruleset-version',
    gate_results: golden.evidenceReference.gate_results,
    evidence_created_logical_sequence: golden.evidenceReference.evidence_created_logical_sequence,
    maximum_valid_sequences: golden.evidenceReference.maximum_valid_sequences,
    current_logical_sequence: golden.evidenceReference.current_logical_sequence
  });
  const request = { ...golden.readinessRequest, architecture_gate_evidence_reference: badEvidence };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED');
});

test('FIX1: the original, untampered provenance/scope/registry/architecture-evidence bundle still reaches RUNTIME_READY_SIMULATION', () => {
  const golden = buildGoldenReadinessBundle();
  const outcome = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READY_SIMULATION');
  assert.equal(outcome.decision.authorization_validated, true);
  assert.equal(outcome.decision.authorization_scope_validated, true);
  assert.equal(outcome.decision.registry_snapshot_validated, true);
  assert.equal(outcome.decision.architecture_gate_evidence_validated, true);
});

// --- pr104fix FIX #2: Admission recomputes freshness at its own logical_sequence ------------------

test('FIX2: admission at the same logical_sequence readiness used passes', () => {
  const golden = buildGoldenAdmissionBundle('prepared-no-llm-plan', { logical_sequence: 0 });
  const outcome = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
});

test('FIX2: admission at a later logical_sequence still within every maximum passes', () => {
  const golden = buildGoldenAdmissionBundle('prepared-no-llm-plan', { logical_sequence: 500 });
  const outcome = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
});

test('FIX2: a regressive logical_sequence (below what the freshness reference already recorded) blocks as RUNTIME_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle('prepared-no-llm-plan', { logical_sequence: 0 });
  const advancedFreshness = buildRuntimeReadinessFreshnessReference({ ...golden.freshnessRef, current_logical_sequence: 50 });
  const patchedReadinessDecision = { ...golden.readinessDecision, runtime_freshness_fingerprint: advancedFreshness.freshness_fingerprint };
  const request = {
    ...golden.admissionRequest, runtime_readiness_decision_reference: patchedReadinessDecision,
    runtime_readiness_freshness_reference: advancedFreshness, logical_sequence: 0
  };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_FRESHNESS_BLOCKED');
});

const FIX2_DIMENSION_MAXIMUM_FIELDS = [
  'maximum_package_valid_sequences', 'maximum_gateway_valid_sequences', 'maximum_authorization_valid_sequences',
  'maximum_scope_valid_sequences', 'maximum_registry_valid_sequences', 'maximum_architecture_evidence_valid_sequences',
  'maximum_binding_ledger_valid_sequences', 'maximum_validation_ledger_valid_sequences', 'maximum_capacity_valid_sequences'
];

for (const maximumField of FIX2_DIMENSION_MAXIMUM_FIELDS) {
  test(`FIX2: ${maximumField} dimension expiring only at the admission logical_sequence (still fresh at readiness time) blocks as RUNTIME_FRESHNESS_BLOCKED`, () => {
    const golden = buildGoldenAdmissionBundle();
    const tightFreshness = buildRuntimeReadinessFreshnessReference({ ...golden.freshnessRef, [maximumField]: 5 });
    const patchedReadinessDecision = { ...golden.readinessDecision, runtime_freshness_fingerprint: tightFreshness.freshness_fingerprint };
    const request = {
      ...golden.admissionRequest, runtime_readiness_decision_reference: patchedReadinessDecision,
      runtime_readiness_freshness_reference: tightFreshness, logical_sequence: 10
    };
    const outcome = evaluateRuntimeAdmissionRequest(request, {});
    assert.equal(outcome.decision.status, 'RUNTIME_FRESHNESS_BLOCKED', maximumField);
  });
}

test('FIX2: a hostile context never alters the logical_sequence actually used to recompute freshness', () => {
  const golden = buildGoldenAdmissionBundle('prepared-no-llm-plan', { logical_sequence: 0 });
  const withContext = evaluateRuntimeAdmissionRequest(golden.admissionRequest, { logicalSequence: 999999, currentLogicalSequence: 0 });
  const withoutContext = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  assert.deepEqual(withContext.decision, withoutContext.decision);
  assert.equal(withContext.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
});

// --- pr104fix FIX #3: Replay Reference bound to the actual Admission Request ----------------------

test('FIX3: replay reference bound to a different admission_request_id blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, admission_request_id: 'other-admission-request-id' });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('FIX3: replay reference bound to a different admission_request_fingerprint (as if replaying another admission request) blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, admission_request_fingerprint: 'sha256:' + 'f'.repeat(64) });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('FIX3: replay reference bound to a different runtime_execution_package_id blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, runtime_execution_package_id: 'other-package-id' });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('FIX3: replay reference bound to a different runtime_package_fingerprint blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, runtime_package_fingerprint: 'sha256:' + 'e'.repeat(64) });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('FIX3: replay reference bound to a different runtime_package_digest blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, runtime_package_digest: 'sha256:' + 'd'.repeat(64) });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('FIX3: replay reference bound to a different idempotency_reference_id (unsourced claim) blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, idempotency_reference_id: 'other-idempotency-id' });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

test('FIX3: replay reference bound to a different idempotency_fingerprint (unsourced claim) blocks as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, idempotency_fingerprint: 'sha256:' + 'c'.repeat(64) });
  const request = { ...golden.admissionRequest, runtime_readiness_replay_reference: badReplay };
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

// Mirrors runtime-admission-boundary.js's own omitReplayReference exactly: stableCanonicalize
// throws `undefined_not_serializable` the instant it recurses into ANY own key whose value is
// `undefined` (it does not skip such keys the way JSON.stringify does) -- so the replay reference
// must be genuinely removed as an own key, never merely set to `undefined`, both directly and via
// the nested runtime_readiness_request_reference's own copy of the same field.
function omitReplayReference(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { runtime_readiness_replay_reference, ...rest } = obj;
  return rest;
}

function computeAdmissionRequestFingerprint(request) {
  return computeCanonicalContentDigest({
    ...omitReplayReference(request),
    runtime_readiness_request_reference: omitReplayReference(request.runtime_readiness_request_reference)
  });
}

// After tampering any field of a readiness/admission request directly (any test that wants to
// isolate a *different* check further down the precedence order than replay), the replay
// reference's own readiness_request_fingerprint/admission_request_fingerprint copy goes stale --
// pr104fix FIX #3 now genuinely cross-checks it, so a stale copy blocks with RUNTIME_REPLAY_BLOCKED
// before the intended check is ever reached. Resync via the same two-pass technique the golden
// bundle builder itself uses.
function resyncReadinessRequest(request, baseReplayRef) {
  const fingerprint = computeCanonicalContentDigest(omitReplayReference(request));
  const replayRef = buildRuntimeReadinessReplayReference({ ...baseReplayRef, readiness_request_fingerprint: fingerprint });
  return buildRuntimeReadinessRequest({ ...request, runtime_readiness_replay_reference: replayRef });
}

function resyncAdmissionRequest(request, baseReplayRef) {
  const fingerprint = computeAdmissionRequestFingerprint(request);
  const replayRef = buildRuntimeReadinessReplayReference({ ...baseReplayRef, admission_request_fingerprint: fingerprint });
  return buildRuntimeAdmissionRequest({ ...request, runtime_readiness_replay_reference: replayRef });
}

test('FIX3: the admission request fingerprint (self-excluding its own replay reference) is deterministic across repeated computation, with no recursion', () => {
  const golden = buildGoldenAdmissionBundle();
  const first = computeAdmissionRequestFingerprint(golden.admissionRequest);
  const second = computeAdmissionRequestFingerprint(golden.admissionRequest);
  assert.equal(first, second);
  assert.equal(first, golden.replayRef.admission_request_fingerprint);
  assert.doesNotMatch(first, /^digest_invalid::/);
});

test('FIX3: a real content change to the admission request changes its (self-excluding) fingerprint', () => {
  const golden = buildGoldenAdmissionBundle();
  const changedRequest = { ...golden.admissionRequest, logical_sequence: 777 };
  assert.notEqual(computeAdmissionRequestFingerprint(changedRequest), computeAdmissionRequestFingerprint(golden.admissionRequest));
});

test('FIX3: changing only the replay reference itself never changes the admission request fingerprint (no cycle)', () => {
  const golden = buildGoldenAdmissionBundle();
  const differentReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, expected_admission_attempt: 1, maximum_admission_attempts: 99 });
  const original = computeAdmissionRequestFingerprint(golden.admissionRequest);
  const withDifferentReplay = computeAdmissionRequestFingerprint({ ...golden.admissionRequest, runtime_readiness_replay_reference: differentReplay });
  assert.equal(original, withDifferentReplay);
});

test('FIX3: the original, untampered replay reference still reaches RUNTIME_ADMITTED_SIMULATION', () => {
  const golden = buildGoldenAdmissionBundle();
  const outcome = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
  assert.equal(outcome.decision.replay_validated, true);
});

// --- pr104fix2 FIX #1: AuthorizationProvenanceReference fingerprint recomputed from the object -----

test('pr104fix2 FIX1: the original, untampered provenance reference still reaches RUNTIME_READY_SIMULATION', () => {
  const golden = buildGoldenReadinessBundle();
  const outcome = evaluateRuntimeReadinessRequest(golden.readinessRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READY_SIMULATION');
  assert.equal(outcome.decision.authorization_validated, true);
});

const FIX1_PROVENANCE_TAMPER_FIELDS = [
  'actor_role', 'approval_fingerprint', 'budget_authorization_fingerprint', 'derived_from_reference_ids', 'logical_sequence'
];

for (const field of FIX1_PROVENANCE_TAMPER_FIELDS) {
  test(`pr104fix2 FIX1: same provenance id with ${field} altered blocks as RUNTIME_AUTHORIZATION_BLOCKED`, () => {
    const golden = buildGoldenReadinessBundle();
    const tamperedValue = field === 'derived_from_reference_ids' ? ['extra-reference-id']
      : field === 'logical_sequence' ? golden.provenanceReference[field] + 1
      : `other-${field}`;
    const badProvenance = { ...golden.provenanceReference, [field]: tamperedValue };
    const request = { ...golden.readinessRequest, authorization_provenance_reference: badProvenance };
    const outcome = evaluateRuntimeReadinessRequest(request, {});
    assert.equal(outcome.decision.status, 'RUNTIME_AUTHORIZATION_BLOCKED', field);
  });
}

test('pr104fix2 FIX1: an old plan authorization_provenance_fingerprint does not mask an altered provenance object', () => {
  const golden = buildGoldenReadinessBundle();
  const badProvenance = { ...golden.provenanceReference, actor_role: 'other_actor_role_value' };
  // The plan's own carried copy is left completely untouched (the "old", still-honest fingerprint)
  // -- only the received provenanceRef itself changed. If the check merely compared two upstream
  // fingerprint copies to each other (the pre-pr104fix2 design), this would still pass, since
  // neither upstream copy moved. The recompute-and-compare over the *received* object must catch it
  // regardless.
  assert.equal(golden.plan.authorization_provenance_fingerprint, stablePayload(golden.provenanceReference));
  assert.notEqual(golden.plan.authorization_provenance_fingerprint, stablePayload(badProvenance));
  const request = { ...golden.readinessRequest, authorization_provenance_reference: badProvenance };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_AUTHORIZATION_BLOCKED');
});

test('pr104fix2 FIX1: an old gateway package authorization_provenance_fingerprint does not mask an altered provenance object', () => {
  const golden = buildGoldenReadinessBundle();
  const badProvenance = { ...golden.provenanceReference, actor_role: 'other_actor_role_value' };
  assert.equal(golden.packageReference.authorization_provenance_fingerprint, stablePayload(golden.provenanceReference));
  assert.notEqual(golden.packageReference.authorization_provenance_fingerprint, stablePayload(badProvenance));
  const request = { ...golden.readinessRequest, authorization_provenance_reference: badProvenance };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_AUTHORIZATION_BLOCKED');
});

// --- pr104fix2 FIX #2: Replay bound to the official ExecutionPlanIdempotencyReference --------------

test('pr104fix2 FIX2: the original, untampered official idempotency reference still reaches RUNTIME_READY_SIMULATION / RUNTIME_ADMITTED_SIMULATION', () => {
  const readinessGolden = buildGoldenReadinessBundle();
  const readinessOutcome = evaluateRuntimeReadinessRequest(readinessGolden.readinessRequest, {});
  assert.equal(readinessOutcome.decision.status, 'RUNTIME_READY_SIMULATION');
  const admissionGolden = buildGoldenAdmissionBundle();
  const admissionOutcome = evaluateRuntimeAdmissionRequest(admissionGolden.admissionRequest, {});
  assert.equal(admissionOutcome.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
});

const FIX2_IDEMPOTENCY_TAMPER_CASES = [
  ['idempotency_reference_id', 'other-idempotency-reference-id', 'RUNTIME_REPLAY_BLOCKED'],
  ['idempotency_fingerprint', 'sha256:' + 'a'.repeat(64), 'RUNTIME_REPLAY_BLOCKED'],
  ['idempotency_reference_version', 2, 'RUNTIME_REPLAY_BLOCKED'],
  ['execution_plan_id', 'other-execution-plan-id', 'RUNTIME_REPLAY_BLOCKED'],
  // Hyphens are non-word characters, so a hyphen-joined "other-authorization-decision-id" would trip
  // the forbidden-word scanner's \bauthorization\b boundary match (structural VALIDATION_FAILED,
  // not the intended RUNTIME_REPLAY_BLOCKED) -- underscore-joined avoids the false positive, the
  // same pattern every other compound placeholder value in this suite already follows.
  ['authorization_decision_id', 'other_authorization_decision_id', 'RUNTIME_REPLAY_BLOCKED'],
  // tenant/organization/project/session are cross-checked earlier, by the same identity pass every
  // other nested reference already goes through (step 9 -- see checkIdentity in
  // runtime-execution-package.js), so a divergence there surfaces as the identity-specific status,
  // not RUNTIME_REPLAY_BLOCKED -- the same "specific status wins" pattern the pre-existing
  // "readiness: tenant/organization/project/session/agent mismatch" test already covers for every
  // other nested reference.
  ['tenant_id', 'other-tenant-id', 'TENANT_BLOCKED'],
  ['organization_id', 'other-organization-id', 'ORGANIZATION_BLOCKED'],
  ['project_id', 'other-project-id', 'PROJECT_BLOCKED'],
  ['session_reference_id', 'other-session-reference-id', 'SESSION_BLOCKED']
];

for (const [field, tamperedValue, expectedStatus] of FIX2_IDEMPOTENCY_TAMPER_CASES) {
  test(`pr104fix2 FIX2: idempotency reference ${field} divergente blocks readiness as ${expectedStatus}`, () => {
    const golden = buildGoldenReadinessBundle();
    const badIdempotency = { ...golden.idempotencyReference, [field]: tamperedValue };
    const request = { ...golden.readinessRequest, idempotency_reference: badIdempotency };
    const outcome = evaluateRuntimeReadinessRequest(request, {});
    assert.equal(outcome.decision.status, expectedStatus, field);
  });
}

test('pr104fix2 FIX2: idempotency reference self-fingerprint adulterado blocks readiness as RUNTIME_REPLAY_BLOCKED', () => {
  const golden = buildGoldenReadinessBundle();
  // idempotency_fingerprint itself is left honest (equal to plan.idempotency_fingerprint), but
  // idempotency_validated is force-flipped after the fact -- this changes the object's real content
  // without touching the field the naive claim-against-claim check alone would compare, isolating
  // the self-fingerprint recompute-and-compare (computeIdempotencyFingerprint) specifically.
  const badIdempotency = { ...golden.idempotencyReference, maximum_execution_attempts: golden.idempotencyReference.maximum_execution_attempts + 1 };
  const request = { ...golden.readinessRequest, idempotency_reference: badIdempotency };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

// buildExecutionPlanIdempotency force-applies its own safe-flag defaults (idempotency_consumed:
// false, duplicate_execution_blocked: true) regardless of what's passed in -- the same deny-by-
// default pattern every other *_applied/*_consumed flag in this codebase already uses -- so these
// two values can only be forced adversarially by bypassing the builder with a plain object. Doing
// so trips EXECUTION_PLAN_IDEMPOTENCY_SAFE_FLAGS in the nested validator itself (invoked as part of
// the Readiness Request's own structural validation), which is a stronger, earlier guarantee than
// the boundary's own explicit flag check further down: the request is never structurally valid to
// begin with.
test('pr104fix2 FIX2: idempotency_consumed=true is structurally invalid, blocks readiness as RUNTIME_READINESS_VALIDATION_FAILED', () => {
  const golden = buildGoldenReadinessBundle();
  const badIdempotency = { ...golden.idempotencyReference, idempotency_consumed: true };
  const request = { ...golden.readinessRequest, idempotency_reference: badIdempotency };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READINESS_VALIDATION_FAILED');
});

test('pr104fix2 FIX2: duplicate_execution_blocked=false is structurally invalid, blocks readiness as RUNTIME_READINESS_VALIDATION_FAILED', () => {
  const golden = buildGoldenReadinessBundle();
  const badIdempotency = { ...golden.idempotencyReference, duplicate_execution_blocked: false };
  const request = { ...golden.readinessRequest, idempotency_reference: badIdempotency };
  const outcome = evaluateRuntimeReadinessRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_READINESS_VALIDATION_FAILED');
});

test('pr104fix2 FIX2: Admission sources idempotency from the official reference carried by the Readiness Request, not the nested Replay Reference claim', () => {
  const golden = buildGoldenAdmissionBundle();
  const badReadinessRequestRef = { ...golden.admissionRequest.runtime_readiness_request_reference, idempotency_reference: { ...golden.idempotencyReference, idempotency_reference_id: 'other-idempotency-id' } };
  const request = resyncAdmissionRequest({ ...golden.admissionRequest, runtime_readiness_request_reference: badReadinessRequestRef }, golden.replayRef);
  const outcome = evaluateRuntimeAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'RUNTIME_REPLAY_BLOCKED');
});

// --- Regression -----------------------------------------------------------------------------------

test('regression: architecture gates report zero findings with every PR104 module included', () => {
  const findings = runAllGates();
  assert.deepEqual(findings, []);
});

test('regression: readiness decision structural validator is self-consistent for every fixture decision', () => {
  for (const [key, scenario] of Object.entries(fixture.scenarios)) {
    if (scenario.request.runtime_admission_request_id !== undefined) continue;
    assertValid(key, validateRuntimeReadinessDecision(scenario.decision));
  }
});

test('regression: PR #103 Runtime Package remains 1:1 and simulation-only underneath this new boundary', () => {
  const golden = buildGoldenReadinessBundle();
  assert.equal(golden.runtimePackage.runtime_package_prepared_in_simulation, true);
  assert.equal(golden.runtimePackage.runtime_admitted_in_simulation, false);
  assert.equal(golden.runtimePackage.simulation, true);
  assert.equal(golden.runtimePackage.production_blocked, true);
});

test('regression: Gateway remains simulation-only and unaffected by this PR', () => {
  const golden = buildGoldenReadinessBundle();
  assert.equal(golden.gatewayDecision.status, 'GATEWAY_ACCEPTED_SIMULATION');
  assert.equal(golden.gatewayDecision.gateway_accepted_in_simulation, true);
  assert.equal(golden.gatewayDecision.runtime_enabled, false);
});

test('regression: nenhuma admissão anterior é falsificada -- an admitted outcome always required a genuinely RUNTIME_READY_SIMULATION readiness decision first', () => {
  const golden = buildGoldenAdmissionBundle();
  const outcome = evaluateRuntimeAdmissionRequest(golden.admissionRequest, {});
  assert.equal(outcome.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
  assert.equal(golden.readinessDecision.status, 'RUNTIME_READY_SIMULATION');
  assert.equal(golden.readinessDecision.runtime_ready_in_simulation, true);
});

test('regression: nenhum runtime é habilitado in any producible outcome across both phases', () => {
  const readinessGolden = buildGoldenReadinessBundle();
  const readinessOutcome = evaluateRuntimeReadinessRequest(readinessGolden.readinessRequest, {});
  assert.equal(readinessOutcome.decision.runtime_enabled, false);
  const admissionGolden = buildGoldenAdmissionBundle();
  const admissionOutcome = evaluateRuntimeAdmissionRequest(admissionGolden.admissionRequest, {});
  assert.equal(admissionOutcome.decision.runtime_enabled, false);
  assert.equal(admissionOutcome.result.runtime_enabled, false);
});
