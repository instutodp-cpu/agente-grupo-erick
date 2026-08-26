#!/usr/bin/env node
'use strict';

// CI-only entry point: runs a named manifest group or one deterministic residual shard.
// Local `npm test` is untouched and continues to run the full discovered suite.
//
// Refuses to run (and refuses to report success) if the manifest is out of sync with what's
// actually on disk -- a stale or duplicated group entry must fail the build, not silently
// under- or over-run the suite.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  GROUPS,
  validatePartition,
  validateShardSpec,
  getResidualShardFiles
} = require('./ci-test-groups');

function parseInvocation(args) {
  if (args.length !== 1) {
    throw new Error('expected exactly one argument: --shard=X/Y or --group=GROUP_NAME');
  }
  const shardMatch = /^--shard=(\d+)\/(\d+)$/.exec(args[0]);
  if (shardMatch) {
    const shardIndex = Number(shardMatch[1]);
    const shardCount = Number(shardMatch[2]);
    const validation = validateShardSpec(shardIndex, shardCount);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    return { mode: 'shard', shardIndex, shardCount };
  }
  const groupMatch = /^--group=([A-Za-z0-9-]+)$/.exec(args[0]);
  if (groupMatch) {
    const groupName = groupMatch[1];
    if (!GROUPS[groupName]) throw new Error(`unknown CI group: ${groupName}`);
    return { mode: 'group', groupName };
  }
  throw new Error('invalid argument: expected --shard=X/Y or --group=GROUP_NAME');
}

function main(args = process.argv.slice(2)) {
  let invocation;
  try {
    invocation = parseInvocation(args);
  } catch (error) {
    console.error(`run-ci-test-group: ${error.message}`);
    process.exitCode = 1;
    return;
  }
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

  let files;
  let label;
  try {
    if (invocation.mode === 'shard') {
      files = getResidualShardFiles(invocation.shardIndex, invocation.shardCount);
      label = `residual shard ${invocation.shardIndex}/${invocation.shardCount}`;
    } else {
      files = GROUPS[invocation.groupName];
      if (!files) throw new Error(`unknown CI group: ${invocation.groupName}`);
      label = `group ${invocation.groupName}`;
    }
  } catch (error) {
    console.error(`run-ci-test-group: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`run-ci-test-group: running ${files.length} file(s) in ${label} (${partition.discoveredCount} discovered)`);
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) {
  main();
}

module.exports = { main, parseInvocation };
