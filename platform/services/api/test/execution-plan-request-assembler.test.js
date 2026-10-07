'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fixture=require('./fixtures/hermes-execution-plan-contracts.json').scenarios['prepared-no-llm-plan'].request;
const {assembleExecutionPlanRequest}=require('../src/core/execution-plan-request-assembler');
const {evaluateExecutionPlanRequest}=require('../src/core/execution-plan-engine');

function inputFromFixture(){
 const request=structuredClone(fixture);
 const auth=request.authorization_decision_reference;
 return {
  authorization_result:{decision:{...auth,decision_fingerprint:auth.authorization_decision_fingerprint}},
  execution_plan_request_id:request.execution_plan_request_id,
  orchestrator_decision_reference:request.orchestrator_decision_reference,
  readiness_evidence_bundle_reference:request.readiness_evidence_bundle_reference,
  planning_result_reference:request.planning_result_reference,
  orchestration_plan_reference:request.orchestration_plan_reference,
  task_reference:request.task_reference,
  memory_selection_reference:request.memory_selection_reference,
  context_assembly_reference:request.context_assembly_reference,
  model_selection_reference:request.model_selection_reference,
  tool_decision_references:request.tool_decision_references,
  workflow_decision_reference:request.workflow_decision_reference,
  execution_plan_policy_reference:request.execution_plan_policy_reference,
  execution_plan_budget:request.execution_plan_budget,
  idempotency_policy_reference:request.idempotency_policy_reference,
  stop_condition_references:request.stop_condition_references,
  compensation_references:request.compensation_references,
  dependency_graph_reference:request.dependency_graph_reference,
  stage_manifest_reference:request.stage_manifest_reference,
  authorization_provenance_reference:request.authorization_provenance_reference,
  authorization_scope_reference:request.authorization_scope_reference,
  registry_snapshot_reference:request.registry_snapshot_reference,
  correlation_id:request.correlation_id,causation_id:request.causation_id,trace_id:request.trace_id,
  logical_sequence:request.logical_sequence,expected_registry_version:request.expected_registry_version,
  simulation_context:request.simulation_context
 };
}
test('assembles a validated execution plan request without granting execution',()=>{
 const out=assembleExecutionPlanRequest(inputFromFixture());
 assert.equal(out.authorization_decision_reference.execution_authorized,false);
 assert.equal(out.authorization_decision_reference.executed,false);
 assert.equal(out.authorization_decision_reference.production_blocked,true);
});
test('fails closed on cross-plan identity drift',()=>{
 const input=inputFromFixture(); input.task_reference={...input.task_reference,plan_id:'drifted-plan'};
 assert.throws(()=>assembleExecutionPlanRequest(input),/plan_identity_mismatch/);
});
test('fails closed when authorization is not simulation-ready',()=>{
 const input=inputFromFixture(); input.authorization_result.decision={...input.authorization_result.decision,status:'BLOCKED'};
 assert.throws(()=>assembleExecutionPlanRequest(input),/authorization_not_ready_simulation/);
});

test('seals registry snapshot and reaches execution-plan engine',()=>{
 const input=inputFromFixture(), old=input.registry_snapshot_reference;
 delete input.registry_snapshot_reference;
 input.registry_snapshot_seed={
  registry_snapshot_reference_id:old.registry_snapshot_reference_id,
  observed_registry_version:input.expected_registry_version,
  registry_entity_versions:old.registry_entity_versions,
  snapshot_validated:true,
  logical_sequence:input.logical_sequence
 };
 const out=assembleExecutionPlanRequest(input);
 assert.equal(out.registry_snapshot_reference.snapshot_consistent,true);
 const evaluated=evaluateExecutionPlanRequest(out,{});
 assert.equal(evaluated.result.execution_authorized,false);
 assert.equal(evaluated.result.executed,false);
 assert.equal(evaluated.result.production_blocked,true);
 assert.notEqual(evaluated.result.status,'VALIDATION_FAILED');
 assert.notEqual(evaluated.result.status,'REGISTRY_BLOCKED');
});
test('engine fails closed when stage task identity drifts from authorized task',()=>{
 const input=inputFromFixture(), old=input.registry_snapshot_reference;
 input.stage_manifest_reference=structuredClone(input.stage_manifest_reference);
 input.stage_manifest_reference.stage_records[0].task_reference_id='drifted-task';
 delete input.registry_snapshot_reference;
 input.registry_snapshot_seed={
  registry_snapshot_reference_id:old.registry_snapshot_reference_id,
  observed_registry_version:input.expected_registry_version,
  registry_entity_versions:old.registry_entity_versions,
  snapshot_validated:true,
  logical_sequence:input.logical_sequence
 };
 assert.throws(()=>assembleExecutionPlanRequest(input),/manifest_fingerprint_mismatch|stage_fingerprint_mismatch/);
});
