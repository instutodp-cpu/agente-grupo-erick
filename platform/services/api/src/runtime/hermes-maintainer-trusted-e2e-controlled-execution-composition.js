'use strict';
const {CONTRACT_VERSION:REQUEST}=require('../core/hermes-maintainer-request-contract');
const {prepareHermesMaintainerPlan}=require('../core/hermes-maintainer-plan-contract');
const {buildHermesMaintainerPlanFingerprint}=require('../core/hermes-maintainer-plan-fingerprint');
const {prepareHermesMaintainerSteps}=require('../core/hermes-maintainer-step-contract');
const {admitHermesMaintainerSteps}=require('../core/hermes-maintainer-step-admission-contract');
const {buildHermesMaintainerStepAdmissionFingerprint}=require('../core/hermes-maintainer-step-admission-fingerprint');
const {prepareHermesMaintainerSafeWorkflow}=require('../core/hermes-maintainer-safe-workflow-contract');
const {buildHermesMaintainerSafeWorkflowFingerprint}=require('../core/hermes-maintainer-safe-workflow-fingerprint');
const {prepareHermesMaintainerSafeWorkflowHandoff}=require('../core/hermes-maintainer-safe-workflow-handoff');
const {prepareHermesMaintainerExecutionIntent}=require('../core/hermes-maintainer-execution-intent-contract');
const {buildHermesMaintainerExecutionIntentFingerprint}=require('../core/hermes-maintainer-execution-intent-fingerprint');
const {bindHermesMaintainerSafeWorkflowIntent}=require('../core/hermes-maintainer-safe-workflow-intent-binding');
const {buildHermesMaintainerExecutionAuthorizationRequest}=require('../core/hermes-maintainer-execution-authorization-request');
const {admitHermesMaintainerSafeWorkflowAuthorization}=require('../core/hermes-maintainer-safe-workflow-authorization-admission');
const {buildHermesMaintainerAuthorizationBinding}=require('../core/hermes-maintainer-authorization-binding');
const {bindHermesMaintainerSafeWorkflowAuthorization}=require('../core/hermes-maintainer-safe-workflow-authorization-binding');
const {buildHermesMaintainerExecutionHandoffAdapter}=require('../core/hermes-maintainer-execution-handoff-adapter');
const {bindHermesMaintainerSafeWorkflowExecutionHandoff}=require('../core/hermes-maintainer-safe-workflow-execution-handoff');
const {buildHermesMaintainerScmAdapterRequest}=require('../core/hermes-maintainer-scm-adapter-contract');
const {prepareHermesMaintainerControlledExecution}=require('../core/hermes-maintainer-controlled-executor');
const {bindHermesMaintainerSafeWorkflowControlledExecution}=require('../core/hermes-maintainer-safe-workflow-controlled-execution');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_controlled_execution_composition_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const ACTIONS=['repository_read','repository_code_search','ci_read','test_execution','branch_prepare','code_edit_prepare','pull_request_prepare'];
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_CONTROLLED_EXECUTION_BLOCKED',prepared:false,stage,value:value||null,controlled_executions:null,production_used:false,merge_authority:false,human_merge_required:true});}
function prepareHermesMaintainerTrustedE2eControlledExecutions(input={}){
 const mission=input.mission_id,branch=input.branch_name;
 if(typeof mission!=='string'||!mission.trim())return blocked('MISSION_ID_INVALID');
 if(typeof branch!=='string'||!/^hermes\/canary\//.test(branch))return blocked('BRANCH_SCOPE_INVALID');
 const requests=ACTIONS.map((action,index)=>({contract_version:REQUEST,request_id:mission+':'+(index+1),action,repository:REPOSITORY,base_ref:'main',target_ref:['branch_prepare','code_edit_prepare','pull_request_prepare'].includes(action)?branch:null,simulation:true,production_blocked:true}));
 const plan=prepareHermesMaintainerPlan({mission_id:mission,requests}); if(!plan.ready)return blocked('plan',plan);
 const steps=prepareHermesMaintainerSteps(plan,buildHermesMaintainerPlanFingerprint(plan).fingerprint); if(!steps.ready)return blocked('steps',steps);
 const stepAdmission=admitHermesMaintainerSteps(steps); if(!stepAdmission.admitted)return blocked('step_admission',stepAdmission);
 const workflow=prepareHermesMaintainerSafeWorkflow(stepAdmission); if(!workflow.ready)return blocked('safe_workflow',workflow);
 const workflowFp=buildHermesMaintainerSafeWorkflowFingerprint(workflow); if(!workflowFp.fingerprint)return blocked('workflow_fingerprint',workflowFp);
 const safeHandoff=prepareHermesMaintainerSafeWorkflowHandoff(workflow,workflowFp.fingerprint); if(!safeHandoff.handoff_prepared)return blocked('safe_handoff',safeHandoff);
 const intent=prepareHermesMaintainerExecutionIntent(stepAdmission,buildHermesMaintainerStepAdmissionFingerprint(stepAdmission).fingerprint); if(!intent.ready)return blocked('execution_intent',intent);
 const intentFp=buildHermesMaintainerExecutionIntentFingerprint(intent); if(!intentFp.fingerprint)return blocked('intent_fingerprint',intentFp);
 const intentBinding=bindHermesMaintainerSafeWorkflowIntent(safeHandoff,intent,intentFp.fingerprint); if(!intentBinding.binding_prepared)return blocked('intent_binding',intentBinding);
 const authRequest=buildHermesMaintainerExecutionAuthorizationRequest(intent,intentFp.fingerprint); if(!authRequest.authorization_requested)return blocked('authorization_request',authRequest);
 const authAdmission=admitHermesMaintainerSafeWorkflowAuthorization(intentBinding,authRequest); if(!authAdmission.admitted)return blocked('authorization_admission',authAdmission);
 const authBinding=buildHermesMaintainerAuthorizationBinding(authRequest); if(!authBinding.binding_prepared)return blocked('authorization_binding',authBinding);
 const safeBinding=bindHermesMaintainerSafeWorkflowAuthorization(authAdmission,authRequest,authBinding); if(!safeBinding.binding_prepared)return blocked('safe_authorization_binding',safeBinding);
 const handoff=buildHermesMaintainerExecutionHandoffAdapter(authRequest,authBinding); if(!handoff.handoff_prepared)return blocked('execution_handoff_adapter',handoff);
 const safeExecutionHandoff=bindHermesMaintainerSafeWorkflowExecutionHandoff(safeBinding,handoff); if(!safeExecutionHandoff.handoff_prepared)return blocked('safe_execution_handoff',safeExecutionHandoff);
 const output={};
 for(const [key,operation] of [['branch','branch_prepare'],['edit','code_edit_prepare'],['pull_request','pull_request_prepare']]){
  const scm=buildHermesMaintainerScmAdapterRequest({operation,repository:REPOSITORY,base_ref:'main'});
  const execution=prepareHermesMaintainerControlledExecution(handoff,scm);
  const controlled=bindHermesMaintainerSafeWorkflowControlledExecution(safeExecutionHandoff,execution);
  if(!controlled.execution_prepared)return blocked(key+'_controlled_execution',controlled);
  output[key]=controlled;
 }
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_CONTROLLED_EXECUTIONS_PREPARED',prepared:true,mission_id:mission,workflow_digest:safeExecutionHandoff.workflow_digest,intent_digest:safeExecutionHandoff.intent_digest,authorization_binding_digest:safeExecutionHandoff.authorization_binding_digest,controlled_executions:Object.freeze(output),production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eControlledExecutions};