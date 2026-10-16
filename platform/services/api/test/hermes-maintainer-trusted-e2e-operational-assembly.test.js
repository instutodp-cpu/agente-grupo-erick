'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');

function load(stubs){
 const original=Module._load;
 Module._load=function(request,parent,isMain){
  for(const [suffix,value] of Object.entries(stubs))if(request.endsWith(suffix))return value;
  return original(request,parent,isMain);
 };
 try{
  const path=require.resolve('../src/runtime/hermes-maintainer-trusted-e2e-operational-assembly');
  delete require.cache[path];
  return require(path);
 }finally{
  Module._load=original;
 }
}

test('assembles through official compositions and preserves exact A3 evidence without consuming authority',()=>{
 const a3={contract_version:'hermes_a3_scoped_external_action_eligibility_v2',marker:'exact-input'};
 const operational={branch:{ok:true}};
 let evidenceInput=null;
 let authorizedInput=null;
 const module=load({
  'hermes-maintainer-trusted-e2e-controlled-execution-composition':{prepareHermesMaintainerTrustedE2eControlledExecutions:()=>({prepared:true,controlled_executions:{branch:{b:1},edit:{e:1},pull_request:{p:1}}})},
  'hermes-maintainer-trusted-e2e-operational-evidence-preparation':{prepareHermesMaintainerTrustedE2eOperationalEvidence:(input)=>{evidenceInput=input;return {prepared:true,operational_evidence:{branch:{a3_eligibility_input:input.a3_eligibility_input}}};}},
  'hermes-maintainer-trusted-e2e-authorized-operational-composition':{prepareHermesMaintainerTrustedE2eAuthorizedOperational:(input)=>{authorizedInput=input;return {prepared:true,operational};}}
 });
 const x=module.prepareHermesMaintainerTrustedE2eOperationalAssembly({mission_id:'m',branch_name:'hermes/canary/e2e',a3_eligibility_input:a3});
 assert.equal(module.CONTRACT_VERSION,'hermes_maintainer_trusted_e2e_operational_assembly_v3');
 assert.equal(evidenceInput.a3_eligibility_input,a3);
 assert.equal(authorizedInput.operational_evidence.branch.a3_eligibility_input,a3);
 assert.equal(x.prepared,true);
 assert.equal(x.operational,operational);
 assert.equal(x.authorization_consumed,false);
 assert.equal(x.production_used,false);
 assert.equal(x.merge_authority,false);
 assert.equal(x.human_merge_required,true);
});

test('passes explicit decisions with external references instead of synthesizing authority',()=>{
 const human={branch:{decision:'APPROVED'},edit:{decision:'APPROVED'},pull_request:{decision:'APPROVED'}};
 const authorization={branch:{decision:'AUTHORIZED'},edit:{decision:'AUTHORIZED'},pull_request:{decision:'AUTHORIZED'}};
 const references={branch:{approval_reference:'h:b',authorization_reference:'a:b'},edit:{approval_reference:'h:e',authorization_reference:'a:e'},pull_request:{approval_reference:'h:p',authorization_reference:'a:p'}};
 let adapterInput=null;
 let authorizedInput=null;
 const module=load({
  'hermes-maintainer-trusted-e2e-controlled-execution-composition':{prepareHermesMaintainerTrustedE2eControlledExecutions:()=>({prepared:true,controlled_executions:{branch:{},edit:{},pull_request:{}}})},
  'hermes-maintainer-trusted-e2e-operational-evidence-preparation':{prepareHermesMaintainerTrustedE2eOperationalEvidence:()=>({prepared:true,operational_evidence:{}})},
  'hermes-maintainer-trusted-e2e-external-decision-adapter':{adaptHermesMaintainerTrustedE2eExternalDecisions:(input)=>{adapterInput=input;return {adapted:true,human_decisions:human,authorization_decisions:authorization};}},
  'hermes-maintainer-trusted-e2e-authorized-operational-composition':{prepareHermesMaintainerTrustedE2eAuthorizedOperational:(input)=>{authorizedInput=input;return {prepared:true,operational:{ok:true}};}}
 });
 const x=module.prepareHermesMaintainerTrustedE2eOperationalAssembly({mission_id:'m',branch_name:'hermes/canary/e2e',external_decision_references:references,human_decisions:human,authorization_decisions:authorization});
 assert.equal(x.prepared,true);
 assert.equal(adapterInput.references,references);
 assert.equal(adapterInput.human_decisions,human);
 assert.equal(adapterInput.authorization_decisions,authorization);
 assert.equal(authorizedInput.human_decisions,human);
 assert.equal(authorizedInput.authorization_decisions,authorization);
});

test('fails closed when opaque external references are not accompanied by explicit decisions',()=>{
 let authorizedCalled=false;
 const module=load({
  'hermes-maintainer-trusted-e2e-controlled-execution-composition':{prepareHermesMaintainerTrustedE2eControlledExecutions:()=>({prepared:true,controlled_executions:{branch:{},edit:{},pull_request:{}}})},
  'hermes-maintainer-trusted-e2e-operational-evidence-preparation':{prepareHermesMaintainerTrustedE2eOperationalEvidence:()=>({prepared:true,operational_evidence:{}})},
  'hermes-maintainer-trusted-e2e-external-decision-adapter':{adaptHermesMaintainerTrustedE2eExternalDecisions:()=>({adapted:false,stage:'human_decisions',execution_authorized:false})},
  'hermes-maintainer-trusted-e2e-authorized-operational-composition':{prepareHermesMaintainerTrustedE2eAuthorizedOperational:()=>{authorizedCalled=true;return {prepared:true};}}
 });
 const references={branch:{approval_reference:'h:b'},edit:{approval_reference:'h:e'},pull_request:{approval_reference:'h:p'}};
 const x=module.prepareHermesMaintainerTrustedE2eOperationalAssembly({mission_id:'m',branch_name:'hermes/canary/e2e',external_decision_references:references});
 assert.equal(x.prepared,false);
 assert.equal(x.stage,'external_decisions');
 assert.equal(authorizedCalled,false);
 assert.equal(x.authorization_consumed,false);
});

test('fails closed when A3 operational evidence preparation blocks',()=>{
 const module=load({
  'hermes-maintainer-trusted-e2e-controlled-execution-composition':{prepareHermesMaintainerTrustedE2eControlledExecutions:()=>({prepared:true,controlled_executions:{branch:{},edit:{},pull_request:{}}})},
  'hermes-maintainer-trusted-e2e-operational-evidence-preparation':{prepareHermesMaintainerTrustedE2eOperationalEvidence:()=>({prepared:false,blockers:['A3_ELIGIBILITY_INPUT_MISSING']})},
  'hermes-maintainer-trusted-e2e-authorized-operational-composition':{}
 });
 const x=module.prepareHermesMaintainerTrustedE2eOperationalAssembly({mission_id:'m',branch_name:'hermes/canary/e2e'});
 assert.equal(x.prepared,false);
 assert.equal(x.stage,'operational_evidence');
 assert.equal(x.value.blockers[0],'A3_ELIGIBILITY_INPUT_MISSING');
 assert.equal(x.authorization_consumed,false);
});

test('fails closed when controlled execution preparation blocks',()=>{
 const x=load({
  'hermes-maintainer-trusted-e2e-controlled-execution-composition':{prepareHermesMaintainerTrustedE2eControlledExecutions:()=>({prepared:false})},
  'hermes-maintainer-trusted-e2e-operational-evidence-preparation':{},
  'hermes-maintainer-trusted-e2e-authorized-operational-composition':{}
 }).prepareHermesMaintainerTrustedE2eOperationalAssembly({});
 assert.equal(x.prepared,false);
 assert.equal(x.stage,'controlled_executions');
 assert.equal(x.merge_authority,false);
});

test('fails closed when explicit authorization decisions are not accepted',()=>{
 const x=load({
  'hermes-maintainer-trusted-e2e-controlled-execution-composition':{prepareHermesMaintainerTrustedE2eControlledExecutions:()=>({prepared:true,controlled_executions:{branch:{},edit:{},pull_request:{}}})},
  'hermes-maintainer-trusted-e2e-operational-evidence-preparation':{prepareHermesMaintainerTrustedE2eOperationalEvidence:()=>({prepared:true,operational_evidence:{}})},
  'hermes-maintainer-trusted-e2e-authorized-operational-composition':{prepareHermesMaintainerTrustedE2eAuthorizedOperational:()=>({prepared:false,stage:'authorization_grants'})}
 }).prepareHermesMaintainerTrustedE2eOperationalAssembly({});
 assert.equal(x.prepared,false);
 assert.equal(x.stage,'authorized_operational');
 assert.equal(x.authorization_consumed,false);
});
