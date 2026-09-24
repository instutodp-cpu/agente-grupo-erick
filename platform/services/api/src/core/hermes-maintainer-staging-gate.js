'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateHermesMaintainerControlledExecution } = require('./hermes-maintainer-controlled-executor');
const { RECONCILED, validateHermesMaintainerExecutionReceipt, verifyHermesMaintainerExecutionReceipt } = require('./hermes-maintainer-execution-receipt-reconciliation');

const CONTRACT_VERSION='hermes_maintainer_staging_gate_v1';
const PASSED='MAINTAINER_STAGING_GATE_PASSED_SIMULATION';
const BLOCKED='MAINTAINER_STAGING_GATE_BLOCKED';
function evaluateHermesMaintainerStagingGate(execution,receipt){
 const blockers=[],ev=validateHermesMaintainerControlledExecution(execution),rv=validateHermesMaintainerExecutionReceipt(receipt),vv=verifyHermesMaintainerExecutionReceipt(execution,receipt);
 if(!ev.valid)blockers.push(...ev.errors.map(e=>'execution::'+e));if(!rv.valid)blockers.push(...rv.errors.map(e=>'receipt::'+e));if(!vv.valid)blockers.push(...vv.errors.map(e=>'verification::'+e));
 if(rv.valid&&(receipt.status!==RECONCILED||receipt.reconciled!==true))blockers.push('receipt_not_reconciled');
 if(execution&&(execution.simulation!==true||execution.production_allowed!==false||execution.executed!==false))blockers.push('execution_boundary_not_staging_safe');
 if(receipt&&(receipt.simulation!==true||receipt.production_effect!=='ZERO'||receipt.execution_observed!==false||receipt.side_effect_observed!==false))blockers.push('receipt_boundary_not_staging_safe');
 const u=uniqueSorted(blockers),passed=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:execution&&isNonEmptyString(execution.mission_id)?execution.mission_id:'mission_not_available',operation:execution&&isNonEmptyString(execution.operation)?execution.operation:'operation_not_available',repository:execution&&isNonEmptyString(execution.repository)?execution.repository:'repository_not_available',base_ref:execution&&isNonEmptyString(execution.base_ref)?execution.base_ref:'ref_not_available',status:passed?PASSED:BLOCKED,staging_gate_passed:passed,real_execution_enabled:false,production_enabled:false,network_enabled:false,credentials_enabled:false,write_enabled:false,simulation:true,blockers:Object.freeze(u)});
}
function validateHermesMaintainerStagingGate(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['staging_gate_must_be_object']};if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.operation)||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref))e.push('identity_invalid');if(![PASSED,BLOCKED].includes(v.status)||v.staging_gate_passed!==(v.status===PASSED))e.push('status_invalid');for(const f of ['real_execution_enabled','production_enabled','network_enabled','credentials_enabled','write_enabled'])if(v[f]!==false)e.push(f+'_must_be_false');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.staging_gate_passed&&v.blockers.length)e.push('passed_with_blockers');return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PASSED,evaluateHermesMaintainerStagingGate,validateHermesMaintainerStagingGate};
