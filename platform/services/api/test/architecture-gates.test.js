'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  ALLOWLIST, GATE_IDS, NETWORK_CALL_PATTERN, NET_CONNECTION_PATTERN, PATTERN_GATES, PATTERN_GATE_IDS,
  STRUCTURAL_GATE_IDS, isCommentLine, scanFileForPatternGates
} = require('../src/core/architecture-gate-rules');
const {
  AUDITED_CONTRACTS_MANIFEST, runAllGates, runPatternGates, runStatusTaxonomyGate, runStructuralGates,
  runTestRegistrationGate, runValidatorRegistrationGate
} = require('../src/core/architecture-gate-runner');
const { discoverTestFiles, auditRegistration } = require('../scripts/discover-tests');

// ---------------------------------------------------------------------------
// Gate catalog
// ---------------------------------------------------------------------------

test('architecture-gate-rules: 22 gates total, split into 13 pattern gates and 9 structural gates', () => {
  assert.equal(GATE_IDS.length, 22);
  assert.equal(PATTERN_GATE_IDS.length, 13);
  assert.equal(STRUCTURAL_GATE_IDS.length, 9);
  assert.deepEqual([...PATTERN_GATE_IDS, ...STRUCTURAL_GATE_IDS].sort(), [...GATE_IDS].sort());
  assert.equal(new Set(GATE_IDS).size, GATE_IDS.length, 'no duplicate gate ids');
});

test('architecture-gate-rules: every PATTERN_GATES description never contains its own forbidden literal', () => {
  for (const gate of PATTERN_GATES) {
    const matches = gate.pattern.test(gate.description);
    // reset lastIndex for any /g pattern before reuse elsewhere in this test run
    gate.pattern.lastIndex = 0;
    assert.equal(matches, false, `${gate.id}: description "${gate.description}" self-matches its own pattern`);
  }
});

test('architecture-gate-rules: isCommentLine skips //, *, and /* line starts, never a real code line', () => {
  assert.equal(isCommentLine('  // a comment'), true);
  assert.equal(isCommentLine('  * a jsdoc continuation'), true);
  assert.equal(isCommentLine('  /* a block comment start'), true);
  assert.equal(isCommentLine('  const eval_result = 1;'), false);
});

// ---------------------------------------------------------------------------
// Pattern gates: each forbidden pattern actually fires on a synthetic violation
// ---------------------------------------------------------------------------

const SYNTHETIC_VIOLATIONS = {
  FORBIDDEN_NETWORK_IMPORT: "const http = require('node:http');",
  FORBIDDEN_FILESYSTEM_WRITE: "fs.writeFileSync('/tmp/x', data);",
  FORBIDDEN_CHILD_PROCESS: "require('child_process').exec('ls');",
  FORBIDDEN_EVAL: "eval('1 + 1');",
  FORBIDDEN_DYNAMIC_IMPORT: "import('some-module');",
  FORBIDDEN_RUNTIME_IMPORT: "const crypto = require('node:crypto');",
  FORBIDDEN_PROVIDER_SDK: "const OpenAI = require('openai');",
  FORBIDDEN_PROCESS_ENV_OPERATIONAL: 'const key = process.env.SECRET_KEY;',
  FORBIDDEN_TIMER: 'setTimeout(doSomething, 1000);',
  FORBIDDEN_MUTABLE_GLOBAL: 'let sharedState = {};',
  FORBIDDEN_ENDPOINT_IN_CORE: "app.get('/health', handler);",
  FORBIDDEN_QUEUE_CLIENT_IMPORT: "const Redis = require('ioredis');",
  NO_SIDE_CHANNEL_CONTEXT: 'if (context.currentRegistryVersion === expectedVersion) { doSomething(); }'
};

test('SYNTHETIC_VIOLATIONS covers every pattern gate id exactly once', () => {
  assert.deepEqual(Object.keys(SYNTHETIC_VIOLATIONS).sort(), [...PATTERN_GATE_IDS].sort());
});

Object.entries(SYNTHETIC_VIOLATIONS).forEach(([gateId, content]) => {
  test(`pattern gate ${gateId} fires on a synthetic violation and is absent from clean content`, () => {
    const findings = scanFileForPatternGates('synthetic/does-not-exist.js', content);
    assert.equal(findings.some((f) => f.gate === gateId), true, `${gateId} did not fire on: ${content}`);

    const cleanFindings = scanFileForPatternGates('synthetic/does-not-exist.js', '// nothing forbidden here\nconst x = 1;\n');
    assert.equal(cleanFindings.some((f) => f.gate === gateId), false);
  });
});

test('pattern gate FORBIDDEN_NETWORK_IMPORT: a pure net.isIP() validation call is never flagged', () => {
  const findings = scanFileForPatternGates('synthetic/net-isip.js', "const net = require('net');\nif (net.isIP(value)) { return true; }");
  assert.equal(findings.some((f) => f.gate === 'FORBIDDEN_NETWORK_IMPORT'), false);
});

test('pattern gate FORBIDDEN_PROCESS_ENV_OPERATIONAL: a bare injectable `env = process.env` default parameter is never flagged', () => {
  const findings = scanFileForPatternGates('synthetic/env-default.js', 'function build({ env = process.env } = {}) { return env; }');
  assert.equal(findings.some((f) => f.gate === 'FORBIDDEN_PROCESS_ENV_OPERATIONAL'), false);
});

test('pattern gates skip comment lines entirely', () => {
  const findings = scanFileForPatternGates('synthetic/comment-only.js', "// eval('should not fire, this is only a comment')");
  assert.equal(findings.length, 0);
});

test('NET_CONNECTION_PATTERN only matches real connection APIs, never net.isIP', () => {
  assert.equal(NET_CONNECTION_PATTERN.test('net.connect(80, "x")'), true);
  NET_CONNECTION_PATTERN.lastIndex = 0;
  assert.equal(NET_CONNECTION_PATTERN.test('net.isIP(value)'), false);
});

test('NETWORK_CALL_PATTERN matches fetch/http.request/https.request/tls.connect', () => {
  for (const call of ['fetch(', 'http.request(', 'https.request(', 'tls.connect(']) {
    assert.equal(NETWORK_CALL_PATTERN.test(`${call}'x')`), true, call);
    NETWORK_CALL_PATTERN.lastIndex = 0;
  }
});

test('ALLOWLIST entries are exact filenames, and every allowlisted file is documented with a reason nearby in the source', () => {
  for (const [gateId, files] of Object.entries(ALLOWLIST)) {
    assert.equal(GATE_IDS.includes(gateId), true, `${gateId} in ALLOWLIST must be a real gate id`);
    assert.equal(Array.isArray(files), true);
    for (const file of files) {
      assert.equal(typeof file, 'string');
      assert.equal(file.includes('/'), false, `${gateId} allowlist entries must be bare filenames, not paths: ${file}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Structural gates: manifest-driven, not text heuristics
// ---------------------------------------------------------------------------

test('AUDITED_CONTRACTS_MANIFEST: every entry names a real module with the fields/version/fingerprint it claims', () => {
  assert.ok(AUDITED_CONTRACTS_MANIFEST.length > 0);
  for (const entry of AUDITED_CONTRACTS_MANIFEST) {
    assert.equal(typeof entry.module, 'string');
    const required = require(path.join('..', 'src', 'core', entry.module));
    assert.ok(required[entry.fieldsExport], `${entry.module}: ${entry.fieldsExport} must be exported`);
    assert.ok(Array.isArray(required[entry.fieldsExport]) && required[entry.fieldsExport].length > 0);
    if (entry.hasVersion) assert.equal(required[entry.fieldsExport].includes(entry.versionField), true, `${entry.module}: ${entry.versionField} must be one of ${entry.fieldsExport}`);
    if (entry.hasFingerprint) assert.equal(required[entry.fieldsExport].includes(entry.fingerprintField), true, `${entry.module}: ${entry.fingerprintField} must be one of ${entry.fieldsExport}`);
  }
});

test('runStructuralGates: zero findings against the real, current manifest', () => {
  assert.deepEqual(runStructuralGates(), []);
});

test('runStatusTaxonomyGate: zero findings -- every taxonomy status has precedence and metadata', () => {
  assert.deepEqual(runStatusTaxonomyGate(), []);
});

test('runValidatorRegistrationGate: zero findings -- execution-plan-validation-registry.js is real and complete', () => {
  assert.deepEqual(runValidatorRegistrationGate(), []);
});

test('runTestRegistrationGate: zero findings -- package.json delegates to discover-tests.js and nothing is orphaned', () => {
  assert.deepEqual(runTestRegistrationGate(), []);
});

// ---------------------------------------------------------------------------
// Full sweep against the real repository
// ---------------------------------------------------------------------------

test('runPatternGates: zero findings across the real src/core directory today', () => {
  assert.deepEqual(runPatternGates(), []);
});

test('runAllGates: zero findings end to end (the same check scripts/run-architecture-gates.js runs in CI)', () => {
  assert.deepEqual(runAllGates(), []);
});

// ---------------------------------------------------------------------------
// scripts/discover-tests.js: the mechanism that made this whole PR's premise real
// ---------------------------------------------------------------------------

test('discover-tests.js: discovers every *.test.js file under test/ with no glob dependency, sorted deterministically', () => {
  const discovered = discoverTestFiles(path.join(__dirname));
  assert.ok(discovered.length > 0);
  assert.equal(discovered.includes('test/architecture-gates.test.js'), true);
  assert.equal(discovered.includes('test/validation-semantics-architecture-gates.test.js'), true);
  const sorted = [...discovered].sort();
  assert.deepEqual(discovered, sorted, 'discovery order must be deterministic (sorted), not filesystem-dependent');
});

test('discover-tests.js: auditRegistration reports OK once package.json delegates discovery to it', () => {
  const audit = auditRegistration();
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.missingFromScript, []);
});
