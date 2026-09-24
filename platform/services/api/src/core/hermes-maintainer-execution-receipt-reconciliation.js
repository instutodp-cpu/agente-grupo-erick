'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED, validateHermesMaintainerControlledExecution } = require('./hermes-maintainer-controlled-executor');

const CONTRACT_VERSION='hermes_maintainer_execution_receipt_reconciliation_v1';
const RECONCILED='MAINTAINER_EXECUTION_RECEIPT_RECONCILED_SIMULATION';
const BLOCKED='MAINTAINER_EXECUTION_RECEIPT_RECONCILIATION_BLOCKED';
function material(e){return{mission_id:e.mission_id,operation:e.operation,repository:e.repository,base_ref:e.base_ref,status:e.status,execution_prepared:e.execution_prepared,simulation:e.simulation};}
function buildHermesMaintainerExecutionReceipt(execution){
 const v=validateHermesMaintainerControlledExecution(execution),blockers=[...v.errors];
 if(v.valid&&(execution.status!==PREPARED||execution.execution_prepared!==true))blockers.push('controlled_execution_not_ready');
 if(v.valid&&(execution.executed!==false||execution.runtime_mutated!==false||execution.network_used!==false||execution.provider_called!==false||execution.secret_accessed!==false||execution.operational_authority_consumed!==false))blockers.push('unexpected_execution_effect');
 const u=uniqueSorted(blockers),ok=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:execution&&isNonEmptyString(execution.mission_id)?execution.mission_id:'mission_not_available',operation:execution&&isNonEmptyString(execution.operation)?execution.operation:'operation_not_available',repository:execution&&isNonEmptyString(execution.repository)?execution.repository:'repository_not_available',base_ref:execution&&isNonEmptyString(execution.base_ref)?execution.base_ref:'ref_not_available',source_execution_digest:ok?computeCanonicalContentDigest(material(execution)):null,status:ok?RECONCILED:BLOCKED,reconciled:ok,execution_observed:false,side_effect_observed:false,simulation:true,production_effect:'ZERO',blockers:Object.freeze(u)});
}
function validateHermesMaintainerExecutionReceipt(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['receipt_must_be_object']};if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.operation)||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref))e.push('identity_invalid');if(![RECONCILED,BLOCKED].includes(v.status)||v.reconciled!==(v.status===RECONCILED))e.push('status_invalid');if(v.reconciled&&!isCanonicalContentDigest(v.source_execution_digest))e.push('source_execution_digest_invalid');if(!v.reconciled&&v.source_execution_digest!==null)e.push('blocked_digest_must_be_null');if(v.execution_observed!==false||v.side_effect_observed!==false||v.simulation!==true||v.production_effect!=='ZERO')e.push('safety_boundary_invalid');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.reconciled&&v.blockers.length)e.push('reconciled_with_blockers');return{valid:e.length===0,errors:uniqueSorted(e)};
}
function verifyHermesMaintainerExecutionReceipt(execution,receipt){const e=[...validateHermesMaintainerControlledExecution(execution).errors,...validateHermesMaintainerExecutionReceipt(receipt).errors];if(!e.length){if(receipt.mission_id!==execution.mission_id||receipt.operation!==execution.operation||receipt.repository!==execution.repository||receipt.base_ref!==execution.base_ref)e.push('execution_identity_mismatch');if(receipt.source_execution_digest!==computeCanonicalContentDigest(material(execution)))e.push('source_execution_digest_mismatch');}return{valid:e.length===0,errors:uniqueSorted(e)};}
module.exports={BLOCKED,CONTRACT_VERSION,RECONCILED,buildHermesMaintainerExecutionReceipt,validateHermesMaintainerExecutionReceipt,verifyHermesMaintainerExecutionReceipt};
