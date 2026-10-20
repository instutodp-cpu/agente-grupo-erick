'use strict';

// Staging-only, server-owned read transport for the existing Base44 Mission Gateway.
// No request may supply the target URL, token, function name, or arbitrary operation.
const CONTRACT_VERSION='hermes_maintainer_maestro_authenticated_invoker_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
// Verified against the installed official @base44/sdk functions.invoke:
// POST https://base44.app/api/apps/<appId>/functions/<functionName>.
// Pin BOTH authority and app/function path so a misconfigured env can
// never forward the server-held user bearer to a foreign HTTPS origin.
const MAESTRO_APP_ID='69f62cbb266971d4deeb4938';
const GATEWAY_URL='https://base44.app/api/apps/'+MAESTRO_APP_ID+'/functions/missionGateway';
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const OPS=Object.freeze({
 list_runs:['operation','mission_id'],
 verify_integrity:['operation','run_id'],
 verify_a3_provenance:['operation','run_id','mission_id','a3_operation','repository','environment',
  'target_digest','intent_digest','approval_reference','authorization_reference','single_use_authorization_id']
});
function validRequest(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype)return false;
 const fields=OPS[body.operation];
 if(!fields||Object.keys(body).sort().join('|')!==[...fields].sort().join('|'))return false;
 if(body.operation==='list_runs')return ID.test(body.mission_id||'');
 if(body.operation==='verify_integrity')return ID.test(body.run_id||'');
 return ID.test(body.run_id||'')&&ID.test(body.mission_id||'')&&
  (body.a3_operation==='update_file'||body.a3_operation==='create_pull_request')&&
  body.repository===REPOSITORY&&body.environment==='staging'&&
  DIGEST.test(body.target_digest||'')&&DIGEST.test(body.intent_digest||'')&&
  ID.test(body.approval_reference||'')&&ID.test(body.authorization_reference||'')&&
  ID.test(body.single_use_authorization_id||'');
}
function validGatewayUrl(value){
 try{
  if(typeof value!=='string'||value.length>2048)return false;
  const u=new URL(value);
  return u.href===GATEWAY_URL&&u.origin==='https://base44.app'&&
   u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&
   (!u.port||u.port==='443');
 }catch{return false;}
}
function serverSettingsFromEnv(env=process.env){
 if(env?.HERMES_DEPLOYMENT_STAGE!=='staging'||!validGatewayUrl(env?.MAESTRO_MISSION_GATEWAY_URL)||
  typeof env.MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN!=='string'||
  env.MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN.length<24||
  /[\x00-\x20\x7f]/.test(env.MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN))return null;
 return Object.freeze({gatewayUrl:env.MAESTRO_MISSION_GATEWAY_URL,accessToken:env.MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN});
}
function createHermesMaintainerMaestroAuthenticatedInvoker({environment,gatewayUrl,accessToken,fetchImpl=globalThis.fetch}={}){
 const configured=environment==='staging'&&validGatewayUrl(gatewayUrl)&&
  typeof accessToken==='string'&&accessToken.length>=24&&!/[\x00-\x20\x7f]/.test(accessToken)&&
  typeof fetchImpl==='function';
 const invokeMissionGateway=async body=>{
  if(!configured||!validRequest(body))return null;
  try{
   const result=await fetchImpl(gatewayUrl,{
    method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
    headers:{'content-type':'application/json',accept:'application/json',authorization:'Bearer '+accessToken},
    body:JSON.stringify(body),signal:AbortSignal.timeout(8000)
   });
   if(!result||result.status!==200||result.ok!==true||
    !/^application\/json(?:;|$)/i.test(result.headers?.get?.('content-type')||''))return null;
   const length=Number(result.headers?.get?.('content-length'));
   if(Number.isFinite(length)&&length>1048576)return null;
   const payload=await result.text();
   if(payload.length>1048576)return null;
   const parsed=JSON.parse(payload);
   return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  }catch{return null;}
 };
 return Object.freeze({contract_version:CONTRACT_VERSION,configured,invokeMissionGateway});
}
function createHermesMaintainerMaestroInvokerFromServerEnv({env=process.env,fetchImpl=globalThis.fetch}={}){
 const cfg=serverSettingsFromEnv(env);
 return createHermesMaintainerMaestroAuthenticatedInvoker({
  environment:cfg?'staging':'unconfigured',gatewayUrl:cfg?.gatewayUrl,
  accessToken:cfg?.accessToken,fetchImpl
 });
}
module.exports={CONTRACT_VERSION,MAESTRO_APP_ID,GATEWAY_URL,
 validRequest,validGatewayUrl,serverSettingsFromEnv,
 createHermesMaintainerMaestroAuthenticatedInvoker,createHermesMaintainerMaestroInvokerFromServerEnv};
