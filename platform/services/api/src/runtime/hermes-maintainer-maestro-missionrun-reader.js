'use strict';

// Read-only bridge to the existing authenticated Maestro missionGateway.
// invokeMissionGateway must be supplied ONLY by privileged server composition.
// It must authenticate separately, enforce the official membership/service-role
// policy and must never be obtained from caller-controlled request input.
const {createHermesMaintainerMaestroInvokerFromServerEnv}=require('./hermes-maintainer-maestro-authenticated-invoker');
const CONTRACT_VERSION='hermes_maintainer_maestro_missionrun_reader_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const VERIFY_A3_OPERATION='verify_a3_provenance'; // Requires a deployed authoritative source; fail closed.
const OPERATIONS=new Set(['update_file','create_pull_request']);
const ID=/^[^\x00-\x20\x7f]{1,255}$/;

function createHermesMaintainerMaestroMissionRunReader({invokeMissionGateway}={}){
 // The only implicit transport comes from process-owned staging settings.
 // A caller cannot provide credentials or a URL through the A3 query.
 const serverTransport=typeof invokeMissionGateway==='function'?null:createHermesMaintainerMaestroInvokerFromServerEnv();
 const privilegedInvoke=typeof invokeMissionGateway==='function'?invokeMissionGateway:(serverTransport?.configured?serverTransport.invokeMissionGateway:null);
 const readMissionRun=async query=>{
  if(typeof privilegedInvoke!=='function'||!query||query.environment!=='staging'||
     query.repository!==REPOSITORY||!OPERATIONS.has(query.operation)||!ID.test(query.mission_id||'')||
     !/^sha256:[a-f0-9]{64}$/.test(query.target_digest||'')||
     !/^sha256:[a-f0-9]{64}$/.test(query.intent_digest||'')||
     !ID.test(query.single_use_authorization_id||'')||
     !ID.test(query.approval_reference||'')||!ID.test(query.authorization_reference||''))return null;
  let listed;
  try{listed=await privilegedInvoke(Object.freeze({operation:'list_runs',mission_id:query.mission_id}));}
  catch{return null;}
  if(!listed||!Array.isArray(listed.runs)||listed.runs.length<1||listed.runs.length>500)return null;
  const candidates=listed.runs.filter(run=>
   run&&typeof run==='object'&&run.mission_id===query.mission_id&&
   ID.test(run.id||'')&&ID.test(run.espaco_id||'')&&run.dispatch_simulado===false&&
   ['em_execucao','concluida'].includes(run.status)&&
   typeof run.contract_hash==='string'&&/^sha256:[0-9a-f]{64}$/.test(run.contract_hash)&&
   typeof run.contrato_json==='string'&&run.contrato_json.length>1&&
   run.contrato_json.length<=65536);
  // Requiring exactly one candidate prevents ambiguous mission/run provenance.
  if(candidates.length!==1)return null;
  const run=candidates[0];
  let integrity;
  try{integrity=await privilegedInvoke(Object.freeze({operation:'verify_integrity',run_id:run.id}));}
  catch{return null;}
  if(integrity?.ok!==true||integrity.expected!==run.contract_hash||
     integrity.actual!==run.contract_hash)return null;
  // verify_integrity authenticates the *dispatch contract*, not the A3 gate.
  // Require a distinct gateway-side verification against privileged, immutable
  // issuer evidence. The current Maestro gateway does NOT yet expose this
  // operation; its 400/404/error remains fail-closed.
  let proof;
  try{proof=await privilegedInvoke(Object.freeze({
   operation:VERIFY_A3_OPERATION,run_id:run.id,mission_id:query.mission_id,
   a3_operation:query.operation,repository:query.repository,environment:'staging',
   target_digest:query.target_digest,intent_digest:query.intent_digest,
   approval_reference:query.approval_reference,
   authorization_reference:query.authorization_reference,
   single_use_authorization_id:query.single_use_authorization_id
  }));}catch{return null;}
  if(proof?.verified!==true||proof?.source!=='MISSION_GATEWAY_DURABLE'||
     proof?.mission_run_id!==run.id||proof?.operation!==query.operation||
     !proof?.record||typeof proof.record!=='object'||Array.isArray(proof.record)||
     proof.record.mission_run_id!==run.id)return null;
  // Pass through, don't generate or "repair" a record. The A3 validator
  // independently verifies exact fields and all canonical digests.
  try{return JSON.parse(JSON.stringify(proof.record));}catch{return null;}
 };
 return Object.freeze({contract_version:CONTRACT_VERSION,source:'MAESTRO_MISSION_GATEWAY_AUTHENTICATED_READ_ONLY',
  readMissionRun,configured:typeof privilegedInvoke==='function'});
}
module.exports={CONTRACT_VERSION,VERIFY_A3_OPERATION,createHermesMaintainerMaestroMissionRunReader};
