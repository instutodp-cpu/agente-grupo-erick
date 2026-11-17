'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '../../../migrations/hermes/029_create_accounting_operational_bindings.sql'),
  'utf8'
);

test('C24 reuses canonical execution persistence instead of duplicating jobs or attempts', () => {
  assert.match(sql, /REFERENCES hermes\.execution_jobs\(job_reference_id\)/);
  assert.match(sql, /REFERENCES hermes\.execution_attempts\(attempt_durable_record_id\)/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS hermes\.accounting_execution_jobs/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS hermes\.accounting_worker_leases/);
});

test('accounting idempotency is database-unique per tenant and capability', () => {
  assert.match(sql, /UNIQUE \(tenant_id, capability, idempotency_key\)/);
  assert.match(sql, /UNIQUE \(tenant_id, capability, operation_id\)/);
});

test('real provider flags default fail closed and capabilities are bounded', () => {
  assert.match(sql, /enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /real_provider_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /FINANCIAL_EXECUTION/);
  assert.match(sql, /FISCAL_SUBMISSION/);
});

test('migration remains structural and does not auto-apply or create external effects', () => {
  assert.match(sql, /Structural migration only; it is never auto-applied/);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+\b/i);
  assert.doesNotMatch(sql, /\bCALL\s+\b/i);
});
