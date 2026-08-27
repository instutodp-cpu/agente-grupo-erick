'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const {
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
  computeRuntimeExecutionJobMaterializationDigest,
  computeRuntimeExecutionJobMaterializationFingerprint
} = require('../src/core/runtime-execution-job-materialization');
const {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
} = require('../src/core/runtime-execution-job-intent');
const { buildDurableJobRecord } = require('../src/core/runtime-execution-job-durable-contract');
const { buildRuntimeExecutionAttemptIntent } = require('../src/core/runtime-execution-attempt-intent');
const { buildRuntimeExecutionAttemptMaterialization } = require('../src/core/runtime-execution-attempt-materialization');
const {
  buildRuntimeExecutionAttemptDurableRecord,
  computeRuntimeExecutionAttemptDurableRecordDigest,
  computeRuntimeExecutionAttemptDurableRecordFingerprint
} = require('../src/core/runtime-execution-attempt-durable-record');
const {
  buildRuntimeAdmissionPolicy,
  validateRuntimeAdmissionPolicy
} = require('../src/core/runtime-admission-policy');
const {
  buildRuntimeReadinessDecision,
  validateRuntimeReadinessDecision
} = require('../src/core/runtime-readiness-decision');
const {
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATE,
  buildRuntimeExecutionAttemptAdmissionDecision,
  compareRuntimeExecutionAttemptAdmissionDecisionReplay,
  computeRuntimeExecutionAttemptAdmissionDecisionDigest,
  computeRuntimeExecutionAttemptAdmissionDecisionFingerprint,
  validateRuntimeExecutionAttemptAdmissionDecision
} = require('../src/core/runtime-execution-attempt-admission-decision-simulation');

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function compactReference(id) {
  return { id, version: 1, fingerprint: `${id}-fingerprint`, digest: ZERO_DIGEST };
}

function buildCompactP7Record() {
  const identityScope = {
    tenant_id: 'tenant-p8-compact',
    organization_id: 'organization-p8-compact',
    project_id: 'project-p8-compact',
    session_reference_id: 'session-p8-compact',
    agent_id: 'agent-p8-compact',
    actor_id: 'actor-p8-compact'
  };
  const intentReference = compactReference('intent-p8-compact');
  const dispatchReference = compactReference('dispatch-p8-compact');
  const provenanceReference = {
    upstream_reference_ids: {},
    upstream_fingerprints: {},
    dispatch_provenance_digest: ZERO_DIGEST,
    authorization_reference_ids: [],
    authorization_reference_fingerprints: []
  };
  const idempotencyReference = {
    fingerprint: 'idempotency-p8-compact-fingerprint',
    validated: true,
    consumed: false,
    duplicate_execution_blocked: true
  };
  const jobIdentity = {
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    runtime_execution_job_intent_reference: intentReference,
    dispatch_package_reference: dispatchReference,
    identity_scope: identityScope,
    idempotency_fingerprint: idempotencyReference.fingerprint,
    dispatch_provenance_digest: provenanceReference.dispatch_provenance_digest
  };
  const jobDigest = computeCanonicalContentDigest(jobIdentity);
  const jobReference = {
    id: `runtime-execution-job-${jobDigest.slice('sha256:'.length)}`,
    version: 1,
    fingerprint: stablePayload(jobIdentity),
    digest: jobDigest
  };
  const materialization = {
    runtime_execution_job_materialization_id: 'materialization-p8-compact',
    runtime_execution_job_materialization_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
    runtime_execution_job_materialization_fingerprint: 'pending',
    runtime_execution_job_materialization_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
    input_contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
    input_contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    input_validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION,
    input_status: RUNTIME_EXECUTION_JOB_INTENT_STATUS,
    input_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    input_external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    runtime_execution_job_intent_reference: intentReference,
    job_reference: jobReference,
    dispatch_package_reference: dispatchReference,
    provenance_reference: provenanceReference,
    identity_scope: identityScope,
    idempotency_reference: idempotencyReference,
    execution_job_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    execution_authorized: false,
    external_effect_allowed: false,
    provider_call_allowed: false,
    network_call_allowed: false,
    secrets_materialized: false,
    attempt_created: false,
    execution_performed: false,
    durable_job_persisted: false,
    output_persisted: false,
    simulation: true,
    production_blocked: true,
    validator_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION
  };
  materialization.runtime_execution_job_materialization_fingerprint = computeRuntimeExecutionJobMaterializationFingerprint(materialization);
  materialization.runtime_execution_job_materialization_digest = computeRuntimeExecutionJobMaterializationDigest(materialization);
  const durableJob = buildDurableJobRecord(materialization);
  const intent = buildRuntimeExecutionAttemptIntent(durableJob, 1);
  const attemptMaterialization = buildRuntimeExecutionAttemptMaterialization(intent);
  return buildRuntimeExecutionAttemptDurableRecord(attemptMaterialization);
}

function buildEvidence(record) {
  const readiness = buildRuntimeReadinessDecision({
    runtime_readiness_decision_id: 'readiness-p8-compact',
    runtime_readiness_request_id: 'readiness-request-p8-compact',
    runtime_execution_package_id: 'package-p8-compact',
    tenant_id: record.identity_scope.tenant_id,
    organization_id: record.identity_scope.organization_id,
    project_id: record.identity_scope.project_id,
    session_reference_id: record.identity_scope.session_reference_id,
    agent_id: record.identity_scope.agent_id,
    actor_id: record.identity_scope.actor_id,
    status: 'RUNTIME_READY_SIMULATION',
    runtime_readiness_request_fingerprint: 'readiness-request-fingerprint',
    runtime_execution_package_fingerprint: 'package-fingerprint',
    runtime_execution_package_digest: ZERO_DIGEST,
    runtime_capacity_snapshot_fingerprint: 'capacity-fingerprint',
    runtime_concurrency_fingerprint: 'concurrency-fingerprint',
    runtime_freshness_fingerprint: 'freshness-fingerprint',
    runtime_replay_fingerprint: 'replay-fingerprint',
    request_validated: true,
    policy_validated: true,
    runtime_package_validated: true,
    gateway_validated: true,
    execution_plan_validated: true,
    authorization_validated: true,
    authorization_scope_validated: true,
    registry_snapshot_validated: true,
    architecture_gate_evidence_validated: true,
    stage_manifest_validated: true,
    dependency_manifest_validated: true,
    binding_ledger_validated: true,
    validation_ledger_validated: true,
    budget_validated: true,
    stops_validated: true,
    compensations_validated: true,
    artifact_plan_validated: true,
    event_plan_validated: true,
    package_fingerprint_validated: true,
    package_digest_validated: true,
    freshness_validated: true,
    replay_validated: true,
    capacity_validated: true,
    concurrency_validated: true,
    non_execution_invariants_validated: true
  });
  const policy = buildRuntimeAdmissionPolicy({
    runtime_admission_policy_id: 'policy-p8-compact',
    maximum_admitted_packages_per_tenant: 10,
    maximum_admitted_packages_per_organization: 10,
    maximum_admitted_packages_per_agent: 10,
    maximum_admitted_parallel_stages: 10,
    maximum_admitted_model_stages: 10,
    maximum_admitted_tool_stages: 10,
    maximum_admitted_workflow_stages: 10,
    maximum_admitted_estimated_tokens: 10000,
    maximum_admitted_estimated_cost_minor_units: 10000
  });
  return {
    p7_durable_record: record,
    p7_persistence_facts: {
      attempt_durable_record_id: record.runtime_execution_attempt_durable_record_id,
      durable_record_fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
      durable_record_digest: record.runtime_execution_attempt_durable_record_digest,
      state: 'PREPARED',
      revision: 1,
      attempt_created: true,
      attempt_persisted: true,
      attempt_admitted: false
    },
    runtime_readiness_decision: readiness,
    runtime_admission_policy: policy
  };
}

let cachedInput;
function validInput() {
  if (!cachedInput) cachedInput = buildEvidence(buildCompactP7Record());
  return cachedInput;
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDecision() {
  return buildRuntimeExecutionAttemptAdmissionDecision(validInput());
}

test('valid PREPARED P7 attempt produces a positive simulation decision', () => {
  const input = validInput();
  assert.equal(validateRuntimeReadinessDecision(input.runtime_readiness_decision).valid, true);
  assert.equal(validateRuntimeAdmissionPolicy(input.runtime_admission_policy).valid, true);
  const decision = buildDecision();
  assert.equal(decision.status, RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATUS);
  assert.equal(decision.state, RUNTIME_EXECUTION_ATTEMPT_ADMISSION_DECISION_STATE);
  assert.equal(decision.decision, 'ADMIT_ATTEMPT_SIMULATION');
  assert.equal(validateRuntimeExecutionAttemptAdmissionDecision(decision).valid, true);
});

test('identical replay is deterministic and canonical', () => {
  const first = buildDecision();
  const second = buildDecision();
  assert.deepEqual(second, first);
  assert.deepEqual(compareRuntimeExecutionAttemptAdmissionDecisionReplay(first, mutable(second)), { status: 'IDENTICAL_REPLAY' });
  assert.equal(computeRuntimeExecutionAttemptAdmissionDecisionFingerprint(first), first.runtime_execution_attempt_admission_decision_fingerprint);
  assert.equal(computeRuntimeExecutionAttemptAdmissionDecisionDigest(first), first.runtime_execution_attempt_admission_decision_digest);
});

test('positive simulation preserves P7 identity and does not mutate the P7 record', () => {
  const input = validInput();
  const before = mutable(input.p7_durable_record);
  const decision = buildDecision();
  assert.equal(decision.runtime_execution_attempt_durable_record_reference.id, before.runtime_execution_attempt_durable_record_id);
  assert.equal(decision.attempt_ordinal, before.attempt_ordinal);
  assert.deepEqual(input.p7_durable_record, before);
  assert.equal(input.p7_persistence_facts.state, 'PREPARED');
  assert.equal(input.p7_persistence_facts.attempt_admitted, false);
});

test('successful decision has created/persisted true but admitted false and no authority', () => {
  const decision = buildDecision();
  assert.equal(decision.attempt_created, true);
  assert.equal(decision.attempt_persisted, true);
  assert.equal(decision.attempt_admitted, false);
  for (const field of [
    'claim_issued', 'lease_granted', 'fencing_token_issued', 'worker_ownership_established',
    'executor_ownership_established', 'execution_authorized', 'execution_started',
    'execution_performed', 'provider_call_allowed', 'provider_called', 'network_call_allowed',
    'network_used', 'secrets_materialized', 'external_effect_allowed', 'external_effect_performed'
  ]) assert.equal(decision[field], false, field);
  assert.equal(decision.attempt_admitted_in_simulation, true);
  assert.equal(decision.simulation, true);
  assert.equal(decision.production_blocked, true);
});

test('wrong identity, predecessor fingerprint, scope, ordinal, or state fails closed', () => {
  for (const [label, mutate] of [
    ['identity', (input) => { input.p7_persistence_facts.attempt_durable_record_id = 'wrong-id'; }],
    ['fingerprint', (input) => { input.p7_persistence_facts.durable_record_fingerprint = 'wrong-fingerprint'; }],
    ['tenant', (input) => { input.runtime_readiness_decision.tenant_id = 'wrong-tenant'; }],
    ['organization', (input) => { input.runtime_readiness_decision.organization_id = 'wrong-org'; }],
    ['project', (input) => { input.runtime_readiness_decision.project_id = 'wrong-project'; }],
    ['ordinal', (input) => { input.p7_persistence_facts.revision = 2; }],
    ['state', (input) => { input.p7_persistence_facts.state = 'ADMITTED'; }]
  ]) {
    const input = mutable(validInput());
    mutate(input);
    assert.throws(() => buildRuntimeExecutionAttemptAdmissionDecision(input), /input_invalid/, label);
  }
});

test('missing or contradictory admission evidence fails closed', () => {
  const missing = mutable(validInput());
  delete missing.runtime_readiness_decision;
  assert.throws(() => buildRuntimeExecutionAttemptAdmissionDecision(missing), /input_invalid/);
  const notReady = mutable(validInput());
  notReady.runtime_readiness_decision.status = 'RUNTIME_PACKAGE_BLOCKED';
  notReady.runtime_readiness_decision.runtime_ready_in_simulation = false;
  assert.throws(() => buildRuntimeExecutionAttemptAdmissionDecision(notReady), /input_invalid/);
  const unsafePolicy = mutable(validInput());
  unsafePolicy.runtime_admission_policy.allow_runtime_admission_simulation = false;
  assert.throws(() => buildRuntimeExecutionAttemptAdmissionDecision(unsafePolicy), /input_invalid/);
});

test('unknown fields and malformed predecessor fail closed while divergent input is deterministic', () => {
  const unknown = mutable(validInput());
  unknown.extra = true;
  assert.throws(() => buildRuntimeExecutionAttemptAdmissionDecision(unknown), /input_invalid/);
  const malformed = mutable(validInput());
  malformed.p7_durable_record.runtime_execution_attempt_durable_record_digest = 'not-a-digest';
  assert.throws(() => buildRuntimeExecutionAttemptAdmissionDecision(malformed), /input_invalid/);
  const divergent = mutable(validInput());
  divergent.runtime_admission_policy.runtime_admission_policy_id = 'different-policy';
  const divergentDecision = buildRuntimeExecutionAttemptAdmissionDecision(divergent);
  assert.equal(validateRuntimeExecutionAttemptAdmissionDecision(divergentDecision).valid, true);
  assert.notEqual(divergentDecision.runtime_execution_attempt_admission_decision_id, buildDecision().runtime_execution_attempt_admission_decision_id);
  assert.deepEqual(compareRuntimeExecutionAttemptAdmissionDecisionReplay(buildDecision(), divergentDecision), { status: 'NOT_SAME_DECISION' });
});

test('output is immutable and its integrity is independently validated', () => {
  const decision = buildDecision();
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.runtime_execution_attempt_durable_record_reference), true);
  assert.equal(Object.isFrozen(decision.runtime_readiness_decision_reference), true);
  assert.equal(Object.isFrozen(decision.runtime_admission_policy_reference), true);
  assert.equal(Object.isFrozen(decision.identity_scope), true);
  const tampered = mutable(decision);
  tampered.runtime_execution_attempt_admission_decision_id = 'arbitrary-id';
  tampered.runtime_execution_attempt_admission_decision_fingerprint = computeRuntimeExecutionAttemptAdmissionDecisionFingerprint(tampered);
  tampered.runtime_execution_attempt_admission_decision_digest = computeRuntimeExecutionAttemptAdmissionDecisionDigest(tampered);
  const validation = validateRuntimeExecutionAttemptAdmissionDecision(tampered);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('decision_id_mismatch'), true);
});

test('P8 does not create persistence or operational integration', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src/core/runtime-execution-attempt-admission-decision-simulation.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"].*adapters|\bpostgres\b|\bpg\b|INSERT|UPDATE|UPSERT|SELECT\s+.*FOR\s+UPDATE|pool|transaction|fetch\s*\(/i);
});
