'use strict';

const Module = require('node:module');

const PROFILE_ENABLED = process.env.HERMES_QUEUE_ADMISSION_PROFILE === '1';
const WRAPPED = Symbol.for('hermes.queueAdmissionProfile.wrapped');
const startedAtNs = process.hrtime.bigint();

function nsToMs(ns) {
  return Number(ns) / 1e6;
}

function createOperationStats() {
  return {
    calls: 0,
    totalNs: 0n,
    maxNs: 0n,
    samplesNs: [],
    keys: new Map(),
    fields: Object.create(null)
  };
}

const stats = {
  enabled: PROFILE_ENABLED,
  operations: new Map(),
  overheadNs: 0n
};

function getOperation(name) {
  if (!stats.operations.has(name)) stats.operations.set(name, createOperationStats());
  return stats.operations.get(name);
}

function recordField(operationName, field, amount = 1) {
  if (!PROFILE_ENABLED) return;
  const operation = getOperation(operationName);
  operation.fields[field] = (operation.fields[field] || 0) + amount;
}

function record(operationName, elapsedNs, key) {
  if (!PROFILE_ENABLED) return;
  const overheadStart = process.hrtime.bigint();
  const operation = getOperation(operationName);
  operation.calls += 1;
  operation.totalNs += elapsedNs;
  if (elapsedNs > operation.maxNs) operation.maxNs = elapsedNs;
  operation.samplesNs.push(elapsedNs);
  if (key !== undefined && key !== null) {
    operation.keys.set(key, (operation.keys.get(key) || 0) + 1);
  }
  stats.overheadNs += process.hrtime.bigint() - overheadStart;
}

function measure(operationName, key, fn) {
  if (!PROFILE_ENABLED) return fn();
  const start = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    record(operationName, process.hrtime.bigint() - start, key);
  }
}

function normalizeScenarioKey(scenarioKey) {
  return scenarioKey === undefined ? 'prepared-no-llm-plan' : scenarioKey;
}

function describeOverrides(overrides) {
  if (overrides === undefined) return 'overrides:none';
  if (!overrides || typeof overrides !== 'object') return `overrides:${typeof overrides}`;
  const keys = Object.keys(overrides).sort();
  if (keys.length === 0) return 'overrides:empty';
  return `overrides:${keys.map((key) => {
    const value = overrides[key];
    if (value === null) return `${key}=null`;
    if (Array.isArray(value)) return `${key}=array:${value.length}`;
    if (value && typeof value === 'object') return `${key}=keys:${Object.keys(value).sort().join(',')}`;
    return `${key}=${typeof value}`;
  }).join(';')}`;
}

function buildArgsKey(args) {
  const scenarioKey = normalizeScenarioKey(args[0]);
  return `scenario:${scenarioKey}|${describeOverrides(args[1])}`;
}

function requestKey(request, context) {
  if (!request || typeof request !== 'object') return `request:${typeof request}`;
  const replay = request.runtime_queue_admission_replay_reference || {};
  const registry = request.registry_snapshot_reference || {};
  const intents = Array.isArray(request.runtime_dispatch_intent_references)
    ? request.runtime_dispatch_intent_references
    : [];
  const classes = Array.isArray(request.runtime_queue_class_references)
    ? request.runtime_queue_class_references
    : [];
  const quotas = Array.isArray(request.runtime_queue_quota_references)
    ? request.runtime_queue_quota_references
    : [];
  const contextKeys = context && typeof context === 'object' ? Object.keys(context).sort().join(',') : typeof context;
  return [
    request.runtime_queue_admission_request_id || 'request:none',
    replay.runtime_queue_admission_request_fingerprint || replay.replay_fingerprint || 'request_fp:none',
    registry.snapshot_fingerprint || (registry === null ? 'registry:null' : 'registry:none'),
    `seq:${request.logical_sequence}`,
    `intents:${intents.length}:${intents[0] && intents[0].dispatch_intent_reference_id}:${intents[intents.length - 1] && intents[intents.length - 1].dispatch_intent_reference_id}`,
    `classes:${classes.length}`,
    `quotas:${quotas.length}`,
    `ctx:${contextKeys}`
  ].join('|');
}

function valueKey(value) {
  if (!value || typeof value !== 'object') return `value:${typeof value}`;
  const fingerprint = value.queue_admission_package_fingerprint
    || value.runtime_queue_admission_decision_fingerprint
    || value.runtime_queue_admission_request_fingerprint
    || value.snapshot_fingerprint
    || value.dispatch_package_fingerprint
    || value.replay_fingerprint
    || value.idempotency_fingerprint;
  const id = value.runtime_queue_admission_request_id
    || value.runtime_queue_admission_package_id
    || value.runtime_queue_admission_decision_id
    || value.runtime_queue_admission_result_id
    || value.execution_registry_snapshot_reference_id
    || value.runtime_queue_class_reference_id
    || value.baseId;
  if (fingerprint || id) return `${id || 'id:none'}|${fingerprint || 'fp:none'}`;
  if (Array.isArray(value)) return `array:${value.length}`;
  return `object:${Object.keys(value).sort().slice(0, 12).join(',')}`;
}

function wrapFunction(fn, operationName, keyBuilder) {
  if (!PROFILE_ENABLED || typeof fn !== 'function' || fn[WRAPPED]) return fn;
  const wrapped = function profiledFunction(...args) {
    return measure(operationName, keyBuilder ? keyBuilder(args) : undefined, () => fn.apply(this, args));
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}

function wrapExports(filename, exported) {
  if (!PROFILE_ENABLED || !exported || typeof exported !== 'object') return exported;

  if (filename.endsWith('runtime-queue-admission-boundary.js')) {
    exported.evaluateRuntimeQueueAdmissionRequest = wrapFunction(
      exported.evaluateRuntimeQueueAdmissionRequest,
      'evaluateRuntimeQueueAdmissionRequest',
      (args) => requestKey(args[0], args[1])
    );
  }

  if (filename.endsWith('queue-simulation-hardening-test-helpers.js')) {
    exported.canonicalSnapshot = wrapFunction(
      exported.canonicalSnapshot,
      'canonicalSnapshot',
      (args) => valueKey(args[0])
    );
    exported.deepFreeze = wrapFunction(
      exported.deepFreeze,
      'cloneFreeze',
      (args) => valueKey(args[0])
    );
  }

  if (filename.endsWith('canonical-content-digest.js')) {
    exported.computeCanonicalContentDigest = wrapFunction(
      exported.computeCanonicalContentDigest,
      'registryFingerprintDigest',
      (args) => valueKey(args[0])
    );
  }

  if (filename.endsWith('execution-registry-snapshot-reference.js')) {
    exported.computeSnapshotFingerprint = wrapFunction(
      exported.computeSnapshotFingerprint,
      'registryFingerprintDigest',
      (args) => valueKey(args[0])
    );
  }

  return exported;
}

function installQueueAdmissionProfileRequireHooks() {
  if (!PROFILE_ENABLED || Module._load[WRAPPED]) return;
  const originalLoad = Module._load;
  const wrappedLoad = function profiledLoad(request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);
    let filename = '';
    try {
      filename = Module._resolveFilename(request, parent, isMain);
    } catch {
      return exported;
    }
    return wrapExports(String(filename).replace(/\\/g, '/'), exported);
  };
  Object.defineProperty(wrappedLoad, WRAPPED, { value: true });
  Module._load = wrappedLoad;
}

function percentile(sortedSamples, ratio) {
  if (sortedSamples.length === 0) return 0;
  const index = Math.min(sortedSamples.length - 1, Math.floor((sortedSamples.length - 1) * ratio));
  return nsToMs(sortedSamples[index]);
}

function summarizeOperation(name, operation) {
  const sortedSamples = [...operation.samplesNs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const duplicateCalls = [...operation.keys.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return {
    operation: name,
    calls: operation.calls,
    unique_semantic_keys: operation.keys.size,
    duplicate_calls: duplicateCalls,
    duplicate_ratio: operation.calls === 0 ? 0 : Number((duplicateCalls / operation.calls).toFixed(4)),
    total_ms: Number(nsToMs(operation.totalNs).toFixed(3)),
    avg_ms: operation.calls === 0 ? 0 : Number(nsToMs(operation.totalNs / BigInt(operation.calls)).toFixed(3)),
    p50_ms: Number(percentile(sortedSamples, 0.5).toFixed(3)),
    p95_ms: Number(percentile(sortedSamples, 0.95).toFixed(3)),
    max_ms: Number(nsToMs(operation.maxNs).toFixed(3)),
    ...operation.fields
  };
}

function buildSummary() {
  const operations = [...stats.operations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, operation]) => summarizeOperation(name, operation));
  const operationByName = Object.fromEntries(operations.map((operation) => [operation.operation, operation]));
  const topLevelNames = ['buildGoldenQueueAdmissionBundle', 'evaluateRuntimeQueueAdmissionRequest', 'canonicalSnapshot'];
  const accountedMs = topLevelNames.reduce((sum, name) => sum + (operationByName[name] ? operationByName[name].total_ms : 0), 0);
  const jobTotalMs = nsToMs(process.hrtime.bigint() - startedAtNs);
  const build = operationByName.buildGoldenQueueAdmissionBundle;
  if (build) {
    build.requested_builds = build.calls;
    build.consumer_rebuilds_after_cache = build.consumer_rebuilds_after_cache || 0;
    build.avoidable_rebuild_candidates = build.duplicate_calls;
  }
  const evaluation = operationByName.evaluateRuntimeQueueAdmissionRequest;
  if (evaluation) {
    evaluation.total_evaluations = evaluation.calls;
    evaluation.unique_requests = evaluation.unique_semantic_keys;
    evaluation.repeated_equivalent_requests = evaluation.duplicate_calls;
    evaluation.semantically_required_repetitions = null;
    evaluation.potentially_avoidable_repetitions = evaluation.duplicate_calls;
  }
  return {
    HERMES_QUEUE_ADMISSION_PROFILE: true,
    job_total_ms: Number(jobTotalMs.toFixed(3)),
    operations,
    ACCOUNTED_TIME_MS: Number(accountedMs.toFixed(3)),
    UNACCOUNTED_TIME_MS: Number(Math.max(0, jobTotalMs - accountedMs).toFixed(3)),
    PROFILE_OVERHEAD_ESTIMATE: {
      measured_aggregation_ms: Number(nsToMs(stats.overheadNs).toFixed(3)),
      ratio: jobTotalMs === 0 ? 0 : Number((nsToMs(stats.overheadNs) / jobTotalMs).toFixed(6))
    }
  };
}

function printQueueAdmissionProfileSummary() {
  if (!PROFILE_ENABLED) return;
  console.log('HERMES_QUEUE_ADMISSION_PROFILE');
  console.log(JSON.stringify(buildSummary(), null, 2));
}

if (PROFILE_ENABLED) {
  installQueueAdmissionProfileRequireHooks();
  process.on('exit', printQueueAdmissionProfileSummary);
}

module.exports = {
  buildArgsKey,
  buildSummary,
  enabled: PROFILE_ENABLED,
  measure,
  record,
  recordField,
  requestKey,
  valueKey
};
