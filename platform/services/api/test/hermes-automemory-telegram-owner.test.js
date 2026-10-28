'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/runtime/hermes-telegram-private-channel');
const msg=(id,chatType='private')=>({update_id:9,message:{
 message_id:1,chat:{id,type:chatType},from:{id,is_bot:false},text:'/memorias'
}});
test('owner-only Telegram memory returns validated curated content and no actions',async()=>{
 const sent=[];
 const outcome=await core.processUpdate({update:msg(11),ownerId:11,
 send:async(id,value)=>sent.push({id,value}),query:async()=>{throw Error('unexpected external read')},
 readAutocurated:async()=> '🧠 Hermes AutoMemory — Grupo Erick (staging)'});
 assert.equal(outcome.kind,'answered');assert.equal(outcome.intent,'auto_memory');
 assert.equal(sent.length,1);
});
test('non-owner and group cannot query curated memories',async()=>{
 const sent=[];
 for(const input of [msg(12),msg(11,'group')]){
  const result=await core.processUpdate({update:input,ownerId:11,
   send:async()=>sent.push('sent'),query:async()=>{throw Error('unexpected')},
   readAutocurated:async()=>{throw Error('must not read')}});
  assert.notEqual(result.kind,'answered');
 }
 assert.deepEqual(sent,[]);
});
test('injected retrieval payload fails closed',async()=>{
 const sent=[];
 const result=await core.processUpdate({update:msg(11),ownerId:11,
 send:async(id,s)=>sent.push(s),query:async()=>{},
 readAutocurated:async()=> 'token: no access'});
 assert.equal(result.kind,'answered');
 assert.match(sent[0],/indisponíveis/);
 assert.doesNotMatch(sent[0],/token:/);
});
