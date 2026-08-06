'use strict';

// Proves scripts/ci-test-groups.js is, right now, an exact partition of whatever
// discover-tests.js finds on disk: every named file still exists, no file is claimed by two
// groups, nothing is left out, and the CI workflow actually wires up every named group to a
// real job command. This is the meta-test FASE 3 of the CI optimization PR requires --
// without it, a manifest that silently drifted from the real test/ directory (a rename, a
// deletion, a new heavy file nobody classified) would only be caught by eyeballing a CI
// timing chart, not by a failing test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { discoverTestFiles } = require('../scripts/discover-tests');
const { GROUPS, GROUP_NAMES, getGroupedFiles, getResidualFiles, validatePartition } = require('../scripts/ci-test-groups');

const REPO_ROOT = path.join(__dirname, '..');
const WORKFLOW_PATH = path.join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'hermes-core-smoke.yml');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

// Groups that reuse an existing package.json script rather than naming files directly in
// the workflow. Kept local to this test (not the manifest) because it's a statement about
// workflow wiring, not about which files belong to which group.
const GROUP_NPM_SCRIPT = {
  'readiness-admission': 'test:runtime-readiness-admission',
  scheduler: 'test:runtime-scheduler',
  'worker-assignment': 'test:runtime-worker-assignment',
  'queue-admission': 'test:runtime-queue-admission',
  'queue-materialization': 'test:runtime-queue-materialization',
  'queue-placement': 'test:runtime-queue-placement'
};

test('every group name is unique', () => {
  assert.equal(new Set(GROUP_NAMES).size, GROUP_NAMES.length);
});

test('every group is non-empty', () => {
  for (const name of GROUP_NAMES) {
    assert.ok(GROUPS[name].length > 0, `group "${name}" has zero files`);
  }
});

test('every file named in a group exists on disk', () => {
  const partition = validatePartition();
  assert.deepEqual(partition.missingOnDisk, [], 'some manifest entries no longer exist on disk (rename/delete without updating scripts/ci-test-groups.js)');
});

test('no file is claimed by more than one group', () => {
  const partition = validatePartition();
  assert.deepEqual(partition.duplicates, [], 'some files are listed in two or more groups');
});

test('union of named groups and residual equals the full discovered suite, exactly', () => {
  const partition = validatePartition();
  assert.equal(partition.unionEqualsDiscovered, true);
  assert.ok(partition.discoveredCount > 0, 'discover-tests.js found zero files -- refusing to trust an empty comparison');
});

test('partition is deterministic across repeated calls (no incidental filesystem-order dependency)', () => {
  const first = validatePartition();
  const second = validatePartition();
  assert.deepEqual(first, second);
  const residualFirst = getResidualFiles();
  const residualSecond = getResidualFiles();
  assert.deepEqual(residualFirst, residualSecond);
});

test('residual group is non-empty and does not contain any explicitly grouped file', () => {
  const residual = getResidualFiles();
  assert.ok(residual.length > 0, 'residual group is empty -- every file would then belong to a named group, which is not the current design');
  const grouped = new Set(getGroupedFiles());
  for (const file of residual) {
    assert.equal(grouped.has(file), false, `${file} is in both residual and a named group`);
  }
});

test('residual group includes runtime-dispatch, which has a package.json script but no dedicated CI job', () => {
  const residual = getResidualFiles();
  assert.ok(
    residual.includes('test/runtime-dispatch-simulation-contracts.test.js'),
    'runtime-dispatch-simulation-contracts.test.js should fall into residual unless a dedicated group is added for it'
  );
});

test('validatePartition() output matches discoverTestFiles() count exactly (named groups + residual, no more, no less)', () => {
  const discovered = discoverTestFiles();
  const partition = validatePartition();
  const namedCount = GROUP_NAMES.reduce((sum, name) => sum + GROUPS[name].length, 0);
  assert.equal(namedCount + partition.residualCount, discovered.length);
});

test('CI workflow references every named group with a runnable command', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  for (const name of GROUP_NAMES) {
    const npmScript = GROUP_NPM_SCRIPT[name];
    if (npmScript) {
      assert.ok(
        workflow.includes(`npm run ${npmScript}`),
        `workflow does not reference "npm run ${npmScript}" for group "${name}"`
      );
      continue;
    }
    // Groups without a dedicated npm script (fast-gates, runtime-contracts) must have every
    // one of their files named directly in the workflow text.
    for (const file of GROUPS[name]) {
      const bareFile = file.slice('test/'.length);
      assert.ok(
        workflow.includes(bareFile),
        `workflow does not reference ${bareFile} for group "${name}"`
      );
    }
  }
});

test('CI workflow references the residual runner script, and package.json defines it', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  assert.ok(workflow.includes('test:ci:residual'), 'workflow does not run the residual test job');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  assert.equal(packageJson.scripts['test:ci:residual'], 'node scripts/run-residual-tests.js');
});

test('local `npm test` script is untouched -- still delegates to full discovery, not the group manifest', () => {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  assert.equal(packageJson.scripts.test, 'node scripts/discover-tests.js');
});
