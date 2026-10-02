'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const RUNTIME_VERSION = 'hermes_maintainer_test_execution_process_runtime_v1';
const TEST_SPECS = Object.freeze({
  hermes_core_smoke: Object.freeze({
    executable: process.execPath,
    args: Object.freeze([
      '--test',
      'test/hermes-maintainer-e2e-workflow-contract.test.js',
      'test/hermes-maintainer-test-execution-boundary.test.js'
    ])
  })
});

function createHermesMaintainerTestExecutionProcessRuntime({ cwd = path.resolve(__dirname, '../..'), spawnImpl = spawn } = {}) {
  return Object.freeze({
    runtime_version: RUNTIME_VERSION,
    run(input = {}) {
      if (input.environment !== 'staging') return Promise.resolve({ test_id: input.test_id || null, passed: false, receipt: 'staging_environment_required' });
      if (input.network_authorized !== false || input.secrets_authorized !== false || input.write_authorized !== false) {
        return Promise.resolve({ test_id: input.test_id || null, passed: false, receipt: 'authority_boundary_invalid' });
      }
      const spec = TEST_SPECS[input.test_id];
      if (!spec) return Promise.resolve({ test_id: input.test_id || null, passed: false, receipt: 'test_not_registered' });
      return new Promise(resolve => {
        let settled = false;
        const finish = (passed, receipt) => {
          if (settled) return;
          settled = true;
          resolve(Object.freeze({ test_id: input.test_id, passed, receipt }));
        };
        const child = spawnImpl(spec.executable, [...spec.args], {
          cwd,
          shell: false,
          stdio: 'ignore',
          env: Object.freeze({ NODE_ENV: 'test' })
        });
        child.once('error', () => finish(false, 'test_process_error'));
        child.once('exit', code => finish(code === 0, code === 0 ? 'test_process_passed' : 'test_process_failed'));
      });
    }
  });
}

module.exports = { RUNTIME_VERSION, TEST_SPECS, createHermesMaintainerTestExecutionProcessRuntime };
