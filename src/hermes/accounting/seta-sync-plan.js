'use strict';

// Incremental load plan shared by every transport of the seta_read_v1
// adapter (FILE_EXPORT today, the official API once discovered). Both
// transports turn their input into the same canonical READ records and the
// same manifest entries (sourceId -> payloadHash, version), so switching a
// company from file exports to the API keeps idempotency: an unchanged
// record is ignored, a changed one becomes a new version, whatever brought
// it. No network, no database, no disk.

const { normalizeSetaRecord, decideSyncAction } = require('./seta-read-adapter');
const { stableHash } = require('./evidence-ledger');

const MANIFEST_VERSION = 1;
const MAX_REMEMBERED = 60;

function fail(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

function emptyManifest(identity) {
  return { version: MANIFEST_VERSION, tenantId: identity.tenantId, companyId: identity.companyId,
    kind: identity.kind, files: [], entries: {} };
}

// Multi-company isolation: a manifest never crosses tenant, company or kind.
function validateManifest(manifest, identity) {
  if (manifest == null) return emptyManifest(identity);
  if (manifest.version !== MANIFEST_VERSION || !Array.isArray(manifest.files) ||
      !manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries) ||
      (manifest.apiPages !== undefined && !Array.isArray(manifest.apiPages)) ||
      (manifest.apiCursor !== undefined && manifest.apiCursor !== null && typeof manifest.apiCursor !== 'string')) {
    throw fail('manifest is invalid');
  }
  if (manifest.tenantId !== identity.tenantId || manifest.companyId !== identity.companyId ||
      manifest.kind !== identity.kind) {
    throw fail('manifest belongs to another tenant, company or kind');
  }
  return manifest;
}

// One source row -> canonical record + sync decision. `entries` is the
// working copy of the manifest entries and is updated in place.
function planRecord(entries, { identity, sourceId, establishmentId, occurredAt, sourceUpdatedAt,
  receivedAt, evidenceId, payload }) {
  if (!/^[A-Za-z0-9._/-]{1,64}$/.test(sourceId || '')) throw fail('invalid_id');
  const record = normalizeSetaRecord({
    kind: identity.kind,
    id: `seta:${identity.companyId}:${identity.kind}:${sourceId}`,
    sourceId,
    tenantId: identity.tenantId,
    companyId: identity.companyId,
    establishmentId,
    occurredAt,
    sourceUpdatedAt,
    ingestedAt: receivedAt,
    evidenceIds: [evidenceId],
    payload
  });
  const previous = entries[sourceId];
  const action = decideSyncAction(previous ? { payload: { payloadHash: previous.payloadHash } } : null, record);
  if (action === 'IGNORE_IDENTICAL') return null;
  const version = (previous?.version || 0) + 1;
  entries[sourceId] = { payloadHash: record.payload.payloadHash, version, sourceUpdatedAt };
  return Object.freeze({ action, version, record });
}

// Remembered input hashes (files or API pages), newest last, bounded.
function remember(list, hash) {
  return [...(list || []), hash].slice(-MAX_REMEMBERED);
}

// ── Totals of one input (file or page), for quality gates and reconciliation.
// Counts and sums only: never a row's content.
const MONEY_TYPES = Object.freeze(['money_brl', 'money_decimal']);
function moneyFields(mapping) {
  return Object.entries(mapping.payload || {}).filter(([, s]) => MONEY_TYPES.includes(s.type)).map(([n]) => n);
}
function createTotals(mapping) {
  const zero = () => Object.fromEntries(moneyFields(mapping).map(f => [f, 0]));
  return { rows: 0, valid: 0, rejected: 0, created: 0, unchanged: 0, rejectedByReason: {},
    money: zero(), byEstablishment: {}, firstDay: null, lastDay: null, _zero: zero };
}
function addValid(totals, { establishmentId, occurredAt, payload, created }) {
  totals.rows++; totals.valid++;
  if (created) totals.created++; else totals.unchanged++;
  const est = totals.byEstablishment[establishmentId] ||= { rows: 0, money: totals._zero() };
  est.rows++;
  for (const field of Object.keys(totals.money)) {
    const cents = payload[field];
    if (cents === null || cents === undefined) continue;
    totals.money[field] += cents; est.money[field] += cents;
    if (!Number.isSafeInteger(totals.money[field])) throw fail('totals overflow');
  }
  const day = String(occurredAt).slice(0, 10);
  if (totals.firstDay === null || day < totals.firstDay) totals.firstDay = day;
  if (totals.lastDay === null || day > totals.lastDay) totals.lastDay = day;
}
function addRejected(totals, reason) {
  totals.rows++; totals.rejected++;
  totals.rejectedByReason[reason] = (totals.rejectedByReason[reason] || 0) + 1;
}
function finishTotals(totals) {
  const { _zero, ...rest } = totals;
  return Object.freeze({ ...rest,
    // Dates present are not proof that the export holds every sale.
    completeness: 'NOT_PROVEN_WITHOUT_RECONCILIATION' });
}

// Invalid records never load. Past the reviewed tolerance (default: none),
// the whole input is blocked: a broken export is not partially trusted.
function qualityStatus(totals, mapping) {
  const max = mapping.limits?.maxRejectedRatio ?? 0;
  if (typeof max !== 'number' || !(max >= 0 && max <= 0.05)) throw fail('limits.maxRejectedRatio must be 0..0.05');
  return totals.rows && totals.rejected / totals.rows > max ? 'BLOCKED_INVALID_RECORDS' : 'PLANNED';
}

// Deterministic identity of a plan: same input, mapping and previous
// manifest always give the same planId (idempotency of the load).
function planIdentity({ transport, inputSha256, mapping, previousManifest }) {
  const mappingSha256 = stableHash(mapping);
  const previousManifestSha256 = previousManifest == null ? null : stableHash(previousManifest);
  return Object.freeze({ mappingSha256, previousManifestSha256,
    planId: stableHash({ transport, inputSha256, mappingSha256, previousManifestSha256 }) });
}

// ── Reconciliation with the official totals of the Linx report ─────────────
// controls: { version: 1, source, rows?, money?: {field: cents},
//   byEstablishment?: {slug: {rows?, money?}}, period?: {from, to} }
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cents = v => Number.isSafeInteger(v);
function validateControls(c) {
  if (!c || c.version !== 1 || typeof c.source !== 'string' || !/^[a-z0-9_]{3,64}$/.test(c.source)) {
    throw fail('controls must be version 1 with a source slug');
  }
  if (c.rows !== undefined && !(Number.isSafeInteger(c.rows) && c.rows >= 0)) throw fail('controls.rows must be an integer');
  for (const m of [c.money, ...Object.values(c.byEstablishment || {}).map(e => e?.money)]) {
    if (m !== undefined && (typeof m !== 'object' || m === null || Object.values(m).some(v => !cents(v)))) {
      throw fail('controls money must be integer cents');
    }
  }
  if (c.period !== undefined && (!DAY.test(c.period?.from || '') || !DAY.test(c.period?.to || '') || c.period.from > c.period.to)) {
    throw fail('controls.period must be from/to days');
  }
  if (c.rows === undefined && c.money === undefined && c.byEstablishment === undefined) {
    throw fail('controls must hold at least rows, money or byEstablishment');
  }
  return c;
}
function reconcile(plan, controls) {
  if (!plan?.totals || !plan.provenance?.planId) throw fail('plan has no totals');
  validateControls(controls);
  const base = { planId: plan.provenance.planId, controlsSha256: stableHash(controls),
    quarantined: plan.totals.rejected };
  if (plan.status !== 'PLANNED') return Object.freeze({ ...base, status: 'NOT_RECONCILABLE', reason: plan.status, checks: [] });
  const t = plan.totals;
  const checks = [];
  const check = (name, expected, observed) => checks.push({ check: name, expected, observed,
    ok: observed !== undefined && expected === observed });
  if (controls.rows !== undefined) check('rows', controls.rows, t.rows);
  for (const [field, v] of Object.entries(controls.money || {})) check(`money.${field}`, v, t.money[field]);
  for (const [est, c] of Object.entries(controls.byEstablishment || {})) {
    const o = t.byEstablishment[est];
    if (c.rows !== undefined) check(`${est}.rows`, c.rows, o ? o.rows : 0);
    for (const [field, v] of Object.entries(c.money || {})) check(`${est}.money.${field}`, v, o ? o.money[field] : 0);
  }
  // An establishment in the file but absent from the official report.
  if (controls.byEstablishment) {
    for (const est of Object.keys(t.byEstablishment)) {
      if (!Object.hasOwn(controls.byEstablishment, est)) check(`${est}.present_in_controls`, false, true);
    }
  }
  if (controls.period) {
    const inside = t.firstDay === null || (t.firstDay >= controls.period.from && t.lastDay <= controls.period.to);
    check('period', true, inside);
  }
  return Object.freeze({ ...base, status: checks.every(c => c.ok) ? 'RECONCILED' : 'MISMATCH', checks });
}

// ── Simulated load (Simulation First): what would be written ──────────────
// The ledger stands for the destination (Supabase) state. Nothing here
// writes anywhere: the result is the next ledger and the list of writes.
function emptyLedger(identity) {
  return { version: 1, tenantId: identity.tenantId, companyId: identity.companyId, kind: identity.kind,
    appliedPlans: [], records: {} };
}
function validateLedger(ledger, identity) {
  if (ledger == null) return emptyLedger(identity);
  if (ledger.version !== 1 || !Array.isArray(ledger.appliedPlans) || !ledger.records ||
      typeof ledger.records !== 'object' || Array.isArray(ledger.records)) throw fail('ledger is invalid');
  if (ledger.tenantId !== identity.tenantId || ledger.companyId !== identity.companyId || ledger.kind !== identity.kind) {
    throw fail('ledger belongs to another tenant, company or kind');
  }
  return ledger;
}
function simulateLoad({ plan, reconciliation, ledger = null } = {}) {
  if (!plan?.provenance?.planId) throw fail('plan has no identity');
  const current = validateLedger(ledger, plan.provenance);
  const planId = plan.provenance.planId;
  const refuse = (status, extra = {}) => Object.freeze({ status, planId, writes: [], ledger: current, ...extra });
  if (plan.status !== 'PLANNED') return refuse('REFUSED', { reason: plan.status });
  if (reconciliation?.status !== 'RECONCILED' || reconciliation.planId !== planId) {
    return refuse('REFUSED', { reason: 'NOT_RECONCILED' });
  }
  if (current.appliedPlans.includes(planId)) return refuse('ALREADY_APPLIED');
  // Versions must follow the destination: a plan built from a stale or
  // foreign manifest is refused as a whole (atomic), never half applied.
  const conflicts = [];
  for (const r of plan.records) {
    const expected = (current.records[r.record.id]?.version || 0) + 1;
    if (r.version !== expected) conflicts.push({ id: r.record.id, expected, planned: r.version });
  }
  if (conflicts.length) return refuse('CONFLICT', { conflicts });
  const writes = plan.records.map(r => Object.freeze({ id: r.record.id, version: r.version,
    payloadHash: r.record.payload.payloadHash, action: r.action }));
  const records = { ...current.records };
  for (const w of writes) records[w.id] = { version: w.version, payloadHash: w.payloadHash };
  const next = { ...current, records, appliedPlans: remember(current.appliedPlans, planId) };
  const applied = writes.filter(w => next.records[w.id]?.payloadHash === w.payloadHash).length;
  if (applied !== plan.summary.create) throw fail('simulated load does not match the plan');
  return Object.freeze({ status: 'SIMULATED', planId, writes, ledger: next,
    postLoad: { applied, expected: plan.summary.create } });
}

module.exports = {
  MANIFEST_VERSION,
  MAX_REMEMBERED,
  MONEY_TYPES,
  fail,
  emptyManifest,
  validateManifest,
  planRecord,
  remember,
  createTotals,
  addValid,
  addRejected,
  finishTotals,
  qualityStatus,
  planIdentity,
  validateControls,
  reconcile,
  emptyLedger,
  simulateLoad
};
