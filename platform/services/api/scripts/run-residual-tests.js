#!/usr/bin/env node
'use strict';

// CI-only entry point: runs every discovered test file EXCEPT the ones already covered by
// their own dedicated CI job (see scripts/ci-test-groups.js for the canonical group
// manifest). This exists solely to stop the 8 heaviest layer test files from running twice
// per CI run -- once in their own job, once again inside the full suite. Local `npm test`
// is untouched by this file and keeps discovering and running every test/*.test.js, as
// before.
//
// Refuses to run (and refuses to report success) if the manifest is out of sync with what's
// actually on disk -- a stale or duplicated group entry must fail the build, not silently
// under- or over-run the suite.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validatePartition, getResidualFiles } = require('./ci-test-groups');

function main() {
  const partition = validatePartition();
  if (!partition.ok) {
    console.error('run-residual-tests: ci-test-groups.js manifest is not a valid partition of the discovered suite:');
    if (partition.missingOnDisk.length > 0) {
      console.error('  Files named in a group but missing on disk:');
      partition.missingOnDisk.forEach(({ group, file }) => console.error(`    - [${group}] ${file}`));
    }
    if (partition.duplicates.length > 0) {
      console.error('  Files claimed by more than one group:');
      partition.duplicates.forEach(({ file, groups }) => console.error(`    - ${file} in [${groups.join(', ')}]`));
    }
    if (!partition.unionEqualsDiscovered) {
      console.error('  Union of named groups + residual does not equal the discovered suite.');
    }
    process.exitCode = 1;
    return;
  }

  const residual = getResidualFiles();
  if (residual.length === 0) {
    console.error('run-residual-tests: zero residual test files -- refusing to report success on an empty suite');
    process.exitCode = 1;
    return;
  }

  console.log(`run-residual-tests: running ${residual.length} residual file(s) (${partition.discoveredCount} discovered, ${partition.discoveredCount - residual.length} covered by dedicated jobs)`);
  const result = spawnSync(process.execPath, ['--test', ...residual], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) {
  main();
}

module.exports = { main };
