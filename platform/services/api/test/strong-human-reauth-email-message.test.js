'use strict';const test=require('node:test');const assert=require('node:assert/strict');
const {prepareGmailReauthMessage}=require('../src/core/strong-human-reauth-email-message');
const c={ok:true,status:'STRONG_HUMAN_REAUTH_EMAIL_CHALLENGE_PREPARED',challenge_id:'c1',action_digest:'a1',issued_at:'2026-10-08T01:00:00Z',ttl_seconds:600};
const h={ok:true,status:'EMAIL_REAUTH_PROVIDER_HANDOFF_READY',provider:'google',challenge_id:'c1',action_digest:'a1',delivery_reference:'d1'};
test('prepares bound Gmail reauthentication message without authorizing execution',()=>{const r=prepareGmailReauthMessage(c,h);assert.equal(r.ok,true);assert.match(r.body,/APROVAR REAUTENTICACAO HERMES/);assert.match(r.body,/c1/);assert.equal(r.execution_authorized,false);});
test('rejects unbound handoff and invalid expiration',()=>{assert.equal(prepareGmailReauthMessage(c,{...h,challenge_id:'other'}).ok,false);assert.equal(prepareGmailReauthMessage({...c,ttl_seconds:3600},h).ok,false);});
