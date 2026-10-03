'use strict';

const { createHermesMaintainerTrustedE2eRuntimeComposition } = require('./hermes-maintainer-trusted-e2e-runtime-composition');
const { deriveHermesMaintainerFinalE2eReadiness } = require('../core/hermes-maintainer-final-e2e-readiness');

const CANARY_VERSION = 'hermes_maintainer_trusted_e2e_staging_canary_entry_v1';
const CONFIRMATION = 'EXECUTE_TRUSTED_E2E_STAGING_CANARY';

async function runHermesMaintainerTrustedE2eStagingCanary(options = {}) {
  const { input } = options;
  if (!input || input.confirmation !== CONFIRMATION) throw new TypeError('explicit_canary_confirmation_required');

  const runtime = createHermesMaintainerTrustedE2eRuntimeComposition(options);
  const readiness = deriveHermesMaintainerFinalE2eReadiness(runtime);
  if (readiness.execution_ready !== true || readiness.trusted_runtime_ready !== true) {
    throw new TypeError('trusted_e2e_runtime_not_ready');
  }
  if (runtime.environment !== 'staging' || runtime.production_allowed !== false ||
      runtime.merge_authority !== false || runtime.human_merge_required !== true) {
    throw new TypeError('trusted_e2e_canary_boundary_invalid');
  }

  const outcome = await runtime.execute(input.workflow);
  return Object.freeze({
    canary_version: CANARY_VERSION,
    status: outcome?.completed === true ? 'TRUSTED_E2E_STAGING_CANARY_COMPLETED' : 'TRUSTED_E2E_STAGING_CANARY_NOT_COMPLETED',
    completed: outcome?.completed === true,
    workflow_outcome: outcome,
    production_used: false,
    merge_authority: false,
    human_merge_required: true
  });
}

module.exports = { CANARY_VERSION, CONFIRMATION, runHermesMaintainerTrustedE2eStagingCanary };
