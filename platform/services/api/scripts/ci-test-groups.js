'use strict';

// Canonical, single source of truth for how CI splits the discovered test suite into
// parallel jobs. Both the residual-suite runner (run-residual-tests.js) and the partition
// proof (test/ci-test-group-partition.test.js) import this file -- the mapping is never
// duplicated or hand-copied anywhere else. Renaming or deleting a file listed here breaks
// the partition proof until this manifest is updated (fail-closed, not silently ignored).
//
// Every path is stored in the exact `test/<file>.test.js` format that discoverTestFiles()
// (scripts/discover-tests.js) itself returns, so membership can be checked with plain
// string equality -- no path normalization, no incidental filesystem ordering.
//
// GROUPS covers only the files CI runs as their own dedicated, named job (mirroring the
// pre-existing per-layer steps this PR replaces). Every other discovered file -- including
// runtime-dispatch-simulation-contracts.test.js, which had a package.json script but never
// had a dedicated CI step even before this change -- falls into the "residual" group by
// construction. This is a deliberate reuse of the project's own established discovery
// contract (see discover-tests.js's header comment): new test files must never require a
// manual registration step to be included in CI, on pain of silent omission. Putting an
// unclassified file into "residual" is exactly that existing contract, not a new fallback
// invented by this PR -- residual is not a decision made by drift, it's runInDiscovered
// minus a set the manifest names explicitly, so it can never omit or duplicate a file no
// matter what gets added to test/ later. The partition proof (below, and in the meta-test)
// still checks this arithmetic on every run rather than trusting it by construction.
const { discoverTestFiles } = require('./discover-tests');

const GROUPS = Object.freeze({
  'fast-gates': Object.freeze([
    'test/validation-semantics-architecture-gates.test.js',
    'test/validation-trace.test.js'
  ]),
  'runtime-contracts': Object.freeze([
    'test/runtime-execution-simulation-contracts.test.js'
  ]),
  'readiness-admission': Object.freeze([
    'test/runtime-readiness-admission-boundary.test.js'
  ]),
  scheduler: Object.freeze([
    'test/runtime-scheduler-simulation-contracts.test.js'
  ]),
  'worker-assignment': Object.freeze([
    'test/runtime-worker-assignment-simulation-contracts.test.js'
  ]),
  'queue-admission': Object.freeze([
    'test/runtime-queue-admission-simulation-contracts.test.js'
  ]),
  'queue-materialization': Object.freeze([
    'test/runtime-queue-materialization-simulation-contracts.test.js'
  ]),
  'queue-placement': Object.freeze([
    'test/runtime-queue-placement-simulation-contracts.test.js'
  ])
});

const GROUP_NAMES = Object.freeze(Object.keys(GROUPS));

function getGroupedFiles() {
  const files = [];
  for (const name of GROUP_NAMES) {
    for (const file of GROUPS[name]) files.push(file);
  }
  return files;
}

function getResidualFiles(testDir) {
  const discovered = discoverTestFiles(testDir);
  const grouped = new Set(getGroupedFiles());
  return discovered.filter((file) => !grouped.has(file));
}

// Proves the manifest is an exact partition of whatever discover-tests.js currently finds
// on disk: every named file still exists, no file is claimed by two groups, and the union
// of every named group plus the computed residual is exactly the discovered set -- no more,
// no less. Called both by the CI residual runner (to refuse running on a broken manifest)
// and by the meta-test (to fail the build the same way).
function validatePartition(testDir) {
  const discovered = discoverTestFiles(testDir);
  const discoveredSet = new Set(discovered);

  const missingOnDisk = [];
  const seen = new Map(); // file -> group name that first claimed it
  const duplicates = [];

  for (const name of GROUP_NAMES) {
    for (const file of GROUPS[name]) {
      if (!discoveredSet.has(file)) missingOnDisk.push({ group: name, file });
      if (seen.has(file)) {
        duplicates.push({ file, groups: [seen.get(file), name] });
      } else {
        seen.set(file, name);
      }
    }
  }

  const residual = getResidualFiles(testDir);
  const unionSet = new Set([...getGroupedFiles(), ...residual]);
  const unionSorted = [...unionSet].sort();
  const discoveredSorted = [...discovered].sort();
  const unionEqualsDiscovered =
    unionSorted.length === discoveredSorted.length &&
    unionSorted.every((file, index) => file === discoveredSorted[index]);

  const ok = missingOnDisk.length === 0 && duplicates.length === 0 && unionEqualsDiscovered && discovered.length > 0;

  return {
    ok,
    discoveredCount: discovered.length,
    groupCounts: Object.fromEntries(GROUP_NAMES.map((name) => [name, GROUPS[name].length])),
    residualCount: residual.length,
    residualFiles: residual,
    missingOnDisk,
    duplicates,
    unionEqualsDiscovered
  };
}

module.exports = {
  GROUPS,
  GROUP_NAMES,
  getGroupedFiles,
  getResidualFiles,
  validatePartition
};
