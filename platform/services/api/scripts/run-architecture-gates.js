#!/usr/bin/env node
'use strict';

// CLI entry point for architecture-gate-runner.js. Exits non-zero and prints every finding if any
// gate fails -- meant to run in CI immediately after the syntax check and before `npm test`, so a
// forbidden pattern or a missing coverage entry fails fast, before spending time on the full suite.
const { runAllGates } = require('../src/core/architecture-gate-runner');

function main() {
  const findings = runAllGates();
  if (findings.length === 0) {
    console.log('run-architecture-gates: OK -- 22 gates checked, zero findings');
    return;
  }
  console.error(`run-architecture-gates: ${findings.length} finding(s):`);
  for (const finding of findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`  [${finding.gate}] ${location} -- ${finding.description}`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { main };
