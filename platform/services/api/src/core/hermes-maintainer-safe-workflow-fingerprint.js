'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { validateHermesMaintainerSafeWorkflow } = require('./hermes-maintainer-safe-workflow-contract');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_fingerprint_v1';
const FIELDS=Object.freeze(['contract_version','mission_id','workflow_digest','action_count','merge_blocked','human_merge_required','simulation','production_blocked']);

function canonicalWorkflowPayload(workflow){
 return {contract_version:workflow.contract_version,mission_id:workflow.mission_id,status:workflow.status,ready:workflow.ready,actions:workflow.actions,merge_authority:workflow.merge_authority,human_merge_required:workflow.human_merge_required,blockers:workflow.blockers};
}
function buildHermesMaintainerSafeWorkflowFingerprint(workflow){
 const validation=validateHermesMaintainerSafeWorkflow(workflow);
 const blockers=[...validation.errors];
 if(validation.valid&&workflow.ready!==true) blockers.push('workflow_not_ready');
 const unique=uniqueSorted(blockers);
 if(unique.length) return Object.freeze({status:'MAINTAINER_SAFE_WORKFLOW_FINGERPRINT_BLOCKED',fingerprint:null,blockers:Object.freeze(unique),simulation:true,production_allowed:false});
 return Object.freeze({status:'MAINTAINER_SAFE_WORKFLOW_FINGERPRINT_PREPARED_SIMULATION',fingerprint:Object.freeze({contract_version:CONTRACT_VERSION,mission_id:workflow.mission_id,workflow_digest:computeCanonicalContentDigest(canonicalWorkflowPayload(workflow)),action_count:workflow.actions.length,merge_blocked:true,human_merge_required:true,simulation:true,production_blocked:true}),blockers:Object.freeze([]),simulation:true,production_allowed:false});
}
function validateHermesMaintainerSafeWorkflowFingerprint(value){
 const errors=[];
 if(!isPlainObject(value)) return {valid:false,errors:['fingerprint_must_be_object']};
 for(const k of Object.keys(value)) if(!FIELDS.includes(k)) errors.push(`fingerprint_unknown_field::${k}`);
 for(const k of FIELDS) if(!Object.prototype.hasOwnProperty.call(value,k)) errors.push(`fingerprint_missing_field::${k}`);
 if(value.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
 if(!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
 if(!isCanonicalContentDigest(value.workflow_digest)) errors.push('workflow_digest_invalid');
 if(!Number.isInteger(value.action_count)||value.action_count<1) errors.push('action_count_invalid');
 if(value.merge_blocked!==true) errors.push('merge_blocked_must_be_true');
 if(value.human_merge_required!==true) errors.push('human_merge_required_must_be_true');
 if(value.simulation!==true) errors.push('simulation_must_be_true');
 if(value.production_blocked!==true) errors.push('production_blocked_must_be_true');
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}
function verifyHermesMaintainerSafeWorkflowFingerprint(workflow,fingerprint){
 const fv=validateHermesMaintainerSafeWorkflowFingerprint(fingerprint),wv=validateHermesMaintainerSafeWorkflow(workflow),errors=[...fv.errors,...wv.errors];
 if(fv.valid&&wv.valid){
  if(workflow.ready!==true) errors.push('workflow_not_ready');
  if(fingerprint.mission_id!==workflow.mission_id) errors.push('mission_id_mismatch');
  if(fingerprint.action_count!==workflow.actions.length) errors.push('action_count_mismatch');
  if(fingerprint.workflow_digest!==computeCanonicalContentDigest(canonicalWorkflowPayload(workflow))) errors.push('workflow_digest_mismatch');
 }
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}
module.exports={CONTRACT_VERSION,FIELDS,canonicalWorkflowPayload,buildHermesMaintainerSafeWorkflowFingerprint,validateHermesMaintainerSafeWorkflowFingerprint,verifyHermesMaintainerSafeWorkflowFingerprint};
