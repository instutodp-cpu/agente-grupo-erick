'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { ACTIONS, evaluateHermesMaintainerAction, validateHermesMaintainerActionDecision } = require('./hermes-maintainer-action-gate');

const CONTRACT_VERSION='hermes_maintainer_request_contract_v1';
const FIELDS=Object.freeze(['contract_version','request_id','action','repository','base_ref','target_ref','simulation','production_blocked']);

function validateHermesMaintainerRequest(request){
 const errors=[];
 if(!isPlainObject(request)) return {valid:false,errors:['request_must_be_object']};
 for(const key of Object.keys(request)) if(!FIELDS.includes(key)) errors.push(`request_unknown_field::${key}`);
 for(const key of FIELDS) if(!Object.prototype.hasOwnProperty.call(request,key)) errors.push(`request_missing_field::${key}`);
 if(request.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
 for(const field of ['request_id','repository','base_ref']) if(!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
 if(!ACTIONS.includes(request.action)) errors.push('action_not_allowed');
 if(request.action==='branch_prepare'||request.action==='code_edit_prepare'||request.action==='pull_request_prepare'){
   if(!isNonEmptyString(request.target_ref)) errors.push('target_ref_required');
 } else if(request.target_ref!==null) errors.push('target_ref_must_be_null');
 if(request.simulation!==true) errors.push('simulation_must_be_true');
 if(request.production_blocked!==true) errors.push('production_blocked_must_be_true');
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}

function evaluateHermesMaintainerRequest(request,foundation){
 const validation=validateHermesMaintainerRequest(request);
 if(!validation.valid) return Object.freeze({status:'MAINTAINER_REQUEST_BLOCKED',allowed:false,blockers:validation.errors,action_decision:null,executed:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false});
 const actionDecision=evaluateHermesMaintainerAction({action:request.action,foundation});
 const actionValidation=validateHermesMaintainerActionDecision(actionDecision);
 const blockers=uniqueSorted([...(actionDecision.blockers||[]),...actionValidation.errors]);
 const allowed=actionDecision.allowed===true&&actionValidation.valid;
 return Object.freeze({status:allowed?'MAINTAINER_REQUEST_PREPARED_SIMULATION':'MAINTAINER_REQUEST_BLOCKED',allowed,blockers,action_decision:actionDecision,executed:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false});
}

module.exports={CONTRACT_VERSION,FIELDS,validateHermesMaintainerRequest,evaluateHermesMaintainerRequest};
