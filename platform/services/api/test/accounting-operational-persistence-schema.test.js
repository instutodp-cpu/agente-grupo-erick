'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../../../migrations/hermes/029_create_accounting_operational_bindings.sql'),'utf8');

test('C24 reuses canonical execution persistence instead of duplicating jobs attempts or leases',()=>{
 assert.match(sql,/REFERENCES hermes\.execution_jobs\(job_reference_id\)/);
 assert.match(sql,/REFERENCES hermes\.execution_attempts\(attempt_durable_record_id\)/);
 assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS hermes\.accounting_execution_jobs/);
 assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS hermes\.accounting_worker_leases/);
});
test('accounting idempotency is enforced by database uniqueness per tenant and capability',()=>{
 assert.match(sql,/UNIQUE \(tenant_id, capability, idempotency_key\)/);
 assert.match(sql,/UNIQUE \(tenant_id, capability, operation_id\)/);
});
test('real provider flags default fail closed',()=>{
 assert.match(sql,/enabled BOOLEAN NOT NULL DEFAULT FALSE/);
 assert.match(sql,/real_provider_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
});
test('only financial and fiscal controlled capabilities are accepted',()=>{
 assert.match(sql,/FINANCIAL_EXECUTION/);assert.match(sql,/FISCAL_SUBMISSION/);
});
