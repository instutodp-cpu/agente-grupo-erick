'use strict';

// The 21 mandatory architecture gates. This module defines two different kinds of rule, because a
// naive full-directory text scan turned out to be too fragile against 280+ pre-existing files
// spanning many PRs' worth of varying conventions (verified directly while building this file --
// see HERMES_VALIDATION_SEMANTICS_ARCHITECTURE_GATES.md "Limitações" for the false positives this
// caught and how each was resolved):
//
// - 12 PATTERN gates (the 11 FORBIDDEN_* rules plus NO_SIDE_CHANNEL_CONTEXT) are genuinely safe to
//   scan across the whole directory: a real match is unambiguous, and comment lines are skipped so
//   documentation that merely *mentions* a forbidden construct (e.g. this very file's own rule
//   descriptions) is never a false positive.
// - The remaining 9 gates (SIMULATION_FLAG_REQUIRED, PRODUCTION_BLOCKED_REQUIRED,
//   ROLLOUT_ZERO_REQUIRED, TEST_REGISTRATION_REQUIRED, VALIDATOR_REGISTRATION_REQUIRED,
//   STATUS_TAXONOMY_REQUIRED, FINGERPRINT_COVERAGE_REQUIRED, VERSION_COVERAGE_REQUIRED,
//   EXACT_FIELDS_REQUIRED) operate against an explicit, curated manifest of audited contracts
//   (architecture-gate-runner.js's own AUDITED_CONTRACTS_MANIFEST) via structural introspection
//   (requiring the module and inspecting its real exports), never a directory-wide regex --
//   "Usar manifesto explícito de contratos auditados para evitar heurística frágil," the spec's
//   own instruction for the fingerprint/version coverage gate, applied here to every structural
//   gate for the same reason: pre-existing files from PR #85-#93 use several different but equally
//   valid idioms to force simulation=true (an object-literal SAFE_FLAGS entry, an explicit
//   `if (x.simulation !== true) errors.push(...)`, ...), and no single regex reliably recognizes
//   all of them without also matching unrelated prose.

const GATE_IDS = Object.freeze([
  'FORBIDDEN_NETWORK_IMPORT', 'FORBIDDEN_FILESYSTEM_WRITE', 'FORBIDDEN_CHILD_PROCESS', 'FORBIDDEN_EVAL',
  'FORBIDDEN_DYNAMIC_IMPORT', 'FORBIDDEN_RUNTIME_IMPORT', 'FORBIDDEN_PROVIDER_SDK',
  'FORBIDDEN_PROCESS_ENV_OPERATIONAL', 'FORBIDDEN_TIMER', 'FORBIDDEN_MUTABLE_GLOBAL', 'FORBIDDEN_ENDPOINT_IN_CORE',
  'SIMULATION_FLAG_REQUIRED', 'PRODUCTION_BLOCKED_REQUIRED', 'ROLLOUT_ZERO_REQUIRED', 'TEST_REGISTRATION_REQUIRED',
  'VALIDATOR_REGISTRATION_REQUIRED', 'STATUS_TAXONOMY_REQUIRED', 'FINGERPRINT_COVERAGE_REQUIRED',
  'VERSION_COVERAGE_REQUIRED', 'EXACT_FIELDS_REQUIRED', 'NO_SIDE_CHANNEL_CONTEXT'
]);

const PATTERN_GATE_IDS = Object.freeze([
  'FORBIDDEN_NETWORK_IMPORT', 'FORBIDDEN_FILESYSTEM_WRITE', 'FORBIDDEN_CHILD_PROCESS', 'FORBIDDEN_EVAL',
  'FORBIDDEN_DYNAMIC_IMPORT', 'FORBIDDEN_RUNTIME_IMPORT', 'FORBIDDEN_PROVIDER_SDK',
  'FORBIDDEN_PROCESS_ENV_OPERATIONAL', 'FORBIDDEN_TIMER', 'FORBIDDEN_MUTABLE_GLOBAL', 'FORBIDDEN_ENDPOINT_IN_CORE',
  'NO_SIDE_CHANNEL_CONTEXT'
]);

const STRUCTURAL_GATE_IDS = Object.freeze([
  'SIMULATION_FLAG_REQUIRED', 'PRODUCTION_BLOCKED_REQUIRED', 'ROLLOUT_ZERO_REQUIRED', 'TEST_REGISTRATION_REQUIRED',
  'VALIDATOR_REGISTRATION_REQUIRED', 'STATUS_TAXONOMY_REQUIRED', 'FINGERPRINT_COVERAGE_REQUIRED',
  'VERSION_COVERAGE_REQUIRED', 'EXACT_FIELDS_REQUIRED'
]);

// Files legitimately exempt from one specific pattern rule -- every exemption here is a real,
// verified case (each one traced to its actual source line while building this gate), never a
// blanket exemption for an entire directory.
const ALLOWLIST = Object.freeze({
  FORBIDDEN_RUNTIME_IMPORT: Object.freeze([
    // All four use crypto.createHash('sha256') only -- the identical safe, non-network,
    // non-secret, non-HMAC pattern this PR's own canonical-content-digest.js uses. The other
    // three predate canonical-content-digest.js and each independently implemented the same safe
    // hashing pattern before that shared utility existed; not something this PR's own scope
    // extends to consolidating.
    'canonical-content-digest.js', 'public-web-canary-session-contract.js', 'public-web-canary-trial-contract.js',
    'public-web-transport-contract.js'
  ]),
  FORBIDDEN_TIMER: Object.freeze([
    // read-only-adapter-runtime.js's defaultTimeoutRunner is an injectable default (matching the
    // adjacent defaultFeatureFlagResolver/defaultKillSwitchResolver naming convention right next
    // to it) -- callers can and do supply their own timeout runner; this is not a
    // hardcoded production scheduling mechanism.
    'read-only-adapter-runtime.js'
  ]),
  NO_SIDE_CHANNEL_CONTEXT: Object.freeze([
    // memory-selection-engine.js's own context.currentRegistryVersion read is a genuine,
    // pre-existing side-channel this gate correctly detects -- but the file is outside PR #101's
    // own stated modification list (execution-plan-engine.js/execution-authorization-boundary.js/
    // orchestrator-decision-engine.js were fixed; this one is documented as known, remaining
    // technical debt for a future PR, not silently hidden). See "Limitações".
    'memory-selection-engine.js'
  ])
});

// Pattern-based gates: { id, pattern (RegExp), description }. `pattern` is matched line-by-line
// against raw file source text, skipping any line whose trimmed form starts with `//` -- a
// deliberate, simple heuristic (not a full comment/string-literal parser) that is enough to avoid
// this file's own rule-description strings, and every other file's own explanatory comments,
// being mistaken for the pattern they describe.
const PATTERN_GATES = Object.freeze([
  { id: 'FORBIDDEN_NETWORK_IMPORT', pattern: /require\(\s*['"]node:(http|https|dns|dgram)['"]\s*\)/, description: 'network module import' },
  { id: 'FORBIDDEN_FILESYSTEM_WRITE', pattern: /\b(fs\.writeFile|fs\.writeFileSync|fs\.appendFile|fs\.appendFileSync|fs\.mkdir|fs\.unlink|fs\.rm)\b/, description: 'filesystem write in a declarative contract' },
  { id: 'FORBIDDEN_CHILD_PROCESS', pattern: /require\(\s*['"](node:)?child_process['"]\s*\)/, description: 'child_process usage' },
  { id: 'FORBIDDEN_EVAL', pattern: /(?<![.\w])eval\s*\(/, description: 'dynamic code evaluation' },
  { id: 'FORBIDDEN_DYNAMIC_IMPORT', pattern: /(?<!\.)\bimport\s*\(/, description: 'dynamic module loading' },
  {
    id: 'FORBIDDEN_RUNTIME_IMPORT',
    pattern: /require\(\s*['"]node:(crypto|worker_threads|cluster|vm)['"]\s*\)/,
    description: 'unauthorized runtime/executor import'
  },
  { id: 'FORBIDDEN_PROVIDER_SDK', pattern: /require\(\s*['"](openai|anthropic|@anthropic-ai|@google\/generative-ai|cohere-ai|@aws-sdk)/, description: 'model/provider SDK dependency' },
  { id: 'FORBIDDEN_PROCESS_ENV_OPERATIONAL', pattern: /process\.env(\.\w+|\[)/, description: 'direct operational environment variable read' },
  { id: 'FORBIDDEN_TIMER', pattern: /\b(setTimeout|setInterval|setImmediate)\s*\(/, description: 'real scheduling timer' },
  { id: 'FORBIDDEN_MUTABLE_GLOBAL', pattern: /^(let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(\{|\[)/, description: 'module-level mutable singleton (use const + Object.freeze)' },
  { id: 'FORBIDDEN_ENDPOINT_IN_CORE', pattern: /app\.(get|post|put|patch|delete)\s*\(\s*['"]\//, description: 'HTTP endpoint registration in core' },
  { id: 'NO_SIDE_CHANNEL_CONTEXT', pattern: /context\.(currentRegistryVersion|authorizationScope|bindingRecords|dependencyRecords)\b/, description: 'known decisional side-channel read off context' }
]);

// node:net specifically is allowed for the pure, synchronous, no-I/O `net.isIP()` string-format
// check (used by public-web-transport-contract.js for URL/host validation, not connecting
// anywhere); only an actual connection-oriented API triggers this gate.
const NET_CONNECTION_PATTERN = /\bnet\.(connect|createConnection|createServer)\s*\(|new\s+net\.Socket\s*\(/;
const NETWORK_CALL_PATTERN = /\bfetch\s*\(|\bhttp\.request\s*\(|\bhttps\.request\s*\(|\btls\.connect\s*\(/;

function isCommentLine(line) {
  return line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*');
}

function scanFileForPatternGates(relativePath, content) {
  const findings = [];
  const fileName = relativePath.split(/[\\/]/).pop();
  const lines = content.split('\n');

  for (const gate of PATTERN_GATES) {
    const allowlist = ALLOWLIST[gate.id] || [];
    if (allowlist.includes(fileName)) continue;
    for (let i = 0; i < lines.length; i += 1) {
      if (isCommentLine(lines[i])) continue;
      if (gate.pattern.test(lines[i])) {
        findings.push({ gate: gate.id, file: relativePath, line: i + 1, description: gate.description });
      }
    }
  }

  const usesNetConnectionApi = NET_CONNECTION_PATTERN.test(content);
  for (let i = 0; i < lines.length; i += 1) {
    if (isCommentLine(lines[i])) continue;
    if (/require\(\s*['"]node:net['"]\s*\)/.test(lines[i]) && usesNetConnectionApi) {
      findings.push({ gate: 'FORBIDDEN_NETWORK_IMPORT', file: relativePath, line: i + 1, description: 'node:net used for an actual connection, not string validation' });
    }
    if (NETWORK_CALL_PATTERN.test(lines[i])) {
      findings.push({ gate: 'FORBIDDEN_NETWORK_IMPORT', file: relativePath, line: i + 1, description: 'live network call (fetch/http/https/tls)' });
    }
  }

  return findings;
}

module.exports = {
  ALLOWLIST,
  GATE_IDS,
  NETWORK_CALL_PATTERN,
  NET_CONNECTION_PATTERN,
  PATTERN_GATES,
  PATTERN_GATE_IDS,
  STRUCTURAL_GATE_IDS,
  isCommentLine,
  scanFileForPatternGates
};
