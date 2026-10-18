'use strict';
const {stablePayload}=require('./agent-identity-contract');
const {validateA3ScopedExternalActionPreOwnershipInput,evaluateA3ScopedExternalActionEligibility,ELIGIBLE}=require('./a3-scoped-external-action-eligibility');
const SCM_OWNERSHIP='hermes_maintainer_scm_write_durable_ownership_binding_v1';
const VERSION='hermes_maintainer_a3_durable_ownership_admission_v1';
function pending(input){
 return input?.source_evidence?.durable_target===null&&validateA3ScopedExternalActionPreOwnershipInput(input).valid===true;
}
function hydrate(input,grant,ownership,{operation,attempt_reference,consumption_reference}={}){
 if(!pending(input)||input.operation!==operation||!ownership||ownership.contract_version!==SCM_OWNERSHIP||ownership.status!=='SCM_WRITE_DURABLE_OWNERSHIP_BOUND'||ownership.binding_valid!==true||ownership.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT'||ownership.intent_digest!==grant?.intent_digest||ownership.authorization_reference!==grant?.authorization_reference||ownership.attempt_reference!==attempt_reference||ownership.consumption_reference!==consumption_reference||ownership.ownership_key!==ownership.persistence_key+'::attempt-ownership')return null;
 const full=Object.freeze({...input,source_evidence:Object.freeze({...input.source_evidence,durable_target:ownership})});
 const decision=evaluateA3ScopedExternalActionEligibility(full);
 return decision.status===ELIGIBLE&&decision.a3_eligible===true&&decision.execution_authorized===false?full:null;
}
function evidenceForRuntime(pendingInput,admission){
 const full=admission?.a3_verified_evidence;if(!pending(pendingInput)||!full||typeof full!=='object')return null;
 const owner=full.source_evidence?.durable_target;
 if(!owner||owner.contract_version!==SCM_OWNERSHIP||owner.ownership_key!==admission.ownership_key||owner.persistence_key!==admission.persistence_key||owner.attempt_reference!==admission.attempt_reference||owner.intent_digest!==admission.intent_digest)return null;
 const expected={...pendingInput,source_evidence:{...pendingInput.source_evidence,durable_target:owner}};
 try{if(stablePayload(expected)!==stablePayload(full))return null;}catch{return null;}
 return full;
}
module.exports={VERSION,pending,hydrate,evidenceForRuntime};
