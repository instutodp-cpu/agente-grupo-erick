'use strict';

const path = require('node:path');
const { createHermesMaintainerTestExecutionBoundary } = require('../core/hermes-maintainer-test-execution-boundary');
const { createHermesMaintainerTestExecutionProcessRuntime } = require('./hermes-maintainer-test-execution-process-runtime');

const COMPOSITION_VERSION = 'hermes_maintainer_test_execution_runtime_composition_v1';
const TEST_ID = 'hermes_core_smoke';
const CWD = path.resolve(__dirname, '../..');

function createHermesMaintainerTestExecutionRuntimeComposition({ spawnImpl, timeoutMs } = {}) {
  const runner = createHermesMaintainerTestExecutionProcessRuntime({ cwd: CWD, spawnImpl, timeoutMs });
  const boundary = createHermesMaintainerTestExecutionBoundary({ runner });
  return Object.freeze({
    composition_version: COMPOSITION_VERSION,
    environment: 'staging',
    test_id: TEST_ID,
    network_authorized: false,
    secrets_authorized: false,
    write_authorized: false,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    execute() {
      return boundary.execute(Object.freeze({
        action: 'test_execution',
        environment: 'staging',
        test_id: TEST_ID
      }));
    }
  });
}

module.exports = { COMPOSITION_VERSION, TEST_ID, createHermesMaintainerTestExecutionRuntimeComposition };
