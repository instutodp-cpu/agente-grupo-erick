'use strict';

const { buildHermesMaintainerE2eWorkflowContract, validateHermesMaintainerE2eWorkflowContract } = require('./hermes-maintainer-e2e-workflow-contract');

const READINESS_VERSION = 'hermes_maintainer_final_e2e_readiness_v1';
const TRUSTED_COMPOSITION_VERSION = 'hermes_maintainer_trusted_e2e_runtime_composition_v1';

function blocked(reason) {
  return Object.freeze({
    readiness_version: READINESS_VERSION,
    status: 'MAINTAINER_FINAL_E2E_READINESS_BLOCKED',
    execution_ready: false,
    trusted_runtime_ready: false,
    staging_canary_required: true,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    blockers: Object.freeze([reason])
  });
}

function deriveHermesMaintainerFinalE2eReadiness(trustedComposition = {}) {
  const workflow = buildHermesMaintainerE2eWorkflowContract();
  const workflowValidation = validateHermesMaintainerE2eWorkflowContract(workflow);
  if (!workflowValidation.valid) return blocked('E2E_WORKFLOW_CONTRACT_INVALID');

  const trusted =
    trustedComposition.composition_version === TRUSTED_COMPOSITION_VERSION &&
    trustedComposition.environment === 'staging' &&
    trustedComposition.production_allowed === false &&
    trustedComposition.merge_authority === false &&
    trustedComposition.human_merge_required === true &&
    typeof trustedComposition.execute === 'function';

  if (!trusted) return blocked('TRUSTED_E2E_RUNTIME_COMPOSITION_INVALID');

  return Object.freeze({
    readiness_version: READINESS_VERSION,
    status: 'MAINTAINER_FINAL_E2E_RUNTIME_READY',
    execution_ready: true,
    trusted_runtime_ready: true,
    staging_canary_required: true,
    staging_canary_completed: false,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    blockers: Object.freeze([])
  });
}

module.exports = { READINESS_VERSION, TRUSTED_COMPOSITION_VERSION, deriveHermesMaintainerFinalE2eReadiness };
