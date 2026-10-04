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
const {buildStageRecord,buildOrchestratorStageManifestReference}=require('../src/core/orchestrator-stage-manifest-reference');
const {buildDependencyRecord,buildExecutionPlanDependencyGraphReference}=require('../src/core/execution-plan-dependency-graph-reference');
const {buildExecutionPlanBudget}=require('../src/core/execution-plan-budget');
const {buildExecutionPlanIdempotency}=require('../src/core/execution-plan-idempotency');
const {buildExecutionPlanStopCondition}=require('../src/core/execution-plan-stop-condition');
const {buildAuthorizationProvenanceReference}=require('../src/core/execution-authorization-provenance-reference');
const {buildAuthorizationScopeReference}=require('../src/core/execution-authorization-scope-reference');
const {buildExecutionPlanPolicyReference}=require('../src/core/execution-plan-request');
const {assembleExecutionPlanRequest}=require('../src/core/execution-plan-request-assembler');
const {evaluateExecutionPlanRequest}=require('../src/core/execution-plan-engine');
const {assembleArchitectureGateEvidenceFromCi}=require('../src/core/architecture-gate-ci-evidence-assembler');
const {buildExecutionGatewayFreshnessReference}=require('../src/core/execution-gateway-freshness-reference');
const {buildExecutionGatewayReplayReference}=require('../src/core/execution-gateway-replay-reference');
const {buildExecutionGatewayPackageReference}=require('../src/core/execution-gateway-package-reference');
const {buildExecutionGatewayPolicy}=require('../src/core/execution-gateway-policy');
const {buildExecutionGatewayRequest}=require('../src/core/execution-gateway-request');
const {evaluateExecutionGatewayRequest,computeGatewayPackageDigest}=require('../src/core/execution-gateway-boundary');
const {assembleGatewayRuntimeSimulationRequest}=require('../src/core/gateway-runtime-simulation-assembler');
const {evaluateRuntimeExecutionSimulationRequest}=require('../src/core/runtime-execution-package');
const {assembleRuntimeReadinessRequest,assembleRuntimeAdmissionRequest}=require('../src/core/runtime-readiness-admission-assembler');
const {evaluateRuntimeReadinessRequest,evaluateRuntimeAdmissionRequest}=require('../src/core/runtime-admission-boundary');


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
  task_reference_id:plannerFixture.scenarios['no-llm-plan'].request.task_definition.task_id,planning_result_id:p.planning_result_id,plan_id:p.plan_id,
  agent_id:p.agent_id,tenant_id:p.tenant_id,organization_id:p.organization_id,project_id:p.project_id,
  session_reference_id:p.session_reference_id,task_id:plannerFixture.scenarios['no-llm-plan'].request.task_definition.task_id,task_type:plannerFixture.scenarios['no-llm-plan'].request.task_definition.task_type,
  task_complexity:plannerFixture.scenarios['no-llm-plan'].request.task_definition.task_complexity,risk_classification:plannerFixture.scenarios['no-llm-plan'].request.task_definition.task_risk,data_classification:plannerFixture.scenarios['no-llm-plan'].request.task_definition.task_data_classification,
  requires_human_approval:plannerFixture.scenarios['no-llm-plan'].request.task_definition.requires_human_approval,logical_sequence:1
 });
 const policy=buildExecutionAuthorizationPolicy({authorization_policy_id:'policy-same-run'});
 const scope=buildExecutionAuthorizationScope({
  scope_id:'scope-same-run',tenant_id:p.tenant_id,organization_id:p.organization_id,
  allowed_agent_ids:[p.agent_id],allowed_project_ids:[p.project_id],allowed_session_reference_ids:[p.session_reference_id],
  allowed_plan_ids:[p.plan_id],allowed_actor_ids:['actor-same-run'],allowed_actor_roles:['MANAGER'],
  allowed_task_types:[plannerFixture.scenarios['no-llm-plan'].request.task_definition.task_type],allowed_risk_classifications:['LOW'],
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

 const plannerRequest=structuredClone(plannerFixture.scenarios['no-llm-plan'].request);
 const stageRecords=out.stages.map((stage)=>buildStageRecord(stage));
 const stageManifest=buildOrchestratorStageManifestReference({
  stage_manifest_reference_id:'stage-manifest-same-run',planning_result_id:p.planning_result_id,
  orchestration_plan_id:p.plan_id,tenant_id:p.tenant_id,organization_id:p.organization_id,
  project_id:p.project_id,session_reference_id:p.session_reference_id,agent_id:p.agent_id,
  stage_records:stageRecords,logical_sequence:3
 });
 const dependencyRecords=out.dependencies.map((dependency)=>buildDependencyRecord(dependency));
 const dependencyGraph=buildExecutionPlanDependencyGraphReference({
  dependency_graph_reference_id:'dependency-graph-same-run',execution_plan_id:p.plan_id,
  planning_result_id:p.planning_result_id,orchestration_plan_id:p.plan_id,tenant_id:p.tenant_id,
  organization_id:p.organization_id,project_id:p.project_id,session_reference_id:p.session_reference_id,
  stage_ids:p.stage_ids,dependency_records:dependencyRecords,logical_sequence:3
 });
 const planBudget=buildExecutionPlanBudget({
  execution_budget_id:'execution-budget-same-run',execution_plan_id:p.plan_id,
  budget_authorization_id:authBudget.budget_authorization_id,maximum_total_tokens:authBudget.maximum_authorized_tokens,
  estimated_total_tokens:p.estimated_total_tokens,maximum_input_tokens:10000,estimated_input_tokens:stageRecords.reduce((n,x)=>n+x.estimated_input_tokens,0),
  maximum_output_tokens:10000,estimated_output_tokens:stageRecords.reduce((n,x)=>n+x.estimated_output_tokens,0),
  maximum_total_cost_minor_units:authBudget.maximum_authorized_cost_minor_units,
  estimated_total_cost_minor_units:p.estimated_total_cost_minor_units,reserved_memory_tokens:0,reserved_context_tokens:0,
  reserved_output_tokens:0,maximum_model_stages:10,maximum_tool_stages:10,maximum_workflow_stages:10,
  maximum_parallel_stages:10,maximum_attempts_reference:1
 });
 const idempotency=buildExecutionPlanIdempotency({
  idempotency_reference_id:'idempotency-same-run',execution_plan_id:p.plan_id,
  authorization_decision_id:auth.decision.authorization_decision_id,tenant_id:p.tenant_id,
  organization_id:p.organization_id,project_id:p.project_id,session_reference_id:p.session_reference_id,
  idempotency_key_reference:'same-run-e2e-key',request_fingerprint:auth.decision.request_fingerprint,
  plan_fingerprint:p.plan_fingerprint,expected_execution_attempt:0,maximum_execution_attempts:1,
  replay_allowed:false,idempotency_validated:true
 });
 const stopConditions=stageRecords.map((stage,index)=>buildExecutionPlanStopCondition({
  stop_condition_id:'stop-same-run-'+index,execution_plan_id:p.plan_id,execution_stage_id:stage.stage_id,
  condition_type:'BUDGET_EXCEEDED_REFERENCE',condition_priority:index,blocking:true,terminal:false,
  evaluation_reference_id:'budget-evaluator-same-run'
 }));
 const scopeRef=buildAuthorizationScopeReference({
  authorization_scope_reference_id:'scope-ref-same-run',authorization_scope_id:scope.scope_id,
  authorization_decision_id:auth.decision.authorization_decision_id,tenant_id:p.tenant_id,
  organization_id:p.organization_id,project_id:p.project_id,session_reference_id:p.session_reference_id,
  agent_id:p.agent_id,actor_id:actor.actor_id,actor_role:actor.actor_role,allowed_plan_ids:[p.plan_id],
  allowed_task_reference_ids:[task.task_reference_id],allowed_agent_ids:[p.agent_id],
  allowed_model_reference_ids:[...new Set(stageRecords.map(x=>x.model_selection_reference_id).filter(Boolean))].sort(),
  allowed_tool_reference_ids:[...new Set(stageRecords.flatMap(x=>x.tool_reference_ids||[]))].sort(),allowed_workflow_reference_ids:[...new Set(stageRecords.map(x=>x.workflow_reference_id).filter(Boolean))].sort(),
  allowed_capability_types:[],allowed_stage_types:[...new Set(stageRecords.map(x=>x.stage_type))].sort(),
  allowed_risk_classifications:[task.risk_classification],maximum_authorized_tokens:authBudget.maximum_authorized_tokens,
  maximum_authorized_cost_minor_units:authBudget.maximum_authorized_cost_minor_units,scope_validated:true
 });
 const provenance=buildAuthorizationProvenanceReference({
  authorization_provenance_reference_id:'provenance-same-run',authorization_decision_id:auth.decision.authorization_decision_id,
  authorization_request_id:authRequest.authorization_request_id,authorization_policy_id:policy.authorization_policy_id,
  authorization_scope_id:scope.scope_id,actor_id:actor.actor_id,actor_role:actor.actor_role,
  approval_reference_id:authApproval.approval_reference_id,budget_authorization_id:authBudget.budget_authorization_id,
  expiration_evaluation_id:expiration.expiration_evaluation_id,planning_result_id:p.planning_result_id,plan_id:p.plan_id,
  task_reference_id:task.task_reference_id,agent_id:p.agent_id,tenant_id:p.tenant_id,organization_id:p.organization_id,
  project_id:p.project_id,session_reference_id:p.session_reference_id,
  authorization_decision_fingerprint:stablePayload(auth.decision),
  authorization_request_fingerprint:auth.decision.request_fingerprint,
  authorization_policy_fingerprint:stablePayload(policy),authorization_scope_fingerprint:scopeRef.scope_fingerprint,
  actor_fingerprint:actor.actor_fingerprint,approval_fingerprint:authApproval.approval_fingerprint,
  budget_authorization_fingerprint:planBudget.budget_fingerprint,expiration_fingerprint:auth.decision.expiration_fingerprint,
  planning_result_fingerprint:p.planning_result_fingerprint,orchestration_plan_fingerprint:p.plan_fingerprint,
  task_fingerprint:task.task_fingerprint,logical_sequence:3,provenance_validated:true
 });
 const executionRequest=assembleExecutionPlanRequest({
  authorization_result:auth,execution_plan_request_id:'execution-plan-request-same-run',
  orchestrator_decision_reference:decisionRef,readiness_evidence_bundle_reference:bundleRef,
  planning_result_reference:p,orchestration_plan_reference:plan,task_reference:task,
  memory_selection_reference:plannerRequest.memory_selection_decision_reference,
  context_assembly_reference:plannerRequest.context_assembly_result_reference,
  model_selection_reference:plannerRequest.model_selection_decision_reference,
  tool_decision_references:plannerRequest.tool_decision_references,workflow_decision_reference:plannerRequest.workflow_decision_reference,
  execution_plan_policy_reference:buildExecutionPlanPolicyReference({policy_reference_id:'execution-policy-same-run'}),
  execution_plan_budget:planBudget,idempotency_policy_reference:idempotency,stop_condition_references:stopConditions,
  compensation_references:[],dependency_graph_reference:dependencyGraph,stage_manifest_reference:stageManifest,
  authorization_provenance_reference:provenance,authorization_scope_reference:scopeRef,
  registry_snapshot_seed:{registry_snapshot_reference_id:'snapshot-same-run',observed_registry_version:plannerRequest.expected_registry_version,
   registry_entity_versions:{execution_plan_request:1,stage_manifest:1,dependency_graph:1,provenance:1,scope:1,execution_plan_budget:1,idempotency_policy:1},
   snapshot_validated:true,logical_sequence:3},
  correlation_id:plannerRequest.correlation_id,causation_id:plannerRequest.causation_id,trace_id:plannerRequest.trace_id,
  logical_sequence:3,expected_registry_version:plannerRequest.expected_registry_version,simulation_context:plannerRequest.simulation_context
 });
 const execution=evaluateExecutionPlanRequest(executionRequest,{});
 assert.equal(execution.result.execution_authorized,false);
 assert.equal(execution.result.executed,false);
 assert.equal(execution.result.production_blocked,true);
 assert.equal(execution.result.status,'EXECUTION_PLAN_PREPARED_SIMULATION');
 assert.notEqual(execution.result.status,'VALIDATION_FAILED');
 assert.notEqual(execution.result.status,'REGISTRY_BLOCKED');

 // The gateway receives the exact plan/result produced above in this same run. Architecture/CI
 // evidence is external by design, but is bound to the previously verified PR revision/run.
 const gatewayBindingLedger=execution.bindingLedger;
 assert.equal(gatewayBindingLedger.binding_ledger_id,execution.plan.binding_ledger_id);
 assert.equal(gatewayBindingLedger.ledger_fingerprint,execution.plan.binding_ledger_fingerprint);
 const ciEvidence=assembleArchitectureGateEvidenceFromCi({
  architecture_gate_evidence_reference_id:execution.plan.execution_plan_id+'-verified-ci',repository_id:'repo-agente-grupo-erick',
  repository_full_name:'instutodp-cpu/agente-grupo-erick',default_branch:'main',commit_sha:'da8aa2e955814a40e27a1e5d7a23d64993d9020e',
  head_commit_sha:'da8aa2e955814a40e27a1e5d7a23d64993d9020e',base_commit_sha:'043f2a80cf97ed1099fdf139ab0254e39fd5e13c',
  workflow_id:'hermes-core-smoke',workflow_name:'Hermes Core smoke test',workflow_version:'v1',workflow_run_id:'37227297250',workflow_run_attempt:1,
  workflow_run_status:'COMPLETED',workflow_run_conclusion:'SUCCESS',trigger_type:'PULL_REQUEST_REFERENCE',ruleset_id:'hermes-core-smoke',ruleset_version:'1',
  gates:[{gate_result_id:'hermes-core-smoke-da8aa2e',gate_id:'HERMES_CORE_SMOKE',gate_version:'v1',status:'PASSED',severity:'CRITICAL',required:true}],
  evidence_created_logical_sequence:4,maximum_valid_sequences:1000,current_logical_sequence:4
 });
 const freshness=buildExecutionGatewayFreshnessReference({freshness_reference_id:execution.plan.execution_plan_id+'-freshness',
  execution_plan_id:execution.plan.execution_plan_id,authorization_decision_id:execution.plan.authorization_decision_id,
  registry_snapshot_reference_id:executionRequest.registry_snapshot_reference.registry_snapshot_reference_id,
  architecture_gate_evidence_reference_id:ciEvidence.architecture_gate_evidence_reference_id,created_logical_sequence:4,current_logical_sequence:4,maximum_valid_sequences:1000});
 const gatewayRequestId=execution.plan.execution_plan_id+'-gateway-request';
 const replay=buildExecutionGatewayReplayReference({gateway_replay_reference_id:execution.plan.execution_plan_id+'-replay',
  execution_plan_id:execution.plan.execution_plan_id,execution_plan_fingerprint:execution.plan.plan_fingerprint,gateway_request_id:gatewayRequestId,
  gateway_request_fingerprint:'same-run-gateway-request-fingerprint',idempotency_reference_id:idempotency.idempotency_reference_id,
  idempotency_fingerprint:idempotency.idempotency_fingerprint,expected_gateway_attempt:1,maximum_gateway_attempts:1,
  prior_gateway_decision_ids:[],prior_gateway_decision_fingerprints:[]});
 const gatewayAuthDecision={...auth.decision};
 const gatewayDigest=computeGatewayPackageDigest({plan:execution.plan,result:execution.result,authorizationDecision:gatewayAuthDecision,
  provenanceReference:provenance,scopeReference:scopeRef,snapshotReference:executionRequest.registry_snapshot_reference,
  stageManifestReference:stageManifest,dependencyGraphReference:dependencyGraph,bindingLedger:gatewayBindingLedger,
  validationLedger:execution.validationLedger,evidenceReference:ciEvidence});
 const gatewayPackage=buildExecutionGatewayPackageReference({gateway_package_reference_id:execution.plan.execution_plan_id+'-gateway-package',
  execution_plan_id:execution.plan.execution_plan_id,execution_plan_request_id:executionRequest.execution_plan_request_id,execution_plan_result_id:execution.result.result_id,
  authorization_decision_id:execution.plan.authorization_decision_id,authorization_provenance_reference_id:provenance.authorization_provenance_reference_id,
  authorization_scope_reference_id:scopeRef.authorization_scope_reference_id,registry_snapshot_reference_id:executionRequest.registry_snapshot_reference.registry_snapshot_reference_id,
  stage_manifest_reference_id:stageManifest.stage_manifest_reference_id,dependency_graph_reference_id:dependencyGraph.dependency_graph_reference_id,
  binding_ledger_id:gatewayBindingLedger.binding_ledger_id,validation_ledger_id:execution.validationLedger.validation_ledger_id,
  architecture_gate_evidence_reference_id:ciEvidence.architecture_gate_evidence_reference_id,tenant_id:p.tenant_id,organization_id:p.organization_id,
  project_id:p.project_id,session_reference_id:p.session_reference_id,agent_id:p.agent_id,actor_id:actor.actor_id,
  execution_plan_status:execution.plan.execution_plan_status,execution_plan_result_status:execution.result.status,
  execution_plan_fingerprint:execution.plan.plan_fingerprint,execution_plan_result_fingerprint:execution.result.execution_plan_fingerprint,
  authorization_fingerprint:stablePayload(gatewayAuthDecision),authorization_provenance_fingerprint:execution.plan.authorization_provenance_fingerprint,
  authorization_scope_fingerprint:execution.plan.authorization_scope_fingerprint,registry_snapshot_fingerprint:execution.plan.registry_snapshot_fingerprint,
  stage_manifest_fingerprint:execution.plan.stage_manifest_fingerprint,dependency_graph_fingerprint:dependencyGraph.graph_fingerprint,
  binding_ledger_fingerprint:gatewayBindingLedger.ledger_fingerprint,validation_ledger_fingerprint:execution.validationLedger.ledger_fingerprint,
  architecture_gate_evidence_fingerprint:ciEvidence.evidence_fingerprint,package_digest:gatewayDigest});
 const gatewayRequest=buildExecutionGatewayRequest({gateway_request_id:gatewayRequestId,gateway_policy:buildExecutionGatewayPolicy({gateway_policy_id:'gateway-policy-same-run'}),
  gateway_package_reference:gatewayPackage,execution_plan_reference:execution.plan,execution_plan_result_reference:execution.result,
  authorization_decision_reference:gatewayAuthDecision,authorization_provenance_reference:provenance,authorization_scope_reference:scopeRef,
  registry_snapshot_reference:executionRequest.registry_snapshot_reference,stage_manifest_reference:stageManifest,dependency_graph_reference:dependencyGraph,
  binding_ledger_reference:gatewayBindingLedger,validation_ledger_reference:execution.validationLedger,architecture_gate_evidence_reference:ciEvidence,
  freshness_reference:freshness,replay_reference:replay,correlation_id:plannerRequest.correlation_id,causation_id:plannerRequest.causation_id,
  trace_id:plannerRequest.trace_id,logical_sequence:4,expected_gateway_registry_version:1,simulation_context:plannerRequest.simulation_context});
 const gateway=evaluateExecutionGatewayRequest(gatewayRequest,{});
 assert.equal(gateway.decision.status,'GATEWAY_ACCEPTED_SIMULATION');
 assert.equal(gateway.decision.gateway_accepted_in_simulation,true);
 assert.equal(gateway.decision.execution_authorized,false);
 assert.equal(gateway.decision.executed,false);
 assert.equal(gateway.decision.production_blocked,true);
 assert.equal(ciEvidence.workflow_run_reference.workflow_run_id,'37227297250');
 const runtimeAssembly=assembleGatewayRuntimeSimulationRequest({
  executionPlanRequest:executionRequest,executionOutcome:execution,gatewayOutcome:gateway,gatewayPackageReference:gatewayPackage,
  stageManifestReference:stageManifest,dependencyGraphReference:dependencyGraph,authorizationProvenanceReference:provenance,
  authorizationScopeReference:scopeRef,registrySnapshotReference:executionRequest.registry_snapshot_reference
 });
 const runtime=evaluateRuntimeExecutionSimulationRequest(runtimeAssembly.runtimeRequest,{});
 assert.equal(runtime.runtimePackage.runtime_status,'RUNTIME_PACKAGE_PREPARED_SIMULATION');
 assert.equal(runtime.runtimePackage.runtime_enabled,false);
 assert.equal(runtime.runtimePackage.execution_authorized,false);
 assert.equal(runtime.runtimePackage.execution_started,false);
 assert.equal(runtime.runtimePackage.executed,false);
 assert.equal(runtime.runtimePackage.production_blocked,true);
 const readinessBase=assembleRuntimeReadinessRequest({executionPlanRequest:executionRequest,executionOutcome:execution,gatewayOutcome:gateway,gatewayPackageReference:gatewayPackage,architectureGateEvidenceReference:ciEvidence,runtimeAssembly,runtimeOutcome:runtime});
 const provisionalReplay=readinessBase.buildReplay(readinessBase.readinessRequestFingerprint,'sha256:'+('0'.repeat(64)));
 const provisionalReadinessRequest=readinessBase.buildReadinessRequestWithReplay(provisionalReplay);
 const provisionalReadiness=evaluateRuntimeReadinessRequest(provisionalReadinessRequest,{});
 assert.equal(provisionalReadiness.decision.status,'RUNTIME_READY_SIMULATION');
 const admissionAssembly=assembleRuntimeAdmissionRequest(readinessBase,provisionalReadiness);
 const readiness=evaluateRuntimeReadinessRequest(admissionAssembly.readinessRequest,{});
 assert.equal(readiness.decision.status,'RUNTIME_READY_SIMULATION');
 const finalAdmissionAssembly=assembleRuntimeAdmissionRequest(readinessBase,readiness);
 const admission=evaluateRuntimeAdmissionRequest(finalAdmissionAssembly.admissionRequest,{});
 assert.equal(admission.decision.status,'RUNTIME_ADMITTED_SIMULATION');
 assert.equal(admission.decision.execution_authorized,false);
 assert.equal(admission.decision.execution_started,false);
 assert.equal(admission.decision.executed,false);
 assert.equal(admission.decision.production_blocked,true);
});
