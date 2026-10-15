'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
function text(rel){return fs.readFileSync(path.join(root,rel),'utf8');}

test('operational mission runner reuses proven executeOperationalCanary and does not implement a second transport',()=>{
  const source=text('scripts/public-web-operational-mission-run.js');
  assert.match(source,/executeOperationalCanary/);
  assert.match(source,/runReadyOperationalMission/);
  assert.doesNotMatch(source,/https\.request|https\.get|fetch\s*\(/);
  assert.match(source,/HERMES_PUBLIC_WEB_REAL_CANARY_ENABLED/);
  assert.match(source,/HERMES_PUBLIC_WEB_REAL_CANARY_KILL_SWITCH/);
});

test('callback retry path cannot invoke or import public-web execution',()=>{
  const source=text('scripts/public-web-operational-mission-retry-callback.js');
  assert.match(source,/retryOperationalMissionCallback/);
  assert.doesNotMatch(source,/executeOperationalCanary|public-web-canary-real-non-production|https\.request|https\.get/);
});

test('real-success reconciliation CLI cannot import or invoke public-web execution',()=>{
  const source=text('scripts/public-web-operational-mission-reconcile-real-success.js');
  assert.match(source,/reconcileOperationalMissionRealSuccess/);
  assert.match(source,/createPostgresPublicWebCanaryAuditPersistence/);
  assert.doesNotMatch(source,/executeOperationalCanary|public-web-canary-real-non-production|https\.request|https\.get|fetch\s*\(/);
});

test('result cost migration is additive and durable callback reconstruction allows cost patch only',()=>{
  const migration=text('../../migrations/hermes/033_add_public_web_operational_mission_result_cost.sql');
  const adapter=text('src/adapters/postgres/public-web-operational-mission-inbox-postgres.js');
  assert.match(migration,/ADD COLUMN IF NOT EXISTS cost_units NUMERIC NOT NULL DEFAULT 0/);
  assert.match(migration,/CHECK \(cost_units >= 0 AND cost_units <= 1\)/);
  assert.match(adapter,/'cost_units'/);
});
