'use strict';

// Test-only helper that builds a fully self-consistent "golden" ExecutionGatewayRequest bundle --
// every id/fingerprint/tenant agreeing with every other reference -- by running a real
// ExecutionPlanRequest fixture through the real execution-plan-engine, then wiring the rest of the
// Gateway's 15 nested references directly via their own real builders. Used both to regenerate the
// curated JSON fixture and to construct the long tail of one-field-mutation scenarios inline in the
// test file (mutations that don't earn their own persisted fixture entry).

const { evaluateExecutionPlanRequest } = require('../../src/core/execution-plan-engine');
const { buildExecutionAuthorizationDecision } = require('../../src/core/execution-authorization-decision');
const { buildExecutionGatewayPolicy } = require('../../src/core/execution-gateway-policy');
const { buildArchitectureGateEvidenceReference, buildGateResult } = require('../../src/core/architecture-gate-evidence-reference');
const { buildExecutionGatewayFreshnessReference } = require('../../src/core/execution-gateway-freshness-reference');
const { buildExecutionGatewayReplayReference } = require('../../src/core/execution-gateway-replay-reference');
const { buildExecutionGatewayPackageReference } = require('../../src/core/execution-gateway-package-reference');
const { buildExecutionGatewayRequest } = require('../../src/core/execution-gateway-request');
const { buildExecutionReferenceBindingLedger } = require('../../src/core/execution-reference-binding-ledger');
const { buildBindingRecord } = require('../../src/core/execution-reference-binding-record');
const { stablePayload } = require('../../src/core/agent-identity-contract');
const { computeGatewayPackageDigest, evaluateExecutionGatewayRequest } = require('../../src/core/execution-gateway-boundary');

const planFixture = require('../fixtures/hermes-execution-plan-contracts.json');

function safeFingerprint(value) {
  return stablePayload(value === undefined || value === null ? null : value);
}

function buildGoldenBundle(scenarioKey = 'prepared-no-llm-plan') {
  const request = JSON.parse(JSON.stringify(planFixture.scenarios[scenarioKey].request));
  const outcome = evaluateExecutionPlanRequest(request, {});
  const { plan, result, validationLedger } = outcome;

  const authorizationDecision = buildExecutionAuthorizationDecision({
    authorization_decision_id: plan.authorization_decision_id,
    authorization_request_id: 'authzreq-1',
    decision_result_id: 'decreq-1-result',
    readiness_bundle_id: 'bundle-1',
    planning_result_id: plan.planning_result_id,
    plan_id: plan.orchestration_plan_id,
    agent_id: plan.agent_id,
    tenant_id: plan.tenant_id,
    organization_id: plan.organization_id,
    project_id: plan.project_id,
    session_reference_id: plan.session_reference_id,
    status: 'AUTHORIZED_SIMULATION',
    actor_id: request.authorization_scope_reference.actor_id,
    actor_role: 'AGENT_OPERATOR',
    authorization_scope_id: 'scope-1',
    approval_reference_id: 'approval-1',
    budget_authorization_id: 'budget-authz-1',
    expiration_evaluation_id: 'expiration-1',
    task_reference_id: plan.task_reference_id,
    registry_version: '1',
    request_validated: true, orchestrator_decision_validated: true, evidence_bundle_validated: true,
    bindings_validated: true, versions_validated: true, fingerprints_validated: true, actor_validated: true,
    role_validated: true, scope_validated: true, risk_validated: true, approval_validated: true,
    budget_validated: true, expiration_validated: true, task_validated: true, task_type_validated: true,
    risk_classification_validated: true, authorized_in_simulation: true
  });

  // fetch the plan's own real nested references directly from the request (already built,
  // already self-consistent) -- never re-derived.
  const provenanceReference = request.authorization_provenance_reference;
  const scopeReference = request.authorization_scope_reference;
  const snapshotReference = request.registry_snapshot_reference;
  const stageManifestReference = request.stage_manifest_reference;
  const dependencyGraphReference = request.dependency_graph_reference;

  // BindingLedger: execution-plan-engine.js never exposes the raw ledger it built internally, so
  // a matching one is constructed directly here for gateway cross-check purposes -- structurally
  // valid and self-consistent with the same ids, not a byte-for-byte reproduction of the engine's
  // own internal one (which is not observable from outside).
  const bindingRecord = buildBindingRecord({
    binding_record_id: `${plan.execution_plan_id}-authz-record`,
    execution_plan_request_id: request.execution_plan_request_id,
    execution_plan_id: plan.execution_plan_id,
    execution_stage_id: null,
    binding_type: 'AUTHORIZATION_SCOPE_BINDING',
    source_reference_id: scopeReference.authorization_scope_reference_id,
    source_reference_version: scopeReference.authorization_scope_reference_version,
    source_reference_fingerprint: scopeReference.scope_fingerprint,
    target_reference_id: scopeReference.authorization_scope_reference_id,
    target_reference_version: scopeReference.authorization_scope_reference_version,
    target_reference_fingerprint: scopeReference.scope_fingerprint,
    tenant_id: plan.tenant_id, organization_id: plan.organization_id, project_id: plan.project_id,
    session_reference_id: plan.session_reference_id, agent_id: plan.agent_id, actor_id: request.authorization_scope_reference.actor_id,
    authorization_scope_id: scopeReference.authorization_scope_id,
    binding_required: true, binding_validated: true, binding_status: 'VALIDATED_SIMULATION', logical_sequence: 0
  });
  const bindingLedger = buildExecutionReferenceBindingLedger({
    binding_ledger_id: `${plan.execution_plan_id}-binding-ledger`,
    execution_plan_request_id: request.execution_plan_request_id,
    execution_plan_id: plan.execution_plan_id,
    authorization_decision_id: plan.authorization_decision_id,
    authorization_scope_reference_id: scopeReference.authorization_scope_reference_id,
    authorization_provenance_reference_id: provenanceReference.authorization_provenance_reference_id,
    registry_snapshot_reference_id: snapshotReference.registry_snapshot_reference_id,
    tenant_id: plan.tenant_id, organization_id: plan.organization_id, project_id: plan.project_id,
    session_reference_id: plan.session_reference_id, agent_id: plan.agent_id, actor_id: request.authorization_scope_reference.actor_id,
    binding_records: [bindingRecord], all_required_bindings_present: true, logical_sequence: 0
  });

  const evidenceReference = buildArchitectureGateEvidenceReference({
    architecture_gate_evidence_reference_id: `${plan.execution_plan_id}-gate-evidence`,
    repository_reference: { repository_id: 'repo-1', repository_full_name: 'instutodp-cpu/agente-grupo-erick', default_branch: 'main' },
    commit_sha: 'a'.repeat(40), base_commit_sha: 'b'.repeat(40),
    workflow_reference: { workflow_id: 'wf-1', workflow_name: 'hermes-core-smoke', workflow_version: 'v1' },
    workflow_run_reference: {
      workflow_run_id: 'run-1', workflow_run_attempt: 1, workflow_run_status: 'COMPLETED',
      workflow_run_conclusion: 'SUCCESS', head_commit_sha: 'a'.repeat(40), base_commit_sha: 'b'.repeat(40),
      trigger_type: 'PUSH_REFERENCE'
    },
    ruleset_id: 'ruleset-1', ruleset_version: '1',
    gate_results: [buildGateResult({
      gate_result_id: 'gr-1', gate_id: 'FORBIDDEN_EVAL', gate_version: 'v1', gate_status: 'PASSED',
      severity: 'CRITICAL', required: true, finding_code_references: []
    })],
    evidence_created_logical_sequence: 0, maximum_valid_sequences: 1000, current_logical_sequence: 5
  });

  const freshnessReference = buildExecutionGatewayFreshnessReference({
    freshness_reference_id: `${plan.execution_plan_id}-freshness`,
    execution_plan_id: plan.execution_plan_id,
    authorization_decision_id: plan.authorization_decision_id,
    registry_snapshot_reference_id: snapshotReference.registry_snapshot_reference_id,
    architecture_gate_evidence_reference_id: evidenceReference.architecture_gate_evidence_reference_id,
    created_logical_sequence: 0, current_logical_sequence: 5, maximum_valid_sequences: 1000
  });

  const replayReference = buildExecutionGatewayReplayReference({
    gateway_replay_reference_id: `${plan.execution_plan_id}-replay`,
    execution_plan_id: plan.execution_plan_id,
    execution_plan_fingerprint: plan.plan_fingerprint,
    gateway_request_id: `${plan.execution_plan_id}-gateway-request`,
    gateway_request_fingerprint: 'fp-gateway-request-placeholder',
    idempotency_reference_id: 'idem-1',
    idempotency_fingerprint: 'fp-idem-1',
    expected_gateway_attempt: 1, maximum_gateway_attempts: 3,
    prior_gateway_decision_ids: [], prior_gateway_decision_fingerprints: []
  });

  const authorizationFingerprint = safeFingerprint(authorizationDecision);
  const packageReference = buildExecutionGatewayPackageReference({
    gateway_package_reference_id: `${plan.execution_plan_id}-package-reference`,
    execution_plan_id: plan.execution_plan_id,
    execution_plan_request_id: request.execution_plan_request_id,
    execution_plan_result_id: result.result_id,
    authorization_decision_id: plan.authorization_decision_id,
    authorization_provenance_reference_id: plan.authorization_provenance_reference_id,
    authorization_scope_reference_id: plan.authorization_scope_reference_id,
    registry_snapshot_reference_id: plan.registry_snapshot_reference_id,
    stage_manifest_reference_id: plan.stage_manifest_reference_id,
    dependency_graph_reference_id: dependencyGraphReference.dependency_graph_reference_id,
    binding_ledger_id: bindingLedger.binding_ledger_id,
    validation_ledger_id: validationLedger.validation_ledger_id,
    architecture_gate_evidence_reference_id: evidenceReference.architecture_gate_evidence_reference_id,
    tenant_id: plan.tenant_id, organization_id: plan.organization_id, project_id: plan.project_id,
    session_reference_id: plan.session_reference_id, agent_id: plan.agent_id, actor_id: request.authorization_scope_reference.actor_id,
    execution_plan_status: plan.execution_plan_status,
    execution_plan_result_status: result.status,
    execution_plan_fingerprint: plan.plan_fingerprint,
    execution_plan_result_fingerprint: result.execution_plan_fingerprint,
    authorization_fingerprint: authorizationFingerprint,
    authorization_provenance_fingerprint: plan.authorization_provenance_fingerprint,
    authorization_scope_fingerprint: plan.authorization_scope_fingerprint,
    registry_snapshot_fingerprint: plan.registry_snapshot_fingerprint,
    stage_manifest_fingerprint: plan.stage_manifest_fingerprint,
    dependency_graph_fingerprint: dependencyGraphReference.graph_fingerprint,
    binding_ledger_fingerprint: bindingLedger.ledger_fingerprint,
    validation_ledger_fingerprint: validationLedger.ledger_fingerprint,
    architecture_gate_evidence_fingerprint: evidenceReference.evidence_fingerprint,
    package_digest: computeGatewayPackageDigest({
      plan, result, authorizationDecision, provenanceReference, scopeReference, snapshotReference,
      stageManifestReference, dependencyGraphReference, bindingLedger, validationLedger, evidenceReference
    })
  });

  const policy = buildExecutionGatewayPolicy({ gateway_policy_id: `${plan.execution_plan_id}-gateway-policy` });

  const gatewayRequest = buildExecutionGatewayRequest({
    gateway_request_id: `${plan.execution_plan_id}-gateway-request`,
    gateway_policy: policy,
    gateway_package_reference: packageReference,
    execution_plan_reference: plan,
    execution_plan_result_reference: result,
    authorization_decision_reference: authorizationDecision,
    authorization_provenance_reference: provenanceReference,
    authorization_scope_reference: scopeReference,
    registry_snapshot_reference: snapshotReference,
    stage_manifest_reference: stageManifestReference,
    dependency_graph_reference: dependencyGraphReference,
    binding_ledger_reference: bindingLedger,
    validation_ledger_reference: validationLedger,
    architecture_gate_evidence_reference: evidenceReference,
    freshness_reference: freshnessReference,
    replay_reference: replayReference,
    correlation_id: 'corr-1', causation_id: 'cause-1', trace_id: 'trace-1',
    logical_sequence: 0, expected_gateway_registry_version: 1,
    simulation_context: request.simulation_context
  });

  return {
    plan, result, validationLedger, authorizationDecision, provenanceReference, scopeReference, snapshotReference,
    stageManifestReference, dependencyGraphReference, bindingLedger, evidenceReference, freshnessReference,
    replayReference, packageReference, policy, gatewayRequest
  };
}

function rebuildEvidence(golden, overrides = {}) {
  return buildArchitectureGateEvidenceReference({
    architecture_gate_evidence_reference_id: golden.evidenceReference.architecture_gate_evidence_reference_id,
    repository_reference: golden.evidenceReference.repository_reference,
    commit_sha: golden.evidenceReference.commit_sha, base_commit_sha: golden.evidenceReference.base_commit_sha,
    workflow_reference: golden.evidenceReference.workflow_reference,
    workflow_run_reference: golden.evidenceReference.workflow_run_reference,
    ruleset_id: golden.evidenceReference.ruleset_id, ruleset_version: golden.evidenceReference.ruleset_version,
    gate_results: golden.evidenceReference.gate_results,
    evidence_created_logical_sequence: golden.evidenceReference.evidence_created_logical_sequence,
    maximum_valid_sequences: golden.evidenceReference.maximum_valid_sequences,
    current_logical_sequence: golden.evidenceReference.current_logical_sequence,
    ...overrides
  });
}

module.exports = { buildGoldenBundle, rebuildEvidence, safeFingerprint, evaluateExecutionGatewayRequest };
