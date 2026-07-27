'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  attributeBlockingStatus, createValidationTrace, finalizeValidationTrace, markValidationInvalid,
  markValidationNotApplicable, markValidationStarted, markValidationValid
} = require('../src/core/validation-trace');
const { VALIDATION_STAGES } = require('../src/core/validation-outcome');
const { evaluateExecutionPlanRequest } = require('../src/core/execution-plan-engine');

function scenarioFixture(file, key) {
  return JSON.parse(JSON.stringify(require(`./fixtures/${file}`).scenarios[key]));
}

function outcomeStateFor(ledger, stage) {
  const outcome = ledger.validation_outcomes.find((o) => o.validation_stage === stage);
  return outcome ? outcome.state : undefined;
}

const IDENTITY = {
  validation_ledger_id: 'vl-test-1', tenant_id: 't', organization_id: 'o', project_id: 'p',
  session_reference_id: 's', agent_id: 'a', actor_id: 'ac'
};

// ---------------------------------------------------------------------------
// Unit tests: validation-trace.js itself
// ---------------------------------------------------------------------------

test('markValidationValid only succeeds for a stage the caller explicitly marks -- never inferred', () => {
  const trace = createValidationTrace();
  markValidationValid(trace, 'SCHEMA');
  const ledger = finalizeValidationTrace(trace, IDENTITY);
  assert.equal(outcomeStateFor(ledger, 'SCHEMA'), 'VALID', 'a genuinely marked stage is VALID');
  assert.equal(outcomeStateFor(ledger, 'TENANT'), 'NOT_EVALUATED', 'an unmarked stage stays NOT_EVALUATED, never inferred VALID');
});

test('markValidationStarted transitions nothing -- ValidationState has no distinct started state', () => {
  const trace = createValidationTrace();
  markValidationStarted(trace, 'BUDGET');
  const ledger = finalizeValidationTrace(trace, IDENTITY);
  assert.equal(outcomeStateFor(ledger, 'BUDGET'), 'NOT_EVALUATED');
});

test('a stage can only be marked once -- markValidationValid/NotApplicable throw on a second mark', () => {
  const trace = createValidationTrace();
  markValidationValid(trace, 'SCHEMA');
  assert.throws(() => markValidationValid(trace, 'SCHEMA'));
  assert.throws(() => markValidationNotApplicable(trace, 'SCHEMA'));
});

test('markValidationInvalid on an already-marked stage is a silent no-op, never a throw or an overwrite', () => {
  const trace = createValidationTrace();
  markValidationValid(trace, 'TENANT');
  markValidationInvalid(trace, 'TENANT', 'TENANT_BLOCKED', ['should_not_apply']);
  const ledger = finalizeValidationTrace(trace, IDENTITY);
  assert.equal(outcomeStateFor(ledger, 'TENANT'), 'VALID', 'the original VALID mark is never downgraded');
});

test('an unknown stage name is rejected', () => {
  const trace = createValidationTrace();
  assert.throws(() => markValidationValid(trace, 'NOT_A_REAL_STAGE'));
});

test('a finalized trace is immutable -- no further marks are accepted', () => {
  const trace = createValidationTrace();
  markValidationValid(trace, 'SCHEMA');
  finalizeValidationTrace(trace, IDENTITY);
  assert.throws(() => markValidationValid(trace, 'TENANT'));
  assert.throws(() => finalizeValidationTrace(trace, IDENTITY));
});

test('finalizeValidationTrace produces a deterministic ledger_fingerprint for identical marks', () => {
  const traceA = createValidationTrace();
  markValidationValid(traceA, 'SCHEMA');
  markValidationInvalid(traceA, 'TENANT', 'TENANT_BLOCKED', ['tenant_mismatch']);
  const ledgerA = finalizeValidationTrace(traceA, IDENTITY);

  const traceB = createValidationTrace();
  markValidationValid(traceB, 'SCHEMA');
  markValidationInvalid(traceB, 'TENANT', 'TENANT_BLOCKED', ['tenant_mismatch']);
  const ledgerB = finalizeValidationTrace(traceB, IDENTITY);

  assert.equal(ledgerA.ledger_fingerprint, ledgerB.ledger_fingerprint);
});

test('attributeBlockingStatus never overrides an explicit engine-side mark', () => {
  const trace = createValidationTrace();
  markValidationInvalid(trace, 'BUDGET', 'BUDGET_BLOCKED', ['explicit']);
  attributeBlockingStatus(trace, 'TENANT_BLOCKED', ['should_not_apply']);
  const ledger = finalizeValidationTrace(trace, IDENTITY);
  assert.equal(outcomeStateFor(ledger, 'BUDGET'), 'INVALID');
  assert.equal(outcomeStateFor(ledger, 'TENANT'), 'NOT_EVALUATED', 'attributeBlockingStatus must not fire once an explicit INVALID mark already exists');
});

test('attributeBlockingStatus never re-marks a stage the engine already confirmed VALID', () => {
  const trace = createValidationTrace();
  markValidationValid(trace, 'PROJECT');
  attributeBlockingStatus(trace, 'PROJECT_BLOCKED', ['scope-project-mismatch']);
  const ledger = finalizeValidationTrace(trace, IDENTITY);
  assert.equal(outcomeStateFor(ledger, 'PROJECT'), 'VALID', 'an already-VALID stage is never downgraded, even by the taxonomy fallback');
});

test('attributeBlockingStatus is a no-op for a status with no taxonomy stage (e.g. MODEL_BLOCKED, outside the 24-status taxonomy)', () => {
  const trace = createValidationTrace();
  markValidationValid(trace, 'SCHEMA');
  attributeBlockingStatus(trace, 'MODEL_BLOCKED', ['model_stage_not_allowed_by_policy']);
  const ledger = finalizeValidationTrace(trace, IDENTITY);
  assert.equal(ledger.validation_outcomes.every((o) => o.state !== 'INVALID'), true);
});

test('finalizeValidationTrace covers every one of the 22 canonical stages, explicitly, never omitting an unreached one', () => {
  const trace = createValidationTrace();
  markValidationValid(trace, 'SCHEMA');
  const ledger = finalizeValidationTrace(trace, IDENTITY);
  assert.deepEqual(ledger.validation_outcomes.map((o) => o.validation_stage).sort(), [...VALIDATION_STAGES].sort());
});

// ---------------------------------------------------------------------------
// Engine integration: real fixtures, proving the trace against the real gate chain
// ---------------------------------------------------------------------------

test('a validator/gate that was genuinely reached and passed is VALID -- a fully prepared plan has every real stage VALID', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'prepared-no-llm-plan').request, {});
  assert.equal(outcome.result.status, 'EXECUTION_PLAN_PREPARED_SIMULATION');
  const ledger = outcome.validationLedger;
  assert.equal(ledger.pipeline_completed, true);
  assert.equal(ledger.not_evaluated_count, 0);
  // COMPENSATIONS is legitimately NOT_APPLICABLE for this scenario (no state-change stage) --
  // every other one of the 22 stages was genuinely reached and is VALID.
  for (const outcomeEntry of ledger.validation_outcomes) {
    if (outcomeEntry.validation_stage === 'COMPENSATIONS') {
      assert.equal(outcomeEntry.state, 'NOT_APPLICABLE');
    } else {
      assert.equal(outcomeEntry.state, 'VALID', `${outcomeEntry.validation_stage} should be VALID on a fully prepared plan`);
    }
  }
});

test('SCHEMA blocker leaves every other stage NOT_EVALUATED, including SIMULATION_CONTEXT/IDENTITY which are normally marked alongside it', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'dependency-cycle-plan').request, {});
  assert.equal(outcome.result.status, 'VALIDATION_FAILED');
  const ledger = outcome.validationLedger;
  assert.equal(outcomeStateFor(ledger, 'SCHEMA'), 'INVALID');
  for (const stage of VALIDATION_STAGES) {
    if (stage === 'SCHEMA') continue;
    assert.equal(outcomeStateFor(ledger, stage), 'NOT_EVALUATED', `${stage} must stay NOT_EVALUATED when SCHEMA itself blocks`);
  }
});

test('TENANT blocker does not mark ORGANIZATION/PROJECT/SESSION/TASK or anything later as VALID', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'tenant-mismatch-plan').request, {});
  assert.equal(outcome.result.status, 'TENANT_BLOCKED');
  const ledger = outcome.validationLedger;
  assert.equal(outcomeStateFor(ledger, 'TENANT'), 'INVALID');
  for (const stage of ['ORGANIZATION', 'PROJECT', 'SESSION', 'TASK', 'AUTHORIZATION_PROVENANCE', 'AUTHORIZATION_SCOPE', 'BUDGET']) {
    assert.equal(outcomeStateFor(ledger, stage), 'NOT_EVALUATED', `${stage} must not be inferred VALID after a TENANT block`);
  }
  // Stages genuinely reached before the bindingChecks loop (real chronological order, not
  // canonical order -- AUTHORIZATION/EVIDENCE are checked before TENANT in the real engine) stay
  // honestly VALID.
  assert.equal(outcomeStateFor(ledger, 'AUTHORIZATION'), 'VALID');
  assert.equal(outcomeStateFor(ledger, 'EVIDENCE'), 'VALID');
});

test('AUTHORIZATION_SCOPE blocker preserves only the gates genuinely executed before it', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-reference-binding-provenance.json', 'scope-plan-blocked').request, {});
  assert.equal(outcome.result.status, 'AUTHORIZATION_SCOPE_BLOCKED');
  const ledger = outcome.validationLedger;
  for (const stage of ['SCHEMA', 'SIMULATION_CONTEXT', 'AUTHORIZATION', 'EVIDENCE', 'IDENTITY', 'TENANT', 'ORGANIZATION', 'PROJECT', 'SESSION', 'AUTHORIZATION_PROVENANCE']) {
    assert.equal(outcomeStateFor(ledger, stage), 'VALID', `${stage} was genuinely reached before AUTHORIZATION_SCOPE and must be VALID`);
  }
  assert.equal(outcomeStateFor(ledger, 'AUTHORIZATION_SCOPE'), 'INVALID');
  for (const stage of ['TASK', 'REGISTRY_SNAPSHOT', 'STAGE_MANIFEST', 'DEPENDENCY_GRAPH', 'REFERENCE_BINDING', 'BUDGET', 'FINALIZATION']) {
    assert.equal(outcomeStateFor(ledger, stage), 'NOT_EVALUATED', `${stage} must not be inferred VALID after an AUTHORIZATION_SCOPE block`);
  }
});

test('STAGE_MANIFEST blocker does not mark DEPENDENCY_GRAPH valid', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-stage-manifest-integrity.json', 'planning-result-mismatch-manifest').request, {});
  assert.equal(outcome.result.status, 'STAGE_MANIFEST_BLOCKED');
  const ledger = outcome.validationLedger;
  assert.equal(outcomeStateFor(ledger, 'STAGE_MANIFEST'), 'INVALID');
  assert.equal(outcomeStateFor(ledger, 'DEPENDENCY_GRAPH'), 'NOT_EVALUATED');
  assert.equal(outcomeStateFor(ledger, 'REFERENCE_BINDING'), 'NOT_EVALUATED');
});

test('DEPENDENCY_GRAPH blocker does not mark REFERENCE_BINDING valid, and does not falsely mark STAGE_MANIFEST valid either since their real checks are interleaved per dependency record', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-stage-manifest-integrity.json', 'parallel-dependency-mismatch-manifest').request, {});
  assert.equal(outcome.result.status, 'DEPENDENCY_BLOCKED');
  const ledger = outcome.validationLedger;
  // STAGE_MANIFEST's second checkpoint and DEPENDENCY_GRAPH's own checks share the same per-record
  // loop -- a parallel/order failure on one record can occur before another record's own
  // membership check would have run, so neither stage may be honestly marked VALID until the
  // whole combined block passes for every record. This is the fail-closed, conservative choice:
  // never claim a stage valid unless its own real check demonstrably completed.
  assert.equal(outcomeStateFor(ledger, 'STAGE_MANIFEST'), 'NOT_EVALUATED');
  assert.equal(outcomeStateFor(ledger, 'PACKAGE_INTEGRITY'), 'VALID');
  assert.equal(outcomeStateFor(ledger, 'DEPENDENCY_GRAPH'), 'INVALID');
  assert.equal(outcomeStateFor(ledger, 'REFERENCE_BINDING'), 'NOT_EVALUATED');
  assert.equal(outcomeStateFor(ledger, 'IDEMPOTENCY'), 'NOT_EVALUATED');
});

test('BUDGET blocker does not mark IDEMPOTENCY/STOP_CONDITIONS/COMPENSATIONS valid', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'budget-blocked-plan').request, {});
  assert.equal(outcome.result.status, 'BUDGET_BLOCKED');
  const ledger = outcome.validationLedger;
  assert.equal(outcomeStateFor(ledger, 'BUDGET'), 'INVALID');
  for (const stage of ['IDEMPOTENCY', 'STOP_CONDITIONS', 'COMPENSATIONS', 'REFERENCE_BINDING', 'STAGE_MANIFEST', 'DEPENDENCY_GRAPH']) {
    assert.equal(outcomeStateFor(ledger, stage), 'NOT_EVALUATED', `${stage} must not be inferred VALID after a BUDGET block`);
  }
  assert.equal(outcome.result.authorization_validated, true, 'a genuinely-reached-and-passed stage stays honestly true');
  assert.equal(outcome.result.idempotency_validated, false, 'a never-reached stage is honestly false, not true');
});

test('waiting approval does not mark FINALIZATION valid, even though every other required stage genuinely is', () => {
  const outcome = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'approval-blocked-plan').request, {});
  assert.equal(outcome.result.status, 'WAITING_APPROVAL_REFERENCE');
  const ledger = outcome.validationLedger;
  assert.equal(outcomeStateFor(ledger, 'FINALIZATION'), 'NOT_EVALUATED');
  assert.equal(outcomeStateFor(ledger, 'REFERENCE_BINDING'), 'VALID');
  assert.equal(ledger.pipeline_completed, false, 'FINALIZATION not yet evaluated means the pipeline has not completed');
  assert.equal(outcome.result.stage_manifest_validated, true, 'legacy booleans that follow their own established rule are unaffected by this fix');
});

test('legacy *_validated booleans on the result are honestly derived from the real ledger, not hardcoded', () => {
  const prepared = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'prepared-no-llm-plan').request, {});
  assert.equal(prepared.result.authorization_validated, true);
  assert.equal(prepared.result.budget_validated, true);
  assert.equal(prepared.result.idempotency_validated, true);

  const budgetBlocked = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'budget-blocked-plan').request, {});
  assert.equal(budgetBlocked.result.authorization_validated, true);
  assert.equal(budgetBlocked.result.budget_validated, false);
  assert.equal(budgetBlocked.result.idempotency_validated, false);
  assert.equal(budgetBlocked.result.stop_conditions_validated, false);
  assert.equal(budgetBlocked.result.compensations_validated, false);
});

// ---------------------------------------------------------------------------
// FIX 2: architecture_gates_passed is never hardcoded true, never overridable
// ---------------------------------------------------------------------------

test('architecture_gates_passed is false on every plan/result this engine can produce, prepared or blocked', () => {
  const prepared = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'prepared-no-llm-plan').request, {});
  assert.equal(prepared.plan.architecture_gates_passed, false);
  assert.equal(prepared.result.architecture_gates_passed, false);

  const blocked = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'budget-blocked-plan').request, {});
  assert.equal(blocked.plan.architecture_gates_passed, false);
  assert.equal(blocked.result.architecture_gates_passed, false);
});

test('a request cannot smuggle architecture_gates_passed=true in -- the request contract has no such field to begin with', () => {
  const { EXECUTION_PLAN_REQUEST_FIELDS } = require('../src/core/execution-plan-request');
  assert.equal(EXECUTION_PLAN_REQUEST_FIELDS.includes('architecture_gates_passed'), false);
});

test('context cannot override architecture_gates_passed -- passing it through context has zero effect', () => {
  const request = scenarioFixture('hermes-execution-plan-contracts.json', 'prepared-no-llm-plan').request;
  const outcome = evaluateExecutionPlanRequest(request, { architecture_gates_passed: true, currentRegistryVersion: 'v99' });
  assert.equal(outcome.plan.architecture_gates_passed, false);
  assert.equal(outcome.result.architecture_gates_passed, false);
});

test('CI still runs architecture gates independently, and the script still reports success when they pass', () => {
  const { runAllGates } = require('../src/core/architecture-gate-runner');
  assert.deepEqual(runAllGates(), []);
});

test('the plan/result contracts remain simulation-only regardless of architecture_gates_passed', () => {
  const prepared = evaluateExecutionPlanRequest(scenarioFixture('hermes-execution-plan-contracts.json', 'prepared-no-llm-plan').request, {});
  assert.equal(prepared.plan.simulation, true);
  assert.equal(prepared.plan.production_blocked, true);
  assert.equal(prepared.plan.executable, false);
  assert.equal(prepared.result.execution_authorized, false);
  assert.equal(prepared.result.executed, false);
});

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

test('docs mention the ValidationTrace and architecture-gates-evidence sentences required by this fix', () => {
  const docPath = path.resolve(__dirname, '../../../docs/HERMES_VALIDATION_SEMANTICS_ARCHITECTURE_GATES.md');
  const content = fs.readFileSync(docPath, 'utf8');
  assert.equal(content.includes('ele não infere etapas válidas apenas pela posição do status final'), true);
  assert.equal(content.includes('sem evidência vinculada ao commit e ao ruleset'), true);
});
