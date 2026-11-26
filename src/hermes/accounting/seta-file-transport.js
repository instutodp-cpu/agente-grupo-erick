'use strict';

// File-export transport for the existing seta_read_v1 adapter (Linx da Seta).
// Until an official API is discovered, the stores can export reports (CSV or
// TSV). This module turns ONE export into canonical READ records through the
// same normalizeSetaRecord/decideSyncAction contract and returns an
// incremental load PLAN plus the next manifest. It never writes to Seta/Linx,
// to a database or to disk, and it never calls the network: loading the plan
// into Supabase is a separate, reviewed step.

const crypto = require('crypto');
const { ENTITY_MAP } = require('./seta-read-adapter');
const syncPlan = require('./seta-sync-plan');

const FILE_TRANSPORT_POLICY = Object.freeze({
  adapterId: 'seta_read_v1',
  transport: 'FILE_EXPORT',
  mode: 'READ_ONLY',
  network: false,
  persistence: 'NONE',
  failClosed: true
});
const MAPPING_VERSION = 1;
const MANIFEST_VERSION = syncPlan.MANIFEST_VERSION;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 200000;
const DELIMITERS = Object.freeze([';', ',', '\t']);
const DATE_FORMATS = Object.freeze(['DD/MM/YYYY', 'YYYY-MM-DD']);
const FIELD_TYPES = Object.freeze(['text', 'money_brl', 'integer', 'date']);
const SLUG = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const FIELD = /^[a-z][a-z0-9_]{0,39}$/;

function fail(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 120) {
    throw fail(`${field} is required`);
  }
}

// The mapping is the reviewed description of one Linx report layout for one
// company. It is DISCOVERY_REQUIRED until a real sample was checked by a
// person, recording the sample and header hashes.
function validateMapping(mapping) {
  if (!mapping || mapping.version !== MAPPING_VERSION) throw fail('mapping version must be 1');
  if (!Object.hasOwn(ENTITY_MAP, mapping.kind)) throw fail(`unsupported Seta record kind: ${mapping.kind}`);
  if (!SLUG.test(mapping.tenantId || '')) throw fail('tenantId must be a slug');
  if (!SLUG.test(mapping.companyId || '')) throw fail('companyId must be a slug');
  if (!DELIMITERS.includes(mapping.delimiter)) throw fail('delimiter must be ; , or tab');
  if (!DATE_FORMATS.includes(mapping.dateFormat)) throw fail('unsupported dateFormat');
  const c = mapping.columns || {};
  for (const field of ['id', 'occurredAt', 'establishment']) nonEmpty(c[field], `columns.${field}`);
  if (c.sourceUpdatedAt != null) nonEmpty(c.sourceUpdatedAt, 'columns.sourceUpdatedAt');
  const stores = mapping.stores;
  if (!stores || typeof stores !== 'object' || Array.isArray(stores) || !Object.keys(stores).length) {
    throw fail('stores must map every external store code to an establishment');
  }
  for (const [code, establishment] of Object.entries(stores)) {
    nonEmpty(code, 'store code');
    if (!SLUG.test(establishment)) throw fail('establishment must be a slug');
  }
  const payload = mapping.payload || {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw fail('payload must be an object');
  for (const [name, spec] of Object.entries(payload)) {
    if (!FIELD.test(name)) throw fail('payload field names must be snake_case');
    if (!spec || !FIELD_TYPES.includes(spec.type)) throw fail(`unsupported type for ${name}`);
    nonEmpty(spec.column, `payload.${name}.column`);
  }
  return mapping;
}

function assertDiscovered(mapping, headerHash) {
  const d = mapping.discovery;
  if (!d || !/^[0-9a-f]{64}$/.test(d.sampleSha256 || '') || !/^[0-9a-f]{64}$/.test(d.headerSha256 || '') ||
      typeof d.verifiedBy !== 'string' || d.verifiedBy.trim() === '' ||
      Number.isNaN(Date.parse(d.verifiedAt || ''))) {
    throw fail('SETA_FILE_LAYOUT_DISCOVERY_REQUIRED', 'DISCOVERY_REQUIRED');
  }
  if (headerHash !== d.headerSha256) {
    // The Linx report layout changed: never guess which column moved.
    throw fail('SETA_FILE_LAYOUT_CHANGED', 'DISCOVERY_REQUIRED');
  }
}

// RFC 4180 style parser: quotes, escaped quotes, CRLF or LF, optional BOM.
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw fail('file has too many rows');
    } else field += ch;
  }
  if (quoted) throw fail('unterminated quoted field');
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function parseDate(value, format) {
  const v = String(value).trim();
  const m = format === 'DD/MM/YYYY'
    ? v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
    : v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [y, mo, d] = format === 'DD/MM/YYYY' ? [m[3], m[2], m[1]] : [m[1], m[2], m[3]];
  const day = `${y}-${mo}-${d}`;
  const probe = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== day) return null;
  if (m[4] === undefined) return day;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] || 0) > 59) return null;
  // Store business time explicitly in Recife (UTC-3, no daylight saving).
  return `${day}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00`;
}

function parseMoneyBrl(value) {
  const v = String(value).trim();
  if (!/^-?(\d{1,3}(\.\d{3})*|\d+)(,\d{1,2})?$/.test(v)) return null;
  const negative = v.startsWith('-');
  const [whole, frac = ''] = v.replace('-', '').replace(/\./g, '').split(',');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

function convert(value, type, format) {
  if (type === 'text') return String(value).trim().slice(0, 200);
  if (type === 'money_brl') return parseMoneyBrl(value);
  if (type === 'integer') return /^-?\d{1,15}$/.test(String(value).trim()) ? Number(value) : null;
  return parseDate(value, format);
}

// Manifest rules are shared with the API transport (seta-sync-plan).
const validateManifest = syncPlan.validateManifest;

function neededColumns(mapping) {
  return [mapping.columns.id, mapping.columns.occurredAt, mapping.columns.establishment,
    ...(mapping.columns.sourceUpdatedAt ? [mapping.columns.sourceUpdatedAt] : []),
    ...Object.values(mapping.payload || {}).map(s => s.column)];
}

function decode(file) {
  if (!Buffer.isBuffer(file) || file.length === 0 || file.length > MAX_FILE_BYTES) {
    throw fail('file must be a non-empty buffer up to 20 MB');
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(file); } catch {
    throw fail('file must be UTF-8 encoded');
  }
}

// One data row -> typed values, or an error whose message is the reason.
function rowParser(mapping, header, receivedAt) {
  const index = new Map(header.map((h, i) => [h, i]));
  const seen = new Set();
  return cells => {
    const cell = col => (cells[index.get(col)] ?? '');
    if (cells.length !== header.length) throw fail('column_count');
    const sourceId = cell(mapping.columns.id).trim();
    if (!/^[A-Za-z0-9._/-]{1,64}$/.test(sourceId)) throw fail('invalid_id');
    if (seen.has(sourceId)) throw fail('duplicate_in_file');
    seen.add(sourceId);
    const occurredAt = parseDate(cell(mapping.columns.occurredAt), mapping.dateFormat);
    if (!occurredAt) throw fail('invalid_date');
    const storeCode = cell(mapping.columns.establishment).trim();
    if (!Object.hasOwn(mapping.stores, storeCode)) {
      const err = fail('unknown_store'); err.storeCode = storeCode; throw err;
    }
    const updated = mapping.columns.sourceUpdatedAt
      ? parseDate(cell(mapping.columns.sourceUpdatedAt), mapping.dateFormat) : receivedAt;
    if (!updated) throw fail('invalid_updated_at');
    const payload = {};
    for (const [name, spec] of Object.entries(mapping.payload || {})) {
      const raw = cell(spec.column);
      if (raw.trim() === '') { payload[name] = null; continue; }
      const value = convert(raw, spec.type, mapping.dateFormat);
      if (value === null) throw fail(`invalid_${spec.type}`);
      payload[name] = value;
    }
    return { sourceId, occurredAt, establishmentId: mapping.stores[storeCode], updated, payload, cell };
  };
}
const reasonOf = err => (/^[a-z_]{3,40}$/.test(err.message) ? err.message : 'invalid_row');

// Layout check of one export against its mapping, BEFORE any import: what a
// person reviews to register (or refuse) the discovery hashes. Counts,
// column names and store codes only: never a row's content.
function validateLayout({ file, mapping } = {}) {
  validateMapping(mapping);
  const rows = parseDelimited(decode(file), mapping.delimiter);
  if (rows.length < 1) throw fail('file has no header');
  const header = rows[0].map(h => h.trim());
  const headerSha256 = sha256(header.join('\u001f'));
  const needed = neededColumns(mapping);
  const missingColumns = needed.filter(c => !header.includes(c));
  const extraColumns = header.filter(h => !needed.includes(h));
  const d = mapping.discovery;
  const discovered = Boolean(d && /^[0-9a-f]{64}$/.test(d.headerSha256 || ''));
  const report = { headerSha256, header: { columns: header.length, missingColumns, extraColumns,
    matchesDiscovery: discovered && d.headerSha256 === headerSha256 }, rows: rows.length - 1,
  valid: 0, invalidByReason: {}, unknownStores: {}, firstDay: null, lastDay: null, fields: {} };
  for (const name of Object.keys(mapping.payload || {})) report.fields[name] = { filled: 0, empty: 0, invalid: 0 };
  if (!missingColumns.length) {
    const parse = rowParser(mapping, header, new Date(0).toISOString());
    const index = new Map(header.map((h, i) => [h, i]));
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      for (const [name, spec] of Object.entries(mapping.payload || {})) {
        const raw = String(cells[index.get(spec.column)] ?? '');
        const f = report.fields[name];
        if (raw.trim() === '') f.empty++;
        else if (convert(raw, spec.type, mapping.dateFormat) === null) f.invalid++;
        else f.filled++;
      }
      try {
        const row = parse(cells);
        report.valid++;
        const day = row.occurredAt.slice(0, 10);
        if (report.firstDay === null || day < report.firstDay) report.firstDay = day;
        if (report.lastDay === null || day > report.lastDay) report.lastDay = day;
      } catch (err) {
        const reason = reasonOf(err);
        report.invalidByReason[reason] = (report.invalidByReason[reason] || 0) + 1;
        if (reason === 'unknown_store' && Object.keys(report.unknownStores).length < 20) {
          const code = /^[A-Za-z0-9._-]{1,32}$/.test(err.storeCode) ? err.storeCode : '(inválido)';
          report.unknownStores[code] = (report.unknownStores[code] || 0) + 1;
        }
      }
    }
  }
  report.status = !discovered ? 'DISCOVERY_REQUIRED' :
    missingColumns.length || !report.header.matchesDiscovery ? 'LAYOUT_CHANGED' :
    report.valid !== report.rows ? 'VALUES_INVALID' : 'LAYOUT_OK';
  // Rows in consecutive days do not prove a complete export.
  report.completeness = 'NOT_PROVEN_WITHOUT_RECONCILIATION';
  return report;
}

function planFileImport({ file, fileName, receivedAt, mapping, previousManifest = null } = {}) {
  validateMapping(mapping);
  const text = decode(file);
  nonEmpty(fileName, 'fileName');
  if (Number.isNaN(Date.parse(receivedAt || ''))) throw fail('receivedAt must be a valid date');
  const manifest = validateManifest(previousManifest, mapping);
  const fileSha256 = sha256(file);
  const rows = parseDelimited(text, mapping.delimiter);
  if (rows.length < 2) throw fail('file has no data rows');
  const header = rows[0].map(h => h.trim());
  const headerSha256 = sha256(header.join('\u001f'));
  assertDiscovered(mapping, headerSha256);
  for (const col of neededColumns(mapping)) if (!header.includes(col)) throw fail('SETA_FILE_LAYOUT_CHANGED', 'DISCOVERY_REQUIRED');

  const provenance = Object.freeze({ fileName, sha256: fileSha256, bytes: file.length,
    headerSha256, receivedAt, kind: mapping.kind, tenantId: mapping.tenantId,
    companyId: mapping.companyId, rows: rows.length - 1, transport: 'FILE_EXPORT',
    ...syncPlan.planIdentity({ transport: 'FILE_EXPORT', inputSha256: fileSha256, mapping, previousManifest }) });
  if (manifest.files.includes(fileSha256)) {
    return { policy: FILE_TRANSPORT_POLICY, status: 'IGNORE_DUPLICATE_FILE', provenance,
      summary: { create: 0, unchanged: 0, rejected: 0 }, records: [], rejected: [], manifest };
  }

  const entries = { ...manifest.entries };
  const records = [];
  const rejected = [];
  const totals = syncPlan.createTotals(mapping);
  const parse = rowParser(mapping, header, receivedAt);
  let unchanged = 0;
  for (let r = 1; r < rows.length; r++) {
    const line = r + 1;
    try {
      const row = parse(rows[r]);
      const planned = syncPlan.planRecord(entries, {
        identity: mapping, sourceId: row.sourceId, establishmentId: row.establishmentId, occurredAt: row.occurredAt,
        sourceUpdatedAt: row.updated, receivedAt, evidenceId: `file:${fileSha256}#L${line}`, payload: row.payload
      });
      syncPlan.addValid(totals, { establishmentId: row.establishmentId, occurredAt: row.occurredAt,
        payload: row.payload, created: Boolean(planned) });
      if (!planned) { unchanged++; continue; }
      records.push(planned);
    } catch (err) {
      // Line number and reason only: never the row content.
      const reason = reasonOf(err);
      rejected.push({ line, reason });
      syncPlan.addRejected(totals, reason);
    }
  }
  const finished = syncPlan.finishTotals(totals);
  const status = syncPlan.qualityStatus(finished, mapping);
  // A blocked plan keeps the previous manifest: nothing of it counts as seen.
  if (status !== 'PLANNED') {
    return { policy: FILE_TRANSPORT_POLICY, status, provenance,
      summary: { create: records.length, unchanged, rejected: rejected.length },
      totals: finished, records: [], rejected, manifest };
  }
  return {
    policy: FILE_TRANSPORT_POLICY,
    status,
    provenance,
    summary: { create: records.length, unchanged, rejected: rejected.length },
    totals: finished,
    records,
    rejected,
    // Spread keeps what the API transport remembered (pages, cursor).
    manifest: { ...manifest, files: syncPlan.remember(manifest.files, fileSha256), entries }
  };
}

function headerHashOf(file, delimiter) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(file);
  const [header] = parseDelimited(text.split(/\r?\n/)[0], delimiter);
  return sha256(header.map(h => h.trim()).join('\u001f'));
}

module.exports = {
  convert,
  FILE_TRANSPORT_POLICY,
  MAPPING_VERSION,
  MANIFEST_VERSION,
  MAX_FILE_BYTES,
  validateMapping,
  assertDiscovered,
  parseDelimited,
  parseDate,
  parseMoneyBrl,
  headerHashOf,
  validateLayout,
  planFileImport
};
