'use strict';

const {collectHermesMaintainerGithubProviderStatusEvidence}=require('./hermes-maintainer-github-provider-status-evidence');

const PROBE_VERSION='hermes_maintainer_github_provider_status_probe_v1';

async function probeHermesMaintainerGithubProviderStatus({resolveAuthorization,fetchImpl,repository,ref,path}={}){
 if(typeof resolveAuthorization!=='function'||typeof fetchImpl!=='function') return unavailable();
 if(repository!=='instutodp-cpu/agente-grupo-erick'||ref!=='main'||path!=='README.md') return unavailable();
 let authorization;
 try{
  const resolved=await resolveAuthorization('github_read_only_staging');
  authorization=resolved?.ok===true&&typeof resolved.authorization==='string'?resolved.authorization:null;
 }catch{return unavailable();}
 if(!authorization)return unavailable();
 let response;
 try{
  response=await fetchImpl('https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/contents/README.md?ref=main',{
   method:'GET',redirect:'error',
   headers:{Accept:'application/vnd.github.raw+json',Authorization:authorization,'X-GitHub-Api-Version':'2022-11-28'}
  });
 }catch{return unavailable();}
 return Object.freeze({probe_version:PROBE_VERSION,...collectHermesMaintainerGithubProviderStatusEvidence(response)});
}
function unavailable(){
 return Object.freeze({probe_version:PROBE_VERSION,evidence_version:'hermes_maintainer_github_provider_status_evidence_v1',provider:'GITHUB',method:'GET',read_only:true,status:null,ok:false,github_request_id_present:false,credential_material_present:false,response_body_present:false,write_performed:false});
}
module.exports={PROBE_VERSION,probeHermesMaintainerGithubProviderStatus};
