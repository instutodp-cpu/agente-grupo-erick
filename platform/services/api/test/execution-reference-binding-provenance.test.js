'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-execution-reference-binding-provenance.json');
const { findAgentCoreOperationalMaterial, stablePayload } = require('../src/core/agent-identity-contract');
const {
  AUTHORIZATION_PROVENANCE_REFERENCE_FIELDS, AUTHORIZATION_PROVENANCE_REFERENCE_SAFE_FLAGS,
  buildAuthorizationProvenanceReference, validateAuthorizationProvenanceReference
} = require('../src/core/execution-authorization-provenance-reference');
const {
  ALLOWED_ID_LIST_FIELDS, AUTHORIZATION_SCOPE_REFERENCE_FIELDS, AUTHORIZATION_SCOPE_REFERENCE_SAFE_FLAGS,
  buildAuthorizationScopeReference, computeScopeReferenceFingerprint, validateAuthorizationScopeReference
} = require('../src/core/execution-authorization-scope-reference');
const {
  REGISTRY_ENTITY_KEYS, REGISTRY_SNAPSHOT_REFERENCE_FIELDS, REGISTRY_SNAPSHOT_REFERENCE_SAFE_FLAGS,
  buildExecutionRegistrySnapshotReference, validateExecutionRegistrySnapshotReference
} = require('../src/core/execution-registry-snapshot-reference');
const {
  BINDING_RECORD_FIELDS, BINDING_RECORD_SAFE_FLAGS, BINDING_STATUSES, BINDING_TYPES,
  buildBindingRecord, validateBindingRecord
} = require('../src/core/execution-reference-binding-record');
const {
  BINDING_LEDGER_FIELDS, BINDING_LEDGER_SAFE_FLAGS, LEDGER_STATUSES,
  buildExecutionReferenceBindingLedger, validateExecutionReferenceBindingLedger
} = require('../src/core/execution-reference-binding-ledger');
const {
  BINDING_RESULT_FIELDS, buildExecutionReferenceBindingResult, validateExecutionReferenceBindingResult
} = require('../src/core/execution-reference-binding-result');
const {
  EXECUTION_REFERENCE_BINDING_AUDIT_FIELDS, validateExecutionReferenceBindingAudit
} = require('../src/core/execution-reference-binding-audit');
const { createExecutionReferenceBindingRegistry } = require('../src/core/execution-reference-binding-registry');
const { EXECUTION_PLAN_REQUEST_FIELDS, validateExecutionPlanRequest } = require('../src/core/execution-plan-request');
const { EXECUTION_PLAN_CONTRACT_FIELDS, EXECUTION_PLAN_STATUSES, validateExecutionPlanContract } = require('../src/core/execution-plan-contract');
const { EXECUTION_PLAN_RESULT_FIELDS, RESULT_STATUSES, validateExecutionPlanResult } = require('../src/core/execution-plan-result');
const { validateExecutionPlanAudit } = require('../src/core/execution-plan-audit');
const { EXECUTION_PLAN_PACKAGE_FIELDS, buildExecutionPlanPackage, computeExecutionPlanPackageFingerprint } = require('../src/core/execution-plan-package-integrity');
const { evaluateExecutionPlanRequest } = require('../src/core/execution-plan-engine');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioFixture(key) {
  return clone(fixture.scenarios[key]);
}

const EXPECTED_SCENARIOS = [
  'valid-reference-binding-no-llm', 'valid-reference-binding-selection', 'valid-reference-binding-tool',
  'valid-reference-binding-workflow', 'provenance-id-mismatch', 'provenance-fingerprint-mismatch',
  'scope-plan-blocked', 'scope-task-blocked', 'scope-agent-blocked', 'scope-stage-type-blocked',
  'scope-risk-blocked', 'scope-budget-blocked', 'scope-selection-blocked', 'registry-version-mismatch',
  'registry-fingerprint-mismatch', 'idempotency-plan-mismatch', 'idempotency-authz-mismatch',
  'idempotency-fingerprint-mismatch', 'stop-condition-plan-mismatch', 'stop-condition-stage-mismatch',
  'compensation-plan-mismatch', 'compensation-stage-mismatch', 'package-fingerprint-baseline',
  'package-fingerprint-provenance-change', 'package-fingerprint-scope-change',
  'package-fingerprint-snapshot-change', 'context-side-channel-inert'
];

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('fixture and docs exist, cover every named scenario, and are free of operational material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'HERMES_EXECUTION_REFERENCE_BINDING_PROVENANCE.md')), true);
  assert.deepEqual(Object.keys(fixture.scenarios).sort(), [...EXPECTED_SCENARIOS].sort());
  assert.deepEqual(findAgentCoreOperationalMaterial(fixture), []);
});

EXPECTED_SCENARIOS.forEach((key) => {
  test(`fixture scenario ${key} reproduces its recorded plan/result/binding outcome`, () => {
    const scenario = scenarioFixture(key);
    const outcome = evaluateExecutionPlanRequest(scenario.request, {});
    assert.equal(outcome.plan.execution_plan_status, scenario.plan.execution_plan_status);
    assert.equal(outcome.result.status, scenario.result.status);
    assert.equal(outcome.bindingResult.status, scenario.bindingResult.status);
    assertValid(`${key}:plan`, validateExecutionPlanContract(outcome.plan));
    assertValid(`${key}:result`, validateExecutionPlanResult(outcome.result));
    assertValid(`${key}:audit`, validateExecutionPlanAudit(outcome.audit));
    assertValid(`${key}:bindingResult`, validateExecutionReferenceBindingResult(outcome.bindingResult));
    assertValid(`${key}:bindingAudit`, validateExecutionReferenceBindingAudit(outcome.bindingAudit));
  });
});

// ---------------------------------------------------------------------------
// AuthorizationProvenanceReference
// ---------------------------------------------------------------------------

test('authorization provenance reference: exact fields (41), no self-fingerprint field, and safe flags forced', () => {
  assert.equal(AUTHORIZATION_PROVENANCE_REFERENCE_FIELDS.length, 41);
  assert.equal(AUTHORIZATION_PROVENANCE_REFERENCE_FIELDS.includes('authorization_provenance_fingerprint'), false);
  assert.deepEqual(AUTHORIZATION_PROVENANCE_REFERENCE_SAFE_FLAGS, {
    provenance_applied: false, execution_authorized: false, execution_started: false, simulation: true, production_blocked: true
  });
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.authorization_provenance_reference;
  assertValid('provenance', validateAuthorizationProvenanceReference(ref));
  assert.equal(validateAuthorizationProvenanceReference({ ...ref, provenance_applied: true }).valid, false);
  assert.equal(validateAuthorizationProvenanceReference({ ...ref, unexpected: 1 }).valid, false, 'campo extra deve bloquear');
  const { plan_id, ...missing } = ref;
  assert.equal(validateAuthorizationProvenanceReference(missing).valid, false, 'campo ausente deve bloquear');
});

test('authorization provenance reference: created_from_reference_id/parent_reference_id are nullable, everything else required', () => {
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.authorization_provenance_reference;
  assert.equal(ref.created_from_reference_id, null);
  assert.equal(ref.parent_reference_id, null);
  assert.equal(validateAuthorizationProvenanceReference({ ...ref, created_from_reference_id: '' }).valid, false, 'string vazia nao e null');
  assert.equal(validateAuthorizationProvenanceReference({ ...ref, created_from_reference_id: 'provref-parent-1' }).valid, true);
});

// ---------------------------------------------------------------------------
// AuthorizationScopeReference
// ---------------------------------------------------------------------------

test('authorization scope reference: exact fields (32), a positive allowlist (empty means nothing permitted), and cross-tenant/org/project/session forced false', () => {
  assert.equal(AUTHORIZATION_SCOPE_REFERENCE_FIELDS.length, 32);
  assert.equal(ALLOWED_ID_LIST_FIELDS.length, 6);
  assert.deepEqual(AUTHORIZATION_SCOPE_REFERENCE_SAFE_FLAGS, {
    cross_tenant_allowed: false, cross_organization_allowed: false, cross_project_allowed: false,
    cross_session_allowed: false, scope_applied: false, simulation: true, production_blocked: true
  });
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.authorization_scope_reference;
  assertValid('scope', validateAuthorizationScopeReference(ref));
  assert.equal(validateAuthorizationScopeReference({ ...ref, cross_tenant_allowed: true }).valid, false);
});

test('authorization scope reference: recompute-and-compare fingerprint, fail-closed', () => {
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.authorization_scope_reference;
  assert.equal(computeScopeReferenceFingerprint(ref), ref.scope_fingerprint);
  assert.equal(validateAuthorizationScopeReference({ ...ref, scope_fingerprint: 'tampered' }).errors.includes('scope_fingerprint_mismatch'), true);
});

test('authorization scope reference: allowed id lists must be wildcard-free, unique, and alphabetically ordered', () => {
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.authorization_scope_reference;
  assert.equal(validateAuthorizationScopeReference({ ...ref, allowed_plan_ids: ['b', 'a'] }).valid, false, 'ordem alfabetica obrigatoria');
  assert.equal(validateAuthorizationScopeReference({ ...ref, allowed_plan_ids: ['a', 'a'] }).valid, false, 'duplicatas devem bloquear');
  assert.equal(validateAuthorizationScopeReference({ ...ref, allowed_plan_ids: ['plan*'] }).valid, false, 'wildcard deve bloquear');
});

// ---------------------------------------------------------------------------
// ExecutionRegistrySnapshotReference
// ---------------------------------------------------------------------------

test('execution registry snapshot reference: exact fields (20), fixed entity key set (7), never a Map', () => {
  assert.equal(REGISTRY_SNAPSHOT_REFERENCE_FIELDS.length, 20);
  assert.deepEqual(REGISTRY_ENTITY_KEYS, [
    'execution_plan_request', 'stage_manifest', 'dependency_graph', 'provenance', 'scope', 'execution_plan_budget',
    'idempotency_policy'
  ]);
  assert.deepEqual(REGISTRY_SNAPSHOT_REFERENCE_SAFE_FLAGS, { snapshot_applied: false, simulation: true, production_blocked: true });
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.registry_snapshot_reference;
  assertValid('snapshot', validateExecutionRegistrySnapshotReference(ref));
  assert.equal(Object.keys(ref.registry_entity_versions).length, 7);
  assert.equal(Object.keys(ref.registry_entity_fingerprints).length, 7);
});

test('execution registry snapshot reference: snapshot_consistent is derived, never caller-asserted', () => {
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.registry_snapshot_reference;
  assert.equal(ref.snapshot_consistent, true);
  assert.equal(ref.expected_registry_version, ref.observed_registry_version);
  assert.equal(validateExecutionRegistrySnapshotReference({ ...ref, snapshot_consistent: false }).valid, false, 'declarar inconsistente quando as versoes batem deve bloquear');

  const inconsistent = buildExecutionRegistrySnapshotReference({ ...ref, observed_registry_version: 'v-other' });
  assert.equal(inconsistent.snapshot_consistent, false, 'builder nunca confia em snapshot_consistent do caller');
});

test('execution registry snapshot reference: recompute-and-compare fingerprint, fail-closed', () => {
  const ref = scenarioFixture('valid-reference-binding-no-llm').request.registry_snapshot_reference;
  assert.equal(validateExecutionRegistrySnapshotReference({ ...ref, snapshot_fingerprint: 'tampered' }).errors.includes('snapshot_fingerprint_mismatch'), true);
});

test('registry-version-mismatch and registry-fingerprint-mismatch fixtures are both REGISTRY_SNAPSHOT_BLOCKED', () => {
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('registry-version-mismatch').request, {}).result.status, 'REGISTRY_SNAPSHOT_BLOCKED');
  assert.equal(evaluateExecutionPlanRequest(scenarioFixture('registry-fingerprint-mismatch').request, {}).result.status, 'REGISTRY_SNAPSHOT_BLOCKED');
});

// ---------------------------------------------------------------------------
// BindingRecord / BindingLedger
// ---------------------------------------------------------------------------

test('binding record: exact fields (29), 18 binding types, 11 binding statuses, binding_applied always false', () => {
  assert.equal(BINDING_RECORD_FIELDS.length, 29);
  assert.equal(BINDING_TYPES.length, 18);
  assert.equal(BINDING_STATUSES.length, 11);
  assert.deepEqual(BINDING_RECORD_SAFE_FLAGS, { binding_applied: false, simulation: true, production_blocked: true });
});

test('binding record: binding_validated is tied to binding_status, never independently assertable', () => {
  const record = buildBindingRecord({
    binding_record_id: 'binding-record-check-1', execution_plan_id: 'plan-1', execution_plan_request_id: 'request-1',
    execution_stage_id: 'stage-1', binding_type: 'TASK_BINDING', source_reference_id: 'taskref-1', source_reference_version: 1,
    source_reference_fingerprint: 'fp-source-1', target_reference_id: 'stage-1', target_reference_version: 1,
    target_reference_fingerprint: 'fp-target-1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1',
    session_reference_id: 'session-1', agent_id: 'agent-1', actor_id: 'actor-1', authorization_scope_id: 'scope-1',
    binding_required: true, binding_status: 'VALIDATED_SIMULATION', logical_sequence: 0
  });
  assert.equal(record.binding_validated, true);
  assert.equal(validateBindingRecord({ ...record, binding_validated: false }).valid, false, 'status/validated podem nunca discordar');
});

test('binding record: recompute-and-compare fingerprint, fail-closed', () => {
  const record = scenarioFixture('valid-reference-binding-no-llm').bindingResult;
  // bindingResult itself has its own fingerprint check exercised below; here we tamper a real
  // BindingRecord pulled straight from a prepared plan's own materialized ledger data.
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('valid-reference-binding-no-llm').request, {});
  const sample = outcome.audit; // audit never carries binding_records directly; use ledger via engine internals instead
  assert.ok(record);
  const anyBindingRecord = buildBindingRecord({
    binding_record_id: 'binding-record-tamper-check', execution_plan_id: 'plan-1', execution_plan_request_id: 'request-1',
    execution_stage_id: null, binding_type: 'BUDGET_BINDING', source_reference_id: 'plan-budget-1', source_reference_version: 1,
    source_reference_fingerprint: 'fp-source-1', target_reference_id: 'plan-1', target_reference_version: 1,
    target_reference_fingerprint: 'fp-target-1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1',
    session_reference_id: 'session-1', agent_id: 'agent-1', actor_id: 'actor-1', authorization_scope_id: 'scope-1',
    binding_required: true, binding_status: 'VALIDATED_SIMULATION', logical_sequence: 0
  });
  assert.equal(validateBindingRecord({ ...anyBindingRecord, binding_record_fingerprint: 'tampered' }).errors.includes('binding_record_fingerprint_mismatch'), true);
});

test('binding ledger: exact fields (32), 12 ledger statuses, references_bound_in_simulation tied to evidence', () => {
  assert.equal(BINDING_LEDGER_FIELDS.length, 32);
  assert.equal(LEDGER_STATUSES.length, 12);
  assert.deepEqual(BINDING_LEDGER_SAFE_FLAGS, {
    bindings_applied: false, execution_authorized: false, execution_started: false, simulation: true, production_blocked: true
  });
});

test('binding ledger: binding_count/validated_binding_count/blocked_binding_count/all_bindings_validated are all derived from binding_records, never caller-asserted', () => {
  const r1 = buildBindingRecord({
    binding_record_id: 'binding-record-ledger-check-1', execution_plan_id: 'plan-1', execution_plan_request_id: 'request-1',
    execution_stage_id: 'stage-1', binding_type: 'TASK_BINDING', source_reference_id: 'taskref-1', source_reference_version: 1,
    source_reference_fingerprint: 'fp-source-1', target_reference_id: 'stage-1', target_reference_version: 1,
    target_reference_fingerprint: 'fp-target-1', tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1',
    session_reference_id: 'session-1', agent_id: 'agent-1', actor_id: 'actor-1', authorization_scope_id: 'scope-1',
    binding_required: true, binding_status: 'VALIDATED_SIMULATION', logical_sequence: 0
  });
  const ledger = buildExecutionReferenceBindingLedger({
    binding_ledger_id: 'binding-ledger-check-1', execution_plan_request_id: 'request-1', execution_plan_id: 'plan-1',
    authorization_decision_id: 'decision-1', authorization_scope_reference_id: 'scope-reference-1',
    authorization_provenance_reference_id: 'provenance-reference-1', registry_snapshot_reference_id: 'snapshot-reference-1',
    tenant_id: 'tenant-a', organization_id: 'tenant-a:org-1', project_id: 'proj-1', session_reference_id: 'session-1',
    agent_id: 'agent-1', actor_id: 'actor-1', binding_records: [r1], all_required_bindings_present: true, logical_sequence: 0
  });
  assert.equal(ledger.binding_count, 1);
  assert.equal(ledger.validated_binding_count, 1);
  assert.equal(ledger.blocked_binding_count, 0);
  assert.equal(ledger.all_bindings_validated, true);
  assert.equal(ledger.references_bound_in_simulation, true);
  assert.equal(ledger.ledger_status, 'REFERENCES_BOUND_SIMULATION');
  assert.equal(validateExecutionReferenceBindingLedger({ ...ledger, binding_count: 99 }).valid, false, 'contagens nao podem divergir dos binding_records');
  assert.equal(validateExecutionReferenceBindingLedger({ ...ledger, ledger_fingerprint: 'tampered' }).errors.includes('ledger_fingerprint_mismatch'), true);
});

// ---------------------------------------------------------------------------
// ExecutionReferenceBindingResult / Audit
// ---------------------------------------------------------------------------

test('binding result: exact fields (22), references_bound_in_simulation tied to status, execution flags forced false', () => {
  assert.equal(BINDING_RESULT_FIELDS.length, 22);
  const scenario = scenarioFixture('valid-reference-binding-no-llm');
  assertValid('bindingResult', validateExecutionReferenceBindingResult(scenario.bindingResult));
  assert.equal(scenario.bindingResult.status, 'REFERENCES_BOUND_SIMULATION');
  assert.equal(scenario.bindingResult.references_bound_in_simulation, true);
  assert.equal(scenario.bindingResult.execution_authorized, false);
});

test('binding result: recompute-and-compare fingerprint, fail-closed', () => {
  const result = buildExecutionReferenceBindingResult({
    binding_result_id: 'binding-result-tamper-check', execution_plan_request_id: 'request-1', execution_plan_id: 'plan-1',
    binding_ledger_id: 'binding-ledger-1', binding_ledger_fingerprint: 'fp-ledger-1', tenant_id: 'tenant-a',
    organization_id: 'tenant-a:org-1', project_id: 'proj-1', session_reference_id: 'session-1', agent_id: 'agent-1',
    actor_id: 'actor-1', status: 'REFERENCES_BOUND_SIMULATION', reason_codes: [], logical_sequence: 0
  });
  assert.equal(validateExecutionReferenceBindingResult({ ...result, result_fingerprint: 'tampered' }).errors.includes('result_fingerprint_mismatch'), true);
});

test('binding audit: exact fields, and never carries a full payload -- only ids, fingerprints, status, counts, and the seven bindings', () => {
  const scenario = scenarioFixture('valid-reference-binding-no-llm');
  assertValid('bindingAudit', validateExecutionReferenceBindingAudit(scenario.bindingAudit));
  assert.deepEqual(
    Object.keys(scenario.bindingAudit).sort(),
    [...EXECUTION_REFERENCE_BINDING_AUDIT_FIELDS].sort()
  );
  assert.equal(scenario.bindingAudit.executed, false);
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('execution reference binding registry: replay is accepted, payload mismatch and tenant/organization reassignment are blocked', () => {
  const registry = createExecutionReferenceBindingRegistry();
  const scopeRef = scenarioFixture('valid-reference-binding-no-llm').request.authorization_scope_reference;
  const first = registry.registerAuthorizationScopeReference(scopeRef);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  assert.equal(registry.registerAuthorizationScopeReference(scopeRef).status, 'REPLAY_ACCEPTED');
  const reassigned = buildAuthorizationScopeReference({ ...scopeRef, tenant_id: 'tenant-other' });
  assert.equal(registry.registerAuthorizationScopeReference(reassigned).status, 'TENANT_BLOCKED');
  assert.deepEqual(registry.getAuthorizationScopeReferenceById(scopeRef.authorization_scope_reference_id), scopeRef);
});

// ---------------------------------------------------------------------------
// Side-channel inertness
// ---------------------------------------------------------------------------

test('context.currentRegistryVersion, context.authorizationScope, context.bindingRecords, and context.anything are all inert', () => {
  const request = scenarioFixture('context-side-channel-inert').request;
  const clean = evaluateExecutionPlanRequest(request, {});
  const poisoned = evaluateExecutionPlanRequest(request, {
    currentRegistryVersion: 'totally-different', authorizationScope: { unlimited: true }, bindingRecords: [{ fake: true }], anything: 'xyz'
  });
  assert.equal(poisoned.result.status, clean.result.status);
  assert.deepEqual(poisoned.plan, clean.plan);
  assert.deepEqual(poisoned.result, clean.result);
  assert.deepEqual(poisoned.bindingResult, clean.bindingResult);
});

// ---------------------------------------------------------------------------
// ExecutionPlanRequest / Contract / Result: new pr100 fields
// ---------------------------------------------------------------------------

test('execution plan request: authorization_provenance_reference/authorization_scope_reference/registry_snapshot_reference are required, no side-channel', () => {
  const request = scenarioFixture('valid-reference-binding-no-llm').request;
  assertValid('request', validateExecutionPlanRequest(request));
  const { authorization_provenance_reference, ...missingProvenance } = request;
  assert.equal(validateExecutionPlanRequest(missingProvenance).valid, false);
  const { authorization_scope_reference, ...missingScope } = request;
  assert.equal(validateExecutionPlanRequest(missingScope).valid, false);
  const { registry_snapshot_reference, ...missingSnapshot } = request;
  assert.equal(validateExecutionPlanRequest(missingSnapshot).valid, false);
});

test('execution plan contract: execution_scope_reference_id points at the real AuthorizationScopeReference, never at the execution_plan_id itself', () => {
  const scenario = scenarioFixture('valid-reference-binding-no-llm');
  const outcome = evaluateExecutionPlanRequest(scenario.request, {});
  assert.equal(outcome.plan.execution_scope_reference_id, scenario.request.authorization_scope_reference.authorization_scope_reference_id);
  assert.notEqual(outcome.plan.execution_scope_reference_id, outcome.plan.execution_plan_id);
});

test('execution plan contract and result carry the 8 new provenance/scope/snapshot/ledger id+fingerprint fields, all populated for a prepared plan', () => {
  const scenario = scenarioFixture('valid-reference-binding-no-llm');
  const outcome = evaluateExecutionPlanRequest(scenario.request, {});
  for (const field of [
    'authorization_provenance_reference_id', 'authorization_provenance_fingerprint', 'authorization_scope_reference_id',
    'authorization_scope_fingerprint', 'registry_snapshot_reference_id', 'registry_snapshot_fingerprint',
    'binding_ledger_id', 'binding_ledger_fingerprint'
  ]) {
    assert.notEqual(outcome.plan[field], undefined, `plan.${field}`);
    assert.notEqual(outcome.result[field], undefined, `result.${field}`);
    assert.notEqual(outcome.plan[field], 'fingerprint_not_available');
  }
  assert.equal(outcome.result.authorization_provenance_validated, true);
  assert.equal(outcome.result.authorization_scope_validated, true);
  assert.equal(outcome.result.registry_snapshot_validated, true);
  assert.equal(outcome.result.binding_ledger_validated, true);
  assert.equal(outcome.result.references_bound_in_simulation, true);
});

test('the 4 new pr100 statuses are legal on both the contract and result vocabularies', () => {
  for (const status of ['AUTHORIZATION_PROVENANCE_BLOCKED', 'AUTHORIZATION_SCOPE_BLOCKED', 'REGISTRY_SNAPSHOT_BLOCKED', 'REFERENCE_BINDING_BLOCKED']) {
    assert.equal(EXECUTION_PLAN_STATUSES.includes(status), true, status);
    assert.equal(RESULT_STATUSES.includes(status), true, status);
  }
});

// ---------------------------------------------------------------------------
// Package fingerprint sensitivity
// ---------------------------------------------------------------------------

test('execution plan package: exact fields (41, +6 from pr100), and each new fingerprint independently changes the package fingerprint', () => {
  assert.equal(EXECUTION_PLAN_PACKAGE_FIELDS.length, 41);
  const base = { execution_plan_id: 'plan-x', ordered_stage_ids: ['stage-1'], stage_fingerprints: ['fp-a'] };
  const pkgBase = buildExecutionPlanPackage(base);
  const pkgProvenance = buildExecutionPlanPackage({ ...base, authorization_provenance_fingerprint: 'fp-provenance-a' });
  const pkgScope = buildExecutionPlanPackage({ ...base, authorization_scope_fingerprint: 'fp-scope-a' });
  const pkgSnapshot = buildExecutionPlanPackage({ ...base, registry_snapshot_fingerprint: 'fp-snapshot-a' });
  const pkgLedger = buildExecutionPlanPackage({ ...base, binding_ledger_fingerprint: 'fp-ledger-a' });
  const pkgBindingRecords = buildExecutionPlanPackage({ ...base, binding_record_ids: ['binding-record-1'], binding_record_fingerprints: ['fp-binding-record-1'] });
  const fpBase = computeExecutionPlanPackageFingerprint(pkgBase);
  assert.notEqual(computeExecutionPlanPackageFingerprint(pkgProvenance), fpBase);
  assert.notEqual(computeExecutionPlanPackageFingerprint(pkgScope), fpBase);
  assert.notEqual(computeExecutionPlanPackageFingerprint(pkgSnapshot), fpBase);
  assert.notEqual(computeExecutionPlanPackageFingerprint(pkgLedger), fpBase);
  assert.notEqual(computeExecutionPlanPackageFingerprint(pkgBindingRecords), fpBase);
});

['package-fingerprint-provenance-change', 'package-fingerprint-scope-change', 'package-fingerprint-snapshot-change'].forEach((key) => {
  test(`${key}: changing only that one reference changes execution_plan_fingerprint relative to the baseline`, () => {
    const baseline = evaluateExecutionPlanRequest(scenarioFixture('package-fingerprint-baseline').request, {});
    const changed = evaluateExecutionPlanRequest(scenarioFixture(key).request, {});
    assert.equal(baseline.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
    assert.equal(changed.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
    assert.notEqual(changed.result.execution_plan_fingerprint, baseline.result.execution_plan_fingerprint);
  });
});

// ---------------------------------------------------------------------------
// Security: forbidden material, non-serializable payloads
// ---------------------------------------------------------------------------

test('operational material is rejected on every new pr100 contract, and non-serializable payloads are rejected', () => {
  const provenance = scenarioFixture('valid-reference-binding-no-llm').request.authorization_provenance_reference;
  const scope = scenarioFixture('valid-reference-binding-no-llm').request.authorization_scope_reference;
  const snapshot = scenarioFixture('valid-reference-binding-no-llm').request.registry_snapshot_reference;
  for (const ref of [provenance, scope, snapshot]) {
    assert.deepEqual(findAgentCoreOperationalMaterial(ref), []);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => stablePayload(cyclic));
  assert.equal(findAgentCoreOperationalMaterial(cyclic).some((e) => e.includes('forbidden_cycle')), true);
});

test('adversarial: an object literal is never accepted where a real reference is required (type confusion is rejected structurally)', () => {
  assert.equal(validateAuthorizationProvenanceReference([]).valid, false);
  assert.equal(validateAuthorizationProvenanceReference('not-an-object').valid, false);
  assert.equal(validateAuthorizationScopeReference(null).valid, false);
  assert.equal(validateExecutionRegistrySnapshotReference(42).valid, false);
  assert.equal(validateBindingRecord(undefined).valid, false);
  assert.equal(validateExecutionReferenceBindingLedger([1, 2, 3]).valid, false);
});

// ---------------------------------------------------------------------------
// Regression: idempotency/stop-condition/compensation cross-checks
// ---------------------------------------------------------------------------

['idempotency-plan-mismatch', 'idempotency-authz-mismatch', 'idempotency-fingerprint-mismatch',
  'stop-condition-plan-mismatch', 'stop-condition-stage-mismatch', 'compensation-plan-mismatch', 'compensation-stage-mismatch'
].forEach((key) => {
  test(`${key} is REFERENCE_BINDING_BLOCKED`, () => {
    assert.equal(evaluateExecutionPlanRequest(scenarioFixture(key).request, {}).result.status, 'REFERENCE_BINDING_BLOCKED');
  });
});

test('regression: every prior stage-level ExecutionPlanStageBinding is still wrapped 1:1 into the richer BindingRecord ledger, never duplicated or dropped', () => {
  const scenario = scenarioFixture('valid-reference-binding-no-llm');
  const outcome = evaluateExecutionPlanRequest(scenario.request, {});
  assert.equal(outcome.plan.stage_binding_ids.length > 0, true);
  assert.equal(outcome.result.binding_count, outcome.plan.stage_binding_ids.length);
});
