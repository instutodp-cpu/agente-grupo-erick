'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const fixture = require('./fixtures/hermes-execution-gateway-boundary-simulation.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  ARCHITECTURE_GATE_EVIDENCE_REFERENCE_FIELDS, ARCHITECTURE_GATE_EVIDENCE_REFERENCE_SAFE_FLAGS, EVIDENCE_STATUSES,
  GATE_STATUSES, buildArchitectureGateEvidenceReference, buildGateResult,
  validateArchitectureGateEvidenceReference
} = require('../src/core/architecture-gate-evidence-reference');
const {
  EXECUTION_GATEWAY_POLICY_FIELDS, EXECUTION_GATEWAY_POLICY_SAFE_FLAGS,
  buildExecutionGatewayPolicy, validateExecutionGatewayPolicy
} = require('../src/core/execution-gateway-policy');
const {
  EXECUTION_GATEWAY_FRESHNESS_REFERENCE_FIELDS, EXECUTION_GATEWAY_FRESHNESS_REFERENCE_SAFE_FLAGS,
  buildExecutionGatewayFreshnessReference, validateExecutionGatewayFreshnessReference
} = require('../src/core/execution-gateway-freshness-reference');
const {
  EXECUTION_GATEWAY_REPLAY_REFERENCE_FIELDS, EXECUTION_GATEWAY_REPLAY_REFERENCE_SAFE_FLAGS,
  buildExecutionGatewayReplayReference, validateExecutionGatewayReplayReference
} = require('../src/core/execution-gateway-replay-reference');
const {
  EXECUTION_GATEWAY_PACKAGE_REFERENCE_FIELDS, EXECUTION_GATEWAY_PACKAGE_REFERENCE_SAFE_FLAGS,
  buildExecutionGatewayPackageReference, validateExecutionGatewayPackageReference
} = require('../src/core/execution-gateway-package-reference');
const {
  EXECUTION_GATEWAY_REQUEST_FIELDS, buildExecutionGatewayRequest, validateExecutionGatewayRequest
} = require('../src/core/execution-gateway-request');
const {
  GATEWAY_STATUSES, GATEWAY_DECISIONS, GATEWAY_NEXT_STATES, OPERATIONAL_SAFE_FLAGS: DECISION_SAFE_FLAGS,
  STATUS_OUTCOME_MAP, buildExecutionGatewayDecision, validateExecutionGatewayDecision
} = require('../src/core/execution-gateway-decision');
const {
  OPERATIONAL_SAFE_FLAGS: RESULT_SAFE_FLAGS, buildExecutionGatewayResult, validateExecutionGatewayResult
} = require('../src/core/execution-gateway-result');
const { buildExecutionGatewayAudit, validateExecutionGatewayAudit } = require('../src/core/execution-gateway-audit');
const {
  checkIdentity, computeGatewayPackageDigest, evaluateExecutionGatewayRequest
} = require('../src/core/execution-gateway-boundary');
const { createExecutionGatewayRegistry } = require('../src/core/execution-gateway-registry');
const { buildAuthorizationScopeReference } = require('../src/core/execution-authorization-scope-reference');
const { buildExecutionRegistrySnapshotReference } = require('../src/core/execution-registry-snapshot-reference');
const { buildOrchestratorStageManifestReference, buildStageRecord } = require('../src/core/orchestrator-stage-manifest-reference');
const { buildExecutionPlanDependencyGraphReference, buildDependencyRecord } = require('../src/core/execution-plan-dependency-graph-reference');
const { buildExecutionAuthorizationDecision } = require('../src/core/execution-authorization-decision');
const { buildGoldenBundle, rebuildEvidence } = require('./helpers/execution-gateway-test-data');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

const EXPECTED_SCENARIOS = [
  'gateway-accepted-no-llm-simulation', 'gateway-accepted-model-reference-simulation',
  'gateway-accepted-tool-reference-simulation', 'gateway-accepted-workflow-reference-simulation',
  'execution-plan-not-prepared', 'execution-result-not-prepared', 'validation-pipeline-incomplete',
  'references-not-bound', 'authorization-blocked', 'provenance-blocked', 'scope-blocked',
  'registry-snapshot-blocked', 'stage-manifest-blocked', 'architecture-evidence-failed',
  'package-fingerprint-mismatch', 'package-digest-mismatch', 'freshness-expired', 'replay-blocked',
  'tenant-mismatch'
];

const EXPECTED_STATUS_BY_SCENARIO = {
  'gateway-accepted-no-llm-simulation': 'GATEWAY_ACCEPTED_SIMULATION',
  'gateway-accepted-model-reference-simulation': 'GATEWAY_ACCEPTED_SIMULATION',
  'gateway-accepted-tool-reference-simulation': 'GATEWAY_ACCEPTED_SIMULATION',
  'gateway-accepted-workflow-reference-simulation': 'GATEWAY_ACCEPTED_SIMULATION',
  'execution-plan-not-prepared': 'EXECUTION_PLAN_BLOCKED',
  'execution-result-not-prepared': 'EXECUTION_PLAN_RESULT_BLOCKED',
  'validation-pipeline-incomplete': 'VALIDATION_LEDGER_BLOCKED',
  'references-not-bound': 'REFERENCE_BINDING_BLOCKED',
  'authorization-blocked': 'AUTHORIZATION_BLOCKED',
  'provenance-blocked': 'AUTHORIZATION_PROVENANCE_BLOCKED',
  'scope-blocked': 'AUTHORIZATION_SCOPE_BLOCKED',
  'registry-snapshot-blocked': 'REGISTRY_SNAPSHOT_BLOCKED',
  'stage-manifest-blocked': 'STAGE_MANIFEST_BLOCKED',
  'architecture-evidence-failed': 'ARCHITECTURE_GATE_EVIDENCE_BLOCKED',
  'package-fingerprint-mismatch': 'PACKAGE_FINGERPRINT_BLOCKED',
  'package-digest-mismatch': 'PACKAGE_DIGEST_BLOCKED',
  'freshness-expired': 'FRESHNESS_BLOCKED',
  'replay-blocked': 'REPLAY_BLOCKED',
  'tenant-mismatch': 'TENANT_BLOCKED'
};

// --- Fixture shape / regression --------------------------------------------------------------

test('fixture carries exactly the expected scenario set', () => {
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.equal(fixture.simulation, true);
  assert.equal(fixture.production_blocked, true);
});

test('regression: every fixture scenario re-evaluates to its stored status and decision', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    const outcome = evaluateExecutionGatewayRequest(clone(scenario.request), {});
    assert.equal(outcome.decision.status, EXPECTED_STATUS_BY_SCENARIO[key], key);
    assert.equal(outcome.decision.status, scenario.decision.status, `${key}: fixture drifted from stored status`);
    assert.equal(outcome.decision.decision, scenario.decision.decision, key);
    assert.equal(outcome.decision.next_state, scenario.decision.next_state, key);
    assert.equal(outcome.decision.gateway_accepted_in_simulation, scenario.decision.status === 'GATEWAY_ACCEPTED_SIMULATION', key);
  }
});

test('regression: every fixture request and decision is independently valid', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    assertValid(`${key} request`, validateExecutionGatewayRequest(scenario.request));
    assertValid(`${key} decision`, validateExecutionGatewayDecision(scenario.decision));
  }
});

// --- Architecture Gate Evidence Reference -----------------------------------------------------

test('architecture gate evidence reference: exact fields and safe flags', () => {
  const golden = buildGoldenBundle();
  assertValid('evidence', validateArchitectureGateEvidenceReference(golden.evidenceReference));
  assert.deepEqual(Object.keys(golden.evidenceReference).sort(), [...ARCHITECTURE_GATE_EVIDENCE_REFERENCE_FIELDS].sort());
  for (const [field, expected] of Object.entries(ARCHITECTURE_GATE_EVIDENCE_REFERENCE_SAFE_FLAGS)) {
    assert.equal(golden.evidenceReference[field], expected, field);
  }
  assert.equal(golden.evidenceReference.evidence_status, 'ARCHITECTURE_GATES_PASSED_SIMULATION');
});

test('architecture gate evidence reference: derives FAILED when a required gate fails', () => {
  const golden = buildGoldenBundle();
  const failedGate = buildGateResult({
    gate_result_id: 'gr-fail', gate_id: 'FORBIDDEN_EVAL', gate_version: 'v1', gate_status: 'FAILED',
    severity: 'CRITICAL', required: true, finding_code_references: ['eval_found_in_module']
  });
  const evidence = rebuildEvidence(golden, { gate_results: [failedGate] });
  assert.equal(evidence.evidence_status, 'ARCHITECTURE_GATES_FAILED');
  assert.equal(evidence.failed_gate_count, 1);
});

test('architecture gate evidence reference: derives CONFLICTED on head-commit mismatch', () => {
  const golden = buildGoldenBundle();
  const evidence = rebuildEvidence(golden, {
    workflow_run_reference: { ...golden.evidenceReference.workflow_run_reference, head_commit_sha: 'c'.repeat(40) }
  });
  assert.equal(evidence.evidence_status, 'ARCHITECTURE_GATES_CONFLICTED');
});

test('architecture gate evidence reference: derives INCOMPLETE when workflow run is not completed', () => {
  const golden = buildGoldenBundle();
  const evidence = rebuildEvidence(golden, {
    workflow_run_reference: { ...golden.evidenceReference.workflow_run_reference, workflow_run_status: 'IN_PROGRESS' }
  });
  assert.equal(evidence.evidence_status, 'ARCHITECTURE_GATES_INCOMPLETE');
});

test('architecture gate evidence reference: rejects commit_sha that is not a 40-hex sha', () => {
  assert.throws(() => rebuildEvidence(buildGoldenBundle(), { commit_sha: 'not-a-sha' }));
});

test('architecture gate evidence reference: rejects forbidden material in gate results', () => {
  // buildGateResult itself has no forbidden-material scan (it's scanned as part of the parent
  // evidence reference, matching agent-identity-contract's own "scan the outermost aggregate"
  // convention) -- 'eval-found' only surfaces once the gate result is embedded in a full evidence
  // reference and that reference's own findAgentCoreOperationalMaterial pass runs.
  const golden = buildGoldenBundle();
  const badGate = buildGateResult({
    gate_result_id: 'gr-bad', gate_id: 'FORBIDDEN_EVAL', gate_version: 'v1', gate_status: 'FAILED',
    severity: 'CRITICAL', required: true, finding_code_references: ['eval-found']
  });
  assert.throws(() => rebuildEvidence(golden, { gate_results: [badGate] }));
});

// --- Execution Gateway Policy --------------------------------------------------------------

test('execution gateway policy: exact fields, safe flags forced regardless of input', () => {
  const policy = buildExecutionGatewayPolicy({
    gateway_policy_id: 'pol-1',
    allow_waiting_approval_package: true, allow_irreversible_reference: true,
    require_prepared_execution_plan: false, fail_on_any_blocker: false
  });
  assertValid('policy', validateExecutionGatewayPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...EXECUTION_GATEWAY_POLICY_FIELDS].sort());
  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_POLICY_SAFE_FLAGS)) {
    assert.equal(policy[field], expected, field);
  }
});

test('execution gateway policy: only the six documented flags are caller-configurable', () => {
  const restrictive = buildExecutionGatewayPolicy({
    gateway_policy_id: 'pol-2', allow_no_llm_package: false, allow_model_reference_package: false,
    allow_tool_reference_package: false, allow_workflow_reference_package: false,
    allow_parallel_package: false, fail_on_warning: true
  });
  assert.equal(restrictive.allow_no_llm_package, false);
  assert.equal(restrictive.allow_model_reference_package, false);
  assert.equal(restrictive.fail_on_warning, true);
});

// --- Execution Gateway Freshness Reference --------------------------------------------------

test('execution gateway freshness reference: exact fields, package_expired_logically derived', () => {
  const golden = buildGoldenBundle();
  assertValid('freshness', validateExecutionGatewayFreshnessReference(golden.freshnessReference));
  assert.deepEqual(Object.keys(golden.freshnessReference).sort(), [...EXECUTION_GATEWAY_FRESHNESS_REFERENCE_FIELDS].sort());
  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_FRESHNESS_REFERENCE_SAFE_FLAGS)) {
    assert.equal(golden.freshnessReference[field], expected, field);
  }
  assert.equal(golden.freshnessReference.package_expired_logically, false);
  assert.equal(golden.freshnessReference.freshness_validated, true);
});

test('execution gateway freshness reference: package_expired_logically true past the sequence budget', () => {
  const golden = buildGoldenBundle();
  const fresh = buildExecutionGatewayFreshnessReference({
    ...golden.freshnessReference,
    current_logical_sequence: golden.freshnessReference.created_logical_sequence + golden.freshnessReference.maximum_valid_sequences + 1
  });
  assert.equal(fresh.package_expired_logically, true);
  assert.equal(fresh.freshness_validated, false);
});

for (const field of ['authorization_expired_logically', 'registry_snapshot_expired_logically', 'architecture_evidence_expired_logically']) {
  test(`execution gateway freshness reference: freshness_validated false when ${field} is true`, () => {
    const golden = buildGoldenBundle();
    const fresh = buildExecutionGatewayFreshnessReference({ ...golden.freshnessReference, [field]: true });
    assert.equal(fresh[field], true);
    assert.equal(fresh.freshness_validated, false);
  });
}

// --- Execution Gateway Replay Reference -----------------------------------------------------

test('execution gateway replay reference: exact fields, safety-by-construction on attempt budget', () => {
  const golden = buildGoldenBundle();
  assertValid('replay', validateExecutionGatewayReplayReference(golden.replayReference));
  assert.deepEqual(Object.keys(golden.replayReference).sort(), [...EXECUTION_GATEWAY_REPLAY_REFERENCE_FIELDS].sort());
  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_REPLAY_REFERENCE_SAFE_FLAGS)) {
    assert.equal(golden.replayReference[field], expected, field);
  }
  assert.equal(golden.replayReference.replay_allowed, true);
});

test('execution gateway replay reference: refuses to construct past the attempt budget', () => {
  const golden = buildGoldenBundle();
  assert.throws(() => buildExecutionGatewayReplayReference({
    ...golden.replayReference, expected_gateway_attempt: golden.replayReference.maximum_gateway_attempts + 1
  }));
});

test('execution gateway replay reference: replay_fingerprint is a compact digest, not a raw compounded payload', () => {
  const golden = buildGoldenBundle();
  // execution_plan_fingerprint alone is a large canonical package fingerprint (copied from the
  // plan) -- the whole reference's own self-fingerprint must stay small regardless.
  assert.ok(golden.replayReference.replay_fingerprint.length < 200, `replay_fingerprint too large: ${golden.replayReference.replay_fingerprint.length}`);
});

test('execution gateway replay reference: prior_gateway_decision_ids/fingerprints are canonicalized together as pairs', () => {
  const golden = buildGoldenBundle();
  // Sorting is by (id, fingerprint) pair, not independently -- otherwise sorting ids alone would
  // silently desynchronize them from their corresponding fingerprints.
  const replay = buildExecutionGatewayReplayReference({
    ...golden.replayReference, prior_gateway_decision_ids: ['b', 'a'], prior_gateway_decision_fingerprints: ['fp-b', 'fp-a']
  });
  assert.deepEqual(replay.prior_gateway_decision_ids, ['a', 'b']);
  assert.deepEqual(replay.prior_gateway_decision_fingerprints, ['fp-a', 'fp-b']);
});

test('execution gateway replay reference: rejects a length mismatch between ids and fingerprints', () => {
  const golden = buildGoldenBundle();
  assert.throws(() => buildExecutionGatewayReplayReference({
    ...golden.replayReference, prior_gateway_decision_ids: ['a', 'b'], prior_gateway_decision_fingerprints: ['fp-a']
  }));
});

test('execution gateway replay reference: rejects duplicate prior decision ids', () => {
  const golden = buildGoldenBundle();
  assert.throws(() => buildExecutionGatewayReplayReference({
    ...golden.replayReference, prior_gateway_decision_ids: ['a', 'a'], prior_gateway_decision_fingerprints: ['fp-a', 'fp-a']
  }));
});

// --- Execution Gateway Package Reference ----------------------------------------------------

test('execution gateway package reference: exact fields, safe flags, package_reference_validated derived', () => {
  const golden = buildGoldenBundle();
  assertValid('package reference', validateExecutionGatewayPackageReference(golden.packageReference));
  assert.deepEqual(Object.keys(golden.packageReference).sort(), [...EXECUTION_GATEWAY_PACKAGE_REFERENCE_FIELDS].sort());
  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_PACKAGE_REFERENCE_SAFE_FLAGS)) {
    assert.equal(golden.packageReference[field], expected, field);
  }
  assert.equal(golden.packageReference.package_reference_validated, true);
});

test('execution gateway package reference: refuses to construct with a non-prepared status (safety by construction)', () => {
  // execution_plan_status/execution_plan_result_status are unconditionally hard-validated against
  // REQUIRED_EXECUTION_PLAN_STATUS -- there is no well-formed way to build a reference where
  // package_reference_validated's underlying structural-completeness check is false due to a
  // status mismatch specifically; the builder throws first.
  const golden = buildGoldenBundle();
  assert.throws(() => buildExecutionGatewayPackageReference({ ...golden.packageReference, execution_plan_status: 'BUDGET_BLOCKED' }));
});

test('execution gateway package reference: validator rejects package_reference_validated=true asserted despite a status mismatch', () => {
  const golden = buildGoldenBundle();
  const tampered = { ...golden.packageReference, execution_plan_status: 'BUDGET_BLOCKED', package_reference_validated: true };
  assertInvalid('tampered package reference', validateExecutionGatewayPackageReference(tampered));
});

// --- Execution Gateway Request -------------------------------------------------------------

test('execution gateway request: exact fields, every nested reference checked against its real validator', () => {
  const golden = buildGoldenBundle();
  assertValid('request', validateExecutionGatewayRequest(golden.gatewayRequest));
  assert.deepEqual(Object.keys(golden.gatewayRequest).sort(), [...EXECUTION_GATEWAY_REQUEST_FIELDS].sort());
});

test('execution gateway request: rejects a structurally invalid nested reference', () => {
  const golden = buildGoldenBundle();
  const validation = validateExecutionGatewayRequest({ ...golden.gatewayRequest, gateway_policy: { not: 'a policy' } });
  assertInvalid('request with broken policy', validation);
  assert.ok(validation.errors.some((e) => e.startsWith('gateway_policy_invalid')));
});

test('execution gateway request: rejects extra/unknown fields', () => {
  const golden = buildGoldenBundle();
  const validation = validateExecutionGatewayRequest({ ...golden.gatewayRequest, unexpected_field: true });
  assertInvalid('request with extra field', validation);
});

// --- Execution Gateway Decision / Result / Audit ---------------------------------------------

test('execution gateway decision: status/decision/next_state always agree with STATUS_OUTCOME_MAP', () => {
  for (const status of GATEWAY_STATUSES) {
    const decision = buildExecutionGatewayDecision({
      gateway_decision_id: 'd-1', gateway_request_id: 'r-1', gateway_package_reference_id: 'p-1',
      execution_plan_id: 'ep-1', execution_plan_result_id: 'epr-1', authorization_decision_id: 'ad-1',
      authorization_provenance_reference_id: 'apr-1', authorization_scope_reference_id: 'asr-1',
      registry_snapshot_reference_id: 'rsr-1', stage_manifest_reference_id: 'smr-1',
      dependency_graph_reference_id: 'dgr-1', binding_ledger_id: 'bl-1', validation_ledger_id: 'vl-1',
      architecture_gate_evidence_reference_id: 'age-1', freshness_reference_id: 'fr-1', replay_reference_id: 'rr-1',
      tenant_id: 't-1', organization_id: 'o-1', project_id: 'proj-1', session_reference_id: 's-1',
      agent_id: 'a-1', actor_id: 'act-1', status,
      gateway_request_fingerprint: 'fp', gateway_package_fingerprint: 'fp', execution_plan_fingerprint: 'fp',
      execution_plan_result_fingerprint: 'fp', authorization_fingerprint: 'fp', authorization_provenance_fingerprint: 'fp',
      authorization_scope_fingerprint: 'fp', registry_snapshot_fingerprint: 'fp', stage_manifest_fingerprint: 'fp',
      dependency_graph_fingerprint: 'fp', binding_ledger_fingerprint: 'fp', validation_ledger_fingerprint: 'fp',
      architecture_gate_evidence_fingerprint: 'fp', freshness_fingerprint: 'fp', replay_fingerprint: 'fp',
      package_digest: 'digest', gateway_registry_version: '1'
    });
    const expected = STATUS_OUTCOME_MAP[status] || { decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' };
    assert.equal(decision.decision, expected.decision, status);
    assert.equal(decision.next_state, expected.next_state, status);
    assert.equal(decision.gateway_accepted_in_simulation, status === 'GATEWAY_ACCEPTED_SIMULATION', status);
    for (const [field, flag] of Object.entries(DECISION_SAFE_FLAGS)) {
      assert.equal(decision[field], flag, `${status}.${field}`);
    }
  }
});

test('execution gateway decision: unknown status falls back to UNKNOWN_STATUS_BLOCKED', () => {
  const decision = buildExecutionGatewayDecision({
    gateway_decision_id: 'd-2', gateway_request_id: 'r-1', gateway_package_reference_id: 'p-1',
    execution_plan_id: 'ep-1', execution_plan_result_id: 'epr-1', authorization_decision_id: 'ad-1',
    authorization_provenance_reference_id: 'apr-1', authorization_scope_reference_id: 'asr-1',
    registry_snapshot_reference_id: 'rsr-1', stage_manifest_reference_id: 'smr-1',
    dependency_graph_reference_id: 'dgr-1', binding_ledger_id: 'bl-1', validation_ledger_id: 'vl-1',
    architecture_gate_evidence_reference_id: 'age-1', freshness_reference_id: 'fr-1', replay_reference_id: 'rr-1',
    tenant_id: 't-1', organization_id: 'o-1', project_id: 'proj-1', session_reference_id: 's-1',
    agent_id: 'a-1', actor_id: 'act-1', status: 'TOTALLY_MADE_UP_STATUS',
    gateway_request_fingerprint: 'fp', gateway_package_fingerprint: 'fp', execution_plan_fingerprint: 'fp',
    execution_plan_result_fingerprint: 'fp', authorization_fingerprint: 'fp', authorization_provenance_fingerprint: 'fp',
    authorization_scope_fingerprint: 'fp', registry_snapshot_fingerprint: 'fp', stage_manifest_fingerprint: 'fp',
    dependency_graph_fingerprint: 'fp', binding_ledger_fingerprint: 'fp', validation_ledger_fingerprint: 'fp',
    architecture_gate_evidence_fingerprint: 'fp', freshness_fingerprint: 'fp', replay_fingerprint: 'fp',
    package_digest: 'digest', gateway_registry_version: '1'
  });
  assert.equal(decision.status, 'UNKNOWN_STATUS_BLOCKED');
  assert.equal(decision.decision, 'BLOCKED');
});

test('execution gateway result: thin envelope always copies status/decision/next_state from a real decision', () => {
  const golden = buildGoldenBundle();
  const outcome = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});
  assertValid('result', validateExecutionGatewayResult(outcome.result));
  assert.equal(outcome.result.status, outcome.decision.status);
  assert.equal(outcome.result.decision, outcome.decision.decision);
  assert.equal(outcome.result.next_state, outcome.decision.next_state);
  for (const [field, expected] of Object.entries(RESULT_SAFE_FLAGS)) {
    assert.equal(outcome.result[field], expected, field);
  }
  // gateway_decision_fingerprint must be a compact digest, not a raw compounded payload of a
  // decision that already embeds a 100KB+ execution_plan_fingerprint as a plain field.
  assert.ok(outcome.result.gateway_decision_fingerprint.length < 200);
});

test('execution gateway audit: never carries payload/content, only ids/fingerprints/counts/bindings', () => {
  const golden = buildGoldenBundle();
  const outcome = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});
  assertValid('audit', validateExecutionGatewayAudit(outcome.audit));
  assert.equal(outcome.audit.simulation, true);
  assert.equal(outcome.audit.production_blocked, true);
  assert.equal(outcome.audit.executed, false);
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.audit), []);
  assert.equal(outcome.audit.gate_counts.passed_gate_count, 1);
  assert.equal(outcome.audit.gate_counts.failed_gate_count, 0);
});

// --- Execution Gateway Boundary: golden path --------------------------------------------------

test('boundary: golden bundle across all three package kinds accepts in simulation', () => {
  for (const baseScenario of ['prepared-no-llm-plan', 'prepared-low-cost-model-plan', 'tool-stage-plan', 'workflow-stage-plan']) {
    const golden = buildGoldenBundle(baseScenario);
    const outcome = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});
    assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION', baseScenario);
    assert.equal(outcome.decision.gateway_accepted_in_simulation, true, baseScenario);
    assert.equal(outcome.decision.execution_authorized, false, baseScenario);
    assert.equal(outcome.decision.executed, false, baseScenario);
  }
});

test('boundary: never authorizes execution regardless of outcome status', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    for (const field of ['runtime_enabled', 'execution_authorized', 'execution_started', 'executed', 'agent_executed', 'tool_called', 'network_used']) {
      assert.equal(scenario.decision[field], false, `${key}.${field}`);
    }
    assert.equal(scenario.decision.simulation, true, key);
    assert.equal(scenario.decision.production_blocked, true, key);
  }
});

// --- Boundary: identity isolation (checkIdentity + the remaining mismatch dimensions) --------

test('checkIdentity: skips fields a reference does not structurally carry', () => {
  assert.equal(checkIdentity({}, { tenantId: 't-1' }, 'label'), null);
  assert.equal(checkIdentity(null, { tenantId: 't-1' }, 'label'), null);
});

test('checkIdentity: flags tenant/organization/project/session/agent/actor mismatches independently', () => {
  const canonical = { tenantId: 't-1', organizationId: 't-1:o-1', projectId: 'p-1', sessionId: 's-1', agentId: 'a-1', actorId: 'act-1' };
  assert.equal(checkIdentity({ tenant_id: 'other' }, canonical, 'x').status, 'TENANT_BLOCKED');
  assert.equal(checkIdentity({ organization_id: 'other' }, canonical, 'x').status, 'ORGANIZATION_BLOCKED');
  assert.equal(checkIdentity({ project_id: 'other' }, canonical, 'x').status, 'PROJECT_BLOCKED');
  assert.equal(checkIdentity({ session_reference_id: 'other' }, canonical, 'x').status, 'SESSION_BLOCKED');
  assert.equal(checkIdentity({ agent_id: 'other' }, canonical, 'x').status, 'AGENT_BLOCKED');
  assert.equal(checkIdentity({ actor_id: 'other' }, canonical, 'x').status, 'ACTOR_BLOCKED');
});

for (const [field, status] of [
  ['organization_id', 'ORGANIZATION_BLOCKED'], ['project_id', 'PROJECT_BLOCKED'],
  ['session_reference_id', 'SESSION_BLOCKED'], ['agent_id', 'AGENT_BLOCKED'], ['actor_id', 'ACTOR_BLOCKED']
]) {
  test(`boundary: ${field} mismatch on the authorization decision blocks as ${status}`, () => {
    const golden = buildGoldenBundle();
    const otherValue = field === 'organization_id' ? 'other-tenant:org-9' : `other-${field}`;
    const rebuilt = buildExecutionAuthorizationDecision({ ...golden.authorizationDecision, [field]: otherValue });
    const request = buildExecutionGatewayRequest({ ...golden.gatewayRequest, authorization_decision_reference: rebuilt });
    const outcome = evaluateExecutionGatewayRequest(request, {});
    assert.equal(outcome.decision.status, status, field);
  });
}

// --- Boundary: remaining long-tail mutations (constructed inline, not persisted to fixture) ---

test('boundary: dependency graph reference mismatch blocks as DEPENDENCY_BLOCKED', () => {
  const golden = buildGoldenBundle();
  const graph = buildExecutionPlanDependencyGraphReference({ ...golden.dependencyGraphReference, execution_plan_id: 'other-execution-plan-id' });
  const request = buildExecutionGatewayRequest({ ...golden.gatewayRequest, dependency_graph_reference: graph });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'DEPENDENCY_BLOCKED');
});

test('boundary: registry snapshot version mismatch blocks as REGISTRY_SNAPSHOT_BLOCKED', () => {
  const golden = buildGoldenBundle();
  const snapshot = buildExecutionRegistrySnapshotReference({
    ...golden.snapshotReference, observed_registry_version: golden.snapshotReference.observed_registry_version + 1, snapshot_validated: false
  });
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest, registry_snapshot_reference: snapshot,
    gateway_package_reference: { ...golden.packageReference, registry_snapshot_fingerprint: snapshot.snapshot_fingerprint }
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'REGISTRY_SNAPSHOT_BLOCKED');
});

test('boundary: scope not validated blocks as AUTHORIZATION_SCOPE_BLOCKED', () => {
  const golden = buildGoldenBundle();
  const scope = buildAuthorizationScopeReference({ ...golden.scopeReference, scope_validated: false });
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest, authorization_scope_reference: scope,
    gateway_package_reference: { ...golden.packageReference, authorization_scope_fingerprint: scope.scope_fingerprint }
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'AUTHORIZATION_SCOPE_BLOCKED');
});

test('boundary: stage manifest orchestration_plan_id mismatch blocks as STAGE_MANIFEST_BLOCKED', () => {
  const golden = buildGoldenBundle();
  const manifest = buildOrchestratorStageManifestReference({ ...golden.stageManifestReference, orchestration_plan_id: 'other-orchestration-plan-id' });
  const request = buildExecutionGatewayRequest({ ...golden.gatewayRequest, stage_manifest_reference: manifest });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'STAGE_MANIFEST_BLOCKED');
});

test('boundary: architecture evidence incomplete (workflow run not completed) blocks', () => {
  const golden = buildGoldenBundle();
  const incomplete = rebuildEvidence(golden, {
    workflow_run_reference: { ...golden.evidenceReference.workflow_run_reference, workflow_run_status: 'IN_PROGRESS' }
  });
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest, architecture_gate_evidence_reference: incomplete,
    gateway_package_reference: { ...golden.packageReference, architecture_gate_evidence_fingerprint: incomplete.evidence_fingerprint }
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'ARCHITECTURE_GATE_EVIDENCE_BLOCKED');
});

test('boundary: architecture evidence commit mismatch (CONFLICTED) blocks', () => {
  const golden = buildGoldenBundle();
  const conflicted = rebuildEvidence(golden, {
    workflow_run_reference: { ...golden.evidenceReference.workflow_run_reference, head_commit_sha: 'c'.repeat(40) }
  });
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest, architecture_gate_evidence_reference: conflicted,
    gateway_package_reference: { ...golden.packageReference, architecture_gate_evidence_fingerprint: conflicted.evidence_fingerprint }
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'ARCHITECTURE_GATE_EVIDENCE_BLOCKED');
});

for (const field of ['authorization_expired_logically', 'registry_snapshot_expired_logically', 'architecture_evidence_expired_logically']) {
  test(`boundary: freshness ${field}=true blocks as FRESHNESS_BLOCKED`, () => {
    const golden = buildGoldenBundle();
    const fresh = buildExecutionGatewayFreshnessReference({ ...golden.freshnessReference, [field]: true });
    const request = buildExecutionGatewayRequest({ ...golden.gatewayRequest, freshness_reference: fresh });
    const outcome = evaluateExecutionGatewayRequest(request, {});
    assert.equal(outcome.decision.status, 'FRESHNESS_BLOCKED', field);
  });
}

test('boundary: package sub-fingerprint mismatch (registry snapshot) blocks as PACKAGE_FINGERPRINT_BLOCKED', () => {
  const golden = buildGoldenBundle();
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest, gateway_package_reference: { ...golden.packageReference, registry_snapshot_fingerprint: 'tampered-snapshot-fp' }
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'PACKAGE_FINGERPRINT_BLOCKED');
});

test('boundary: architecture evidence digest mismatch blocks as PACKAGE_DIGEST_BLOCKED', () => {
  const golden = buildGoldenBundle();
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest, gateway_package_reference: { ...golden.packageReference, package_digest: 'sha256:' + '2'.repeat(64) }
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'PACKAGE_DIGEST_BLOCKED');
});

test('boundary: computeGatewayPackageDigest recomputation is order-independent and byte-exact', () => {
  const golden = buildGoldenBundle();
  const parts = {
    plan: golden.plan, result: golden.result, authorizationDecision: golden.authorizationDecision,
    provenanceReference: golden.provenanceReference, scopeReference: golden.scopeReference,
    snapshotReference: golden.snapshotReference, stageManifestReference: golden.stageManifestReference,
    dependencyGraphReference: golden.dependencyGraphReference, bindingLedger: golden.bindingLedger,
    validationLedger: golden.validationLedger, evidenceReference: golden.evidenceReference
  };
  const digest1 = computeGatewayPackageDigest(parts);
  const digest2 = computeGatewayPackageDigest({ ...parts });
  assert.equal(digest1, digest2);
  assert.equal(digest1, golden.packageReference.package_digest);
});

// --- Side-channels / adversarial context ------------------------------------------------------

test('boundary: context is never consulted for any decision (side-channel inert)', () => {
  const golden = buildGoldenBundle();
  const withoutContext = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});
  const withHostileContext = evaluateExecutionGatewayRequest(golden.gatewayRequest, {
    execution_authorized: true, runtime_enabled: true, network_used: true, tokens_consumed: 999999,
    bypass_gateway: true, admin: true
  });
  assert.equal(withoutContext.decision.status, withHostileContext.decision.status);
  assert.equal(withHostileContext.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
  assert.equal(withHostileContext.decision.execution_authorized, false);
  assert.equal(withHostileContext.decision.runtime_enabled, false);
});

test('boundary: operational flags smuggled onto nested references cannot be constructed at all', () => {
  const golden = buildGoldenBundle();
  // execution_authorized/runtime_enabled/etc. are forced-false safe flags on the plan's own
  // builder -- there is no well-formed way to hand the boundary a plan with a live operational
  // flag in the first place.
  assert.equal(golden.plan.execution_authorized, false);
  assert.equal(golden.plan.runtime_enabled, false);
  assert.equal(golden.result.execution_authorized, false);
});

test('boundary: expected_gateway_registry_version is structurally validated but not cross-checked (no live registry-version oracle in a stateless boundary)', () => {
  const golden = buildGoldenBundle();
  const request = buildExecutionGatewayRequest({ ...golden.gatewayRequest, expected_gateway_registry_version: 999 });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
  assert.equal(outcome.decision.gateway_registry_version, '999');
});

test('boundary: package field order never changes the accepted outcome (canonical digest is order-independent)', () => {
  const golden = buildGoldenBundle();
  const reordered = {};
  for (const key of Object.keys(golden.gatewayRequest).sort().reverse()) reordered[key] = golden.gatewayRequest[key];
  const outcome = evaluateExecutionGatewayRequest(reordered, {});
  assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
});

// --- Adversarial types / forbidden material -----------------------------------------------

test('boundary: rejects a request with a wrong-typed nested reference outright (VALIDATION_FAILED)', () => {
  const golden = buildGoldenBundle();
  const outcome = evaluateExecutionGatewayRequest({ ...golden.gatewayRequest, gateway_package_reference: 'not-an-object' }, {});
  assert.equal(outcome.decision.status, 'VALIDATION_FAILED');
});

test('boundary: rejects a request missing the top-level object shape', () => {
  const outcome = evaluateExecutionGatewayRequest(null, {});
  assert.equal(outcome.decision.status, 'VALIDATION_FAILED');
});

test('every gateway contract in the fixture is free of forbidden operational material', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.decision), [], `${key} decision`);
  }
});

// --- Registry ---------------------------------------------------------------------------------

test('registry: registers a decision, replays an identical one, blocks a payload mismatch without a version bump', () => {
  const registry = createExecutionGatewayRegistry();
  const golden = buildGoldenBundle();
  const outcome = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});

  const first = registry.registerExecutionGatewayDecision(outcome.decision);
  assert.equal(first.status, 'REGISTERED_SIMULATION');

  const replay = registry.registerExecutionGatewayDecision(outcome.decision);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');

  const mismatched = registry.registerExecutionGatewayDecision({ ...outcome.decision, blockers: ['tampered'] });
  assert.equal(mismatched.status, 'PAYLOAD_MISMATCH');

  const fetched = registry.getExecutionGatewayDecisionById(outcome.decision.gateway_decision_id);
  assert.equal(fetched.gateway_decision_id, outcome.decision.gateway_decision_id);
});

test('registry: blocks tenant reassignment for an existing package reference id', () => {
  const registry = createExecutionGatewayRegistry();
  const golden = buildGoldenBundle();
  registry.registerExecutionGatewayPackageReference(golden.packageReference);
  const reassigned = { ...golden.packageReference, tenant_id: 'a-different-tenant' };
  const result = registry.registerExecutionGatewayPackageReference(reassigned);
  assert.equal(result.status, 'TENANT_BLOCKED');
});

test('registry: every store result is forced into simulation/production_blocked/executed=false', () => {
  const registry = createExecutionGatewayRegistry();
  const golden = buildGoldenBundle();
  const result = registry.registerExecutionGatewayFreshnessReference(golden.freshnessReference);
  assert.equal(result.simulation, true);
  assert.equal(result.production_blocked, true);
  assert.equal(result.executed, false);
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createExecutionGatewayRegistry();
  const result = registry.registerExecutionGatewayReplayReference({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- pr102fix: NO_LLM classification and progressive policy_validated -------------------------
//
// FIX 1: NO_LLM must be defined by the absence of a model reference (no MODEL_REFERENCE_STAGE
// record, no stage record carrying a model_selection_reference_id), never by stage count -- a
// genuinely NO_LLM package still legitimately carries VALIDATION_STAGE/DETERMINISTIC_STAGE/
// AUDIT_STAGE/FINALIZATION_STAGE records.
// FIX 2: policy_validated must only be true once every semantic policy check the package actually
// triggers has passed -- never merely because the policy's own exact-fields shape was valid.

function repackageDigest(golden, overrides = {}) {
  return computeGatewayPackageDigest({
    plan: golden.plan, result: golden.result, authorizationDecision: golden.authorizationDecision,
    provenanceReference: golden.provenanceReference, scopeReference: golden.scopeReference,
    snapshotReference: golden.snapshotReference, stageManifestReference: golden.stageManifestReference,
    dependencyGraphReference: golden.dependencyGraphReference, bindingLedger: golden.bindingLedger,
    validationLedger: golden.validationLedger, evidenceReference: golden.evidenceReference,
    ...overrides
  });
}

function buildRequestWithExtraStages(golden, extraStageOverridesList, policyOverrides = {}) {
  const template = golden.stageManifestReference.stage_records[0];
  const { stage_fingerprint, stage_id, stage_sequence, ...templateRest } = template;
  const baseCount = golden.stageManifestReference.stage_records.length;
  // 'selref-N' rather than any string containing the word "model" -- AGENT_CORE_FORBIDDEN_VALUE_
  // PATTERN treats a bare "model" word as forbidden operational material regardless of field.
  const newRecords = extraStageOverridesList.map((overrides, index) => buildStageRecord({
    ...templateRest, stage_id: `extra-stage-${index}`, stage_sequence: baseCount + index, ...overrides
  }));
  const manifest = buildOrchestratorStageManifestReference({
    ...golden.stageManifestReference, stage_records: [...golden.stageManifestReference.stage_records, ...newRecords]
  });
  const policy = buildExecutionGatewayPolicy({ ...golden.policy, ...policyOverrides });
  const packageDigest = repackageDigest(golden, { stageManifestReference: manifest });
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest,
    stage_manifest_reference: manifest,
    gateway_package_reference: {
      ...golden.packageReference, stage_manifest_fingerprint: manifest.manifest_fingerprint, package_digest: packageDigest
    },
    gateway_policy: policy
  });
  return request;
}

function buildRequestWithDependencyRecord(golden, dependencyRecordOverrides, policyOverrides = {}) {
  const record = buildDependencyRecord({
    dependency_id: 'extra-dependency-1', from_stage_id: 'stage-1', to_stage_id: 'stage-2', required: false,
    ...dependencyRecordOverrides
  });
  const graph = buildExecutionPlanDependencyGraphReference({ ...golden.dependencyGraphReference, dependency_records: [record] });
  const policy = buildExecutionGatewayPolicy({ ...golden.policy, ...policyOverrides });
  const packageDigest = repackageDigest(golden, { dependencyGraphReference: graph });
  return buildExecutionGatewayRequest({
    ...golden.gatewayRequest,
    dependency_graph_reference: graph,
    gateway_package_reference: {
      ...golden.packageReference, dependency_graph_fingerprint: graph.graph_fingerprint, package_digest: packageDigest
    },
    gateway_policy: policy
  });
}

test('pr102fix NO_LLM: a purely deterministic package (no model stage) is classified NO_LLM and accepted by default policy', () => {
  const golden = buildGoldenBundle();
  const outcome = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});
  assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
});

test('pr102fix NO_LLM: a purely deterministic package is blocked when allow_no_llm_package=false', () => {
  const golden = buildGoldenBundle();
  const policy = buildExecutionGatewayPolicy({ ...golden.policy, allow_no_llm_package: false });
  const request = buildExecutionGatewayRequest({ ...golden.gatewayRequest, gateway_policy: policy });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['no_llm_package_not_allowed_by_policy']);
});

test('pr102fix NO_LLM: VALIDATION_STAGE/AUDIT_STAGE/FINALIZATION_STAGE records remain NO_LLM (never classified by stage count)', () => {
  const golden = buildGoldenBundle();
  const request = buildRequestWithExtraStages(golden, [
    { stage_type: 'VALIDATION_STAGE' }, { stage_type: 'AUDIT_STAGE' }, { stage_type: 'FINALIZATION_STAGE' }
  ]);
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
});

test('pr102fix NO_LLM: a tool-only package (no model stage) is classified NO_LLM and requires allow_tool_reference_package', () => {
  const golden = buildGoldenBundle();
  const accepted = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'TOOL_REFERENCE_STAGE' }]), {}
  );
  assert.equal(accepted.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');

  const blockedAsNoLlm = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'TOOL_REFERENCE_STAGE' }], { allow_no_llm_package: false }), {}
  );
  assert.equal(blockedAsNoLlm.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(blockedAsNoLlm.decision.reason_codes, ['no_llm_package_not_allowed_by_policy']);

  const blockedAsTool = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'TOOL_REFERENCE_STAGE' }], { allow_tool_reference_package: false }), {}
  );
  assert.equal(blockedAsTool.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(blockedAsTool.decision.reason_codes, ['tool_reference_package_not_allowed_by_policy']);
});

test('pr102fix NO_LLM: a workflow-only package (no model stage) is classified NO_LLM and requires allow_workflow_reference_package', () => {
  const golden = buildGoldenBundle();
  const accepted = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'WORKFLOW_REFERENCE_STAGE' }]), {}
  );
  assert.equal(accepted.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');

  const blockedAsWorkflow = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'WORKFLOW_REFERENCE_STAGE' }], { allow_workflow_reference_package: false }), {}
  );
  assert.equal(blockedAsWorkflow.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(blockedAsWorkflow.decision.reason_codes, ['workflow_reference_package_not_allowed_by_policy']);
});

test('pr102fix NO_LLM: a MODEL_REFERENCE_STAGE with a real model reference is classified as a model package, not NO_LLM', () => {
  const golden = buildGoldenBundle();
  const accepted = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: 'selref-1' }]), {}
  );
  assert.equal(accepted.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');

  const blockedAsModel = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(
      golden, [{ stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: 'selref-1' }],
      { allow_model_reference_package: false }
    ), {}
  );
  assert.equal(blockedAsModel.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(blockedAsModel.decision.reason_codes, ['model_reference_package_not_allowed_by_policy']);

  // Not also classified NO_LLM -- allow_no_llm_package=false must have zero effect once a real
  // model reference is present.
  const stillAcceptedWithNoLlmDisallowed = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(
      golden, [{ stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: 'selref-1' }],
      { allow_no_llm_package: false }
    ), {}
  );
  assert.equal(stillAcceptedWithNoLlmDisallowed.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
});

test('pr102fix NO_LLM: a MODEL_REFERENCE_STAGE record missing its model reference blocks (fail-closed consistency)', () => {
  const golden = buildGoldenBundle();
  const request = buildRequestWithExtraStages(golden, [{ stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: null }]);
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['model_reference_stage_missing_model_selection_reference']);
});

test('pr102fix NO_LLM: a model reference attached outside a MODEL_REFERENCE_STAGE blocks (fail-closed consistency)', () => {
  const golden = buildGoldenBundle();
  const request = buildRequestWithExtraStages(golden, [{ stage_type: 'DETERMINISTIC_STAGE', model_selection_reference_id: 'selref-1' }]);
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['model_selection_reference_outside_model_reference_stage']);
});

test('pr102fix NO_LLM: context cannot override classification', () => {
  const golden = buildGoldenBundle();
  const request = buildRequestWithExtraStages(golden, [{ stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: 'selref-1' }], { allow_model_reference_package: false });
  const withoutContext = evaluateExecutionGatewayRequest(request, {});
  const withHostileContext = evaluateExecutionGatewayRequest(request, { isNoLlmPackage: true, allow_model_reference_package: true });
  assert.equal(withoutContext.decision.status, 'POLICY_BLOCKED');
  assert.equal(withHostileContext.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(withHostileContext.decision.reason_codes, ['model_reference_package_not_allowed_by_policy']);
});

test('pr102fix NO_LLM: a parallel dependency is blocked when allow_parallel_package=false', () => {
  const golden = buildGoldenBundle();
  const accepted = evaluateExecutionGatewayRequest(
    buildRequestWithDependencyRecord(golden, { dependency_type: 'PARALLEL_REFERENCE' }), {}
  );
  assert.equal(accepted.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');

  const blocked = evaluateExecutionGatewayRequest(
    buildRequestWithDependencyRecord(golden, { dependency_type: 'PARALLEL_REFERENCE' }, { allow_parallel_package: false }), {}
  );
  assert.equal(blocked.decision.status, 'POLICY_BLOCKED');
  assert.deepEqual(blocked.decision.reason_codes, ['parallel_package_not_allowed_by_policy']);
});

test('pr102fix policy_validated: true on an accepted decision', () => {
  const golden = buildGoldenBundle();
  const outcome = evaluateExecutionGatewayRequest(golden.gatewayRequest, {});
  assert.equal(outcome.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
  assert.equal(outcome.decision.policy_validated, true);
});

test('pr102fix policy_validated: false on every POLICY_BLOCKED outcome (NO_LLM, model, tool, workflow, parallel)', () => {
  const golden = buildGoldenBundle();

  const noLlmBlocked = evaluateExecutionGatewayRequest(
    buildExecutionGatewayRequest({ ...golden.gatewayRequest, gateway_policy: buildExecutionGatewayPolicy({ ...golden.policy, allow_no_llm_package: false }) }), {}
  );
  assert.equal(noLlmBlocked.decision.status, 'POLICY_BLOCKED');
  assert.equal(noLlmBlocked.decision.policy_validated, false);

  const modelBlocked = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'MODEL_REFERENCE_STAGE', model_selection_reference_id: 'selref-1' }], { allow_model_reference_package: false }), {}
  );
  assert.equal(modelBlocked.decision.status, 'POLICY_BLOCKED');
  assert.equal(modelBlocked.decision.policy_validated, false);

  const toolBlocked = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'TOOL_REFERENCE_STAGE' }], { allow_tool_reference_package: false }), {}
  );
  assert.equal(toolBlocked.decision.status, 'POLICY_BLOCKED');
  assert.equal(toolBlocked.decision.policy_validated, false);

  const workflowBlocked = evaluateExecutionGatewayRequest(
    buildRequestWithExtraStages(golden, [{ stage_type: 'WORKFLOW_REFERENCE_STAGE' }], { allow_workflow_reference_package: false }), {}
  );
  assert.equal(workflowBlocked.decision.status, 'POLICY_BLOCKED');
  assert.equal(workflowBlocked.decision.policy_validated, false);

  const parallelBlocked = evaluateExecutionGatewayRequest(
    buildRequestWithDependencyRecord(golden, { dependency_type: 'PARALLEL_REFERENCE' }, { allow_parallel_package: false }), {}
  );
  assert.equal(parallelBlocked.decision.status, 'POLICY_BLOCKED');
  assert.equal(parallelBlocked.decision.policy_validated, false);
});

test('pr102fix policy_validated: false when a blocker upstream of the policy checks fires first', () => {
  const golden = buildGoldenBundle();
  const request = buildExecutionGatewayRequest({
    ...golden.gatewayRequest, execution_plan_reference: { ...golden.plan, execution_plan_status: 'BUDGET_BLOCKED', execution_plan_prepared: false }
  });
  const outcome = evaluateExecutionGatewayRequest(request, {});
  assert.equal(outcome.decision.status, 'EXECUTION_PLAN_BLOCKED');
  assert.equal(outcome.decision.policy_validated, false);
});

test('pr102fix policy_validated: false when the request itself is structurally invalid', () => {
  const outcome = evaluateExecutionGatewayRequest({ not: 'a request' }, {});
  assert.equal(outcome.decision.status, 'VALIDATION_FAILED');
  assert.equal(outcome.decision.policy_validated, false);
});

test('pr102fix policy_validated: context cannot override it either way', () => {
  const golden = buildGoldenBundle();
  const blockedRequest = buildExecutionGatewayRequest({ ...golden.gatewayRequest, gateway_policy: buildExecutionGatewayPolicy({ ...golden.policy, allow_no_llm_package: false }) });
  const hostile = evaluateExecutionGatewayRequest(blockedRequest, { policy_validated: true });
  assert.equal(hostile.decision.policy_validated, false);

  const acceptedHostile = evaluateExecutionGatewayRequest(golden.gatewayRequest, { policy_validated: false });
  assert.equal(acceptedHostile.decision.status, 'GATEWAY_ACCEPTED_SIMULATION');
  assert.equal(acceptedHostile.decision.policy_validated, true);
});

test('pr102fix regression: every fixture scenario still reproduces its expected status after the boundary fix', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = fixture.scenarios[key];
    const outcome = evaluateExecutionGatewayRequest(clone(scenario.request), {});
    assert.equal(outcome.decision.status, EXPECTED_STATUS_BY_SCENARIO[key], key);
  }
});
