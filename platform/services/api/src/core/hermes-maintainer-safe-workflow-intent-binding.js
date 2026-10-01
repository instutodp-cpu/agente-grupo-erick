'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED_STATUS: HANDOFF_PREPARED, validateHermesMaintainerSafeWorkflowHandoff } = require('./hermes-maintainer-safe-workflow-handoff');
const { PREPARED_STATUS: INTENT_PREPARED, validateHermesMaintainerExecutionIntent } = require('./hermes-maintainer-execution-intent-contract');
const { verifyHermesMaintainerExecutionIntentFingerprint } = require('./hermes-maintainer-execution-intent-fingerprint');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_intent_binding_v1';
const PREPARED='MAINTAINER_SAFE_WORKFLOW_INTENT_BINDING_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_INTENT_BINDING_BLOCKED';

function bindHermesMaintainerSafeWorkflowIntent(handoff,intent,fingerprint){
 const blockers=[],hv=validateHermesMaintainerSafeWorkflowHandoff(handoff),iv=validateHermesMaintainerExecutionIntent(intent),fv=verifyHermesMaintainerExecutionIntentFingerprint(intent,fingerprint);
 if(!hv.valid) blockers.push(...hv.errors.map(e=>`handoff::${e}`));
 if(!iv.valid) blockers.push(...iv.errors.map(e=>`intent::${e}`));
 if(!fv.valid) blockers.push(...fv.errors.map(e=>`fingerprint::${e}`));
 if(hv.valid&&(handoff.status!==HANDOFF_PREPARED||handoff.handoff_prepared!==true)) blockers.push('handoff_not_ready');
 if(iv.valid&&(intent.status!==INTENT_PREPARED||intent.ready!==true)) blockers.push('intent_not_ready');
 if(hv.valid&&iv.valid&&handoff.mission_id!==intent.mission_id) blockers.push('mission_id_mismatch');
 if(hv.valid&&iv.valid&&handoff.action_count!==intent.intent_count) blockers.push('action_intent_count_mismatch');
 const unique=uniqueSorted(blockers),prepared=unique.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,mission_id:prepared?handoff.mission_id:'mission_not_available',
  workflow_digest:prepared?handoff.workflow_digest:null,intent_digest:prepared?fingerprint.intent_digest:null,
  action_count:prepared?handoff.action_count:0,intent_count:prepared?intent.intent_count:0,
  status:prepared?PREPARED:BLOCKED,binding_prepared:prepared,
  execution_eligible:false,execution_authorized:false,authority_consumed:false,merge_authority:false,human_merge_required:true,
  simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,
  blockers:Object.freeze(unique)
 });
}

function validateHermesMaintainerSafeWorkflowIntentBinding(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['binding_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');
 if(![PREPARED,BLOCKED].includes(v.status)||v.binding_prepared!==(v.status===PREPARED))e.push('status_invalid');
 if(v.binding_prepared&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)))e.push('binding_identity_invalid');
 if(v.binding_prepared&&(!Number.isInteger(v.action_count)||v.action_count<1||v.action_count!==v.intent_count))e.push('binding_count_invalid');
 for(const f of ['execution_eligible','execution_authorized','authority_consumed','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');
 if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.binding_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PREPARED,bindHermesMaintainerSafeWorkflowIntent,validateHermesMaintainerSafeWorkflowIntentBinding};
