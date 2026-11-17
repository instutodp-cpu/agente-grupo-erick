'use strict';

const REVERSE_DOMAINS = Object.freeze([
  'BANK', 'FISCAL', 'INVENTORY', 'PAYROLL', 'CARD', 'AP_AR', 'LEDGER'
]);
const RUN_STATUSES = Object.freeze(['RUNNING']);
const EXCEPTION_STATUSES = Object.freeze(['OPEN', 'RESOLVED']);
const ALLOWED_ACTIONS = Object.freeze(['READ', 'TRACE', 'EXPLAIN', 'BLOCK']);
const DENIED_ACTIONS = Object.freeze(['SOURCE_CORRECT', 'JOURNAL_CORRECT', 'PAYMENT_EXECUTE', 'FISCAL_SUBMIT']);
const COMPETENCE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}
function failure(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}
function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw failure('REQUIRED_FIELD', field + ' is required');
  }
  return value;
}
function strictCompetence(value) {
  if (typeof value !== 'string' || !COMPETENCE_RE.test(value)) {
    throw failure('INVALID_COMPETENCE', 'period must be YYYY-MM');
  }
  return value;
}
function strictInstant(value, field) {
  if (typeof value !== 'string' || !INSTANT_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw failure('INVALID_INSTANT', field + ' must be an ISO UTC instant');
  }
  return value;
}
function uniqueStrings(values, field) {
  if (!Array.isArray(values)) throw failure('INVALID_LIST', field + ' must be an array');
  const result = [];
  const seen = new Set();
  for (const value of values) {
    requiredString(value, field + ' item');
    if (seen.has(value)) throw failure('DUPLICATE_ID', field + ' contains duplicates');
    seen.add(value);
    result.push(value);
  }
  return result;
}
function requiredNode(node, field) {
  if (!node || typeof node !== 'object') throw failure('INVALID_NODE', field + ' must be an object');
  const id = requiredString(node.id, field + '.id');
  const type = requiredString(node.type, field + '.type');
  return { ...node, id, type };
}
function safeCents(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw failure('INVALID_CENTS', field + ' must be a non-negative safe integer');
  }
  return value;
}

function createReverseAuditRun(input = {}) {
  const runId = requiredString(input.runId, 'runId');
  const tenantId = requiredString(input.tenantId, 'tenantId');
  const companyId = requiredString(input.companyId, 'companyId');
  const period = strictCompetence(input.period);
  const domain = requiredString(input.domain, 'domain');
  const startedAt = strictInstant(input.startedAt, 'startedAt');
  if (!REVERSE_DOMAINS.includes(domain)) throw failure('UNSUPPORTED_DOMAIN', 'unsupported reverse audit domain');
  const status = input.status ?? 'RUNNING';
  if (!RUN_STATUSES.includes(status)) throw failure('UNSUPPORTED_STATUS', 'reverse audit run must start RUNNING');
  return deepFreeze({
    runId, tenantId, companyId, period, domain, startedAt, status,
    simulationOnly: true, autoCorrection: false
  });
}

function bidirectionalTrace({ sourceIds = [], ledgerIds = [] } = {}) {
  const source = uniqueStrings(sourceIds, 'sourceIds');
  const ledger = uniqueStrings(ledgerIds, 'ledgerIds');
  const sourceSet = new Set(source);
  const ledgerSet = new Set(ledger);
  const missingFromLedger = source.filter(id => !ledgerSet.has(id));
  const unsupportedInLedger = ledger.filter(id => !sourceSet.has(id));
  return deepFreeze({
    missingFromLedger, unsupportedInLedger,
    pass: missingFromLedger.length === 0 && unsupportedInLedger.length === 0
  });
}

function traceExpectedChain({ nodes = [], requiredTypes = [] } = {}) {
  if (!Array.isArray(nodes)) throw failure('INVALID_LIST', 'nodes must be an array');
  const required = uniqueStrings(requiredTypes, 'requiredTypes');
  const normalized = nodes.map((node, index) => requiredNode(node, 'nodes[' + index + ']'));
  const ids = normalized.map(node => node.id);
  if (new Set(ids).size !== ids.length) throw failure('DUPLICATE_ID', 'nodes contains duplicate IDs');
  const present = new Set(normalized.map(node => node.type));
  const missingTypes = required.filter(type => !present.has(type));
  const nodeIds = new Set(ids);
  const orphanNodeIds = normalized
    .filter(node => node.parentId !== undefined && node.parentId !== null && !nodeIds.has(node.parentId))
    .map(node => node.id);
  return deepFreeze({
    pass: missingTypes.length === 0 && orphanNodeIds.length === 0,
    missingTypes, orphanNodeIds
  });
}

function amountTieOut({ upstreamCents, downstreamCents } = {}) {
  const upstream = safeCents(upstreamCents, 'upstreamCents');
  const downstream = safeCents(downstreamCents, 'downstreamCents');
  const varianceCents = downstream - upstream;
  return deepFreeze({
    upstreamCents: upstream, downstreamCents: downstream, varianceCents,
    status: varianceCents === 0 ? 'MATCHED' : 'EXCEPTION'
  });
}

function createReverseAuditException(input = {}) {
  const exceptionId = requiredString(input.exceptionId, 'exceptionId');
  const runId = requiredString(input.runId, 'runId');
  const domain = requiredString(input.domain, 'domain');
  const kind = requiredString(input.kind, 'kind');
  const description = requiredString(input.description, 'description');
  if (!REVERSE_DOMAINS.includes(domain)) throw failure('UNSUPPORTED_DOMAIN', 'unsupported reverse audit domain');
  const evidenceIds = uniqueStrings(input.evidenceIds ?? [], 'evidenceIds');
  return deepFreeze({
    exceptionId, runId, domain, kind, description, evidenceIds,
    status: 'OPEN', requiresHumanReview: true, autoCorrection: false
  });
}

function assessReverseAudit({ traces = [], tieOuts = [], exceptions = [] } = {}) {
  if (!Array.isArray(traces) || !Array.isArray(tieOuts) || !Array.isArray(exceptions)) {
    throw failure('INVALID_LIST', 'traces, tieOuts and exceptions must be arrays');
  }
  const failedTrace = traces.some(trace => trace?.pass !== true);
  const failedTie = tieOuts.some(tieOut => tieOut?.status !== 'MATCHED');
  const openExceptions = exceptions.filter(exception => !EXCEPTION_STATUSES.includes(exception?.status));
  const unresolved = exceptions.filter(exception => exception.status !== 'RESOLVED');
  return deepFreeze({
    status: failedTrace || failedTie || openExceptions.length > 0 || unresolved.length > 0 ? 'EXCEPTIONS' : 'PASS',
    openExceptions: unresolved.length
  });
}

function assertReverseAuditAction(action) {
  requiredString(action, 'action');
  if (DENIED_ACTIONS.includes(action) || !ALLOWED_ACTIONS.includes(action)) {
    throw failure('DENIED', 'reverse audit action is not permitted');
  }
  return true;
}

module.exports = {
  REVERSE_DOMAINS,
  createReverseAuditRun,
  bidirectionalTrace,
  traceExpectedChain,
  amountTieOut,
  createReverseAuditException,
  assessReverseAudit,
  assertReverseAuditAction
};
