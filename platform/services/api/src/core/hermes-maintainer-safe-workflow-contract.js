'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateHermesMaintainerStepAdmission } = require('./hermes-maintainer-step-admission-contract');

const CONTRACT_VERSION = 'hermes_maintainer_safe_workflow_contract_v1';
const POSITIVE_STATUS = 'MAINTAINER_SAFE_WORKFLOW_PREPARED_SIMULATION';
const BLOCKED_STATUS = 'MAINTAINER_SAFE_WORKFLOW_BLOCKED';
const EXPECTED_ACTIONS = Object.freeze([
  'repository_read',
  'repository_code_search',
  'ci_read',
  'test_execution',
  'branch_prepare',
  'code_edit_prepare',
  'pull_request_prepare'
]);

function prepareHermesMaintainerSafeWorkflow(admission) {
  const blockers = [];
  const validation = validateHermesMaintainerStepAdmission(admission);
  if (!validation.valid) blockers.push(...validation.errors.map(error => `admission::${error}`));
  if (!admission || admission.admitted !== true) blockers.push('steps_not_admitted');
  if (!admission || admission.simulation !== true) blockers.push('simulation_required');
  if (!admission || admission.production_allowed !== false) blockers.push('production_must_be_blocked');

  const steps = admission && Array.isArray(admission.admitted_steps) ? admission.admitted_steps : [];
  const actions = steps.map(step => step && step.action);
  if (actions.length !== EXPECTED_ACTIONS.length) blockers.push('workflow_action_count_invalid');
  EXPECTED_ACTIONS.forEach((action,index) => {
    if (actions[index] !== action) blockers.push(`workflow_action_${index}_invalid`);
  });

  const unique = uniqueSorted(blockers);
  const ready = unique.length === 0;
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    mission_id: admission && isNonEmptyString(admission.mission_id) ? admission.mission_id : 'mission_not_available',
    status: ready ? POSITIVE_STATUS : BLOCKED_STATUS,
    ready,
    actions: Object.freeze([...EXPECTED_ACTIONS]),
    merge_authority: false,
    human_merge_required: true,
    simulation: true,
    production_allowed: false,
    executed: false,
    runtime_mutated: false,
    network_used: false,
    provider_called: false,
    secret_accessed: false,
    operational_authority_consumed: false,
    blockers: Object.freeze(unique)
  });
}

function validateHermesMaintainerSafeWorkflow(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid:false, errors:['workflow_must_be_object'] };
  if (value.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
  if (![POSITIVE_STATUS,BLOCKED_STATUS].includes(value.status)) errors.push('status_invalid');
  if (typeof value.ready !== 'boolean' || value.ready !== (value.status === POSITIVE_STATUS)) errors.push('ready_status_mismatch');
  if (!Array.isArray(value.actions) || value.actions.length !== EXPECTED_ACTIONS.length || value.actions.some((a,i)=>a!==EXPECTED_ACTIONS[i])) errors.push('actions_invalid');
  if (value.merge_authority !== false) errors.push('merge_authority_must_be_false');
  if (value.human_merge_required !== true) errors.push('human_merge_required_must_be_true');
  if (value.simulation !== true) errors.push('simulation_must_be_true');
  if (value.production_allowed !== false) errors.push('production_allowed_must_be_false');
  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) if (value[field] !== false) errors.push(`${field}_must_be_false`);
  if (!Array.isArray(value.blockers) || !value.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  return { valid:errors.length===0, errors:uniqueSorted(errors) };
}

module.exports={BLOCKED_STATUS,CONTRACT_VERSION,EXPECTED_ACTIONS,POSITIVE_STATUS,prepareHermesMaintainerSafeWorkflow,validateHermesMaintainerSafeWorkflow};
