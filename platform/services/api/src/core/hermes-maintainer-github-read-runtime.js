'use strict';
const DEFAULT_TIMEOUT_MS=5000;
const MAX_CONTENT_BYTES=1024*1024;
function createHermesMaintainerGithubReadRuntime({fetchImpl,resolveAuthorization,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl required');
 if(typeof resolveAuthorization!=='function')throw new TypeError('resolveAuthorization required');
 return Object.freeze({async readGithubRepositoryPath(input){
  if(!valid(input))return Object.freeze({ok:false,reason:'REQUEST_INVALID'});
  let authorization;
  try{authorization=await resolveAuthorization();}
  catch{return Object.freeze({ok:false,reason:'AUTHORIZATION_UNAVAILABLE'});}
  if(typeof authorization!=='string'||authorization.length===0)return Object.freeze({ok:false,reason:'AUTHORIZATION_UNAVAILABLE'});
  const [owner,repo]=input.repository.split('/');
  const url='https://api.github.com/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'/contents/'+input.path.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(input.ref);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github.raw+json',Authorization:authorization,'X-GitHub-Api-Version':'2022-11-28'},signal:controller.signal});}
  catch{return Object.freeze({ok:false,reason:'PROVIDER_REQUEST_FAILED'});}
  finally{clearTimeout(timer);}
  if(!response||response.ok!==true)return Object.freeze({ok:false,reason:'PROVIDER_RESPONSE_FAILED'});
  const declared=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_CONTENT_BYTES)return Object.freeze({ok:false,reason:'CONTENT_TOO_LARGE'});
  let content;
  try{content=await response.text();}catch{return Object.freeze({ok:false,reason:'PROVIDER_RESPONSE_INVALID'});}
  if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>MAX_CONTENT_BYTES||content.includes('\u0000'))return Object.freeze({ok:false,reason:'PROVIDER_RESPONSE_INVALID'});
  return Object.freeze({ok:true,content,sha:response.headers?.get?.('etag')||null});
 }});
}
function valid(v){return !!v&&v.provider===undefined&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v.repository||'')&&typeof v.ref==='string'&&v.ref.length>0&&typeof v.path==='string'&&v.path.length>0&&!v.path.includes('..')&&!/[\\\u0000-\u001f\u007f?#]/.test(v.path)&&v.method==='GET'&&v.read_only===true;}
module.exports={DEFAULT_TIMEOUT_MS,MAX_CONTENT_BYTES,createHermesMaintainerGithubReadRuntime};
