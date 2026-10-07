'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPublicWebCanaryOperatorPolicy}=require('../src/core/public-web-canary-operator-policy');
const session={canary_session_id:'session',operator_id:'owner',tenant_id:'grupo_erick',target_origin:'https://example.com',operation:'fetch_public_page_summary',expires_at:'2026-10-07T22:40:00.000Z'};
function approval(id,approved_at,expires_at){return {approval_id:id,approved_by:'owner',approver_role:'integration_operator',mode:'STRONG_HUMAN_REAUTH_EMAIL',approved_at,expires_at};}
test('strong reauth accepts remaining grant lifetime without extending expiry',()=>{
 const policy=createPublicWebCanaryOperatorPolicy();
 const result=policy.consumeStrongReauthApproval(approval('fresh','2026-10-07T22:30:00.010Z','2026-10-07T22:32:00.000Z'),session);
 assert.equal(result.consumed,true);
 assert.equal(policy.getApproval('fresh').expires_at,'2026-10-07T22:32:00.000Z');
});
test('strong reauth rejects expired, overlong, and session-exceeding grants',()=>{
 const policy=createPublicWebCanaryOperatorPolicy();
 for(const [id,start,end] of [['expired','2026-10-07T22:32:00.001Z','2026-10-07T22:32:00.000Z'],['long','2026-10-07T22:30:00.000Z','2026-10-07T22:32:00.001Z'],['session','2026-10-07T22:39:00.000Z','2026-10-07T22:40:00.001Z']])assert.equal(policy.consumeStrongReauthApproval(approval(id,start,end),session).consumed,false,id);
});
