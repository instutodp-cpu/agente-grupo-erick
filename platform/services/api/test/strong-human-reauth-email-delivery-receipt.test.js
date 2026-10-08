'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {bindGmailDelivery}=require('../src/core/strong-human-reauth-email-delivery-receipt');
const handoff={ok:true,status:'EMAIL_REAUTH_PROVIDER_HANDOFF_READY',provider:'google',identity_alias:'owner-primary-email',delivery_reference:'delivery-1'};
const sent={id:'gmail-message-1',threadId:'gmail-thread-1',labelIds:['SENT']};
const profile={authenticated:true,identity_alias:'owner-primary-email',email:'owner@example.test'};
const at='2026-10-08T01:00:00Z';
test('binds real Gmail sent receipt to challenge delivery reference without granting execution',()=>{const r=bindGmailDelivery(handoff,sent,profile,at);assert.equal(r.ok,true);assert.equal(r.message_id,sent.id);assert.equal(r.thread_id,sent.threadId);assert.equal(r.delivery_reference,handoff.delivery_reference);assert.equal(r.execution_authorized,false);});
test('fails closed without authenticated profile, sent marker or real Gmail IDs',()=>{assert.equal(bindGmailDelivery(handoff,sent,{...profile,authenticated:false},at).ok,false);assert.equal(bindGmailDelivery(handoff,{...sent,labelIds:[]},profile,at).ok,false);assert.equal(bindGmailDelivery(handoff,{...sent,id:''},profile,at).ok,false);assert.equal(bindGmailDelivery(handoff,sent,profile,'invalid').ok,false);});
