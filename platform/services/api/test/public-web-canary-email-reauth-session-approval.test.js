'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
test('registry exposes isolated email reauth approval without weakening legacy approval',()=>{
 const src=fs.readFileSync(path.resolve(__dirname,'../src/core/public-web-canary-session-registry.js'),'utf8');
 assert.match(src,/function approveCanaryWithEmailReauth/);
 assert.match(src,/approveCanaryWithEmailReauth,/);
 assert.match(src,/grant_mode !== 'EMAIL_REAUTH_SINGLE_USE'/);
 assert.match(src,/authorization_scope !== 'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION'/);
 assert.match(src,/expires - issued !== 120000/);
 assert.match(src,/session\.target_origin !== 'https:\/\/example\.com'/);
 const legacy=src.slice(src.indexOf('function approveCanary('),src.indexOf('function approveCanaryWithEmailReauth'));
 assert.match(legacy,/dualApproval: true/);
 assert.match(legacy,/operatorPolicy\.validateApproval/);
 assert.match(legacy,/operatorPolicy\.consumeApproval/);
});
