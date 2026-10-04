const assert=require('node:assert/strict');
const test=require('node:test');
const plannerFixture=require('./fixtures/hermes-orchestrator-planner.json');
const decisionFixture=require('./fixtures/hermes-orchestrator-decision-engine.json');
const {evaluateOrchestratorPlanningRequest}=require('../src/core/orchestrator-planner');
const {buildPlanningResultReferenceFromPlannerOutput,buildOrchestrationPlanReferenceFromPlannerOutput}=require('../src/core/orchestrator-plan-reference');
const {buildBudgetEvidenceReference}=require('../src/core/orchestrator-budget-evidence-reference');
const {buildDependencyEvidenceReference}=require('../src/core/orchestrator-dependency-evidence-reference');
const {buildConflictEvidenceReference}=require('../src/core/orchestrator-conflict-evidence-reference');
const {buildApprovalEvidenceReference}=require('../src/core/orchestrator-approval-evidence-reference');
const {evaluateDecisionEvidence}=require('../src/core/orchestrator-decision-evidence-validator');
const {evaluateOrchestratorDecisionRequest}=require('../src/core/orchestrator-decision-engine');

const {stablePayload}=require('../src/core/agent-identity-contract');
const {buildOrchestratorDecisionReference,buildEvidenceBundleReference}=require('../src/core/execution-authorization-request');
const {buildExecutionAuthorizationTaskReference}=require('../src/core/execution-authorization-task-reference');
const {buildExecutionAuthorizationPolicy}=require('../src/core/execution-authorization-policy');
const {buildExecutionAuthorizationScope}=require('../src/core/execution-authorization-scope');
const {buildExecutionAuthorizationActorContext}=require('../src/core/execution-authorization-actor-context');
const {buildExecutionAuthorizationApprovalReference}=require('../src/core/execution-authorization-approval-reference');
const {buildExecutionAuthorizationBudgetReference}=require('../src/core/execution-authorization-budget-reference');
const {buildExecutionAuthorizationExpiration}=require('../src/core/execution-authorization-expiration');
const {evaluateExecutionAuthorizationRequest}=require('../src/core/execution-authorization-boundary');


test('same-run planner evidence bundle reaches ready simulation',()=>{
 const out=evaluateOrchestratorPlanningRequest(structuredClone(plannerFixture.scenarios['no-llm-plan'].request));
 const p=buildPlanningResultReferenceFromPlannerOutput(out), plan=buildOrchestrationPlanReferenceFromPlannerOutput(out);
 const base=structuredClone(decisionFixture.scenarios['ready-no-llm-decision'].request);
 const common={planning_result_id:p.planning_result_id,plan_id:p.plan_id,tenant_id:p.tenant_id,organization_id:p.organization_id,logical_sequence:1};
 const budget=buildBudgetEvidenceReference({...common,budget_evidence_id:'be-same-run',agent_id:p.agent_id,project_id:p.project_id,session_reference_id:p.session_reference_id,budget_policy_reference_id:'budget-policy-same-run',budget_reference_id:'budget-same-run',maximum_total_tokens:Math.max(p.estimated_total_tokens,10000),estimated_total_tokens:p.estimated_total_tokens,maximum_total_cost_minor_units:Math.max(p.estimated_total_cost_minor_units,1000),estimated_total_cost_minor_units:p.estimated_total_cost_minor_units,reserved_memory_tokens:0,reserved_context_tokens:0,reserved_output_tokens:0});
 const dep=buildDependencyEvidenceReference({...common,dependency_evidence_id:'de-same-run',stage_ids:p.stage_ids,dependency_ids:p.dependency_ids,dependencyRecords:out.dependencies});
 const conflict=buildConflictEvidenceReference({...common,conflict_evidence_id:'ce-same-run',conflict_reference_ids:[]});
 const approval=buildApprovalEvidenceReference({...common,approval_evidence_id:'ae-same-run',project_id:p.project_id,session_reference_id:p.session_reference_id,approval_required:false,approval_type:'NONE',required_roles:[],minimum_approvals:0,approval_reference_ids:[]});
 const old=base.readiness_evidence_bundle_reference;
 const e=evaluateDecisionEvidence({readinessBundleId:'rb-same-run',decisionRequestId:base.decision_request_id,planningResultId:p.planning_result_id,planId:p.plan_id,agentId:p.agent_id,tenantId:p.tenant_id,organizationId:p.organization_id,projectId:p.project_id,sessionReferenceId:p.session_reference_id,budgetEvidence:budget,dependencyEvidence:dep,conflictEvidence:conflict,approvalEvidence:approval,policyDecisionFingerprint:old.policy_decision_fingerprint,memorySelectionDecisionFingerprint:old.memory_selection_decision_fingerprint,contextAssemblyResultFingerprint:old.context_assembly_result_fingerprint,modelSelectionDecisionFingerprint:old.model_selection_decision_fingerprint,toolDecisionFingerprints:old.tool_decision_fingerprints,workflowDecisionFingerprint:old.workflow_decision_fingerprint,policyReady:true,memoryReady:true,preferencesReady:true,projectStateReady:true,continuityReady:true,contextReady:true,modelReady:true,toolsReady:true,workflowReady:true,logicalSequence:1});
 assert.equal(e.bundle.bundle_status,'READY_EVIDENCE_SIMULATION');
 assert.equal(e.bundle.overall_ready_in_simulation,true);
 assert.equal(e.bundle.execution_authorized,false);
 const request={...base,planning_result_reference:p,orchestration_plan_reference:plan,
  budget_evidence_reference:budget,dependency_evidence_reference:dep,conflict_evidence_reference:conflict,
  approval_evidence_reference:approval,readiness_evidence_bundle_reference:e.bundle};
 const decision=evaluateOrchestratorDecisionRequest(request);
 assert.equal(decision.result.status,'READY_SIMULATION');
 assert.equal(decision.result.decision,'AUTHORIZE_PLAN_SIMULATION');
 assert.equal(decision.result.execution_authorized,false);
 assert.equal(decision.result.execution_started,false);
 assert.equal(decision.result.executed,false);
 assert.equal(decision.result.simulation,true);
 assert.equal(decision.result.production_blocked,true);

 const decisionRef=buildOrchestratorDecisionReference({
  ...decision.result,
  decision_result_id:decision.result.result_id,
  decision_fingerprint:stablePayload(decision.result)
 });
 const bundleRef=buildEvidenceBundleReference({
  ...e.bundle,
  bundle_fingerprint:stablePayload(e.bundle)
 });
 const task=buildExecutionAuthorizationTaskReference({
  task_reference_id:'taskref-same-run',planning_result_id:p.planning_result_id,plan_id:p.plan_id,
  agent_id:p.agent_id,tenant_id:p.tenant_id,organization_id:p.organization_id,project_id:p.project_id,
  session_reference_id:p.session_reference_id,task_id:'task-same-run',task_type:'CODE_REFERENCE',
  task_complexity:'TIER_2_SIMPLE',risk_classification:'LOW',data_classification:'INTERNAL',
  requires_human_approval:false,logical_sequence:1
 });
 const policy=buildExecutionAuthorizationPolicy({authorization_policy_id:'policy-same-run'});
 const scope=buildExecutionAuthorizationScope({
  scope_id:'scope-same-run',tenant_id:p.tenant_id,organization_id:p.organization_id,
  allowed_agent_ids:[p.agent_id],allowed_project_ids:[p.project_id],allowed_session_reference_ids:[p.session_reference_id],
  allowed_plan_ids:[p.plan_id],allowed_actor_ids:['actor-same-run'],allowed_actor_roles:['MANAGER'],
  allowed_task_types:['CODE_REFERENCE'],allowed_risk_classifications:['LOW'],
  maximum_authorized_cost_minor_units:1000,maximum_authorized_tokens:10000
 });
 const actor=buildExecutionAuthorizationActorContext({
  actor_id:'actor-same-run',actor_type:'USER',actor_role:'MANAGER',tenant_id:p.tenant_id,
  organization_id:p.organization_id,project_id:p.project_id,session_reference_id:p.session_reference_id,
  authorization_state:'APPROVED_SIMULATION',identity_verified:true,membership_verified:true,role_verified:true,scope_verified:true
 });
 const authApproval=buildExecutionAuthorizationApprovalReference({
  approval_reference_id:'approval-authz-same-run',planning_result_id:p.planning_result_id,plan_id:p.plan_id,
  tenant_id:p.tenant_id,organization_id:p.organization_id,project_id:p.project_id,session_reference_id:p.session_reference_id,
  approval_required:false,approval_type:'NONE',required_roles:[],minimum_approvals:0
 });
 const authBudget=buildExecutionAuthorizationBudgetReference({
  budget_authorization_id:'budget-authz-same-run',planning_result_id:p.planning_result_id,plan_id:p.plan_id,
  tenant_id:p.tenant_id,organization_id:p.organization_id,project_id:p.project_id,session_reference_id:p.session_reference_id,
  budget_evidence_id:budget.budget_evidence_id,maximum_authorized_tokens:10000,estimated_plan_tokens:p.estimated_total_tokens,
  maximum_authorized_cost_minor_units:1000,estimated_plan_cost_minor_units:p.estimated_total_cost_minor_units,
  protected_memory_reservations_preserved:true,protected_context_reservations_preserved:true,protected_output_reservations_preserved:true
 });
 const expiration=buildExecutionAuthorizationExpiration({
  expiration_evaluation_id:'expiration-same-run',authorization_created_sequence:1,current_sequence:2,
  maximum_valid_sequences:100,expiration_applicable:true
 });
 const authBase=structuredClone(require('./fixtures/hermes-execution-authorization-boundary.json').scenarios['authorized-no-llm-simulation'].request);
 const authRequest={...authBase,orchestrator_decision_reference:decisionRef,readiness_evidence_bundle_reference:bundleRef,
  planning_result_reference:p,orchestration_plan_reference:plan,task_reference:task,authorization_policy:policy,
  authorization_scope:scope,actor_context:actor,approval_reference:authApproval,budget_authorization_reference:authBudget,
  expiration_evaluation:expiration};
 const auth=evaluateExecutionAuthorizationRequest(authRequest);
 assert.equal(auth.decision.status,'AUTHORIZED_SIMULATION');
 assert.equal(auth.decision.decision,'AUTHORIZE_EXECUTION_REFERENCE_SIMULATION');
 assert.equal(auth.decision.authorized_in_simulation,true);
 assert.equal(auth.decision.execution_authorized,false);
 assert.equal(auth.decision.execution_started,false);
 assert.equal(auth.decision.executed,false);
 assert.equal(auth.decision.production_blocked,true);
});
