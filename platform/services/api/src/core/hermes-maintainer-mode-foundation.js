'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');

const CONTRACT_VERSION = 'hermes_maintainer_mode_foundation_v1';
const ALLOWED_CAPABILITIES = Object.freeze([
  'repository_read',
  'repository_code_search',
  'ci_read',
  'test_execution',
  'branch_prepare',
  'code_edit_prepare',
  'pull_request_prepare'
]);
const FORBIDDEN_CAPABILITIES = Object.freeze([
  'pull_request_merge',
  'production_deploy',
  'production_mutation',
  'external_network_execution',
  'provider_call',
  'secret_resolution',
  'secret_material_access',
  'execution_authorization_issue',
  'execution_authorization_consume',
  'grant_consume',
  'reservation_consume',
  'durable_execution_claim',
  'public_web_canary_execute'
]);

function validateHermesMaintainerModeFoundation(contract) {
  const errors = [];
  if (!isPlainObject(contract)) return { valid: false, errors: ['maintainer_contract_must_be_object'] };
  const exact = ['contract_version','mode','environment','production_allowed','simulation_first','capabilities','human_gates'];
  for (const key of Object.keys(contract)) if (!exact.includes(key)) errors.push(`maintainer_contract_unknown_field::${key}`);
  for (const key of exact) if (!Object.prototype.hasOwnProperty.call(contract,key)) errors.push(`maintainer_contract_missing_field::${key}`);
  if (contract.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (contract.mode !== 'self_development') errors.push('mode_invalid');
  if (contract.environment !== 'development') errors.push('environment_invalid');
  if (contract.production_allowed !== false) errors.push('production_must_remain_blocked');
  if (contract.simulation_first !== true) errors.push('simulation_first_required');
  if (!isPlainObject(contract.capabilities)) errors.push('capabilities_must_be_object');
  else {
    for (const capability of ALLOWED_CAPABILITIES) if (contract.capabilities[capability] !== true) errors.push(`allowed_capability_missing::${capability}`);
    for (const capability of FORBIDDEN_CAPABILITIES) if (contract.capabilities[capability] !== false) errors.push(`forbidden_capability_not_blocked::${capability}`);
    const known = new Set([...ALLOWED_CAPABILITIES,...FORBIDDEN_CAPABILITIES]);
    for (const key of Object.keys(contract.capabilities)) if (!known.has(key)) errors.push(`capability_unknown::${key}`);
  }
  if (!isPlainObject(contract.human_gates)) errors.push('human_gates_must_be_object');
  else {
    const gates=['merge','production_deploy','operational_execution','secret_access','authorization_issue_or_consume'];
    for (const gate of gates) if (contract.human_gates[gate] !== 'explicit_authorization_required') errors.push(`human_gate_required::${gate}`);
    for (const key of Object.keys(contract.human_gates)) if (!gates.includes(key)) errors.push(`human_gate_unknown::${key}`);
  }
  return { valid: errors.length===0, errors: uniqueSorted(errors) };
}

function buildHermesMaintainerModeFoundation() {
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    mode: 'self_development',
    environment: 'development',
    production_allowed: false,
    simulation_first: true,
    capabilities: Object.freeze({
      ...Object.fromEntries(ALLOWED_CAPABILITIES.map((x)=>[x,true])),
      ...Object.fromEntries(FORBIDDEN_CAPABILITIES.map((x)=>[x,false]))
    }),
    human_gates: Object.freeze({
      merge: 'explicit_authorization_required',
      production_deploy: 'explicit_authorization_required',
      operational_execution: 'explicit_authorization_required',
      secret_access: 'explicit_authorization_required',
      authorization_issue_or_consume: 'explicit_authorization_required'
    })
  });
}

module.exports={CONTRACT_VERSION,ALLOWED_CAPABILITIES,FORBIDDEN_CAPABILITIES,buildHermesMaintainerModeFoundation,validateHermesMaintainerModeFoundation};
