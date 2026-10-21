'use strict';
// Run on a separately controlled witness host only, NEVER inside Hermes API.
// No network option, Docker socket mount, writable source or caller command.
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const SHA=/^[0-9a-f]{64}$/;
const ENV=Object.freeze({
 PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
 HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent'
});
function createBoundedCommand({spawnImpl=spawn,timeoutMs=120000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)
  throw new TypeError('bounded_external_docker_timeout_required');
 return args=>new Promise((resolve,reject)=>{
  let child,done=false,text='',timer;
  const finish=(err,result)=>{
   if(done)return;done=true;clearTimeout(timer);
   if(err)reject(err);else resolve(result);
  };
  try{
   child=spawnImpl('docker',args,{shell:false,
    env:ENV,stdio:['ignore','pipe','ignore']});
   if(!child||typeof child.on!=='function'||!child.stdout)
    throw Error('docker_unavailable');
  }catch{return finish(Error('docker_unavailable'));}
  child.stdout.on('data',buf=>{
   text+=String(buf);
   if(text.length>32768){
    try{child.kill('SIGKILL');}catch{}
    finish(Error('docker_output_exceeds_limit'));
   }
  });
  child.on('error',()=>finish(Error('docker_failed')));
  child.on('exit',code=>finish(code===0?null:Error('docker_nonzero_exit'),text.trim()));
  timer=setTimeout(()=>{
   try{child.kill('SIGKILL');}catch{}
   finish(Error('docker_timeout_ambiguous'));
  },timeoutMs);
 });
}
function createIndependentDockerDriver({runCommand=createBoundedCommand()}={}){
 if(typeof runCommand!=='function')throw new TypeError('bounded_docker_command_required');
 async function create({imageId,sourceRoot,revisionSha,runId}={}){
  if(!/^sha256:[0-9a-f]{64}$/.test(imageId||'')||
    !/^\/[a-zA-Z0-9_/.-]{5,1024}$/.test(sourceRoot||'')||
    (sourceRoot.includes('..')||!sourceRoot.endsWith('/platform/services/api'))||
    !/^[a-f0-9]{40}$/.test(revisionSha||'')||
    typeof runId!=='string'||runId.length>255)
   throw Error('docker_immutable_scope_invalid');
  const name='a3-witness-'+crypto.createHash('sha256').update(runId).digest('hex').slice(0,32);
  const args=[
   'create','--name',name,'--pull=never','--network=none',
   '--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
   '--pids-limit=64','--memory=384m','--cpus=1','--user=65534:65534',
   '--tmpfs=/tmp:rw,nosuid,nodev,size=32m',
   '--mount','type=bind,source='+sourceRoot+',target=/a3,readonly',
   '--workdir=/a3','--entrypoint=node',imageId,'--test',
   'test/hermes-maintainer-e2e-workflow-contract.test.js',
   'test/hermes-maintainer-test-execution-boundary.test.js'
  ];
  const id=await runCommand(args);
  if(!SHA.test(id||''))throw Error('docker_container_identity_unconfirmed');
  return id;
 }
 async function inspect(id){
  if(!SHA.test(id||''))throw Error('docker_container_identity_invalid');
  const json=await runCommand(['inspect','--type=container',id]);
  let data;try{data=JSON.parse(json);}catch{throw Error('docker_inspect_unparseable');}
  if(!Array.isArray(data)||data.length!==1)return null;
  return data[0];
 }
 async function start(id){
  if(!SHA.test(id||''))throw Error('docker_container_identity_invalid');
  await runCommand(['start',id]);
 }
 async function wait(id){
  if(!SHA.test(id||''))throw Error('docker_container_identity_invalid');
  const result=await runCommand(['wait',id]);
  return /^\d{1,3}$/.test(result)?Number(result):null;
 }
 async function remove(id){
  if(!SHA.test(id||''))throw Error('docker_container_identity_invalid');
  return runCommand(['rm','-f',id]);
 }
 return Object.freeze({create,inspect,start,wait,remove});
}
module.exports={createBoundedCommand,createIndependentDockerDriver};
