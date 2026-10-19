'use strict';
// Synthetic data for unit tests ONLY. Never use this adapter in an operational runtime.
const {RECORD_VERSION,expectedDigest}=require('../../src/core/hermes-maintainer-a3-mission-source-verification');
function recordFor(input,override={}){
 const a=input.source_evidence.single_use_authorization,g=input.source_evidence.authorization_grant;
 const base={
  contract_version:RECORD_VERSION,source:'MISSION_GATEWAY_DURABLE',status:'STAGING_SIMULATION_RECONCILED',
  mission_run_id:'unit-test-mission-run',mission_id:a.mission_id,environment:'staging',
  workflow_operation:input.operation==='update_file'?'code_edit_prepare':'pull_request_prepare',
  operation:input.operation,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',
  branch_name:input.target_reference.branch_name,target_digest:input.target_reference.target_digest,
  intent_digest:input.action_intent_digest,
  approval_reference:input.source_evidence.approval_binding.approval_reference,
  authorization_reference:g.authorization_reference,single_use_authorization_id:a.authorization_id,
  single_use_fingerprint:a.authorization_fingerprint,
  simulation_receipt_digest:'sha256:'+'1'.repeat(64),workflow_digest:'sha256:'+'2'.repeat(64),
  authorization_binding_digest:'sha256:'+'3'.repeat(64),staging_gate_fingerprint:'sha256:'+'4'.repeat(64),
  simulation_effect:'ZERO',durably_confirmed:true,executed:false,production_used:false,
  merge_authority:false,human_merge_required:true,blockers:[],record_digest:null,...override
 };
 base.record_digest=expectedDigest(base);
 return base;
}
function readFor(input){return async query=>{
 if(query.mission_id!==input.source_evidence.single_use_authorization.mission_id||
   query.operation!==input.operation||query.repository!=='instutodp-cpu/agente-grupo-erick'||query.environment!=='staging')return null;
 return recordFor(input);
};}
module.exports={recordFor,readFor};
