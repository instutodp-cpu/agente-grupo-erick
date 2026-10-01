'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateHermesMaintainerSafeWorkflow } = require('./hermes-maintainer-safe-workflow-contract');
const { verifyHermesMaintainerSafeWorkflowFingerprint } = require('./hermes-maintainer-safe-workflow-fingerprint');

const CONTRACT_VERSION = 'hermes_maintainer_safe_workflow_handoff_v1';
const PREPARED_STATUS = 'MAINTAINER_SAFE_WORKFLOW_HANDOFF_PREPARED_SIMULATION';
const BLOCKED_STATUS = 'MAINTAINER_SAFE_WORKFLOW_HANDOFF_BLOCKED';

function prepareHermesMaintainerSafeWorkflowHandoff(workflow, fingerprint) {
  const blockers = [];
  const workflowValidation = validateHermesMaintainerSafeWorkflow(workflow);
  if (!workflowValidation.valid) blockers.push(...workflowValidation.errors.map(error => `workflow::${error}`));
  const fingerprintVerification = verifyHermesMaintainerSafeWorkflowFingerprint(workflow, fingerprint);
  if (!fingerprintVerification.valid) blockers.push(...fingerprintVerification.errors.map(error => `fingerprint::${error}`));
  if (workflowValidation.valid && workflow.ready !== true) blockers.push('workflow_not_ready');
  if (workflowValidation.valid && workflow.merge_authority !== false) blockers.push('merge_authority_must_be_false');
  if (workflowValidation.valid && workflow.human_merge_required !== true) blockers.push('human_merge_required_must_be_true');

  const unique = uniqueSorted(blockers);
  const prepared = unique.length === 0;
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    mission_id: workflow && isNonEmptyString(workflow.mission_id) ? workflow.mission_id : 'mission_not_available',
    workflow_digest: prepared ? fingerprint.workflow_digest : null,
    action_count: prepared ? fingerprint.action_count : 0,
    status: prepared ? PREPARED_STATUS : BLOCKED_STATUS,
    handoff_prepared: prepared,
    execution_eligible: false,
    execution_authorized: false,
    authority_consumed: false,
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

function validateHermesMaintainerSafeWorkflowHandoff(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid:false, errors:['handoff_must_be_object'] };
  if (value.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
  if (![PREPARED_STATUS,BLOCKED_STATUS].includes(value.status)) errors.push('status_invalid');
  if (typeof value.handoff_prepared !== 'boolean' || value.handoff_prepared !== (value.status === PREPARED_STATUS)) errors.push('handoff_status_mismatch');
  if (value.handoff_prepared && (!isNonEmptyString(value.workflow_digest) || !Number.isInteger(value.action_count) || value.action_count < 1)) errors.push('workflow_binding_invalid');
  for (const field of ['execution_eligible','execution_authorized','authority_consumed','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) {
    if (value[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (value.human_merge_required !== true) errors.push('human_merge_required_must_be_true');
  if (value.simulation !== true) errors.push('simulation_must_be_true');
  if (!Array.isArray(value.blockers) || !value.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (value.handoff_prepared && value.blockers.length !== 0) errors.push('prepared_with_blockers');
  return { valid:errors.length===0, errors:uniqueSorted(errors) };
}

module.exports = { BLOCKED_STATUS, CONTRACT_VERSION, PREPARED_STATUS, prepareHermesMaintainerSafeWorkflowHandoff, validateHermesMaintainerSafeWorkflowHandoff };
