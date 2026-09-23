'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { buildHermesMaintainerModeFoundation, validateHermesMaintainerModeFoundation } = require('./hermes-maintainer-mode-foundation');

const CONTRACT_VERSION = 'hermes_maintainer_action_gate_v1';
const ACTIONS = Object.freeze([
  'branch_prepare','ci_read','code_edit_prepare','pull_request_prepare',
  'repository_code_search','repository_read','test_execution'
]);

function evaluateHermesMaintainerAction(input = {}) {
  const foundation = input.foundation || buildHermesMaintainerModeFoundation();
  const foundationValidation = validateHermesMaintainerModeFoundation(foundation);
  const action = input.action;
  const errors = [];
  if (!foundationValidation.valid) errors.push(...foundationValidation.errors.map((e)=>`foundation::${e}`));
  if (!isNonEmptyString(action) || !ACTIONS.includes(action)) errors.push('action_not_allowed');
  if (foundation.production_allowed !== false || foundation.simulation_first !== true) errors.push('maintainer_boundary_invalid');
  if (!isPlainObject(foundation.capabilities) || foundation.capabilities[action] !== true) errors.push('capability_not_granted');

  const allowed = errors.length === 0;
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    action: isNonEmptyString(action) ? action : 'action_not_available',
    decision: allowed ? 'ALLOW_MAINTAINER_PREPARATION' : 'DENY',
    allowed,
    executed: false,
    runtime_mutated: false,
    network_used: false,
    provider_called: false,
    secret_accessed: false,
    operational_authority_consumed: false,
    production_allowed: false,
    simulation: true,
    blockers: uniqueSorted(errors)
  });
}

function validateHermesMaintainerActionDecision(decision) {
  const errors=[];
  if (!isPlainObject(decision)) return {valid:false,errors:['decision_must_be_object']};
  const fields=['contract_version','action','decision','allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','production_allowed','simulation','blockers'];
  for(const key of Object.keys(decision)) if(!fields.includes(key)) errors.push(`decision_unknown_field::${key}`);
  for(const key of fields) if(!Object.prototype.hasOwnProperty.call(decision,key)) errors.push(`decision_missing_field::${key}`);
  if(decision.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
  if(!isNonEmptyString(decision.action)) errors.push('action_invalid');
  if(typeof decision.allowed!=='boolean') errors.push('allowed_must_be_boolean');
  if(!['ALLOW_MAINTAINER_PREPARATION','DENY'].includes(decision.decision)) errors.push('decision_invalid');
  if(decision.allowed !== (decision.decision==='ALLOW_MAINTAINER_PREPARATION')) errors.push('decision_allowed_mismatch');
  for(const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','production_allowed']) if(decision[field]!==false) errors.push(`${field}_must_be_false`);
  if(decision.simulation!==true) errors.push('simulation_must_be_true');
  if(!Array.isArray(decision.blockers)||!decision.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  return {valid:errors.length===0,errors:uniqueSorted(errors)};
}

module.exports={ACTIONS,CONTRACT_VERSION,evaluateHermesMaintainerAction,validateHermesMaintainerActionDecision};
