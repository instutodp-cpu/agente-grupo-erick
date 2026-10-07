'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fixture = require('./fixtures/hermes-orchestrator-planner.json');
const { evaluateOrchestratorPlanningRequest } = require('../src/core/orchestrator-planner');
const { evaluateOrchestratorDecisionRequest } = require('../src/core/orchestrator-decision-engine');
const decisionFixture = require('./fixtures/hermes-orchestrator-decision-engine.json');
const {
  buildPlanningResultReferenceFromPlannerOutput,
  buildOrchestrationPlanReferenceFromPlannerOutput,
  validatePlanningResultReference,
  validateOrchestrationPlanReference
} = require('../src/core/orchestrator-plan-reference');

function plannerOutput() {
  return evaluateOrchestratorPlanningRequest(structuredClone(fixture.scenarios['no-llm-plan'].request));
}

test('planner output projects into canonical decision/execution references without changing identity', () => {
  const output = plannerOutput();
  const planning = buildPlanningResultReferenceFromPlannerOutput(output);
  const plan = buildOrchestrationPlanReferenceFromPlannerOutput(output);
  assert.equal(validatePlanningResultReference(planning).valid, true);
  assert.equal(validateOrchestrationPlanReference(plan).valid, true);
  assert.equal(planning.plan_id, output.result.plan_id);
  assert.equal(planning.plan_fingerprint, output.result.plan_fingerprint);
  assert.equal(plan.plan_fingerprint, output.plan.plan_fingerprint);
  assert.deepEqual(plan.ordered_stage_ids, output.result.stage_ids);
  for (const ref of [planning, plan]) {
    assert.equal(ref.simulation, true);
    assert.equal(ref.production_blocked, true);
    assert.equal(ref.plan_executed, false);
  }
  assert.equal(planning.executed, false);
});

test('planner reference bridge fails closed on plan fingerprint drift', () => {
  const output = plannerOutput();
  output.plan = { ...output.plan, plan_fingerprint: 'drifted-fingerprint' };
  assert.throws(() => buildPlanningResultReferenceFromPlannerOutput(output), /planner_result_plan_identity_mismatch/);
});

test('planner reference bridge fails closed on stage identity drift', () => {
  const output = plannerOutput();
  output.stages = output.stages.slice(1);
  assert.throws(() => buildOrchestrationPlanReferenceFromPlannerOutput(output), /planner_stage_identity_mismatch/);
});


test('real planner references are accepted by the real decision engine contract', () => {
  const output = plannerOutput();
  const planning = buildPlanningResultReferenceFromPlannerOutput(output);
  const plan = buildOrchestrationPlanReferenceFromPlannerOutput(output);
  const base = structuredClone(decisionFixture.scenarios['ready-no-llm-decision'].request);
  base.planning_result_reference = planning;
  base.orchestration_plan_reference = plan;

  // Keep downstream evidence from the decision fixture, but bind its canonical identity to
  // the real Planner output. The engine must still reject any incompatible fingerprinted
  // evidence rather than trusting these top-level references alone.
  const outcome = evaluateOrchestratorDecisionRequest(base);
  assert.notEqual(outcome.result.status, 'READY_SIMULATION');
  assert.equal(outcome.result.execution_authorized, false);
  assert.equal(outcome.result.executed, false);
  assert.equal(outcome.result.production_blocked, true);
});
