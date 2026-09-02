'use strict';

const { cloneFrozen, stablePayload } = require('../../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../../src/core/canonical-content-digest');
const {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
} = require('../../src/core/runtime-execution-job-intent');
const {
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION
} = require('../../src/core/runtime-execution-job-materialization');
const { buildDurableJobRecord } = require('../../src/core/runtime-execution-job-durable-contract');
const { buildRuntimeExecutionAttemptIntent } = require('../../src/core/runtime-execution-attempt-intent');
const { buildRuntimeExecutionAttemptMaterialization } = require('../../src/core/runtime-execution-attempt-materialization');
const {
  buildRuntimeExecutionAttemptDurableRecord,
  computeRuntimeExecutionAttemptDurableRecordDigest,
  computeRuntimeExecutionAttemptDurableRecordFingerprint,
  computeRuntimeExecutionAttemptDurableRecordId,
  validateRuntimeExecutionAttemptDurableRecord
} = require('../../src/core/runtime-execution-attempt-durable-record');
const { buildRuntimeAdmissionPolicy } = require('../../src/core/runtime-admission-policy');
const { buildRuntimeReadinessDecision } = require('../../src/core/runtime-readiness-decision');
const { buildRuntimeExecutionAttemptAdmissionDecision } = require('../../src/core/runtime-execution-attempt-admission-decision-simulation');

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function reference(id) {
  return { id, version: 1, fingerprint: `${id}-fingerprint`, digest: ZERO_DIGEST };
}

function buildP7Record(attemptOrdinal = 1) {
  const identityScope = {
    tenant_id: 'tenant-p9', organization_id: 'organization-p9', project_id: 'project-p9',
    session_reference_id: 'session-p9', agent_id: 'agent-p9', actor_id: 'actor-p9'
  };
  const intentReference = reference('intent-p9');
  const dispatchReference = reference('dispatch-p9');
  const provenanceReference = {
    upstream_reference_ids: {}, upstream_fingerprints: {}, dispatch_provenance_digest: ZERO_DIGEST,
    authorization_reference_ids: [], authorization_reference_fingerprints: []
  };
  const idempotencyReference = {
    fingerprint: 'idempotency-p9-fingerprint', validated: true, consumed: false, duplicate_execution_blocked: true
  };
  const jobIdentity = {
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    runtime_execution_job_intent_reference: intentReference,
    dispatch_package_reference: dispatchReference, identity_scope: identityScope,
    idempotency_fingerprint: idempotencyReference.fingerprint,
    dispatch_provenance_digest: provenanceReference.dispatch_provenance_digest
  };
  const jobDigest = computeCanonicalContentDigest(jobIdentity);
  const jobReference = { id: `runtime-execution-job-${jobDigest.slice(7)}`, version: 1, fingerprint: stablePayload(jobIdentity), digest: jobDigest };
  const materialization = {
    runtime_execution_job_materialization_id: 'materialization-p9',
    runtime_execution_job_materialization_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
    runtime_execution_job_materialization_fingerprint: 'pending', runtime_execution_job_materialization_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
    input_contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
    input_contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    input_validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION,
    input_status: RUNTIME_EXECUTION_JOB_INTENT_STATUS, input_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    input_external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    runtime_execution_job_intent_reference: intentReference, job_reference: jobReference,
    dispatch_package_reference: dispatchReference, provenance_reference: provenanceReference,
    identity_scope: identityScope, idempotency_reference: idempotencyReference,
    execution_job_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    execution_authorized: false, external_effect_allowed: false, provider_call_allowed: false,
    network_call_allowed: false, secrets_materialized: false, attempt_created: false,
    execution_performed: false, durable_job_persisted: false, output_persisted: false,
    simulation: true, production_blocked: true,
    validator_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION
  };
  const { computeRuntimeExecutionJobMaterializationFingerprint: fingerprint, computeRuntimeExecutionJobMaterializationDigest: digest } = require('../../src/core/runtime-execution-job-materialization');
  materialization.runtime_execution_job_materialization_fingerprint = fingerprint(materialization);
  materialization.runtime_execution_job_materialization_digest = digest(materialization);
  return buildRuntimeExecutionAttemptDurableRecord(
    buildRuntimeExecutionAttemptMaterialization(buildRuntimeExecutionAttemptIntent(buildDurableJobRecord(materialization), attemptOrdinal))
  );
}

function compactReference(reference) {
  const material = { id: reference.id, version: reference.version, digest: reference.digest };
  return { ...reference, fingerprint: stablePayload(material) };
}

function buildCompactP7Record(attemptOrdinal = 1) {
  const record = JSON.parse(JSON.stringify(buildP7Record(attemptOrdinal)));
  for (const field of [
    'runtime_execution_attempt_materialization_reference',
    'runtime_execution_attempt_intent_reference',
    'durable_job_reference',
    'admission_reference'
  ]) record[field] = compactReference(record[field]);

  record.runtime_execution_attempt_durable_record_id = computeRuntimeExecutionAttemptDurableRecordId({
    materializationReference: record.runtime_execution_attempt_materialization_reference,
    intentReference: record.runtime_execution_attempt_intent_reference,
    durableJobReference: record.durable_job_reference,
    logicalJobIdentityDigest: record.logical_job_identity_digest,
    admissionReference: record.admission_reference,
    identityScope: record.identity_scope,
    attemptOrdinal: record.attempt_ordinal
  });
  record.runtime_execution_attempt_durable_record_fingerprint = computeRuntimeExecutionAttemptDurableRecordFingerprint(record);
  record.runtime_execution_attempt_durable_record_digest = computeRuntimeExecutionAttemptDurableRecordDigest(record);
  const validation = validateRuntimeExecutionAttemptDurableRecord(record);
  if (!validation.valid) throw new Error(`compact_p7_fixture_invalid::${JSON.stringify(validation.errors)}`);
  return cloneFrozen(record);
}

function buildP8Input(record) {
  const scope = record.identity_scope;
  const readiness = buildRuntimeReadinessDecision({
    runtime_readiness_decision_id: 'readiness-p9', runtime_readiness_request_id: 'readiness-request-p9',
    runtime_execution_package_id: 'package-p9', ...scope, status: 'RUNTIME_READY_SIMULATION',
    runtime_readiness_request_fingerprint: 'readiness-request-fingerprint',
    runtime_execution_package_fingerprint: 'package-fingerprint', runtime_execution_package_digest: ZERO_DIGEST,
    runtime_capacity_snapshot_fingerprint: 'capacity-fingerprint', runtime_concurrency_fingerprint: 'concurrency-fingerprint',
    runtime_freshness_fingerprint: 'freshness-fingerprint', runtime_replay_fingerprint: 'replay-fingerprint',
    ...Object.fromEntries([
      'request_validated', 'policy_validated', 'runtime_package_validated', 'gateway_validated', 'execution_plan_validated',
      'authorization_validated', 'authorization_scope_validated', 'registry_snapshot_validated', 'architecture_gate_evidence_validated',
      'stage_manifest_validated', 'dependency_manifest_validated', 'binding_ledger_validated', 'validation_ledger_validated',
      'budget_validated', 'stops_validated', 'compensations_validated', 'artifact_plan_validated', 'event_plan_validated',
      'package_fingerprint_validated', 'package_digest_validated', 'freshness_validated', 'replay_validated',
      'capacity_validated', 'concurrency_validated', 'non_execution_invariants_validated'
    ].map((field) => [field, true]))
  });
  const policy = buildRuntimeAdmissionPolicy({
    runtime_admission_policy_id: 'policy-p9', maximum_admitted_packages_per_tenant: 10,
    maximum_admitted_packages_per_organization: 10, maximum_admitted_packages_per_agent: 10,
    maximum_admitted_parallel_stages: 10, maximum_admitted_model_stages: 10,
    maximum_admitted_tool_stages: 10, maximum_admitted_workflow_stages: 10,
    maximum_admitted_estimated_tokens: 10000, maximum_admitted_estimated_cost_minor_units: 10000
  });
  const facts = {
    attempt_durable_record_id: record.runtime_execution_attempt_durable_record_id,
    durable_record_fingerprint: record.runtime_execution_attempt_durable_record_fingerprint,
    durable_record_digest: record.runtime_execution_attempt_durable_record_digest,
    state: 'PREPARED', revision: 1, attempt_created: true, attempt_persisted: true, attempt_admitted: false
  };
  return {
    p7_durable_record: record, p7_persistence_facts: facts,
    runtime_readiness_decision: readiness, runtime_admission_policy: policy
  };
}

function buildAdmissionInput(attemptOrdinal = 1, { compact = false } = {}) {
  const p7 = compact ? buildCompactP7Record(attemptOrdinal) : buildP7Record(attemptOrdinal);
  return { p7_durable_record: p7, p8_admission_decision: buildRuntimeExecutionAttemptAdmissionDecision(buildP8Input(p7)) };
}

module.exports = { buildAdmissionInput, buildCompactP7Record, buildP7Record };
