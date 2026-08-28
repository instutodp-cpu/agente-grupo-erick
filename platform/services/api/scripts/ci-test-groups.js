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
// GROUPS covers files that CI runs as named jobs. Every other discovered file falls into the
// residual set by construction. Residual files are then assigned to deterministic shards by
// getResidualShardFiles(); no workflow file owns an independent test list.
const { discoverTestFiles } = require('./discover-tests');

const GROUPS = Object.freeze({
  'fast-gates': Object.freeze([
    'test/validation-semantics-architecture-gates.test.js',
    'test/validation-trace.test.js'
  ]),
  'runtime-contracts': Object.freeze([
    'test/runtime-execution-simulation-contracts.test.js'
  ]),
  'runtime-dispatch': Object.freeze([
    'test/runtime-dispatch-simulation-contracts.test.js'
  ]),
  'runtime-execution-job-intent': Object.freeze([
    'test/runtime-execution-job-intent.test.js'
  ]),
  'runtime-execution-job-materialization': Object.freeze([
    'test/runtime-execution-job-materialization-simulation.test.js'
  ]),
  'runtime-execution-job-durable': Object.freeze([
    'test/runtime-execution-job-durable-contract.test.js'
  ]),
  'runtime-execution-job-admission-contract': Object.freeze([
    'test/runtime-execution-job-admission-contract.test.js'
  ]),
  'runtime-execution-job-admission-memory': Object.freeze([
    'test/runtime-execution-job-admission-memory.test.js'
  ]),
  'runtime-attempt-contracts': Object.freeze([
    'test/runtime-execution-attempt-intent.test.js',
    'test/runtime-execution-attempt-materialization.test.js',
    'test/runtime-execution-attempt-durable-record.test.js',
    'test/runtime-execution-attempt-persistence-postgres.test.js'
  ]),
  'postgres-persistence': Object.freeze([
    'test/runtime-execution-job-admission-postgres.integration.test.js',
    'test/runtime-execution-attempt-persistence-postgres.integration.test.js',
    'test/runtime-execution-attempt-admission-postgres.integration.test.js',
    'test/runtime-execution-attempt-claim-canonical-identity.test.js',
    'test/hermes-vps-postgres-authorization-lifecycle-persistence.test.js',
    'test/postgres-confirmation-persistence.test.js'
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
const RESIDUAL_SHARD_COUNT = 6;

// Measured on the current residual set with bounded per-file runs. The values are only
// scheduling weights; they do not change membership or test semantics. Unknown/new files
// deliberately default to weight 1 and are assigned deterministically.
const RESIDUAL_FILE_WEIGHTS = Object.freeze({
  'test/execution-gateway-boundary-simulation.test.js': 12,
  'test/execution-preparation-requirement-boundary.test.js': 12,
  'test/execution-plan-contracts.test.js': 6,
  'test/execution-plan-stage-manifest-integrity.test.js': 6,
  'test/execution-reference-binding-provenance.test.js': 4,
  'test/public-web-canary-admission-authorization-request-binding.test.js': 12,
  'test/public-web-canary-execution-intent-admission-simulation-boundary.test.js': 12,
  'test/public-web-canary-execution-intent-simulation-boundary.test.js': 12,
  'test/public-web-canary-preflight-readiness-boundary.test.js': 12,
  'test/public-web-canary-queued-simulation-boundary.test.js': 12,
  'test/public-web-canary-queued-simulation-handoff.test.js': 12
});

function validateShardSpec(shardIndex, shardCount) {
  const errors = [];
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    errors.push('shard count must be a positive integer');
  }
  if (!Number.isInteger(shardIndex) || shardIndex < 1) {
    errors.push('shard index must be a positive integer');
  }
  if (errors.length === 0 && shardIndex > shardCount) {
    errors.push('shard index must not exceed shard count');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function assertValidShardSpec(shardIndex, shardCount) {
  const validation = validateShardSpec(shardIndex, shardCount);
  if (!validation.valid) {
    throw new RangeError(`invalid residual shard: ${validation.errors.join('; ')}`);
  }
}

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

function distributeResidualFiles(residual, shardCount) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new RangeError('invalid residual shard count: must be a positive integer');
  }
  const shards = Array.from({ length: shardCount }, () => []);
  const loads = Array.from({ length: shardCount }, () => 0);
  const ordered = [...residual].sort((left, right) => {
    const weightDelta = (RESIDUAL_FILE_WEIGHTS[right] || 1) - (RESIDUAL_FILE_WEIGHTS[left] || 1);
    return weightDelta || left.localeCompare(right);
  });
  for (const file of ordered) {
    let target = 0;
    for (let index = 1; index < shardCount; index += 1) {
      if (loads[index] < loads[target]) target = index;
    }
    shards[target].push(file);
    loads[target] += RESIDUAL_FILE_WEIGHTS[file] || 1;
  }
  return shards.map((files) => files.sort());
}

function getResidualShardFiles(shardIndex, shardCount, testDir) {
  assertValidShardSpec(shardIndex, shardCount);
  const files = distributeResidualFiles(getResidualFiles(testDir), shardCount)[shardIndex - 1];
  if (files.length === 0) {
    throw new RangeError(`residual shard ${shardIndex}/${shardCount} contains no test files`);
  }
  return files;
}

function getResidualShards(shardCount, testDir) {
  return distributeResidualFiles(getResidualFiles(testDir), shardCount);
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
  RESIDUAL_SHARD_COUNT,
  validateShardSpec,
  getGroupedFiles,
  getResidualFiles,
  getResidualShardFiles,
  getResidualShards,
  validatePartition
};
