'use strict';
// Hermes SaaS: Codex Login remains primary. OpenRouter is a *secondary*
// endpoint only after the primary fails or its private daily pilot cap is reached.
// This module never logs prompt, response, API key, bearer, or sensitive metadata.
const ENDPOINT='https://openrouter.ai/api/v1/chat/completions';
const MODEL='openrouter/auto';
const TIERS=Object.freeze({
 low:Object.freeze({prompt:0.40,completion:1.50}),
 medium:Object.freeze({prompt:1.00,completion:4.00})
});
function tierForTask(goal){
 if(typeof goal!=='string'||goal.length<8||goal.length>600)
  throw Error('openrouter_goal_denied');
 const q=goal.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 // Deterministic JEV-inspired cost gate, no extra model called to classify.
 // Complex financial, legal or cross-domain reasoning may use medium;
 // routine summaries and comparisons use low. Never high/max automatically.
 return /\b(financ|concilia|compromiss|risco|jurid|contrat|auditori|caixa|decisao|decisoes|estrateg|tribut|fiscal)\w*/.test(q)?
  'medium':'low';
}
function isFallbackEligible(error){
 const name=error?.message;
 return typeof name==='string'&&[
  'codex_login_quota_exhausted',
  'codex_login_rate_limited',
  'codex_login_timeout',
  'codex_login_provider_unavailable',
  'codex_login_bridge_unreachable',
  'codex_login_bridge_busy',
  'codex_login_invalid_response'
 ].includes(name);
}
function makeOpenRouter({enabled,stage,killSwitch,key,fetchImpl=globalThis.fetch}={}){
 if(enabled!==true)return null;
 if(stage!=='staging'||killSwitch!==true||
   typeof key!=='string'||!/^sk-or-[a-z0-9_-]{20,220}$/i.test(key)||
   typeof fetchImpl!=='function')throw Error('openrouter_configuration_denied');
 return Object.freeze({forTask(goal){
  const tier=tierForTask(goal);
  const price=TIERS[tier];
  let pinnedModel=null,done=0;
  return Object.freeze({tier,chat:async(messages,{maxTokens,jsonMode=false}={})=>{
   if(done>=2)throw Error('openrouter_task_cap');
   if(!Array.isArray(messages)||messages.length!==2||
    messages.some((x,i)=>!x||x.role!==(i?'user':'system')||
      typeof x.content!=='string'||x.content.length<1||x.content.length>8200)||
    !Number.isInteger(maxTokens)||maxTokens<200||maxTokens>1000||
    typeof jsonMode!=='boolean')
    throw Error('openrouter_request_denied');
   // Request count is reserved by the poller before any HTTP call.
   done++;
   const req={
    model:pinnedModel||MODEL,messages,
    max_tokens:maxTokens,stream:false,
    provider:{zdr:true,data_collection:'deny',
     max_price:{prompt:price.prompt,completion:price.completion}},
    ...(pinnedModel?{}:{plugins:[{id:'auto-router',cost_tier:tier}]}),
    ...(jsonMode?{response_format:{type:'json_object'}}:{})
   };
   let res;
   try{res=await fetchImpl(ENDPOINT,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json',
     'Accept':'application/json','X-OpenRouter-Title':'Hermes Grupo Erick Staging'},
    body:JSON.stringify(req)
   });}catch{throw Error('openrouter_secondary_unavailable');}
   if(res?.status!==200||res?.ok!==true){
    if(res?.status===429||res?.status===402)throw Error('openrouter_budget_or_rate_limit');
    throw Error('openrouter_secondary_unavailable');
   }
   const announced=Number(res.headers?.get?.('content-length')||0);
   if(announced>7200)throw Error('openrouter_output_oversize');
   let raw='';
   try{
    if(!res.body?.getReader)throw Error('response_not_streamed');
    const r=res.body.getReader(),decoder=new TextDecoder('utf8',{fatal:true});
    for(;;){
     const {done,value}=await r.read();if(done)break;
     if(Buffer.byteLength(raw,'utf8')+value.byteLength>7200){
      await r.cancel();throw Error('output_limit');
     }
     raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
   }catch{throw Error('openrouter_output_oversize');}
   let data;try{data=JSON.parse(raw);}catch{throw Error('openrouter_response_invalid');}
   const answer=data?.choices?.[0]?.message?.content;
   if(typeof answer!=='string'||answer.length<1||answer.length>6500)
    throw Error('openrouter_response_invalid');
   if(jsonMode){try{JSON.parse(answer)}catch{throw Error('openrouter_response_invalid')}}
   // Pin real model for planning + synthesis within this ONE task if reported.
   if(!pinnedModel&&typeof data.model==='string'&&
      /^[a-z0-9][a-z0-9_.-]{1,60}\/[a-z0-9_.:-]{1,70}$/i.test(data.model)&&
      data.model!==MODEL)pinnedModel=data.model;
   return answer;
  }});
 }});
}
module.exports={MODEL,TIERS,tierForTask,isFallbackEligible,makeOpenRouter};
