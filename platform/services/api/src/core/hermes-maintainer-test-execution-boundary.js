'use strict';

const CONTRACT_VERSION = 'hermes_maintainer_test_execution_boundary_v1';
const DEFAULT_ALLOWED_TESTS = Object.freeze(['hermes_core_smoke']);

function blocked(reason) {
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: 'MAINTAINER_TEST_EXECUTION_BLOCKED',
    executed: false,
    passed: false,
    reason,
    network_authorized: false,
    secrets_authorized: false,
    write_authorized: false,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true
  });
}

function createHermesMaintainerTestExecutionBoundary({ runner, allowedTests = DEFAULT_ALLOWED_TESTS } = {}) {
  if (!runner || typeof runner.run !== 'function') throw new Error('test_runner_required');
  const allowlist = new Set(allowedTests);
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    async execute(request = {}) {
      if (request.action !== 'test_execution') return blocked('test_execution_action_required');
      if (request.environment !== 'staging') return blocked('staging_environment_required');
      if (typeof request.test_id !== 'string' || !allowlist.has(request.test_id)) return blocked('test_not_allowlisted');
      if ('command' in request || 'args' in request || 'shell' in request || 'env' in request) return blocked('caller_execution_parameters_forbidden');

      const result = await runner.run(Object.freeze({
        test_id: request.test_id,
        environment: 'staging',
        network_authorized: false,
        secrets_authorized: false,
        write_authorized: false
      }));

      if (!result || result.test_id !== request.test_id || typeof result.passed !== 'boolean') return blocked('test_runner_result_invalid');
      return Object.freeze({
        contract_version: CONTRACT_VERSION,
        status: result.passed ? 'MAINTAINER_TEST_EXECUTION_PASSED' : 'MAINTAINER_TEST_EXECUTION_FAILED',
        executed: true,
        passed: result.passed,
        test_id: request.test_id,
        receipt: result.receipt || null,
        network_authorized: false,
        secrets_authorized: false,
        write_authorized: false,
        production_allowed: false,
        merge_authority: false,
        human_merge_required: true
      });
    }
  });
}

module.exports = { CONTRACT_VERSION, DEFAULT_ALLOWED_TESTS, createHermesMaintainerTestExecutionBoundary };
