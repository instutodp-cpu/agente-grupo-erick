'use strict';

const { buildHermesMaintainerE2eWorkflowContract, validateHermesMaintainerE2eWorkflowContract } = require('./hermes-maintainer-e2e-workflow-contract');

const READINESS_VERSION = 'hermes_maintainer_e2e_test_readiness_v1';
const TEST_COMPOSITION_VERSION = 'hermes_maintainer_test_execution_runtime_composition_v1';
const REMAINING_BLOCKER = 'e2e_operational_orchestration_missing';

function deriveHermesMaintainerE2eTestReadiness(testComposition = {}) {
  const workflow = buildHermesMaintainerE2eWorkflowContract();
  const validation = validateHermesMaintainerE2eWorkflowContract(workflow);
  const compositionValid =
    testComposition.composition_version === TEST_COMPOSITION_VERSION &&
    testComposition.environment === 'staging' &&
    testComposition.test_id === 'hermes_core_smoke' &&
    testComposition.network_authorized === false &&
    testComposition.secrets_authorized === false &&
    testComposition.write_authorized === false &&
    testComposition.production_allowed === false &&
    testComposition.merge_authority === false &&
    testComposition.human_merge_required === true &&
    typeof testComposition.execute === 'function';

  if (!validation.valid || !compositionValid) {
    return Object.freeze({
      readiness_version: READINESS_VERSION,
      status: 'MAINTAINER_E2E_TEST_DEPENDENCY_BLOCKED',
      test_execution_operational_ready: false,
      execution_ready: false,
      blockers: Object.freeze(['test_execution_operational_composition_invalid']),
      production_allowed: false,
      merge_authority: false,
      human_merge_required: true
    });
  }

  return Object.freeze({
    readiness_version: READINESS_VERSION,
    status: 'MAINTAINER_E2E_TEST_DEPENDENCY_READY',
    test_execution_operational_ready: true,
    execution_ready: false,
    blockers: Object.freeze([REMAINING_BLOCKER]),
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true
  });
}

module.exports = { READINESS_VERSION, TEST_COMPOSITION_VERSION, REMAINING_BLOCKER, deriveHermesMaintainerE2eTestReadiness };
