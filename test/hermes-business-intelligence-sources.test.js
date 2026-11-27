'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const analyst=require('../platform/services/api/src/runtime/hermes-analyst-templates');
const sellers=require('../platform/services/api/src/runtime/hermes-seller-templates');

const migration=(name)=>fs.readFileSync(path.join(__dirname,'..','platform','migrations','hermes',name),'utf8');

test('commercial source switch is exact, fail-closed, and carries the v2 cut-start contract',()=>{
  const base=analyst.sourceConfigFromEnv({});
  assert.equal(base.commercial,analyst.SOURCE);
  assert.equal(base.cutStarts.commercial,'2025-01');
  const v2=analyst.sourceConfigFromEnv({
    HERMES_HISTORY_COMMERCIAL_VIEW:'hermes_history.monthly_commercial_v2'
  });
  assert.equal(v2.commercial,analyst.COMMERCIAL_V2_SOURCE);
  assert.equal(v2.cutStarts.commercial,null);
  assert.throws(()=>analyst.sourceConfigFromEnv({
    HERMES_HISTORY_COMMERCIAL_VIEW:'public.vw_faturamento_mensal'
  }),/history_commercial_source_invalid/);
  assert.throws(()=>analyst.sourceConfigFromEnv({
    HERMES_HISTORY_COMMERCIAL_VIEW:'hermes_history.monthly_commercial_v2',
    HERMES_HISTORY_COMMERCIAL_CUT_START:'2025-01'
  }),/history_cut_start_mismatch/);
  const sql=analyst.sqlFor(v2);
  assert.match(sql.period,/hermes_history\.monthly_commercial_v2/);
  assert.doesNotMatch(sql.period,/public\.vw_/);
  assert.match(analyst.sqlFor(v2).stores,/MATERIALIZED/);
});

test('seller source is opt-in and only the versioned view is accepted',()=>{
  assert.equal(sellers.sourceFromEnv({}),null);
  assert.equal(sellers.sourceFromEnv({
    HERMES_HISTORY_SELLER_VIEW:sellers.SELLER_SOURCE
  }),null);
  assert.throws(()=>sellers.sourceFromEnv({
    HERMES_HISTORY_SELLER_ENABLED:'true'
  }),/seller_source_config_invalid/);
  assert.throws(()=>sellers.sourceFromEnv({
    HERMES_HISTORY_SELLER_ENABLED:'true',
    HERMES_HISTORY_SELLER_VIEW:'hermes_history.other_view'
  }),/seller_source_config_invalid/);
  assert.equal(sellers.sourceFromEnv({
    HERMES_HISTORY_SELLER_ENABLED:'true',
    HERMES_HISTORY_SELLER_VIEW:sellers.SELLER_SOURCE
  }),sellers.SELLER_SOURCE);
});

test('commercial migration preserves the old view and restricts the new aggregate',()=>{
  const sql=migration('055_create_monthly_commercial_v2.sql');
  assert.match(sql,/CREATE VIEW hermes_history\.monthly_commercial_v2/);
  assert.match(sql,/softcom_import\.cadastro_de_vendas/);
  for(const store of ['CALCADOS','SIRINHAEM','MAGAZINE',String.raw`SPORTS-\(DESATIVADO\)`,'ERICK SPORTS','VARIEDADES'])
    assert.match(sql,new RegExp(store));
  for(const column of ['data_da_venda','lojaorigem','valor_pago','cancelado','registered','cancelled','noncancelled','last_day'])
    assert.match(sql,new RegExp(column));
  assert.match(sql,/GRANT SELECT ON hermes_history\.monthly_commercial_v2 TO hermes_history_reader/);
  assert.match(sql,/REVOKE ALL ON hermes_history\.monthly_commercial_v2 FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON hermes_history\.monthly_commercial_v2 FROM anon/);
  assert.match(sql,/REVOKE ALL ON hermes_history\.monthly_commercial_v2 FROM authenticated/);
  assert.match(sql,/CREATE ROLE hermes_history_reader NOLOGIN NOINHERIT/);
  assert.match(sql,/hermes_history_reader com atributos inesperados/);
  assert.match(sql,/make_date/);
  assert.doesNotMatch(sql,/to_date\(/);
  assert.match(sql,/coalesce\(cancelled_text IN/);
  assert.doesNotMatch(sql,/AND paid_amount IS NOT NULL/);
  assert.match(sql,/REVOKE ALL ON TABLE softcom_import\.cadastro_de_vendas FROM hermes_history_reader/);
  assert.doesNotMatch(sql,/DROP VIEW IF EXISTS hermes_history\.monthly_commercial_2025_2026_v1/);
  assert.match(sql,/Rollback \(manual, reviewed/);
});

test('seller migration keeps codes per store and never invents names',()=>{
  const sql=migration('056_create_monthly_seller_activity_v1.sql');
  assert.match(sql,/CREATE VIEW hermes_history\.monthly_seller_activity_v1/);
  assert.match(sql,/GROUP BY 1, 2, 3, 4/);
  assert.match(sql,/seller_code/);
  assert.match(sql,/Código ' \|\| seller_code/);
  assert.match(sql,/GRANT SELECT ON hermes_history\.monthly_seller_activity_v1 TO hermes_history_reader/);
  assert.match(sql,/REVOKE ALL ON hermes_history\.monthly_seller_activity_v1 FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON hermes_history\.monthly_seller_activity_v1 FROM anon/);
  assert.match(sql,/REVOKE ALL ON hermes_history\.monthly_seller_activity_v1 FROM authenticated/);
  assert.doesNotMatch(sql,/JOIN .*cadastro|nome.*vendedor/i);
  assert.match(sql,/make_date/);
  assert.doesNotMatch(sql,/to_date\(/);
  assert.match(sql,/coalesce\(cancelled_text IN/);
  assert.doesNotMatch(sql,/AND paid_amount IS NOT NULL/);
});

test('isolated migration test exercises malformed data and non-superuser application',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'..','platform','scripts','hermes-business-intelligence-postgres.integration.js'),'utf8');
  assert.match(sql,/hermes_migration_runner/);
  assert.match(sql,/2026-02-31/);
  assert.match(sql,/31\/02\/2019/);
  assert.match(sql,/2099-01-01/);
  assert.match(sql,/cancelled.*noncancelled/s);
  assert.match(sql,/can_select/);
  assert.match(sql,/can_insert/);
});

test('all aggregate consumers accept the reviewed commercial source allowlist',()=>{
  for(const file of [
    'platform/services/api/src/runtime/hermes-business-evidence-memory.js',
    'platform/services/api/src/runtime/hermes-automemory-curator.js',
    'platform/services/api/src/runtime/hermes-brain-automemory-publication.js',
    'platform/services/api/src/runtime/hermes-governed-agent.js'
  ]){
    const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.match(source,/COMMERCIAL_SOURCES/);
  }
});
