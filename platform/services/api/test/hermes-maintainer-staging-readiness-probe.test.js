'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

const script=path.join(__dirname,'../scripts/hermes-maintainer-staging-readiness-probe.js');

test('probe fails closed and emits only sanitized evidence when credential is absent',()=>{
 const env={...process.env};
 delete env.HERMES_GITHUB_READ_ONLY_STAGING_TOKEN;
 const result=spawnSync(process.execPath,[script],{env,encoding:'utf8'});
 assert.equal(result.status,2);
 const output=JSON.parse(result.stdout.trim());
 assert.equal(output.ready,false);
 assert.equal(output.credential_material_present,false);
 assert.equal(Object.hasOwn(output,'authorization'),false);
});

test('probe succeeds with process environment material without printing it',()=>{
 const marker='opaque-probe-marker';
 const result=spawnSync(process.execPath,[script],{
  env:{...process.env,HERMES_GITHUB_READ_ONLY_STAGING_TOKEN:marker},
  encoding:'utf8'
 });
 assert.equal(result.status,0);
 const output=JSON.parse(result.stdout.trim());
 assert.equal(output.ready,true);
 assert.equal(output.reason,'READY');
 assert.equal(output.credential_material_present,false);
 assert.equal(result.stdout.includes(marker),false);
 assert.equal(Object.hasOwn(output,'authorization'),false);
});
