'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { READY: DURABLE_TARGET_READY, validateHermesMaintainerSafeWorkflowDurableTarget } = require('./hermes-maintainer-safe-workflow-durable-target');
const { AUTHORIZED: MAINTAINER_AUTHORIZED, validateHermesMaintainerSingleUseAuthorization } = require('./hermes-maintainer-single-use-execution-authorization');

// A3 is eligibility only. Every supported operation consumes its existing official human
// approval + authorization + single-use + durable-target evidence. Adding another operation
// requires an explicit schema/validator branch and tests; generic authority is never accepted.
const CONTRACT_VERSION='hermes_a3_scoped_external_action_eligibility_v3';
const ELIGIBLE='A3_SCOPED_EXTERNAL_ACTION_ELIGIBLE';
const BLOCKED='A3_SCOPED_EXTERNAL_ACTION_BLOCKED';
const SOURCE_FAMILY='MAINTAINER_SCM_WRITE_SINGLE_USE_V1';
const CAPABILITY_ID='hermes-maintainer-scm-write';
const TARGET_TYPE='SCM_WRITE_TARGET';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const BASE_REF='main';
const OPERATIONS=Object.freeze(['create_branch','update_file','create_pull_request']);

const INPUT_FIELDS=Object.freeze(['eligibility_id','capability_id','environment','operation','target_reference','action_intent_digest','operator_binding','source_evidence','cost_control','protected_actions','evaluation_time']);
const OPERATOR_FIELDS=Object.freeze(['operator_id','source_reference','identity_verified','scope_verified','operator_binding_digest']);
const SOURCE_EVIDENCE_FIELDS=Object.freeze(['family','approval_binding','authorization_grant','single_use_authorization','durable_target']);
const COST_FIELDS=Object.freeze(['requested_units','maximum_units']);
const PROTECTED_ACTION_FIELDS=Object.freeze(['merge_main','production_publish','financial_spend','customer_message','destructive_action','secret_or_permission_change']);
const SINGLE_USE_AUTHORIZATION_FIELDS=Object.freeze(['contract_version','authorization_id','mission_id','operation','repository','base_ref','issued_at','expires_at','environment','single_use','status','execution_authorized','consumed','revoked','authorization_fingerprint','production_allowed','executed','blockers']);
const DURABLE_TARGET_FIELDS=Object.freeze(['contract_version','mission_id','workflow_digest','intent_digest','authorization_binding_digest','durable_operation','target_handoff_contract','ownership_key','attempt_reference','status','target_prepared','target','execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','human_merge_required','simulation','production_allowed','provider_called','secret_accessed','operational_authority_consumed','blockers']);

const TARGET_FIELDS=Object.freeze({
 create_branch:Object.freeze(['target_type','repository','base_ref','base_sha','branch_name','target_digest']),
 update_file:Object.freeze(['target_type','repository','base_ref','branch_name','path','current_blob_sha','content_digest','message_digest','target_digest']),
 create_pull_request:Object.freeze(['target_type','repository','base_ref','branch_name','draft','title_digest','body_digest','target_digest'])
});
const APPROVAL_FIELDS=Object.freeze({
 create_branch:Object.freeze(['contract_version','status','approval_valid','intent_digest','operation','repository','base_ref','branch_name','approval_reference','human_approval_required','human_approval_present','execution_authorized','credential_material_present','network_call_performed','write_performed','production_used','blockers']),
 update_file:Object.freeze(['contract_version','status','approval_valid','intent_digest','operation','repository','base_ref','branch_name','path','current_blob_sha','content_digest','message_digest','approval_reference','human_approval_required','human_approval_present','execution_authorized','credential_material_present','network_call_performed','write_performed','production_used','blockers']),
 create_pull_request:Object.freeze(['contract_version','status','approval_valid','intent_digest','operation','repository','base_ref','branch_name','base','head','draft','title_digest','body_digest','approval_reference','human_approval_required','human_approval_present','execution_authorized','credential_material_present','network_call_performed','write_performed','production_used','blockers'])
});
const GRANT_FIELDS=Object.freeze({
 create_branch:Object.freeze(['contract_version','status','authorization_valid','intent_digest','operation','repository','base_ref','branch_name','approval_reference','authorization_reference','human_approval_present','execution_authorized','authorization_consumed','credential_material_present','network_call_performed','write_performed','production_used','blockers']),
 update_file:Object.freeze(['contract_version','status','authorization_valid','intent_digest','operation','repository','base_ref','branch_name','path','current_blob_sha','content_digest','message_digest','approval_reference','authorization_reference','human_approval_present','execution_authorized','authorization_consumed','credential_material_present','network_call_performed','write_performed','production_used','blockers']),
 create_pull_request:Object.freeze(['contract_version','status','authorization_valid','intent_digest','operation','repository','base_ref','branch_name','base','head','draft','title_digest','body_digest','approval_reference','authorization_reference','human_approval_present','execution_authorized','authorization_consumed','credential_material_present','network_call_performed','write_performed','production_used','blockers'])
});
const DURABLE_TARGET_VALUE_FIELDS=Object.freeze({
 create_branch:Object.freeze(['operation','repository','base_ref','base_sha','branch_name']),
 update_file:Object.freeze(['operation','repository','branch']),
 create_pull_request:Object.freeze(['operation','repository','base','head','draft'])
});
const APPROVAL_CONTRACT=Object.freeze({create_branch:'hermes_maintainer_scm_write_approval_binding_v1',update_file:'hermes_maintainer_github_update_file_approval_binding_v2',create_pull_request:'hermes_maintainer_github_create_pull_request_approval_binding_v2'});
const APPROVAL_STATUS=Object.freeze({create_branch:'SCM_WRITE_APPROVAL_BOUND',update_file:'GITHUB_UPDATE_FILE_APPROVAL_BOUND',create_pull_request:'GITHUB_CREATE_PULL_REQUEST_APPROVAL_BOUND'});
const HANDOFF_CONTRACT=Object.freeze({create_branch:'hermes_maintainer_scm_write_durable_admission_handoff_v1',update_file:'hermes_maintainer_github_update_file_durable_admission_handoff_v1',create_pull_request:'hermes_maintainer_github_create_pull_request_durable_admission_handoff_v1'});

const IDENTIFIER_PATTERN=/^[^\u0000-\u001f\u007f\s]{1,255}$/u;
const TIMESTAMP_PATTERN=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE_TARGET_TOKEN_PATTERN=/[*?\[\]{}]/;
const SHA_PATTERN=/^[a-f0-9]{40}$/;
const BRANCH_PATTERN=/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/;

function isIdentifier(v){return typeof v==='string'&&IDENTIFIER_PATTERN.test(v);}
function isCanonicalTimestamp(v){if(typeof v!=='string'||!TIMESTAMP_PATTERN.test(v))return false;const p=Date.parse(v);return Number.isFinite(p)&&new Date(p).toISOString()===v;}
function digest(v){return computeCanonicalContentDigest(JSON.parse(stablePayload(v)));}
function safeBranch(v){return isNonEmptyString(v)&&BRANCH_PATTERN.test(v)&&!v.includes('..')&&!UNSAFE_TARGET_TOKEN_PATTERN.test(v);}
function safePath(v){return typeof v==='string'&&v.length>0&&v.length<=240&&!v.startsWith('/')&&!v.includes('..')&&!v.includes('\\')&&!v.split('/').some(p=>p===''||p==='.'||p==='..');}
function inferTargetOperation(target){if(SHA_PATTERN.test(target?.base_sha||''))return'create_branch';if(isNonEmptyString(target?.path))return'update_file';if(target?.draft===true)return'create_pull_request';return null;}
function targetMaterial(target,operation=inferTargetOperation(target)){
 if(operation==='create_branch')return{target_type:target.target_type,repository:target.repository,base_ref:target.base_ref,base_sha:target.base_sha,branch_name:target.branch_name};
 if(operation==='update_file')return{target_type:target.target_type,repository:target.repository,base_ref:target.base_ref,branch_name:target.branch_name,path:target.path,current_blob_sha:target.current_blob_sha,content_digest:target.content_digest,message_digest:target.message_digest};
 if(operation==='create_pull_request')return{target_type:target.target_type,repository:target.repository,base_ref:target.base_ref,branch_name:target.branch_name,draft:target.draft,title_digest:target.title_digest,body_digest:target.body_digest};
 return{target_type:target?.target_type,repository:target?.repository};
}
function computeA3TargetDigest(target,operation){return digest(targetMaterial(target,operation));}
function computeA3OperatorBindingDigest(binding){const{operator_binding_digest:ignored,...material}=binding;return digest(material);}
function exactSourceFields(value,fields,prefix,errors){exactFields(value,fields,prefix,errors);if(!Array.isArray(value?.blockers))errors.push(`${prefix}_blockers_invalid`);}

function validateApprovalBinding(binding,operation,errors){
 const fields=APPROVAL_FIELDS[operation];if(!fields){errors.push('approval_binding_operation_not_supported');return;}exactSourceFields(binding,fields,'approval_binding',errors);
 if(binding?.contract_version!==APPROVAL_CONTRACT[operation])errors.push('approval_binding_contract_invalid');
 if(binding?.status!==APPROVAL_STATUS[operation]||binding?.approval_valid!==true)errors.push('approval_binding_not_approved');
 if(!isCanonicalContentDigest(binding?.intent_digest))errors.push('approval_binding_intent_digest_invalid');
 for(const f of ['operation','repository','base_ref','branch_name','approval_reference'])if(!isNonEmptyString(binding?.[f]))errors.push(`approval_binding_${f}_invalid`);
 if(binding?.operation!==operation||binding?.repository!==REPOSITORY||binding?.base_ref!==BASE_REF||!safeBranch(binding?.branch_name))errors.push('approval_binding_scope_invalid');
 if(operation==='update_file'&&(!safePath(binding?.path)||!SHA_PATTERN.test(binding?.current_blob_sha||'')||!isCanonicalContentDigest(binding?.content_digest)||!isCanonicalContentDigest(binding?.message_digest)))errors.push('approval_binding_payload_invalid');
 if(operation==='create_pull_request'&&(binding?.base!==BASE_REF||binding?.head!==binding?.branch_name||binding?.draft!==true||!isCanonicalContentDigest(binding?.title_digest)||!isCanonicalContentDigest(binding?.body_digest)))errors.push('approval_binding_payload_invalid');
 if(binding?.human_approval_required!==true||binding?.human_approval_present!==true)errors.push('approval_binding_human_approval_required');
 if(binding?.execution_authorized!==false)errors.push('approval_binding_execution_authority_forbidden');
 for(const f of ['credential_material_present','network_call_performed','write_performed','production_used'])if(binding?.[f]!==false)errors.push(`approval_binding_${f}_must_be_false`);
 if(Array.isArray(binding?.blockers)&&binding.blockers.length!==0)errors.push('approval_binding_has_blockers');
}
function validateAuthorizationGrant(grant,approval,operation,errors){
 const fields=GRANT_FIELDS[operation];if(!fields){errors.push('authorization_grant_operation_not_supported');return;}exactSourceFields(grant,fields,'authorization_grant',errors);
 if(grant?.contract_version!=='hermes_maintainer_scm_write_authorization_grant_v1')errors.push('authorization_grant_contract_invalid');
 if(grant?.status!=='SCM_WRITE_AUTHORIZATION_GRANTED'||grant?.authorization_valid!==true)errors.push('authorization_grant_not_authorized');
 if(!isCanonicalContentDigest(grant?.intent_digest))errors.push('authorization_grant_intent_digest_invalid');
 for(const f of ['operation','repository','base_ref','branch_name','approval_reference','authorization_reference'])if(!isNonEmptyString(grant?.[f]))errors.push(`authorization_grant_${f}_invalid`);
 if(grant?.operation!==operation||grant?.repository!==REPOSITORY||grant?.base_ref!==BASE_REF||!safeBranch(grant?.branch_name))errors.push('authorization_grant_scope_invalid');
 if(grant?.intent_digest!==approval?.intent_digest)errors.push('approval_authorization_intent_mismatch');
 for(const f of ['operation','repository','base_ref','branch_name','approval_reference'])if(grant?.[f]!==approval?.[f])errors.push(`approval_authorization_${f}_mismatch`);
 if(operation==='update_file')for(const f of ['path','current_blob_sha','content_digest','message_digest'])if(grant?.[f]!==approval?.[f])errors.push(`approval_authorization_${f}_mismatch`);
 if(operation==='create_pull_request')for(const f of ['base','head','draft','title_digest','body_digest'])if(grant?.[f]!==approval?.[f])errors.push(`approval_authorization_${f}_mismatch`);
 if(grant?.human_approval_present!==true||grant?.execution_authorized!==true)errors.push('authorization_grant_state_invalid');
 if(grant?.authorization_consumed!==false)errors.push('authorization_grant_already_consumed');
 for(const f of ['credential_material_present','network_call_performed','write_performed','production_used'])if(grant?.[f]!==false)errors.push(`authorization_grant_${f}_must_be_false`);
 if(Array.isArray(grant?.blockers)&&grant.blockers.length!==0)errors.push('authorization_grant_has_blockers');
}
function validateSingleUseAuthorization(authorization,grant,evaluationTime,operation,errors){
 exactSourceFields(authorization,SINGLE_USE_AUTHORIZATION_FIELDS,'single_use_authorization',errors);const validation=validateHermesMaintainerSingleUseAuthorization(authorization);if(!validation.valid)errors.push(...validation.errors.map(e=>`single_use_authorization_invalid::${e}`));
 if(authorization?.status!==MAINTAINER_AUTHORIZED||authorization?.execution_authorized!==true)errors.push('single_use_authorization_not_authorized');
 if(authorization?.environment!=='staging'||authorization?.single_use!==true)errors.push('single_use_authorization_scope_invalid');if(authorization?.consumed!==false)errors.push('single_use_authorization_already_consumed');if(authorization?.revoked!==false)errors.push('single_use_authorization_revoked');if(authorization?.production_allowed!==false||authorization?.executed!==false)errors.push('single_use_authorization_execution_boundary_invalid');
 if(authorization?.operation!==operation||authorization?.operation!==grant?.operation)errors.push('authorization_chain_operation_mismatch');if(authorization?.repository!==grant?.repository)errors.push('authorization_chain_repository_mismatch');if(authorization?.base_ref!==BASE_REF||grant?.base_ref!==BASE_REF)errors.push('authorization_chain_base_ref_mismatch');
 if(isCanonicalTimestamp(evaluationTime)&&isCanonicalTimestamp(authorization?.expires_at)&&Date.parse(authorization.expires_at)<=Date.parse(evaluationTime))errors.push('single_use_authorization_expired');
}
function validateDurableTarget(durableTarget,approval,grant,targetReference,operation,errors){
 if(!isPlainObject(durableTarget)){errors.push('durable_target_must_be_object');return;}exactSourceFields(durableTarget,DURABLE_TARGET_FIELDS,'durable_target',errors);
 const target=durableTarget.target,fields=DURABLE_TARGET_VALUE_FIELDS[operation];if(!isPlainObject(target))errors.push('durable_target_value_must_be_object');else if(fields)exactFields(target,fields,'durable_target_value',errors);
 const validation=validateHermesMaintainerSafeWorkflowDurableTarget(durableTarget);if(!validation.valid)errors.push(...validation.errors.map(e=>`durable_target_invalid::${e}`));if(durableTarget?.status!==DURABLE_TARGET_READY||durableTarget?.target_prepared!==true)errors.push('durable_target_not_prepared');if(!isCanonicalContentDigest(durableTarget?.workflow_digest))errors.push('durable_target_workflow_digest_invalid');if(!isCanonicalContentDigest(durableTarget?.authorization_binding_digest))errors.push('durable_target_authorization_binding_digest_invalid');if(durableTarget?.intent_digest!==approval?.intent_digest||durableTarget?.intent_digest!==grant?.intent_digest)errors.push('durable_target_intent_mismatch');if(durableTarget?.durable_operation!==operation)errors.push('durable_target_operation_invalid');if(durableTarget?.target_handoff_contract!==HANDOFF_CONTRACT[operation])errors.push('durable_target_handoff_contract_invalid');if(target?.operation!==operation)errors.push('durable_target_value_operation_invalid');
 if(operation==='create_branch'){for(const f of ['repository','base_ref','base_sha','branch_name'])if(target?.[f]!==targetReference?.[f])errors.push(`durable_target_${f}_mismatch`);}
 else if(operation==='update_file'){if(target?.repository!==targetReference?.repository)errors.push('durable_target_repository_mismatch');if(target?.branch!==targetReference?.branch_name)errors.push('durable_target_branch_name_mismatch');}
 else if(operation==='create_pull_request'){if(target?.repository!==targetReference?.repository)errors.push('durable_target_repository_mismatch');if(target?.base!==targetReference?.base_ref)errors.push('durable_target_base_ref_mismatch');if(target?.head!==targetReference?.branch_name)errors.push('durable_target_branch_name_mismatch');if(target?.draft!==targetReference?.draft)errors.push('durable_target_draft_mismatch');}
 if(Array.isArray(durableTarget?.blockers)&&durableTarget.blockers.length!==0)errors.push('durable_target_has_blockers');
}
function validateTarget(target,operation,errors){
 const fields=TARGET_FIELDS[operation];if(!fields){errors.push('operation_not_supported');return;}exactFields(target,fields,'target_reference',errors);if(target?.target_type!==TARGET_TYPE)errors.push('target_type_not_supported');if(target?.repository!==REPOSITORY)errors.push('target_repository_invalid');if(target?.base_ref!==BASE_REF)errors.push('target_base_ref_invalid');if(!safeBranch(target?.branch_name))errors.push('target_branch_name_invalid');
 if(operation==='create_branch'&&!SHA_PATTERN.test(target?.base_sha||''))errors.push('target_base_sha_invalid');
 if(operation==='update_file'&&(!safePath(target?.path)||!SHA_PATTERN.test(target?.current_blob_sha||'')||!isCanonicalContentDigest(target?.content_digest)||!isCanonicalContentDigest(target?.message_digest)))errors.push('target_update_file_payload_invalid');
 if(operation==='create_pull_request'&&(target?.draft!==true||!isCanonicalContentDigest(target?.title_digest)||!isCanonicalContentDigest(target?.body_digest)))errors.push('target_create_pull_request_payload_invalid');
 if(!isCanonicalContentDigest(target?.target_digest))errors.push('target_digest_invalid');else{try{if(target.target_digest!==computeA3TargetDigest(target,operation))errors.push('target_digest_mismatch');}catch{errors.push('target_digest_material_invalid');}}
}
function validateTargetAuthorizationBinding(target,grant,operation,errors){
 for(const f of ['repository','base_ref','branch_name'])if(target?.[f]!==grant?.[f])errors.push(`target_${f}_not_bound_to_authorization_grant`);
 if(operation==='update_file')for(const f of ['path','current_blob_sha','content_digest','message_digest'])if(target?.[f]!==grant?.[f])errors.push(`target_${f}_not_bound_to_authorization_grant`);
 if(operation==='create_pull_request'){if(grant?.base!==target?.base_ref||grant?.head!==target?.branch_name||grant?.draft!==target?.draft)errors.push('target_pull_request_scope_not_bound_to_authorization_grant');for(const f of ['title_digest','body_digest'])if(target?.[f]!==grant?.[f])errors.push(`target_${f}_not_bound_to_authorization_grant`);}
}
function validateA3ScopedExternalActionEligibilityInput(input){
 const errors=[];if(!isPlainObject(input))return{valid:false,errors:['eligibility_input_must_be_object']};exactFields(input,INPUT_FIELDS,'eligibility_input',errors);const operation=input.operation;
 if(!isIdentifier(input.eligibility_id))errors.push('eligibility_id_invalid');if(input.capability_id!==CAPABILITY_ID)errors.push('capability_not_supported');if(input.environment!=='staging')errors.push('environment_must_be_staging');if(!OPERATIONS.includes(operation))errors.push('operation_not_supported');if(!isCanonicalTimestamp(input.evaluation_time))errors.push('evaluation_time_invalid');if(!isCanonicalContentDigest(input.action_intent_digest))errors.push('action_intent_digest_invalid');
 validateTarget(input.target_reference,operation,errors);
 exactFields(input.operator_binding,OPERATOR_FIELDS,'operator_binding',errors);if(!isIdentifier(input.operator_binding?.operator_id))errors.push('operator_id_invalid');if(!isIdentifier(input.operator_binding?.source_reference))errors.push('operator_source_reference_invalid');if(input.operator_binding?.identity_verified!==true)errors.push('operator_identity_not_verified');if(input.operator_binding?.scope_verified!==true)errors.push('operator_scope_not_verified');if(!isCanonicalContentDigest(input.operator_binding?.operator_binding_digest))errors.push('operator_binding_digest_invalid');else if(input.operator_binding.operator_binding_digest!==computeA3OperatorBindingDigest(input.operator_binding))errors.push('operator_binding_digest_mismatch');
 exactFields(input.source_evidence,SOURCE_EVIDENCE_FIELDS,'source_evidence',errors);if(input.source_evidence?.family!==SOURCE_FAMILY)errors.push('source_evidence_family_not_supported');const approval=input.source_evidence?.approval_binding,grant=input.source_evidence?.authorization_grant,singleUse=input.source_evidence?.single_use_authorization,durableTarget=input.source_evidence?.durable_target;
 validateApprovalBinding(approval,operation,errors);validateAuthorizationGrant(grant,approval,operation,errors);validateSingleUseAuthorization(singleUse,grant,input.evaluation_time,operation,errors);validateDurableTarget(durableTarget,approval,grant,input.target_reference,operation,errors);
 if(isCanonicalContentDigest(input.action_intent_digest)&&input.action_intent_digest!==approval?.intent_digest)errors.push('action_intent_not_bound_to_official_approval');if(input.operation!==approval?.operation||input.operation!==grant?.operation||input.operation!==singleUse?.operation)errors.push('operation_not_bound_to_authorization_chain');validateTargetAuthorizationBinding(input.target_reference,grant,operation,errors);if(input.target_reference?.repository!==singleUse?.repository||input.target_reference?.base_ref!==singleUse?.base_ref)errors.push('target_not_bound_to_single_use_authorization');
 exactFields(input.cost_control,COST_FIELDS,'cost_control',errors);if(!Number.isInteger(input.cost_control?.requested_units)||input.cost_control.requested_units<0)errors.push('requested_cost_units_invalid');if(!Number.isInteger(input.cost_control?.maximum_units)||input.cost_control.maximum_units<0)errors.push('maximum_cost_units_invalid');if(Number.isInteger(input.cost_control?.requested_units)&&Number.isInteger(input.cost_control?.maximum_units)&&input.cost_control.requested_units>input.cost_control.maximum_units)errors.push('cost_budget_exceeded');
 exactFields(input.protected_actions,PROTECTED_ACTION_FIELDS,'protected_actions',errors);for(const f of PROTECTED_ACTION_FIELDS)if(input.protected_actions?.[f]!==false)errors.push(`a4_boundary_forbidden::${f}`);try{stablePayload(input);}catch(error){errors.push(`eligibility_input_not_canonical::${error.message}`);}return{valid:errors.length===0,errors:uniqueSorted(errors)};
}
function evaluateA3ScopedExternalActionEligibility(input={}){const validation=validateA3ScopedExternalActionEligibilityInput(input),eligible=validation.valid;const result={contract_version:CONTRACT_VERSION,eligibility_id:isNonEmptyString(input.eligibility_id)?input.eligibility_id:null,status:eligible?ELIGIBLE:BLOCKED,a3_eligible:eligible,capability_id:input.capability_id===CAPABILITY_ID?CAPABILITY_ID:null,environment:input.environment==='staging'?'staging':null,operation:isNonEmptyString(input.operation)?input.operation:null,action_intent_digest:isCanonicalContentDigest(input.action_intent_digest)?input.action_intent_digest:null,approval_reference:isNonEmptyString(input.source_evidence?.approval_binding?.approval_reference)?input.source_evidence.approval_binding.approval_reference:null,authorization_reference:isNonEmptyString(input.source_evidence?.authorization_grant?.authorization_reference)?input.source_evidence.authorization_grant.authorization_reference:null,single_use_authorization_id:isNonEmptyString(input.source_evidence?.single_use_authorization?.authorization_id)?input.source_evidence.single_use_authorization.authorization_id:null,durable_target_contract:input.source_evidence?.durable_target?.contract_version==='hermes_maintainer_safe_workflow_durable_target_v1'?input.source_evidence.durable_target.contract_version:null,base_sha:SHA_PATTERN.test(input.target_reference?.base_sha||'')?input.target_reference.base_sha:null,single_use_required:true,authorization_consumed:input.source_evidence?.single_use_authorization?.consumed===true,authorization_revoked:input.source_evidence?.single_use_authorization?.revoked===true,execution_authorized:false,execution_started:false,executed:false,provider_invoked:false,external_network_called:false,production_allowed:false,a4_authority_granted:false,blockers:validation.valid?[]:validation.errors,eligibility_fingerprint:null};result.eligibility_fingerprint=digest({...result,eligibility_fingerprint:null});return cloneFrozen(result);}
module.exports={BLOCKED,CAPABILITY_ID,CONTRACT_VERSION,ELIGIBLE,OPERATIONS,PROTECTED_ACTION_FIELDS,SOURCE_FAMILY,TARGET_TYPE,computeA3OperatorBindingDigest,computeA3TargetDigest,evaluateA3ScopedExternalActionEligibility,validateA3ScopedExternalActionEligibilityInput};
