'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateHermesMaintainerSteps, CONTRACT_VERSION: SOURCE_CONTRACT_VERSION, ACTION_TO_STEP } = require('./hermes-maintainer-step-contract');

const CONTRACT_VERSION = 'hermes_maintainer_step_admission_contract_v1';
const POSITIVE_STATUS = 'MAINTAINER_STEPS_ADMITTED_SIMULATION';
const BLOCKED_STATUS = 'MAINTAINER_STEPS_ADMISSION_BLOCKED';
const SUPPORTED_STEP_KINDS = Object.freeze(new Set(Object.values(ACTION_TO_STEP)));

function admitHermesMaintainerSteps(source) {
  const blockers = [];
  const validation = validateHermesMaintainerSteps(source);
  if (!validation.valid) blockers.push(...validation.errors.map(error => `source::${error}`));
  if (!source || source.status !== 'MAINTAINER_STEPS_PREPARED_SIMULATION') blockers.push('source_status_not_prepared');
  if (!source || source.ready !== true) blockers.push('source_not_ready');
  if (!source || source.simulation !== true) blockers.push('simulation_required');
  if (!source || source.production_allowed !== false) blockers.push('production_must_be_blocked');
  if (!source || !Array.isArray(source.blockers) || source.blockers.length !== 0) blockers.push('source_blockers_present');

  const steps = source && Array.isArray(source.steps) ? source.steps : [];
  if (!source || !Number.isInteger(source.step_count) || source.step_count !== steps.length) blockers.push('step_count_mismatch');

  const admittedSteps = steps.map((step, index) => {
    if (!isPlainObject(step)) {
      blockers.push(`step_${index}::invalid`);
      return Object.freeze({ step_index: index, action: 'action_not_available', step_kind: 'BLOCKED' });
    }
    if (step.step_index !== index) blockers.push(`step_${index}::index_out_of_order`);
    if (!isNonEmptyString(step.action)) blockers.push(`step_${index}::action_invalid`);
    if (!SUPPORTED_STEP_KINDS.has(step.step_kind)) blockers.push(`step_${index}::step_kind_not_supported`);
    if (step.prepared !== true) blockers.push(`step_${index}::not_prepared`);
    for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) {
      if (step[field] !== false) blockers.push(`step_${index}::${field}_must_be_false`);
    }
    return Object.freeze({ step_index: index, action: isNonEmptyString(step.action) ? step.action : 'action_not_available', step_kind: SUPPORTED_STEP_KINDS.has(step.step_kind) ? step.step_kind : 'BLOCKED' });
  });

  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) {
    if (!source || source[field] !== false) blockers.push(`source::${field}_must_be_false`);
  }

  const unique = uniqueSorted(blockers);
  const admitted = unique.length === 0;
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    mission_id: source && isNonEmptyString(source.mission_id) ? source.mission_id : 'mission_not_available',
    source_contract_version: source && isNonEmptyString(source.contract_version) ? source.contract_version : 'source_contract_not_available',
    status: admitted ? POSITIVE_STATUS : BLOCKED_STATUS,
    admitted,
    step_count: admittedSteps.length,
    admitted_steps: Object.freeze(admittedSteps),
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

function validateHermesMaintainerStepAdmission(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: ['admission_must_be_object'] };
  if (value.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
  if (value.source_contract_version !== SOURCE_CONTRACT_VERSION) errors.push('source_contract_version_invalid');
  if (![POSITIVE_STATUS, BLOCKED_STATUS].includes(value.status)) errors.push('status_invalid');
  if (typeof value.admitted !== 'boolean' || value.admitted !== (value.status === POSITIVE_STATUS)) errors.push('admitted_status_mismatch');
  if (!Number.isInteger(value.step_count) || value.step_count < 0 || !Array.isArray(value.admitted_steps) || value.step_count !== value.admitted_steps.length) errors.push('step_count_invalid');
  if (Array.isArray(value.admitted_steps)) value.admitted_steps.forEach((step,index) => {
    if (!isPlainObject(step) || step.step_index !== index || !isNonEmptyString(step.action) || !SUPPORTED_STEP_KINDS.has(step.step_kind)) errors.push(`step_${index}_invalid`);
  });
  if (value.simulation !== true) errors.push('simulation_must_be_true');
  if (value.production_allowed !== false) errors.push('production_allowed_must_be_false');
  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) if (value[field] !== false) errors.push(`${field}_must_be_false`);
  if (!Array.isArray(value.blockers) || !value.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (value.admitted === true && Array.isArray(value.blockers) && value.blockers.length !== 0) errors.push('admitted_with_blockers');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = { BLOCKED_STATUS, CONTRACT_VERSION, POSITIVE_STATUS, admitHermesMaintainerSteps, validateHermesMaintainerStepAdmission };
