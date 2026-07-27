#!/usr/bin/env node
'use strict';

// Discovers every test/*.test.js file on disk and runs all of them via node's native test
// runner -- replacing the hand-maintained file list `npm test` used to carry in package.json.
// That manual list had already silently drifted: at the time this script was written,
// test/execution-reference-binding-provenance.test.js (87 tests, added by PR #100) had never once
// run under `npm test`, only ever under a direct `node --test <file>` invocation. This script (and
// the TEST_REGISTRATION_REQUIRED architecture gate built on top of it) exists specifically so that
// class of silent omission can never happen again.
//
// Deliberately dependency-free (no glob package) so it works identically on Windows and Linux --
// `fs.readdirSync` + `.endsWith('.test.js')` needs no shell globbing at all.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEST_DIR = path.join(__dirname, '..', 'test');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function discoverTestFiles(testDir = TEST_DIR) {
  if (!fs.existsSync(testDir)) return [];
  return fs.readdirSync(testDir)
    .filter((fileName) => fileName.endsWith('.test.js'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((fileName) => path.posix.join('test', fileName));
}

// --audit mode: compares discovered files against package.json's own `test` script, reporting any
// discovered file the script does not appear to run, and any file the script names that no longer
// exists on disk. Exits non-zero on any mismatch -- this is what
// architecture-gate-runner.js's TEST_REGISTRATION_REQUIRED gate, and CI, both call.
function auditRegistration() {
  const discovered = discoverTestFiles();
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const testScript = (packageJson.scripts && packageJson.scripts.test) || '';

  // The test script is allowed to run discovery itself (`node scripts/discover-tests.js` /
  // `node --test test/*.test.js`) rather than naming every file -- in that case every discovered
  // file is, by construction, registered.
  const scriptDelegatesDiscovery = /discover-tests\.js|test\/\*\.test\.js|--test\s+test\/?\s*$/.test(testScript);
  if (scriptDelegatesDiscovery) {
    return { discovered, missingFromScript: [], staleInScript: [], ok: discovered.length > 0 };
  }

  const namedInScript = (testScript.match(/test\/[\w.-]+\.test\.js/g) || []);
  const missingFromScript = discovered.filter((file) => !namedInScript.includes(file));
  const staleInScript = namedInScript.filter((file) => !fs.existsSync(path.join(__dirname, '..', file)));
  return { discovered, missingFromScript, staleInScript, ok: discovered.length > 0 && missingFromScript.length === 0 && staleInScript.length === 0 };
}

function runDiscoveredTests() {
  const discovered = discoverTestFiles();
  if (discovered.length === 0) {
    console.error('discover-tests: zero test files discovered under test/ -- refusing to report success on an empty suite');
    process.exitCode = 1;
    return;
  }
  const result = spawnSync(process.execPath, ['--test', ...discovered], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  process.exitCode = result.status === null ? 1 : result.status;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--audit')) {
    const audit = auditRegistration();
    console.log(`discover-tests --audit: ${audit.discovered.length} file(s) discovered`);
    if (audit.missingFromScript.length > 0) {
      console.error('Discovered but NOT registered in package.json test script:');
      audit.missingFromScript.forEach((file) => console.error(`  - ${file}`));
    }
    if (audit.staleInScript.length > 0) {
      console.error('Registered in package.json test script but missing on disk:');
      audit.staleInScript.forEach((file) => console.error(`  - ${file}`));
    }
    if (!audit.ok) {
      process.exitCode = 1;
      return;
    }
    console.log('discover-tests --audit: OK -- every discovered test file is registered');
    return;
  }
  runDiscoveredTests();
}

if (require.main === module) {
  main();
}

module.exports = {
  TEST_DIR,
  auditRegistration,
  discoverTestFiles,
  runDiscoveredTests
};
