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
 assert.match(src,/EMAIL_REAUTH_STAGING_TARGET_ORIGIN/);
 assert.match(src,/EMAIL_REAUTH_STAGING_TARGET_PATH/);
 const legacy=src.slice(src.indexOf('function approveCanary('),src.indexOf('function approveCanaryWithEmailReauth'));
 assert.match(legacy,/dualApproval: true/);
 assert.match(legacy,/operatorPolicy\.validateApproval/);
 assert.match(legacy,/operatorPolicy\.consumeApproval/);
});

test('operator policy records bounded strong reauth approval as active without dual-control impersonation',()=>{
 const {createPublicWebCanaryOperatorPolicy}=require('../src/core/public-web-canary-operator-policy');
 const policy=createPublicWebCanaryOperatorPolicy();
 const session={canary_session_id:'email_session',operator_id:'operator_public_web',tenant_id:'grupo_erick',target_origin:'https://hermes-staging.grupoerick.tech',operation:'fetch_public_page_summary',expires_at:'2026-10-07T12:05:00.000Z'};
 const approval={approval_id:'email_grant',approved_by:'operator_public_web',approver_role:'integration_operator',approved_at:'2026-10-07T12:00:00.000Z',expires_at:'2026-10-07T12:02:00.000Z',mode:'STRONG_HUMAN_REAUTH_EMAIL'};
 const consumed=policy.consumeStrongReauthApproval(approval,session);
 assert.equal(consumed.consumed,true);
 assert.equal(policy.isApprovalActive('email_grant',session,()=> '2026-10-07T12:01:00.000Z'),true);
 assert.equal(policy.isApprovalRevoked('email_grant'),false);
 assert.equal(policy.validateApproval({...approval,approver_role:'security_operator'},session).valid,false);
});
