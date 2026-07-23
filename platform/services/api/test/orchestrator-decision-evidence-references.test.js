'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-orchestrator-decision-evidence-references.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  BUDGET_EVIDENCE_REFERENCE_FIELDS, BUDGET_EVIDENCE_SAFE_FLAGS, BUDGET_EVIDENCE_STATUSES, LIMIT_FLAG_FIELDS,
  buildBudgetEvidenceReference, computeBudgetEvidenceFingerprint, validateBudgetEvidenceReference
} = require('../src/core/orchestrator-budget-evidence-reference');
const {
  DEPENDENCY_EVIDENCE_REFERENCE_FIELDS, DEPENDENCY_EVIDENCE_SAFE_FLAGS, DEPENDENCY_EVIDENCE_STATUSES,
  DETECTION_FLAG_FIELDS, buildDependencyEvidenceReference, computeDependencyEvidenceFingerprint,
  validateDependencyEvidenceReference
} = require('../src/core/orchestrator-dependency-evidence-reference');
const {
  CONFLICT_EVIDENCE_REFERENCE_FIELDS, CONFLICT_EVIDENCE_SAFE_FLAGS, CONFLICT_EVIDENCE_STATUSES,
  DOMAIN_CONFLICT_FLAG_FIELDS, buildConflictEvidenceReference, computeConflictEvidenceFingerprint,
  validateConflictEvidenceReference
} = require('../src/core/orchestrator-conflict-evidence-reference');
const {
  APPROVAL_EVIDENCE_REFERENCE_FIELDS, APPROVAL_EVIDENCE_SAFE_FLAGS, APPROVAL_EVIDENCE_STATUSES,
  buildApprovalEvidenceReference, computeApprovalEvidenceFingerprint, validateApprovalEvidenceReference
} = require('../src/core/orchestrator-approval-evidence-reference');
const {
  BUNDLE_STATUSES, DOMAIN_READY_FIELDS, READINESS_EVIDENCE_BUNDLE_FIELDS, READINESS_EVIDENCE_BUNDLE_SAFE_FLAGS,
  buildReadinessEvidenceBundle, computeReadinessScore, validateReadinessEvidenceBundle
} = require('../src/core/orchestrator-readiness-evidence-bundle');
const { evaluateDecisionEvidence } = require('../src/core/orchestrator-decision-evidence-validator');
const {
  ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_STATUSES, createOrchestratorDecisionEvidenceRegistry
} = require('../src/core/orchestrator-decision-evidence-registry');
const {
  ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_FIELDS, buildOrchestratorDecisionEvidenceAudit,
  validateOrchestratorDecisionEvidenceAudit
} = require('../src/core/orchestrator-decision-evidence-audit');
const { validateOrchestratorDecisionRequest } = require('../src/core/orchestrator-decision-request');
const { evaluateOrchestratorDecisionRequest } = require('../src/core/orchestrator-decision-engine');
const { RESULT_STATUSES } = require('../src/core/orchestrator-decision-result');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioFixture(key) {
  return clone(fixture.scenarios[key]);
}

const EVIDENCE_SCENARIOS = [
  'valid-budget-evidence', 'blocked-budget-evidence', 'valid-dependency-evidence', 'cycle-dependency-evidence',
  'missing-dependency-evidence', 'no-conflict-evidence', 'unresolved-conflict-evidence',
  'no-approval-required-evidence', 'waiting-approval-evidence', 'validated-approval-reference-evidence'
];
const BUNDLE_SCENARIOS = [
  'ready-evidence-bundle', 'missing-evidence-bundle', 'fingerprint-mismatch-bundle', 'version-mismatch-bundle',
  'tenant-mismatch-bundle', 'organization-mismatch-bundle', 'project-mismatch-bundle', 'session-mismatch-bundle',
  'replay-evidence-bundle'
];
const EXPECTED_SCENARIOS = [...EVIDENCE_SCENARIOS, ...BUNDLE_SCENARIOS];

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_ORCHESTRATOR_DECISION_EVIDENCE_REFERENCES.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

// ---------------------------------------------------------------------------
// Budget evidence
// ---------------------------------------------------------------------------

test('budget evidence: exact fields, 6 statuses, and tokens/cost/reservations all within limit is required for VALIDATED_SIMULATION', () => {
  assert.equal(BUDGET_EVIDENCE_REFERENCE_FIELDS.length, 29);
  assert.deepEqual(BUDGET_EVIDENCE_STATUSES, ['VALIDATED_SIMULATION', 'BUDGET_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED']);
  assert.equal(LIMIT_FLAG_FIELDS.length, 3);

  const valid = scenarioFixture('valid-budget-evidence').evidence;
  assert.equal(validateBudgetEvidenceReference(valid).valid, true);
  assert.equal(valid.evidence_status, 'VALIDATED_SIMULATION');
  assert.equal(valid.budget_validated, true);

  const blocked = scenarioFixture('blocked-budget-evidence').evidence;
  assert.equal(validateBudgetEvidenceReference(blocked).valid, true);
  assert.equal(blocked.evidence_status, 'BUDGET_BLOCKED');
  assert.equal(blocked.budget_validated, false);
  assert.equal(blocked.tokens_within_limit, false);
});

test('budget evidence: a caller cannot force VALIDATED_SIMULATION or BUDGET_BLOCKED against what the limit checks actually computed', () => {
  const forcedValidated = buildBudgetEvidenceReference({
    budget_evidence_id: 'be-forced', planning_result_id: 'planning-result-1', plan_id: 'plan-1', agent_id: 'agent-1',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', session_reference_id: 'session-1',
    budget_policy_reference_id: 'budget-policy-1', budget_reference_id: 'budget-reference-1',
    maximum_total_tokens: 10000, estimated_total_tokens: 50000, maximum_total_cost_minor_units: 1000,
    estimated_total_cost_minor_units: 500, reserved_memory_tokens: 1000, reserved_context_tokens: 1000,
    reserved_output_tokens: 1000, evidence_status: 'VALIDATED_SIMULATION', logical_sequence: 1
  });
  assert.equal(forcedValidated.evidence_status, 'BUDGET_BLOCKED', 'the over-budget computation must win over the caller-requested status');

  // A non-derived status may only be overridden when it is consistent with the actual computed
  // budget_validated value -- here the budget is genuinely over limit (budget_validated=false),
  // so overriding the derived BUDGET_BLOCKED to the more specific VERSION_BLOCKED is legitimate.
  const overriddenNonDerived = buildBudgetEvidenceReference({
    budget_evidence_id: 'be-overridden', planning_result_id: 'planning-result-1', plan_id: 'plan-1', agent_id: 'agent-1',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', session_reference_id: 'session-1',
    budget_policy_reference_id: 'budget-policy-1', budget_reference_id: 'budget-reference-1',
    maximum_total_tokens: 10000, estimated_total_tokens: 50000, maximum_total_cost_minor_units: 1000,
    estimated_total_cost_minor_units: 500, reserved_memory_tokens: 1000, reserved_context_tokens: 1000,
    reserved_output_tokens: 1000, evidence_status: 'VERSION_BLOCKED', logical_sequence: 1
  });
  assert.equal(overriddenNonDerived.evidence_status, 'VERSION_BLOCKED', 'a non-derived status is a legitimate caller override when consistent with budget_validated=false');
  assert.equal(overriddenNonDerived.budget_validated, false);
});

test('budget evidence: tampering any field changes the recomputed fingerprint (tamper detection)', () => {
  const evidence = scenarioFixture('valid-budget-evidence').evidence;
  assert.equal(computeBudgetEvidenceFingerprint(evidence), evidence.evidence_fingerprint);
  const tampered = { ...evidence, estimated_total_tokens: 1 };
  assert.notEqual(computeBudgetEvidenceFingerprint(tampered), evidence.evidence_fingerprint);
});

test('budget evidence: safe flags are forced regardless of scenario', () => {
  for (const key of ['valid-budget-evidence', 'blocked-budget-evidence']) {
    const evidence = scenarioFixture(key).evidence;
    for (const [field, expected] of Object.entries(BUDGET_EVIDENCE_SAFE_FLAGS)) {
      assert.equal(evidence[field], expected, `${key}: ${field} must be ${expected}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Dependency evidence
// ---------------------------------------------------------------------------

test('dependency evidence: exact fields, 7 statuses, and cycle/self/missing/duplicate detection all invalidate the graph', () => {
  assert.equal(DEPENDENCY_EVIDENCE_REFERENCE_FIELDS.length, 22);
  assert.deepEqual(DEPENDENCY_EVIDENCE_STATUSES, ['VALIDATED_SIMULATION', 'DEPENDENCY_BLOCKED', 'CYCLE_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED']);
  assert.equal(DETECTION_FLAG_FIELDS.length, 4);

  const valid = scenarioFixture('valid-dependency-evidence').evidence;
  assert.equal(validateDependencyEvidenceReference(valid).valid, true);
  assert.equal(valid.evidence_status, 'VALIDATED_SIMULATION');
  assert.equal(valid.dependency_graph_valid, true);

  const cyclic = scenarioFixture('cycle-dependency-evidence').evidence;
  assert.equal(validateDependencyEvidenceReference(cyclic).valid, true);
  assert.equal(cyclic.evidence_status, 'CYCLE_BLOCKED');
  assert.equal(cyclic.cycle_detected, true);
  assert.equal(cyclic.dependency_graph_valid, false);

  const missing = scenarioFixture('missing-dependency-evidence').evidence;
  assert.equal(validateDependencyEvidenceReference(missing).valid, true);
  assert.equal(missing.evidence_status, 'DEPENDENCY_BLOCKED');
  assert.equal(missing.missing_dependency_detected, true);
  assert.equal(missing.cycle_detected, false, 'a missing-reference defect is distinct from a cycle');
});

test('dependency evidence: dependency_validation_executed is always true and dependency_applied is always false, even when blocked', () => {
  for (const key of ['valid-dependency-evidence', 'cycle-dependency-evidence', 'missing-dependency-evidence']) {
    const evidence = scenarioFixture(key).evidence;
    for (const [field, expected] of Object.entries(DEPENDENCY_EVIDENCE_SAFE_FLAGS)) {
      assert.equal(evidence[field], expected, `${key}: ${field} must be ${expected}`);
    }
  }
});

test('dependency evidence: a caller cannot force VALIDATED_SIMULATION over a detected cycle', () => {
  const forced = buildDependencyEvidenceReference({
    dependency_evidence_id: 'de-forced', planning_result_id: 'planning-result-1', plan_id: 'plan-1',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', stage_ids: ['stage-a', 'stage-b'], dependency_ids: [],
    dependencyRecords: [{ from_stage_id: 'stage-a', to_stage_id: 'stage-b' }, { from_stage_id: 'stage-b', to_stage_id: 'stage-a' }],
    evidence_status: 'VALIDATED_SIMULATION', logical_sequence: 1
  });
  assert.equal(forced.evidence_status, 'CYCLE_BLOCKED', 'a detected cycle must win over the caller-requested status');
});

test('dependency evidence: tampering the fingerprint is detectable via recomputation', () => {
  const evidence = scenarioFixture('valid-dependency-evidence').evidence;
  assert.equal(computeDependencyEvidenceFingerprint(evidence), evidence.evidence_fingerprint);
  assert.notEqual(computeDependencyEvidenceFingerprint({ ...evidence, dependency_ids: [] }), evidence.evidence_fingerprint);
});

// ---------------------------------------------------------------------------
// Conflict evidence
// ---------------------------------------------------------------------------

test('conflict evidence: exact fields, 5 statuses, and any of the 12 domain conflict flags blocks resolution', () => {
  assert.equal(CONFLICT_EVIDENCE_REFERENCE_FIELDS.length, 29);
  assert.deepEqual(CONFLICT_EVIDENCE_STATUSES, ['NO_CONFLICT_SIMULATION', 'CONFLICT_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED']);
  assert.equal(DOMAIN_CONFLICT_FLAG_FIELDS.length, 12);

  const clean = scenarioFixture('no-conflict-evidence').evidence;
  assert.equal(validateConflictEvidenceReference(clean).valid, true);
  assert.equal(clean.evidence_status, 'NO_CONFLICT_SIMULATION');
  assert.equal(clean.conflicts_resolved, true);

  const unresolved = scenarioFixture('unresolved-conflict-evidence').evidence;
  assert.equal(validateConflictEvidenceReference(unresolved).valid, true);
  assert.equal(unresolved.evidence_status, 'CONFLICT_BLOCKED');
  assert.equal(unresolved.conflicts_resolved, false);
  assert.equal(unresolved.memory_conflict_detected, true);
});

test('conflict evidence: every one of the 12 domain conflict flags independently blocks resolution', () => {
  for (const field of DOMAIN_CONFLICT_FLAG_FIELDS) {
    const evidence = buildConflictEvidenceReference({
      conflict_evidence_id: `ce-${field}`, planning_result_id: 'planning-result-1', plan_id: 'plan-1',
      tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', logical_sequence: 1, [field]: true
    });
    assert.equal(evidence.evidence_status, 'CONFLICT_BLOCKED', `${field} must block conflict resolution`);
    assert.equal(evidence.unresolved_conflict_detected, true);
  }
});

test('conflict evidence: tampering the fingerprint is detectable via recomputation', () => {
  const evidence = scenarioFixture('no-conflict-evidence').evidence;
  assert.equal(computeConflictEvidenceFingerprint(evidence), evidence.evidence_fingerprint);
  assert.notEqual(computeConflictEvidenceFingerprint({ ...evidence, memory_conflict_detected: true }), evidence.evidence_fingerprint);
});

// ---------------------------------------------------------------------------
// Approval evidence
// ---------------------------------------------------------------------------

test('approval evidence: exact fields, 8 statuses, and the three-branch build logic (not required / blocked type / insufficient references / granted)', () => {
  assert.equal(APPROVAL_EVIDENCE_REFERENCE_FIELDS.length, 23);
  assert.deepEqual(APPROVAL_EVIDENCE_STATUSES, ['NO_APPROVAL_REQUIRED_SIMULATION', 'WAITING_APPROVAL_SIMULATION', 'APPROVAL_REFERENCE_VALIDATED_SIMULATION', 'APPROVAL_BLOCKED', 'VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'CONFLICT_BLOCKED']);

  const notRequired = scenarioFixture('no-approval-required-evidence').evidence;
  assert.equal(validateApprovalEvidenceReference(notRequired).valid, true);
  assert.equal(notRequired.evidence_status, 'NO_APPROVAL_REQUIRED_SIMULATION');

  const waiting = scenarioFixture('waiting-approval-evidence').evidence;
  assert.equal(validateApprovalEvidenceReference(waiting).valid, true);
  assert.equal(waiting.evidence_status, 'WAITING_APPROVAL_SIMULATION');
  assert.equal(waiting.approval_granted, false);

  const validated = scenarioFixture('validated-approval-reference-evidence').evidence;
  assert.equal(validateApprovalEvidenceReference(validated).valid, true);
  assert.equal(validated.evidence_status, 'APPROVAL_REFERENCE_VALIDATED_SIMULATION');
  assert.equal(validated.approval_granted, true);
  assert.equal(validated.approval_applied, false, 'evidence never applies/executes an approval, it only records references');
});

test('approval evidence: an approval required with approval_type=NONE is APPROVAL_BLOCKED, never silently waiting', () => {
  const blocked = buildApprovalEvidenceReference({
    approval_evidence_id: 'ae-none-type', planning_result_id: 'planning-result-1', plan_id: 'plan-1',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', session_reference_id: 'session-1',
    approval_required: true, logical_sequence: 1
  });
  assert.equal(blocked.evidence_status, 'APPROVAL_BLOCKED');
});

test('approval evidence: approval_applied is always false and tampering the fingerprint is detectable', () => {
  for (const key of ['no-approval-required-evidence', 'waiting-approval-evidence', 'validated-approval-reference-evidence']) {
    const evidence = scenarioFixture(key).evidence;
    for (const [field, expected] of Object.entries(APPROVAL_EVIDENCE_SAFE_FLAGS)) {
      assert.equal(evidence[field], expected, `${key}: ${field} must be ${expected}`);
    }
  }
  const evidence = scenarioFixture('validated-approval-reference-evidence').evidence;
  assert.equal(computeApprovalEvidenceFingerprint(evidence), evidence.evidence_fingerprint);
  assert.notEqual(computeApprovalEvidenceFingerprint({ ...evidence, approval_reference_ids: [] }), evidence.evidence_fingerprint);
});

// ---------------------------------------------------------------------------
// Readiness evidence bundle / evaluateDecisionEvidence
// ---------------------------------------------------------------------------

test('readiness evidence bundle: exact fields, 10 statuses, and 13 domain-ready fields (4 evidence-derived + 9 caller-supplied)', () => {
  assert.equal(READINESS_EVIDENCE_BUNDLE_FIELDS.length, 51);
  assert.deepEqual(BUNDLE_STATUSES, [
    'READY_EVIDENCE_SIMULATION', 'WAITING_APPROVAL_EVIDENCE', 'BUDGET_EVIDENCE_BLOCKED', 'DEPENDENCY_EVIDENCE_BLOCKED',
    'CONFLICT_EVIDENCE_BLOCKED', 'MISSING_EVIDENCE_BLOCKED', 'BINDING_BLOCKED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED',
    'VALIDATION_FAILED'
  ]);
  assert.equal(DOMAIN_READY_FIELDS.length, 13);
});

BUNDLE_SCENARIOS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded bundle_status`, () => {
    const scenario = scenarioFixture(key);
    assert.equal(validateReadinessEvidenceBundle(scenario.bundle).valid, true);
    assert.equal(validateOrchestratorDecisionEvidenceAudit(scenario.audit).valid, true);
  });
});

test('ready-evidence-bundle: all 4 evidence-derived domain-ready flags and all 9 caller-supplied flags are true, and overall_ready_in_simulation is true', () => {
  const bundle = scenarioFixture('ready-evidence-bundle').bundle;
  for (const field of DOMAIN_READY_FIELDS) assert.equal(bundle[field], true, `${field} must be true`);
  assert.equal(bundle.overall_ready_in_simulation, true);
  assert.equal(bundle.readiness_score, 100);
});

test('missing-evidence-bundle: a genuinely absent evidence reference is represented as null, not a validation error', () => {
  const bundle = scenarioFixture('missing-evidence-bundle').bundle;
  assert.equal(bundle.approval_evidence_reference, null);
  assert.equal(bundle.all_required_evidence_present, false);
  assert.equal(bundle.bundle_status, 'MISSING_EVIDENCE_BLOCKED');
  assert.equal(bundle.overall_ready_in_simulation, false);
});

test('fingerprint-mismatch-bundle: a tampered evidence fingerprint blocks the bundle even though the evidence itself validates structurally', () => {
  const bundle = scenarioFixture('fingerprint-mismatch-bundle').bundle;
  assert.equal(bundle.bundle_status, 'FINGERPRINT_BLOCKED');
  assert.equal(bundle.fingerprints_consistent, false);
});

test('version-mismatch-bundle, tenant/organization/project/session-mismatch-bundle: each binding failure blocks independently', () => {
  assert.equal(scenarioFixture('version-mismatch-bundle').bundle.bundle_status, 'VERSION_BLOCKED');
  assert.equal(scenarioFixture('tenant-mismatch-bundle').bundle.bundle_status, 'BINDING_BLOCKED');
  assert.equal(scenarioFixture('organization-mismatch-bundle').bundle.bundle_status, 'BINDING_BLOCKED');
  assert.equal(scenarioFixture('project-mismatch-bundle').bundle.bundle_status, 'BINDING_BLOCKED');
  assert.equal(scenarioFixture('session-mismatch-bundle').bundle.bundle_status, 'BINDING_BLOCKED');
});

test('evaluateDecisionEvidence never authorizes or starts execution regardless of scenario', () => {
  for (const key of BUNDLE_SCENARIOS) {
    const bundle = scenarioFixture(key).bundle;
    for (const [field, expected] of Object.entries(READINESS_EVIDENCE_BUNDLE_SAFE_FLAGS)) {
      assert.equal(bundle[field], expected, `${key}: ${field} must be ${expected}`);
    }
  }
});

test('a blocking_count > 0 always forces overall_ready_in_simulation=false regardless of a perfect-looking readiness_score', () => {
  const bundle = buildReadinessEvidenceBundle({
    readiness_bundle_id: 'rb-blocking', decision_request_id: 'decreq-1', planning_result_id: 'planning-result-1',
    plan_id: 'plan-1', agent_id: 'agent-1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1',
    project_id: 'proj-1', session_reference_id: 'session-1', budget_evidence_reference: null,
    dependency_evidence_reference: null, conflict_evidence_reference: null, approval_evidence_reference: null,
    policy_decision_fingerprint: 'fp-policy', memory_selection_decision_fingerprint: 'fp-memory',
    context_assembly_result_fingerprint: 'fp-context', model_selection_decision_fingerprint: 'fp-selection',
    workflow_decision_fingerprint: 'fp-workflow', bindings_consistent: true, versions_consistent: true,
    fingerprints_consistent: true, bundle_status: 'VALIDATION_FAILED', blocking_count: 1, logical_sequence: 1
  });
  assert.equal(bundle.overall_ready_in_simulation, false);
});

test('computeReadinessScore is floatless, deterministic, and never random', () => {
  const allReady = {};
  for (const field of DOMAIN_READY_FIELDS) allReady[field] = true;
  const allConsistent = { all_required_evidence_present: true, bindings_consistent: true, versions_consistent: true, fingerprints_consistent: true };
  const scoreA = computeReadinessScore(allReady, allConsistent, 0);
  const scoreB = computeReadinessScore(allReady, allConsistent, 0);
  assert.equal(scoreA, 100);
  assert.equal(scoreA, scoreB);
  assert.equal(Number.isInteger(scoreA), true);
  const oneNotReady = { ...allReady, budget_ready: false };
  assert.ok(computeReadinessScore(oneNotReady, allConsistent, 0) < scoreA);
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry validates by construction and protects against replay for every evidence store and the readiness bundle store', () => {
  assert.deepEqual(ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_STATUSES, [
    'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
    'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
  ]);
  const registry = createOrchestratorDecisionEvidenceRegistry();
  const budgetEvidence = scenarioFixture('valid-budget-evidence').evidence;
  const first = registry.registerBudgetEvidence(budgetEvidence, { expected_version: 0 });
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(first.simulation, true);
  assert.equal(first.production_blocked, true);
  assert.equal(first.executed, false);
  assert.equal(registry.registerBudgetEvidence(budgetEvidence).status, 'REPLAY_ACCEPTED');

  const tamperedPayload = { ...budgetEvidence, budget_reference_id: 'budget-reference-different' };
  assert.equal(registry.registerBudgetEvidence(tamperedPayload).status, 'PAYLOAD_MISMATCH');

  const stored = registry.getBudgetEvidenceById(budgetEvidence.budget_evidence_id);
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => { stored.budget_validated = false; }, TypeError);
  assert.equal(registry.getBudgetEvidenceById('unknown-id'), null);

  const invalid = registry.registerDependencyEvidence({ bogus: true });
  assert.equal(invalid.status, 'VALIDATION_FAILED');
});

test('registry blocks tenant and organization rebinding for the readiness bundle store without mutating the stored record', () => {
  const registry = createOrchestratorDecisionEvidenceRegistry();
  const bundle = scenarioFixture('replay-evidence-bundle').bundle;
  assert.equal(registry.registerReadinessBundle(bundle, { expected_version: 0 }).status, 'REGISTERED_SIMULATION');
  const orgChanged = { ...bundle, organization_id: `${bundle.tenant_id}:org-different` };
  assert.equal(registry.registerReadinessBundle(orgChanged).status, 'ORGANIZATION_BLOCKED');
  const tenantChanged = { ...bundle, tenant_id: 'tenant-different', organization_id: 'tenant-different:org-1' };
  assert.equal(registry.registerReadinessBundle(tenantChanged).status, 'TENANT_BLOCKED');
  assert.equal(registry.getReadinessBundleById(bundle.readiness_bundle_id).organization_id, bundle.organization_id);
});

test('registry lists evidence safely by tenant and returns defensive clones', () => {
  const registry = createOrchestratorDecisionEvidenceRegistry();
  const conflictEvidence = scenarioFixture('no-conflict-evidence').evidence;
  registry.registerConflictEvidence(conflictEvidence, { expected_version: 0 });
  const listed = registry.listConflictEvidenceByTenant(conflictEvidence.tenant_id);
  assert.equal(listed.length, 1);
  assert.equal(registry.listConflictEvidenceByTenant('tenant-unused').length, 0);
  assert.equal(Object.isFrozen(listed[0]), true);
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test('audit is immutable, records only fingerprints/bindings/statuses/counts/reason codes, and never marks anything executed', () => {
  assert.equal(ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_FIELDS.length, 23);
  const fixtureAudit = scenarioFixture('ready-evidence-bundle').audit;
  assert.equal(validateOrchestratorDecisionEvidenceAudit(fixtureAudit).valid, true);
  assert.equal(fixtureAudit.simulation, true);
  assert.equal(fixtureAudit.production_blocked, true);
  assert.equal(fixtureAudit.executed, false);

  // Freeze/immutability can only be asserted on a freshly built object: the fixture value above
  // has round-tripped through JSON (see scenarioFixture/clone), which never preserves Object.freeze.
  const freshBundle = evaluateDecisionEvidence({
    readinessBundleId: 'rb-audit-fresh', decisionRequestId: 'decreq-audit-fresh', planningResultId: 'planning-result-1',
    planId: 'plan-1', agentId: 'agent-1', tenantId: 'tenant-a', organizationId: 'tenant-a:org-1', projectId: 'proj-1',
    sessionReferenceId: 'session-1', budgetEvidence: scenarioFixture('valid-budget-evidence').evidence,
    dependencyEvidence: scenarioFixture('valid-dependency-evidence').evidence,
    conflictEvidence: scenarioFixture('no-conflict-evidence').evidence,
    approvalEvidence: scenarioFixture('no-approval-required-evidence').evidence,
    policyDecisionFingerprint: 'fp-policy-decision', memorySelectionDecisionFingerprint: 'fp-memory-decision',
    contextAssemblyResultFingerprint: 'fp-context-decision', modelSelectionDecisionFingerprint: 'fp-selection-decision',
    workflowDecisionFingerprint: 'fp-workflow-decision', toolDecisionFingerprints: [], policyReady: true,
    memoryReady: true, preferencesReady: true, projectStateReady: true, continuityReady: true, contextReady: true,
    modelReady: true, toolsReady: true, workflowReady: true, logicalSequence: 1
  }).bundle;
  const freshAudit = buildOrchestratorDecisionEvidenceAudit({ bundle: freshBundle, reasonCodes: ['fresh_audit_check'] });
  assert.equal(Object.isFrozen(freshAudit), true);
  assert.throws(() => { freshAudit.reason_codes.push('x'); }, TypeError);

  const missingAudit = scenarioFixture('missing-evidence-bundle').audit;
  assert.equal(missingAudit.bundle_status, 'MISSING_EVIDENCE_BLOCKED');
  assert.equal(missingAudit.evidence_statuses.approval_evidence_status, 'evidence_not_available');
});

test('buildOrchestratorDecisionEvidenceAudit degrades gracefully when given no bundle at all', () => {
  const audit = buildOrchestratorDecisionEvidenceAudit({});
  assert.equal(validateOrchestratorDecisionEvidenceAudit(audit).valid, true);
  assert.equal(audit.bundle_status, 'VALIDATION_FAILED');
  assert.equal(audit.decision_request_id, 'decision_request_not_available');
});

// ---------------------------------------------------------------------------
// Integration with PR #95's Decision Engine (loose flags never override evidence)
// ---------------------------------------------------------------------------

test('a decision request missing any of the 5 mandatory evidence fields is rejected by validateOrchestratorDecisionRequest', () => {
  for (const field of [
    'budget_evidence_reference', 'dependency_evidence_reference', 'conflict_evidence_reference',
    'approval_evidence_reference', 'readiness_evidence_bundle_reference'
  ]) {
    const request = {
      decision_request_id: 'decreq-missing-evidence-field-check', decision_request_version: 1,
      correlation_id: 'corr-1', causation_id: 'cause-1', trace_id: 'trace-1', logical_sequence: 0,
      expected_registry_version: 'v1', validator_version: 'orchestrator_decision_request_validator_v1'
    };
    request[field] = undefined;
    const validation = validateOrchestratorDecisionRequest(request);
    assert.equal(validation.valid, false, `a request missing ${field} must be rejected`);
  }
});

test('MISSING_EVIDENCE_BLOCKED is a real DecisionResult status inserted into the precedence table (PR #96 extends PR #95 without renumbering existing statuses)', () => {
  assert.equal(RESULT_STATUSES.length, 29);
  assert.ok(RESULT_STATUSES.includes('MISSING_EVIDENCE_BLOCKED'));
});

// ---------------------------------------------------------------------------
// Operational material / hostile input hardening
// ---------------------------------------------------------------------------

[
  ['api key', { api_key: 'x' }, 'forbidden_key'],
  ['secret value', { secret_value: 'x' }, 'forbidden_key'],
  ['endpoint key', { endpoint_reference: 'x' }, 'forbidden_key'],
  ['url value', { note: 'https://blocked.invalid' }, 'operational_url_value'],
  ['prompt word', { note: 'do not store the system_prompt text' }, 'forbidden_word_value'],
  ['execute word', { note: 'do not execute this reference' }, 'forbidden_word_value'],
  ['function value', { note: () => null }, 'forbidden_function']
].forEach(([name, value, reasonPrefix]) => {
  test(`operational material detector blocks ${name} in evidence reference contract payloads`, () => {
    const found = findAgentCoreOperationalMaterial(value);
    assert.ok(found.some((entry) => entry.startsWith(reasonPrefix)), found.join(','));
  });
});

test('operational material detector avoids false positives on legitimate evidence reference field names', () => {
  for (const key of EXPECTED_SCENARIOS) {
    const scenario = scenarioFixture(key);
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario), [], `scenario ${key} must be free of operational material`);
  }
});

// ---------------------------------------------------------------------------
// Regression
// ---------------------------------------------------------------------------

test('regression evidence reference modules do not use network, filesystem, eval, dynamic import, or timers', () => {
  const files = [
    'services/api/src/core/orchestrator-budget-evidence-reference.js',
    'services/api/src/core/orchestrator-dependency-evidence-reference.js',
    'services/api/src/core/orchestrator-conflict-evidence-reference.js',
    'services/api/src/core/orchestrator-approval-evidence-reference.js',
    'services/api/src/core/orchestrator-readiness-evidence-bundle.js',
    'services/api/src/core/orchestrator-decision-evidence-validator.js',
    'services/api/src/core/orchestrator-decision-evidence-registry.js',
    'services/api/src/core/orchestrator-decision-evidence-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('Date.now()'), false);
    assert.equal(/\bnew Date\(\)/.test(source), false);
    assert.equal(/setTimeout|setInterval|setImmediate/.test(source), false);
    assert.equal(/\beval\(/.test(source), false);
    assert.equal(/\bnew Function\(/.test(source), false);
    assert.equal(/\bimport\(/.test(source), false);
    assert.equal(/openai|anthropic|@anthropic-ai|ollama|openrouter|groq|together\.ai|huggingface/i.test(source), false);
    assert.equal(/qdrant|pinecone|weaviate|chroma|milvus/i.test(source), false);
    assert.equal(/postgres|supabase|redis/i.test(source), false);
  }
});

test('regression evidence reference modules are not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, 'services', 'api', file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('orchestrator-decision-evidence'), false);
    assert.equal(source.includes('orchestrator-budget-evidence-reference'), false);
  }
});

test('regression PRs 79 through 95 remain untouched by this PR', () => {
  const files = [
    'services/api/src/core/agent-core-contract.js', 'services/api/src/core/agent-registry.js',
    'services/api/src/core/agent-session-reference.js', 'services/api/src/core/agent-memory-contract.js',
    'services/api/src/core/model-provider-contract.js', 'services/api/src/core/model-selection-engine.js',
    'services/api/src/core/context-assembly-engine.js', 'services/api/src/core/tool-decision.js',
    'services/api/src/core/workflow-decision.js', 'services/api/src/core/orchestrator-request.js',
    'services/api/src/core/orchestrator-decision.js', 'services/api/src/core/memory-selection-engine.js',
    'services/api/src/core/memory-selection-decision.js', 'services/api/src/core/orchestrator-planner.js',
    'services/api/src/core/orchestrator-planning-request.js', 'services/api/src/core/orchestrator-planning-result.js',
    'services/api/src/core/orchestrator-planning-registry.js', 'services/api/src/core/orchestrator-plan-stage.js',
    'services/api/src/core/orchestrator-plan-dependency.js', 'services/api/src/core/orchestrator-plan-approval.js',
    'services/api/src/core/orchestrator-plan-reference.js', 'services/api/src/core/orchestrator-decision-policy.js',
    'services/api/src/core/orchestrator-blocker.js', 'services/api/src/core/orchestrator-readiness.js',
    'services/api/src/core/orchestrator-decision-registry.js', 'services/api/src/core/orchestrator-decision-audit.js'
  ].map((file) => path.join(repoRoot, file));
  const evidenceModules = [
    'orchestrator-decision-evidence-validator', 'orchestrator-decision-evidence-registry',
    'orchestrator-decision-evidence-audit', 'orchestrator-readiness-evidence-bundle',
    'orchestrator-budget-evidence-reference', 'orchestrator-dependency-evidence-reference',
    'orchestrator-conflict-evidence-reference', 'orchestrator-approval-evidence-reference'
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(file), true);
    const source = fs.readFileSync(file, 'utf8');
    for (const moduleName of evidenceModules) {
      assert.equal(source.includes(moduleName), false, `${file} must not reference ${moduleName}`);
    }
  }
});

test('regression full suite invariant: evaluateDecisionEvidence and every evidence build function never authorize or start execution, across every named scenario', () => {
  for (const key of BUNDLE_SCENARIOS) {
    const bundle = scenarioFixture(key).bundle;
    assert.equal(bundle.execution_authorized, false);
    assert.equal(bundle.execution_started, false);
  }
  for (const key of EVIDENCE_SCENARIOS) {
    const evidence = scenarioFixture(key).evidence;
    assert.equal(evidence.simulation, true);
    assert.equal(evidence.production_blocked, true);
  }
});

test('regression: the Decision Engine now rejects a request whose budget evidence is missing, proving evidence is mandatory end to end', () => {
  const request = {
    decision_request_id: 'decreq-e2e-missing-evidence', decision_request_version: 1, correlation_id: 'corr-1',
    causation_id: 'cause-1', trace_id: 'trace-1', logical_sequence: 0, expected_registry_version: 'v1',
    validator_version: 'orchestrator_decision_request_validator_v1'
  };
  const outcome = evaluateOrchestratorDecisionRequest(request);
  assert.equal(outcome.result.status, 'VALIDATION_FAILED');
  assert.equal(outcome.result.execution_authorized, false);
});
